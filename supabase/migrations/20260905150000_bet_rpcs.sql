-- =============================================================================
-- SL Fake Bets — bet & wager write paths (roadmap Phase 6).
--
-- The bet lifecycle moves off session-local state and onto Postgres. Same
-- reasoning as Phase 5's team RPCs, with one addition specific to money:
--
--  1. Atomicity. A bet is a bet row PLUS at least two option rows (DOM-007);
--     a wager is a wagers row PLUS a debit on team_members.coin_balance
--     (decision §4.6 — the stake leaves the balance at placement); deleting a
--     bet is a cascade PLUS the reversal of its money effects (DOM-033).
--     PostgREST runs one statement per transaction, so none of these can be a
--     client sequence without a halfway state that violates an invariant.
--  2. Rules RLS structurally cannot express. Two of them here:
--       * DOM-007's two-option floor is a row-count invariant across two
--         tables — no CHECK and no policy can state it. Phase 3 recorded this
--         and assigned it to this function (see the comment on bet_options).
--       * DOM-013/014/017's over-balance and over-user-max limits need the
--         member's stored balance and the SUM of their existing stakes on the
--         bet, and then have to debit that same balance. A WITH CHECK cannot
--         read one row and write another.
--  3. The coin_balance write gate. Phase 3's enforce_team_member_update_rules
--     reserves balance changes for the leader and for service context, which
--     is exactly what makes a placeWager RPC mandatory rather than a
--     preference: a member debiting their own balance through PostgREST is
--     refused by that trigger, by design.
--
-- Ownership of the RULES does not move. validation.ts (validateBetDraft,
-- validateWager), state-machine.ts (computeEffectiveState, canAcceptWagers),
-- permissions.ts (canCreateBet, canCloseBetEarly, canDeleteBet) and
-- settlement.ts (settleBet, reverseBet) stay the source of truth, and the
-- client still gates on them so a user sees the rule before submitting. The
-- functions below are their enforcement at the database boundary — every one
-- names its TypeScript counterpart and repeats its message verbatim, so a
-- server-side rejection reads exactly like the client-side one.
--
-- Why settlement math IS mirrored in SQL here, unlike Phase 5's kick/ban
-- cascade: that cascade took its verdict from the client as a list of wager
-- ids, safe because re-scoping the list to one team and one user can only
-- narrow what the cascade already permits. A list of BALANCE DELTAS has no
-- such property — narrowing is meaningless and a forged delta is free coins.
-- So `app.settle_bet` / `app.reverse_bet_effects` below are the SQL twins of
-- settlement.ts, and Phase 7's resolveBet payouts reuse the same two.
-- =============================================================================

-- --- settlement, in SQL ---------------------------------------------------------
-- settlement.ts's settleBet, verbatim in its arithmetic: a stake left the
-- balance at placement (decision §4.6), so this emits CREDITS only — winner
-- payouts or void refunds — plus the realized P/L contribution (DOM-026).
-- Never a transactions row: resolution is not a ledger event (DOM-025).
--
-- The refund branch covers BOTH of settleBet's refund cases at once, because
-- both reduce to win_total = 0: an explicit void (DOM-019), and a "winner"
-- nobody backed (with an empty winning side there is no one to redistribute
-- the pool to). p_kind = 'void' makes every win_stake zero, so the same
-- expression handles it without a second branch.
--
-- Integer math order matches the TypeScript exactly — one multiply, one
-- divide, one floor per member — so a payout computed here and a payout
-- computed by settleBet cannot differ by a coin.
create or replace function app.settle_bet(
  p_bet_id            uuid,
  p_kind              public.bet_resolution_kind,
  p_winning_option_id uuid
) returns table (
  user_id           uuid,
  balance_delta     integer,
  profit_loss_delta integer
) language sql security definer stable set search_path = '' as $$
  with stakes as (
    select
      w.user_id                                     as uid,
      sum(w.amount)::integer                        as stake,
      sum(
        case
          when p_kind = 'winner' and w.option_id = p_winning_option_id
          then w.amount else 0
        end
      )::integer                                    as win_stake
    from public.wagers w
    where w.bet_id = p_bet_id
    group by w.user_id
  ),
  totals as (
    select
      coalesce(sum(s.stake), 0)::integer     as pool,
      coalesce(sum(s.win_stake), 0)::integer as win_total
    from stakes s
  ),
  payouts as (
    select
      s.uid,
      s.stake,
      case
        when t.win_total = 0 then s.stake
        else floor(s.win_stake::numeric * t.pool / t.win_total)::integer
      end as payout,
      t.win_total
    from stakes s cross join totals t
  )
  select
    p.uid,
    p.payout,
    -- Void / no-winning-side is a refund, not an outcome: zero realized P/L.
    case when p.win_total = 0 then 0 else p.payout - p.stake end
  from payouts p;
