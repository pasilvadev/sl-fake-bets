import { describe, expect, it } from "vitest";
import { CONFIG } from "./config";
import {
  inviteCreationBlocker,
  isInviteLive,
  liveInvites,
} from "./invites";
import { canRevokeInvite } from "./permissions";
import type { Team, TeamInvite } from "./types";

/**
 * `plan-invite-links.md` Phase 2 task 9 — the first tests for `invites.ts`
 * (new this plan) and `canRevokeInvite` (new this plan). A small dedicated
 * fixture, in `duel.test.ts`'s spirit rather than `team-lifecycle.test.ts`'s:
 * this file's whole story is invite links, so it wants a team whose every row
 * exists to be a case under test, not one that also has to keep reconciling
 * against a ledger built for other phases.
 */

const NOW = Date.parse("2026-09-07T12:00:00Z");
const HOUR = 60 * 60 * 1000;

const LEADER = "u-ld";
const MODERATOR = "u-mod";
const MEMBER = "u-mem";
const FORMER_MEMBER = "u-left"; // made a link, then left the team
const STRANGER = "u-99";

const baseTeam: Team = {
  id: "t-inv",
  name: "Invite Fixtures",
  leaderId: LEADER,
  accessMode: "free-for-all",
  invites: [],
  bannedUserIds: [],
  createdAt: "2026-09-01T00:00:00Z",
  members: [
    { userId: LEADER, role: "moderator", coinBalance: 100, profitLoss: 0, joinedAt: "2026-09-01T00:00:00Z" },
    { userId: MODERATOR, role: "moderator", coinBalance: 100, profitLoss: 0, joinedAt: "2026-09-01T00:00:00Z" },
    { userId: MEMBER, role: "member", coinBalance: 100, profitLoss: 0, joinedAt: "2026-09-01T00:00:00Z" },
    // FORMER_MEMBER is deliberately absent from this roster — see the
    // "creator who left" case in the canRevokeInvite describe below, which is
    // the entire reason this row is missing rather than present-and-unused.
  ],
};

/** `baseTeam` with its `invites` swapped for the case under test. */
function teamWithInvites(invites: TeamInvite[]): Team {
  return { ...baseTeam, invites };
}

const permanent: TeamInvite = {
  id: "inv-permanent",
  code: "permanent-link",
  createdBy: LEADER,
  createdAt: "2026-09-01T00:00:00Z",
  expiresAt: null,
};

describe("isInviteLive — D1/D3", () => {
  it("a permanent link (expiresAt null) is always live, regardless of now", () => {
    expect(isInviteLive(permanent, NOW)).toBe(true);
    expect(isInviteLive(permanent, NOW + 1000 * 365 * 24 * HOUR)).toBe(true);
  });

  it("a temporary link with a future expiresAt is live", () => {
    const invite: TeamInvite = { ...permanent, expiresAt: new Date(NOW + HOUR).toISOString() };
    expect(isInviteLive(invite, NOW)).toBe(true);
  });

  it("a temporary link with a past expiresAt is not live", () => {
    const invite: TeamInvite = { ...permanent, expiresAt: new Date(NOW - HOUR).toISOString() };
    expect(isInviteLive(invite, NOW)).toBe(false);
  });

  it("expires AT the boundary, not after it — now === expiresAt already reads as dead", () => {
    const invite: TeamInvite = { ...permanent, expiresAt: new Date(NOW).toISOString() };
    expect(isInviteLive(invite, NOW)).toBe(false);
  });
});

describe("liveInvites — ordering: permanent first, then soonest-to-expire (D7)", () => {
  const expiredTemp: TeamInvite = {
    id: "inv-expired",
    code: "expired-link",
    createdBy: MEMBER,
    createdAt: "2026-09-01T00:00:00Z",
    expiresAt: new Date(NOW - HOUR).toISOString(),
  };
  const soonTemp: TeamInvite = {
    id: "inv-soon",
    code: "soon-link",
    createdBy: MEMBER,
    createdAt: "2026-09-01T00:00:00Z",
    expiresAt: new Date(NOW + HOUR).toISOString(),
  };
  const laterTemp: TeamInvite = {
    id: "inv-later",
    code: "later-link",
    createdBy: MODERATOR,
    createdAt: "2026-09-01T00:00:00Z",
    expiresAt: new Date(NOW + 5 * HOUR).toISOString(),
  };
  // Deliberately not inserted in the order the assertion expects — the point
  // is that `liveInvites` sorts, it does not merely echo array order back.
  const team = teamWithInvites([laterTemp, expiredTemp, permanent, soonTemp]);

  it("drops the expired row and orders permanent, then ascending by expiresAt", () => {
    expect(liveInvites(team, NOW).map((i) => i.id)).toEqual(["inv-permanent", "inv-soon", "inv-later"]);
  });
});

