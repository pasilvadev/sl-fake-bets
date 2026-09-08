import { CONFIG } from "./config";
import type { Team, TeamInvite } from "./types";

/**
 * Pure, `now`-injected selectors over `Team.invites` — this feature's
 * counterpart to `state-machine.ts`'s `computeEffectiveState`/
 * `computeDuelPhase` (`plan-invite-links.md`, Phase 2 task 3).
 *
 * The shape is deliberate and mirrors D3/D7 of that plan exactly: expiry is
 * lazy and is never applied at load time. `Team.invites` (the data layer's
 * read, or `mock-data.ts`'s fixture) already carries only the NON-REVOKED
 * rows — revocation is the database's fact, and a revoked link is simply
 * absent from the array by the time it reaches here. What every function
 * below adds is the clock: a `now` a caller injects, exactly like
 * `computeDuelPhase(bet, duel, nowMs)`, so a modal left open for twenty
 * minutes shows a 24-hour link die at the right second instead of showing a
 * stale list until the next reload. None of this ever talks to the network;
 * the RPCs (`create_invite_code`/`revoke_invite_code`,
 * `20260907150000_invite_links.sql`) are the actual authority and re-check
 * everything here against the SERVER's clock regardless of what a stale
 * screen still shows (D3's own risk 3).
 */

/**
 * D1/D3: an invite is live when it has not expired. `expiresAt === null` is
 * the permanent case (UX-005's default, never touched by the clock at all);
 * otherwise it is live strictly until the instant it lapses — `now ===
 * expiresAt` reads as expired, the same "at the boundary it's over" rule
 * `computeDuelPhase` applies to `closesAt` via `<=`.
 *
 * Deliberately does NOT look at revocation: see the file header for why
 * `TeamInvite` carries no `revokedAt` for this to check.
 */
export function isInviteLive(invite: TeamInvite, now: number): boolean {
  return invite.expiresAt === null || Date.parse(invite.expiresAt) > now;
}

/**
 * Every live invite, permanent first and then by `expiresAt` ascending (the
 * soonest-to-die 24-hour link reads above one with more time left) — the
 * order `invite-modal.tsx`'s link-manager list renders in, unmassaged. D1's
 * one-live-permanent-per-team rule means the permanent branch below should
 * never see more than one candidate in practice; the tie is broken to `0`
 * anyway rather than left to `Array.prototype.sort`'s unspecified behaviour
 * on equal keys, because a comparator that can return NaN or drop a case is a
 * worse bug than one extra branch.
 */
export function liveInvites(team: Team, now: number): TeamInvite[] {
  return team.invites
    .filter((invite) => isInviteLive(invite, now))
    .sort((a, b) => {
      if (a.expiresAt === null || b.expiresAt === null) {
        return a.expiresAt === b.expiresAt ? 0 : a.expiresAt === null ? -1 : 1;
      }
      return Date.parse(a.expiresAt) - Date.parse(b.expiresAt);
    });
}

/**
 * The team's one live permanent link, or `null` when it has been revoked and
 * nobody has made a new one yet (D8: creating a second one is refused, never
 * silent, so this is never ambiguous about WHICH permanent link is "the"
 * one). `invite-modal.tsx`'s composer disables the "Permanent" option
 * precisely when this is non-null.
 */
export function permanentInvite(team: Team, now: number): TeamInvite | null {
  return team.invites.find((invite) => invite.expiresAt === null && isInviteLive(invite, now)) ?? null;
}

/** Every live 24-hour link — D6's cap counts exactly this list's length. */
export function liveTemporaryInvites(team: Team, now: number): TeamInvite[] {
  return team.invites.filter((invite) => invite.expiresAt !== null && isInviteLive(invite, now));
}

/**
 * D6/D8's client half: why a NEW link of the requested kind would be refused
 * right now, or `null` when it would go through. Read before the round trip
 * so the composer can disable the blocked option and show its reason
 * (`invite-modal.tsx`) instead of letting a person submit into a refusal —
 * but this is advice, not enforcement: `create_invite_code` re-checks both
 * rules inside the same transaction as the insert and is what actually raises
 * `SLI01`/`SLI02` (D4's whole reason for making both writes RPCs), because a
 * concurrent create from another tab can always land between this read and
 * that write.
 *
 * `temporary` names the KIND being requested, not the kind already on the
 * team — asking "can I make a permanent one" while a live temporary exists is
 * always `null` here; only a second permanent, or an eleventh live temporary,
 * is ever blocked.
 */
export function inviteCreationBlocker(
  team: Team,
  now: number,
  temporary: boolean,
): "invite-permanent-exists" | "invite-temp-cap" | null {
  if (!temporary) {
    return permanentInvite(team, now) !== null ? "invite-permanent-exists" : null;
  }
  return liveTemporaryInvites(team, now).length >= CONFIG.INVITE_MAX_LIVE_TEMPORARY_PER_TEAM
    ? "invite-temp-cap"
    : null;
}
