import type { Bet, BetSettlementEntry, TeamMember, Transaction, Wager } from "./types";
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
  // DOM-014's debit half. Deliberately not "balanceAfter < 0": since the owner
  // ruling of 2026-09-05, deleting a resolved bet may leave a member
  // overdrawn, and a CREDIT onto that balance — the leader's injection that
  // digs them out (DOM-024) — is exactly what has to keep working even though
  // its result is still negative. What may never happen is a DEBIT that takes
  // a balance below zero.
  if (input.amount < 0 && balanceAfter < 0) {
    throw new Error("Transaction would take the balance below zero (DOM-014)");
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

/**
 * Bet/duel wins and losses, reshaped for the transaction-history screen
 * (found-bugs item 1: the modal only ever showed grants and rewards, because
 * `resolve_bet` deliberately writes no ledger row — DOM-025/026 above). This
 * is the same replay `deriveProfitLoss` does, one `BetSettlementEntry` per
 * resolved bet the user actually staked on, in bet order — the caller sorts.
 *
 * Same did-not-participate guard as `bet-row.tsx`'s `ResolvedOutcome`: a
 * `settleBet` result with no matching userId means this member never wagered
 * on this bet, and it must not appear as a silent loss.
 */
export function deriveBetSettlementHistory(
  userId: string,
  bets: readonly Bet[],
  wagers: readonly Wager[],
): BetSettlementEntry[] {
  const entries: BetSettlementEntry[] = [];
  for (const bet of bets) {
    if (bet.state !== "resolved" || !bet.resolution) continue;
    const delta = settleBet(bet, wagers, bet.resolution).find(
      (d) => d.userId === userId,
    );
    if (!delta) continue;
    entries.push({
      id: bet.id,
      teamId: bet.teamId,
      userId,
      betKind: bet.kind,
      title: bet.title,
      resolution: bet.resolution,
      profitLossDelta: delta.profitLossDelta,
      createdAt: bet.closesAt,
    });
  }
  return entries;
}
