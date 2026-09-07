import type { Bet, BetState, Duel } from "./types";

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

/**
 * Where a duel is in its life (Extra Phase 2, D8 half (a)). Four values, and
 * deliberately NOT a fifth `BetState`: `bets.state` still admits exactly
 * `open→closed→resolved` and `enforce_bet_state_transition` stays byte-for-byte
 * unchanged (D1). This is a VIEW over a bet and its duel row, computed, never
 * stored.
 */
export type DuelPhase = "pending" | "expired" | "accepted" | "settled";

/**
 * `computeEffectiveState`'s duel counterpart, and the single function every
 * duel surface asks instead of re-deriving the rule from `acceptedAt` and a
 * date. Same principle as its neighbour above: the stored row says what has
 * been persisted, the EFFECTIVE answer also counts the clock.
 *
 * D8 half (a) is the whole reason it exists. Expiry is lazy — there is no
 * scheduled job voiding stale challenges, on purpose: this deployment pauses
 * after 7 idle days (design-scale-and-free-tier.md §2.6), so "the sweeper has
 * not run for a week" is the expected case, not an outage, and a duel's money
 * is a stronger argument for that rule than chat's retention was, not a weaker
 * one. So an unaccepted duel past its deadline reads `"expired"` HERE, before
 * anything has persisted a thing. Half (b) — `app.expire_stale_duels`, swept on
 * team load and before every duel write — is what makes the refund real. (a) is
 * what makes the screen honest in the meantime; the two must agree, and they do
 * because both test the same `closes_at <= now()`.
 *
 * The order of the tests is load-bearing:
 *  1. `resolved` wins over everything. A settled duel is settled however it got
 *     there — mediator ruling, decline, expiry sweep, participant cascade — and
 *     its void reason (`bet.resolution.reason`, D3) is what distinguishes those
 *     for the history row. Testing the clock first would report a duel that was
 *     resolved yesterday as "expired" today, since `closesAt` is in the past for
 *     every duel that ever finished.
 *  2. Accepted beats the clock too, and for the same reason inverted: accepting
 *     sets `closes_at = now()` (D2 — a duel does exactly what
 *     `close_bet_early` does), so an accepted duel's deadline is ALWAYS in the
 *     past. Test expiry before acceptance and every live duel awaiting a
 *     ruling would read "expired" the instant it was accepted.
 *  3. Only then the deadline, which by elimination is being asked of an
 *     unaccepted, unresolved challenge — the one case where it means anything.
 *
 * Note what this does not answer: WHO may act (permissions.ts's `canAcceptDuel`
 * / `canResolveDuel` / `canDeleteDuel`, which are roster+id rules and never
 * look at the clock). Surfaces need both, always, and each half's comment
 * points at the other because checking one and forgetting the other is the
 * single most likely bug in Extra Phase 3.
 */
export function computeDuelPhase(bet: Bet, duel: Duel, nowMs: number): DuelPhase {
  if (bet.state === "resolved") return "settled";
  if (duel.acceptedAt !== null) return "accepted";
  if (Date.parse(bet.closesAt) <= nowMs) return "expired";
  return "pending";
}
