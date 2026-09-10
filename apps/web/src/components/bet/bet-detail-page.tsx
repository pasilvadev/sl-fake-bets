"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "cn";
import { useLocale, useTranslations } from "next-intl";
import {
  canAcceptDuel,
  canCloseBetEarly,
  canComment,
  canDeclineDuel,
  canDeleteBet,
  canDeleteDuel,
  canResolveBet,
  canResolveDuel,
  computeDuelPhase,
  effectiveBetState,
  getPoolStats,
  settleBet,
  validateCommentBody,
  type Bet,
  type BetResolution,
  type BetState,
  type Duel,
  type DuelPhase,
  type Locale,
} from "@repo/shared";
import { AuthGated } from "@/components/app-gate";
import { TeamGate } from "@/components/team-gate";
import { TopBar } from "@/components/shell/top-bar";
import { useLiveBetThread, useTeam } from "@/lib/team-context";
import { useModal } from "@/lib/modal-context";
import { useToast } from "@/lib/toast-context";
import { useFeatureFlag } from "@/lib/feature-flags";
import { useNow } from "@/lib/use-now";
import { useErrorText } from "@/lib/use-error-text";
import {
  formatRelativePast,
  formatShortDate,
  formatTimeLeft,
  formatVoidLabel,
} from "@/lib/format";
import { UserAvatar } from "@/components/sl/user-avatar";
import { UserName } from "@/components/sl/user-name";
import { Versus } from "@/components/sl/versus";
import { CoinAmount, CoinDelta } from "@/components/sl/coin-amount";

const eyebrowClass =
  "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

/** §5.1's duel glyph, shared with the feed row — never the pool bet's 🎲. */
const DUEL_GLYPH = "⚔️";

/**
 * Bet detail (UX-015, the one allowed full page): full bet info, wager list,
 * and the moderation controls — early close (DOM-011), resolve (DOM-018/019)
 * and hard delete (DOM-033/034) — gated through packages/shared
 * permissions.ts, with the same rules enforced again by the RPCs behind them.
 * Since roadmap Phase 7 every one of them — resolve and the comment thread
 * included — is a real Postgres write.
 *
 * Extra Phase 3 gave a duel its own layout on this page: versus at the
 * comfortable tier, stake and payout, the mediator named, the challengee's
 * accept/decline pair, and a resolve panel that is two participant buttons
 * plus Void. Comments are untouched and work exactly as they do on a pool bet
 * — that is the owner's "everyone can chat about it", and it needed no code.
 */
export function BetDetailPage({ betId }: { betId: string }) {
  const t = useTranslations("betDetail");

  return (
    <AuthGated>
      <TeamGate>
        <TopBar />
        <main className="mx-auto w-full max-w-3xl px-4 py-5">
          <Link
            href="/"
            className="font-mono text-xs text-muted-foreground transition-colors hover:text-jade"
          >
            {t("backToBets")}
          </Link>
          <BetDetail betId={betId} />
        </main>
      </TeamGate>
    </AuthGated>
  );
}

function BetDetail({ betId }: { betId: string }) {
  const { bets, team } = useTeam();
  const duelsEnabled = useFeatureFlag("duel-bets");
  const t = useTranslations("betDetail");
  // Roadmap Phase 8: this page's own channel — the comment thread (UX-018).
  // The bet itself, its wagers and its pool arrive on the team channel the
  // provider already holds. Subscribed before the not-found branch below on
  // purpose: a bet created moments ago in another session shows up here rather
  // than leaving the visitor on a dead end until they refresh.
  useLiveBetThread(betId);
  const found = bets.find((b) => b.id === betId);
  // ARC-016: with `duel-bets` off, a duel's row leaves the feed and its page
  // leaves with it — otherwise the kill switch would only hide the door while
  // leaving a link straight through the wall. It hides the SURFACE and nothing
  // else: the RPCs, the expiry sweep and the departure cascade keep settling
  // and refunding underneath.
  const bet = found?.kind === "duel" && !duelsEnabled ? undefined : found;

  if (!bet) {
    return (
      <div className="mt-4 rounded-sm border border-border bg-surface-1 p-6 text-center">
        <p className="text-sm text-foreground">
          {t("notFound", { team: team.name })}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{t("notFoundHint")}</p>
      </div>
    );
  }

  return <BetDetailContent bet={bet} />;
}

