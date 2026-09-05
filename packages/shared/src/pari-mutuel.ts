import type { Bet, OptionPoolStat, Wager } from "./types";

/**
 * Pari-mutuel pool math (DOM-016): one pool across all options; displayed odds
 * reflect the live pool split. No rake — 100% redistributed (assumption A-3).
 */
export function getPoolStats(bet: Bet, wagers: Wager[]): OptionPoolStat[] {
  const betWagers = wagers.filter((w) => w.betId === bet.id);

  return poolStatsFromTotals(
    bet.options.map((option) => ({
      optionId: option.id,
      label: option.label,
      total: betWagers
        .filter((w) => w.optionId === option.id)
        .reduce((sum, w) => sum + w.amount, 0),
    })),
  );
}

/**
 * The same split, from per-option totals that were summed somewhere else
 * (roadmap Phase 9).
 *
 * `getPoolStats` needs the whole world — a `Bet` with its options and every
 * `Wager` in the team — which is exactly what a share-card preview must not
 * load: UX-024's crawler holds a bet id and no session, and the `bet_preview`
 * RPC answers it with per-option sums and no wagerer identities at all.
 *
 * This is the seam so that stays ONE formula. The share/multiplier rules live
 * here; `getPoolStats` is the adapter for callers that hold wagers. Adding a
 * second copy of `pool / optionTotal` is how a share card starts quoting odds
 * that disagree with the bet page.
 */
export function poolStatsFromTotals(
  options: { optionId: string; label: string; total: number }[],
): OptionPoolStat[] {
  const poolTotal = options.reduce((sum, o) => sum + o.total, 0);

  return options.map(({ optionId, label, total }) => ({
    optionId,
    label,
    total,
    share: poolTotal === 0 ? 0 : total / poolTotal,
    multiplier: total === 0 ? null : poolTotal / total,
  }));
}
