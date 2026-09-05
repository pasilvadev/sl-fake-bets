"use client";

import { useState } from "react";
import { cn } from "cn";
import { useModal } from "@/lib/modal-context";
import { useTeam } from "@/lib/team-context";
import { ModalShell } from "@/components/sl/modal-shell";
import { UserAvatar } from "@/components/sl/user-avatar";
import { UserName } from "@/components/sl/user-name";
import { CoinAmount, CoinDelta } from "@/components/sl/coin-amount";

type Tab = "richest" | "poorest";

function rankSize(rank: number): string {
  if (rank === 1) return "text-2xl";
  if (rank <= 4) return "text-lg";
  return "text-sm";
}

/** DOM-027/028/029: full leaderboard modal, Richest/Poorest tabs. */
export function StandingsFullModal() {
  const { close } = useModal();
  const { richest, poorest, userById } = useTeam();
  const [tab, setTab] = useState<Tab>("richest");

  const rows = tab === "richest" ? richest : poorest;
  const allSolvent = tab === "poorest" && poorest.every((m) => m.profitLoss >= 0);

  return (
    <ModalShell eyebrow="LEADERBOARD" title="Standings" onClose={close}>
      <div className="space-y-4">
        <div className="flex gap-2">
          {(["richest", "poorest"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "flex-1 border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors",
                tab === t
                  ? "border-jade bg-jade-wash text-jade"
                  : "border-border text-muted-foreground hover:border-border-strong",
              )}
            >
              {t === "richest" ? "Richest" : "Poorest"}
            </button>
          ))}
        </div>

        {allSolvent ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Everyone&apos;s still solvent. Suspicious.
          </p>
        ) : (
          <ul>
            {rows.map((member, index) => {
              const rank = index + 1;
              const user = userById(member.userId);
              if (!user) return null;
              const isRichestTop = tab === "richest" && rank === 1;
              const isPoorestTop = tab === "poorest" && rank === 1;

              return (
                <li
                  key={member.userId}
                  className={cn(
                    "relative flex items-center gap-3 border-b border-border py-2.5",
                    isRichestTop && "cut-sm bg-jade-wash",
                    isPoorestTop && "cut-mirror",
                  )}
                >
                  {isRichestTop && (
                    <div className="absolute inset-x-0 top-0 h-px bg-jade" />
                  )}
                  <span
                    className={cn(
                      "w-8 shrink-0 text-center font-mono font-semibold tabular-nums",
                      rankSize(rank),
                      // §5.6: the poor podium is mirrored SHAPE, never a
                      // different hue — its digits stay muted at every rank
                      // and only size carries the ranking. Jade and full-white
                      // digits belong to the richest board alone.
                      tab === "poorest"
                        ? "text-muted-foreground"
                        : isRichestTop
                          ? "text-jade"
                          : rank <= 3
                            ? "text-text-strong"
                            : "text-muted-foreground",
                    )}
                  >
                    {rank}
                  </span>
                  <UserAvatar user={user} size={28} />
                  <div className="min-w-0 flex-1">
                    <UserName user={user} badge />
                    {isPoorestTop && (
                      <p className="text-xs text-muted-foreground">
                        House&apos;s favorite donor
                      </p>
                    )}
                  </div>
                  {tab === "richest" ? (
                    <CoinAmount amount={member.coinBalance} className="text-sm" />
                  ) : (
                    <CoinDelta amount={member.profitLoss} className="text-sm" />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </ModalShell>
  );
}
