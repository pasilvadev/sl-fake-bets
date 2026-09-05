import type { Bet, Team, TeamRole } from "./types";

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
