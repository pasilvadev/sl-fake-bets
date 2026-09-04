"use client";

import type { ReactNode } from "react";
import { cn } from "cn";
import { CONFIG, type Bet } from "@repo/shared";
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
 */
export function Ticker() {
  const { bets, wagers, team, richest, currentUser } = useTeam();
  const now = useNow();

  const openBets = bets.filter((b) => b.state === "open");
  const soonest = soonestOpenBet(openBets);

  const openBetIds = new Set(openBets.map((b) => b.id));
  const openPool = wagers
    .filter((w) => openBetIds.has(w.betId))
    .reduce((sum, w) => sum + w.amount, 0);

  const richestIndex = richest.findIndex((m) => m.userId === currentUser.id);
  const rank = richestIndex === -1 ? null : richestIndex + 1;

  return (
    <div className="flex h-10 shrink-0 items-stretch overflow-x-auto whitespace-nowrap border-b border-border bg-background [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <Chip label="Open" first>
        {openBets.length}
      </Chip>

      {soonest && (
        <Chip label="Closing soonest" valueClassName="text-jade">
          {now === null ? "—" : formatTimeLeft(soonest.closesAt, now).label}
        </Chip>
      )}

      <Chip label="Pool (open)">{formatCoins(openPool)}</Chip>

      <Chip label="Your rank">{rank === null ? "—" : `#${rank} richest`}</Chip>

      <Chip label="Team">
        {team.members.length}/{CONFIG.TEAM_TARGET_SIZE}
      </Chip>
    </div>
  );
}
