"use client";

import { useState } from "react";
import Link from "next/link";
import { Share2 } from "lucide-react";
import { cn } from "cn";
import { getPoolStats, settleBet, type Bet, type OptionPoolStat } from "@repo/shared";
import { useNow } from "@/lib/use-now";
import { formatRelativePast, formatShortDate, formatTimeLeft } from "@/lib/format";
import { useTeam } from "@/lib/team-context";
import { useModal } from "@/lib/modal-context";
import { useToast } from "@/lib/toast-context";
import { UserAvatar } from "@/components/sl/user-avatar";
import { UserName } from "@/components/sl/user-name";
import { AvatarCluster } from "@/components/sl/avatar-cluster";
import { CoinAmount, CoinDelta } from "@/components/sl/coin-amount";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

const ONE_HOUR_MS = 60 * 60 * 1000;

function formatMultiplier(multiplier: number | null): string {
  return multiplier == null ? "—" : `${multiplier.toFixed(2)}x`;
}

/**
 * One option row inside an options grid (label col + odds col, so odds line up
 * vertically). Label is sans (prose), multiplier is mono 500 `tabular-nums`
 * (design-visual-identity.md §3: "Numbers are mono, prose is sans").
 *
 * The odd lives inside its own filled chip (§3 "odds chip in a row", §4.2
 * numeral framing): the fill edge — not font or color — marks where the label
 * ends, which is what keeps numeric labels ("Over 2.5", "100") legible next to
 * "2.40x". Rank dimming per §4.4 (leader N8, runner-up N7, rest N6 — N5 is
 * off-limits at text-sm, §2 contrast note). Resolved (§5.2): winner keeps the
 * jade "/" prefix + N8 600 on a jade-wash chip (§2.2 "positive chip bg");
 * losers recede chipless — rust 400, line-through odds, no prefix. Rust is the
 * "bad odds" channel here; weight and line-through still carry it on their own.
 */
function OptionLine({
  opt,
  rank,
  isResolvedWinner,
}: {
  opt: OptionPoolStat;
  rank: number;
  isResolvedWinner: boolean;
}) {
  const isWinner = isResolvedWinner && rank === 0;
  const isLoser = isResolvedWinner && rank > 0;

  const tone = isWinner
    ? "font-semibold text-text-strong"
    : isLoser
      ? "text-negative"
      : rank >= 2
        ? "text-muted-foreground"
        : rank === 0
          ? "text-text-strong"
          : "text-foreground";

  return (
    <span className="contents">
      <span className="flex min-w-0 items-center gap-1">
        {!isLoser && <span className="shrink-0 font-mono text-jade">/</span>}
        <span className={cn("truncate", tone)}>{opt.label}</span>
      </span>
      <span
        className={cn(
          "min-w-14 justify-self-end rounded-sm px-1.5 py-0.5 text-right font-mono font-medium tabular-nums",
          isWinner ? "bg-jade-wash" : !isLoser && "bg-surface-3",
          tone,
          isLoser && "font-normal line-through",
        )}
      >
        {formatMultiplier(opt.multiplier)}
      </span>
    </span>
  );
}

const optionsGridClass =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 text-sm leading-tight";

