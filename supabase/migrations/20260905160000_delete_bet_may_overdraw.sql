-- =============================================================================
-- Deleting a resolved bet may take a balance negative — owner ruling,
-- 2026-09-05, overruling the refusal Phase 6 shipped hours earlier.
--
-- Unwinding a resolved bet has to claw back a payout the winner may already
-- have staked or lost elsewhere. Phase 6 refused the delete in that case,
-- because DOM-014 says "no negative balance" and the roadmap's scope-creep
-- exclusion list (risk #7) named negative balances as out of scope. The owner
-- has ruled the other way: the delete always wins, and THIS is the one
-- situation where a negative balance is warranted.
--
-- Two things make that a narrow change rather than a licence:
--
--  1. DOM-014's stated mechanism is untouched. The requirement reads "no
--     negative balance: wager input validated/capped at current team balance",
--     and that is exactly what still holds — `place_wager` compares the stake
--     against the stored balance, so a member at −20 can place nothing until
--     they are positive again. What the ruling permits is a balance driven
--     negative by an ADMINISTRATIVE act, never by the member's own betting.
--  2. The permission is granted to one statement, not to the schema. The
--     `coin_balance >= 0` CHECK cannot be conditional, so it becomes a trigger
--     with a single escape hatch: a transaction-local GUC that only
--     `delete_bet` sets, and that it clears again immediately. Every other
--     path — place_wager, app.apply_transaction, a direct client write, the
--     seed, Studio — still hits an absolute floor of zero.
--
-- Recovery is the leader's: an injection (DOM-024) credits a negative balance
-- back up, and does NOT have to clear the whole debt in one go. Which is why
-- the trigger's real rule is "never create or deepen an overdraft" rather than
-- "never negative", and why the ledger has to be able to record a negative
-- snapshot at all (both below).
-- =============================================================================

-- --- team_members.coin_balance: CHECK → trigger ---------------------------------

alter table public.team_members
  drop constraint team_members_coin_balance_check;

-- SECURITY INVOKER (the default), and load-bearing for the reason the Phase 3
-- invariants file spells out: a definer trigger runs as `postgres`, which is
-- the wrong basis for any decision about who the caller is. This one does not
-- ask who the caller is at all — it asks whether the *statement* declared
-- itself an overdraw — but keeping invoker rights keeps the file's rule
-- uniform: write-gating triggers are never SECURITY DEFINER.
create or replace function public.enforce_non_negative_balance()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.coin_balance >= 0 then
    return new;
  end if;

  -- The sanctioned overdraw. Set with is_local => true, so it cannot outlive
  -- the transaction, and cleared by delete_bet the moment its UPDATE returns.
  -- PostgREST gives a client no way to set an arbitrary GUC, so the only
  -- caller that can open this door is SQL running inside the database.
  if coalesce(current_setting('app.allow_negative_balance', true), 'off') = 'on' then
    return new;
  end if;

  -- Repayment. Once a member IS overdrawn, the leader's injection (DOM-024) is
  -- the only way out, and it must not have to clear the whole debt in one go —
  -- so a still-negative result is legal as long as it is strictly closer to
  -- zero. The rule this trigger actually enforces is therefore not "never
  -- negative" but "never CREATE or DEEPEN an overdraft", which is the same
  -- thing for every balance that starts at zero or above.
  if tg_op = 'UPDATE' and new.coin_balance > old.coin_balance then
    return new;
  end if;

  raise exception
    'DOM-014: a coin balance cannot be taken negative (%). Only deleting a resolved bet may overdraw one.',
    new.coin_balance
    using errcode = 'check_violation';
end;
$$;

create trigger team_members_enforce_non_negative_balance
  before insert or update on public.team_members
  for each row execute function public.enforce_non_negative_balance();

comment on column public.team_members.coin_balance is
  'DOM-013/014. Mutated only via settlement/ledger paths, never a raw client write (see the update trigger). team_members_enforce_non_negative_balance keeps this from being taken negative; the one thing that may overdraw it is delete_bet clawing back a resolved bet''s payout (owner ruling 2026-09-05), and only a repayment toward zero may leave it negative afterwards.';

-- --- transactions.balance_after: the snapshot must be able to tell the truth ---
-- `balance_after` is a snapshot of coin_balance immediately after the entry,
-- and DOM-025 wants the ledger auditable. Once a balance can be negative, a
-- CHECK forbidding a negative snapshot would block the very rows that dig a
-- member out: a leader injecting 10 into a −20 balance produces −10, which is
-- both true and an improvement. The debit guard the CHECK used to imply moves
-- into app.apply_transaction below, where it belongs — it was always a rule
-- about the MOVE, not about the snapshot.

alter table public.transactions
  drop constraint transactions_balance_after_check;

comment on column public.transactions.balance_after is
  'Snapshot of coin_balance immediately after this entry — negative when the entry credits a member who was overdrawn by a resolved-bet deletion. app.apply_transaction computes the pair together so they cannot drift.';

-- --- app.apply_transaction: guard the debit, not the snapshot -------------------
-- ledger.ts's applyTransaction, unchanged except for the guard the dropped
-- CHECK used to provide implicitly. A CREDIT onto a negative balance is always
-- allowed: it can only move the member toward zero. A DEBIT (donations,
-- DOM-023, reserved) may never be what takes a balance below zero.

create or replace function app.apply_transaction(
  p_team_id     uuid,
  p_user_id     uuid,
  p_kind        public.transaction_kind,
  p_amount      integer,
  p_description text
) returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_balance_before integer;
  v_balance_after  integer;
begin
  if p_amount = 0 then
    raise exception 'Transaction amount must be a non-zero integer'
      using errcode = 'check_violation';
  end if;

  select m.coin_balance into v_balance_before
    from public.team_members m
   where m.team_id = p_team_id and m.user_id = p_user_id
     for update;

  if not found then
    raise exception 'That member is not on this team.' using errcode = 'no_data_found';
  end if;

  v_balance_after := v_balance_before + p_amount;

  -- The debit half of DOM-014. Note it compares the RESULT, not the sign of
  -- the starting balance: a credit that leaves the member still negative is
  -- fine, a debit that creates or deepens a negative balance is not.
  if p_amount < 0 and v_balance_after < 0 then
    raise exception 'DOM-014: that would take the balance below zero.'
      using errcode = 'check_violation';
  end if;

  update public.team_members
     set coin_balance = v_balance_after
   where team_id = p_team_id and user_id = p_user_id;

  insert into public.transactions (team_id, user_id, kind, amount, description, balance_after)
  values (p_team_id, p_user_id, p_kind, p_amount, p_description, v_balance_after);

  return v_balance_after;
end;
$$;

-- --- delete_bet: apply the reversal, overdraw allowed ----------------------------
-- Same function as Phase 6 shipped, minus the pre-check that refused the whole
-- delete when a member could not afford to give a payout back. DOM-033/034 is
-- unconditional now: the bet goes, the money unwinds, and a member who spent a
-- payout they should not have had ends up owing it.

create or replace function public.delete_bet(p_bet_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := app.require_uid();
  v_team_id uuid;
  v_deltas  jsonb;
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

  -- Materialized as jsonb rather than read twice: the reversal must be
  -- computed BEFORE the cascade removes the wagers it is derived from, and the
  -- same set is then applied and returned.
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

  -- The one sanctioned overdraw (owner ruling 2026-09-05 — see this file's
  -- header). Opened for this statement and closed again straight after, so a
  -- later statement in the same transaction cannot ride on it.
  perform set_config('app.allow_negative_balance', 'on', true);

  -- A wagerer who has since left the team has no row to patch (their wagers on
  -- resolved bets survive the kick cascade by design, decision §4.4), so this
  -- simply matches nothing for them — exactly as applyDeltas does on the client.
  update public.team_members m
     set coin_balance = m.coin_balance + d.balance_delta,
         profit_loss  = m.profit_loss  + d.profit_loss_delta
    from jsonb_to_recordset(v_deltas)
      as d(user_id uuid, balance_delta integer, profit_loss_delta integer)
   where m.team_id = v_team_id and m.user_id = d.user_id;

  perform set_config('app.allow_negative_balance', 'off', true);

  delete from public.bets where id = p_bet_id;

  return v_deltas;
end;
$$;
