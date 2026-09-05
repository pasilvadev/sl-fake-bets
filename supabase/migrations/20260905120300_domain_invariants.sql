-- =============================================================================
-- Domain invariants that a CHECK constraint cannot express.
--
-- Each one is a rule the shared package already enforces in TypeScript. Putting
-- it in the database too is not duplication for its own sake: from Phase 5 the
-- same tables are reachable from RPCs, Studio and PostgREST, and a rule that
-- lives only in validation.ts stops being an invariant the moment a write comes
-- from anywhere else.
-- =============================================================================

-- --- DOM-012: strictly ordered bet lifecycle -----------------------------------
-- The SQL twin of validation.ts's canTransitionBetState. Deliberately has NO
-- service-context escape hatch: "open → closed → resolved, nothing else" is
-- absolute, so it must bind the Phase 6/7 RPCs exactly as it binds a client.
-- (Inserts are unaffected — the seed can create a bet already resolved, which is
-- history, not a transition.)

create or replace function public.enforce_bet_state_transition()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.state = old.state then
    return new;
  end if;

  if not (
    (old.state = 'open'   and new.state = 'closed')
    or (old.state = 'closed' and new.state = 'resolved')
  ) then
    raise exception
      'DOM-012: illegal bet transition %  →  %. Legal: open→closed, closed→resolved.',
      old.state, new.state
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger bets_enforce_state_transition
  before update of state on public.bets
  for each row execute function public.enforce_bet_state_transition();

-- --- DOM-001: the leader is always on the roster --------------------------------
-- validation.ts's hasExactlyOneLeader, half of which the schema already gives us
-- (a single leader_id column makes "more than one leader" unrepresentable). This
-- is the other half: that leader must actually be a member.
--
-- DEFERRABLE INITIALLY DEFERRED because team creation legitimately inserts the
-- team before the creator's membership row; the check runs at COMMIT, when both
-- exist.

create or replace function public.enforce_leader_is_member()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.team_members m
    where m.team_id = new.id and m.user_id = new.leader_id
  ) then
    raise exception 'DOM-001: team % leader % is not a member of the team', new.id, new.leader_id
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

create constraint trigger teams_enforce_leader_is_member
  after insert or update of leader_id on public.teams
  deferrable initially deferred
  for each row execute function public.enforce_leader_is_member();

-- The same invariant from the other side: the leader's membership cannot be
-- deleted out from under the team. permissions.ts's canLeaveTeam already says
-- the leader's only exit is deleting the team (DOM-033); this makes that true
-- for every write path, not just the UI's.
--
-- The `exists` guard is what lets team deletion work: ON DELETE CASCADE removes
-- the teams row first, so by the time the membership rows go, the team is gone
-- and there is no invariant left to protect.

create or replace function public.enforce_leader_membership_kept()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (
    select 1 from public.teams t
    where t.id = old.team_id and t.leader_id = old.user_id
  ) then
    raise exception
      'DOM-001: the leader cannot leave or be removed from team % — delete the team instead (DOM-033)',
      old.team_id
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

create trigger team_members_enforce_leader_kept
  before delete on public.team_members
  for each row execute function public.enforce_leader_membership_kept();

-- --- Who may change what on a membership row ------------------------------------
-- RLS decides whether a row may be updated at all; it cannot say "this role may
-- touch these columns but not those". DOM-024 needs exactly that distinction:
-- coin injection is LEADER-ONLY, with moderators explicitly excluded, while
-- moderators do manage roles (DOM-003/031). Both rules apply to the same row,
-- so column-level enforcement has to live in a trigger.

-- SECURITY INVOKER (the default), and that is load-bearing. As SECURITY DEFINER
-- this function runs as `postgres`, which makes app.is_service_context() true
-- for EVERY caller — including a moderator's direct PATCH — and the guard below
-- then disarms the whole trigger. Running with invoker rights keeps
-- current_user at 'authenticated' for client writes and 'postgres' only inside
-- the definer RPCs that are genuinely allowed to move balances. The app.*
-- helpers it calls are still SECURITY DEFINER, so RLS never blocks the lookups.
create or replace function public.enforce_team_member_update_rules()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Seed, Studio, service_role, and the Phase 5–7 settlement/ledger RPCs.
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

  -- DOM-024: leader-only. This single line is what the phase exit criterion
  -- tests — a moderator injecting coins must fail here even though RLS lets it
  -- update the row's role.
  if new.coin_balance <> old.coin_balance and not app.is_team_leader(old.team_id) then
    raise exception 'DOM-024: only the team leader may change a member coin balance'
      using errcode = 'insufficient_privilege';
  end if;

  -- DOM-026: realized P/L is an outcome of resolution (DOM-018/019), never a
  -- free-form edit. Same resolver set as canResolveBet.
  if new.profit_loss <> old.profit_loss and not app.is_moderator_or_leader(old.team_id) then
    raise exception 'DOM-026: profit/loss changes only through bet resolution'
      using errcode = 'insufficient_privilege';
  end if;

  -- DOM-003/DOM-031: role management is a moderator/leader power (A-1).
  if new.role <> old.role and not app.is_moderator_or_leader(old.team_id) then
    raise exception 'DOM-003: only a moderator or the leader may change a member role'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger team_members_enforce_update_rules
  before update on public.team_members
  for each row execute function public.enforce_team_member_update_rules();

-- --- Leadership transfer stays closed until the owner decides it ----------------
-- DOM-001 leaves "leadership transfer / leader leaving" explicitly unspecified,
-- and the teams UPDATE policy has to admit moderators (they manage team
-- settings). Without this, "moderator edits team" would silently include
-- "moderator makes themself leader" — inventing an answer to an open spec point
-- through a permission gap. Service context stays open so the Phase 5+ RPC can
-- implement transfer the moment the owner rules on it.

-- Invoker rights for the same reason as enforce_team_member_update_rules.
create or replace function public.enforce_leader_id_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  if app.is_service_context() then
    return new;
  end if;
  if new.leader_id <> old.leader_id then
    raise exception
      'DOM-001: leadership transfer is an open spec decision and has no client-side path yet'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger teams_enforce_leader_id_immutable
  before update of leader_id on public.teams
  for each row execute function public.enforce_leader_id_immutable();
