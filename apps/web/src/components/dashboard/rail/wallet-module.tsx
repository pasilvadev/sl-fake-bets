"use client";

import { cn } from "cn";
import { CONFIG } from "@repo/shared";
import { CoinAmount, CoinDelta } from "@/components/sl/coin-amount";
import { useModal } from "@/lib/modal-context";
import { useTeam } from "@/lib/team-context";
import { useNow } from "@/lib/use-now";

/**
 * Pulse Rail module 1/4 (design-dashboard.md §4.1): big balance numeral,
 * daily auto-grant readout (DOM-022), P/L line (DOM-026), transaction
 * history link, and a disabled Donate stub (DOM-023, future-stub).
 */
/**
 * DOM-022 / decision §4.3: the reward is scoped to the UTC calendar day,
 * because that is the day the unique index on `transactions` counts. Deriving
 * the readout from the ledger rather than from a local flag means it stays
 * right for the second device, the second tab, and the reload.
 */
function utcDay(iso: string | number): string {
  return new Date(iso).toISOString().slice(0, 10);
}

export function WalletModule() {
  const { balance, member, currentUser, transactions } = useTeam();
  const { open } = useModal();
  const now = useNow();

  // The claim happens on team load (team-context), so by the time this renders
  // the row is normally already there; `now == null` is just the pre-hydration
  // frame, where a claim of either kind would be a guess.
  const claimedToday =
    now != null &&
    transactions.some(
      (t) =>
        t.kind === "daily-reward" &&
        t.userId === currentUser.id &&
        utcDay(t.createdAt) === utcDay(now),
    );

  return (
    <section className="rounded-sm border border-border bg-surface-1 p-4">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        WALLET
      </p>

      {/* A negative balance is reachable by exactly one route — a resolved bet
          being deleted out from under its payout (owner ruling 2026-09-05) —
          and it has to read as a debt, not as an ordinary number. */}
      <CoinAmount
        amount={balance}
        className={cn(
          "text-3xl font-mono font-semibold",
          balance < 0 ? "text-negative" : "text-text-strong",
        )}
      />
      {balance < 0 && (
        <p className="mt-1 text-xs text-negative">
          Overdrawn — a deleted bet took back a payout. No wagers until a
          leader injection clears it.
        </p>
      )}

      <p className="mt-2 text-xs text-muted-foreground">
        Daily login:{" "}
        <span className="font-mono text-jade">
          +{CONFIG.DAILY_REWARD_COINS}
        </span>{" "}
        {claimedToday ? "today ✓" : "on your next visit"}
      </p>

      <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
        Your P/L
        <CoinDelta amount={member?.profitLoss ?? 0} />
      </p>

      <button
        type="button"
        onClick={() => open("transactions")}
        className="mt-3 block text-xs text-jade hover:underline"
      >
        View transaction history
      </button>

      <div className="mt-3" title="Coming soon">
        <button
          type="button"
          disabled
          className="h-8 w-full rounded-sm border border-border bg-transparent px-3 text-xs text-foreground opacity-40 pointer-events-none"
        >
          Donate coins
        </button>
      </div>
    </section>
  );
}
