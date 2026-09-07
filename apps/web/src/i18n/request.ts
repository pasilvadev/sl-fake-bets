import { match } from "@formatjs/intl-localematcher";
import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { loadRequestFeatureFlags } from "@/lib/data/feature-flags";
import {
  DEFAULT_LOCALE,
  isLocale,
  LOCALE_COOKIE,
  LOCALES,
  type Locale,
} from "./config";
import { messagesFor } from "./messages";

/**
 * Locale negotiation for every render (plan-i18n-ptbr.md D3).
 *
 * ```
 * request:  NEXT_LOCALE cookie  →  Accept-Language (matched)  →  "en"
 * account:  users.locale        →  writes the cookie on mismatch, once, client-side
 * ```
 *
 * The cookie is written **only** by an explicit switch or by reconciliation,
 * never by negotiation. That is what makes "cookie present" mean "a human
 * chose this" — the signal the reconciliation effect in `locale-sync.tsx`
 * needs in order to know when to stay quiet. `Accept-Language` is re-matched
 * per request rather than cached into the cookie because the match is free and
 * because writing it would destroy that distinction.
 *
 * `users.locale` is deliberately NOT read here. Doing so would cost a query
 * (or an RPC) on every navigation, forever, to save one English frame on the
 * first load of a new device whose browser disagrees with the account. D3
 * names that trade and takes the cheap side; `loadTeamData` already selects
 * the column for free.
 *
 * `src/proxy.ts` is equally deliberately uninvolved: it spends a single-use
 * Supabase refresh token per navigation and its comment explains why that must
 * stay the only thing it does. Nothing here needs to run that early — cookies
 * and headers are both readable from inside the render.
 */
export default getRequestConfig(async () => {
  const locale = await negotiateLocale();

  return {
    locale,
    messages: messagesFor(locale),
    // The catalogs are authored `en`-first (D4) and next-intl falls back to
    // `defaultLocale`'s message when a key is missing from the active
    // catalog — so a key that slips past D5's type check renders the English
    // sentence rather than a raw `wagerModal.title`.
    defaultLocale: DEFAULT_LOCALE,
    // `timeZone` is set explicitly because next-intl otherwise warns on every
    // render that server and client may disagree — and here they genuinely
    // can. It is the ONE zone both sides can agree on without asking the
    // browser, and it costs nothing today: `useFormatter` has no callers, and
    // `lib/format.ts` keeps its own compact shapes (D7) with its own date
    // math. The day a surface renders a wall-clock time this becomes a real
    // decision (the reader's zone, resolved client-side after hydration) —
    // recorded here so that day starts from a choice rather than a default.
    timeZone: "UTC",
  };
});

/**
 * The candidate set for this request. `pt-BR` is only offerable when the
 * seeded `locale-pt-br` flag is on (D13) — flag off means a `pt-BR` cookie is
 * ignored, `Accept-Language: pt-BR` gets English, and the app is exactly what
 * UX-026 shipped.
 */
export async function availableLocales(): Promise<readonly Locale[]> {
  const flags = await loadRequestFeatureFlags();
  if (flags["locale-pt-br"]?.enabled) return LOCALES;
  return [DEFAULT_LOCALE];
}

export async function negotiateLocale(): Promise<Locale> {
  const available = await availableLocales();

  const chosen = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(chosen) && available.includes(chosen)) return chosen;

  const requested = parseAcceptLanguage(
    (await headers()).get("accept-language"),
  );
  if (requested.length === 0) return DEFAULT_LOCALE;

  // `match` is what turns `pt`, `pt-PT` and `pt-br` into `pt-BR` — the reason
  // this is a matcher call and not an `includes`. It never returns anything
  // outside the list it was handed, so the cast is total.
  return match(requested, [...available], DEFAULT_LOCALE) as Locale;
}

/**
 * `Accept-Language` → language tags, most-preferred first.
 *
 * Hand-rolled rather than pulling in `negotiator`: the package next-intl uses
 * internally ships no types at its 1.x, `@types/negotiator` still describes
 * 0.6, and this is the whole of what we need from it. Malformed q-values fall
 * back to 1 rather than throwing — a broken header should cost a visitor their
 * preference, not their page.
 */
function parseAcceptLanguage(header: string | null): string[] {
  if (!header) return [];

  return header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params
        .map((p) => /^\s*q\s*=\s*([\d.]+)\s*$/.exec(p))
        .find(Boolean)?.[1];
      const quality = q === undefined ? 1 : Number.parseFloat(q);
      return { tag: tag.trim(), quality: Number.isFinite(quality) ? quality : 1 };
    })
    // `*` is "anything", which is what DEFAULT_LOCALE already means here, and
    // q=0 is an explicit refusal — neither is a candidate.
    .filter(({ tag, quality }) => tag !== "" && tag !== "*" && quality > 0)
    .sort((a, b) => b.quality - a.quality)
    .map(({ tag }) => tag);
}
