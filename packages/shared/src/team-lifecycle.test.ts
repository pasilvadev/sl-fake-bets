import { describe, expect, it } from "vitest";
import { NAME_COLORS } from "./config";
import {
  canBan,
  canComment,
  canCreateBet,
  canDeleteBet,
  canDeleteTeam,
  canInjectCoins,
  canJoinTeam,
  canKick,
  canLeaveTeam,
  canManageTeam,
} from "./permissions";
import { removeMemberWagersInTeam, reverseBet, settleBet } from "./settlement";
import {
  hasExactlyOneLeader,
  validateCommentBody,
  validateInjection,
  validateInviteCode,
  validateProfileDraft,
  validateTeamDraft,
} from "./validation";
import { mockBets, mockTeam, mockUsers, mockWagers } from "./mock-data";
import type { Bet, Team, Wager } from "./types";

/**
 * Phase-2 regression (plan-mvp-roadmap.md §5 Phase 2): the team-lifecycle
 * rules that the single-identity Phase-1/2 frontend cannot exercise by hand —
 * the ban-blocks-rejoin half of A-4, the leader-cannot-leave reading of
 * DOM-001, delete authority per DOM-033, and the team scoping of the DOM-032
 * cascade (a kick from one team must not touch another team's pools).
 */

/** t-01 with the current user's role/leadership swapped, for gate tests. */
function teamAs(overrides: Partial<Team>): Team {
  return { ...mockTeam, ...overrides };
}

const LEADER = "u-01"; // mockTeam.leaderId
const MODERATOR = "u-02";
const MEMBER = "u-04";
const STRANGER = "u-99";

describe("canJoinTeam — invite-code entry (DOM-005/006, A-4)", () => {
  it("lets a stranger in, refuses an existing member and a banned user", () => {
    expect(canJoinTeam(mockTeam, STRANGER)).toBe(true);
    expect(canJoinTeam(mockTeam, MEMBER)).toBe(false);
    expect(canJoinTeam(teamAs({ bannedUserIds: [STRANGER] }), STRANGER)).toBe(false);
  });

  it("keeps blocking a banned user after the membership is gone (ban ≠ kick)", () => {
    const kicked = teamAs({
      members: mockTeam.members.filter((m) => m.userId !== MEMBER),
    });
    const banned = { ...kicked, bannedUserIds: [MEMBER] };
    expect(canJoinTeam(kicked, MEMBER)).toBe(true); // kicked — may return
    expect(canJoinTeam(banned, MEMBER)).toBe(false); // banned — may not
  });
});

describe("canLeaveTeam — DOM-001 exactly-one-leader invariant", () => {
  it("blocks the leader (no transfer path exists) and allows everyone else", () => {
    expect(canLeaveTeam(mockTeam, LEADER)).toBe(false);
    expect(canLeaveTeam(mockTeam, MODERATOR)).toBe(true);
    expect(canLeaveTeam(mockTeam, MEMBER)).toBe(true);
    expect(canLeaveTeam(mockTeam, STRANGER)).toBe(false);
  });

  it("every allowed departure leaves the invariant intact", () => {
    for (const userId of [MODERATOR, MEMBER]) {
      const after = teamAs({
        members: mockTeam.members.filter((m) => m.userId !== userId),
      });
      expect(hasExactlyOneLeader(after), `after ${userId} left`).toBe(true);
    }
  });
});

describe("delete + moderation authority (DOM-024/031/033)", () => {
  const bet = mockBets.find((b) => b.creatorId === MODERATOR) as Bet;

  it("team deletion is leader-only, moderators excluded", () => {
    expect(canDeleteTeam(mockTeam, LEADER)).toBe(true);
    expect(canDeleteTeam(mockTeam, MODERATOR)).toBe(false);
    expect(canDeleteTeam(mockTeam, MEMBER)).toBe(false);
  });

  it("bet deletion follows the creator/moderator set that closes and resolves", () => {
    expect(canDeleteBet(mockTeam, MODERATOR, bet)).toBe(true); // creator + mod
    expect(canDeleteBet(mockTeam, LEADER, bet)).toBe(true); // A-1
    expect(canDeleteBet(mockTeam, MEMBER, bet)).toBe(false);
    expect(
      canDeleteBet(mockTeam, MEMBER, { ...bet, creatorId: MEMBER }),
    ).toBe(true); // own bet
  });

  it("coin injection stays leader-only while kick/ban include moderators", () => {
    expect(canInjectCoins(mockTeam, LEADER)).toBe(true);
    expect(canInjectCoins(mockTeam, MODERATOR)).toBe(false);
    expect(canKick(mockTeam, MODERATOR)).toBe(true);
    expect(canBan(mockTeam, MODERATOR)).toBe(true);
    expect(canKick(mockTeam, MEMBER)).toBe(false);
  });

  it("restricted access mode gates bet creation but never team management", () => {
    const restricted = teamAs({ accessMode: "restricted" });
    expect(canCreateBet(restricted, MEMBER)).toBe(false);
    expect(canCreateBet(restricted, MODERATOR)).toBe(true);
    expect(canCreateBet(restricted, LEADER)).toBe(true);
    expect(canManageTeam(restricted, MEMBER)).toBe(false);
    expect(canComment(restricted, MEMBER)).toBe(true); // DOM-030
    expect(canComment(restricted, STRANGER)).toBe(false);
  });
});

