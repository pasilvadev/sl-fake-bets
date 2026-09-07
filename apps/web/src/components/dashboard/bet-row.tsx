"use client";

import { useState } from "react";
import Link from "next/link";
import { Share2 } from "lucide-react";
import { cn } from "cn";
import { useLocale, useTranslations } from "next-intl";
import {
  canAcceptDuel,
  canResolveDuel,
  computeDuelPhase,
  getPoolStats,
  settleBet,
  type Bet,
  type Duel,
  type DuelPhase,
  type OptionPoolStat,
} from "@repo/shared";
import { useNow } from "@/lib/use-now";
import {
  formatRelativePast,
  formatShortDate,
  formatTimeLeft,
  formatVoidLabel,
} from "@/lib/format";
import { useTeam } from "@/lib/team-context";
import { useModal } from "@/lib/modal-context";
import { useToast } from "@/lib/toast-context";
import { UserAvatar } from "@/components/sl/user-avatar";
import { UserName } from "@/components/sl/user-name";
import { AvatarCluster } from "@/components/sl/avatar-cluster";
import { CoinAmount, CoinDelta } from "@/components/sl/coin-amount";
import { Versus } from "@/components/sl/versus";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * §5.1's icon cell falls back to 🎲 for a pool bet. A duel gets its own glyph
 * (Extra Phase 3, task 11): two people arguing about one outcome is not a dice
 * roll, and a row that opens with the pool-bet default is one more thing
 * telling the reader this is an ordinary bet when the next three cells are
 * about to tell them it is not.
 */
const DUEL_GLYPH = "⚔️";

function formatMultiplier(multiplier: number | null): string {
  return multiplier == null ? "—" : `${multiplier.toFixed(2)}x`;
}

/**
 * Everything a row needs to know about a duel, resolved once at the top of
 * `BetRow` and threaded down — deliberately as ONE object rather than five
 * booleans, because the two halves it carries must never be asked separately.
 *
 * `phase` is the clock (`computeDuelPhase`) and knows nothing about who is
 * looking; `mayAccept`/`mayResolve` are roster+id rules (`permissions.ts`) and
 * never look at the clock. Every affordance below needs both, and the failure
 * mode of checking one is an Accept button on a challenge that lapsed
 * yesterday — the single most likely bug in this phase, per the warnings on
 * both source functions.
 */
interface DuelView {
  duel: Duel;
  phase: DuelPhase;
  /** The viewer owes this duel an answer or a ruling (D4). */
  awaitingYou: boolean;
  mayAccept: boolean;
  mayResolve: boolean;
  /**
   * D8 half (a): an unaccepted duel past its deadline IS void, before anything
   * has persisted the void. Every read treats it that way so the screen is
   * never wrong while the opportunistic sweep has not run — which, on a
   * deployment that pauses after 7 idle days, is the expected case rather than
   * an outage.
   */
  readsAsVoid: boolean;
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
 * losers recede chipless — rust 400, line-through odds, no prefix.
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
  const t = useTranslations("betRow");
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
            aria-label={t("moreOptions", { count: extra })}
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

/**
 * The duel's substitute for the odds preview AND the POOL cell (task 5).
 *
 * Both are REPLACED, not reused, and the reason is that they would be truthful
 * and useless at the same time: two symmetric stakes on opposite options make
 * `getPoolStats` return a flat 2.00x/2.00x, and pari-mutuel vocabulary on a
 * two-person bet reads as a bug rather than as information.
 *
 * `· WINNER TAKES n` hides below `xl`. The POOL cell it replaces was gated at
 * `lg`, and this is one step stricter for a measured reason: a duel row also
 * carries the versus, which needs real width to be worth anything, and at
 * 1024–1279px the two together squeeze it to nothing. The STAKE half stays
 * visible at every width, because a duel row whose only number vanished on a
 * phone would be a row with no stake at all — and the payout is 2× the stake
 * and nothing else, so the half that survives the trim is the half you cannot
 * derive in your head.
 */
function DuelStake({ stake }: { stake: number }) {
  const t = useTranslations("betRow");

  return (
    <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {t("stake")}
      </span>
      <CoinAmount amount={stake} className="text-sm text-foreground" />
      <span className="hidden items-center gap-1.5 xl:flex">
        <span className="text-muted-foreground">·</span>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("winnerTakes")}
        </span>
        <CoinAmount amount={stake * 2} className="text-sm text-foreground" />
      </span>
    </div>
  );
}

