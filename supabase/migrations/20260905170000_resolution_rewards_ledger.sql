-- =============================================================================
-- SL Fake Bets — resolution payouts, the daily reward, and the last direct
-- balance write (roadmap Phase 7, tasks 1–3).
--
-- Three things move into Postgres here, and they are the last money paths that
-- were not already there:
--
--  1. `resolve_bet`. Resolution is DOM-012's second transition PLUS every
--     wagerer's coin_balance and profit_loss, and per decision §4.6 it writes
--     NO ledger row — a payout is not a transfer. The settlement math is not
--     re-derived: it calls app.settle_bet, the SQL twin of settlement.ts that
--     Phase 6 already wrote for delete_bet's reversal, so a payout and its
--     later unwinding can never disagree by a coin.
--  2. `claim_daily_reward`. DOM-022 / decision §4.3: once per (user, team,
--     calendar day), granted lazily on team load. Idempotence is not a
--     `select … if not exists` race — the Phase 3 partial unique index is the
--     arbiter and the duplicate is caught, so two tabs opening together grant
--     one reward.
--  3. The leader self-credit hole. Phase 6 recorded it and Phase 7 owns it:
--     DOM-024 lets the leader move balances, so the Phase 3 column trigger
--     admitted a leader's direct PATCH of coin_balance — which writes no
--     `transactions` row and so escapes DOM-025's ledger entirely. The trigger
--     below no longer asks WHO is changing the balance; it refuses the change
--     outright outside service context. `inject_coins` (DOM-024) is the
--     leader's path, and it goes through app.apply_transaction like every
--     other credit.
--
-- After this file the only writers of team_members.coin_balance are
-- app.apply_transaction (ledger), place_wager (the stake debit, §4.6),
-- resolve_bet (payouts) and delete_bet (the reversal). `role` is the only
-- column a direct client UPDATE can still touch.
-- =============================================================================

-- --- shared constants ----------------------------------------------------------
-- DOM-022 / A-2. config.ts's CONFIG.DAILY_REWARD_COINS is the product source of
-- truth; this mirrors it for the same reason app.onboarding_grant_coins() does
-- — the grant has to be decided inside the transaction that writes it, where
-- TypeScript cannot reach. Third and last such duplication. Keep them in sync.
create or replace function app.daily_reward_coins()
returns integer language sql immutable set search_path = '' as $$
  select 5;
$$;

-- --- resolve_bet ----------------------------------------------------------------
-- DOM-016/018/019 + DOM-012 + DOM-026.
--
-- Why the open→closed step is here: computeEffectiveState (state-machine.ts)
-- treats a stored-'open' bet past its closes_at as closed, and the resolve panel
-- appears on that basis — but nothing has PERSISTED the transition, and the
-- DOM-012 trigger will not allow open→resolved. So the clock's transition is
-- written first, as its own UPDATE, and closes_at is left alone: it already
-- holds the moment the bet closed, which is exactly what DOM-012 says it is.
-- (close_bet_early moves closes_at because there the close is happening NOW.)

