"use client";

import type { ReactNode } from "react";
import { cn } from "cn";
import { useLocale, useTranslations } from "next-intl";
import { CONFIG, effectiveBetState, type Bet } from "@repo/shared";
import { useTeam } from "@/lib/team-context";
import { useNow } from "@/lib/use-now";
import { formatCoins, formatTimeLeft } from "@/lib/format";

function soonestOpenBet(openBets: Bet[]): Bet | null {
  if (openBets.length === 0) return null;
  return [...openBets].sort(
    (a, b) => new Date(a.closesAt).getTime() - new Date(b.closesAt).getTime(),
  )[0];
}

function Chip({
  label,
  children,
  valueClassName,
  first,
}: {
  label: string;
  children: ReactNode;
  valueClassName?: string;
  first?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-2 border-l border-border px-4",
        first && "border-l-0",
      )}
    >
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className={cn("font-mono text-sm tabular-nums text-foreground", valueClassName)}>
        {children}
      </span>
    </div>
  );
}

/**
 * Stat ticker (design-dashboard.md §1.2): 40px pure-readout strip, mono
 * tabular-nums chips split by hairlines. No click targets.
 *
 * Translated in i18n Phase 1 rather than with the rest of the dashboard, on
 * purpose (plan-i18n-ptbr.md Phase 1 task 13, risk 2): this is the tightest
 * layout in the app — five uppercase labels and their values in a 40px strip
 * that must not wrap at 375px — so it is where pt-BR's 15–25% text expansion
 * should be discovered on day one, not on the last file of Phase 3. The labels
 * that survived that at 375px are short by design: `Fecha em` for "Closing
 * soonest", `Em jogo` for "Pool (open)". Compressing the COPY is the sanctioned
 * fix (§5); shrinking §3's type scale is not.
 *
 * The `—` placeholders stay literals: an em dash is a glyph, not a sentence,
 * and it reads the same in both languages.
 */
export function Ticker() {
  const { bets, wagers, team, richest, currentUser, rankBadgeFor } = useTeam();
  const now = useNow();
  const t = useTranslations("ticker");
  const locale = useLocale();

  // DOM-012: a scheduled close (closesAt elapsing with nobody manually
  // closing/resolving it) never flips the stored `state` column, so counting
  // on the raw value left a lapsed pool bet reading OPEN here forever — even
  // after bet-feed.tsx's own CLOCK-aware grouping had already moved it to
  // CLOSED right below this strip. `effectiveBetState` also excludes duels.
  const openBets = bets.filter((b) => effectiveBetState(b, now) === "open");
  const soonest = soonestOpenBet(openBets);

  const openBetIds = new Set(openBets.map((b) => b.id));
  const openPool = wagers
    .filter((w) => openBetIds.has(w.betId))
    .reduce((sum, w) => sum + w.amount, 0);

  const richestIndex = richest.findIndex((m) => m.userId === currentUser.id);
  const rank = richestIndex === -1 ? null : richestIndex + 1;

  return (
    <div className="flex h-10 shrink-0 items-stretch overflow-x-auto whitespace-nowrap border-b border-border bg-background [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <Chip label={t("open")} first>
        {openBets.length}
      </Chip>

      {soonest && (
        <Chip label={t("closingSoonest")} valueClassName="text-jade">
          {now === null ? "—" : formatTimeLeft(locale, soonest.closesAt, now).label}
        </Chip>
      )}

      <Chip label={t("pool")}>{formatCoins(locale, openPool)}</Chip>

      {/* Bottom-five standing reads in rust — same signal the inline rank
          badge carries, so the ticker doesn't quietly flatter a loser. */}
      <Chip
        label={t("rank")}
        valueClassName={
          rankBadgeFor(currentUser.id) === "bottom5" ? "text-rust" : undefined
        }
      >
        {rank === null ? "—" : t("rankValue", { rank })}
      </Chip>

      <Chip label={t("team")}>
        {team.members.length}/{CONFIG.TEAM_TARGET_SIZE}
      </Chip>
    </div>
  );
}
