import { describe, expect, it } from "vitest";
import { applyTransaction, deriveBetSettlementHistory, deriveProfitLoss } from "./ledger";
import {
  mockBets,
  mockTeam,
  mockTeams,
  mockTransactions,
  mockWagers,
} from "./mock-data";
import {
  isRefundResolution,
  removeMemberActiveWagers,
  settleBet,
  type SettlementDelta,
} from "./settlement";
import type { Bet, BetResolution } from "./types";

/**
 * Phase-1 regression (plan-mvp-roadmap.md §5 Phase 1 task 7): feed the
 * resolved fixtures (b-05 winner, b-06 void) through settlement.ts +
 * deriveProfitLoss and assert the outputs reproduce the fixture members'
 * coinBalance/profitLoss. Asserted against member fields, not transactions —
 * the fixture ledger has no payout rows by design (decision §4.6).
 */

function requireResolvedBet(id: string): Bet & { resolution: BetResolution } {
  const bet = mockBets.find((b) => b.id === id);
  if (!bet || bet.state !== "resolved" || !bet.resolution) {
    throw new Error(`fixture bet ${id} must exist and be resolved`);
  }
  return bet as Bet & { resolution: BetResolution };
}

function deltaFor(deltas: SettlementDelta[], userId: string): SettlementDelta {
  const delta = deltas.find((d) => d.userId === userId);
  if (!delta) throw new Error(`no settlement delta for ${userId}`);
  return delta;
}

describe("settleBet — b-05 (winner b-05-o2, pool 135, winning side 60)", () => {
  const b05 = requireResolvedBet("b-05");
  const deltas = settleBet(b05, mockWagers, b05.resolution);

  it("pays winners their pool share (2.25x) and charges losers their stake", () => {
    expect(deltaFor(deltas, "u-02")).toEqual({ userId: "u-02", balanceDelta: 90, profitLossDelta: 50 });
    expect(deltaFor(deltas, "u-06")).toEqual({ userId: "u-06", balanceDelta: 45, profitLossDelta: 25 });
    expect(deltaFor(deltas, "u-01")).toEqual({ userId: "u-01", balanceDelta: 0, profitLossDelta: -15 });
    expect(deltaFor(deltas, "u-04")).toEqual({ userId: "u-04", balanceDelta: 0, profitLossDelta: -60 });
    expect(deltas).toHaveLength(4);
  });

  it("redistributes the whole pool (A-3, exact floors here)", () => {
    expect(deltas.reduce((s, d) => s + d.balanceDelta, 0)).toBe(135);
    expect(deltas.reduce((s, d) => s + d.profitLossDelta, 0)).toBe(0);
  });
});

describe("settleBet — b-06 (void)", () => {
  const b06 = requireResolvedBet("b-06");
  const deltas = settleBet(b06, mockWagers, b06.resolution);

  it("fully refunds every stake with zero P/L impact (DOM-019)", () => {
    expect(deltaFor(deltas, "u-05")).toEqual({ userId: "u-05", balanceDelta: 30, profitLossDelta: 0 });
    expect(deltaFor(deltas, "u-08")).toEqual({ userId: "u-08", balanceDelta: 20, profitLossDelta: 0 });
    expect(deltas).toHaveLength(2);
  });
});

