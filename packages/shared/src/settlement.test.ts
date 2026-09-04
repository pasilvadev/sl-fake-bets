import { describe, expect, it } from "vitest";
import { applyTransaction, deriveProfitLoss } from "./ledger";
import { mockBets, mockTeam, mockTransactions, mockWagers } from "./mock-data";
import {
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
