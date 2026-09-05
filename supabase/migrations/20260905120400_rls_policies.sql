-- =============================================================================
-- Row Level Security — the enforcement layer for permissions.ts.
--
-- Reading order: every policy names the permissions.ts function or spec ID it
-- implements. Where the two could drift, the policy calls an app.* helper that
-- IS the shared rule (see 20260905120200_auth_helpers.sql) rather than
-- re-deriving it inline.
--
-- Roadmap risk #5 applies: this is the first pass. Phases 5–7 will tighten it
-- against real access patterns, particularly around the SECURITY DEFINER RPCs
-- that own multi-row mutations (join-by-code, kick/ban cascade, settlement).
--
-- Two deliberate departures from the roadmap's one-line summary of RLS
-- ("user reads/updates only own `users` row"), both recorded here so a later
-- session does not read them as accidents:
--
--   * users SELECT also covers profiles that share a team with the caller.
--     UX-022 renders display name and name color "everywhere the name renders",
--     so a strict own-row-only read would make every wager, comment and
--     leaderboard row unrenderable from Phase 5 on. Writes stay own-row-only,
--     which is the half that protects anything.
--   * team_members INSERT does NOT cover joining by invite code. RLS cannot see
--     whether the caller actually holds a code, so a self-insert policy would
--     mean "anyone who learns a team uuid can join it" — a weaker rule than
--     DOM-005/006 describe. Only the team creator's own founding membership is
--     allowed here; joining arrives in Phase 5 as a SECURITY DEFINER RPC that
--     checks the code, the ban list (A-4) and applies the onboarding grant
--     (decision §4.2) in one transaction.
-- =============================================================================

alter table public.users            enable row level security;
alter table public.teams            enable row level security;
alter table public.team_members     enable row level security;
alter table public.team_bans        enable row level security;
alter table public.invite_codes     enable row level security;
alter table public.bets             enable row level security;
alter table public.bet_options      enable row level security;
alter table public.wagers           enable row level security;
alter table public.transactions     enable row level security;
alter table public.comments         enable row level security;
alter table public.analytics_events enable row level security;
alter table public.feature_flags    enable row level security;

-- --- users ---------------------------------------------------------------------

create policy users_select_self_or_teammate on public.users
  for select to authenticated
  using ((select auth.uid()) = id or app.shares_team_with(id));

-- Signup writes the caller's own profile row and nothing else (UX-002 fills it).
create policy users_insert_self on public.users
  for insert to authenticated
  with check ((select auth.uid()) = id);

-- UX-022 profile editing. Both clauses: USING picks the row, WITH CHECK stops
-- the update from re-pointing it at someone else's id.
create policy users_update_self on public.users
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- No DELETE policy: profiles die with the auth.users row, via ON DELETE CASCADE.

-- --- teams ---------------------------------------------------------------------

-- Membership-scoped. Invite links show a team name to a NON-member (UX-023), so
-- that preview cannot come from here — it is a Phase 5 SECURITY DEFINER RPC
-- returning just the name for a valid code. A public read of `teams` would
-- expose every team in the database to every signed-in user.
create policy teams_select_member on public.teams
  for select to authenticated
  using (app.is_team_member(id));

-- DOM-001: the creator becomes the leader. Enforced as an equality rather than
-- a later fixup, so a team can never be born with someone else's leader id.
create policy teams_insert_self_as_leader on public.teams
  for insert to authenticated
  with check (leader_id = (select auth.uid()));

-- permissions.ts: canManageTeam.
create policy teams_update_moderator_or_leader on public.teams
  for update to authenticated
  using (app.is_moderator_or_leader(id))
  with check (app.is_moderator_or_leader(id));

-- permissions.ts: canDeleteTeam (DOM-033) — leader only. Type-to-confirm
-- (DOM-034) is a UI affordance and belongs in the client, not here.
create policy teams_delete_leader on public.teams
  for delete to authenticated
  using (app.is_team_leader(id));

-- --- team_members ---------------------------------------------------------------

create policy team_members_select_same_team on public.team_members
  for select to authenticated
  using (app.is_team_member(team_id));

-- Founding membership only — see the header note. `app.team_leader_id` reads
-- the teams row inserted earlier in the same transaction.
create policy team_members_insert_founder on public.team_members
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and app.team_leader_id(team_id) = (select auth.uid())
    and not app.is_banned(team_id, (select auth.uid()))
  );

