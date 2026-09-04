"use client";

import { CONFIG } from "@repo/shared";
import { CoinAmount, CoinDelta } from "@/components/sl/coin-amount";
import { useModal } from "@/lib/modal-context";
import { useTeam } from "@/lib/team-context";

/**
 * Pulse Rail module 1/4 (design-dashboard.md §4.1): big balance numeral,
 * daily auto-grant readout (DOM-022), P/L line (DOM-026), transaction
 * history link, and a disabled Donate stub (DOM-023, future-stub).
 */
export function WalletModule() {
  const { balance, member } = useTeam();
  const { open } = useModal();

  return (
    <section className="rounded-sm border border-border bg-surface-1 p-4">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        WALLET
      </p>

      <CoinAmount
        amount={balance}
        className="text-3xl font-mono font-semibold text-text-strong"
      />

      <p className="mt-2 text-xs text-muted-foreground">
        Daily login:{" "}
        <span className="font-mono text-jade">
          +{CONFIG.DAILY_REWARD_COINS}
        </span>{" "}
        today ✓
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
