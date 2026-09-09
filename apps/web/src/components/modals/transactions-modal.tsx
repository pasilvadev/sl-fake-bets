"use client";

import { useLocale, useTranslations } from "next-intl";
import { type Team, type TeamMember, type Transaction } from "@repo/shared";
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

/** DOM-025/026: dense transaction history + per-team lifetime P/L breakdown. */
export function TransactionsModal() {
  const { close } = useModal();
  const { currentUser, transactions, teams } = useTeam();
  const locale = useLocale();
  const t = useTranslations("transactionsModal");

  const myTransactions = transactions
    .filter((t) => t.userId === currentUser.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

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
      {myTransactions.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <ul>
          {myTransactions.map((tx) => (
            <li
              key={tx.id}
              className="flex items-center gap-3 border-b border-border py-2.5"
            >
              <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">
                {formatShortDate(locale, tx.createdAt)}
              </span>
              <span className="flex-1 truncate text-sm text-foreground">
                {describe(tx, t)}
              </span>
              <CoinDelta amount={tx.amount} className="text-sm" />
              <span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                {formatCoins(locale, tx.balanceAfter)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </ModalShell>
  );
}
