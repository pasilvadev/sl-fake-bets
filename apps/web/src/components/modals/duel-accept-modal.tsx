"use client";

import { useState } from "react";
import { cn } from "cn";
import { useLocale, useTranslations } from "next-intl";
import {
  canAcceptDuel,
  canDeclineDuel,
  computeDuelPhase,
  type DuelPhase,
} from "@repo/shared";
import { useModal } from "@/lib/modal-context";
import { useTeam } from "@/lib/team-context";
import { useToast } from "@/lib/toast-context";
import { useNow } from "@/lib/use-now";
import { useErrorText } from "@/lib/use-error-text";
import { ModalShell } from "@/components/sl/modal-shell";
import { Versus } from "@/components/sl/versus";
import { CoinAmount, CoinDelta } from "@/components/sl/coin-amount";
import { formatTimeLeft } from "@/lib/format";

const eyebrowClass =
  "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

/**
 * Answer a challenge (Extra Phase 3, task 7; D3/D5).
 *
 * Opened from the row rather than only from the bet page — UX-016's precedent,
 * the wager modal already opens straight off a card — and reached by BOTH of
 * the row's controls. That is not redundancy: someone who has already decided
 * "no" should not have to press a button labelled Accept to find Decline, and
 * declining moves real money (it voids the bet and refunds the challenger), so
 * it gets the same one-screen review Accept does rather than firing from a
 * one-word control in a list row.
 *
 * The insufficient-funds path is the reason this modal exists at all rather
 * than a bare Accept in the row. DOM-014 is absolute: `accept_duel` refuses an
 * unaffordable stake outright, so the honest move is to disable Accept BEFORE
 * the round trip and offer the decline path carrying
 * `void_reason='insufficient-funds'` — the distinct value that exists so the
 * history row can say the challengee COULDN'T afford it rather than wouldn't
 * (D3). The button's label in that state is the owner's, verbatim.
 */