/**
 * State label per §5.2 — never a colored chip, just tracked uppercase text:
 * `text-[11px] font-semibold uppercase tracking-wider` plus one color class,
 * N6 by default and jade/80 for the row that wants your attention.
 *
 * `AWAITING YOU` (Extra Phase 3, task 6) is D4's entire notification story. It
 * outranks `AWAITING RESULT` on a duel the viewer must rule on, because §5.2
 * gives a row one label and "there is a decision here and it is yours" is
 * strictly more useful than restating a state the countdown cell already
 * carries. Nobody else's row changes — the label is per-viewer, computed from
 * `duelFor` + the shared predicates, and it is a pull: no push, no email, no
 * bell, no tab title, not even a badge (ARC-014).
 */
function StateLabel({
  bet,
  closingSoon,
  duelView,
}: {
  bet: Bet;
  closingSoon: boolean;
  duelView: DuelView | null;
}) {
  const locale = useLocale();
  const tState = useTranslations("state");

  let text: string | null = null;
  let className = "text-muted-foreground";

  if (duelView?.awaitingYou) {
    text = tState("awaitingYou");
    className = "text-jade/80";
  } else if (duelView?.readsAsVoid && bet.state !== "resolved") {
    // The lazily-expired case: nothing has persisted a resolution yet, so
    // `bet.resolution` is still absent and only the clock knows.
    text = formatVoidLabel(locale, "expired");
  } else if (bet.state === "open" && closingSoon) {
    text = tState("closingSoon");
    className = "text-jade/80";
  } else if (bet.state === "closed") {
    text = tState("awaitingResult");
  } else if (bet.state === "resolved" && bet.resolution?.kind === "void") {
    text = formatVoidLabel(locale, bet.resolution.reason);
  }

  if (!text) return null;

  return (
    <span className={cn("text-[11px] font-semibold uppercase tracking-wider", className)}>
      {text}
    </span>
  );
}

/** Rail: 3px left accent — the row's only color-coded state signal. */
function Rail({
  bet,
  closingSoon,
  duelView,
}: {
  bet: Bet;
  closingSoon: boolean;
  duelView: DuelView | null;
}) {
  // §5.2: the rail is removed on both resolved outcomes. An expired duel reads
  // as void (D8 half (a)) and must lose it too, or a lapsed challenge keeps a
  // live jade rail until something sweeps it.
  if (bet.state === "resolved" || duelView?.readsAsVoid) return null;

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
  const tState = useTranslations("state");

  if (!bet.resolution) return null;

  // Same math the balances were settled with — settlement.ts, no re-derivation.
  // It needs no duel branch: a duel is two symmetric wagers on opposite
  // options, so `settleBet` already pays it (Extra Phase 2, task 6).
  const delta = settleBet(bet, wagers, bet.resolution).find(
    (d) => d.userId === currentUser.id,
  );

  if (!delta) return null; // did-not-participate: must not read as loss

  if (bet.resolution.kind === "void") {
    return (
      <span className="text-[11px] font-semibold uppercase text-muted-foreground">
        {tState("refunded")}
      </span>
    );
  }

  return <CoinDelta amount={delta.profitLossDelta} className="text-sm" />;
}

/**
 * The duel's CTA cell — per viewer, and never a dead button (§5.1: on a bet
 * the user cannot act on, this cell is replaced by the outcome glyph "not left
 * as a dead button"). Five readings, in the order they are tested:
 *
 *  - settled → the outcome delta, or nothing at all for the two thirds of the
 *    team who were not in it (§5.2's did-not-participate state: "neutral, no
 *    glyph, no emphasis — must not read as a loss");
 *  - expired → nothing. There is no action left and the label already says the
 *    stake went home;
 *  - the challengee, while it is still open → Accept and Decline, both of
 *    which open the same modal (see `duel-accept-modal.tsx` for why both);
 *  - an eligible resolver, once accepted → a link to the bet page, because
 *    resolving is two participant buttons plus Void and that is a panel, not a
 *    row control;
 *  - anyone else → nothing.
 *
 * What never appears, in any state, for anyone: `Wager`. `place_wager` refuses
 * a duel outright, so the button would be a lie even where it fits.
 */
