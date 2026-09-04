"use client";

import { Share2 } from "lucide-react";
import { cn } from "cn";
import { getPoolStats, getUser, type Bet, type OptionPoolStat } from "@repo/shared";
import { useNow } from "@/lib/use-now";
import { formatRelativePast, formatShortDate, formatTimeLeft } from "@/lib/format";
import { useTeam } from "@/lib/team-context";
import { useModal } from "@/lib/modal-context";
import { UserAvatar } from "@/components/sl/user-avatar";
import { UserName } from "@/components/sl/user-name";
import { AvatarCluster } from "@/components/sl/avatar-cluster";
import { CoinAmount, CoinDelta } from "@/components/sl/coin-amount";

const ONE_HOUR_MS = 60 * 60 * 1000;

function formatMultiplier(multiplier: number | null): string {
  return multiplier == null ? "—" : `${multiplier.toFixed(2)}x`;
}

/** Top-2-by-pool odds preview, jade "/" joined, "+N more" for 3+ options. */
function OddsPreview({ bet, poolStats }: { bet: Bet; poolStats: OptionPoolStat[] }) {
  const resolution = bet.resolution;
  const isResolvedWinner = bet.state === "resolved" && resolution?.kind === "winner";

  let ordered: OptionPoolStat[];
  if (isResolvedWinner && resolution?.kind === "winner") {
    const winner = poolStats.find((o) => o.optionId === resolution.winningOptionId);
    const rest = [...poolStats]
      .filter((o) => o.optionId !== resolution.winningOptionId)
      .sort((a, b) => b.total - a.total);
    ordered = winner ? [winner, ...rest] : rest;
  } else {
    ordered = [...poolStats].sort((a, b) => b.total - a.total);
  }

  const shown = ordered.slice(0, 2);
  const extra = bet.options.length - shown.length;

  return (
    <div className="flex items-center gap-1 truncate font-mono text-sm tabular-nums">
      {shown.map((opt, i) => {
        const isWinner = isResolvedWinner && i === 0;
        const isLoser = isResolvedWinner && i > 0;
        return (
          <span key={opt.optionId} className="flex items-center gap-1 truncate">
            {i > 0 && (
              <span className={cn(isResolvedWinner ? "text-muted-foreground" : "text-jade")}>
                /
              </span>
            )}
            {isWinner && <span className="text-jade">/</span>}
            <span
              className={cn(
                "truncate",
                isWinner && "font-semibold text-text-strong",
                isLoser && "font-normal text-muted-foreground line-through",
              )}
            >
              {opt.label} {formatMultiplier(opt.multiplier)}
            </span>
          </span>
        );
      })}
      {extra > 0 && (
        <span className="shrink-0 text-muted-foreground">+{extra} more</span>
      )}
    </div>
  );
}

/** State label per §5.2 — never a colored chip, just tracked uppercase text. */
function StateLabel({ bet, featured, msLeft }: { bet: Bet; featured?: boolean; msLeft: number | null }) {
  let text: string | null = null;
  let className = "text-muted-foreground";

  if (bet.state === "open" && featured && msLeft != null && msLeft > 0 && msLeft < ONE_HOUR_MS) {
    text = "CLOSING SOON";
    className = "text-jade/80";
  } else if (bet.state === "closed") {
    text = "AWAITING RESULT";
  } else if (bet.state === "resolved" && bet.resolution?.kind === "void") {
    text = "VOID · REFUNDED";
  }

  if (!text) return null;

  return (
    <span className={cn("text-[11px] font-semibold uppercase tracking-wider", className)}>
      {text}
    </span>
  );
}

/** Rail: 3px left accent — the row's only color-coded state signal. */
function Rail({ bet, featured, msLeft }: { bet: Bet; featured?: boolean; msLeft: number | null }) {
  if (bet.state === "resolved") return null;

  const closingSoon =
    bet.state === "open" && featured && msLeft != null && msLeft > 0 && msLeft < ONE_HOUR_MS;

  return (
    <div
      className={cn(
        "absolute inset-y-0 left-0 w-[3px]",
        bet.state === "open" ? "bg-jade" : "bg-input",
        closingSoon && "motion-safe:animate-pulse",
      )}
    />
  );
}

/** Resolved CTA cell: pari-mutuel outcome as a CoinDelta, never a dead button. */
function ResolvedOutcome({ bet, poolStats }: { bet: Bet; poolStats: OptionPoolStat[] }) {
  const { currentUser, wagers } = useTeam();
  const userWagers = wagers.filter((w) => w.betId === bet.id && w.userId === currentUser.id);

  if (userWagers.length === 0) return null; // did-not-participate: must not read as loss

  if (bet.resolution?.kind === "void") {
    return (
      <span className="text-[11px] font-semibold uppercase text-muted-foreground">
        Refunded
      </span>
    );
  }

  if (bet.resolution?.kind === "winner") {
    const winningOptionId = bet.resolution.winningOptionId;
    const userStake = userWagers.reduce((sum, w) => sum + w.amount, 0);
    const userWinStake = userWagers
      .filter((w) => w.optionId === winningOptionId)
      .reduce((sum, w) => sum + w.amount, 0);

    if (userWinStake > 0) {
      const winningOptionTotal = poolStats.find((o) => o.optionId === winningOptionId)?.total ?? 0;
      const poolTotal = poolStats.reduce((sum, o) => sum + o.total, 0);
      const winnings =
        winningOptionTotal > 0
          ? Math.floor((userWinStake / winningOptionTotal) * poolTotal) - userWinStake
          : 0;
      return <CoinDelta amount={winnings} className="text-sm" />;
    }

    return <CoinDelta amount={-userStake} className="text-sm" />;
  }

  return null;
}

