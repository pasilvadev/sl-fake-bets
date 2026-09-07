import type { Bet, Duel, Team, TeamRole } from "./types";

/**
 * Single home for authorization logic — every rule derived purely from
 * TeamRole + accessMode + leader status, with A-1 applied throughout: the
 * leader holds all moderator powers plus leader-only ones. team-context has
 * computed every permission through these since Phase 2; the `app.*` helpers
 * (Phase 3) and the team RPCs (Phase 5) are their server-side mirror, which is
 * where they are actually ENFORCED — the client copy is advice.
 */

function roleOf(team: Team, userId: string): TeamRole | null {
  return team.members.find((m) => m.userId === userId)?.role ?? null;
}

function isMember(team: Team, userId: string): boolean {
  return roleOf(team, userId) != null;
}

function isLeader(team: Team, userId: string): boolean {
  return team.leaderId === userId && isMember(team, userId);
}

function isModeratorOrLeader(team: Team, userId: string): boolean {
  return isLeader(team, userId) || roleOf(team, userId) === "moderator";
}

/** DOM-002: free-for-all → any member; restricted → moderators + leader (A-1). */
export function canCreateBet(team: Team, userId: string): boolean {
  if (!isMember(team, userId)) return false;
  return team.accessMode === "free-for-all" || isModeratorOrLeader(team, userId);
}

/** DOM-006: invite-creation permission follows the team's access mode (DOM-002). */
export function canInvite(team: Team, userId: string): boolean {
  return canCreateBet(team, userId);
}

/** Team settings / roster management surface: moderators and the leader. */
export function canManageTeam(team: Team, userId: string): boolean {
  return isModeratorOrLeader(team, userId);
}

/** DOM-011: only the bet creator or a moderator (leader per A-1) closes early. */
export function canCloseBetEarly(team: Team, userId: string, bet: Bet): boolean {
  if (!isMember(team, userId)) return false;
  return bet.creatorId === userId || isModeratorOrLeader(team, userId);
}

/** DOM-018/019: the same resolver set declares the winning option or a void. */
export function canResolveBet(team: Team, userId: string, bet: Bet): boolean {
  return canCloseBetEarly(team, userId, bet);
}

/** DOM-031: leaders and moderators kick members. */
export function canKick(team: Team, userId: string): boolean {
  return isModeratorOrLeader(team, userId);
}

/** DOM-031: leaders and moderators ban (A-4: ban additionally blocks re-join). */
export function canBan(team: Team, userId: string): boolean {
  return isModeratorOrLeader(team, userId);
}

/** DOM-024: coin injection is leader-only — moderators explicitly excluded. */
export function canInjectCoins(team: Team, userId: string): boolean {
  return isLeader(team, userId);
}

/**
 * DOM-033 (assumption in the requirement itself): team deletion is the
 * leader's call — it destroys every member's balance, bets, and history.
 */
export function canDeleteTeam(team: Team, userId: string): boolean {
  return isLeader(team, userId);
}

/** DOM-033: bet deletion follows the same set that closes/resolves it. */
export function canDeleteBet(team: Team, userId: string, bet: Bet): boolean {
  return canCloseBetEarly(team, userId, bet);
}

/** UX-018/DOM-030: any member of the bet's team may comment; no moderation. */
export function canComment(team: Team, userId: string): boolean {
  return isMember(team, userId);
}

/**
 * DOM-005/006 + A-4: an invite code lets anyone in — except someone already on
 * the roster (a double-join would break per-team balances) and someone banned,
 * which is exactly what a ban adds over a kick.
 */
export function canJoinTeam(team: Team, userId: string): boolean {
  return !isMember(team, userId) && !team.bannedUserIds.includes(userId);
}

/**
 * The leader cannot walk out: DOM-001 requires exactly one leader at all times
 * and leadership transfer is an explicitly open spec point, so the leader's
 * only exit is deleting the team (DOM-033). Everyone else may leave.
 */
export function canLeaveTeam(team: Team, userId: string): boolean {
  return isMember(team, userId) && !isLeader(team, userId);
}