describe("settleBet — winner nobody backed", () => {
  it("refunds every stake (empty winning side has no one to pay)", () => {
    const bet: Bet = {
      id: "b-syn",
      teamId: "t-01",
      creatorId: "u-01",
      title: "synthetic",
      options: [
        { id: "b-syn-o1", label: "A" },
        { id: "b-syn-o2", label: "B" },
      ],
      state: "closed",
      closesAt: "2026-09-01T00:00:00Z",
      maxWagerPerUser: 100,
      /**
       * `kind` is spelled out because `Bet.kind` is REQUIRED (D1, Extra Phase
       * 2) — the `not null default 'pool'` on `bets.kind` is what let that
       * migration skip a backfill, but a TypeScript object literal has no
       * default to inherit, so the compiler asks every synthetic `Bet` in the
       * suite to say which kind it is. Here the answer is `"pool"` and it is
       * load-bearing for what this test claims: the "winner nobody backed"
       * case is a pari-mutuel edge (an empty winning side with a losing side
       * to refund) that a duel cannot reach, because `create_duel` writes both
       * options from the two participants and `max_wager_per_user = stake`
       * makes a third wager structurally impossible. Flipping this to `"duel"`
       * to silence a future error would assert something untrue.
       */
      kind: "pool",
      createdAt: "2026-08-31T00:00:00Z",
    };
    const wagers = [
      { id: "w-syn", betId: "b-syn", userId: "u-03", optionId: "b-syn-o1", amount: 40, placedAt: "2026-08-31T01:00:00Z" },
    ];
    expect(settleBet(bet, wagers, { kind: "winner", winningOptionId: "b-syn-o2" })).toEqual([
      { userId: "u-03", balanceDelta: 40, profitLossDelta: 0 },
    ]);
  });
});

describe("fixture regression — b-05/b-06 reproduce the hand-typed member fields", () => {
  const resolvedBets = mockBets.filter(
    (b): b is Bet & { resolution: BetResolution } =>
      b.state === "resolved" && b.resolution != null,
  );

  it("covers exactly the two resolved fixtures", () => {
    expect(resolvedBets.map((b) => b.id).sort()).toEqual(["b-05", "b-06"]);
  });

  it("deriveProfitLoss reproduces every t-01 member's profitLoss", () => {
    for (const member of mockTeam.members) {
      expect(
        deriveProfitLoss(member.userId, mockBets, mockWagers),
        `profitLoss of ${member.userId}`,
      ).toBe(member.profitLoss);
    }
  });

  it("ledger credits − stakes in flight + settlement credits reproduce every coinBalance", () => {
    for (const member of mockTeam.members) {
      const ledgerTotal = mockTransactions
        .filter((t) => t.teamId === mockTeam.id && t.userId === member.userId)
        .reduce((s, t) => s + t.amount, 0);
      // All mock wagers belong to t-01 bets; stakes leave the balance at placement.
      const stakedTotal = mockWagers
        .filter((w) => w.userId === member.userId)
        .reduce((s, w) => s + w.amount, 0);
      const settledCredits = resolvedBets.reduce(
        (s, bet) =>
          s +
          (settleBet(bet, mockWagers, bet.resolution).find(
            (d) => d.userId === member.userId,
          )?.balanceDelta ?? 0),
        0,
      );
      expect(
        ledgerTotal - stakedTotal + settledCredits,
        `coinBalance of ${member.userId}`,
      ).toBe(member.coinBalance);
    }
  });

  /**
   * The same arithmetic as Phase 7's consistency guard
   * (apps/web/src/lib/data/consistency-guard.ts), applied to EVERY fixture
   * team rather than just the busy one. t-02 and t-03 have no bets, so this is
   * really the check that their balances are backed by ledger rows and their
   * P/L is zero — which is exactly what they were missing before Phase 7, and
   * what supabase/seed.sql now mirrors row for row.
   */
  it("every fixture team's stored balances agree with the events behind them", () => {
    for (const team of mockTeams) {
      const teamBets = mockBets.filter((b) => b.teamId === team.id);
      const betIds = new Set(teamBets.map((b) => b.id));
      const teamWagers = mockWagers.filter((w) => betIds.has(w.betId));

      for (const member of team.members) {
        const ledger = mockTransactions
          .filter((t) => t.teamId === team.id && t.userId === member.userId)
          .reduce((s, t) => s + t.amount, 0);
        const stakes = teamWagers
          .filter((w) => w.userId === member.userId)
          .reduce((s, w) => s + w.amount, 0);
        const credits = teamBets.reduce(
          (s, bet) =>
            s +
            (bet.state === "resolved" && bet.resolution
              ? (settleBet(bet, teamWagers, bet.resolution).find(
                  (d) => d.userId === member.userId,
                )?.balanceDelta ?? 0)
              : 0),
          0,
        );

        expect(
          ledger + credits - stakes,
          `${team.id} coinBalance of ${member.userId}`,
        ).toBe(member.coinBalance);
        expect(
          deriveProfitLoss(member.userId, teamBets, teamWagers),
          `${team.id} profitLoss of ${member.userId}`,
        ).toBe(member.profitLoss);
      }
    }
  });
});

