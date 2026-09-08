"use client";

import { Bell } from "lucide-react";
import { cn } from "cn";
import { useTranslations } from "next-intl";
import { canStartDuel } from "@repo/shared";
import { SMark } from "@/components/sl/s-mark";
import { AlphaTag } from "@/components/sl/alpha-tag";
import { CoinAmount } from "@/components/sl/coin-amount";
import { useTeam } from "@/lib/team-context";
import { useModal } from "@/lib/modal-context";
import { useFeatureFlag } from "@/lib/feature-flags";
import { LocaleSync } from "./locale-sync";
import { ProfileMenu } from "./profile-menu";
import { TeamSwitcher } from "./team-switcher";

/**
 * Top bar (design-dashboard.md §1.1): 56px sticky shell band. Left = S-mark +
 * team switcher; right = balance pill, Invite, Start 1v1, Create Bet,
 * notifications (future-stub), profile menu — fixed order.
 *
 * It also mounts `LocaleSync` (UX-027, D3), which renders nothing: this is the
 * one component present on every signed-in screen that is already inside
 * TeamProvider, and `currentUser.locale` is what it reconciles against.
 */
export function TopBar() {
  const { team, currentUser, balance, canCreateBet, canInvite } = useTeam();
  const { open } = useModal();
  const t = useTranslations("topBar");
  // D9: plain membership, NOT `canCreateBet` and never `team.accessMode`. In a
  // restricted team an ordinary member sees Start 1v1 while Create Bet is
  // dimmed away from them — the asymmetry is the ruling, not a bug: the access
  // mode rations bets POSTED FOR THE TEAM TO WAGER INTO, and a duel is a
  // private arrangement between two people who have already agreed to it.
  const mayStartDuel =
    useFeatureFlag("duel-bets") && canStartDuel(team, currentUser.id);

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface-1 px-4">
      <LocaleSync />

      <div className="flex min-w-0 flex-1 items-center gap-3">
        <SMark className="h-5 w-auto shrink-0 text-foreground" />
        {/* The alpha sticker (sl/alpha-tag.tsx). The default `size="sm"`
            already carries the shoulder-perch offset tuned for this bare
            S-mark; `-ml-1.5` just tucks in the leftover flex `gap-3`. */}
        <AlphaTag className="-ml-1.5" />
        <TeamSwitcher />
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {/* Balance pill: current balance + docked daily-grant micro-tag (DOM-022, auto-grant, static in mock). */}
        <button
          type="button"
          onClick={() => open("transactions")}
          className="flex h-8 items-center gap-1.5 rounded-sm border border-transparent px-2 text-foreground transition-colors hover:border-border"
        >
          <CoinAmount amount={balance} className="text-sm" />
          <span className="rounded-sm bg-jade-wash px-1 py-0.5 text-[10px] font-semibold leading-none text-jade">
            +5
          </span>
        </button>

        {canInvite && (
          <button
            type="button"
            onClick={() => open("invite")}
            className="hidden h-8 items-center rounded-sm border border-border bg-transparent px-3 text-sm text-foreground transition-colors hover:border-jade/50 hover:text-jade md:inline-flex"
          >
            {t("invite")}
          </button>
        )}

        {/* Secondary CTA (Extra Phase 3, task 3). §5.3 allows exactly ONE
            jade-filled primary per screen and Create Bet keeps it, so this is
            the outline variant — and flat, not `cut-sm`, because
            design-dashboard.md §3 spends the screen's single diagonal on a
            feed row. Same chrome as Invite beside it, down to the sentence
            case: §5.3 reserves uppercase button text for the primary style.
            Below `sm` the FAB stack takes over, exactly as Create Bet does. */}
        {mayStartDuel && (
          <button
            type="button"
            onClick={() => open("start-duel")}
            className="hidden h-8 items-center rounded-sm border border-border bg-transparent px-3 text-sm text-foreground transition-colors hover:border-jade/50 hover:text-jade sm:inline-flex"
          >
            {t("startDuel")}
          </button>
        )}

        {/* Primary CTA — flat rounded-sm, no cut-sm here (§3 scarcity ruling: the
            budget is spent on the closing-soonest bet row instead). Hidden below
            sm — the mobile FAB (create-bet-fab.tsx) takes over there. */}
        <button
          type="button"
          disabled={!canCreateBet}
          title={!canCreateBet ? t("createBetDenied") : undefined}
          onClick={() => open("create-bet")}
          className={cn(
            "hidden h-8 items-center rounded-sm bg-jade px-3 text-xs font-semibold uppercase text-black transition-[filter] motion-safe:hover:brightness-110 motion-safe:active:brightness-95 sm:inline-flex",
            !canCreateBet && "pointer-events-none opacity-40",
          )}
        >
          {t("createBet")}
        </button>

        {/* Permanent notifications slot, future-stub (ARC-014/015). */}
        <div title={t("notificationsSoon")}>
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            className="pointer-events-none flex size-8 items-center justify-center rounded-full text-muted-foreground opacity-40"
          >
            <Bell className="size-4" />
          </button>
        </div>

        <ProfileMenu />
      </div>
    </header>
  );
}