// --- 1v1 duels (Extra Phase 2) ------------------------------------------------
//
// Read this paragraph before using any of the six predicates below, because it
// is the one thing they all leave out. THEY ARE ROSTER + ID RULES ONLY. Not one
// of them looks at the clock, and none of them ever will: an unaccepted duel
// past its deadline is expired, and knowing that requires `bet.closesAt`, which
// is the bet's business, not the roster's. `computeDuelPhase(bet, duel, nowMs)`
// in state-machine.ts owns the clock, exactly as `computeEffectiveState` owns
// it for pool bets. A surface that asks only one of the two is a surface that
// offers an Accept button on a duel that lapsed yesterday — which is precisely
// why every doc comment here repeats the warning instead of stating it once.
//
// Their SQL mirrors live in `20260906130100_duel_rpcs.sql`:
// `app.is_duel_participant`, `app.can_resolve_duel`, and `app.can_resolve_bet`
// (which forks on `bets.kind`). `app.can_manage_bet` is NOT widened to admit a
// mediator — three RPCs share it, and letting a mediator in there would hand
// them early-close and delete along with resolution (D6, and the phase's own
// risk 1). The client copy is advice; the RPCs are the enforcement.

/**
 * D9 (owner ruling, 2026-09-06): starting a duel is PLAIN MEMBERSHIP. It is
 * deliberately not `canCreateBet` and deliberately does not read
 * `team.accessMode` — a `restricted` team does not block duels, it forces
 * `anyModerator` on instead (`mustForceAnyModerator` below). DOM-002 rations
 * bets POSTED FOR A TEAM TO WAGER INTO; a duel is a private arrangement
 * between two people who have already agreed to it, so the access mode has
 * nothing here to ration.
 *
 * This has its own body rather than delegating to `isMember` alone through
 * some future alias of `canCreateBet`, and that is not duplication for its own
 * sake: if a later change to DOM-002 edits `canCreateBet`, an alias would
 * silently re-gate duels and quietly undo an owner ruling with no test failing.
 * Keeping the bodies separate makes that a deliberate act instead of a side
 * effect.
 *
 * Roster only — the clock is `computeDuelPhase`'s (see the block above).
 */
export function canStartDuel(team: Team, userId: string): boolean {
  return isMember(team, userId);
}

/**
 * D9's other half, and the reason nothing above needs to know about access
 * modes: in a `restricted` team every duel stores `any_moderator = true`
 * regardless of what the challenger ticked, so a moderator can always step in
 * and resolve it. That is the guarantee the leader keeps in exchange for not
 * being able to ration duels at all.
 *
 * What this function is FOR is rendering — the compose form shows the
 * any-moderator control checked and disabled, with the reason — because the
 * coercion itself belongs to `create_duel`, which reads the team's access mode
 * inside the same transaction that writes the row. It is emphatically NOT a
 * validation rule: `validateDuelDraft` must not reject `anyModerator: false`
 * here, and its doc comment says so at length.
 *
 * Applied at creation, never retroactively (D9). Flipping a team to
 * `restricted` does not rewrite duels already in flight, and flipping it back
 * does not withdraw the guarantee, so never ask this function what a STORED
 * duel's resolver set is — ask the row: `duel.anyModerator`.
 */
export function mustForceAnyModerator(team: Team): boolean {
  return team.accessMode === "restricted";
}

/**
 * Only the challengee answers a challenge, and only while it is still
 * outstanding (D5). Not the challenger — they already committed their stake at
 * creation and cannot accept on the other side; not a moderator, because a
 * duel is not a team matter to arbitrate into existence.
 *
 * Roster + id only. `duel.acceptedAt === null` is a stored fact, not the
 * clock — an unaccepted duel whose deadline has passed still satisfies every
 * condition here and must NOT be acceptable, which `computeDuelPhase` is what
 * tells you (it reads `"expired"`). Check both, always.
 *
 * Affordability is not here either: whether the challengee can cover the stake
 * is `accept_duel`'s call at accept time (DOM-014 is absolute — it refuses with
 * `Not enough coins.` and the UI offers the decline path carrying
 * `void_reason='insufficient-funds'`, D5).
 */
export function canAcceptDuel(team: Team, userId: string, duel: Duel): boolean {
  return (
    isMember(team, userId) &&
    userId === duel.challengeeId &&
    duel.acceptedAt === null
  );
}

/**
 * The mirror of `canAcceptDuel`, and given its own body on purpose even though
 * the two agree today. They are not the same question: accepting has a money
 * precondition that declining never will (D5 — the broke challengee's only
 * move IS to decline, with `void_reason='insufficient-funds'`), so the day a
 * balance check joins accept, an alias here would silently trap that person
 * with no legal action at all. Two bodies, one rule, deliberately.
 *
 * Roster + id only — the clock is `computeDuelPhase`'s. Declining an already
 * expired duel is harmless (both paths void and refund the challenger) but the
 * UI should show it as expired, not as a pending decision.
 */
export function canDeclineDuel(team: Team, userId: string, duel: Duel): boolean {
  return (
    isMember(team, userId) &&
    userId === duel.challengeeId &&
    duel.acceptedAt === null
  );
}