describe("deriveBetSettlementHistory — found-bugs item 1 (bet/duel wins & losses)", () => {
  const b05 = requireResolvedBet("b-05");

  it("one entry per resolved bet the user staked on, matching settleBet's own delta", () => {
    const history = deriveBetSettlementHistory("u-02", mockBets, mockWagers);
    expect(history).toEqual([
      {
        id: "b-05",
        teamId: "t-01",
        userId: "u-02",
        betKind: "pool",
        title: b05.title,
        resolution: b05.resolution,
        refunded: false,
        profitLossDelta: 50,
        createdAt: b05.closesAt,
      },
    ]);
  });

  it("a void refund is 0 P/L, not a loss", () => {
    const history = deriveBetSettlementHistory("u-05", mockBets, mockWagers);
    expect(history).toHaveLength(1);
    const [entry] = history;
    expect(entry?.resolution).toEqual({ kind: "void" });
    expect(entry?.refunded).toBe(true);
    expect(entry?.profitLossDelta).toBe(0);
  });

  it("a \"winner\" nobody backed is a refund, not a push — resolution.kind stays \"winner\"", () => {
    // Same shape as the synthetic duel fixture below, but the declared
    // winner ("o2") has no wagers on it at all: settleBet's void-or-empty-
    // winner branch (settlement.ts) refunds both bettors in full. Regression
    // for the bug this diff fixes — describeBetEntry (transactions-modal.tsx)
    // used to read this as a push because it only checked `resolution.kind`.
    const bet: Bet = {
      id: "b-orphan-winner",
      teamId: "t-01",
      creatorId: "u-01",
      title: "synthetic orphan winner",
      options: [
        { id: "b-orphan-winner-o1", label: "A" },
        { id: "b-orphan-winner-o2", label: "B" },
      ],
      state: "resolved",
      closesAt: "2026-09-05T00:00:00Z",
      maxWagerPerUser: 100,
      resolution: { kind: "winner", winningOptionId: "b-orphan-winner-o2" },
      kind: "pool",
      createdAt: "2026-09-04T00:00:00Z",
    };
    const wagers = [
      {
        id: "w-orphan-1",
        betId: "b-orphan-winner",
        userId: "u-01",
        optionId: "b-orphan-winner-o1",
        amount: 40,
        placedAt: "2026-09-04T00:01:00Z",
      },
      {
        id: "w-orphan-2",
        betId: "b-orphan-winner",
        userId: "u-02",
        optionId: "b-orphan-winner-o1",
        amount: 60,
        placedAt: "2026-09-04T00:02:00Z",
      },
    ];

    expect(isRefundResolution(bet, wagers, bet.resolution!)).toBe(true);

    const history = deriveBetSettlementHistory("u-01", [bet], wagers);
    expect(history).toEqual([
      {
        id: "b-orphan-winner",
        teamId: "t-01",
        userId: "u-01",
        betKind: "pool",
        title: "synthetic orphan winner",
        resolution: { kind: "winner", winningOptionId: "b-orphan-winner-o2" },
        refunded: true,
        profitLossDelta: 0,
        createdAt: "2026-09-05T00:00:00Z",
      },
    ]);
  });

  it("excludes a resolved bet the user never wagered on (did-not-participate)", () => {
    // u-03 has no wager on either resolved fixture (b-05/b-06).
    expect(deriveBetSettlementHistory("u-03", mockBets, mockWagers)).toEqual([]);
  });

  it("excludes open/closed bets even when the user staked on them", () => {
    // u-01 also wagers on b-01 (open) and b-04 (closed) — neither resolved.
    const history = deriveBetSettlementHistory("u-01", mockBets, mockWagers);
    expect(history.map((e) => e.id)).toEqual(["b-05"]);
  });

  it("sums to the same total deriveProfitLoss already reports, for every fixture member", () => {
    for (const member of mockTeam.members) {
      const total = deriveBetSettlementHistory(
        member.userId,
        mockBets,
        mockWagers,
      ).reduce((s, e) => s + e.profitLossDelta, 0);
      expect(total, member.userId).toBe(
        deriveProfitLoss(member.userId, mockBets, mockWagers),
      );
    }
  });

  it("covers a resolved duel with its own betKind, same settlement math as a pool bet", () => {
    const duelBet: Bet = {
      id: "b-duel-syn",
      teamId: "t-01",
      creatorId: "u-07",
      title: "synthetic duel",
      options: [
        { id: "b-duel-syn-o1", label: "u-07" },
        { id: "b-duel-syn-o2", label: "u-06" },
      ],
      state: "resolved",
      closesAt: "2026-09-05T00:00:00Z",
      maxWagerPerUser: 25,
      resolution: { kind: "winner", winningOptionId: "b-duel-syn-o1" },
      kind: "duel",
      createdAt: "2026-09-04T00:00:00Z",
    };
    const wagers = [
      { id: "w-duel-syn-1", betId: "b-duel-syn", userId: "u-07", optionId: "b-duel-syn-o1", amount: 25, placedAt: "2026-09-04T00:01:00Z" },
      { id: "w-duel-syn-2", betId: "b-duel-syn", userId: "u-06", optionId: "b-duel-syn-o2", amount: 25, placedAt: "2026-09-04T00:02:00Z" },
    ];
    expect(deriveBetSettlementHistory("u-07", [duelBet], wagers)).toEqual([
      {
        id: "b-duel-syn",
        teamId: "t-01",
        userId: "u-07",
        betKind: "duel",
        title: "synthetic duel",
        resolution: { kind: "winner", winningOptionId: "b-duel-syn-o1" },
        refunded: false,
        profitLossDelta: 25,
        createdAt: "2026-09-05T00:00:00Z",
      },
    ]);
  });
});

