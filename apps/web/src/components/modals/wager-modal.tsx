"use client";

import { useMemo, useState } from "react";
import { cn } from "cn";
import { getPoolStats } from "@repo/shared";
import { useModal } from "@/lib/modal-context";
import { useTeam } from "@/lib/team-context";
import { ModalShell } from "@/components/sl/modal-shell";
import { CoinAmount, CoinDelta } from "@/components/sl/coin-amount";

const QUICK_CHIPS = [10, 25, 50] as const;

/** UX-016: place-wager modal — option pick + amount stepper, Phase 1 mutates nothing. */
export function WagerModal({ betId }: { betId: string }) {
  const { close } = useModal();
  const { bets, wagers, balance } = useTeam();
  const bet = bets.find((b) => b.id === betId);

  const [optionId, setOptionId] = useState<string | null>(null);
  const [amount, setAmount] = useState(0);

  const pool = useMemo(() => (bet ? getPoolStats(bet, wagers) : []), [bet, wagers]);

  if (!bet) {
    return (
      <ModalShell eyebrow="PLACE WAGER" title="Bet not found" onClose={close}>
        <p className="text-sm text-muted-foreground">
          This bet no longer exists.
        </p>
      </ModalShell>
    );
  }

  const cap = Math.max(0, Math.min(balance, bet.maxWagerPerUser));
  const atCap = amount > 0 && amount >= cap;
  const selected = pool.find((o) => o.optionId === optionId) ?? null;
  const multiplier = selected?.multiplier ?? null;
  const potential =
    optionId && amount > 0
      ? Math.floor(amount * (multiplier ?? 1)) - amount
      : 0;

  function setClampedAmount(next: number) {
    setAmount(Math.max(0, Math.min(cap, Math.round(next))));
  }

  return (
    <ModalShell
      eyebrow="PLACE WAGER"
      title={`${bet.iconEmoji ? `${bet.iconEmoji} ` : ""}${bet.title}`}
      onClose={close}
      footer={
        <div className="flex items-center justify-between gap-4">
          <div className="text-xs text-muted-foreground">
            <span className="block">If it hits:</span>
            <CoinDelta amount={potential} className="text-sm" />
          </div>
          <button
            type="button"
            disabled={!optionId || amount <= 0}
            onClick={close}
            className={cn(
              "cut-sm h-9 shrink-0 px-5 text-xs font-semibold uppercase tracking-wide text-black",
              "bg-jade transition-[filter] motion-safe:hover:brightness-110 motion-safe:active:brightness-95",
              "disabled:opacity-40 disabled:pointer-events-none",
            )}
          >
            Place wager
          </button>
        </div>
      }
    >
      <div className="space-y-4">
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
              Max
            </button>
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              Balance: <CoinAmount amount={balance} />
            </span>
            <span className="flex items-center gap-1">
              Max/user: <CoinAmount amount={bet.maxWagerPerUser} />
            </span>
          </div>
          {atCap && (
            <p className="text-xs text-muted-foreground">Cap reached.</p>
          )}
        </div>
      </div>
    </ModalShell>
  );
}
