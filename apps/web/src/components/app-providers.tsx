"use client";

import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import type { Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/messages";
import { AuthProvider } from "@/lib/auth-context";
import { FeatureFlagProvider } from "@/lib/feature-flags";
import type { FlagMap } from "@/lib/data/feature-flags";
import type { SessionUser } from "@/lib/session-user";
import { TeamProvider } from "@/lib/team-context";
import { ModalProvider } from "@/lib/modal-context";
import { ModalRoot } from "@/components/modals/modal-root";
import { ToastProvider } from "@/lib/toast-context";
import { ToastRoot } from "@/components/sl/toast-layer";

/**
 * App-wide client providers, mounted once in the root layout so the Phase-1
 * in-memory team state (created bets, placed wagers, settled balances)
 * survives client navigation between `/` and `/bet/[id]`. ModalRoot lives
 * here too: modals are route-independent (UX-014/016).
 *
 * ToastProvider sits **outside** TeamProvider and ToastRoot **outside**
 * ModalProvider's subtree, both on purpose (Extra Phase 4, D1). Four of the
 * nine call sites succeed by unmounting the surface that fired them — a kick
 * removes the roster row, delete-team and leave-team close the modal and can
 * tear down the whole TeamGate when it was the last team, delete-bet navigates
 * off the page — so the toast's state and its dismiss timer have to live above
 * everything that can disappear. ToastRoot then portals to `document.body` at
 * `z-[60]` (see sl/toast-layer.tsx), which is what lets a toast raised from
 * inside a modal paint over the backdrop instead of under it.
 *
 * `initialUser` comes from the root layout's server-side session read
 * (Phase 4); `flags` from the same layout's flags read (Phase 9, ARC-016).
 * Those two are the only props that cross the server/client boundary here, and
 * both are per-request values a client render must not go fetch for itself.
 *
 * NextIntlClientProvider is outermost, ABOVE FeatureFlagProvider (UX-027,
 * plan-i18n-ptbr.md Phase 1, task 6). A provider below it may render copy — a
 * flag-gated empty state already does — and a translation hook must never be
 * the thing that is not ready yet. FeatureFlagProvider keeps its own
 * "outermost" reasoning for everything under it: a flag may gate anything,
 * including a provider's own children, and it depends on nothing.
 *
 * `locale`, `messages` and `timeZone` cross the server/client boundary as
 * props, exactly like `initialUser` and `flags` — all five are per-request
 * values a client render must not go fetch for itself. `timeZone` is passed
 * explicitly (rather than left for `NextIntlClientProvider` to infer) because
 * an explicit `locale`/`messages` pair already breaks its auto-inherit from
 * `i18n/request.ts`'s config — without it next-intl throws `ENVIRONMENT_
 * FALLBACK` the moment any child calls a hook that touches the clock. Only the
 * ACTIVE locale's catalog is serialized (~4 KB gzipped at this size, ~10 KB by
 * the end of Phase 3); pre-emptively narrowing it per route with next-intl's
 * `pick()` is not warranted below ~800 keys and would cost the owner the
 * single-file editing surface §4 promises.
 */
export function AppProviders({
  initialUser,
  flags,
  locale,
  messages,
  timeZone,
  children,
}: {
  initialUser: SessionUser | null;
  flags: FlagMap;
  locale: Locale;
  messages: Messages;
  timeZone: string;
  children: ReactNode;
}) {
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={messages}
      timeZone={timeZone}
    >
      <FeatureFlagProvider flags={flags}>
        <AuthProvider initialUser={initialUser}>
          <ToastProvider>
            <TeamProvider>
              <ModalProvider>
                {children}
                <ModalRoot />
              </ModalProvider>
            </TeamProvider>
            <ToastRoot />
          </ToastProvider>
        </AuthProvider>
      </FeatureFlagProvider>
    </NextIntlClientProvider>
  );
}
