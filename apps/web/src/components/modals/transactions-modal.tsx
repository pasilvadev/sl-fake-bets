"use client";

import { type Team, type TeamMember } from "@repo/shared";
import { useModal } from "@/lib/modal-context";
import { useTeam } from "@/lib/team-context";
import { ModalShell } from "@/components/sl/modal-shell";
import { CoinDelta } from "@/components/sl/coin-amount";
import { formatShortDate } from "@/lib/format";

/** DOM-025/026: dense transaction history + per-team lifetime P/L breakdown. */
export function TransactionsModal() {
  const { close } = useModal();
  const { currentUser, transactions, teams } = useTeam();

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
      eyebrow="WALLET"
      title="Transaction history"
      onClose={close}
      footer={
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Lifetime P/L by team
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
          No transactions yet.
        </p>
      ) : (
        <ul>
          {myTransactions.map((tx) => (
            <li
              key={tx.id}
              className="flex items-center gap-3 border-b border-border py-2.5"
            >
              <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">
                {formatShortDate(tx.createdAt)}
              </span>
              <span className="flex-1 truncate text-sm text-foreground">
                {tx.description}
              </span>
              <CoinDelta amount={tx.amount} className="text-sm" />
              <span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                {tx.balanceAfter.toLocaleString("en-US")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </ModalShell>
  );
}