/** Top-2-by-pool odds preview stacked vertically; "…" + hover tooltip lists every option for 3+. */
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
  const [listOpen, setListOpen] = useState(false);

  const preview = (
    <div className={cn(optionsGridClass, "min-w-0 gap-y-0.5")}>
      {shown.map((opt, i) => (
        <OptionLine key={opt.optionId} opt={opt} rank={i} isResolvedWinner={isResolvedWinner} />
      ))}
    </div>
  );

  if (extra <= 0) return preview;

  return (
    <Tooltip open={listOpen} onOpenChange={setListOpen}>
      <TooltipTrigger asChild>
        {/* preventDefault stops radix's internal onClick-close so tap/click
            toggles the list — hover-only tooltips are unreachable on touch. */}
        <div
          tabIndex={0}
          onClick={(e) => {
            e.preventDefault();
            setListOpen((o) => !o);
          }}
          className="flex min-w-0 cursor-default items-center gap-1.5 outline-none focus-visible:ring-1 focus-visible:ring-jade/40"
        >
          {preview}
          <span
            aria-label={`+${extra} more option${extra > 1 ? "s" : ""}`}
            className="shrink-0 font-mono text-sm leading-none text-muted-foreground"
          >
            …
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent align="start">
        <div className={cn(optionsGridClass, "max-w-64 gap-y-1")}>
          {ordered.map((opt, i) => (
            <OptionLine key={opt.optionId} opt={opt} rank={i} isResolvedWinner={isResolvedWinner} />
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
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
function ResolvedOutcome({ bet }: { bet: Bet }) {
  const { currentUser, wagers } = useTeam();

  if (!bet.resolution) return null;

  // Same math the balances were settled with — settlement.ts, no re-derivation.
  const delta = settleBet(bet, wagers, bet.resolution).find(
    (d) => d.userId === currentUser.id,
  );

  if (!delta) return null; // did-not-participate: must not read as loss

  if (bet.resolution.kind === "void") {
    return (
      <span className="text-[11px] font-semibold uppercase text-muted-foreground">
        Refunded
      </span>
    );
  }

  return <CoinDelta amount={delta.profitLossDelta} className="text-sm" />;
}

export function BetRow({ bet, featured }: { bet: Bet; featured?: boolean }) {
  const { wagers, userById } = useTeam();
  const { open } = useModal();
  const { show } = useToast();
  const now = useNow();

  // Same origin idiom as invite-modal.tsx. The difference worth knowing: that
  // modal only ever renders after a click, so its guard is there for the type;
  // a row genuinely does render on the server, and the "" it takes there is
  // replaced by the real origin on the hydration render. Nothing renders the
  // value — it is only ever read inside a click handler, which is client-only.
  const [origin] = useState(() =>
    typeof window === "undefined" ? "" : window.location.origin,
  );

  const betWagers = wagers.filter((w) => w.betId === bet.id);
  const poolStats = getPoolStats(bet, wagers);
  const poolTotal = poolStats.reduce((sum, o) => sum + o.total, 0);
  const creator = userById(bet.creatorId);
  const distinctWagerUserIds = Array.from(new Set(betWagers.map((w) => w.userId)));

  const { label: countdownLabel, msLeft } =
    bet.state === "open" && now != null ? formatTimeLeft(bet.closesAt, now) : { label: "—", msLeft: null as number | null };
  const closingSoon =
    bet.state === "open" && featured && msLeft != null && msLeft > 0 && msLeft < ONE_HOUR_MS;

  const isVoid = bet.state === "resolved" && bet.resolution?.kind === "void";

  function handleShare(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    // This was `https://sl.bet/b/${bet.id}` — a fictional host that resolves
    // nowhere, while the title above it links to the real `/bet/[id]`. Task 9's
    // toast is what forced the dead link into the open: "Link copied." over a
    // URL that goes nowhere makes the app worse rather than better.
    const url = `${origin}/bet/${bet.id}`;
    // One key literal on both branches (D6). Nothing debounces this icon, so
    // ten rapid clicks — or a success followed by a failure — must land on one
    // card, replacing its text in place.
    const onCopied = () =>
      show({ kind: "success", text: "Link copied.", key: "share-copy" });
    const onFailed = () =>
      show({ kind: "failure", text: "Couldn't copy the link.", key: "share-copy" });

    if (typeof navigator !== "undefined" && navigator.clipboard) {
      // `.then(ok, fail)` and not `await`: the handler stays synchronous, so
      // `onClick` gets no floating promise. The rejection handler is the point
      // — this call used to end in an empty `.catch(() => {})` on an icon-only
      // control in a row with no space for an inline error (§5.8's field-owns-
      // its-error has nothing to own here), so a denied clipboard said nothing.
      navigator.clipboard.writeText(url).then(onCopied, onFailed);
    } else {
      // Insecure context or an older browser: no Clipboard API, therefore no
      // promise to reject, therefore the old guard took no branch at all. This
      // is the real-world silent case, not the exotic one.
      onFailed();
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
          <Link
            href={`/bet/${bet.id}`}
            className="block truncate text-base font-medium text-foreground hover:text-jade"
          >
            {bet.title}
          </Link>
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
          aria-label="Copy share link"
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

        {bet.state === "resolved" && <ResolvedOutcome bet={bet} />}
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
