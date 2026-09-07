"use server";

import { cookies } from "next/headers";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import {
  isLocale,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  type Locale,
} from "./config";

/**
 * Switch the reader's language (plan-i18n-ptbr.md D12, Phase 1 task 11).
 *
 * A Server Action rather than a `document.cookie` write in the browser,
 * deliberately: the cookie is what `i18n/request.ts` negotiates against on the
 * SERVER, so a client-side write would leave the current render disagreeing
 * with the one the next navigation produces — a menu that says Português over
 * a page that is still English until something happens to re-render it. The
 * caller follows this with `router.refresh()`, which re-runs the negotiation
 * with the cookie already in place.
 *
 * Two writes, and only the first is required:
 *
 *   1. The `NEXT_LOCALE` cookie — this device, right now. Not `httpOnly`: it
 *      is a display preference, not a secret, and `locale-sync.tsx` has to be
 *      able to see whether it exists (D3: "cookie present" means "a human
 *      chose this", which is the entire guard against the reconciliation loop
 *      of risk 5).
 *   2. `users.locale` — the account, so the choice crosses devices (UX-027).
 *      Skipped when signed out, and a failure is swallowed: a language switch
 *      that visibly worked must not raise an error because a write nobody
 *      asked for did not land. `users_update_self` scopes the write to the
 *      caller's own row, so `eq("id", user.id)` is belt-and-braces against a
 *      future policy edit, not the thing making it safe.
 *
 * Not validated against the feature flag on purpose. D13 gates what is
 * OFFERABLE — the switcher does not render when `locale-pt-br` is off — and
 * `i18n/request.ts` re-checks the flag on every read, so a stale `pt-BR`
 * cookie written before the flag flipped is simply ignored rather than
 * needing to be scrubbed.
 */
export async function setLocale(locale: Locale): Promise<void> {
  // The argument crosses the network: a Server Action is a public endpoint,
  // and `Locale` is a compile-time claim, not a runtime one.
  if (!isLocale(locale)) return;

  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
    httpOnly: false,
  });

  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) return;

  const { error } = await supabase
    .from("users")
    .update({ locale })
    .eq("id", user.id);

  if (error) {
    console.error("[i18n] could not persist locale to the account:", error.message);
  }
}
