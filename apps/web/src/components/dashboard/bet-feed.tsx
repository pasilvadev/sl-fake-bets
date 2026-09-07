"use client";

import { useMemo, useState } from "react";
import { cn } from "cn";
import { useTranslations } from "next-intl";
import {
  canAcceptDuel,
  canResolveDuel,
  computeDuelPhase,
  type Bet,
} from "@repo/shared";
import { useTeam } from "@/lib/team-context";
import { useModal } from "@/lib/modal-context";
import { useFeatureFlag } from "@/lib/feature-flags";
import { useNow } from "@/lib/use-now";
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
  const { bets, team, currentUser, canCreateBet, duelFor } = useTeam();
  const { open } = useModal();
  // The ghost-pattern copy lives under `emptyState` rather than `betFeed`
  // (D5's namespace-is-the-filename rule, with the one documented exception in
  // messages/README.md): §5.10's five dry lines read better edited together.
  const tEmpty = useTranslations("emptyState");
  const duelsEnabled = useFeatureFlag("duel-bets");
  const now = useNow();
  const [filter, setFilter] = useState<Filter>("All");

  /**
   * D4's whole notification story: a duel awaiting *your* answer — or, as the
   * mediator, *your* ruling — sorts to the top of the group it is already in
   * and takes the featured treatment. Nothing is pushed at anybody. No bell,
   * no badge, no tab title, no toast on arrival (ARC-014); the pin is
   * pull-based and only exists on the screen of the person who owes something.
   *
   * Both halves of the guard, on every duel: `canAcceptDuel`/`canResolveDuel`
   * are roster+id rules that never look at the clock, `computeDuelPhase` is the
   * clock and never looks at who is asking. A lapsed challenge must not pin.
   */
  const awaitingYou = useMemo(() => {
    const ids = new Set<string>();
    if (!duelsEnabled || now == null) return ids;
    for (const bet of bets) {
      if (bet.kind !== "duel") continue;
      const duel = duelFor(bet.id);
      if (!duel) continue;
      const phase = computeDuelPhase(bet, duel, now);
      if (phase === "pending" && canAcceptDuel(team, currentUser.id, duel)) {
        ids.add(bet.id);
      } else if (
        phase === "accepted" &&
        canResolveDuel(team, currentUser.id, duel)
      ) {
        ids.add(bet.id);
      }
    }
    return ids;
  }, [bets, duelFor, team, currentUser.id, now, duelsEnabled]);

  const { groups, featuredBetId, soonestOpenBetId } = useMemo(() => {
    // ARC-016 kill switch: with `duel-bets` off, duels leave the feed entirely
    // on the next load. Gating the UI and only the UI — the RPCs, the expiry
    // sweep and the departure cascade keep refunding underneath, because a
    // flag that could strand coins would be a leak, not a kill switch.
    const visible = duelsEnabled ? bets : bets.filter((b) => b.kind !== "duel");

    // UX-008's grouping contract, unchanged: OPEN soonest-closing first →
    // CLOSED most-recent first → RESOLVED most-recent first, empty group
    // omitted. The pin re-orders WITHIN a group and never adds a fourth.
    const openBets = [...visible]
      .filter((b) => b.state === "open")
      .sort((a, b) => new Date(a.closesAt).getTime() - new Date(b.closesAt).getTime());
    const closed = [...visible]
      .filter((b) => b.state === "closed")
      .sort((a, b) => new Date(b.closesAt).getTime() - new Date(a.closesAt).getTime());
    const resolved = [...visible]
      .filter((b) => b.state === "resolved")
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    /**
     * The <1h treatment belongs to the closing-soonest OPEN *pool* bet, read
     * off the chronological sort BEFORE any pinning — a pin changes who is at
     * the top of the list, not which bet closes first.
     *
     * Duels are skipped rather than eligible, and that is a correction this
     * phase makes deliberately: on a pending duel `closesAt` is the ACCEPT
     * deadline, so `CLOSING SOON` would announce the end of a betting window
     * that does not exist. Its countdown already says `Accept by …`, which is
     * the honest version of the same urgency.
     */
    const soonestOpen = openBets.find((b) => b.kind !== "duel");

    // A stable partition, not a re-sort: within a group the pinned rows keep
    // their relative order and so does everything else.
    const pin = (list: Bet[]): Bet[] =>
      awaitingYou.size === 0
        ? list
        : [
            ...list.filter((b) => awaitingYou.has(b.id)),
            ...list.filter((b) => !awaitingYou.has(b.id)),
          ];

    const all: Group[] = [
      { key: "open", eyebrow: "OPEN", bets: pin(openBets) },
      { key: "closed", eyebrow: "CLOSED", bets: pin(closed) },
      { key: "resolved", eyebrow: "RESOLVED", bets: resolved },
    ];

    const shown =
      filter === "All"
        ? all.filter((g) => g.bets.length > 0)
        : all.filter((g) => g.key === filter.toLowerCase() && g.bets.length > 0);

    /**
     * §4.3's scarcity cap — "max one diagonal brand element visible per
     * viewport" — allocated here, once, for the whole feed. `design-dashboard`
     * §3 spent it on the closing-soonest open row; task 6 reassigns it to a
     * challenge that is waiting on the viewer, because a diagonal cut is the
     * strongest "look here" the system has and a decision only you can make
     * outranks a clock everyone can see.
     *
     * Scanned in render order across the groups a filter is actually showing,
     * so the cut always lands on the topmost pinned row that is on screen.
     * Falling back to `soonestOpen` keeps a feed with no challenges rendering
     * exactly as it did before this phase.
     */
    let featured: string | undefined;
    if (awaitingYou.size > 0) {
      for (const group of shown) {
        const hit = group.bets.find((b) => awaitingYou.has(b.id));
        if (hit) {
          featured = hit.id;
          break;
        }
      }
    }
    if (!featured && shown.some((g) => g.key === "open")) {
      featured = soonestOpen?.id;
    }

    return {
      groups: shown,
      featuredBetId: featured,
      soonestOpenBetId: soonestOpen?.id,
    };
  }, [bets, filter, awaitingYou, duelsEnabled]);

  const hasBets = duelsEnabled
    ? bets.length > 0
    : bets.some((b) => b.kind !== "duel");

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

      {!hasBets ? (
        <EmptyState
          line={tEmpty("noBets")}
          ctaLabel={canCreateBet ? tEmpty("noBetsCta") : undefined}
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
              {group.bets.map((bet) => (
                <BetRow
                  key={bet.id}
                  bet={bet}
                  featured={bet.id === featuredBetId}
                  soonest={bet.id === soonestOpenBetId}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
