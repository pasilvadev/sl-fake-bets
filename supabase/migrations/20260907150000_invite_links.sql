-- =============================================================================
-- SL Fake Bets — invite links: expiry choice & revocation
-- (plan-invite-links.md, owner order in chat, 2026-09-07).
--
-- Supersedes two things written down elsewhere in this schema, on purpose:
--
--   * 20260905120000_domain_schema.sql's invite_codes comment — "UX-005/DOM-005:
--     no expiry column by design. Codes die only by revocation." — is now half
--     true. Revocation still ends a link; expiry is the new second way, and it
--     is opt-in per link, never automatic on the team's one permanent link.
--   * 20260905140000_team_rpcs.sql's "What stays a direct client write" list
--     (:373-378) named `invite_codes INSERT/UPDATE/DELETE` as the one domain
--     table still open to a client write, pending "open decision #6 (revoke &
--     regenerate)". That decision is resolved here: both writes move to
--     SECURITY DEFINER RPCs and the three policies naming them are withdrawn,
--     completing the Phase 5 tightening for the one table it left open.
--
-- Closes AGENT_SPEC.md open decision #6 and amends UX-005/DOM-005 (the spec
-- edit itself is plan-invite-links.md Phase 6; this file is the schema half
-- only). vision.md's pillar — "tentar ao maximo não expirar links de convite"
-- — survives: every team is still born with a permanent link (D9, create_team
-- untouched), that link is still the default, and a 24-hour link only exists
-- when a person chose that option for that one link.
--
-- D1 — Two kinds of link, one column. `expires_at timestamptz` nullable; NULL
-- is permanent. No `kind` enum, because a second column could disagree with
-- the first — "temporary" is exactly and only "has an expiry".
-- D2 — 24 hours is the only temporary duration, and the SERVER sets it.
-- `create_invite_code` writes `now() + app.invite_temporary_ttl()`; no client
-- value is ever accepted, so a skewed client clock cannot mint a link that is
-- born dead or lives for years.
-- D3 — Expiry is lazy, DUEL-008's shape minus the half it does not need. Every
-- read predicate becomes `revoked_at is null and (expires_at is null or
-- expires_at > now())`; nothing is scheduled and there is no sweep, because
-- unlike a duel there is no money to refund on expiry.
-- D4 — Both writes are RPCs; `invite_codes` INSERT/UPDATE/DELETE/TRUNCATE are
-- revoked from `authenticated` and `anon`, the exact belt-and-braces shape
-- `20260906130000_duel_schema.sql:360` used for `bet_duels`. SELECT is
-- untouched — reading a teammate's link is not a privilege, D5 says so.
-- D5 — Create follows `canInvite`/DOM-006 (`app.can_create_bet`, unchanged);
-- revoke is the leader, any moderator, or whoever made that link — a person
-- may unmake what they made, and the creator must still be on the roster.
-- D6 — At most 10 live 24-hour links per team, rate control not moderation
-- (Extra Phase 2 task 9's framing, in spirit): `SLI02`, no trigger, because
-- after D4 the RPC is the only writer and a concurrent overshoot by one is an
-- accepted cost of a cap on convenience, not a bug to lock against.
-- =============================================================================


-- =============================================================================
-- COLUMN AND CONSTRAINT
-- =============================================================================

alter table public.invite_codes add column expires_at timestamptz;

alter table public.invite_codes
  add constraint invite_codes_expiry_after_creation
  check (expires_at is null or expires_at > created_at);

comment on column public.invite_codes.expires_at is
  'NULL = permanent (UX-005 default). Set only by create_invite_code from app.invite_temporary_ttl(); never from a client clock.';


-- =============================================================================
-- INDEX
-- =============================================================================
-- D1: "one active code per team" (domain_schema.sql:136) becomes "one LIVE
-- PERMANENT link per team" — a live temporary link does not compete with it,
-- and up to app.invite_max_live_temporary_per_team() of those may coexist.

drop index public.invite_codes_one_active_per_team_idx;

create unique index invite_codes_one_live_permanent_per_team_idx
  on public.invite_codes (team_id)
  where revoked_at is null and expires_at is null;

-- Backs the per-team live-link list (the client's own query, and every count
-- below) and the SLI02 cap count in create_invite_code.
create index invite_codes_team_live_idx
  on public.invite_codes (team_id)
  where revoked_at is null;


-- =============================================================================
-- TUNABLES
-- =============================================================================
-- Same shape as app.duel_accept_window()/app.duel_max_pending_per_challenger()
-- (20260906130100_duel_rpcs.sql): THIS function is the authority, because it
-- computes the deadline the row actually stores — no client value is ever sent
-- for it. CONFIG.INVITE_TEMPORARY_TTL_HOURS (packages/shared/src/config.ts) is
-- the TypeScript copy, there only to write the sentence a person reads and to
-- preview the deadline before the round trip. Change one and you must change
-- the other in the same commit, or the copy starts lying about what the
-- database enforces — silently, with no test able to catch it.
create or replace function app.invite_temporary_ttl()
returns interval language sql immutable set search_path = '' as $$
  select interval '24 hours';
$$;

-- Same standing warning: CONFIG.INVITE_MAX_LIVE_TEMPORARY_PER_TEAM is the
-- product source of truth and asInviteFailure (team-mutations.ts) interpolates
-- ITS copy into the toast. If these two disagree, the sentence a member reads
-- will name a different number from the one that refused them.
create or replace function app.invite_max_live_temporary_per_team()
returns integer language sql immutable set search_path = '' as $$
  select 10;
$$;


-- =============================================================================
-- team_preview_by_code / join_team_with_code — D3's expiry predicate added
-- =============================================================================
-- Bodies copied verbatim from 20260905140000_team_rpcs.sql — these ARE the
-- latest bodies, no later migration touches either — plus ONE added predicate
-- each: `and (c.expires_at is null or c.expires_at > now())`. Same signatures
-- and return types, so the existing grants persist across `create or replace`
-- (verified with the privilege audit in Phase 5, not assumed here — see this
-- plan's risk 2).

-- UX-023: an invite link must show WHAT you are joining before you join it, to
-- someone who is by definition not a member yet — so this cannot come from a
-- SELECT on `teams` (membership-scoped, deliberately). Holding a LIVE code is
-- the authorization (D3); the function returns only what an invite card shows.
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
    and c.revoked_at is null
    and (c.expires_at is null or c.expires_at > now());
$$;

-- DOM-005/006 + UX-005 as amended by plan-invite-links.md D12: permanent by
-- default, no automatic expiry ever applied to a link nobody chose to expire,
-- an opt-in 24-hour link, manual revocation by leader/moderators/creator (in
-- place of the old "UX-005 (codes never expire)" citation). + A-4 (a ban,
-- unlike a kick, keeps you out). This is the function Phase 3 promised: until
-- it existed there was no join path at all, because RLS cannot verify
-- possession of a code.
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
     and c.revoked_at is null
     and (c.expires_at is null or c.expires_at > now());

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


-- =============================================================================
-- create_invite_code
-- =============================================================================
-- D4: the only way an invite_codes row is born from now on. D5: create
-- follows canInvite/DOM-006 — the same rule bet creation uses
-- (app.can_create_bet, unchanged; permissions.ts models canInvite as
-- canCreateBet for exactly that reason). D2: expires_at is computed HERE from
-- app.invite_temporary_ttl(), never accepted from the caller. D6: a
-- live-temporary cap of app.invite_max_live_temporary_per_team(), rate control
-- not moderation. D8: a second permanent link is refused (SLI01), not
-- silently regenerated — "Regenerate" is revoke-then-create, two explicit
-- actions, because a one-click regenerate would destroy a link someone may
-- have already pasted somewhere, and this codebase confirms destructive
-- actions inline every time (kick, ban, delete).
--
-- A code COLLISION still surfaces as a bare 23505 on invite_codes_code_key,
-- which team-mutations.ts's withFreshCode retry loop already handles (the same
-- loop createTeam uses). A concurrent SECOND permanent also lands as 23505 —
-- on invite_codes_one_live_permanent_per_team_idx this time — and the retry's
-- next attempt honestly hits the SLI01 pre-check, because by then the first
-- permanent really has committed. Self-correcting; no exception handler is
-- needed here for either race, unlike create_duel's pair-rule 23505 (that one
-- had no pre-check left to fall back on after the fact).
create or replace function public.create_invite_code(
  p_team_id   uuid,
  p_code      text,
  p_temporary boolean
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  v_id  uuid;
begin
  if not app.can_create_bet(p_team_id) then
    raise exception 'Only members the access mode allows can make invite links for this team.'
      using errcode = 'insufficient_privilege';
  end if;

  if length(btrim(p_code)) = 0 then
    raise exception 'An invite code is required.' using errcode = 'check_violation';
  end if;

  if not p_temporary and exists (
    select 1 from public.invite_codes c
     where c.team_id = p_team_id
       and c.revoked_at is null
       and c.expires_at is null
  ) then
    raise exception 'This team already has a permanent link — revoke it to make a new one.'
      using errcode = 'SLI01';
  end if;

  if p_temporary and (
    select count(*) from public.invite_codes c
     where c.team_id = p_team_id
       and c.revoked_at is null
       and c.expires_at is not null
       and c.expires_at > now()
  ) >= app.invite_max_live_temporary_per_team() then
    raise exception
      'This team already has % live 24-hour links. Revoke one or wait for one to expire.',
      app.invite_max_live_temporary_per_team()
      using errcode = 'SLI02';
  end if;

  insert into public.invite_codes (team_id, code, created_by, expires_at)
  values (
    p_team_id,
    btrim(p_code),
    v_uid,
    case when p_temporary then now() + app.invite_temporary_ttl() end
  )
  returning id into v_id;

  return v_id;
end;
$$;


-- =============================================================================
-- revoke_invite_code
-- =============================================================================
-- D4/D5: the only way an invite_codes row is revoked from now on, and open to
-- the leader, any moderator, OR whoever made that link — a person may unmake
-- what they made, and in a free-for-all team most 24-hour links will be made
-- by ordinary members. `app.is_team_member` checks the CALLER's own current
-- membership, not merely that the row names them as `created_by`: someone who
-- left keeps no power over a team they are no longer on, even over a link they
-- once made.
-- Reads with SECURITY DEFINER, so RLS never hides the row this checks against.
-- Idempotent on an already-revoked row (return, not raise): two tabs, one
-- click each, must not turn a stale second click into a visible error.
create or replace function public.revoke_invite_code(p_invite_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid        uuid := app.require_uid();
  v_team_id    uuid;
  v_created_by uuid;
  v_revoked_at timestamptz;
begin
  select c.team_id, c.created_by, c.revoked_at
    into v_team_id, v_created_by, v_revoked_at
    from public.invite_codes c
   where c.id = p_invite_id;

  if v_team_id is null then
    raise exception 'That invite link no longer exists.' using errcode = 'no_data_found';
  end if;

  if not app.is_team_member(v_team_id) then
    raise exception 'You are not a member of this team.' using errcode = 'insufficient_privilege';
  end if;

  if not (app.is_moderator_or_leader(v_team_id) or v_created_by = v_uid) then
    raise exception 'Only the leader, a moderator, or whoever made a link can revoke it.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_revoked_at is not null then
    return;
  end if;

  update public.invite_codes
     set revoked_at = now()
   where id = p_invite_id;
end;
$$;


-- =============================================================================
-- REACH
-- =============================================================================
-- Named `anon` revoke first: the 20260906130400_duel_pair_rule_fix.sql trap —
-- this schema's ALTER DEFAULT PRIVILEGES grants EXECUTE to anon/authenticated/
-- service_role BY NAME at create time, so `revoke ... from public` alone would
-- not strip anon's own named grant on either function below.
revoke execute on function
  public.create_invite_code(uuid, text, boolean),
  public.revoke_invite_code(uuid)
from public, anon;

grant execute on function
  public.create_invite_code(uuid, text, boolean),
  public.revoke_invite_code(uuid)
to authenticated;


-- =============================================================================
-- Policy tightening — D4, completing Phase 5's "What stays a direct client
-- write" list (20260905140000_team_rpcs.sql:373-378) for the one table it
-- left open. invite_codes SELECT is UNTOUCHED and stays exactly as it was:
-- any member sees every live link (D5, read) — copying a teammate's link is
-- not a privilege, it is the point of a link.
-- =============================================================================

drop policy if exists invite_codes_insert_per_access_mode on public.invite_codes;
drop policy if exists invite_codes_update_moderator_or_leader on public.invite_codes;
drop policy if exists invite_codes_delete_moderator_or_leader on public.invite_codes;

-- Verbatim the belt-and-braces statement 20260906130000_duel_schema.sql:360
-- used for bet_duels: RLS filters rows, but a verb never granted cannot be
-- reached even through a future policy mistake, and TRUNCATE bypasses RLS
-- entirely regardless of any policy.
revoke insert, update, delete, truncate on public.invite_codes from authenticated, anon;