export function DuelAcceptModal({ betId }: { betId: string }) {
  const { close } = useModal();
  const { bets, team, currentUser, balance, duelFor, acceptDuel, declineDuel } =
    useTeam();
  const { show } = useToast();
  const now = useNow();
  const locale = useLocale();

  const { errorText } = useErrorText();
  const t = useTranslations("duelAcceptModal");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, setPending] = useState<"accept" | "decline" | null>(null);

  const bet = bets.find((b) => b.id === betId);
  const duel = bet ? duelFor(bet.id) : undefined;

  if (!bet || !duel) {
    return (
      <ModalShell eyebrow={t("eyebrow")} title={t("notFound")} onClose={close}>
        <p className="text-sm text-muted-foreground">
          {t("gone")}
        </p>
      </ModalShell>
    );
  }

  // BOTH halves, always. `canAcceptDuel` is a roster+id rule that never looks
  // at the clock; `computeDuelPhase` is the clock and knows nothing about who
  // is asking. Checking one and forgetting the other is the single most likely
  // bug in this whole phase, and it presents as an Accept button on a
  // challenge that lapsed yesterday.
  const phase: DuelPhase =
    now == null ? "pending" : computeDuelPhase(bet, duel, now);
  const mayAccept = canAcceptDuel(team, currentUser.id, duel);
  const mayDecline = canDeclineDuel(team, currentUser.id, duel);

  const affordable = balance >= duel.stake;
  const stillOpen = phase === "pending";
  const acceptEnabled = mayAccept && stillOpen && affordable && pending == null;
  // Decline deliberately does NOT test the clock. Declining an already-expired
  // challenge is harmless — both paths void it and refund the challenger
  // identically — and `decline_duel` is the one duel RPC that does not sweep
  // first, precisely so this stays true. Refusing it here would be a
  // client-side rule the server does not have.
  const declineEnabled = mayDecline && bet.state !== "resolved" && pending == null;

  async function runAccept() {
    if (!acceptEnabled) return;
    setSubmitError(null);
    setPending("accept");
    const result = await acceptDuel(betId);
    setPending(null);
    if (!result.ok) {
      setSubmitError(errorText(result));
      return;
    }
    show({ kind: "success", text: t("accepted"), key: "duel-answer" });
    close();
  }

  async function runDecline() {
    if (!declineEnabled) return;
    setSubmitError(null);
    setPending("decline");
    const result = await declineDuel(
      betId,
      affordable ? "declined" : "insufficient-funds",
    );
    setPending(null);
    if (!result.ok) {
      setSubmitError(errorText(result));
      return;
    }
    // `destructive`, not `failure`: the act worked, and it destroyed a bet.
    // `failure` would claim the decline did not happen.
    show({ kind: "destructive", text: t("declined"), key: "duel-answer" });
    close();
  }

  const closedReason =
    phase === "expired"
      ? t("expired")
      : phase === "accepted"
        ? t("alreadyAccepted")
        : phase === "settled"
          ? t("settled")
          : !mayAccept && !mayDecline
            ? t("notYours")
            : null;

  return (
    <ModalShell
      eyebrow={t("eyebrow")}
      title={`${bet.iconEmoji ? `${bet.iconEmoji} ` : ""}${bet.title}`}
      onClose={close}
      footer={
        <div className="space-y-2">
          {submitError && <p className="text-xs text-negative">{submitError}</p>}
          <div className="flex items-center gap-2">
            {/* §5.3 caps the screen at one jade-filled primary and Accept is
                it; the decline control is the Outline variant. "I'm too poor"
                must never become a second jade button. */}
            <button
              type="button"
              disabled={!declineEnabled}
              onClick={() => void runDecline()}
              className={cn(
                "h-9 flex-1 border border-border bg-transparent px-4 text-xs font-semibold uppercase tracking-wide text-foreground",
                "transition-colors hover:border-jade/50 hover:text-jade",
                "disabled:opacity-40 disabled:pointer-events-none",
              )}
            >
              {pending === "decline"
                ? t("declining")
                : affordable
                  ? t("decline")
                  : t("declineBroke")}
            </button>
            <button
              type="button"
              disabled={!acceptEnabled}
              onClick={() => void runAccept()}
              className="cut-sm h-9 flex-1 px-4 text-xs font-semibold uppercase tracking-wide text-black bg-jade transition-[filter] motion-safe:hover:brightness-110 motion-safe:active:brightness-95 disabled:opacity-40 disabled:pointer-events-none"
            >
              {pending === "accept" ? t("accepting") : t("accept")}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <Versus
          challengerId={duel.challengerId}
          challengeeId={duel.challengeeId}
          size="comfortable"
        />

        {closedReason && (
          <p className="border border-border bg-surface-1 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {closedReason}
          </p>
        )}

        <div className="grid grid-cols-2 gap-3 border-y border-border py-3">
          <div>
            <p className={eyebrowClass}>{t("stake")}</p>
            <CoinAmount amount={duel.stake} className="text-sm text-foreground" />
          </div>
          <div>
            <p className={eyebrowClass}>{t("yourBalance")}</p>
            <CoinAmount amount={balance} className="text-sm text-foreground" />
          </div>
          <div>
            <p className={eyebrowClass}>{t("ifYouWin")}</p>
            <CoinDelta amount={duel.stake} className="text-sm" />
          </div>
          <div>
            <p className={eyebrowClass}>{t("ifYouLose")}</p>
            <CoinDelta amount={-duel.stake} className="text-sm" />
          </div>
        </div>

        {stillOpen && (
          <p className="text-xs text-muted-foreground">
            {t("acceptByPrefix")}{" "}
            <span className="font-mono tabular-nums">
              {now == null ? "—" : formatTimeLeft(locale, bet.closesAt, now).label}
            </span>{" "}
            {t("acceptBySuffix")}
          </p>
        )}

        {!affordable && stillOpen && (
          // Not a validation error — no field produced it, so no ember border
          // and no rust. It is a plain statement of why the primary is dim.
          <p className="text-xs text-muted-foreground">
            {t("needMorePrefix")} <CoinAmount amount={duel.stake} />{" "}
            {t("needMoreMiddle")} <CoinAmount amount={balance} />
            {t("needMoreSuffix")}
          </p>
        )}
      </div>
    </ModalShell>
  );
}
