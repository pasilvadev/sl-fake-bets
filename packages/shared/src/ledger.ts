import type { Bet, TeamMember, Transaction, Wager } from "./types";
import { settleBet } from "./settlement";

/**
 * Transfer ledger (DOM-025, decision §4.6): grants, daily rewards, and leader
 * injections (plus future donations) flow through applyTransaction so the
 * stored balance and the Transaction row's balanceAfter snapshot can never
 * drift apart. Balances stay STORED on the member — never derived by
 * replaying history — and wager stakes/payouts are deliberately not ledger
 * events (DOM-026).
 */

export interface ApplyTransactionInput {
  member: TeamMember;
  teamId: string;
  /** Pre-generated id (see id.ts) so the function stays pure. */
  id: string;
  kind: Transaction["kind"];
  /** Positive = credit, negative = debit (future donations). Non-zero integer. */
  amount: number;
  description: string;
  createdAt: string;
}

/**
 * Apply one ledger entry to a member: returns the updated member plus the
 * Transaction row with a correct balanceAfter snapshot. Ledger entries never
 * touch profitLoss — that aggregates wager outcomes only (DOM-026).
 */
export function applyTransaction(input: ApplyTransactionInput): {
  member: TeamMember;
  transaction: Transaction;
} {
  if (!Number.isInteger(input.amount) || input.amount === 0) {
    throw new Error(
      `Transaction amount must be a non-zero integer, got ${input.amount}`,
    );
  }
  const balanceAfter = input.member.coinBalance + input.amount;
  if (balanceAfter < 0) {
    throw new Error("Transaction would make the balance negative (DOM-014)");
  }
  return {
    member: { ...input.member, coinBalance: balanceAfter },
    transaction: {
      id: input.id,
      teamId: input.teamId,
      userId: input.member.userId,
      kind: input.kind,
      amount: input.amount,
      description: input.description,
      balanceAfter,
      createdAt: input.createdAt,
    },
  };
}

/**
 * Pure recompute of a user's aggregated profit/loss (DOM-026) from resolved
 * bets — the fixture regression check today, Phase 7's consistency guard
 * later. Open/closed stakes are money in flight, not realized P/L.
 */
export function deriveProfitLoss(
  userId: string,
  bets: readonly Bet[],
  wagers: readonly Wager[],
): number {
  let total = 0;
  for (const bet of bets) {
    if (bet.state !== "resolved" || !bet.resolution) continue;
    const delta = settleBet(bet, wagers, bet.resolution).find(
      (d) => d.userId === userId,
    );
    total += delta?.profitLossDelta ?? 0;
  }
  return total;
}
