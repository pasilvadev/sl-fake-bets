/**
 * Formatting helpers for numerals users compare (coins, countdowns, dates).
 * Pure functions — no React, safe on server and client.
 */

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
