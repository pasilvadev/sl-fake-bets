"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { setLocale } from "@/i18n/actions";
import { LOCALE_COOKIE } from "@/i18n/config";
import { useFeatureFlag } from "@/lib/feature-flags";
import { useTeam } from "@/lib/team-context";

/**
 * Account → device reconciliation (plan-i18n-ptbr.md D3, Phase 1 task 12).
 *
 * D3 splits locale resolution in two: the REQUEST decides from the cookie and
 * `Accept-Language`, and the ACCOUNT reconciles the cookie afterwards. This is
 * the second half, and it is client-side on purpose — reading `users.locale`
 * during negotiation would cost a query on every navigation forever, to save
 * one frame on one load. The frame it costs instead is named and bounded: a
 * user whose account says pt-BR, on a NEW device whose browser asks for
 * English, sees one English render before the refresh below lands.
 *
 * **The absent-cookie guard is the entire defence against risk 5** — the loop
 * where a switch writes the cookie, the refresh re-runs this effect, the
 * effect sees the account still disagreeing and switches back, forever. A
 * present cookie means a human chose this language ON THIS DEVICE (nothing
 * else ever writes it — negotiation deliberately does not), and a human's
 * choice on the device they are holding outranks a value their account
 * remembers from somewhere else. So: reconcile only into silence.
 *
 * `switched` is the second guard, for the window between calling the action
 * and the refreshed tree arriving — during it the cookie the server set is not
 * yet visible to `document.cookie` in this document, and without the ref a
 * re-render would fire the action again.
 *
 * Renders nothing. It lives in `top-bar.tsx` because that is the one component
 * mounted on every signed-in screen that is already inside `TeamProvider` —
 * `currentUser` is where the account's locale arrives (`loadTeamData` selects
 * the column for free), and there is no point reconciling for a visitor who
 * has no account row yet.
 */
export function LocaleSync() {
  const { currentUser } = useTeam();
  const active = useLocale();
  const enabled = useFeatureFlag("locale-pt-br");
  const router = useRouter();
  const switched = useRef(false);

  const accountLocale = currentUser.locale;

  useEffect(() => {
    if (!enabled) return;
    if (switched.current) return;
    // "Never chose" — Accept-Language keeps deciding, which is the whole
    // reason the column is nullable.
    if (accountLocale == null || accountLocale === active) return;
    if (hasLocaleCookie()) return;

    switched.current = true;
    void setLocale(accountLocale).then(() => router.refresh());
  }, [enabled, accountLocale, active, router]);

  return null;
}

/**
 * Is there a deliberate choice on this device?
 *
 * Read from `document.cookie` rather than passed down from the server: the
 * question is about THIS browser at THIS moment, and after a switch the server
 * value and the document's can differ for exactly the window `switched` covers.
 * The cookie is not `httpOnly` precisely so this read is possible (D12).
 */
function hasLocaleCookie(): boolean {
  return document.cookie
    .split(";")
    .some((part) => part.trim().startsWith(`${LOCALE_COOKIE}=`));
}
