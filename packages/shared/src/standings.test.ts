import { describe, expect, it } from "vitest";
import { deriveStandings } from "./standings";
import { mockTeam } from "./mock-data";
import type { TeamMember } from "./types";

/**
 * DOM-027/028/029 (owner decision: Poorest mirrors Richest by balance —
 * `agent-docs/found-bugs.md`, "Richest/poorest leaderboard wrong"). Covers the
 * two defects the bug report named as independent of which metric won:
 * arbitrary tie-breaking, and no test coverage at all for the derivation.
 */

function member(over: Partial<TeamMember> & Pick<TeamMember, "userId">): TeamMember {
  return {
    role: "member",
    coinBalance: 0,
    profitLoss: 0,
    joinedAt: "2026-08-01T00:00:00Z",
    ...over,
  };
}

describe("deriveStandings — richest/poorest are exact mirrors by coinBalance", () => {
  it("sorts richest descending and poorest as the precise reverse", () => {
    const members = [
      member({ userId: "u-a", coinBalance: 40 }),
      member({ userId: "u-b", coinBalance: 100 }),
      member({ userId: "u-c", coinBalance: 10 }),
    ];
    const { richest, poorest } = deriveStandings(members);
    expect(richest.map((m) => m.userId)).toEqual(["u-b", "u-a", "u-c"]);
    expect(poorest.map((m) => m.userId)).toEqual(["u-c", "u-a", "u-b"]);
  });

  it("reproduces the full mockTeam roster (8 members, no fixture reordering)", () => {
    const { richest, poorest } = deriveStandings(mockTeam.members);
    expect(richest).toHaveLength(mockTeam.members.length);
    expect(poorest).toHaveLength(mockTeam.members.length);
    // Every member appears in both — mirrors, not filters.
    expect(new Set(richest.map((m) => m.userId))).toEqual(
      new Set(mockTeam.members.map((m) => m.userId)),
    );
    // Balance monotonic in both directions. Not asserted as
    // `poorest === [...richest].reverse()`: mockTeam has real balance ties
    // (u-03/u-10 at 80, u-06/u-08 at 65), and the tie-break rule is "earliest
    // joiner first" in BOTH boards independently — a mechanical reversal
    // would instead put the latest joiner of a tied pair first on one board,
    // which is the opposite of what the "ties break by joinedAt" test below
    // pins down.
    for (let i = 1; i < richest.length; i++) {
      expect(richest[i]!.coinBalance).toBeLessThanOrEqual(richest[i - 1]!.coinBalance);
    }
    for (let i = 1; i < poorest.length; i++) {
      expect(poorest[i]!.coinBalance).toBeGreaterThanOrEqual(poorest[i - 1]!.coinBalance);
    }
  });
});

describe("deriveStandings — ties break by joinedAt ascending, not array order", () => {
  it("ranks the earliest joiner first on an exact balance tie, regardless of input order", () => {
    const early = member({ userId: "u-early", coinBalance: 50, joinedAt: "2026-08-01T00:00:00Z" });
    const late = member({ userId: "u-late", coinBalance: 50, joinedAt: "2026-08-05T00:00:00Z" });

    // Fed in with the LATER joiner first — a stable sort over this input
    // order would rank u-late first if the tie-break were merely "whatever
    // Array.prototype.sort leaves alone", which is exactly the bug reported
    // ("Rank 1 among ties is whoever joined earliest" only by accident).
    const { richest, poorest } = deriveStandings([late, early]);
    expect(richest.map((m) => m.userId)).toEqual(["u-early", "u-late"]);
    expect(poorest.map((m) => m.userId)).toEqual(["u-early", "u-late"]);
  });
});

describe("deriveStandings — bottomFive is the bottom 5 by balance, unconditionally", () => {
  it("is always exactly 5 wide once there are at least 5 members, win or lose", () => {
    // All non-negative P/L (nobody has "lost" anything) — the old
    // profit-loss board would have shown its empty state here; balance-based
    // Poorest has no such case.
    const members = Array.from({ length: 7 }, (_, i) =>
      member({ userId: `u-${i}`, coinBalance: i * 10, profitLoss: 0, joinedAt: `2026-08-0${i + 1}T00:00:00Z` }),
    );
    const { bottomFive } = deriveStandings(members);
    expect(bottomFive.size).toBe(5);
    expect(bottomFive).toEqual(new Set(["u-0", "u-1", "u-2", "u-3", "u-4"]));
  });

  it("is narrower than 5 when the team itself is, never padded", () => {
    const members = [member({ userId: "u-1" }), member({ userId: "u-2" })];
    expect(deriveStandings(members).bottomFive).toEqual(new Set(["u-1", "u-2"]));
  });

  it("is empty for an empty roster (defensive — a team always has a leader in practice)", () => {
    expect(deriveStandings([]).bottomFive.size).toBe(0);
  });
});