/**
 * D6 + D7 — who may declare the winner of a duel, and the reason resolution
 * forked away from `canResolveBet` instead of widening it.
 *
 * Participants are excluded FIRST and unconditionally: `app.can_manage_bet`
 * answers creator-or-moderator, which on a duel would let a challenger judge
 * their own losing bet, and a moderator who is one of the two participants is
 * excluded by exactly the same rule that excludes the creator (D7). Then the
 * THREE admitted sets, which are additive rather than exclusive: the named
 * mediator; any moderator or the leader (A-1) when the row says so; and any
 * moderator or the leader when the named mediator is no longer on the roster.
 * Whoever acts first resolves it, so a duel is never frozen behind one quiet
 * person.
 *
 * THE THIRD ARM IS D7'S STRANDING GUARANTEE, AND IT IS NOT OPTIONAL. The
 * roadmap states it twice — task 11 ("`app.can_resolve_duel` falls back to the
 * any-moderator pool at read time, so the duel is resolvable by any moderator
 * the moment its named mediator is gone — a runtime check, not a stored
 * reassignment, and nothing is ever stranded") and an exit criterion in its own
 * right ("The named mediator leaves the team; any moderator can still resolve
 * the duel"). Without it, the arithmetic is brutal and silent: a duel with
 * `anyModerator === false` and a mediator who has left has an EMPTY resolver
 * set forever. Both stakes are already debited (D5), `canDeleteDuel` refuses an
 * accepted duel (D6), `close_bet_early` refuses a duel outright, and the
 * departure cascade only fires for a *participant* — so 2 × stake would sit in
 * a `closed` bet that no path in the app can ever settle. That is the one
 * outcome D7 was written to make impossible.
 *
 * It is a READ-TIME fallback and never a stored reassignment: `duel.mediatorId`
 * keeps naming whoever was chosen, so the history row still says who was
 * supposed to judge, and if they re-join the team the pool closes again on its
 * own. That is also exactly why `voidDuelsForDepartingMember` ignores mediators
 * — there is nothing to void, because nothing was stranded.
 *
 * `duel.anyModerator` is read from the ROW, never re-derived from
 * `team.accessMode` — D9 applies at creation and must not be re-applied to a
 * live duel whose team has since changed mode. The third arm does not violate
 * that: it keys on the mediator's ABSENCE FROM THE ROSTER, a fact about
 * `team.members`, and never on the team's access mode.
 *
 * A null `mediatorId` never reaches the third arm and would be wrong there if
 * it did ("nobody was named" is not "the named person left"): a duel with no
 * mediator must have `anyModerator === true` — `bet_duels_has_a_resolver`
 * enforces it in SQL — so the second arm has already answered.
 *
 * Roster + id only; a duel is resolvable once accepted, and whether it is
 * accepted is `computeDuelPhase`'s answer, not this one's. DOM-020 stays
 * excluded: nothing here counts votes, and one named person is the opposite of
 * an N-person consensus threshold — a fallback to the moderator pool is a
 * fallback to A-1's existing role hierarchy, not a quorum.
 */
export function canResolveDuel(team: Team, userId: string, duel: Duel): boolean {
  if (!isMember(team, userId)) return false;
  if (userId === duel.challengerId || userId === duel.challengeeId) return false;
  if (userId === duel.mediatorId) return true;
  if (duel.anyModerator) return isModeratorOrLeader(team, userId);
  // D7's stranding guarantee, evaluated fresh on every read.
  if (duel.mediatorId !== null && !isMember(team, duel.mediatorId)) {
    return isModeratorOrLeader(team, userId);
  }
  return false;
}

/**
 * D6: deletion keeps the ordinary bet rule — `canDeleteBet`, i.e. creator or
 * moderator (A-1) — plus one extra condition that only duels have: it must not
 * be accepted yet. Once both stakes are down, deleting is the challenger's
 * escape hatch from a bet they are losing, so the honest exit after acceptance
 * is a resolution or a void, both of which move money through
 * `app.settle_bet` and leave a history row.
 *
 * Before acceptance there is nothing to protect: the existing delete path's
 * `app.reverse_bet_effects` already refunds the challenger's stake, which is
 * why `delete_bet` needs only the accepted-duel refusal (`A duel can only be
 * deleted before it's accepted.`) and no second reversal path.
 *
 * Roster + id + one stored fact. Not the clock: an EXPIRED unaccepted duel is
 * still deletable by this rule, and that is fine — it is also voidable by the
 * sweep, and both routes refund the same coins to the same person.
 */
export function canDeleteDuel(
  team: Team,
  userId: string,
  bet: Bet,
  duel: Duel,
): boolean {
  return canDeleteBet(team, userId, bet) && duel.acceptedAt === null;
}
