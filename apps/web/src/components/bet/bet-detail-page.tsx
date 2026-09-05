"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "cn";
import {
  canCloseBetEarly,
  canComment,
  canDeleteBet,
  canResolveBet,
  computeEffectiveState,
  getPoolStats,
  settleBet,
  validateCommentBody,
  type Bet,
  type BetResolution,
  type BetState,
} from "@repo/shared";
import { AuthGated } from "@/components/app-gate";
import { TeamGate } from "@/components/team-gate";
import { TopBar } from "@/components/shell/top-bar";
import { useTeam } from "@/lib/team-context";
import { useModal } from "@/lib/modal-context";
import { useNow } from "@/lib/use-now";
import { formatRelativePast, formatShortDate, formatTimeLeft } from "@/lib/format";
import { UserAvatar } from "@/components/sl/user-avatar";
import { UserName } from "@/components/sl/user-name";
import { CoinAmount, CoinDelta } from "@/components/sl/coin-amount";

const eyebrowClass =
  "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

/**
 * Bet detail (UX-015, the one allowed full page): full bet info, wager list,
 * and the Phase-1 moderation controls — early close (DOM-011) and resolve
 * (DOM-018/019) — gated through packages/shared permissions.ts.
 */
export function BetDetailPage({ betId }: { betId: string }) {
  return (
    <AuthGated>
      <TeamGate>
        <TopBar />
        <main className="mx-auto w-full max-w-3xl px-4 py-5">
          <Link
            href="/"
            className="font-mono text-xs text-muted-foreground transition-colors hover:text-jade"
          >
            / back to bets
          </Link>
          <BetDetail betId={betId} />
        </main>
      </TeamGate>
    </AuthGated>
  );
}

function BetDetail({ betId }: { betId: string }) {
  const { bets, team } = useTeam();
  const bet = bets.find((b) => b.id === betId);

  if (!bet) {
    return (
      <div className="mt-4 rounded-sm border border-border bg-surface-1 p-6 text-center">
        <p className="text-sm text-foreground">Bet not found in {team.name}.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          It may belong to another team or no longer exist.
        </p>
      </div>
    );
  }

  return <BetDetailContent bet={bet} />;
}

function stateLabel(effectiveState: BetState, bet: Bet): string {
  if (effectiveState === "open") return "OPEN";
  if (effectiveState === "closed") return "AWAITING RESULT";
  return bet.resolution?.kind === "void" ? "VOID · REFUNDED" : "RESOLVED";
}

