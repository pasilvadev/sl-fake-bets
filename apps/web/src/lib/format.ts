/**
 * Formatting helpers for numerals users compare (coins, countdowns, dates)
 * and for the one state label whose text depends on stored data.
 * Pure functions — no React, safe on server and client.
 *
 * Every one of them takes the active `locale` as its first argument
 * (plan-i18n-ptbr.md D7, Phase 1 task 8). A parameter rather than a
 * `useFormatter()` read at the call site, deliberately: it is what keeps this
 * module pure and server-safe, which the paragraph above promises and which
 * the OG-card path in `lib/data/bet-preview.ts` may yet need. Client callers
 * get the value from next-intl's `useLocale()`, which our `AppConfig`
 * augmentation narrows to exactly this union — no guard needed.
 *
 * The unit letters and the handful of words below come from the `format`
 * namespace of the message catalogs, read directly rather than through a React
 * hook. That is what lets `NEXT_PUBLIC_I18N_DEBUG=keys` reveal a key for a
 * countdown too, instead of stopping at the strings that happen to pass
 * through a component.
 */

import type { BetVoidReason } from "@repo/shared";
import type { Locale } from "@/i18n/config";
import { messagesFor } from "@/i18n/messages";

function words(locale: Locale) {
  return messagesFor(locale).format;
}

/**
 * Grouped integer, no sign. 12450 -> "12,450" (en) / "12.450" (pt-BR).
 *
 * The separator is the whole reason this is locale-aware; the shape is not
 * otherwise negotiable, because §3 renders these in mono `tabular-nums` so a
 * balance can be scanned without jitter as it updates.
 */
export function formatCoins(locale: Locale, n: number): string {
  return new Intl.NumberFormat(locale).format(Math.round(n));
}

/**
 * Countdown label for a bet's closesAt timestamp.
 * "3d 4h" (>=1 day) | "4h 12m" (>=1 hour) | "43m" (>=5 min) | "2m 10s" (<5 min)
 * msLeft <= 0 => the `format.closed` label.
 *
 * D7: this stays compact in every locale and is **not** replaced by
 * `Intl.RelativeTimeFormat`, which renders `em 2 horas` where the 40px ticker
 * and the bet row have room for `2h`. Only the unit letters are localized.
 */
export function formatTimeLeft(
  locale: Locale,
  closesAt: string,
  now: number,
): { label: string; msLeft: number } {
  const msLeft = new Date(closesAt).getTime() - now;
  const f = words(locale);

  if (msLeft <= 0) {
    return { label: f.closed, msLeft };
  }

  const totalSeconds = Math.floor(msLeft / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor(totalSeconds / 3600) % 24;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const seconds = totalSeconds % 60;

  let label: string;
  if (days >= 1) {
    label = `${days}${f.day} ${hours}${f.hour}`;
  } else if (hours >= 1) {
    label = `${hours}${f.hour} ${minutes}${f.minute}`;
  } else if (minutes >= 5) {
    label = `${minutes}${f.minute}`;
  } else {
    label = `${minutes}${f.minute} ${seconds}${f.second}`;
  }

  return { label, msLeft };
}

/**
 * "2h ago" / "há 2h" — relative-past label for an ISO timestamp.
 *
 * The frame is a message (`format.ago`) rather than a suffix, because
 * Portuguese puts it in front: English appends "ago", pt-BR prepends "há".
 * Same D7 reasoning as above for keeping the value itself two characters.
 */
export function formatRelativePast(
  locale: Locale,
  iso: string,
  now: number,
): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const seconds = Math.floor(diff / 1000);
  const f = words(locale);

  if (seconds < 60) return f.justNow;

  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return ago(f.ago, `${minutes}${f.minute}`);

  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return ago(f.ago, `${hours}${f.hour}`);

  const days = Math.floor(diff / 86400000);
  return ago(f.ago, `${days}${f.day}`);
}

/**
 * `format.ago`'s single `{value}` placeholder, filled by hand.
 *
 * Not an ICU call: there is no plural and no select here — the value is
 * already a formatted two-character token — and running the message through
 * next-intl would mean handing this pure module a translator instance.
 */
function ago(frame: string, value: string): string {
  return frame.replace("{value}", value);
}

/** "Sep 3" (en) / "3 de set" (pt-BR) — short calendar date for an ISO timestamp. */
export function formatShortDate(locale: Locale, iso: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
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
 *
 * The five suffixes now live in the `state.void` namespace (Phase 1 task 8).
 * The switch stays here rather than becoming `t(\`state.void.${reason}\`)` at
 * the call site for two reasons: `undefined` and `"mediator"` deliberately
 * collapse to one label, which a key template cannot express, and both callers
 * are exhaustive over `BetVoidReason` today — the compiler is what catches a
 * sixth reason being added, and it would stop doing that.
 */
export function formatVoidLabel(
  locale: Locale,
  reason: BetVoidReason | undefined,
): string {
  const v = messagesFor(locale).state.void;

  switch (reason) {
    case "expired":
      return v.expired;
    case "declined":
      return v.declined;
    case "insufficient-funds":
      return v.insufficientFunds;
    case "participant-left":
      return v.participantLeft;
    case "mediator":
    case undefined:
      return v.refunded;
  }
}