export function BetRow({ bet, featured }: { bet: Bet; featured?: boolean }) {
  const { wagers } = useTeam();
  const { open } = useModal();
  const now = useNow();

  const betWagers = wagers.filter((w) => w.betId === bet.id);
  const poolStats = getPoolStats(bet, wagers);
  const poolTotal = poolStats.reduce((sum, o) => sum + o.total, 0);
  const creator = getUser(bet.creatorId);
  const distinctWagerUserIds = Array.from(new Set(betWagers.map((w) => w.userId)));

  const { label: countdownLabel, msLeft } =
    bet.state === "open" && now != null ? formatTimeLeft(bet.closesAt, now) : { label: "—", msLeft: null as number | null };
  const closingSoon =
    bet.state === "open" && featured && msLeft != null && msLeft > 0 && msLeft < ONE_HOUR_MS;

  const isVoid = bet.state === "resolved" && bet.resolution?.kind === "void";

  function handleShare(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const url = `https://sl.bet/b/${bet.id}`;
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(url).catch(() => {});
    }
  }

  function handleWager(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    open("wager", bet.id);
  }

  return (
    <div
      className={cn(
        "relative flex min-h-[96px] flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-background px-3 py-2.5",
        "transition-colors motion-safe:duration-150 hover:bg-surface-1",
        "sm:min-h-[64px] sm:flex-nowrap",
        bet.state === "closed" && "opacity-90",
      )}
    >
      <Rail bet={bet} featured={featured} msLeft={msLeft} />

      {/* Featured-row corner tint (design-dashboard.md §5.1): a flat 6% jade
          fill behind a diagonal cut — no gradient (banned list #3), the
          diagonal is the 68° cut-mirror shape reused from the brand motif. */}
      {featured && (
        <div className="pointer-events-none absolute inset-y-0 right-0 w-24 cut-mirror bg-jade/6" />
      )}

      {isVoid && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute left-1/2 h-[141%] w-px origin-center rotate-[22deg] bg-border/60" />
        </div>
      )}

      {/* icon + title/meta */}
      <div className="flex min-w-0 basis-full items-center gap-3 sm:basis-auto sm:flex-1">
        <div
          className={cn(
            "flex size-11 shrink-0 items-center justify-center bg-surface-2 text-xl",
            featured ? "cut-sm" : "rounded-sm",
          )}
        >
          {bet.iconEmoji ?? "🎲"}
        </div>

        <div className="min-w-0">
          <a
            href="#"
            className="block truncate text-base font-medium text-foreground hover:text-jade"
          >
            {bet.title}
          </a>
          <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            <span>by</span>
            {creator && (
              <>
                <UserAvatar user={creator} size={16} />
                <UserName user={creator} className="text-xs" />
              </>
            )}
            <StateLabel bet={bet} featured={featured} msLeft={msLeft} />
          </div>
        </div>
      </div>

      {/* odds / pool / countdown */}
      <div className="flex min-w-0 basis-full items-center gap-4 sm:basis-auto sm:flex-1">
        <OddsPreview bet={bet} poolStats={poolStats} />

        <div className="ml-auto hidden shrink-0 flex-col items-end lg:flex">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Pool
          </span>
          <CoinAmount amount={poolTotal} className="text-sm" />
        </div>

        <div
          className={cn(
            "shrink-0 whitespace-nowrap font-mono text-sm tabular-nums",
            closingSoon ? "font-semibold text-jade" : "text-muted-foreground",
            "sm:ml-0 ml-auto lg:ml-3",
          )}
        >
          {bet.state === "open" && (now == null ? "—" : countdownLabel)}
          {bet.state === "closed" &&
            (now == null ? "—" : `closed ${formatRelativePast(bet.closesAt, now)}`)}
          {bet.state === "resolved" && formatShortDate(bet.closesAt)}
        </div>
      </div>

      {/* participants / share / CTA */}
      <div className="flex basis-full items-center justify-between gap-3 sm:basis-auto sm:justify-end">
        <div className="hidden md:block">
          <AvatarCluster userIds={distinctWagerUserIds} max={3} size={20} />
        </div>

        <button
          type="button"
          onClick={handleShare}
          title="Copy share link"
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          <Share2 className="size-3.5" />
        </button>

        {bet.state === "open" && (
          <button
            type="button"
            onClick={handleWager}
            className={cn(
              "h-8 shrink-0 bg-jade px-3 text-xs font-semibold uppercase text-black rounded-sm",
              "transition motion-safe:hover:brightness-110 motion-safe:active:brightness-95",
              featured && "cut-sm",
            )}
          >
            Wager
          </button>
        )}

        {bet.state === "resolved" && <ResolvedOutcome bet={bet} poolStats={poolStats} />}
      </div>
    </div>
  );
}

/** Row-shaped skeleton — opacity-breathe, no shimmer (design-visual-identity.md §5.10). */
export function BetRowSkeleton() {
  return (
    <div className="relative flex min-h-[64px] items-center gap-3 border-b border-border px-3 py-2.5">
      <div className="absolute inset-y-0 left-0 w-[3px] bg-surface-1/50" />
      <div className="size-11 shrink-0 rounded-sm bg-surface-1/50 motion-safe:animate-pulse" />
      <div className="flex-1 space-y-2">
        <div className="h-4 w-1/3 max-w-48 bg-surface-1/50 motion-safe:animate-pulse" />
        <div className="h-3 w-1/4 max-w-32 bg-surface-1/50 motion-safe:animate-pulse" />
      </div>
      <div className="hidden h-8 w-16 shrink-0 bg-surface-1/50 motion-safe:animate-pulse sm:block" />
    </div>
  );
}