function BetDetailContent({ bet }: { bet: Bet }) {
  const { wagers, team, currentUser, userById } = useTeam();
  const { open } = useModal();
  const now = useNow();

  // Until the clock mounts (useNow is null on the first render) fall back to
  // the stored state; the effective open→closed auto-transition kicks in one
  // tick later. Mutators re-guard with a fresh clock anyway.
  const effectiveState = now == null ? bet.state : computeEffectiveState(bet, now);
  const poolStats = getPoolStats(bet, wagers);
  const poolTotal = poolStats.reduce((sum, o) => sum + o.total, 0);
  const betWagers = wagers
    .filter((w) => w.betId === bet.id)
    .sort((a, b) => b.placedAt.localeCompare(a.placedAt));
  const playerCount = new Set(betWagers.map((w) => w.userId)).size;
  const creator = userById(bet.creatorId);

  const mayCloseEarly =
    effectiveState === "open" && canCloseBetEarly(team, currentUser.id, bet);
  const mayResolve =
    effectiveState === "closed" && canResolveBet(team, currentUser.id, bet);
  const mayDelete = canDeleteBet(team, currentUser.id, bet);
  const mayComment = canComment(team, currentUser.id);

  const winningOptionId =
    bet.resolution?.kind === "winner" ? bet.resolution.winningOptionId : null;

  return (
    <>
      {/* header */}
      <header className="mt-3 flex items-start gap-4">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-sm bg-surface-2 text-2xl">
          {bet.iconEmoji ?? "🎲"}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold leading-tight text-text-strong sm:text-2xl">
            {bet.title}
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              by
              {creator && (
                <>
                  <UserAvatar user={creator} size={16} />
                  <UserName user={creator} className="text-xs" />
                </>
              )}
            </span>
            <span>· created {formatShortDate(bet.createdAt)}</span>
            <span
              className={cn(
                "text-[11px] font-semibold uppercase tracking-wider",
                effectiveState === "open" ? "text-jade/80" : "text-muted-foreground",
              )}
            >
              {stateLabel(effectiveState, bet)}
            </span>
          </div>
        </div>
        {effectiveState === "open" && (
          <button
            type="button"
            onClick={() => open("wager", bet.id)}
            className="cut-sm h-9 shrink-0 bg-jade px-4 text-xs font-semibold uppercase tracking-wide text-black transition-[filter] motion-safe:hover:brightness-110 motion-safe:active:brightness-95"
          >
            Wager
          </button>
        )}
      </header>

      {/* stats strip */}
      <div className="mt-5 grid grid-cols-2 gap-3 border-y border-border py-3 sm:grid-cols-4">
        <div>
          <p className={eyebrowClass}>Pool</p>
          <CoinAmount amount={poolTotal} className="text-sm text-foreground" />
        </div>
        <div>
          <p className={eyebrowClass}>Max / user</p>
          <CoinAmount amount={bet.maxWagerPerUser} className="text-sm text-foreground" />
        </div>
        <div>
          <p className={eyebrowClass}>
            {effectiveState === "open" ? "Closes in" : "Closed"}
          </p>
          <p className="font-mono text-sm tabular-nums text-foreground">
            {effectiveState === "open"
              ? now == null
                ? "—"
                : formatTimeLeft(bet.closesAt, now).label
              : formatShortDate(bet.closesAt)}
          </p>
        </div>
        <div>
          <p className={eyebrowClass}>Players</p>
          <p className="font-mono text-sm tabular-nums text-foreground">{playerCount}</p>
        </div>
      </div>

      {/* options */}
      <section className="mt-6">
        <p className={eyebrowClass}>Options</p>
        <ul className="mt-2 space-y-2">
          {poolStats.map((opt) => {
            const isWinner = opt.optionId === winningOptionId;
            const isLoser = winningOptionId != null && !isWinner;
            return (
              <li
                key={opt.optionId}
                className={cn(
                  "relative overflow-hidden rounded-sm border p-3",
                  isWinner ? "border-jade bg-jade-wash" : "border-border",
                )}
              >
                {/* live pool-share fill behind the row content */}
                <div
                  className={cn(
                    "absolute inset-y-0 left-0",
                    isWinner ? "bg-jade/10" : "bg-surface-2",
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
                            ? "text-muted-foreground"
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
                  <span className="flex shrink-0 items-center gap-2 font-mono text-xs tabular-nums text-muted-foreground">
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

      {mayCloseEarly && <CloseEarlyControl betId={bet.id} />}
      {mayResolve && <ResolvePanel bet={bet} />}
      {bet.state === "resolved" && bet.resolution && (
        <SettlementBlock bet={bet} resolution={bet.resolution} />
      )}

      {/* wagers */}
      <section className="mt-6">
        <p className={eyebrowClass}>Wagers ({betWagers.length})</p>
        {betWagers.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No wagers yet.</p>
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
                    on {optionLabel}
                  </span>
                  <CoinAmount amount={wager.amount} className="text-sm" />
                  <span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                    {now == null ? "—" : formatRelativePast(wager.placedAt, now)}
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
 * UX-018: the bet's own mini chat. Dense §5.7 rows — 24px avatar, name in the
 * user's name color with its rank badge, message N7, mono timestamp trailing —
 * no bubbles, no hover cards. DOM-030: free-form, nothing is filtered.
 */
function CommentsSection({ betId, canPost }: { betId: string; canPost: boolean }) {
  const { comments, userById, addComment } = useTeam();
  const now = useNow();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  const thread = comments
    .filter((c) => c.betId === betId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const canSubmit = canPost && validateCommentBody(body).length === 0;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    const result = addComment(betId, body);
    if (result.ok) {
      setBody("");
      setError(null);
    } else {
      setError(result.error);
    }
  }

  return (
    <section className="mt-6">
      <p className={eyebrowClass}>Comments ({thread.length})</p>

      {thread.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Nothing said yet. Someone start something.
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
                  {now == null ? "—" : formatRelativePast(comment.createdAt, now)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <form
        onSubmit={submit}
        className="mt-2 flex items-center gap-2 border-t border-border bg-surface-1 pt-2"
      >
        <input
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            setError(null);
          }}
          disabled={!canPost}
          placeholder={canPost ? "Say something" : "Only team members can comment"}
          className="h-8 min-w-0 flex-1 rounded-none border border-border bg-surface-2 px-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-jade focus:outline-none focus:ring-1 focus:ring-jade/40 disabled:opacity-40"
        />
        {/* Send affordance is the brand slash itself (§5.7), not an icon glyph. */}
        <button
          type="submit"
          disabled={!canSubmit}
          aria-label="Post comment"
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
  const router = useRouter();
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const matches = confirmText === bet.title;

  function submit() {
    const result = deleteBet(bet.id);
    // The bet is gone — this page has nothing left to render.
    if (result.ok) router.push("/");
    else setError(result.error);
  }

  return (
    <section className="mt-6 space-y-2 rounded-sm border border-ember-border p-3">
      <p className={eyebrowClass}>Danger zone</p>
      <p className="text-sm text-foreground">Delete bet</p>
      <p
        className={cn(
          "text-xs text-muted-foreground transition-opacity",
          matches && "opacity-0",
        )}
      >
        Permanent. Wagers are returned to their owners and this bet stops
        counting toward anyone&apos;s P/L.
      </p>
      <input
        type="text"
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        placeholder={`Type "${bet.title}" to confirm`}
        className={cn(
          "w-full border bg-surface-1 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none",
          matches ? "border-jade" : "border-border",
        )}
      />
      <button
        type="button"
        disabled={!matches}
        onClick={submit}
        className="cut-danger h-9 w-full px-5 text-xs font-semibold uppercase tracking-wide text-black bg-destructive opacity-40 pointer-events-none transition-opacity enabled:opacity-100 enabled:pointer-events-auto"
      >
        Delete bet
      </button>
      {error && <p className="text-xs text-negative">{error}</p>}
    </section>
  );
}

/** DOM-011: two-step inline confirm — closing early is not undoable. */
function CloseEarlyControl({ betId }: { betId: string }) {
  const { closeBetEarly } = useTeam();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function confirm() {
    const result = closeBetEarly(betId);
    if (!result.ok) setError(result.error);
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 rounded-sm border border-border bg-surface-1 p-3">
      {confirming ? (
        <>
          <span className="text-xs text-muted-foreground">
            Close betting now? No more wagers after this.
          </span>
          <button
            type="button"
            onClick={confirm}
            className="h-8 rounded-sm bg-jade px-3 text-xs font-semibold uppercase text-black transition-[filter] motion-safe:hover:brightness-110"
          >
            Confirm close
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="h-8 rounded-sm border border-border px-3 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Cancel
          </button>
        </>
      ) : (
        <>
          <span className="flex-1 text-xs text-muted-foreground">
            You can close betting early (creator/moderator).
          </span>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="h-8 rounded-sm border border-border px-3 text-xs font-semibold uppercase text-foreground transition-colors hover:border-jade/50 hover:text-jade"
          >
            Close betting early
          </button>
        </>
      )}
      {error && <p className="w-full text-xs text-negative">{error}</p>}
    </div>
  );
}

/** DOM-018/019: declare the winning option, or void to refund everyone. */
function ResolvePanel({ bet }: { bet: Bet }) {
  const { resolveBet } = useTeam();
  const [choice, setChoice] = useState<string | null>(null); // optionId | "void"
  const [error, setError] = useState<string | null>(null);

  function confirm() {
    if (!choice) return;
    const resolution: BetResolution =
      choice === "void"
        ? { kind: "void" }
        : { kind: "winner", winningOptionId: choice };
    const result = resolveBet(bet.id, resolution);
    if (!result.ok) setError(result.error);
    // On success the bet leaves "closed" and this panel unmounts.
  }

  return (
    <section className="mt-4 rounded-sm border border-border bg-surface-1 p-4">
      <p className={eyebrowClass}>Resolve bet</p>
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
          Void — refund everyone
        </button>
      </div>
      <button
        type="button"
        disabled={!choice}
        onClick={confirm}
        className="cut-sm mt-3 h-9 px-4 text-xs font-semibold uppercase tracking-wide text-black bg-jade transition-[filter] motion-safe:hover:brightness-110 motion-safe:active:brightness-95 disabled:opacity-40 disabled:pointer-events-none"
      >
        {choice === "void" ? "Confirm void" : "Confirm result"}
      </button>
      {error && <p className="mt-2 text-xs text-negative">{error}</p>}
    </section>
  );
}

/** Post-resolution receipt straight from settlement.ts — same math as balances. */
function SettlementBlock({ bet, resolution }: { bet: Bet; resolution: BetResolution }) {
  const { wagers, userById } = useTeam();
  const deltas = settleBet(bet, wagers, resolution).sort(
    (a, b) => b.profitLossDelta - a.profitLossDelta,
  );

  if (deltas.length === 0) return null;

  return (
    <section className="mt-4 rounded-sm border border-border bg-surface-1 p-4">
      <p className={eyebrowClass}>Settlement</p>
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
                    <CoinAmount amount={delta.balanceDelta} /> refunded
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