create or replace function public.resolve_bet(
  p_bet_id            uuid,
  p_kind              public.bet_resolution_kind,
  p_winning_option_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := app.require_uid();
  v_team_id uuid;
  v_state   public.bet_state;
  v_closes  timestamptz;
  v_deltas  jsonb;
begin
  select b.team_id, b.state, b.closes_at
    into v_team_id, v_state, v_closes
    from public.bets b
   where b.id = p_bet_id;

  if v_team_id is null then
    raise exception 'This bet no longer exists.' using errcode = 'no_data_found';
  end if;

  -- permissions.ts: canResolveBet (DOM-018/019) — creator, moderator, leader.
  if not app.can_manage_bet(p_bet_id) then
    raise exception 'Only the bet creator or a moderator can resolve this bet.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_state = 'resolved' then
    raise exception 'This bet is already resolved.' using errcode = 'check_violation';
  end if;

  if v_state = 'open' then
    if v_closes > now() then
      raise exception 'Close betting before resolving.' using errcode = 'check_violation';
    end if;
    -- The clock's own open→closed, finally written down.
    update public.bets set state = 'closed' where id = p_bet_id;
  end if;

  if p_kind is null then
    raise exception 'Pick a winning option or void the bet.' using errcode = 'check_violation';
  end if;

  -- DOM-018: the winner must be one of THIS bet's options. DOM-019's void
  -- carries no option at all, and a stray one would end up stored next to a
  -- 'void' resolution_kind where toResolution can never read it.
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

  -- Computed BEFORE the resolution columns land, purely so the two reads of
  -- the same truth cannot be separated by a concurrent write; settle_bet reads
  -- only `wagers`, which this function never touches.
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
         winning_option_id = p_winning_option_id
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

-- --- claim_daily_reward ----------------------------------------------------------
-- DOM-022 / A-2 / decision §4.3: unconditional, once per (user, team, calendar
-- day in UTC), granted lazily whenever the team loads.
--
-- The `exists` below is an optimisation, not the rule: it saves a write on the
-- overwhelmingly common second call of the day. The RULE is
-- transactions_one_daily_reward_per_day_idx, and the handler under it is what
-- makes two simultaneous loads grant one reward rather than two — the failed
-- attempt's balance move rolls back with its subtransaction, so a caught
-- duplicate leaves nothing behind.

create or replace function public.claim_daily_reward(p_team_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid           uuid := app.require_uid();
  v_today         date := timezone('UTC', now())::date;
  v_balance_after integer;
  v_tx_id         uuid;
  v_created_at    timestamptz;
begin
  if not app.is_team_member(p_team_id) then
    raise exception 'You are not a member of this team.'
      using errcode = 'insufficient_privilege';
  end if;

  if exists (
    select 1 from public.transactions t
     where t.team_id = p_team_id
       and t.user_id = v_uid
       and t.kind = 'daily-reward'
       and timezone('UTC', t.created_at)::date = v_today
  ) then
    return jsonb_build_object('granted', false);
  end if;

  begin
    v_balance_after := app.apply_transaction(
      p_team_id, v_uid, 'daily-reward',
      app.daily_reward_coins(), 'Daily login reward'
    );
  exception when unique_violation then
    -- Another tab won the race. Its row is the one that counts.
    return jsonb_build_object('granted', false);
  end;

  select t.id, t.created_at into v_tx_id, v_created_at
    from public.transactions t
   where t.team_id = p_team_id
     and t.user_id = v_uid
     and t.kind = 'daily-reward'
     and timezone('UTC', t.created_at)::date = v_today;

  return jsonb_build_object(
    'granted',        true,
    'transaction_id', v_tx_id,
    'amount',         app.daily_reward_coins(),
    'balance_after',  v_balance_after,
    'created_at',     v_created_at
  );
end;
$$;

-- --- the last direct balance write, closed ----------------------------------------
-- Phase 3 wrote this trigger to give RLS the column granularity DOM-024 needs:
-- "the leader may change a coin balance, a moderator may not". That sentence is
-- true of the PRODUCT rule and was the wrong enforcement, because DOM-025 also
-- requires every balance move to leave an auditable ledger row and a direct
-- PATCH leaves none. The leader's legitimate power (DOM-024) is not removed —
-- it moves entirely to `inject_coins`, which does both halves atomically.
--
-- Same SECURITY INVOKER reasoning as the original: as DEFINER this would run as
-- `postgres` and app.is_service_context() would be true for every caller,
-- disarming the whole trigger.

create or replace function public.enforce_team_member_update_rules()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Seed, Studio, service_role, and the definer RPCs: create_team /
  -- join_team_with_code (the onboarding grant), place_wager (the stake debit),
  -- resolve_bet (payouts), delete_bet (the reversal), app.apply_transaction
  -- (every ledger credit, inject_coins included).
  if app.is_service_context() then
    return new;
  end if;

  if new.team_id <> old.team_id or new.user_id <> old.user_id then
    raise exception 'team_members identity (team_id, user_id) is immutable'
      using errcode = 'check_violation';
  end if;

  if new.joined_at <> old.joined_at then
    raise exception 'joined_at is immutable' using errcode = 'check_violation';
  end if;

  -- DOM-024 + DOM-025 together. Previously this admitted the leader, which let
  -- a leader credit themself with no `transactions` row behind it — the hole
  -- Phase 6 found and this task owns. Injection is still leader-only; it is
  -- just no longer expressible as a bare column write.
  if new.coin_balance <> old.coin_balance then
    raise exception
      'DOM-025: coin balances move only through the coin RPCs (inject_coins, place_wager, resolve_bet, delete_bet), never a direct write'
      using errcode = 'insufficient_privilege';
  end if;

  -- DOM-026: realized P/L is an outcome of resolution (DOM-018/019) and of a
  -- deletion unwinding one (DOM-033) — never a free-form edit, by anyone.
  if new.profit_loss <> old.profit_loss then
    raise exception 'DOM-026: profit/loss changes only through bet resolution'
      using errcode = 'insufficient_privilege';
  end if;

  -- DOM-003/DOM-031: role management is a moderator/leader power (A-1), and
  -- with the two columns above closed it is the ONLY thing a direct client
  -- UPDATE on this table can still do — which is what narrows the
  -- team_members_update_moderator_or_leader policy to its intended scope.
  if new.role <> old.role and not app.is_moderator_or_leader(old.team_id) then
    raise exception 'DOM-003: only a moderator or the leader may change a member role'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

comment on policy team_members_update_moderator_or_leader on public.team_members is
  'DOM-003/031 role management. Effectively role-only: enforce_team_member_update_rules refuses every other column to a direct client write (Phase 7, task 3).';

-- --- reach -------------------------------------------------------------------------
-- As in Phases 5 and 6: `public.` functions are the PostgREST surface, `app.*`
-- stays unreachable, and EXECUTE is revoked from PUBLIC before it is granted.

revoke execute on function
  public.resolve_bet(uuid, public.bet_resolution_kind, uuid),
  public.claim_daily_reward(uuid)
from public;

grant execute on function
  public.resolve_bet(uuid, public.bet_resolution_kind, uuid),
  public.claim_daily_reward(uuid)
to authenticated;

grant execute on all functions in schema app to authenticated, anon;

-- Comments stay a direct client write (comments_insert_own / comments_delete_own,
-- Phase 3): a comment is one row, touches no money, and DOM-030 forbids the
-- moderation surface that would be the only reason to funnel it through an RPC.
