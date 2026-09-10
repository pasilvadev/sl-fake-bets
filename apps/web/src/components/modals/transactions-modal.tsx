"use client";

import { useLocale, useTranslations } from "next-intl";
import {
  deriveBetSettlementHistory,
  type BetSettlementEntry,
  type Team,
  type TeamMember,
  type Transaction,
} from "@repo/shared";
import { useModal } from "@/lib/modal-context";
import { useTeam } from "@/lib/team-context";
import { ModalShell } from "@/components/sl/modal-shell";
import { CoinDelta } from "@/components/sl/coin-amount";
import { formatCoins, formatShortDate } from "@/lib/format";

/**
 * A history row's text, from its `kind` where we can and its stored
 * `description` where we cannot (UX-027, Phase 3).
 *
 * `transactions.description` is written by SQL, in English, by the ledger RPCs
 * — the read-side twin of the problem D9 solved for exception text, except
 * these are shown on every visit rather than on a race. Three of the five
 * kinds (daily, weekly, onboarding) say a fixed sentence and are recovered
 * from `kind` alone; `injection` and the unused `donation` embed a display
 * NAME the row does not carry as a column, so there is nothing to rebuild
 * them from and they fall through to the stored English.
 *
 * Closing that last gap means a `description` code (or an actor column) on
 * `public.transactions`, which is a migration touching every ledger RPC —
 * out of this plan's scope, and recorded in plan-i18n-ptbr.md's Phase 4 rather
 * than left to be rediscovered.
 */
function describe(
  tx: Transaction,
  t: ReturnType<typeof useTranslations<"transactionsModal">>,
): string {
  if (tx.kind === "daily-reward") return t("dailyReward");
  if (tx.kind === "weekly-reward") return t("weeklyReward");
  if (tx.kind === "onboarding-grant") return t("onboardingGrant");
  return tx.description;
}

/**
 * A resolved bet/duel's row text (found-bugs item 1: the ledger above never
 * carries these — DOM-025/026 — so this reads `deriveBetSettlementHistory`'s
 * view instead of `kind`). Needs its own key per bet kind rather than one key
 * with the noun as a `{param}`: "aposta" is feminine, "duelo" is masculine
 * (messages/README.md's D6), so "won"/"lost" inflect differently in pt-BR.
 */
function describeBetEntry(
  entry: BetSettlementEntry,
  t: ReturnType<typeof useTranslations<"transactionsModal">>,
): string {
  const isDuel = entry.betKind === "duel";
  if (entry.resolution.kind === "void") {
    return isDuel
      ? t("duelRefunded", { title: entry.title })
      : t("betRefunded", { title: entry.title });
  }
  if (entry.profitLossDelta > 0) {
    return isDuel
      ? t("duelWin", { title: entry.title })
      : t("betWin", { title: entry.title });
  }
  if (entry.profitLossDelta < 0) {
    return isDuel
      ? t("duelLoss", { title: entry.title })
      : t("betLoss", { title: entry.title });
  }
  // Payout === stake exactly (everyone backed the winning side, DOM-016's
  // pari-mutuel pool has nobody to redistribute from) — same `±0` neutral
  // reading `CoinDelta` already gives this amount, just spelled out.
  return isDuel
    ? t("duelPush", { title: entry.title })
    : t("betPush", { title: entry.title });
}

/**
 * One row, either a real ledger `Transaction` or a derived
 * `BetSettlementEntry` — merged by timestamp so a bet/duel outcome reads
 * inline with grants and rewards instead of in a second list.
 */
type HistoryRow =
  | { source: "ledger"; createdAt: string; tx: Transaction }
  | { source: "bet"; createdAt: string; entry: BetSettlementEntry };

/** DOM-025/026: dense transaction history + per-team lifetime P/L breakdown. */
export function TransactionsModal() {
  const { close } = useModal();
  const { currentUser, transactions, teams, bets, wagers } = useTeam();
  const locale = useLocale();
  const t = useTranslations("transactionsModal");

  const myTransactions = transactions.filter((tx) => tx.userId === currentUser.id);
  // Same replay `deriveProfitLoss` does for the footer's lifetime total, one
  // entry per resolved bet/duel the user actually staked on — see ledger.ts.
  const myBetHistory = deriveBetSettlementHistory(currentUser.id, bets, wagers);

  const rows: HistoryRow[] = [
    ...myTransactions.map((tx) => ({
      source: "ledger" as const,
      createdAt: tx.createdAt,
      tx,
    })),
    ...myBetHistory.map((entry) => ({
      source: "bet" as const,
      createdAt: entry.createdAt,
      entry,
    })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const myTeams: { team: Team; member: TeamMember }[] = teams
    .map((team) => ({
      team,
      member: team.members.find((m) => m.userId === currentUser.id),
    }))
    .filter(
      (row): row is { team: Team; member: TeamMember } => row.member != null,
    );

  return (
    <ModalShell
      eyebrow={t("eyebrow")}
      title={t("title")}
      onClose={close}
      footer={
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("lifetime")}
          </p>
          {myTeams.map(({ team, member }) => (
            <div key={team.id} className="flex items-center justify-between text-sm">
              <span className="text-foreground">{team.name}</span>
              <CoinDelta amount={member.profitLoss} />
            </div>
          ))}
        </div>
      }
    >
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <ul>
          {rows.map((row) =>
            row.source === "ledger" ? (
              <li
                key={row.tx.id}
                className="flex items-center gap-3 border-b border-border py-2.5"
              >
                <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">
                  {formatShortDate(locale, row.tx.createdAt)}
                </span>
                <span className="flex-1 truncate text-sm text-foreground">
                  {describe(row.tx, t)}
                </span>
                <CoinDelta amount={row.tx.amount} className="text-sm" />
                <span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                  {formatCoins(locale, row.tx.balanceAfter)}
                </span>
              </li>
            ) : (
              <li
                key={row.entry.id}
                className="flex items-center gap-3 border-b border-border py-2.5"
              >
                <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">
                  {formatShortDate(locale, row.entry.createdAt)}
                </span>
                <span className="flex-1 truncate text-sm text-foreground">
                  {describeBetEntry(row.entry, t)}
                </span>
                <CoinDelta amount={row.entry.profitLossDelta} className="text-sm" />
                {/* No ledger snapshot exists for a wager payout (DOM-025) —
                    there is no balance-after to show here, only a blank
                    column so the amounts still line up. */}
                <span className="w-16 shrink-0" />
              </li>
            ),
          )}
        </ul>
      )}
    </ModalShell>
  );
}
