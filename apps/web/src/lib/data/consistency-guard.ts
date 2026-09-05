import {
  deriveProfitLoss,
  settleBet,
  type Bet,
  type Team,
  type Transaction,
  type Wager,
} from "@repo/shared";
import type { TeamData } from "./team-data";

/**
 * The consistency guard (roadmap Phase 7, task 3).
 *
 * Decision §4.6 keeps balances STORED on the membership rather than derived by
 * replaying history, and that is the right call for a product where the ledger
 * is deliberately partial — wager stakes and payouts are not transactions
 * (DOM-025/026). The cost of it is that nothing structurally forces the stored
 * number to agree with the events that produced it: a missed debit, a payout
 * applied twice, a reversal that skipped someone, and the balance is simply
 * wrong with nothing to notice.
 *
 * So the reconstruction that was rejected as an implementation is used here as
 * an ASSERTION. In development the app recomputes what every visible balance
 * ought to be after each load and complains in the console when it does not
 * match. It is not a repair — it does not write, and a mismatch is a bug in a
 * write path, not something to paper over.
 *
 * What the arithmetic says, per (team, member):
 *
 *   coin_balance = Σ ledger amounts        (grants, daily rewards, injections)
 *                + Σ settlement credits    (payouts and void refunds)
 *                − Σ stakes                (they leave at placement, §4.6)
 *
 *   profit_loss  = deriveProfitLoss(...)   (resolved bets only — DOM-026)
 *
 * Two things it deliberately does NOT flag:
 *
 *  * Rows from a previous membership. A kick deletes the membership and its
 *    balance, but the member's `transactions` rows and their wagers on already
 *    RESOLVED bets both survive (decision §4.4). Someone who was kicked and
 *    re-joined therefore starts a fresh balance next to old history, and
 *    counting it would be the guard's error, not the data's. Everything before
 *    `joinedAt` is excluded for that reason.
 *  * Members whose ledger the viewer cannot read. `transactions` is visible to
 *    its owner and to the team's moderators/leader (Phase 3's policy), so for
 *    anyone else the ledger term is not missing — it is invisible, and an
 *    absent row is indistinguishable from a real drift. Those members are
 *    skipped rather than guessed at.
 */

export interface ConsistencyIssue {
  teamId: string;
  teamName: string;
  userId: string;
  field: "coinBalance" | "profitLoss";
  stored: number;
  expected: number;
}

/** Wagers placed under the member's CURRENT membership (see the note above). */
function wagersSinceJoin(
  wagers: readonly Wager[],
  userId: string,
  joinedAt: string,
): Wager[] {
  return wagers.filter((w) => w.userId !== userId || w.placedAt >= joinedAt);
}

function checkMember(
  team: Team,
  userId: string,
  joinedAt: string,
  teamBets: Bet[],
  teamWagers: Wager[],
  teamTransactions: Transaction[],
): ConsistencyIssue[] {
  const member = team.members.find((m) => m.userId === userId);
  if (!member) return [];

  const scopedWagers = wagersSinceJoin(teamWagers, userId, joinedAt);

  const ledger = teamTransactions
    .filter((t) => t.userId === userId && t.createdAt >= joinedAt)
    .reduce((sum, t) => sum + t.amount, 0);

  const credits = teamBets.reduce((sum, bet) => {
    if (bet.state !== "resolved" || !bet.resolution) return sum;
    const delta = settleBet(bet, scopedWagers, bet.resolution).find(
      (d) => d.userId === userId,
    );
    return sum + (delta?.balanceDelta ?? 0);
  }, 0);

  const stakes = scopedWagers
    .filter((w) => w.userId === userId)
    .reduce((sum, w) => sum + w.amount, 0);

  const issues: ConsistencyIssue[] = [];
  const expectedBalance = ledger + credits - stakes;
  if (member.coinBalance !== expectedBalance) {
    issues.push({
      teamId: team.id,
      teamName: team.name,
      userId,
      field: "coinBalance",
      stored: member.coinBalance,
      expected: expectedBalance,
    });
  }

  const expectedProfitLoss = deriveProfitLoss(userId, teamBets, scopedWagers);
  if (member.profitLoss !== expectedProfitLoss) {
    issues.push({
      teamId: team.id,
      teamName: team.name,
      userId,
      field: "profitLoss",
      stored: member.profitLoss,
      expected: expectedProfitLoss,
    });
  }

  return issues;
}

/**
 * Every drift the current viewer is actually able to see. `viewerId` is the
 * signed-in user: their own membership is always checkable, and a moderator or
 * leader can additionally check everyone on that team, because that is exactly
 * the shape of the `transactions` SELECT policy.
 */
export function findConsistencyIssues(
  data: TeamData,
  viewerId: string,
): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];

  for (const team of data.teams) {
    const viewer = team.members.find((m) => m.userId === viewerId);
    if (!viewer) continue;

    const teamBets = data.bets.filter((b) => b.teamId === team.id);
    const betIds = new Set(teamBets.map((b) => b.id));
    const teamWagers = data.wagers.filter((w) => betIds.has(w.betId));
    const teamTransactions = data.transactions.filter((t) => t.teamId === team.id);

    const seesWholeLedger =
      team.leaderId === viewerId || viewer.role === "moderator";
    const checkable = seesWholeLedger ? team.members : [viewer];

    for (const member of checkable) {
      issues.push(
        ...checkMember(
          team,
          member.userId,
          member.joinedAt,
          teamBets,
          teamWagers,
          teamTransactions,
        ),
      );
    }
  }

  return issues;
}

/**
 * Dev-only reporting side of the guard. Silent when everything agrees, which
 * is the point — the console stays usable, so the one time it does print is
 * worth reading.
 */
export function reportConsistency(data: TeamData, viewerId: string): void {
  if (process.env.NODE_ENV === "production") return;

  const issues = findConsistencyIssues(data, viewerId);
  if (issues.length === 0) return;

  console.warn(
    `[consistency] ${issues.length} stored value(s) disagree with the events behind them.\n` +
      `A write path is wrong — do not "fix" the numbers, find the path.`,
    issues,
  );
}