$$;

-- settlement.ts's reverseBet (DOM-033): the deltas that undo a bet's money
-- effects entirely, so deleting it leaves balances and P/L exactly where they
-- were before its first wager. Stakes come back (they left at placement); a
-- bet that was already resolved additionally has its payouts and realized P/L
-- unwound, otherwise deleted history would silently distort standings.
--
-- Deliberately NOT the kick/ban cascade's behavior (decision §4.4): there the
-- member's whole per-team balance dies with the membership, so there is
-- nothing to refund to. Here every member stays.
create or replace function app.reverse_bet_effects(p_bet_id uuid)
returns table (
  user_id           uuid,
  balance_delta     integer,
  profit_loss_delta integer
) language plpgsql security definer stable set search_path = '' as $$
declare
  v_state  public.bet_state;
  v_kind   public.bet_resolution_kind;
  v_winner uuid;
begin
  select b.state, b.resolution_kind, b.winning_option_id
    into v_state, v_kind, v_winner
    from public.bets b
   where b.id = p_bet_id;

  -- An unresolved bet only ever moved stakes, so the reversal is the stake
  -- itself. Checked as a branch rather than folded into the query below
  -- because app.settle_bet must not be called with a null resolution kind:
  -- it would take its refund branch and look like a correct answer.
  if v_state is distinct from 'resolved' or v_kind is null then
    return query
      select w.user_id, sum(w.amount)::integer, 0
        from public.wagers w
       where w.bet_id = p_bet_id
       group by w.user_id;
    return;
  end if;

  return query
    select
      s.uid,
      (s.stake - p.balance_delta)::integer,
      -- `0 - x` for the same reason the TypeScript spells it that way: it
      -- keeps a zero positive, which a bare negation would not.
      (0 - p.profit_loss_delta)::integer
    from (
      select w.user_id as uid, sum(w.amount)::integer as stake
        from public.wagers w
       where w.bet_id = p_bet_id
       group by w.user_id
    ) s
    -- settle_bet emits a row per member with a stake, so this join is total.
    join app.settle_bet(p_bet_id, v_kind, v_winner) p on p.user_id = s.uid;
end;
$$;

-- --- create_bet -------------------------------------------------------------------
-- DOM-007/008/009/017. The two-option floor is enforced here, which is the
-- promise Phase 3 left on public.bet_options: MIN_BET_OPTIONS (validation.ts)
-- is 2, and blank labels are dropped before counting exactly as
-- validateBetDraft drops them — the create-bet form keeps empty slots around.
--
-- Returns the ids the database generated rather than a bare bet id: the client
-- needs the option ids to render pool stats (DOM-016), and `created_at` /
-- `closes_at` come back so the row on screen carries the server's clock and
-- not the browser's.