function DuelCta({ bet, view }: { bet: Bet; view: DuelView }) {
  const { open } = useModal();
  const t = useTranslations("betRow");

  if (view.phase === "settled") return <ResolvedOutcome bet={bet} />;
  if (view.phase === "expired") return null;

  if (view.mayAccept) {
    return (
      <div className="flex shrink-0 items-center gap-2">
        {/* Ghost/tertiary (§5.3) — a decline is not destructive-ember: ember
            means "the action you are about to take is destructive", and this
            one hands everyone their coins back. */}
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            open("duel-accept", bet.id);
          }}
          className="h-8 shrink-0 px-2 text-xs font-semibold uppercase text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground"
        >
          {t("decline")}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            open("duel-accept", bet.id);
          }}
          className={cn(
            "h-8 shrink-0 bg-jade px-3 text-xs font-semibold uppercase text-black rounded-sm",
            "transition motion-safe:hover:brightness-110 motion-safe:active:brightness-95",
          )}
        >
          {t("accept")}
        </button>
      </div>
    );
  }

  if (view.mayResolve) {
    return (
      <Link
        href={`/bet/${bet.id}`}
        className="flex h-8 shrink-0 items-center rounded-sm border border-border bg-transparent px-3 text-xs font-semibold uppercase text-foreground transition-colors hover:border-jade/50 hover:text-jade"
      >
        {t("resolve")}
      </Link>
    );
  }

  return null;
}

/**
 * One feed row (§5.1).
 *
 * `featured` and `soonest` were a single prop until Extra Phase 3, and the
 * split is a design decision rather than a refactor:
 *
 *  - **`featured` spends the dashboard's one diagonal cut** (§4.3's "max one
 *    diagonal brand element visible per viewport", `design-dashboard.md` §3) —
 *    the `cut-sm` icon chip and the `cut-mirror` 6% jade corner tint. Task 6
 *    reassigns that budget from the closing-soonest bet to a duel awaiting the
 *    viewer, so exactly one row still carries it, but it is no longer always
 *    the same row.
 *  - **`soonest` marks the closing-soonest OPEN pool bet**, the only row
 *    eligible for §5.2's <1h treatment: the pulsing rail, the `CLOSING SOON`
 *    label and the jade countdown. That is state language about a betting
 *    window, and a challenge arriving in someone's feed is no reason to
 *    extinguish it.
 *
 * Before this phase both were the same row, which is why one boolean did both
 * jobs; a pinned duel is what forces them apart.
 */
