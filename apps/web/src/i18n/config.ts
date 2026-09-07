/**
 * The locale set, and the few constants that describe it (plan-i18n-ptbr.md
 * §5 Phase 1, task 2).
 *
 * Deliberately free of `next-intl` imports and of anything server-only: the
 * switcher, the request config, the reconciliation effect and the `users.locale`
 * column all need these four exports, and they live on both sides of the
 * server/client boundary.
 */

import type { Locale } from "@repo/shared";

export type { Locale };

/**
 * D4: `en` is first because it is the source locale, the key authority and the
 * fallback.
 *
 * The union itself lives in `@repo/shared` next to `users.locale`, the column
 * whose CHECK constraint pins the same two values; this is its runtime twin.
 * `satisfies` catches a value here that the column would reject, and
 * `_CoversEveryLocale` below catches the other direction — a locale added to
 * the union and forgotten here, which would type-check everywhere and simply
 * never be offerable.
 */
export const LOCALES = ["en", "pt-BR"] as const satisfies readonly Locale[];

type _CoversEveryLocale =
  Exclude<Locale, (typeof LOCALES)[number]> extends never ? true : never;
const _localesAreComplete: _CoversEveryLocale = true;
void _localesAreComplete;

export const DEFAULT_LOCALE: Locale = "en";

/**
 * The cookie D3 negotiates against. Not `httpOnly` — it is a display
 * preference, not a secret, and the client-side reconciliation effect has to
 * be able to see whether it exists.
 */
export const LOCALE_COOKIE = "NEXT_LOCALE";

/** One year. A language choice is not something to re-ask about every session. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Risk 6: a locale's name is written in its OWN language and is never
 * translated — "Português" reads Português inside the English UI too. That is
 * exactly why this is a constant here and not a `messages/*.json` entry: a
 * catalog would give a future session two places to write it and one of them
 * would eventually get translated.
 */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  "pt-BR": "Português",
};

/**
 * The two-letter form, for the signed-out switcher (D12).
 *
 * Same never-translated rule as LOCALE_LABELS, and the same reason it is not a
 * catalog entry. The auth page has no profile menu to hang a submenu off, so
 * its footer gets `EN · PT` — otherwise a Brazilian arriving with an
 * English-configured browser has no way to switch before signing in.
 */
export const LOCALE_SHORT_LABELS: Record<Locale, string> = {
  en: "EN",
  "pt-BR": "PT",
};

/** `og:locale` wants the underscored BCP-47-ish form Facebook specified. */
export const OG_LOCALES: Record<Locale, string> = {
  en: "en_US",
  "pt-BR": "pt_BR",
};
