"use client";

import { useState } from "react";
import { cn } from "cn";
import { type TeamMember } from "@repo/shared";
import { CoinAmount, CoinDelta } from "@/components/sl/coin-amount";
import { UserAvatar } from "@/components/sl/user-avatar";
import { UserName } from "@/components/sl/user-name";
import { useModal } from "@/lib/modal-context";
import { useTeam } from "@/lib/team-context";

type Tab = "richest" | "poorest";

/** Segmented tab, §5.8 slash-notch active tick (local — no shared filter component exists yet). */
function TabButton({
  label,
  active,
  tone = "jade",
  onClick,
}: {
  label: string;
  active: boolean;
  tone?: "jade" | "rust";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative px-2 py-1 text-xs font-medium transition-colors",
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
      {active && (
        <span
          className={cn(
            "absolute inset-x-1 -bottom-px h-0.5 -skew-x-12",
            tone === "rust" ? "bg-rust" : "bg-jade",
          )}
        />
      )}
    </button>
  );
}

/**
 * Richest: rank-1 jade + text-lg, 2-3 full white text-base, 4+ muted text-sm
 * (§5.6). Poorest is the mirror of that scale in rust — rank-1 (the deepest
 * loss) is the loud one, and it fades to muted the same way.
 */
function rankClass(rank: number, tab: Tab): string {
  if (tab === "poorest") {
    if (rank === 0) return "text-rust text-lg";
    if (rank <= 2) return "text-rust/80 text-base";
    return "text-muted-foreground text-sm";
  }
  if (rank === 0) return "text-jade text-lg";
  if (rank <= 2) return "text-foreground text-base";
  return "text-muted-foreground text-sm";
}

function StandingRow({
  member,
  rank,
  tab,
}: {
  member: TeamMember;
  rank: number;
  tab: Tab;
}) {
  const { userById } = useTeam();
  const user = userById(member.userId);
  if (!user) return null;

  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <span className={cn("w-4 shrink-0 font-mono tabular-nums", rankClass(rank, tab))}>
        {rank + 1}
      </span>
      <UserAvatar user={user} size={20} />
      <div className="min-w-0 flex-1">
        <UserName user={user} badge className="truncate text-sm" />
        {tab === "poorest" && rank === 0 && (
          <p className="text-[11px] text-rust">House&apos;s favorite donor</p>
        )}
      </div>
      {tab === "richest" ? (
        <CoinAmount amount={member.coinBalance} className="text-sm" />
      ) : (
        <CoinDelta amount={member.profitLoss} className="text-sm" />
      )}
    </div>
  );
}

/**
 * Pulse Rail module 2/4 (design-dashboard.md §4.2, DOM-027/028/029):
 * Richest/Poorest tabbed top-5, no cut-sm on rank-1 (dashboard scarcity
 * ruling, §3) — that treatment lives only in the full-leaderboard modal.
 */
export function StandingsModule() {
  const { richest, poorest } = useTeam();
  const { open } = useModal();
  const [tab, setTab] = useState<Tab>("richest");

  const list = (tab === "richest" ? richest : poorest).slice(0, 5);
  // DOM-028's board is about LOSSES, so "solvent" is nobody in the red — the
  // same test the full modal uses. (It read `=== 0` while the modal read
  // `>= 0`, which only diverged once real resolutions started producing
  // winners: one member up, everyone else flat, and the two surfaces
  // disagreed about whether there was a podium at all.)
  const allSolvent = tab === "poorest" && poorest.every((m) => m.profitLoss >= 0);

  return (
    <section className="rounded-sm border border-border bg-surface-1 p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          STANDINGS
        </p>
        <div className="flex">
          <TabButton
            label="Richest"
            active={tab === "richest"}
            onClick={() => setTab("richest")}
          />
          <TabButton
            label="Poorest"
            active={tab === "poorest"}
            tone="rust"
            onClick={() => setTab("poorest")}
          />
        </div>
      </div>

      {allSolvent ? (
        <p className="py-2 text-sm text-muted-foreground">
          Everyone&apos;s still solvent. Suspicious.
        </p>
      ) : (
        <div className="divide-y divide-border">
          {list.map((member, i) => (
            <StandingRow key={member.userId} member={member} rank={i} tab={tab} />
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => open("standings-full")}
        className="mt-3 block text-xs text-jade hover:underline"
      >
        View full leaderboard
      </button>
    </section>
  );
}
