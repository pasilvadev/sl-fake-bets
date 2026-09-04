import type { Bet, BetResolution, Wager } from "./types";

/**
 * Pari-mutuel settlement (DOM-016/018/019) — the single module the Phase-2
 * kick/ban cascade and the Phase-7 resolveBet RPC both call unchanged.
 *
 * Money model (decision §4.6): a stake leaves TeamMember.coinBalance the
 * moment the wager is placed, so settlement only emits CREDITS — winner
 * payouts or void refunds — plus the realized profit/loss contribution
 * (DOM-026). It never emits Transaction rows: resolution is not a ledger
 * event (DOM-025).
 */

export interface SettlementDelta {
  userId: string;
  /** Credit to the member's coinBalance (the stake already left at placement). */
  balanceDelta: number;
  /** Realized P/L contribution: payout − stake on a winner; 0 on void/refund. */
  profitLossDelta: number;
}

/**
 * Given a bet, the live wagers, and the declared resolution, compute the
 * per-member deltas. Winner payout = the member's stake on the winning
 * option × pool multiplier, floored once per member (integer math first, so
 * no float drift; no rake per A-3). Void fully refunds every stake
 * (DOM-019). A "winner" nobody backed also refunds — with an empty winning
 * side there is no one to redistribute the pool to.
 */
export function settleBet(
  bet: Bet,
  wagers: readonly Wager[],
  resolution: BetResolution,
): SettlementDelta[] {
  const betWagers = wagers.filter((w) => w.betId === bet.id);

  const stakeByUser = new Map<string, number>();
  for (const w of betWagers) {
    stakeByUser.set(w.userId, (stakeByUser.get(w.userId) ?? 0) + w.amount);
  }

  const winTotal =
    resolution.kind === "winner"
      ? betWagers
          .filter((w) => w.optionId === resolution.winningOptionId)
          .reduce((sum, w) => sum + w.amount, 0)
      : 0;

  if (resolution.kind === "void" || winTotal === 0) {
    return [...stakeByUser.entries()].map(([userId, stake]) => ({
      userId,
      balanceDelta: stake,
      profitLossDelta: 0,
    }));
  }

  const pool = betWagers.reduce((sum, w) => sum + w.amount, 0);

  return [...stakeByUser.entries()].map(([userId, stake]) => {
    const winStake = betWagers
      .filter(
        (w) => w.userId === userId && w.optionId === resolution.winningOptionId,
      )
      .reduce((sum, w) => sum + w.amount, 0);
    const payout = winStake === 0 ? 0 : Math.floor((winStake * pool) / winTotal);
    return { userId, balanceDelta: payout, profitLossDelta: payout - stake };
  });
}

/**
 * Kick/ban wager cascade (DOM-032, decision §4.4): drop the member's wagers
 * from every active (non-resolved) bet — plain removal, no refund, since the
 * per-team balance is deleted with the membership. Pool odds recompute
 * automatically wherever getPoolStats runs over the returned list. Wagers on
 * resolved bets stay untouched.
 */
export function removeMemberActiveWagers(
  userId: string,
  bets: readonly Bet[],
  wagers: readonly Wager[],
): Wager[] {
  const resolvedBetIds = new Set(
    bets.filter((b) => b.state === "resolved").map((b) => b.id),
  );
  return wagers.filter(
    (w) => w.userId !== userId || resolvedBetIds.has(w.betId),
  );
}
