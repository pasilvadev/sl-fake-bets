"use client";

import { useMemo, useState } from "react";
import { cn } from "cn";
import { canAcceptWagers, getPoolStats } from "@repo/shared";
import { useModal } from "@/lib/modal-context";
import { useTeam } from "@/lib/team-context";
import { useNow } from "@/lib/use-now";
import { useTranslations } from "next-intl";
import { useErrorText } from "@/lib/use-error-text";
import { ModalShell } from "@/components/sl/modal-shell";
import { CoinAmount, CoinDelta } from "@/components/sl/coin-amount";

const QUICK_CHIPS = [10, 25, 50] as const;

/**
 * UX-016: place-wager modal. Submits through team-context's placeWager, which
 * runs the shared validation + state-machine guards and then hands the stake
 * to the `place_wager` RPC that actually enforces them; the amount input
 * clamps to min(balance, remaining per-user max) — DOM-014/017 — and an
 * effectively-closed bet (DOM-012) blocks submission with a visible reason.
 */
export function WagerModal({ betId }: { betId: string }) {
  const { close } = useModal();
  const { bets, wagers, balance, currentUser, placeWager } = useTeam();
  const bet = bets.find((b) => b.id === betId);
  const now = useNow();

  const { errorText } = useErrorText();
  const t = useTranslations("wagerModal");
  const [optionId, setOptionId] = useState<string | null>(null);
  const [amount, setAmount] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const pool = useMemo(() => (bet ? getPoolStats(bet, wagers) : []), [bet, wagers]);

  if (!bet) {
    return (
      <ModalShell eyebrow={t("eyebrow")} title={t("notFound")} onClose={close}>
        <p className="text-sm text-muted-foreground">
          {t("gone")}
        </p>
      </ModalShell>
    );
  }

  // Stored state until the clock mounts (useNow is null on the first render);
  // the placeWager mutator re-guards with a fresh clock on submit.
  const acceptingWagers =
    now == null ? bet.state === "open" : canAcceptWagers(bet, now);

  const existingStake = wagers
    .filter((w) => w.betId === bet.id && w.userId === currentUser.id)
    .reduce((sum, w) => sum + w.amount, 0);
  const remainingMax = bet.maxWagerPerUser - existingStake;
  const cap = Math.max(0, Math.min(balance, remainingMax));
  const atCap = amount > 0 && amount >= cap;
  const selected = pool.find((o) => o.optionId === optionId) ?? null;
  const multiplier = selected?.multiplier ?? null;
  const potential =
    optionId && amount > 0
      ? Math.floor(amount * (multiplier ?? 1)) - amount
      : 0;

  const canSubmit = optionId != null && amount > 0 && acceptingWagers && !pending;

  function setClampedAmount(next: number) {
    setAmount(Math.max(0, Math.min(cap, Math.round(next))));
  }

  // Async since roadmap Phase 6: the wager row and the debit on the member's
  // stored balance are one Postgres transaction (the `place_wager` RPC), which
  // is where DOM-014's over-balance and DOM-017's per-user max are decided.
  async function submit() {
    if (!canSubmit) return;
    setSubmitError(null);
    setPending(true);
    const result = await placeWager(bet!.id, optionId!, amount);
    setPending(false);
    if (result.ok) {
      close();
    } else {
      setSubmitError(errorText(result));
    }
  }

  return (
    <ModalShell
      eyebrow={t("eyebrow")}
      title={`${bet.iconEmoji ? `${bet.iconEmoji} ` : ""}${bet.title}`}
      onClose={close}
      footer={
        <div className="space-y-2">
          {submitError && <p className="text-xs text-negative">{submitError}</p>}
          <div className="flex items-center justify-between gap-4">
            <div className="text-xs text-muted-foreground">
              <span className="block">{t("ifItHits")}</span>
              <CoinDelta amount={potential} className="text-sm" />
            </div>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => void submit()}
              className={cn(
                "cut-sm h-9 shrink-0 px-5 text-xs font-semibold uppercase tracking-wide text-black",
                "bg-jade transition-[filter] motion-safe:hover:brightness-110 motion-safe:active:brightness-95",
                "disabled:opacity-40 disabled:pointer-events-none",
              )}
            >
              {pending ? t("submitting") : t("submit")}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {!acceptingWagers && (
          <p className="border border-border bg-surface-1 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("bettingClosed")}
          </p>
        )}

        <ul className="space-y-2">
          {pool.map((option) => {
            const isSelected = option.optionId === optionId;
            return (
              <li key={option.optionId}>
                <button
                  type="button"
                  onClick={() => setOptionId(option.optionId)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-sm border p-3 text-left transition-colors",
                    isSelected
                      ? "border-jade bg-jade-wash"
                      : "border-border hover:border-border-strong",
                  )}
                >
                  <span className="text-sm font-medium text-foreground">
                    {option.label}
                  </span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {Math.round(option.share * 100)}%
                    {" · "}
                    {option.multiplier ? `${option.multiplier.toFixed(2)}x` : "—"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="space-y-2">
          <input
            type="number"
            min={0}
            max={cap}
            value={amount === 0 ? "" : amount}
            onChange={(e) => setClampedAmount(Number(e.target.value) || 0)}
            placeholder="0"
            className="w-full border border-border bg-surface-1 px-3 py-2 font-mono text-sm tabular-nums text-foreground placeholder:text-muted-foreground/60 focus:border-jade focus:outline-none focus:ring-1 focus:ring-jade/40"
          />
          <div className="flex gap-2">
            {QUICK_CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => setClampedAmount(chip)}
                className="border border-border px-2.5 py-1 font-mono text-xs tabular-nums text-muted-foreground transition-colors hover:border-jade/50 hover:text-jade"
              >
                {chip}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setClampedAmount(cap)}
              className="border border-border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:border-jade/50 hover:text-jade"
            >
              {t("max")}
            </button>
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              {t("balance")} <CoinAmount amount={balance} />
            </span>
            <span className="flex items-center gap-1">
              {t("maxPerUser")} <CoinAmount amount={bet.maxWagerPerUser} />
            </span>
          </div>
          {existingStake > 0 && (
            <p className="text-xs text-muted-foreground">
              {t("existing", { stake: existingStake })}
              {remainingMax > 0
                ? t("existingRoom", { remaining: Math.max(0, remainingMax) })
                : t("existingNoRoom")}
            </p>
          )}
          {cap === 0 && acceptingWagers && (
            <p className="text-xs text-negative">
              {balance < 0
                ? t("overdrawn")
                : balance === 0
                  ? t("noCoins")
                  : t("maxReached")}
            </p>
          )}
          {atCap && cap > 0 && (
            <p className="text-xs text-muted-foreground">
              {balance <= remainingMax ? t("cappedBalance") : t("cappedMax")}
            </p>
          )}
        </div>
      </div>
    </ModalShell>
  );
}
