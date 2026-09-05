-- =============================================================================
-- Authorization helpers — the SQL mirror of packages/shared/src/permissions.ts.
--
-- Every rule below has a named counterpart in permissions.ts; the doc comment on
-- each function says which. permissions.ts stays the single source of truth for
-- the RULES, this file is their enforcement at the database boundary. When one
-- changes, both change.
--
-- Why a private `app` schema and SECURITY DEFINER, not inline subqueries:
--
--   1. Recursion. A policy on team_members that reads team_members re-enters
--      the same policy and errors with infinite recursion. A SECURITY DEFINER
--      function reads the table with RLS bypassed, which breaks the cycle.
--   2. Reach. `app` is not in config.toml's `api.schemas`, so none of this is
--      callable over PostgREST — it exists only inside policy expressions.
--
-- `set search_path = ''` on every function: without it, a caller-controlled
-- search_path could shadow `public.team_members` for a definer-rights function.
-- =============================================================================

create schema if not exists app;

revoke all on schema app from public;
grant usage on schema app to authenticated, anon;

-- --- membership ---------------------------------------------------------------

-- permissions.ts: isMember
create or replace function app.is_team_member(p_team_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.team_members m
    where m.team_id = p_team_id and m.user_id = (select auth.uid())
  );
$$;

-- permissions.ts: roleOf
create or replace function app.team_role(p_team_id uuid)
returns public.team_role language sql security definer stable set search_path = '' as $$
  select m.role from public.team_members m
  where m.team_id = p_team_id and m.user_id = (select auth.uid());
$$;

-- DOM-001: the single leader scalar, resolved without reading `teams` under RLS.
create or replace function app.team_leader_id(p_team_id uuid)
returns uuid language sql security definer stable set search_path = '' as $$
  select t.leader_id from public.teams t where t.id = p_team_id;
$$;

-- permissions.ts: isLeader — leadership requires actually being on the roster.
create or replace function app.is_team_leader(p_team_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select app.team_leader_id(p_team_id) = (select auth.uid())
     and app.is_team_member(p_team_id);
$$;

-- permissions.ts: isModeratorOrLeader. This is assumption A-1 in one place —
-- the leader holds every moderator power plus the leader-only ones. Everything
-- that says "moderator" in the spec routes through here.
create or replace function app.is_moderator_or_leader(p_team_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select app.is_team_leader(p_team_id) or app.team_role(p_team_id) = 'moderator';
$$;

-- permissions.ts: canCreateBet (DOM-002) — and canInvite, which DOM-006 defines
-- as the same rule. One function, so the two can never drift apart.
create or replace function app.can_create_bet(p_team_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select app.is_team_member(p_team_id)
     and (
       (select t.access_mode from public.teams t where t.id = p_team_id) = 'free-for-all'
       or app.is_moderator_or_leader(p_team_id)
     );
$$;

-- permissions.ts: canJoinTeam's ban half (DOM-031 + A-4). Takes an explicit
-- user so the join RPC can check a candidate, not only the caller.
create or replace function app.is_banned(p_team_id uuid, p_user_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.team_bans b
    where b.team_id = p_team_id and b.user_id = p_user_id
  );
$$;

-- Two users share at least one team. This is what lets a member render a
-- teammate's display name and name color (UX-022 renders names "everywhere the
-- name renders") without opening every profile in the database to everyone.
create or replace function app.shares_team_with(p_user_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1
    from public.team_members mine
    join public.team_members theirs on theirs.team_id = mine.team_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = p_user_id
  );
$$;

-- --- bet-scoped -----------------------------------------------------------------
-- Wagers, options and comments are team-scoped only through their bet. These
-- two hops live here rather than being repeated in a dozen policies.

create or replace function app.bet_team_id(p_bet_id uuid)
returns uuid language sql security definer stable set search_path = '' as $$
  select b.team_id from public.bets b where b.id = p_bet_id;
$$;

create or replace function app.is_bet_team_member(p_bet_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select app.is_team_member(app.bet_team_id(p_bet_id));
$$;

-- permissions.ts: canCloseBetEarly / canResolveBet / canDeleteBet — DOM-011,
-- DOM-018/019 and DOM-033 all name the same set (creator, moderator, leader),
-- so they are one function here too.
create or replace function app.can_manage_bet(p_bet_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.bets b
    where b.id = p_bet_id
      and app.is_team_member(b.team_id)
      and (b.creator_id = (select auth.uid()) or app.is_moderator_or_leader(b.team_id))
  );
$$;

-- state-machine.ts: canAcceptWagers. The EFFECTIVE state counts the clock, not
-- just the stored column (DOM-012) — a bet stored as 'open' whose closes_at has
-- passed must refuse new wagers even before anything persists the transition.
create or replace function app.bet_accepts_wagers(p_bet_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.bets b
    where b.id = p_bet_id and b.state = 'open' and b.closes_at > now()
  );
$$;

-- --- trigger context ------------------------------------------------------------

-- True when the request is NOT a direct client write: the seed, `supabase db
-- reset`, Studio, service_role calls, and — the case that matters most — the
-- SECURITY DEFINER RPCs that Phases 5–7 will add.
--
-- The discriminator is `current_user`, not `auth.uid()`. Inside a definer RPC
-- auth.uid() is still the end user's id (it comes from the JWT, not the role),
-- so a uid-based check would block exactly the settlement and ledger functions
-- that are supposed to move balances on a member's behalf. `current_user`
-- instead reads 'authenticated'/'anon' for a direct PostgREST write and
-- 'postgres'/'service_role' for everything privileged.
create or replace function app.is_service_context()
returns boolean language sql stable set search_path = '' as $$
  select current_user not in ('authenticated', 'anon');
$$;

-- Policy expressions execute as the invoking role, so `authenticated` must be
-- able to call these. They are unreachable over the API regardless: `app` is
-- not an exposed schema.
grant execute on all functions in schema app to authenticated, anon;
