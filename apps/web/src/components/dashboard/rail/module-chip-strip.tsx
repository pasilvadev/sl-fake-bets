"use client";

import { useState } from "react";
import { CONFIG } from "@repo/shared";
import { CoinAmount } from "@/components/sl/coin-amount";
import { ModalShell } from "@/components/sl/modal-shell";
import { useTeam } from "@/lib/team-context";
import { WalletModule } from "./wallet-module";
import { StandingsModule } from "./standings-module";
import { TeamModule } from "./team-module";
import { ChatStubModule } from "./chat-stub-module";

type SheetId = "wallet" | "standings" | "team" | "chat";

const SHEET_EYEBROWS: Record<SheetId, string> = {
  wallet: "WALLET",
  standings: "STANDINGS",
  team: "TEAM",
  chat: "TEAM CHAT",
};

/**
 * Mobile/tablet (<1024px) replacement for the rail (design-dashboard.md §6):
 * a horizontal chip strip under the ticker. Each chip opens its module as a
 * bottom sheet via ModalShell, reusing the exact same module component.
 */
export function ModuleChipStrip() {
  const { team, balance, richest, currentUser } = useTeam();
  const [active, setActive] = useState<SheetId | null>(null);

  const richestRankIndex = richest.findIndex((m) => m.userId === currentUser.id);
  const richestRank = richestRankIndex === -1 ? null : richestRankIndex + 1;

  return (
    <>
      <div className="flex h-14 items-center gap-2 overflow-x-auto border-b border-border px-3 lg:hidden">
        <button
          type="button"
          onClick={() => setActive("wallet")}
          className="flex h-9 shrink-0 items-center gap-2 rounded-sm border border-border bg-surface-1 px-3 text-xs text-foreground"
        >
          Wallet
          <CoinAmount amount={balance} />
        </button>

        <button
          type="button"
          onClick={() => setActive("standings")}
          className="flex h-9 shrink-0 items-center gap-2 rounded-sm border border-border bg-surface-1 px-3 text-xs text-foreground"
        >
          Standings
          <span className="font-mono tabular-nums text-muted-foreground">
            #{richestRank ?? "–"}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActive("team")}
          className="flex h-9 shrink-0 items-center gap-2 rounded-sm border border-border bg-surface-1 px-3 text-xs text-foreground"
        >
          Team
          <span className="font-mono tabular-nums text-muted-foreground">
            {team.members.length}/{CONFIG.TEAM_TARGET_SIZE}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActive("chat")}
          className="flex h-9 shrink-0 items-center gap-2 rounded-sm border border-border bg-surface-1 px-3 text-xs text-foreground"
        >
          Chat
          <span className="rounded-sm border border-border px-1.5 text-[10px] uppercase text-muted-foreground">
            SOON
          </span>
        </button>
      </div>

      {active && (
        <ModalShell
          eyebrow={SHEET_EYEBROWS[active]}
          title={team.name}
          onClose={() => setActive(null)}
        >
          {active === "wallet" && <WalletModule />}
          {active === "standings" && <StandingsModule />}
          {active === "team" && <TeamModule />}
          {active === "chat" && <ChatStubModule />}
        </ModalShell>
      )}
    </>
  );
}
