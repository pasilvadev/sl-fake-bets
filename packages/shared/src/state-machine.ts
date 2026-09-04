import type { Bet, BetState } from "./types";

/**
 * closesAt-driven lifecycle (DOM-012): `bet.state` is the stored value; the
 * EFFECTIVE state also counts the clock. A stored-open bet whose closesAt has
 * passed behaves as closed everywhere — no new wagers, resolvable — even
 * before anything persists the transition.
 */
export function computeEffectiveState(bet: Bet, nowMs: number): BetState {
  if (bet.state === "open" && Date.parse(bet.closesAt) <= nowMs) {
    return "closed";
  }
  return bet.state;
}

/** Guard blocking new wagers once a bet is effectively closed (DOM-012/014). */
export function canAcceptWagers(bet: Bet, nowMs: number): boolean {
  return computeEffectiveState(bet, nowMs) === "open";
}
