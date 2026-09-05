-- =============================================================================
-- SL Fake Bets — team & membership write paths (roadmap Phase 5).
--
-- Everything that mutates a team's SHAPE (creation, joining, kick/ban, leaving,
-- coin injection) moves out of client-issued table writes and into the
-- SECURITY DEFINER functions below, and the matching client-write policies are
-- withdrawn at the bottom of this file. Three reasons, in order of weight:
--
--  1. Atomicity. Every one of these operations spans several rows in several
--     tables (team + founding membership + grant + invite code; membership +
--     ledger row; wager cascade + ban row + membership delete). PostgREST runs
--     one statement per transaction, so a client sequence can strand the
--     database halfway — and two of the Phase 3 invariants are DEFERRABLE
--     constraint triggers that only pass when the whole set lands together.
--  2. Rules RLS structurally cannot express. Phase 3 recorded this for joining:
--     a policy cannot see whether the caller actually holds an invite code, so
--     a self-insert policy would have meant "anyone who learns a team uuid can
--     join it". `join_team_with_code` is the promised fix.
--  3. Balance/ledger coherence. `balance_after` is a snapshot taken AFTER the
--     balance moves (ledger.ts's applyTransaction computes the pair together).
--     Only a single transaction can produce the two without drift.
--
-- Ownership of the RULES themselves does not move: packages/shared's
-- permissions.ts / validation.ts / settlement.ts stay the source of truth and
-- the client still gates on them. These functions are the enforcement at the
-- database boundary, exactly as the app.* helpers are for RLS.
--
-- One rule is genuinely NOT duplicated here: the kick/ban wager cascade
-- (DOM-032, decision §4.4). Which wagers a removal drops is settlement.ts's
-- `removeMemberWagersInTeam`, so `remove_membership` takes the resulting id
-- list as an argument and only applies it — scoped to that team and that user,
-- so a forged list cannot reach anything the cascade would not.
-- =============================================================================

-- --- shared constants ---------------------------------------------------------

-- DOM-021 / decision §4.2. config.ts's CONFIG.ONBOARDING_GRANT_COINS is the
-- product source of truth; this mirrors it because the grant has to be applied
-- inside the same transaction as the membership, where TypeScript cannot reach.
-- Second (and last) place a config.ts value is duplicated in SQL, after the
-- name-color palette default in the Phase 4 profile trigger. Keep them in sync.
create or replace function app.onboarding_grant_coins()
returns integer language sql immutable set search_path = '' as $$
  select 100;
$$;

-- ledger.ts's applyTransaction, as one atomic step: move the stored balance and
-- write the row whose balance_after snapshots it. Every credit in the app goes
-- through here so the two can never disagree (DOM-025/026, decision §4.6).
create or replace function app.apply_transaction(
  p_team_id     uuid,
  p_user_id     uuid,
  p_kind        public.transaction_kind,
  p_amount      integer,
  p_description text
) returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_balance_after integer;
begin
  if p_amount = 0 then
    raise exception 'Transaction amount must be a non-zero integer'
      using errcode = 'check_violation';
  end if;

  update public.team_members
     set coin_balance = coin_balance + p_amount
   where team_id = p_team_id and user_id = p_user_id
  returning coin_balance into v_balance_after;

  if not found then
    raise exception 'That member is not on this team.' using errcode = 'no_data_found';
  end if;

  insert into public.transactions (team_id, user_id, kind, amount, description, balance_after)
  values (p_team_id, p_user_id, p_kind, p_amount, p_description, v_balance_after);

  return v_balance_after;
end;
$$;

-- Decision §4.2: a membership is born with the onboarding grant, never bare.
-- Both create and join call this, so the two paths cannot drift.
create or replace function app.seed_membership(p_team_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.team_members (team_id, user_id, role, coin_balance, profit_loss)
  values (p_team_id, p_user_id, 'member', 0, 0);

  perform app.apply_transaction(
    p_team_id, p_user_id, 'onboarding-grant',
    app.onboarding_grant_coins(), 'Onboarding grant'
  );
end;
$$;

-- The caller, or a hard error. Every public RPC below opens with this.
create or replace function app.require_uid()
returns uuid language plpgsql stable set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'You must be signed in.' using errcode = '28000';
  end if;
  return v_uid;
end;
$$;

-- --- create_team ---------------------------------------------------------------
-- DOM-001/002 + DOM-021. The creator is the leader (the column, not a role) and
-- their membership arrives already granted.
--
-- The invite code is generated by id.ts (`generateInviteCode`) and passed in
-- rather than made here: the lookalike-free alphabet and the format are product
-- decisions that live in the shared package. Uniqueness is the UNIQUE index's
-- job — a collision raises 23505 and the caller retries with a fresh code.

create or replace function public.create_team(
  p_name        text,
  p_access_mode public.team_access_mode,
  p_invite_code text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := app.require_uid();
  v_team_id uuid;
begin
  if length(btrim(p_name)) = 0 then
    raise exception 'Give the team a name.' using errcode = 'check_violation';
  end if;
  if length(btrim(p_invite_code)) = 0 then
    raise exception 'An invite code is required.' using errcode = 'check_violation';
  end if;

  insert into public.teams (name, leader_id, access_mode)
  values (btrim(p_name), v_uid, p_access_mode)
  returning id into v_team_id;

  perform app.seed_membership(v_team_id, v_uid);

  insert into public.invite_codes (team_id, code, created_by)
  values (v_team_id, btrim(p_invite_code), v_uid);

  return v_team_id;
end;
$$;

-- --- team_preview_by_code -------------------------------------------------------
-- UX-023: an invite link must show WHAT you are joining before you join it, to
-- someone who is by definition not a member yet — so this cannot come from a
-- SELECT on `teams` (membership-scoped, deliberately). Holding the code is the
-- authorization; the function returns only what an invite card shows.

create or replace function public.team_preview_by_code(p_code text)
returns table (
  team_id        uuid,
  team_name      text,
  member_count   integer,
  open_bet_count integer,
  is_member      boolean,
  is_banned      boolean
) language sql security definer stable set search_path = '' as $$
  select
    t.id,
    t.name,
    (select count(*)::integer from public.team_members m where m.team_id = t.id),
    (select count(*)::integer from public.bets b
      where b.team_id = t.id and b.state = 'open' and b.closes_at > now()),
    app.is_team_member(t.id),
    app.is_banned(t.id, (select auth.uid()))
  from public.invite_codes c
  join public.teams t on t.id = c.team_id
  where lower(btrim(c.code)) = lower(btrim(p_code))
    and c.revoked_at is null;
$$;

-- --- join_team_with_code ---------------------------------------------------------
-- DOM-005/006 + UX-005 (codes never expire) + A-4 (a ban, unlike a kick, keeps
-- you out). This is the function Phase 3 promised: until it existed there was no
-- join path at all, because RLS cannot verify possession of a code.
-- permissions.ts's canJoinTeam is the same two-part rule, checked here again
-- because the client's copy is advice, not enforcement.

create or replace function public.join_team_with_code(p_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := app.require_uid();
  v_team_id uuid;
  v_name    text;
begin
  select t.id, t.name into v_team_id, v_name
    from public.invite_codes c
    join public.teams t on t.id = c.team_id
   where lower(btrim(c.code)) = lower(btrim(p_code))
     and c.revoked_at is null;

  if v_team_id is null then
    raise exception 'No team matches that invite code.' using errcode = 'no_data_found';
  end if;

  if exists (
    select 1 from public.team_members m
     where m.team_id = v_team_id and m.user_id = v_uid
  ) then
    raise exception 'You are already in %.', v_name using errcode = 'unique_violation';
  end if;

  if app.is_banned(v_team_id, v_uid) then
    raise exception 'You can''t rejoin %.', v_name using errcode = 'insufficient_privilege';
  end if;

  perform app.seed_membership(v_team_id, v_uid);
  return v_team_id;
end;
$$;

-- --- remove_membership ------------------------------------------------------------
-- DOM-031/032 kick and ban, and canLeaveTeam's self-exit, as one function —
-- exactly as team-context modelled them, because the only differences are who
-- may fire it and whether re-joining stays open (A-4).
--
-- `p_wager_ids` comes from settlement.ts's removeMemberWagersInTeam (decision
-- §4.4: plain removal, no refund — the per-team balance is deleted with the
-- membership). The DELETE re-scopes the list to this team and this user, so the
-- argument can only ever narrow what the cascade already permits.

create or replace function public.remove_membership(
  p_team_id   uuid,
  p_user_id   uuid,
  p_ban       boolean,
  p_wager_ids uuid[] default '{}'
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid       uuid := app.require_uid();
  v_leader_id uuid := app.team_leader_id(p_team_id);
begin
  if p_user_id = v_uid then
    if p_ban then
      raise exception 'Use Leave team to remove yourself.' using errcode = 'check_violation';
    end if;
    if not app.is_team_member(p_team_id) then
      raise exception 'You are not a member of this team.' using errcode = 'no_data_found';
    end if;
  elsif not app.is_moderator_or_leader(p_team_id) then
    raise exception 'Only the leader or moderators can remove members.'
      using errcode = 'insufficient_privilege';
  end if;

  -- DOM-001: the leader has no exit but deleting the team (DOM-033). The
  -- Phase 3 BEFORE DELETE trigger enforces this too; saying it here is what
  -- produces a sentence a person can read instead of a constraint message.
  if p_user_id = v_leader_id then
    raise exception 'The team leader can''t be removed — delete the team instead.'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from public.team_members m
     where m.team_id = p_team_id and m.user_id = p_user_id
  ) then
    raise exception 'That member is not on this team.' using errcode = 'no_data_found';
  end if;

  delete from public.wagers w
   using public.bets b
   where w.id = any(p_wager_ids)
     and w.bet_id = b.id
     and b.team_id = p_team_id
     and w.user_id = p_user_id;

  if p_ban then
    insert into public.team_bans (team_id, user_id, banned_by)
    values (p_team_id, p_user_id, v_uid)
    on conflict (team_id, user_id) do nothing;
  end if;

  delete from public.team_members
   where team_id = p_team_id and user_id = p_user_id;
end;
$$;

-- --- inject_coins ------------------------------------------------------------------
-- DOM-024/025: leader-only credit, written as an 'injection' ledger row.
-- Moderators are excluded on purpose — the one power the leader does not share
-- (A-1's exception), which the Phase 3 column trigger also enforces.

create or replace function public.inject_coins(
  p_team_id uuid,
  p_user_id uuid,
  p_amount  integer
) returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := app.require_uid();
  v_name text;
begin
  if not app.is_team_leader(p_team_id) then
    raise exception 'Only the team leader can inject coins.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_amount is null or p_amount < 1 then
    raise exception 'Inject a positive whole amount.' using errcode = 'check_violation';
  end if;

  select u.display_name into v_name from public.users u where u.id = v_uid;

  return app.apply_transaction(
    p_team_id, p_user_id, 'injection', p_amount,
    format('Injected by %s (leader)', coalesce(v_name, 'the leader'))
  );
end;
$$;

-- --- reach ---------------------------------------------------------------------------
-- `public` functions ARE exposed over PostgREST as /rest/v1/rpc/<name>, which is
-- the point; the app.* helpers above stay unreachable because `app` is not in
-- config.toml's api.schemas. EXECUTE is revoked from PUBLIC first so a definer
-- function is never callable by a role that was not named explicitly.

revoke execute on function
  public.create_team(text, public.team_access_mode, text),
  public.join_team_with_code(text),
  public.team_preview_by_code(text),
  public.remove_membership(uuid, uuid, boolean, uuid[]),
  public.inject_coins(uuid, uuid, integer)
from public;

grant execute on function
  public.create_team(text, public.team_access_mode, text),
  public.join_team_with_code(text),
  public.remove_membership(uuid, uuid, boolean, uuid[]),
  public.inject_coins(uuid, uuid, integer)
to authenticated;

-- The preview is the one that must answer before a session exists: a logged-out
-- visitor on an invite link should see the team they are being invited to.
grant execute on function public.team_preview_by_code(text) to anon, authenticated;

grant execute on all functions in schema app to authenticated, anon;

-- =============================================================================
-- Policy tightening (roadmap Phase 5, task 2).
--
-- Every write path withdrawn below is now owned by a function above. Leaving
-- the direct policy in place as well would not be redundancy — it would be a
-- second, weaker path to the same rows: a team with no membership, a membership
-- with no grant, a departure with no wager cascade, a hand-written ledger row.
-- =============================================================================

-- teams INSERT → create_team (a team without its founding membership violates
-- DOM-001, and only a transaction can create both).
drop policy if exists teams_insert_self_as_leader on public.teams;
revoke insert on public.teams from authenticated;

-- team_members INSERT → create_team / join_team_with_code (decision §4.2: no
-- membership without its onboarding grant).
-- team_members DELETE → remove_membership (DOM-032: no departure without the
-- wager cascade).
drop policy if exists team_members_insert_founder on public.team_members;
drop policy if exists team_members_delete_moderator_leader_or_self on public.team_members;
revoke insert, delete on public.team_members from authenticated;

-- team_bans INSERT → remove_membership. A ban row on its own is half an
-- operation: it blocks re-joining someone who is still on the roster (DOM-031).
-- DELETE stays with moderators — lifting a ban is complete by itself.
drop policy if exists team_bans_insert_moderator_or_leader on public.team_bans;
revoke insert on public.team_bans from authenticated;

-- transactions INSERT → app.apply_transaction, always. DOM-025's ledger is
-- append-only AND balance-coupled: a row a client could write alone would
-- claim a balance_after that nothing had moved. The table already grants no
-- UPDATE or DELETE to anyone; this makes it grant no direct INSERT either.
drop policy if exists transactions_insert_leader_or_own_grant on public.transactions;
revoke insert on public.transactions from authenticated;

-- What stays a direct client write, on purpose — each is a single-row change
-- fully described by an existing policy:
--   teams UPDATE (access mode, canManageTeam) / DELETE (canDeleteTeam, DOM-033)
--   team_members UPDATE (role changes; columns gated by the Phase 3 trigger)
--   invite_codes INSERT/UPDATE/DELETE (open decision #6: revoke & regenerate)
--   users UPDATE (UX-022 profile edits, own row only)

-- =============================================================================
-- One grant per MEMBERSHIP, not one grant per person per team, ever.
--
-- Phase 3 spelled decision §4.2 as a partial unique index on
-- (team_id, user_id) where kind = 'onboarding-grant'. That reading holds only
-- while a membership is forever: DOM-031 lets a KICKED user rejoin with the
-- code (a ban is the version that does not, A-4), and UX-005 says the code
-- keeps working — the leave-team modal promises it in those words. On the
-- second membership the index refused the grant, and since the per-team
-- balance died with the first membership (decision §4.4), the returning member
-- came back with nothing to bet. Caught by the Phase 5 exit run.
--
-- The invariant it was protecting is now structural rather than declared: every
-- grant is written by app.seed_membership, which inserts the team_members row
-- first, so a second grant inside one membership cannot happen — the primary
-- key on (team_id, user_id) rejects the insert before any ledger row exists.
-- Nothing else may write to `transactions` at all (see the tightening above).
--
-- The old grant rows stay. DOM-025's ledger is auditable and never lost; two
-- grants across two memberships is what actually happened.
drop index if exists public.transactions_one_onboarding_grant_per_membership_idx;
