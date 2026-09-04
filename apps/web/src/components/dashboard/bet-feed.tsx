"use client";

import { useMemo, useState } from "react";
import { cn } from "cn";
import type { Bet } from "@repo/shared";
import { useTeam } from "@/lib/team-context";
import { useModal } from "@/lib/modal-context";
import { BetRow } from "./bet-row";
import { EmptyState } from "./empty-state";

type Filter = "All" | "Open" | "Closed" | "Resolved";

const FILTERS: Filter[] = ["All", "Open", "Closed", "Resolved"];

const EYEBROW_BY_FILTER: Record<Filter, string> = {
  All: "ALL BETS",
  Open: "OPEN BETS",
  Closed: "CLOSED BETS",
  Resolved: "RESOLVED BETS",
};

interface Group {
  key: "open" | "closed" | "resolved";
  eyebrow: string;
  bets: Bet[];
}

export function BetFeed() {
  const { bets, canCreateBet } = useTeam();
  const { open } = useModal();
  const [filter, setFilter] = useState<Filter>("All");

  const groups = useMemo<Group[]>(() => {
    const open = [...bets]
      .filter((b) => b.state === "open")
      .sort((a, b) => new Date(a.closesAt).getTime() - new Date(b.closesAt).getTime());
    const closed = [...bets]
      .filter((b) => b.state === "closed")
      .sort((a, b) => new Date(b.closesAt).getTime() - new Date(a.closesAt).getTime());
    const resolved = [...bets]
      .filter((b) => b.state === "resolved")
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const all: Group[] = [
      { key: "open", eyebrow: "OPEN", bets: open },
      { key: "closed", eyebrow: "CLOSED", bets: closed },
      { key: "resolved", eyebrow: "RESOLVED", bets: resolved },
    ];

    if (filter === "All") return all.filter((g) => g.bets.length > 0);
    const wanted = filter.toLowerCase();
    return all.filter((g) => g.key === wanted && g.bets.length > 0);
  }, [bets, filter]);

  return (
    <div>
      <div className="flex items-center justify-between px-3 py-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {EYEBROW_BY_FILTER[filter]}
        </p>

        <div className="inline-flex overflow-hidden rounded-sm border border-border">
          {FILTERS.map((f) => {
            const active = f === filter;
            return (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={cn(
                  "h-7 px-3 text-xs transition-colors",
                  active
                    ? "bg-surface-3 text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {active && <span className="mr-1 text-jade">/</span>}
                {f}
              </button>
            );
          })}
        </div>
      </div>

      {bets.length === 0 ? (
        <EmptyState
          line="No bets yet. Someone has to make the first bad decision."
          ctaLabel={canCreateBet ? "Create Bet" : undefined}
          onCta={canCreateBet ? () => open("create-bet") : undefined}
        />
      ) : (
        <div className="border-t border-border">
          {groups.map((group) => (
            <div key={group.key}>
              <div className="flex items-center gap-3 px-3 py-2">
                <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.eyebrow}
                </span>
                <div className="h-px flex-1 border-t border-border" />
              </div>
              {group.bets.map((bet, i) => (
                <BetRow key={bet.id} bet={bet} featured={group.key === "open" && i === 0} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
