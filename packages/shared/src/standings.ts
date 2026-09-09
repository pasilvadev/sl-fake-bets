import type { TeamMember } from "./types";

/**
 * Richest/Poorest standings (DOM-027/028/029), extracted to one pure function
 * so `team-context.tsx`'s `richest`/`poorest`/`rankBadgeFor` derivation is a
 * call site instead of an inline `useMemo` nobody could unit-test
 * (`agent-docs/found-bugs.md`, "Richest/poorest leaderboard wrong").
 *
 * **Poorest mirrors Richest exactly (owner decision, superseding DOM-028's
 * original "podium of the poor" by realized profit/loss).** Both boards rank
 * by `coinBalance` — descending for Richest, ascending for Poorest — which is
 * what makes Poorest ALWAYS fully populated: every member has a balance, so
 * there is no "filler row" case (the defect the old profit/loss board had the
 * moment fewer than 5 members were in the red) and no empty state to render
 * either. `profitLoss` no longer feeds any leaderboard; it still feeds
 * `CoinDelta` everywhere a resolved bet's own outcome is shown.
 *
 * Ties are broken by `joinedAt` ascending — the earliest joiner ranks first —
 * stated here explicitly rather than left to `Array.prototype.sort`'s
 * stability over a `members` array that happens to already be joinedAt-order
 * (`team-data.ts`'s load and the `add-member` reducer both produce it that
 * way today). That was "arbitrary ties" in the bug report: correct by
 * accident, not by rule, and silently wrong the day something re-sorts the
 * input first.
 */
export interface Standings {
  /** Sorted `coinBalance` descending, ties broken by `joinedAt` ascending. */
  richest: TeamMember[];
  /** The exact reverse ordering — `coinBalance` ascending, same tie-break. */
  poorest: TeamMember[];
  /** userIds in the bottom 5 by balance — the `bottom5` rank badge (DOM-029). */
  bottomFive: ReadonlySet<string>;
}

function compareByBalance(direction: 1 | -1) {
  return (a: TeamMember, b: TeamMember): number =>
    direction * (a.coinBalance - b.coinBalance) ||
    a.joinedAt.localeCompare(b.joinedAt);
}

export function deriveStandings(members: readonly TeamMember[]): Standings {
  const richest = [...members].sort(compareByBalance(-1));
  const poorest = [...members].sort(compareByBalance(1));
  const bottomFive = new Set(poorest.slice(0, 5).map((m) => m.userId));
  return { richest, poorest, bottomFive };
}