create or replace function public.create_bet(
  p_team_id            uuid,
  p_title              text,
  p_icon_emoji         text,
  p_options            text[],
  p_closes_at          timestamptz,
  p_max_wager_per_user integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid       uuid := app.require_uid();
  v_bet_id    uuid;
  v_created   timestamptz;
  v_closes    timestamptz;
  v_labels    text[];
  v_option_ids uuid[];
begin
  -- permissions.ts: canCreateBet (DOM-002) — free-for-all admits any member,
  -- restricted only moderators and the leader (A-1).
  if not app.can_create_bet(p_team_id) then
    raise exception 'Only the leader or moderators can create bets in this team.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_title is null or length(btrim(p_title)) = 0 then
    raise exception 'Give the bet a title.' using errcode = 'check_violation';
  end if;

  select coalesce(array_agg(btrim(label) order by ord), '{}'::text[])
    into v_labels
    from unnest(coalesce(p_options, '{}'::text[])) with ordinality as t(label, ord)
   where length(btrim(label)) > 0;

  -- validation.ts: MIN_BET_OPTIONS. The literal 2 is repeated here because the
  -- floor spans two tables and cannot be a constraint; the message is the one
  -- validateBetDraft produces so both sides read alike.
  if array_length(v_labels, 1) is null or array_length(v_labels, 1) < 2 then
    raise exception 'A bet needs at least 2 options.' using errcode = 'check_violation';
  end if;

  if p_closes_at is null then
    raise exception 'Pick a close time.' using errcode = 'check_violation';
  end if;
  if p_closes_at <= now() then
    raise exception 'Close time must be in the future.' using errcode = 'check_violation';
  end if;

  if p_max_wager_per_user is null or p_max_wager_per_user < 1 then
    raise exception 'Max wager per user must be at least 1.' using errcode = 'check_violation';
  end if;

  insert into public.bets (
    team_id, creator_id, title, icon_emoji, state, closes_at, max_wager_per_user
  ) values (
    p_team_id,
    v_uid,
    btrim(p_title),
    -- DOM-009: optional. An empty string is "no icon", not an icon.
    nullif(btrim(coalesce(p_icon_emoji, '')), ''),
    'open',
    p_closes_at,
    p_max_wager_per_user
  )
  returning id, created_at, closes_at into v_bet_id, v_created, v_closes;

  -- `position` is what reproduces types.ts's ordered options array from a set
  -- of rows; `with ordinality` above already fixed the order.
  with inserted as (
    insert into public.bet_options (bet_id, label, position)
    select v_bet_id, label, (ord - 1)::smallint
      from unnest(v_labels) with ordinality as t(label, ord)
    returning id, position
  )
  select array_agg(i.id order by i.position) into v_option_ids from inserted i;

  return jsonb_build_object(
    'bet_id',     v_bet_id,
    'created_at', v_created,
    'closes_at',  v_closes,
    'option_ids', to_jsonb(v_option_ids)
  );
end;
$$;

-- --- place_wager -------------------------------------------------------------------
-- DOM-013/014/016/017 + DOM-012. Every half of validateWager is checked here
-- and the debit happens in the same transaction, which is the whole reason the
-- function exists (see this file's header, point 3).
--
-- The member row is locked BEFORE the existing-stake sum is read. Both of
-- validateWager's limits are per-user, so serializing that one row is enough
-- to make them hold under concurrency: without the lock, two simultaneous
-- wagers each see the pre-wager balance and the pre-wager stake total, and
-- both pass a check that their sum violates.

create or replace function public.place_wager(
  p_bet_id    uuid,
  p_option_id uuid,
  p_amount    integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid            uuid := app.require_uid();
  v_team_id        uuid;
  v_max_per_user   integer;
  v_balance        integer;
  v_existing_stake integer;
  v_wager_id       uuid;
  v_placed_at      timestamptz;
begin
  select b.team_id, b.max_wager_per_user
    into v_team_id, v_max_per_user
    from public.bets b
   where b.id = p_bet_id;

  if v_team_id is null then
    raise exception 'This bet no longer exists.' using errcode = 'no_data_found';
  end if;

  if not app.is_team_member(v_team_id) then
    raise exception 'You are not a member of this team.' using errcode = 'insufficient_privilege';
  end if;

  -- state-machine.ts: canAcceptWagers. The EFFECTIVE state counts the clock,
  -- so a bet stored 'open' whose closes_at has passed refuses wagers even
  -- before anything persists the transition (DOM-012).
  if not app.bet_accepts_wagers(p_bet_id) then
    raise exception 'Betting is closed for this bet.' using errcode = 'check_violation';
  end if;

  if not exists (
    select 1 from public.bet_options o
     where o.id = p_option_id and o.bet_id = p_bet_id
  ) then
    raise exception 'Pick one of the bet''s options.' using errcode = 'check_violation';
  end if;

  -- validation.ts: validateWager's amount-invalid case, which short-circuits
  -- the other two there as well.
  if p_amount is null or p_amount < 1 then
    raise exception 'Wager must be a positive whole amount.' using errcode = 'check_violation';
  end if;

  select m.coin_balance into v_balance
    from public.team_members m
   where m.team_id = v_team_id and m.user_id = v_uid
     for update;

  select coalesce(sum(w.amount), 0)::integer into v_existing_stake
    from public.wagers w
   where w.bet_id = p_bet_id and w.user_id = v_uid;

  -- DOM-017 caps the user's TOTAL stake on the bet, not each wager, otherwise
  -- repeat wagers bypass it trivially.
  if p_amount + v_existing_stake > v_max_per_user then
    raise exception 'Max % per user on this bet.', v_max_per_user
      using errcode = 'check_violation';
  end if;

  -- DOM-014: never over balance. The coin_balance >= 0 CHECK is the backstop
  -- if this ever gets out of the way; this is the readable sentence.
  if p_amount > v_balance then
    raise exception 'Not enough coins.' using errcode = 'check_violation';
  end if;

  -- Decision §4.6: the stake leaves the balance at placement and is NOT a
  -- ledger event, so this is a bare debit and not app.apply_transaction.
  update public.team_members
     set coin_balance = coin_balance - p_amount
   where team_id = v_team_id and user_id = v_uid;

  insert into public.wagers (bet_id, option_id, user_id, amount)
  values (p_bet_id, p_option_id, v_uid, p_amount)
  returning id, placed_at into v_wager_id, v_placed_at;

  return jsonb_build_object(
    'wager_id',      v_wager_id,
    'placed_at',     v_placed_at,
    'balance_after', v_balance - p_amount
  );
end;
$$;

-- --- close_bet_early ---------------------------------------------------------------
-- DOM-011 + DOM-012. Two columns move together and that pairing is the reason
-- this is a function rather than a one-row PATCH: closes_at IS the moment
-- open→closed happened, so an early close moves it to now() and every
-- countdown and "closed Xm ago" stays honest. A client able to update `bets`
-- directly could set one without the other.
--
-- Returns the timestamp it wrote, so the client's local copy carries the
-- server's clock rather than the browser's.

create or replace function public.close_bet_early(p_bet_id uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := app.require_uid();
  v_state  public.bet_state;
  v_closes timestamptz;
  v_now    timestamptz := now();
begin
  select b.state, b.closes_at into v_state, v_closes
    from public.bets b
   where b.id = p_bet_id;

  if v_state is null then
    raise exception 'This bet no longer exists.' using errcode = 'no_data_found';
  end if;

  -- permissions.ts: canCloseBetEarly (DOM-011) — creator, moderator, leader.
  if not app.can_manage_bet(p_bet_id) then
    raise exception 'Only the bet creator or a moderator can close betting early.'
      using errcode = 'insufficient_privilege';
  end if;

  -- state-machine.ts's computeEffectiveState, then validation.ts's
  -- canTransitionBetState: only an effectively-open bet can be closed. A
  -- stored-open bet past its closes_at is already closed and needs nothing.
  if v_state = 'resolved' then
    raise exception 'This bet is already resolved.' using errcode = 'check_violation';
  end if;
  if v_state = 'closed' or v_closes <= v_now then
    raise exception 'Betting is already closed.' using errcode = 'check_violation';
  end if;

  update public.bets
     set state = 'closed', closes_at = v_now
   where id = p_bet_id
  returning closes_at into v_closes;

  return v_closes;
end;
$$;

-- --- delete_bet ---------------------------------------------------------------------
-- DOM-033/034 hard delete. The bet, its options, its wagers and its comments go
-- by ON DELETE CASCADE; what cannot cascade is the money, so the reversal
-- (app.reverse_bet_effects) is applied first and returned to the caller.
--
-- Returning the deltas is not a convenience: the client patches the balances it
-- is showing, and taking them from here rather than recomputing locally means
-- the screen shows what the database actually did.

create or replace function public.delete_bet(p_bet_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid      uuid := app.require_uid();
  v_team_id  uuid;
  v_deltas   jsonb;
  v_overdrawn uuid;
begin
  select b.team_id into v_team_id from public.bets b where b.id = p_bet_id;

  if v_team_id is null then
    raise exception 'This bet no longer exists.' using errcode = 'no_data_found';
  end if;

  -- permissions.ts: canDeleteBet (DOM-033) — the same set that closes it.
  if not app.can_manage_bet(p_bet_id) then
    raise exception 'Only the bet creator or a moderator can delete this bet.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Materialized as jsonb rather than read three times: the reversal must be
  -- computed BEFORE the cascade removes the wagers it is derived from, and the
  -- same set is then checked, applied, and returned.
  select coalesce(
           jsonb_agg(jsonb_build_object(
             'user_id',           r.user_id,
             'balance_delta',     r.balance_delta,
             'profit_loss_delta', r.profit_loss_delta
           )),
           '[]'::jsonb
         )
    into v_deltas
    from app.reverse_bet_effects(p_bet_id) r;

  -- Unwinding a resolved bet subtracts a payout that its winner may already
  -- have staked elsewhere, and DOM-014 forbids a negative balance. The spec
  -- does not say what should happen, so nothing silently does: the delete is
  -- refused with a sentence instead of failing on the CHECK constraint.
  select m.user_id into v_overdrawn
    from jsonb_to_recordset(v_deltas)
      as d(user_id uuid, balance_delta integer, profit_loss_delta integer)
    join public.team_members m
      on m.team_id = v_team_id and m.user_id = d.user_id
   where m.coin_balance + d.balance_delta < 0
   limit 1;

  if v_overdrawn is not null then
    raise exception
      'Deleting this bet would take a member below zero coins — its payout has already been spent.'
      using errcode = 'check_violation';
  end if;

  -- A wagerer who has since left the team has no row to patch (their wagers on
  -- resolved bets survive the kick cascade by design, decision §4.4), so this
  -- simply matches nothing for them — exactly as applyDeltas does on the client.
  update public.team_members m
     set coin_balance = m.coin_balance + d.balance_delta,
         profit_loss  = m.profit_loss  + d.profit_loss_delta
    from jsonb_to_recordset(v_deltas)
      as d(user_id uuid, balance_delta integer, profit_loss_delta integer)
   where m.team_id = v_team_id and m.user_id = d.user_id;

  delete from public.bets where id = p_bet_id;

  return v_deltas;
end;
$$;

-- --- reach -----------------------------------------------------------------------------
-- Same shape as Phase 5: the `public.` functions are the API surface
-- (/rest/v1/rpc/<name>), the app.* helpers stay unreachable because `app` is
-- not in config.toml's api.schemas. EXECUTE is revoked from PUBLIC first so a
-- definer function is never callable by a role nobody named.

revoke execute on function
  public.create_bet(uuid, text, text, text[], timestamptz, integer),
  public.place_wager(uuid, uuid, integer),
  public.close_bet_early(uuid),
  public.delete_bet(uuid)
from public;

grant execute on function
  public.create_bet(uuid, text, text, text[], timestamptz, integer),
  public.place_wager(uuid, uuid, integer),
  public.close_bet_early(uuid),
  public.delete_bet(uuid)
to authenticated;

grant execute on all functions in schema app to authenticated, anon;

-- =============================================================================
-- Policy tightening (roadmap Phase 6, task 2).
--
-- Every write path withdrawn below is now owned by a function above. As in
-- Phase 5, leaving the direct policy in place would not be redundancy — it
-- would be a second, weaker path to the same rows.
-- =============================================================================

-- bets INSERT   → create_bet (a bet with fewer than two options is not a bet).
-- bets UPDATE   → close_bet_early, and Phase 7's resolve_bet. Withdrawn as a
--                 client write because DOM-012's state change is never a
--                 single column: closing pairs state with closes_at, resolving
--                 pairs it with resolution_kind + winning_option_id and with
--                 every member's balance. The transition trigger polices the
--                 ORDER of states; it cannot police the accompanying columns.
-- bets DELETE   → delete_bet (DOM-033: no delete without the money reversal).
drop policy if exists bets_insert_per_access_mode on public.bets;
drop policy if exists bets_update_creator_or_moderator on public.bets;
drop policy if exists bets_delete_creator_or_moderator on public.bets;
revoke insert, update, delete on public.bets from authenticated;

-- bet_options: all three writes → create_bet. Options are created with their
-- bet and never edited afterwards — a label or position changing under a live
-- pool would rewrite what members already priced their wagers against, and
-- deleting one would strand its wagers' composite foreign key.
drop policy if exists bet_options_insert_bet_manager on public.bet_options;
drop policy if exists bet_options_update_bet_manager on public.bet_options;
drop policy if exists bet_options_delete_bet_manager on public.bet_options;
revoke insert, update, delete on public.bet_options from authenticated;

-- wagers INSERT → place_wager. Phase 3's policy was explicitly "the floor, not
-- the whole rule": it could check ownership, membership and the clock, but not
-- the balance or the per-user max, and could not perform the debit.
-- wagers DELETE → remove_membership (the kick/ban cascade, DOM-032) and
-- delete_bet's cascade. Withdrawn for the same reason team_members DELETE was
-- in Phase 5: a direct delete destroys a member's stake with no refund and no
-- cascade decision behind it.
drop policy if exists wagers_insert_own_on_open_bet on public.wagers;
drop policy if exists wagers_delete_moderator_or_leader on public.wagers;
revoke insert, delete on public.wagers from authenticated;

-- SELECT policies on all three tables stay exactly as Phase 3 wrote them:
-- membership-scoped reads are what loadTeamData relies on, and UX-015 needs
-- the whole team to see every wager on a bet.
