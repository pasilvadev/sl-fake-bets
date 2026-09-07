/**
 * Formatting helpers for numerals users compare (coins, countdowns, dates)
 * and for the one state label whose text depends on stored data.
 * Pure functions — no React, safe on server and client.
 */

import type { BetVoidReason } from "@repo/shared";

/** Comma-grouped integer, no sign. e.g. 12450 -> "12,450" */
export function formatCoins(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/**
 * Countdown label for a bet's closesAt timestamp.
 * "3d 4h" (>=1 day) | "4h 12m" (>=1 hour) | "43m" (>=5 min) | "2m 10s" (<5 min)
 * msLeft <= 0 => label "closed".
 */
export function formatTimeLeft(
  closesAt: string,
  now: number,
): { label: string; msLeft: number } {
  const msLeft = new Date(closesAt).getTime() - now;

  if (msLeft <= 0) {
    return { label: "closed", msLeft };
  }

  const totalSeconds = Math.floor(msLeft / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor(totalSeconds / 3600) % 24;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const seconds = totalSeconds % 60;

  let label: string;
  if (days >= 1) {
    label = `${days}d ${hours}h`;
  } else if (hours >= 1) {
    label = `${hours}h ${minutes}m`;
  } else if (minutes >= 5) {
    label = `${minutes}m`;
  } else {
    label = `${minutes}m ${seconds}s`;
  }

  return { label, msLeft };
}

/** "2h ago", "3d ago" — relative-past label for an ISO timestamp. */
export function formatRelativePast(iso: string, now: number): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const seconds = Math.floor(diff / 1000);

  if (seconds < 60) return "just now";

  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(diff / 86400000);
  return `${days}d ago`;
}

/** "Sep 3" — short calendar date for an ISO timestamp. */
export function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/**
 * The §5.2 void label, with D3's reason as a suffix (Extra Phase 3, task 8).
 *
 * A void is still a void — every stake refunded, zero realized P/L, one
 * treatment (rail removed, one thin 68° hairline across the row, N6 label).
 * The reason only changes the words, and it changes them because "void" alone
 * was not an answer to *why*: the owner's requirement is that history say the
 * challengee **couldn't afford it** rather than the flat refusal `declined`
 * would imply.
 *
 * **Rust is banned here**, deliberately and by name. §2.3b puts "open/closed/
 * void state (void is a refund, not a loss — it stays N5/N6)" in its
 * where-rust-is-banned list, and every suffix below reads like a failure
 * without being one: nobody lost coins in any of them. The caller keeps the
 * label in `text-muted-foreground`. (N5 is the void CONCEPT's token and the
 * hairline's weight; the letters are N6, because §2.1 bans N5 for uppercase
 * label text at any apparent size — 3.59:1.)
 *
 * `undefined` is "voided, reason not recorded", not "voided for some other
 * reason": the column is nullable and nothing backfilled it, so every void
 * written before Extra Phase 2 legitimately has none. It shares the plain
 * label with `"mediator"` because a human resolver calling a draw is exactly
 * what an unrecorded void used to mean.
 */
export function formatVoidLabel(reason: BetVoidReason | undefined): string {
  switch (reason) {
    case "expired":
      return "VOID · NOT ACCEPTED IN TIME";
    case "declined":
      return "VOID · DECLINED";
    case "insufficient-funds":
      return "VOID · COULDN'T COVER IT";
    case "participant-left":
      return "VOID · PLAYER LEFT";
    case "mediator":
    case undefined:
      return "VOID · REFUNDED";
  }
}
