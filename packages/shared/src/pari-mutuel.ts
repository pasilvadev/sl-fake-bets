import type { Bet, OptionPoolStat, Wager } from "./types";

/**
 * Pari-mutuel pool math (DOM-016): one pool across all options; displayed odds
 * reflect the live pool split. No rake — 100% redistributed (assumption A-3).
 */
export function getPoolStats(bet: Bet, wagers: Wager[]): OptionPoolStat[] {
  const betWagers = wagers.filter((w) => w.betId === bet.id);
  const poolTotal = betWagers.reduce((sum, w) => sum + w.amount, 0);

  return bet.options.map((option) => {
    const optionTotal = betWagers
      .filter((w) => w.optionId === option.id)
      .reduce((sum, w) => sum + w.amount, 0);
    return {
      optionId: option.id,
      label: option.label,
      total: optionTotal,
      share: poolTotal === 0 ? 0 : optionTotal / poolTotal,
      multiplier: optionTotal === 0 ? null : poolTotal / optionTotal,
    };
  });
}
