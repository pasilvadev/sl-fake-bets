-- =============================================================================
-- SL Fake Bets — public.bets.resolved_at (found-bugs: transaction-history sort)
--
-- WHY THIS EXISTS
--
-- `BetSettlementEntry.createdAt` (packages/shared/src/ledger.ts's
-- `deriveBetSettlementHistory`, added for the transaction-history modal) had
-- nothing to stamp a settled bet/duel with except `bet.closes_at` — the
-- schema carried no moment-of-resolution timestamp at all. `closes_at` is
-- WHEN BETTING CLOSED, not when a moderator/mediator actually resolved it,
-- and there is no deadline on the gap between the two (`resolve_bet` runs
-- whenever a human gets to it). Sorting that stand-in against real
-- `transactions.created_at` rows in one merged, "most recent first" list
-- (transactions-modal.tsx) meant a bet resolved days after it closed could
-- display BELOW real transactions that happened first — the payout a member
-- just received sorting as older than rewards they got earlier that week.
--
-- Nullable, no backfill, no default: every bet resolved before this migration
-- keeps `resolved_at is null` forever, and `deriveBetSettlementHistory` falls
-- back to `bet.closesAt` for exactly those rows (the same approximation it
-- always used) — this column only sharpens the timestamp for everything
-- resolved from here on.
-- =============================================================================

alter table public.bets add column resolved_at timestamptz;

comment on column public.bets.resolved_at is
  'Set once, by resolve_bet or void_duel, the moment a bet/duel is settled — never by any other write path, and never cleared (bets only ever move open→closed→resolved). Null for every bet resolved before this column existed, and for anything still open/closed.';

