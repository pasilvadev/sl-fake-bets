-- =============================================================================
-- SL Fake Bets — login rewards retune: daily goes to 10, weekly reward is born
-- (owner order, 2026-09-09).
--
-- Two changes, one migration:
--
--  1. `app.daily_reward_coins()` returns 10, not 5. DOM-022/A-2's shape is
--     unchanged — unconditional, once per (user, team, calendar day in UTC),
--     granted lazily on team load — only the number moves.
--  2. A new weekly reward, same shape one order of magnitude up: 100 coins,
--     once per (user, team, calendar WEEK in UTC), granted lazily on team
--     load exactly like the daily one (DOM-022 / A-2 / roadmap decision §4.3,
--     extended to a second cadence). "Week" here is Postgres's own meaning of
--     `date_trunc('week', …)` — ISO 8601, Monday 00:00 UTC start — not a
--     rolling 7-day window and not a Sunday-start week. It is a NEW ledger
--     kind, `'weekly-reward'` (grown onto `public.transaction_kind` by the
--     migration immediately before this one, for the "unsafe use of new
--     value" reason that file's own header explains), and idempotence is,
--     again, not a `select … if not exists` race: a partial unique index is
--     the arbiter, mirrored field-for-field from
--     `transactions_one_daily_reward_per_day_idx` at the coarser grain.
--
-- DUPLICATED CONSTANT, WATCH BOTH HALVES
--
-- `packages/shared/src/config.ts`'s `CONFIG.DAILY_REWARD_COINS` and the new
-- `CONFIG.WEEKLY_REWARD_COINS` are the product's source of truth — they are
-- what a person reads in the UI before either reward is claimed. The two SQL
-- functions below are nonetheless the AUTHORITY, for the same reason
-- `app.daily_reward_coins()` already was one: the amount has to be decided
-- inside the very transaction that writes the ledger row, a place TypeScript
-- cannot reach. Whoever retunes either number again must change both halves —
-- the TS constant and this file's function — in the same commit, or the UI
-- will preview an amount the database does not grant.
-- =============================================================================

-- --- shared constants ----------------------------------------------------------

-- Retuned per owner order 2026-09-09. Was 5 (20260905170000_resolution_rewards_ledger.sql).
create or replace function app.daily_reward_coins()
returns integer language sql immutable set search_path = '' as $$
  select 10;
$$;

-- New per owner order 2026-09-09. Same duplicated-constant warning above.
create or replace function app.weekly_reward_coins()
returns integer language sql immutable set search_path = '' as $$
  select 100;
$$;

-- --- transactions_one_weekly_reward_per_week_idx --------------------------------
-- Decision §4.3 (extended): the weekly reward is per (user, team, calendar
-- week), and UTC is the calendar — same reasoning as
-- `transactions_one_daily_reward_per_day_idx` above it, one grain coarser.
-- Indexability, proven the same way that index's own comment proves it:
--   * `timezone(text, timestamptz)` → `timestamp without time zone` is
--     IMMUTABLE — the daily index already relies on exactly this, and it is
--     what turns a session-local instant into a UTC wall-clock value.
--   * `date_trunc(text, timestamp without time zone)` is IMMUTABLE — unlike
--     the `timestamptz` overload (which depends on the session's `TimeZone`
--     setting and is only STABLE), the argument here has already been pinned
--     to UTC by the `timezone()` call above, so this overload applies and
--     carries no session dependency.
--   * The trailing `::date` cast off a `timestamp without time zone` is
--     immutable for the same reason the daily index's own cast is.
--   * `date_trunc('week', …)` starts weeks on Monday — Postgres's ISO 8601
--     definition of "week" — which is the definition this migration's header
--     names as the one in force here; there is no other "week" competing
--     with it anywhere in this schema.
create unique index transactions_one_weekly_reward_per_week_idx
  on public.transactions (
    team_id,
    user_id,
    (date_trunc('week', timezone('UTC', created_at))::date)
  )
  where kind = 'weekly-reward';

-- --- claim_weekly_reward ---------------------------------------------------------
-- Line-for-line mirror of `claim_daily_reward` (20260905170000_...) at the
-- weekly grain — same membership check, same optimise-then-let-the-index-win
-- shape, same jsonb contract (`{granted: false}`, or the five-field success
-- object the client's `parseLoginReward` reads for both). Re-explaining why,
-- rather than only citing the twin: DOM-022 / A-2 / decision §4.3 is
-- unconditional, once per (user, team, calendar week in UTC), granted lazily
-- whenever the team loads.
--
-- The `exists` below is an optimisation, not the rule: it saves a write on
-- the overwhelmingly common non-first call of the week. The RULE is
-- `transactions_one_weekly_reward_per_week_idx`, and the handler under it is
-- what makes two simultaneous loads grant one reward rather than two — the
-- failed attempt's balance move rolls back with its subtransaction, so a
-- caught duplicate leaves nothing behind. Both the `exists` check and the
-- post-grant re-select use the SAME expression the index is built on —
-- `date_trunc('week', timezone('UTC', t.created_at))::date` — so the row this
-- function later reads back is provably the one the index would also match.

create or replace function public.claim_weekly_reward(p_team_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid           uuid := app.require_uid();
  v_week          date := date_trunc('week', timezone('UTC', now()))::date;
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
       and t.kind = 'weekly-reward'
       and date_trunc('week', timezone('UTC', t.created_at))::date = v_week
  ) then
    return jsonb_build_object('granted', false);
  end if;

  begin
    v_balance_after := app.apply_transaction(
      p_team_id, v_uid, 'weekly-reward',
      app.weekly_reward_coins(), 'Weekly login reward'
    );
  exception when unique_violation then
    -- Another tab won the race. Its row is the one that counts.
    return jsonb_build_object('granted', false);
  end;

  select t.id, t.created_at into v_tx_id, v_created_at
    from public.transactions t
   where t.team_id = p_team_id
     and t.user_id = v_uid
     and t.kind = 'weekly-reward'
     and date_trunc('week', timezone('UTC', t.created_at))::date = v_week;

  return jsonb_build_object(
    'granted',        true,
    'transaction_id', v_tx_id,
    'amount',         app.weekly_reward_coins(),
    'balance_after',  v_balance_after,
    'created_at',     v_created_at
  );
end;
$$;

-- --- the ledger comment, restated ------------------------------------------------

comment on table public.transactions is
  'DOM-025 transfer ledger: grants, daily and weekly rewards, leader injections (donation reserved for DOM-023). DOM-026/decision §4.6: wager stakes and payouts are NOT rows here. Append-only — RLS grants no UPDATE or DELETE to anyone.';

-- --- reach -------------------------------------------------------------------------
-- Same belt-and-braces shape `20260907150000_invite_links.sql` used, named
-- `anon` first: this schema's ALTER DEFAULT PRIVILEGES grants EXECUTE to
-- anon/authenticated/service_role BY NAME at create time, so
-- `revoke ... from public` alone would not strip anon's own named grant.
--
-- `app.weekly_reward_coins()` gets no revoke/grant statement here, on
-- purpose: it keeps the Data-API default grants a fresh `app` function
-- receives at CREATE time, exactly like `app.daily_reward_coins()` before it
-- (`app` is not in config.toml's `api.schemas`, so PostgREST cannot route to
-- either regardless). That is what `scripts/supabase-privilege-audit.sql`'s
-- roster expects for both: an entry with no matching `function_exceptions`
-- row, not a revoke.
revoke execute on function public.claim_weekly_reward(uuid) from public, anon;

grant execute on function public.claim_weekly_reward(uuid) to authenticated;