export function BetRow({
  bet,
  featured,
  soonest,
}: {
  bet: Bet;
  featured?: boolean;
  soonest?: boolean;
}) {
  const { team, currentUser, wagers, userById, duelFor } = useTeam();
  const { open } = useModal();
  const { show } = useToast();
  const now = useNow();
  const locale = useLocale();
  const t = useTranslations("betRow");

  // Same origin idiom as invite-modal.tsx. The difference worth knowing: that
  // modal only ever renders after a click, so its guard is there for the type;
  // a row genuinely does render on the server, and the "" it takes there is
  // replaced by the real origin on the hydration render. Nothing renders the
  // value — it is only ever read inside a click handler, which is client-only.
  const [origin] = useState(() =>
    typeof window === "undefined" ? "" : window.location.origin,
  );

  /**
   * `isDuel` and `duelView` are two different questions and the row asks both.
   *
   * `bet.kind` is the truth about what this bet IS — it is `not null` in the
   * schema and arrives with every row. `duelFor` is whether this client also
   * holds the `bet_duels` side row, and it can miss even though `create_duel`
   * writes both in one transaction: the two arrive on separate realtime
   * bindings, so between the `bets` INSERT and the `bet_duels` INSERT there is
   * a real frame where the kind is known and the duel is not. `applyRemote`
   * also drops a duel whose bet this client does not hold, which the same race
   * can produce in the other order.
   *
   * Keying the POOL CHROME on `duelView` would render that frame as an
   * ordinary pool bet — odds preview, POOL total, and a live jade `Wager`
   * button on a bet `place_wager` refuses outright. So everything that must
   * NOT appear on a duel keys on `isDuel`, and only the duel-specific content
   * keys on `duelView`. The gap between them renders as a quiet row: title,
   * countdown, share, and nothing to press.
   */
  const isDuel = bet.kind === "duel";
  const duel = isDuel ? duelFor(bet.id) : undefined;
  let duelView: DuelView | null = null;
  if (duel) {
    // `now == null` on the server and on the first client render — `useNow` is
    // hydration-safe by design, and substituting `Date.now()` here would
    // reintroduce the mismatch it exists to prevent. `0` is the honest stand-in
    // rather than an arbitrary one: `computeDuelPhase`'s first two arms are
    // stored facts (resolved, accepted) and only its third consults the clock,
    // so an epoch-zero "now" makes the function answer from the row alone and
    // report `"pending"` for anything still open. One tick later the real clock
    // arrives and an already-lapsed challenge settles into `"expired"`. The
    // reverse fallback would be the dangerous one: reading unaccepted duels as
    // expired for a frame flashes `VOID` across live challenges.
    const phase: DuelPhase = computeDuelPhase(bet, duel, now ?? 0);
    const mayAccept = phase === "pending" && canAcceptDuel(team, currentUser.id, duel);
    const mayResolve = phase === "accepted" && canResolveDuel(team, currentUser.id, duel);
    duelView = {
      duel,
      phase,
      mayAccept,
      mayResolve,
      awaitingYou: mayAccept || mayResolve,
      readsAsVoid:
        phase === "expired" ||
        (bet.state === "resolved" && bet.resolution?.kind === "void"),
    };
  }

  const betWagers = wagers.filter((w) => w.betId === bet.id);
  const poolStats = getPoolStats(bet, wagers);
  const poolTotal = poolStats.reduce((sum, o) => sum + o.total, 0);
  const creator = userById(bet.creatorId);
  const distinctWagerUserIds = Array.from(new Set(betWagers.map((w) => w.userId)));

  const { label: countdownLabel, msLeft } =
    bet.state === "open" && now != null ? formatTimeLeft(locale, bet.closesAt, now) : { label: "—", msLeft: null as number | null };
  const closingSoon =
    bet.state === "open" &&
    Boolean(soonest) &&
    msLeft != null &&
    msLeft > 0 &&
    msLeft < ONE_HOUR_MS;

  const isVoid =
    (bet.state === "resolved" && bet.resolution?.kind === "void") ||
    Boolean(duelView?.readsAsVoid);

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
      show({ kind: "success", text: t("shareCopied"), key: "share-copy" });
    const onFailed = () =>
      show({ kind: "failure", text: t("shareFailed"), key: "share-copy" });

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
      <Rail bet={bet} closingSoon={closingSoon} duelView={duelView} />

      {/* Featured-row corner tint (design-dashboard.md §5.1): a flat 6% jade
          fill behind a diagonal cut — no gradient (banned list #3), the
          diagonal is the 68° cut-mirror shape reused from the brand motif.
          Deliberately a separate layer rather than the row's own background:
          `bg-jade-wash` is the hover fill, and a permanently-hovered-looking
          row is a bug report waiting to happen. */}
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
          {bet.iconEmoji ?? (bet.kind === "duel" ? DUEL_GLYPH : "🎲")}
        </div>

        <div className="min-w-0">
          <Link
            href={`/bet/${bet.id}`}
            className="block truncate text-base font-medium text-foreground hover:text-jade"
          >
            {bet.title}
          </Link>
          <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            <span>{t("by")}</span>
            {creator && (
              <>
                <UserAvatar user={creator} size={16} />
                <UserName user={creator} className="text-xs" />
              </>
            )}
            <StateLabel bet={bet} closingSoon={closingSoon} duelView={duelView} />
          </div>
        </div>
      </div>

      {/* odds / pool / countdown — or, for a duel, versus / stake / countdown */}
      <div
        className={cn(
          // `sm:flex-1` BEFORE `sm:basis-auto`, and that order is load-bearing.
          // This cell is the only one on the row whose classes go through
          // `cn`, and tailwind-merge drops the earlier of two classes that set
          // the same property — `flex-1` is a shorthand that also sets
          // `flex-basis`, so writing them the other way round silently deletes
          // `sm:basis-auto` and leaves the cell at `flex-basis: 0`. Its
          // neighbour (the icon + title cell) is a plain string literal, never
          // merged, and keeps a content-sized basis; a basis-0 cell beside a
          // basis-auto one gets only leftover space, which is what collapsed
          // the versus composition to zero width and spilled it over the stake.
          "flex min-w-0 basis-full items-center gap-x-4 sm:flex-1 sm:basis-auto",
          // A duel packs three cells where a pool bet packs two-and-a-half, so
          // below `sm` the versus takes its own line rather than squeezing the
          // stake and the deadline off the row. The outer row is already
          // `flex-wrap` with a `min-h-`, not a fixed height, so it just grows.
          isDuel ? "flex-wrap gap-y-1.5 sm:flex-nowrap" : "gap-y-2",
        )}
      >
        {isDuel ? (
          duelView && (
            <>
            {/* `basis-32`, not the `flex-1` the odds preview beside it uses.
                `flex-1` is `flex: 1 1 0%`, and with two `shrink-0` siblings in
                a cell this narrow that resolves to a real width of ZERO — the
                avatars then spill out over the stake figures, which is the bug
                this basis exists to prevent. Starting at 8rem and shrinking
                from there gives the composition a floor and degrades by
                truncating names, which is what `Versus` is built to do.
                `sm:grow` and not `sm:flex-1`, deliberately: `flex-1` is a
                shorthand that also sets `flex-basis: 0%`, Tailwind emits it
                after `basis-*` in the cascade, and it therefore silently wins.
                `grow` (+ the default `shrink: 1`) leaves the basis alone.
                `overflow-hidden` is the belt to that braces: whatever the
                arithmetic, it clips instead of overlapping. */}
            <Versus
              challengerId={duelView.duel.challengerId}
              challengeeId={duelView.duel.challengeeId}
              size="dense"
              className="basis-full overflow-hidden sm:grow sm:basis-32"
            />
            <DuelStake stake={duelView.duel.stake} />
            </>
          )
        ) : (
          <>
            <OddsPreview bet={bet} poolStats={poolStats} />

            <div className="ml-auto hidden shrink-0 flex-col items-end lg:flex">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                {t("pool")}
              </span>
              <CoinAmount amount={poolTotal} className="text-sm" />
            </div>
          </>
        )}

        <div
          className={cn(
            "shrink-0 whitespace-nowrap font-mono text-sm tabular-nums",
            closingSoon ? "font-semibold text-jade" : "text-muted-foreground",
            "sm:ml-0 ml-auto lg:ml-3",
          )}
        >
          {/* §5.1 makes the countdown "the only urgency signal, no separate
              badge", so a duel's accept deadline has to ride this same cell —
              and it gets an explicit prefix. The channel has carried exactly
              one meaning app-wide ("betting closes in"); a second, unlabelled
              one on it is a guaranteed misread. Sans prefix, mono numerals
              (§3: prose is sans, scanned values are mono). */}
          {duelView?.phase === "pending" && (
            <span className="font-sans text-xs text-muted-foreground">
              {t("acceptBy")}{" "}
            </span>
          )}
          {bet.state === "open" &&
            (duelView?.readsAsVoid
              ? formatShortDate(locale, bet.closesAt)
              : now == null
                ? "—"
                : countdownLabel)}
          {bet.state === "closed" &&
            (now == null
              ? "—"
              : t("closedAgo", {
                  ago: formatRelativePast(locale, bet.closesAt, now),
                }))}
          {bet.state === "resolved" && formatShortDate(locale, bet.closesAt)}
        </div>
      </div>

      {/* participants / share / CTA */}
      <div className="flex basis-full items-center justify-between gap-3 sm:basis-auto sm:justify-end">
        {/* A duel's participants are already the versus cell, in full and by
            name. Repeating them as an overlapping stack would say the two
            people are on the same side, which is the one thing the row exists
            to deny. */}
        {!isDuel && (
          <div className="hidden md:block">
            <AvatarCluster userIds={distinctWagerUserIds} max={3} size={20} />
          </div>
        )}

        <button
          type="button"
          onClick={handleShare}
          title={t("share")}
          aria-label={t("share")}
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          <Share2 className="size-3.5" />
        </button>

        {isDuel ? (
          duelView && <DuelCta bet={bet} view={duelView} />
        ) : (
          <>
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
                {t("wager")}
              </button>
            )}

            {bet.state === "resolved" && <ResolvedOutcome bet={bet} />}
          </>
        )}
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