describe("removeMemberWagersInTeam — cascade stays inside one team (DOM-032)", () => {
  const otherTeamBet: Bet = {
    id: "b-t02",
    teamId: "t-02",
    creatorId: MODERATOR,
    title: "other team's open bet",
    options: [
      { id: "b-t02-o1", label: "A" },
      { id: "b-t02-o2", label: "B" },
    ],
    state: "open",
    closesAt: "2026-12-01T00:00:00Z",
    maxWagerPerUser: 100,
    createdAt: "2026-09-01T00:00:00Z",
  };
  const otherTeamWager: Wager = {
    id: "w-t02",
    betId: "b-t02",
    userId: LEADER,
    optionId: "b-t02-o1",
    amount: 40,
    placedAt: "2026-09-02T00:00:00Z",
  };

  it("drops the member's active t-01 wagers and leaves their t-02 wager alone", () => {
    const remaining = removeMemberWagersInTeam(
      LEADER,
      "t-01",
      [...mockBets, otherTeamBet],
      [...mockWagers, otherTeamWager],
    );
    const ids = new Set(remaining.map((w) => w.id));
    expect(ids.has("w-01")).toBe(false); // b-01, open, t-01
    expect(ids.has("w-10")).toBe(false); // b-04, closed, t-01
    expect(ids.has("w-17")).toBe(true); // b-05, resolved — untouched
    expect(ids.has("w-t02")).toBe(true); // different team — untouched
    expect(remaining).toHaveLength(mockWagers.length + 1 - 2);
  });

  it("keeps the surviving list in its original order", () => {
    const input = [...mockWagers, otherTeamWager];
    const remaining = removeMemberWagersInTeam(LEADER, "t-01", mockBets, input);
    const expectedOrder = input
      .filter((w) => remaining.some((r) => r.id === w.id))
      .map((w) => w.id);
    expect(remaining.map((w) => w.id)).toEqual(expectedOrder);
  });
});

describe("Phase-2 validators", () => {
  it("validateTeamDraft requires a name", () => {
    expect(validateTeamDraft({ name: "  ", accessMode: "free-for-all" })).toHaveLength(1);
    expect(validateTeamDraft({ name: "SL Originals", accessMode: "restricted" })).toEqual([]);
  });

  it("validateInviteCode and validateCommentBody only reject blanks", () => {
    expect(validateInviteCode("   ")).toHaveLength(1);
    expect(validateInviteCode("abcd-efgh")).toEqual([]);
    expect(validateCommentBody("\n ")).toHaveLength(1);
    expect(validateCommentBody("easy money")).toEqual([]);
  });

  it("validateInjection takes positive whole amounts only (DOM-024)", () => {
    expect(validateInjection(0)).toHaveLength(1);
    expect(validateInjection(-5)).toHaveLength(1);
    expect(validateInjection(2.5)).toHaveLength(1);
    expect(validateInjection(25)).toEqual([]);
  });

  it("validateProfileDraft requires a name, an avatar and a curated color", () => {
    const valid = { displayName: "Rafa", nameColor: NAME_COLORS[0], avatar: "icon-dice" };
    expect(validateProfileDraft(valid)).toEqual([]);
    expect(validateProfileDraft({ ...valid, displayName: " " })).toHaveLength(1);
    expect(validateProfileDraft({ ...valid, avatar: "" })).toHaveLength(1);
    expect(
      validateProfileDraft({ ...valid, nameColor: "#ff0000" }).map((i) => i.code),
    ).toEqual(["name-color-invalid"]);
  });

  it("NAME_COLORS is the single source the fixtures already draw from (§2.4)", () => {
    expect(NAME_COLORS).toHaveLength(10);
    for (const user of mockUsers) {
      expect(NAME_COLORS, `nameColor of ${user.id}`).toContain(user.nameColor);
    }
  });
});

describe("reverseBet — hard-delete reversal (DOM-033)", () => {
  it("refunds every stake on an unresolved bet and touches no P/L", () => {
    const b01 = mockBets.find((b) => b.id === "b-01") as Bet;
    expect(reverseBet(b01, mockWagers)).toEqual([
      { userId: "u-01", balanceDelta: 30, profitLossDelta: 0 },
      { userId: "u-03", balanceDelta: 20, profitLossDelta: 0 },
      { userId: "u-06", balanceDelta: 25, profitLossDelta: 0 },
      { userId: "u-05", balanceDelta: 10, profitLossDelta: 0 },
    ]);
  });

  it("unwinds a resolved bet back to its pre-wager state (b-05)", () => {
    const b05 = mockBets.find((b) => b.id === "b-05") as Bet;
    const settled = settleBet(b05, mockWagers, b05.resolution!);
    const reversed = reverseBet(b05, mockWagers);

    for (const delta of reversed) {
      const paid = settled.find((d) => d.userId === delta.userId)!;
      const stake = mockWagers
        .filter((w) => w.betId === b05.id && w.userId === delta.userId)
        .reduce((s, w) => s + w.amount, 0);
      // placement (−stake) + settlement (+paid) + reversal == no net movement
      expect(-stake + paid.balanceDelta + delta.balanceDelta).toBe(0);
      expect(paid.profitLossDelta + delta.profitLossDelta).toBe(0);
    }
    expect(reversed).toHaveLength(4);
  });
});