-- Row-level gate only. WHICH columns each role may actually change is
-- enforce_team_member_update_rules' job — DOM-024 excludes moderators from
-- coin injection, and RLS has no column granularity to express that.
create policy team_members_update_moderator_or_leader on public.team_members
  for update to authenticated
  using (app.is_moderator_or_leader(team_id))
  with check (app.is_moderator_or_leader(team_id));

-- Kick/ban (DOM-031, canKick/canBan) plus canLeaveTeam's self-exit. The leader
-- is unremovable through either path — enforce_leader_membership_kept.
create policy team_members_delete_moderator_leader_or_self on public.team_members
  for delete to authenticated
  using (
    app.is_moderator_or_leader(team_id)
    or user_id = (select auth.uid())
  );

-- --- team_bans -------------------------------------------------------------------

create policy team_bans_select_member on public.team_bans
  for select to authenticated
  using (app.is_team_member(team_id));

-- permissions.ts: canBan (DOM-031). banned_by is pinned to the caller so the
-- audit trail cannot be forged.
create policy team_bans_insert_moderator_or_leader on public.team_bans
  for insert to authenticated
  with check (
    app.is_moderator_or_leader(team_id)
    and banned_by = (select auth.uid())
  );

create policy team_bans_delete_moderator_or_leader on public.team_bans
  for delete to authenticated
  using (app.is_moderator_or_leader(team_id));

-- --- invite_codes -----------------------------------------------------------------

create policy invite_codes_select_member on public.invite_codes
  for select to authenticated
  using (app.is_team_member(team_id));

-- DOM-006: invite creation follows the access mode, i.e. the same rule as bet
-- creation. permissions.ts models canInvite as canCreateBet for that reason.
create policy invite_codes_insert_per_access_mode on public.invite_codes
  for insert to authenticated
  with check (
    app.can_create_bet(team_id)
    and created_by = (select auth.uid())
  );

-- Revocation (open decision #6) is a team-management power, not an invite one.
create policy invite_codes_update_moderator_or_leader on public.invite_codes
  for update to authenticated
  using (app.is_moderator_or_leader(team_id))
  with check (app.is_moderator_or_leader(team_id));

create policy invite_codes_delete_moderator_or_leader on public.invite_codes
  for delete to authenticated
  using (app.is_moderator_or_leader(team_id));

-- --- bets ---------------------------------------------------------------------------

create policy bets_select_team_member on public.bets
  for select to authenticated
  using (app.is_team_member(team_id));

-- permissions.ts: canCreateBet (DOM-002/035 — no cap, no subject restriction).
create policy bets_insert_per_access_mode on public.bets
  for insert to authenticated
  with check (
    app.can_create_bet(team_id)
    and creator_id = (select auth.uid())
  );

-- permissions.ts: canCloseBetEarly / canResolveBet (DOM-011, DOM-018/019).
-- The legal transitions themselves are enforce_bet_state_transition's job.
create policy bets_update_creator_or_moderator on public.bets
  for update to authenticated
  using (app.can_manage_bet(id))
  with check (app.can_manage_bet(id));

-- permissions.ts: canDeleteBet (DOM-033).
create policy bets_delete_creator_or_moderator on public.bets
  for delete to authenticated
  using (app.can_manage_bet(id));

-- --- bet_options ----------------------------------------------------------------------

create policy bet_options_select_team_member on public.bet_options
  for select to authenticated
  using (app.is_bet_team_member(bet_id));

create policy bet_options_insert_bet_manager on public.bet_options
  for insert to authenticated
  with check (app.can_manage_bet(bet_id));

create policy bet_options_update_bet_manager on public.bet_options
  for update to authenticated
  using (app.can_manage_bet(bet_id))
  with check (app.can_manage_bet(bet_id));

create policy bet_options_delete_bet_manager on public.bet_options
  for delete to authenticated
  using (app.can_manage_bet(bet_id));

-- --- wagers -----------------------------------------------------------------------------

-- UX-015: the bet detail page shows per-participant wagers, so wagers are
-- readable by the whole team, not just their owner.
create policy wagers_select_team_member on public.wagers
  for select to authenticated
  using (app.is_bet_team_member(bet_id));

-- DOM-012/014: own wager, own team, and only while the bet still accepts them —
-- the clock counts, not just the stored state (state-machine.ts).
--
-- The balance and per-user-max halves of validateWager are NOT here on purpose:
-- both need to debit coin_balance in the same transaction, which is Phase 6's
-- placeWager RPC. Until then this policy is the floor, not the whole rule.
create policy wagers_insert_own_on_open_bet on public.wagers
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and app.is_bet_team_member(bet_id)
    and app.bet_accepts_wagers(bet_id)
  );