describe("inviteCreationBlocker — D6 (cap) and D8 (second permanent)", () => {
  it("refuses a new permanent link while one is already live", () => {
    const team = teamWithInvites([permanent]);
    expect(inviteCreationBlocker(team, NOW, false)).toBe("invite-permanent-exists");
  });

  it("allows a permanent link when none is currently live (revoked, or never made)", () => {
    const team = teamWithInvites([]);
    expect(inviteCreationBlocker(team, NOW, false)).toBeNull();
  });

  it("allows a temporary link below the cap, even alongside a live permanent", () => {
    const team = teamWithInvites([permanent]);
    expect(inviteCreationBlocker(team, NOW, true)).toBeNull();
  });

  it(`refuses a new temporary link at exactly ${CONFIG.INVITE_MAX_LIVE_TEMPORARY_PER_TEAM} live ones`, () => {
    const liveTemp = (n: number): TeamInvite => ({
      id: `inv-cap-${n}`,
      code: `cap-link-${n}`,
      createdBy: MEMBER,
      createdAt: "2026-09-01T00:00:00Z",
      expiresAt: new Date(NOW + HOUR).toISOString(),
    });
    const tenLive = Array.from({ length: CONFIG.INVITE_MAX_LIVE_TEMPORARY_PER_TEAM }, (_, i) => liveTemp(i));
    const atCap = teamWithInvites(tenLive);
    expect(inviteCreationBlocker(atCap, NOW, true)).toBe("invite-temp-cap");

    // One under the cap is still fine — the boundary is `>=`, not `>`.
    const underCap = teamWithInvites(tenLive.slice(1));
    expect(inviteCreationBlocker(underCap, NOW, true)).toBeNull();
  });

  it("an expired temporary link does not count against the cap", () => {
    const expiredTemp: TeamInvite = {
      id: "inv-expired-cap",
      code: "expired-cap-link",
      createdBy: MEMBER,
      createdAt: "2026-09-01T00:00:00Z",
      expiresAt: new Date(NOW - HOUR).toISOString(),
    };
    const nineLive = Array.from({ length: CONFIG.INVITE_MAX_LIVE_TEMPORARY_PER_TEAM - 1 }, (_, i) => ({
      ...expiredTemp,
      id: `inv-live-${i}`,
      expiresAt: new Date(NOW + HOUR).toISOString(),
    }));
    const team = teamWithInvites([...nineLive, expiredTemp]);
    expect(inviteCreationBlocker(team, NOW, true)).toBeNull();
  });
});

describe("canRevokeInvite — D5: leader, any moderator, or whoever made the link", () => {
  const ownLink: TeamInvite = {
    id: "inv-own",
    code: "own-link",
    createdBy: MEMBER,
    createdAt: "2026-09-01T00:00:00Z",
    expiresAt: null,
  };

  it("the leader may revoke anyone's link", () => {
    expect(canRevokeInvite(baseTeam, LEADER, ownLink)).toBe(true);
  });

  it("any moderator may revoke anyone's link", () => {
    expect(canRevokeInvite(baseTeam, MODERATOR, ownLink)).toBe(true);
  });

  it("the creator, still on the roster, may revoke their own link", () => {
    expect(canRevokeInvite(baseTeam, MEMBER, ownLink)).toBe(true);
  });

  it("an ordinary member cannot revoke someone else's link", () => {
    expect(canRevokeInvite(baseTeam, MEMBER, { ...ownLink, createdBy: LEADER })).toBe(false);
  });

  it("the creator loses all power over their own link the moment they leave the team", () => {
    const madeByFormerMember: TeamInvite = { ...ownLink, createdBy: FORMER_MEMBER };
    expect(canRevokeInvite(baseTeam, FORMER_MEMBER, madeByFormerMember)).toBe(false);
  });

  it("a stranger with no connection to the link may not revoke it", () => {
    expect(canRevokeInvite(baseTeam, STRANGER, ownLink)).toBe(false);
  });
});
