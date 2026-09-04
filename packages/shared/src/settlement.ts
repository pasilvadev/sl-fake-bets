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

/**
 * Team-scoped form of the cascade above — what kick/ban and leaveTeam
 * actually need, since a membership only ever ends in ONE team while the
 * wager list spans every team the user plays in (DOM-013 balances are
 * per-team). Scoping first is what keeps a kick from t-01 out of t-02's pools;
 * the removal decision itself stays in `removeMemberActiveWagers`.
 */
export function removeMemberWagersInTeam(
  userId: string,
  teamId: string,
  bets: readonly Bet[],
  wagers: readonly Wager[],
): Wager[] {
  const teamBets = bets.filter((b) => b.teamId === teamId);
  const teamBetIds = new Set(teamBets.map((b) => b.id));
  const teamWagers = wagers.filter((w) => teamBetIds.has(w.betId));
  const keptIds = new Set(
    removeMemberActiveWagers(userId, teamBets, teamWagers).map((w) => w.id),
  );
  // Filtering the original list (rather than concatenating) keeps order stable.
  return wagers.filter((w) => !teamBetIds.has(w.betId) || keptIds.has(w.id));
}

/**
 * Hard-delete reversal (DOM-033): the deltas that undo a bet's money effects
 * entirely, so deleting it leaves balances and P/L exactly where they were
 * before the first wager. Stakes come back (they left at placement); if the
 * bet was already resolved, its payout and realized P/L are unwound too —
 * otherwise deleted history would silently break `deriveProfitLoss`, which
 * only ever sees the bets that still exist.
 *
 * Deliberately NOT the kick/ban cascade's behavior: there the member's whole
 * per-team balance disappears with the membership, so there is nothing to
 * refund to (decision §4.4). Here every member stays.
 */
export function reverseBet(bet: Bet, wagers: readonly Wager[]): SettlementDelta[] {
  const betWagers = wagers.filter((w) => w.betId === bet.id);

  const stakeByUser = new Map<string, number>();
  for (const w of betWagers) {
    stakeByUser.set(w.userId, (stakeByUser.get(w.userId) ?? 0) + w.amount);
  }

  const settled =
    bet.state === "resolved" && bet.resolution
      ? new Map(
          settleBet(bet, betWagers, bet.resolution).map((d) => [d.userId, d]),
        )
      : new Map<string, SettlementDelta>();

  return [...stakeByUser.entries()].map(([userId, stake]) => {
    const paid = settled.get(userId);
    return {
      userId,
      balanceDelta: stake - (paid?.balanceDelta ?? 0),
      // `0 - x`, not `-x`: negating a plain 0 yields -0, which then travels
      // into stored profitLoss and trips strict equality checks.
      profitLossDelta: 0 - (paid?.profitLossDelta ?? 0),
    };
  });
}