-- =============================================================================
-- public.resolve_bet — stamp resolved_at (task above)
--
-- IDENTICAL four-argument signature to the version this replaces
-- (20260906130100_duel_rpcs.sql), so this is a plain `create or replace`: no
-- new overload, no lost grants (see that file's own note on why a signature
-- change needs a DROP first — this isn't one). The body is that file's,
-- unchanged except the one new column in the resolution UPDATE.
-- =============================================================================

create or replace function public.resolve_bet(
  p_bet_id            uuid,
  p_kind              public.bet_resolution_kind,
  p_winning_option_id uuid,
  p_void_reason       public.bet_void_reason default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid         uuid := app.require_uid();
  v_team_id     uuid;
  v_state       public.bet_state;
  v_closes      timestamptz;
  v_kind        public.bet_kind;
  v_accepted_at timestamptz;
  v_void_reason public.bet_void_reason;
  v_deltas      jsonb;
begin
  select b.team_id, b.state, b.closes_at, b.kind
    into v_team_id, v_state, v_closes, v_kind
    from public.bets b
   where b.id = p_bet_id;

  if v_team_id is null then
    raise exception 'This bet no longer exists.' using errcode = 'no_data_found';
  end if;

  -- D8 half (b), for duels only: a resolver looking at a stale unaccepted duel
  -- should be told it is already void, not told to wait for an acceptance that
  -- can never come. Costs a pool bet nothing because it does not run for one.
  if v_kind = 'duel' then
    perform app.expire_stale_duels(v_team_id);
    select b.state, b.closes_at into v_state, v_closes
      from public.bets b where b.id = p_bet_id;
  end if;

  -- permissions.ts: canResolveBet for a pool bet (DOM-018/019 — creator,
  -- moderator, leader), canResolveDuel for a duel (D6/D7 — the named mediator
  -- or the any-moderator pool, NEVER a participant). Two sentences because they
  -- name two different sets of people, and a member refused by one would be
  -- misled by the other's wording.
  if not app.can_resolve_bet(p_bet_id) then
    if v_kind = 'duel' then
      raise exception 'Only the mediator or a moderator can resolve this duel.'
        using errcode = 'insufficient_privilege';
    else
      raise exception 'Only the bet creator or a moderator can resolve this bet.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if v_state = 'resolved' then
    raise exception 'This bet is already resolved.' using errcode = 'check_violation';
  end if;

  -- A duel with one stake on the table has nothing to resolve. Without this a
  -- mediator could "declare a winner" on an unaccepted duel: `app.settle_bet`
  -- would find one wager, make its own option the winning side, pay the
  -- challenger their own stake back at zero P/L, and produce a resolved bet
  -- that looks settled and means nothing. The honest exits before acceptance
  -- are accept, decline, expiry and delete — all of which exist.
  if v_kind = 'duel' then
    select d.accepted_at into v_accepted_at
      from public.bet_duels d where d.bet_id = p_bet_id;
    if v_accepted_at is null then
      raise exception 'This duel hasn''t been accepted yet.' using errcode = 'check_violation';
    end if;
  end if;

  -- Unchanged from Phase 7, and unreachable for a duel: `accept_duel` already
  -- wrote `state='closed'`, and the guard above refuses every duel that has not
  -- been accepted, so a duel never arrives here still 'open'. Left exactly as
  -- written because it is the pool bet's path and this phase does not touch
  -- pool bets.
  if v_state = 'open' then
    if v_closes > now() then
      raise exception 'Close betting before resolving.' using errcode = 'check_violation';
    end if;
    update public.bets set state = 'closed' where id = p_bet_id;
  end if;

  if p_kind is null then
    raise exception 'Pick a winning option or void the bet.' using errcode = 'check_violation';
  end if;

  -- DOM-018: the winner must be one of THIS bet's options. DOM-019's void
  -- carries no option at all, and a stray one would end up stored next to a
  -- 'void' resolution_kind where `toResolution` can never read it.
  if p_kind = 'winner' then
    if p_winning_option_id is null or not exists (
      select 1 from public.bet_options o
       where o.id = p_winning_option_id and o.bet_id = p_bet_id
    ) then
      raise exception 'Pick one of the bet''s options as the winner.'
        using errcode = 'check_violation';
    end if;
  else
    p_winning_option_id := null;
  end if;

  -- D3, in three lines and one deliberate silence:
  --
  --   * a winner has no reason — there is nothing to explain;
  --   * a POOL bet's void has no reason either, ever, and an argument passed
  --     for one is IGNORED rather than refused. That is a choice, not sloppiness:
  --     `resolveBet` in bet-mutations.ts sends `p_void_reason` on every call
  --     uniformly, the pool-void surface has no reason picker to fill it from,
  --     and refusing a null-equivalent argument would make the client branch on
  --     bet kind to call one function two ways. The column stays NULL for every
  --     pool bet ever written, which is what made D3 need no backfill.
  --   * a DUEL void with no reason given defaults to `'mediator'`, because at
  --     this point in the code the only way to arrive is a human resolver who
  --     passed authorization. The client does NOT guess this value — `undefined`
  --     there means "the caller expressed no reason", and only the server knows
  --     the caller was a mediator.
  if p_kind = 'void' and v_kind = 'duel' then
    v_void_reason := coalesce(p_void_reason, 'mediator');
  else
    v_void_reason := null;
  end if;

  -- Computed BEFORE the resolution columns land, purely so the two reads of the
  -- same truth cannot be separated by a concurrent write; settle_bet reads only
  -- `wagers`, which this function never touches.
  --
  -- For a duel this is the task-6 proof in production: two members, symmetric
  -- stakes, opposite options. pool = 2×stake, win_total = stake, so the winner's
  -- payout is floor(stake × 2·stake / stake) = 2·stake and their P/L is
  -- +stake; the loser staked on the other option, so win_stake = 0, payout = 0
  -- and P/L is −stake. No duel branch, no rounding to argue about (the single
  -- floor divides exactly), no second formula.
  select coalesce(
           jsonb_agg(jsonb_build_object(
             'user_id',           s.user_id,
             'balance_delta',     s.balance_delta,
             'profit_loss_delta', s.profit_loss_delta
           )),
           '[]'::jsonb
         )
    into v_deltas
    from app.settle_bet(p_bet_id, p_kind, p_winning_option_id) s;

  update public.bets
     set state             = 'resolved',
         resolution_kind   = p_kind,
         winning_option_id = p_winning_option_id,
         void_reason       = v_void_reason,
         resolved_at       = now()
   where id = p_bet_id;

  -- Decision §4.6: settlement emits CREDITS only (the stake left at placement),
  -- so this can never take a balance negative — and it deliberately writes no
  -- `transactions` row, because resolution is not a ledger event (DOM-025).
  -- A wagerer who has since been kicked has no row here and is simply skipped;
  -- their per-team balance died with the membership (decision §4.4).
  update public.team_members m
     set coin_balance = m.coin_balance + d.balance_delta,
         profit_loss  = m.profit_loss  + d.profit_loss_delta
    from jsonb_to_recordset(v_deltas)
      as d(user_id uuid, balance_delta integer, profit_loss_delta integer)
   where m.team_id = v_team_id and m.user_id = d.user_id;

  return v_deltas;
end;
$$;

-- =============================================================================
-- app.void_duel — same stamp, same reasoning
--
-- The OTHER live write path to `state = 'resolved'` (an unaccepted duel voided
-- by `app.expire_stale_duels` or `app.void_duels_for_departing_member`, neither
-- of which goes through `resolve_bet`). Same identical-signature `create or
-- replace`; body otherwise unchanged from 20260906130100_duel_rpcs.sql.
-- =============================================================================

create or replace function app.void_duel(
  p_bet_id uuid,
  p_reason public.bet_void_reason
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_team_id uuid;
  v_state   public.bet_state;
  v_kind    public.bet_kind;
  v_deltas  jsonb;
begin
  select b.team_id, b.state, b.kind
    into v_team_id, v_state, v_kind
    from public.bets b
   where b.id = p_bet_id;

  if v_team_id is null then
    raise exception 'This bet no longer exists.' using errcode = 'no_data_found';
  end if;

  -- Not a user-facing sentence, and it should never be reached: every caller
  -- below already knows it is holding a duel. It is here because this function
  -- moves money on the strength of `bets.void_reason`, a column
  -- `bets_void_reason_shape` permits on a pool bet too — and a pool bet voided
  -- through here would silently acquire a reason no pool-bet surface knows how
  -- to render. `resolve_bet` is the void path for a pool bet.
  if v_kind <> 'duel' then
    raise exception
      'app.void_duel called on a pool bet (%). Pool bets are voided through public.resolve_bet.',
      p_bet_id using errcode = 'check_violation';
  end if;

  -- Idempotence is NOT wanted here. A second void would run `app.settle_bet`
  -- over the same wagers again and refund every stake twice, so this refuses
  -- loudly instead of returning an empty delta set. The callers that sweep in
  -- bulk (`app.expire_stale_duels`, `app.void_duels_for_departing_member`) take
  -- a row lock and re-check the predicate precisely so they never reach this.
  if v_state = 'resolved' then
    raise exception 'This duel is already resolved.' using errcode = 'check_violation';
  end if;

  select coalesce(
           jsonb_agg(jsonb_build_object(
             'user_id',           s.user_id,
             'balance_delta',     s.balance_delta,
             'profit_loss_delta', s.profit_loss_delta
           )),
           '[]'::jsonb
         )
    into v_deltas
    from app.settle_bet(p_bet_id, 'void', null) s;

  -- Hop 1. Only from 'open' — an accepted duel is already 'closed' and asking
  -- the trigger for closed→closed would be a no-op it short-circuits anyway,
  -- but writing the condition makes the two-hop rule legible instead of
  -- accidental.
  if v_state = 'open' then
    update public.bets
       set state = 'closed',
           closes_at = least(closes_at, now())
     where id = p_bet_id;
  end if;

  -- Hop 2. `winning_option_id` is set to null explicitly rather than left
  -- alone: `bets_resolution_shape` requires a void to carry none, and an
  -- unaccepted duel has never had one, so this is belt-and-braces against a
  -- future path that voids something after a winner was staged.
  update public.bets
     set state             = 'resolved',
         resolution_kind   = 'void',
         winning_option_id = null,
         void_reason       = p_reason,
         resolved_at       = now()
   where id = p_bet_id;

  -- Decision §4.6: settlement emits CREDITS only (both stakes left their
  -- balances at placement), so this can never take a balance negative and needs
  -- none of `delete_bet`'s overdraw machinery. And DOM-025: no `transactions`
  -- row, because a refund is not a transfer.
  --
  -- A participant who has since left the team has no row here and is simply
  -- skipped — their per-team balance died with the membership (decision §4.4),
  -- exactly as `resolve_bet` and `delete_bet` already handle the same case.
  update public.team_members m
     set coin_balance = m.coin_balance + d.balance_delta,
         profit_loss  = m.profit_loss  + d.profit_loss_delta
    from jsonb_to_recordset(v_deltas)
      as d(user_id uuid, balance_delta integer, profit_loss_delta integer)
   where m.team_id = v_team_id and m.user_id = d.user_id;

  return v_deltas;
end;
$$;