function stateLabel(
  locale: Locale,
  tState: ReturnType<typeof useTranslations<"state">>,
  effectiveState: BetState,
  bet: Bet,
  duelPhase: DuelPhase | null,
): string {
  // D8 half (a) again: a lapsed, unswept challenge is void on every read, and
  // the header must say so before anything has persisted it.
  if (duelPhase === "expired") return formatVoidLabel(locale, "expired");
  if (duelPhase === "pending") return tState("awaitingAnswer");
  if (effectiveState === "open") return tState("open");
  if (effectiveState === "closed") return tState("awaitingResult");
  return bet.resolution?.kind === "void"
    ? formatVoidLabel(locale, bet.resolution.reason)
    : tState("resolved");
}

function BetDetailContent({ bet }: { bet: Bet }) {
  const { wagers, team, currentUser, userById, duelFor } = useTeam();
  const { open } = useModal();
  const now = useNow();
  const locale = useLocale();
  const t = useTranslations("betDetail");
  const tState = useTranslations("state");

  // `isDuel` is what the bet IS (a `not null` column that always arrives);
  // `duel` is whether this client also holds the side row, which can lag by a
  // frame because the two travel on separate realtime bindings. Everything
  // that must not appear on a duel — the pool stats, the options list, the
  // Wager button, early close — keys on `isDuel`; only duel-specific CONTENT
  // keys on `duel`. See the longer note in `bet-row.tsx`.
  const isDuel = bet.kind === "duel";
  const duel = isDuel ? duelFor(bet.id) : undefined;
  // `now ?? 0` for the same reason the feed row uses it: `useNow` is null until
  // the client mounts, and epoch zero makes `computeDuelPhase` answer from the
  // stored row alone rather than flashing VOID across live challenges for a
  // frame. See the long note in `bet-row.tsx`.
  const duelPhase: DuelPhase | null = duel
    ? computeDuelPhase(bet, duel, now ?? 0)
    : null;

  // Until the clock mounts (useNow is null on the first render) fall back to
  // the stored state; the effective open→closed auto-transition kicks in one
  // tick later. Mutators re-guard with a fresh clock anyway. `effectiveBetState`
  // also excludes duels (a still-pending duel's `closesAt` is its ACCEPT
  // deadline, not a betting-close deadline) — this page's own reads of
  // `effectiveState` all happen to already be `!isDuel`-guarded or preceded by
  // a duel-phase check, but computing it unconditionally through the shared
  // duel-safe helper means that stays true by construction, not by luck.
  const effectiveState = effectiveBetState(bet, now);
  const poolStats = getPoolStats(bet, wagers);
  const poolTotal = poolStats.reduce((sum, o) => sum + o.total, 0);
  const betWagers = wagers
    .filter((w) => w.betId === bet.id)
    .sort((a, b) => b.placedAt.localeCompare(a.placedAt));
  const playerCount = new Set(betWagers.map((w) => w.userId)).size;
  const creator = userById(bet.creatorId);

  // Every duel control asks BOTH a roster+id predicate and the clock. Neither
  // implies the other: the predicates never look at `closesAt` and
  // `computeDuelPhase` never looks at who is asking.
  const mayAcceptDuel =
    duel != null &&
    duelPhase === "pending" &&
    canAcceptDuel(team, currentUser.id, duel);
  const mayDeclineDuel =
    duel != null &&
    bet.state !== "resolved" &&
    canDeclineDuel(team, currentUser.id, duel);
  const mayResolveDuel =
    duel != null &&
    duelPhase === "accepted" &&
    canResolveDuel(team, currentUser.id, duel);

  // `close_bet_early` refuses a duel outright — "A duel has no betting window
  // to close." — so the control is not merely disabled, it is absent.
  const mayCloseEarly =
    !isDuel &&
    effectiveState === "open" &&
    canCloseBetEarly(team, currentUser.id, bet);
  const mayResolve =
    !isDuel &&
    effectiveState === "closed" &&
    canResolveBet(team, currentUser.id, bet);
  // D6: deletion keeps the ordinary creator-or-moderator rule plus the one
  // condition only a duel has — it must not be accepted yet. After acceptance
  // both stakes are down and deleting would be the challenger's escape hatch
  // from a bet they are losing.
  const mayDelete = duel
    ? canDeleteDuel(team, currentUser.id, bet, duel)
    : canDeleteBet(team, currentUser.id, bet);
  const mayComment = canComment(team, currentUser.id);

  const winningOptionId =
    bet.resolution?.kind === "winner" ? bet.resolution.winningOptionId : null;

  return (
    <>
      {/* header */}
      <header className="mt-3 flex items-start gap-4">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-sm bg-surface-2 text-2xl">
          {bet.iconEmoji ?? (duel ? DUEL_GLYPH : "🎲")}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold leading-tight text-text-strong sm:text-2xl">
            {bet.title}
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              {t("by")}
              {creator && (
                <>
                  <UserAvatar user={creator} size={16} />
                  <UserName user={creator} className="text-xs" />
                </>
              )}
            </span>
            <span>{t("created", { date: formatShortDate(locale, bet.createdAt) })}</span>
            <span
              className={cn(
                "text-[11px] font-semibold uppercase tracking-wider",
                effectiveState === "open" && duelPhase !== "expired"
                  ? "text-jade/80"
                  : "text-muted-foreground",
              )}
            >
              {stateLabel(locale, tState, effectiveState, bet, duelPhase)}
            </span>
          </div>
        </div>
        {/* No `Wager` on a duel for anyone, at any breakpoint, in any state —
            `place_wager` refuses it, so the button would be a lie. */}
        {!isDuel && effectiveState === "open" && (
          <button
            type="button"
            onClick={() => open("wager", bet.id)}
            className="cut-sm h-9 shrink-0 bg-jade px-4 text-xs font-semibold uppercase tracking-wide text-black transition-[filter] motion-safe:hover:brightness-110 motion-safe:active:brightness-95"
          >
            {t("wager")}
          </button>
        )}
      </header>

      {isDuel ? (
        duel && (
          <DuelPanel
          bet={bet}
          duel={duel}
          phase={duelPhase}
          mayAccept={mayAcceptDuel}
            mayDecline={mayDeclineDuel}
          />
        )
      ) : (
        <>
          {/* stats strip */}
          <div className="mt-5 grid grid-cols-2 gap-3 border-y border-border py-3 sm:grid-cols-4">
            <div>
              <p className={eyebrowClass}>{t("pool")}</p>
              <CoinAmount amount={poolTotal} className="text-sm text-foreground" />
            </div>
            <div>
              <p className={eyebrowClass}>{t("maxPerUser")}</p>
              <CoinAmount amount={bet.maxWagerPerUser} className="text-sm text-foreground" />
            </div>
            <div>
              <p className={eyebrowClass}>
                {effectiveState === "open" ? t("closesIn") : t("closed")}
              </p>
              <p className="font-mono text-sm tabular-nums text-foreground">
                {effectiveState === "open"
                  ? now == null
                    ? "—"
                    : formatTimeLeft(locale, bet.closesAt, now).label
                  : formatShortDate(locale, bet.closesAt)}
              </p>
            </div>
            <div>
              <p className={eyebrowClass}>{t("players")}</p>
              <p className="font-mono text-sm tabular-nums text-foreground">{playerCount}</p>
            </div>
          </div>

          {/* options */}
          <section className="mt-6">
            <p className={eyebrowClass}>{t("options")}</p>
            <ul className="mt-2 space-y-2">
              {poolStats.map((opt) => {
                const isWinner = opt.optionId === winningOptionId;
                const isLoser = winningOptionId != null && !isWinner;
                return (
                  <li
                    key={opt.optionId}
                    className={cn(
                      "relative overflow-hidden rounded-sm border p-3",
                      isWinner
                        ? "border-jade bg-jade-wash"
                        : isLoser
                          ? "border-rust-border"
                          : "border-border",
                    )}
                  >
                    {/* live pool-share fill behind the row content */}
                    <div
                      className={cn(
                        "absolute inset-y-0 left-0",
                        isWinner
                          ? "bg-jade/10"
                          : isLoser
                            ? "bg-rust-wash"
                            : "bg-surface-2",
                      )}
                      style={{ width: `${Math.round(opt.share * 100)}%` }}
                    />
                    <div className="relative flex items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-1.5">
                        {!isLoser && <span className="shrink-0 font-mono text-jade">/</span>}
                        <span
                          className={cn(
                            "truncate text-sm",
                            isWinner
                              ? "font-semibold text-text-strong"
                              : isLoser
                                ? "text-negative"
                                : "text-foreground",
                          )}
                        >
                          {opt.label}
                        </span>
                        {isWinner && (
                          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-jade">
                            Winner
                          </span>
                        )}
                      </span>
                      <span
                        className={cn(
                          "flex shrink-0 items-center gap-2 font-mono text-xs tabular-nums",
                          isLoser ? "text-negative" : "text-muted-foreground",
                        )}
                      >
                        <CoinAmount amount={opt.total} />
                        <span>{Math.round(opt.share * 100)}%</span>
                        <span className={cn(isLoser && "line-through")}>
                          {opt.multiplier ? `${opt.multiplier.toFixed(2)}x` : "—"}
                        </span>
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}

      {mayCloseEarly && <CloseEarlyControl betId={bet.id} />}
      {mayResolve && <ResolvePanel bet={bet} />}
      {mayResolveDuel && duel && <DuelResolvePanel bet={bet} duel={duel} />}
      {bet.state === "resolved" && bet.resolution && (
        <SettlementBlock bet={bet} resolution={bet.resolution} />
      )}

      {/* wagers */}
      <section className="mt-6">
        <p className={eyebrowClass}>{t("wagers", { count: betWagers.length })}</p>
        {betWagers.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t("noWagers")}</p>
        ) : (
          <ul className="mt-2 divide-y divide-border border-y border-border">
            {betWagers.map((wager) => {
              const user = userById(wager.userId);
              const optionLabel =
                bet.options.find((o) => o.id === wager.optionId)?.label ?? "—";
              return (
                <li key={wager.id} className="flex items-center gap-3 py-2.5">
                  {user && <UserAvatar user={user} size={20} />}
                  {user && <UserName user={user} badge className="text-sm" />}
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {t("onOption", { option: optionLabel })}
                  </span>
                  <CoinAmount amount={wager.amount} className="text-sm" />
                  <span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                    {now == null ? "—" : formatRelativePast(locale, wager.placedAt, now)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <CommentsSection betId={bet.id} canPost={mayComment} />

      {mayDelete && <DeleteBetPanel bet={bet} />}
    </>
  );
}

/**
 * The duel's replacement for the stats strip and the options list (Extra
 * Phase 3, task 9).
 *
 * The options list is not merely re-skinned, it is gone: a duel's two options
 * ARE its two people, `getPoolStats` returns a flat 2.00x on each because the
 * stakes are symmetric, and a pool-share bar that is always 50/50 is a
 * decoration pretending to be data. The versus composition says the same thing
 * truthfully, at §4.5's comfortable tier because this is the page with room
 * for it.
 *
 * The mediator line is the one fact this page has that the row does not have
 * space for, and it reads off the ROW (`duel.anyModerator`), never off
 * `team.accessMode`: D9 applies at creation and never retroactively, so a duel
 * started while the team was restricted keeps its guarantee after the team is
 * flipped back, and a duel started after the flip does not gain one.
 */
function DuelPanel({
  bet,
  duel,
  phase,
  mayAccept,
  mayDecline,
}: {
  bet: Bet;
  duel: Duel;
  phase: DuelPhase | null;
  mayAccept: boolean;
  mayDecline: boolean;
}) {
  const { team, userById } = useTeam();
  const { open } = useModal();
  const now = useNow();
  const locale = useLocale();
  const t = useTranslations("betDetail");

  const mediator = duel.mediatorId == null ? undefined : userById(duel.mediatorId);
  // D7's stranding guarantee, and the reason `userById` alone is not enough to
  // answer this cell. `userById` resolves anyone this client can READ — RLS
  // admits every teammate-of-a-teammate — so a mediator who has LEFT still
  // resolves to a name and would be printed as the person to wait for, while
  // `canResolveDuel` has already handed the duel to the moderator pool. The
  // roster is the authority here, exactly as it is there.
  const mediatorOnRoster =
    duel.mediatorId != null &&
    team.members.some((m) => m.userId === duel.mediatorId);

  return (
    <>
      <section className="mt-5 border-y border-border py-4">
        <Versus
          challengerId={duel.challengerId}
          challengeeId={duel.challengeeId}
          size="comfortable"
        />
      </section>

      <div className="mt-5 grid grid-cols-2 gap-3 border-b border-border pb-3 sm:grid-cols-4">
        <div>
          <p className={eyebrowClass}>{t("stakeEach")}</p>
          <CoinAmount amount={duel.stake} className="text-sm text-foreground" />
        </div>
        <div>
          <p className={eyebrowClass}>{t("winnerTakes")}</p>
          <CoinAmount amount={duel.stake * 2} className="text-sm text-foreground" />
        </div>
        {/* One cell, three readings, and NONE of them is `duel.expiresAt`.
            That field is the ACCEPT DEADLINE — written equal to `closesAt` at
            creation and, unlike `closesAt`, never overwritten on accept, which
            is exactly what makes it look like a durable fact worth printing.
            It is durable, and it is still the deadline: showing it under
            "Challenged" states a date 24 hours after the thing it claims to
            date.
            While the challenge is open the cell is the live countdown. Once
            accepted it becomes WHEN it was accepted — the one fact this page
            has nowhere else, and the natural close of the sentence "Accept
            by…". For a duel that was never accepted there is no such moment,
            so it falls back to when the challenge was sent, which is also the
            only reading under which "Challenged" is true. */}
        <div>
          <p className={eyebrowClass}>
            {phase === "pending"
              ? t("acceptBy")
              : duel.acceptedAt != null
                ? t("accepted")
                : t("challenged")}
          </p>
          <p className="font-mono text-sm tabular-nums text-foreground">
            {phase === "pending"
              ? now == null
                ? "—"
                : formatTimeLeft(locale, bet.closesAt, now).label
              : formatShortDate(locale, duel.acceptedAt ?? bet.createdAt)}
          </p>
        </div>
        <div>
          <p className={eyebrowClass}>{t("resolvedBy")}</p>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-foreground">
            {mediatorOnRoster && mediator && (
              <UserName user={mediator} className="text-sm" />
            )}
            {/* Named someone who has since left. D7 hands the duel to the
                moderator pool at read time rather than rewriting the row, so
                the history still says who was chosen — and the cell has to say
                the pool can act, or it names the one person who now cannot. */}
            {duel.mediatorId != null && !mediatorOnRoster && (
              <span className="text-sm text-muted-foreground">
                {mediator
                  ? t("mediatorLeftNamed", { name: mediator.displayName })
                  : t("mediatorLeft")}
              </span>
            )}
            {(duel.anyModerator || (duel.mediatorId != null && !mediatorOnRoster)) && (
              <span className="text-xs text-muted-foreground">
                {duel.mediatorId != null ? t("anyModeratorAlso") : t("anyModerator")}
              </span>
            )}
          </div>
        </div>
      </div>

      {(mayAccept || mayDecline) && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-sm border border-border bg-surface-1 p-3">
          <span className="flex-1 text-xs text-muted-foreground">
            {t("challengedYou")}
          </span>
          <button
            type="button"
            onClick={() => open("duel-accept", bet.id)}
            className="h-8 rounded-sm border border-border px-3 text-xs font-semibold uppercase text-foreground transition-colors hover:border-jade/50 hover:text-jade"
          >
            {t("decline")}
          </button>
          <button
            type="button"
            disabled={!mayAccept}
            onClick={() => open("duel-accept", bet.id)}
            className="h-8 rounded-sm bg-jade px-3 text-xs font-semibold uppercase text-black transition-[filter] motion-safe:hover:brightness-110 motion-safe:active:brightness-95 disabled:opacity-40 disabled:pointer-events-none"
          >
            {t("accept")}
          </button>
        </div>
      )}
    </>
  );
}

/**
 * UX-018: the bet's own mini chat. Dense §5.7 rows — 24px avatar, name in the
 * user's name color with its rank badge, message N7, mono timestamp trailing —
 * no bubbles, no hover cards. DOM-030: free-form, nothing is filtered.
 */
function CommentsSection({ betId, canPost }: { betId: string; canPost: boolean }) {
  const { comments, userById, addComment } = useTeam();
  const now = useNow();
  const { errorText } = useErrorText();
  const locale = useLocale();
  const t = useTranslations("betDetail");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const thread = comments
    .filter((c) => c.betId === betId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const canSubmit = canPost && !pending && validateCommentBody(body).length === 0;

  // Async since roadmap Phase 7: the comment is a row in `comments` now, and
  // the input stays filled until the insert is accepted so a failed post never
  // silently eats what someone typed.
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setPending(true);
    const result = await addComment(betId, body);
    setPending(false);
    if (result.ok) {
      setBody("");
      setError(null);
    } else {
      setError(errorText(result));
    }
  }

  return (
    <section className="mt-6">
      <p className={eyebrowClass}>{t("comments", { count: thread.length })}</p>

      {thread.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          {t("noComments")}
        </p>
      ) : (
        <div className="mt-2">
          {thread.map((comment) => {
            const user = userById(comment.userId);
            return (
              <div key={comment.id} className="flex items-start gap-2 py-1.5">
                {user && <UserAvatar user={user} size={24} />}
                {user && <UserName user={user} badge className="shrink-0 text-sm" />}
                <span className="min-w-0 flex-1 break-words text-sm text-foreground">
                  {comment.body}
                </span>
                <span className="w-14 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                  {now == null ? "—" : formatRelativePast(locale, comment.createdAt, now)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <form
        onSubmit={(e) => void submit(e)}
        className="mt-2 flex items-center gap-2 border-t border-border bg-surface-1 pt-2"
      >
        <input
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            setError(null);
          }}
          disabled={!canPost}
          placeholder={canPost ? t("commentPlaceholder") : t("commentDisabled")}
          className="h-8 min-w-0 flex-1 rounded-none border border-border bg-surface-2 px-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-jade focus:outline-none focus:ring-1 focus:ring-jade/40 disabled:opacity-40"
        />
        {/* Send affordance is the brand slash itself (§5.7), not an icon glyph. */}
        <button
          type="submit"
          disabled={!canSubmit}
          aria-label={t("postComment")}
          className="flex size-8 items-center justify-center font-mono text-muted-foreground transition-colors hover:text-jade disabled:opacity-40 disabled:pointer-events-none"
        >
          /
        </button>
      </form>
      {error && <p className="mt-1.5 text-xs text-negative">{error}</p>}
    </section>
  );
}

/**
 * DOM-033/034: hard delete behind an exact-title type-to-confirm gate. The
 * bet's money effects are unwound by settlement.ts (`reverseBet`) inside the
 * mutator — stakes come back, and a resolved bet's payouts are undone.
 */
function DeleteBetPanel({ bet }: { bet: Bet }) {
  const { deleteBet } = useTeam();
  const { show } = useToast();
  const { errorText } = useErrorText();
  const router = useRouter();
  const t = useTranslations("betDetail");
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const matches = confirmText === bet.title && !pending;

  // Async since roadmap Phase 6: the cascade and the money reversal are one
  // Postgres transaction (the `delete_bet` RPC).
  async function submit() {
    setError(null);
    setPending(true);
    // Captured before the await: succeeding tears this panel down. The bet
    // leaves the team store before `deleteBet` resolves, so BetDetail's
    // `if (!bet)` branch takes over on the very next render.
    const title = bet.title;
    const result = await deleteBet(bet.id);
    if (result.ok) {
      // D1: the toast has to come from the provider above this page, never from
      // this panel — the panel and the whole route are gone a tick later, and a
      // component-local timer would die before it could paint. D4's caller
      // override exists for exactly this sentence: a bet title can be long, so
      // it gets 5s instead of §5.9's 3.5s default. D3: a completed delete is
      // destructive (ember rail), not a jade success.
      show({
        kind: "destructive",
        text: t("deleted", { title }),
        durationMs: 5000,
      });
      // The bet is gone — this page has nothing left to render.
      router.push("/");
      return;
    }
    setPending(false);
    setError(errorText(result));
  }

  return (
    <section className="mt-6 space-y-2 rounded-sm border border-ember-border p-3">
      <p className={eyebrowClass}>{t("dangerZone")}</p>
      <p className="text-sm text-foreground">{t("deleteBet")}</p>
      <p
        className={cn(
          "text-xs text-muted-foreground transition-opacity",
          matches && "opacity-0",
        )}
      >
        {t("deleteWarning")}
      </p>
      <input
        type="text"
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        placeholder={t("deleteConfirmPlaceholder", { title: bet.title })}
        className={cn(
          "w-full border bg-surface-1 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none",
          matches ? "border-jade" : "border-border",
        )}
      />
      <button
        type="button"
        disabled={!matches}
        onClick={() => void submit()}
        className="cut-danger h-9 w-full px-5 text-xs font-semibold uppercase tracking-wide text-black bg-destructive opacity-40 pointer-events-none transition-opacity enabled:opacity-100 enabled:pointer-events-auto"
      >
        {pending ? t("deleting") : t("deleteBet")}
      </button>
      {error && <p className="text-xs text-negative">{error}</p>}
    </section>
  );
}

/** DOM-011: two-step inline confirm — closing early is not undoable. */
function CloseEarlyControl({ betId }: { betId: string }) {
  const { closeBetEarly } = useTeam();
  const { errorText } = useErrorText();
  const { show } = useToast();
  const t = useTranslations("betDetail");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Async since roadmap Phase 6: `close_bet_early` moves state and closes_at
  // together and hands back the timestamp it wrote (DOM-012).
  async function confirm() {
    setError(null);
    setPending(true);
    const result = await closeBetEarly(betId);
    setPending(false);
    if (!result.ok) {
      setError(errorText(result));
      return;
    }
    // D3, the other way round: closing early is DOM-011 lifecycle, not
    // destruction, so this is the jade rail and not the ember one. Until now
    // this control simply vanished when `bet.state` flipped, which confirmed
    // nothing — the toast is the only acknowledgement the action gets, and it
    // outlives the control that fired it (D1).
    show({ kind: "success", text: t("bettingClosed") });
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 rounded-sm border border-border bg-surface-1 p-3">
      {confirming ? (
        <>
          <span className="text-xs text-muted-foreground">
            {t("closeEarlyConfirm")}
          </span>
          <button
            type="button"
            disabled={pending}
            onClick={() => void confirm()}
            className="h-8 rounded-sm bg-jade px-3 text-xs font-semibold uppercase text-black transition-[filter] motion-safe:hover:brightness-110 disabled:opacity-40 disabled:pointer-events-none"
          >
            {pending ? t("closing") : t("confirmClose")}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="h-8 rounded-sm border border-border px-3 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {t("cancel")}
          </button>
        </>
      ) : (
        <>
          <span className="flex-1 text-xs text-muted-foreground">
            {t("closeEarlyOffer")}
          </span>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="h-8 rounded-sm border border-border px-3 text-xs font-semibold uppercase text-foreground transition-colors hover:border-jade/50 hover:text-jade"
          >
            {t("closeEarly")}
          </button>
        </>
      )}
      {error && <p className="w-full text-xs text-negative">{error}</p>}
    </div>
  );
}

/** DOM-018/019: declare the winning option, or void to refund everyone. */
function ResolvePanel({ bet }: { bet: Bet }) {
  const { errorText } = useErrorText();
  const { resolveBet } = useTeam();
  const t = useTranslations("betDetail");
  const [choice, setChoice] = useState<string | null>(null); // optionId | "void"
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Async since roadmap Phase 7: `resolve_bet` writes the resolution AND every
  // wagerer's balance and P/L in one transaction, and the deltas that come
  // back are the ones Postgres applied.
  async function confirm() {
    if (!choice || pending) return;
    setError(null);
    setPending(true);
    const resolution: BetResolution =
      choice === "void"
        ? { kind: "void" }
        : { kind: "winner", winningOptionId: choice };
    const result = await resolveBet(bet.id, resolution);
    if (!result.ok) {
      setPending(false);
      setError(errorText(result));
    }
    // On success the bet leaves "closed" and this panel unmounts.
  }

  return (
    <section className="mt-4 rounded-sm border border-border bg-surface-1 p-4">
      <p className={eyebrowClass}>{t("resolveBet")}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {bet.options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setChoice(option.id)}
            className={cn(
              "border px-3 py-1.5 text-xs font-medium transition-colors",
              choice === option.id
                ? "border-jade bg-jade-wash text-jade"
                : "border-border text-muted-foreground hover:border-border-strong",
            )}
          >
            {option.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setChoice("void")}
          className={cn(
            "border px-3 py-1.5 text-xs font-medium uppercase tracking-wide transition-colors",
            choice === "void"
              ? "border-jade bg-jade-wash text-jade"
              : "border-border text-muted-foreground hover:border-border-strong",
          )}
        >
          {t("voidRefundEveryone")}
        </button>
      </div>
      <button
        type="button"
        disabled={!choice || pending}
        onClick={() => void confirm()}
        className="cut-sm mt-3 h-9 px-4 text-xs font-semibold uppercase tracking-wide text-black bg-jade transition-[filter] motion-safe:hover:brightness-110 motion-safe:active:brightness-95 disabled:opacity-40 disabled:pointer-events-none"
      >
        {pending
          ? t("payingOut")
          : choice === "void"
            ? t("confirmVoid")
            : t("confirmResult")}
      </button>
      {error && <p className="mt-2 text-xs text-negative">{error}</p>}
    </section>
  );
}

/**
 * D6/D7's resolve control — two participant buttons plus Void, never an option
 * list (Extra Phase 3, task 9).
 *
 * It is a separate component from `ResolvePanel` rather than a branch inside
 * it because the two answer different questions. A pool bet's resolver picks
 * an OPTION out of an arbitrary-length list; a duel's mediator picks a PERSON,
 * and there are exactly two. Rendering people as options is how a mediator
 * ends up scanning a list to find a name.
 *
 * The buttons map by `bet_options.position` — 0 is the challenger, 1 is the
 * challengee, a fixed convention `create_duel`, `accept_duel` and every test
 * depend on — and `team-data.ts` sorts the embed by that column. The button
 * TEXT is the stored `label`, which is a display-name snapshot taken at
 * creation and never updated: matching on the label against a current display
 * name would break the moment someone renames themselves, which is exactly why
 * `bet_options` has no UPDATE path at all.
 *
 * The void arm sends no reason. `resolve_bet` coalesces a duel's missing
 * `p_void_reason` to `'mediator'` because only the server knows the caller
 * passed the mediator authorization; guessing it here would be the client
 * asserting something it cannot know.
 */
function DuelResolvePanel({ bet, duel }: { bet: Bet; duel: Duel }) {
  const { errorText } = useErrorText();
  const { resolveBet, userById } = useTeam();
  const t = useTranslations("betDetail");
  const [choice, setChoice] = useState<string | null>(null); // optionId | "void"
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const sides = [
    { option: bet.options[0], userId: duel.challengerId },
    { option: bet.options[1], userId: duel.challengeeId },
  ].filter((s) => s.option != null);

  async function confirm() {
    if (!choice || pending) return;
    setError(null);
    setPending(true);
    const resolution: BetResolution =
      choice === "void"
        ? { kind: "void" }
        : { kind: "winner", winningOptionId: choice };
    const result = await resolveBet(bet.id, resolution);
    if (!result.ok) {
      setPending(false);
      setError(errorText(result));
    }
    // On success the bet becomes resolved and this panel unmounts.
  }

  return (
    <section className="mt-4 rounded-sm border border-border bg-surface-1 p-4">
      <p className={eyebrowClass}>{t("callIt")}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {t.rich("callItNote", {
          payout: () => <CoinAmount amount={duel.stake * 2} />,
        })}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {sides.map(({ option, userId }) => {
          const user = userById(userId);
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setChoice(option.id)}
              className={cn(
                "flex items-center gap-2 border px-3 py-2 text-sm transition-colors",
                choice === option.id
                  ? "border-jade bg-jade-wash"
                  : "border-border hover:border-border-strong",
              )}
            >
              {user && <UserAvatar user={user} size={20} />}
              <span
                className="font-medium"
                style={user ? { color: user.nameColor } : undefined}
              >
                {option.label}
              </span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setChoice("void")}
          className={cn(
            "border px-3 py-2 text-xs font-medium uppercase tracking-wide transition-colors",
            choice === "void"
              ? "border-jade bg-jade-wash text-jade"
              : "border-border text-muted-foreground hover:border-border-strong",
          )}
        >
          {t("voidRefundBoth")}
        </button>
      </div>
      <button
        type="button"
        disabled={!choice || pending}
        onClick={() => void confirm()}
        className="cut-sm mt-3 h-9 px-4 text-xs font-semibold uppercase tracking-wide text-black bg-jade transition-[filter] motion-safe:hover:brightness-110 motion-safe:active:brightness-95 disabled:opacity-40 disabled:pointer-events-none"
      >
        {pending
          ? t("payingOut")
          : choice === "void"
            ? t("confirmVoid")
            : t("confirmWinner")}
      </button>
      {error && <p className="mt-2 text-xs text-negative">{error}</p>}
    </section>
  );
}

/** Post-resolution receipt straight from settlement.ts — same math as balances. */
function SettlementBlock({ bet, resolution }: { bet: Bet; resolution: BetResolution }) {
  const { wagers, userById } = useTeam();
  const t = useTranslations("betDetail");
  const deltas = settleBet(bet, wagers, resolution).sort(
    (a, b) => b.profitLossDelta - a.profitLossDelta,
  );

  if (deltas.length === 0) return null;

  return (
    <section className="mt-4 rounded-sm border border-border bg-surface-1 p-4">
      <p className={eyebrowClass}>{t("settlement")}</p>
      <ul className="mt-2 space-y-1.5">
        {deltas.map((delta) => {
          const user = userById(delta.userId);
          return (
            <li key={delta.userId} className="flex items-center gap-2 text-sm">
              {user && <UserAvatar user={user} size={18} />}
              {user ? (
                <UserName user={user} className="text-sm" />
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
              <span className="ml-auto">
                {resolution.kind === "void" ? (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <CoinAmount amount={delta.balanceDelta} /> {t("refunded")}
                  </span>
                ) : (
                  <CoinDelta amount={delta.profitLossDelta} className="text-sm" />
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