describe("removeMemberActiveWagers — kick/ban cascade (DOM-032, decision §4.4)", () => {
  it("drops the member's wagers on open/closed bets, keeps resolved ones", () => {
    const remaining = removeMemberActiveWagers("u-01", mockBets, mockWagers);
    const remainingIds = new Set(remaining.map((w) => w.id));
    expect(remainingIds.has("w-01")).toBe(false); // b-01, open
    expect(remainingIds.has("w-10")).toBe(false); // b-04, closed
    expect(remainingIds.has("w-17")).toBe(true); // b-05, resolved — untouched
    expect(remaining).toHaveLength(mockWagers.length - 2);
    expect(remaining.filter((w) => w.userId !== "u-01")).toHaveLength(
      mockWagers.filter((w) => w.userId !== "u-01").length,
    );
  });
});

describe("applyTransaction — ledger entries (DOM-025, decision §4.6)", () => {
  const member = { userId: "u-x", role: "member" as const, coinBalance: 40, profitLoss: -10, joinedAt: "2026-09-01T00:00:00Z" };
  const base = { member, teamId: "t-01", id: "tx-test", description: "test", createdAt: "2026-09-04T00:00:00Z" };

  it("updates the stored balance, snapshots balanceAfter, never touches profitLoss", () => {
    const { member: updated, transaction } = applyTransaction({ ...base, kind: "injection", amount: 25 });
    expect(updated.coinBalance).toBe(65);
    expect(updated.profitLoss).toBe(-10);
    expect(transaction.balanceAfter).toBe(65);
    expect(transaction.userId).toBe("u-x");
    expect(member.coinBalance).toBe(40); // input untouched (pure)
  });

  it("rejects a debit below zero (DOM-014) and zero/non-integer amounts", () => {
    expect(() => applyTransaction({ ...base, kind: "donation", amount: -41 })).toThrow();
    expect(() => applyTransaction({ ...base, kind: "injection", amount: 0 })).toThrow();
    expect(() => applyTransaction({ ...base, kind: "injection", amount: 2.5 })).toThrow();
  });
});