-- No UPDATE policy: a placed wager is immutable. Editing one would silently
-- rewrite a pool that other members have already priced their bets against.

-- DOM-032: the kick/ban cascade removes a member's wagers from active pools.
create policy wagers_delete_moderator_or_leader on public.wagers
  for delete to authenticated
  using (app.is_moderator_or_leader(app.bet_team_id(bet_id)));

-- --- transactions -------------------------------------------------------------------------

-- Own history always; the whole team's for those who manage it.
create policy transactions_select_own_or_manager on public.transactions
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or app.is_moderator_or_leader(team_id)
  );

-- Two disjoint paths, matching the two ways a ledger row is born:
--   * DOM-024 injection — leader only, moderators explicitly excluded.
--   * decisions §4.2/§4.3 grants — the member's own membership grant and daily
--     reward, applied lazily on join / team load. The partial unique indexes on
--     the table are what stop those from being claimed twice.
create policy transactions_insert_leader_or_own_grant on public.transactions
  for insert to authenticated
  with check (
    (app.is_team_leader(team_id) and kind in ('injection', 'donation'))
    or (
      user_id = (select auth.uid())
      and kind in ('onboarding-grant', 'daily-reward')
    )
  );

-- DOM-025 says the ledger is auditable and never lost, so there is deliberately
-- no UPDATE and no DELETE policy on this table for anyone. Append-only.

-- --- comments ------------------------------------------------------------------------------

create policy comments_select_team_member on public.comments
  for select to authenticated
  using (app.is_bet_team_member(bet_id));

-- permissions.ts: canComment (UX-018) — any member of the bet's team.
create policy comments_insert_own on public.comments
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and app.is_bet_team_member(bet_id)
  );

-- DOM-030 is explicit that there is no content moderation system. Deleting
-- other people's messages is exactly what such a system would be, so moderators
-- get no delete power here — only the author can remove their own comment.
create policy comments_delete_own on public.comments
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- --- analytics_events -------------------------------------------------------------------------

-- ARC-017/UX-028: the funnel starts before an account exists, so `anon` must be
-- able to write. The check stops a caller stamping someone else's user_id on an
-- event; anonymous rows carry only the anonymous_id that stitches the funnel.
create policy analytics_events_insert_anyone on public.analytics_events
  for insert to anon, authenticated
  with check (user_id is null or user_id = (select auth.uid()));

-- No SELECT policy for anyone. design-stack §3: the two mandated metrics are
-- read as SQL in Studio (service_role), and there is no in-app dashboard.

-- --- feature_flags -------------------------------------------------------------------------

-- ARC-016: read by the app at load, including logged-out pages.
create policy feature_flags_select_anyone on public.feature_flags
  for select to anon, authenticated
  using (true);

-- No write policies: toggling is a Studio/service_role action, which is what
-- "without a deploy or rebuild" means here.

-- --- explicit grants ----------------------------------------------------------------------------
-- RLS filters rows; GRANT decides whether the verb is available at all. Spelling
-- these out means the table privileges match the policies above even if the
-- project's auto-expose default changes.

grant select, insert, update on public.users to authenticated;
grant select, insert, update, delete on public.teams to authenticated;
grant select, insert, update, delete on public.team_members to authenticated;
grant select, insert, delete on public.team_bans to authenticated;
grant select, insert, update, delete on public.invite_codes to authenticated;
grant select, insert, update, delete on public.bets to authenticated;
grant select, insert, update, delete on public.bet_options to authenticated;
grant select, insert, delete on public.wagers to authenticated;
grant select, insert on public.transactions to authenticated;
grant select, insert, delete on public.comments to authenticated;
grant insert on public.analytics_events to anon, authenticated;
grant select on public.feature_flags to anon, authenticated;

-- Belt and braces on the append-only ledger (DOM-025): even with a future
-- policy mistake, the verb itself is not granted.
revoke update, delete on public.transactions from authenticated, anon;
