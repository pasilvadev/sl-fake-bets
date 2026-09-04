"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useState,
  type ReactNode,
} from "react";
import {
  applyTransaction,
  canAcceptWagers,
  canCloseBetEarly as permitCloseBetEarly,
  canCreateBet as permitCreateBet,
  canResolveBet as permitResolveBet,
  canTransitionBetState,
  computeEffectiveState,
  generateId,
  getUser,
  mockBets,
  mockCurrentUserId,
  mockTeams,
  mockTransactions,
  mockWagers,
  settleBet,
  validateBetDraft,
  validateWager,
  type Bet,
  type BetResolution,
  type SettlementDelta,
  type Team,
  type TeamMember,
  type Transaction,
  type User,
  type Wager,
} from "@repo/shared";

/** Inline rank-badge kinds (design-visual-identity.md §5.6). */
export type RankBadgeKind = "1" | "2" | "3" | "top5" | "bottom5";

/** Uniform mutator outcome — modals surface `error` as the visible reason. */
export type MutationResult = { ok: true } | { ok: false; error: string };

/** Payload for addBet — raw form values; validation.ts is the gatekeeper. */
export interface NewBetDraft {
  title: string;
  iconEmoji?: string;
  options: string[];
  closesAt: string;
  maxWagerPerUser: number;
}

export interface TeamState {
  team: Team;
  teams: Team[];
  setTeamId: (id: string) => void;
  currentUser: User;
  member: TeamMember | null;
  isLeader: boolean;
  isModerator: boolean;
  /** Access-mode gated (DOM-002/006): free-for-all => any member; restricted => leader/moderator only. */
  canCreateBet: boolean;
  canInvite: boolean;
  canManage: boolean;
  /** Current member's coinBalance (0 if not a member). */
  balance: number;
  bets: Bet[];
  wagers: Wager[];
  transactions: Transaction[];
  /** Members sorted coinBalance desc. */
  richest: TeamMember[];
  /** Members sorted profitLoss asc. */
  poorest: TeamMember[];
  /**
   * One badge max per user, richest-rank precedence:
   * "1"/"2"/"3" richest ranks, "top5" richest ranks 4-5, otherwise "bottom5"
   * if the user is among the 5 worst profitLoss AND profitLoss < 0.
   */
  rankBadgeFor: (userId: string) => RankBadgeKind | null;
  /** Open-bet count for any of the user's teams (team-switcher rows). */
  openBetCountFor: (teamId: string) => number;
  // Phase-1 mutators — thin wrappers over the shared pure functions
  // (validation.ts / state-machine.ts / settlement.ts / ledger.ts / id.ts).
  addBet: (draft: NewBetDraft) => MutationResult;
  placeWager: (betId: string, optionId: string, amount: number) => MutationResult;
  closeBetEarly: (betId: string) => MutationResult;
  resolveBet: (betId: string, resolution: BetResolution) => MutationResult;
  addTransaction: (input: {
    userId: string;
    kind: Transaction["kind"];
    amount: number;
    description: string;
  }) => MutationResult;
}

/** The mutable Phase-1 world: everything the reducer owns, seeded from mocks. */
interface TeamData {
  teams: Team[];
  bets: Bet[];
  wagers: Wager[];
  transactions: Transaction[];
}

type TeamDataAction =
  | { type: "add-bet"; bet: Bet }
  | { type: "place-wager"; teamId: string; wager: Wager }
  | { type: "close-bet"; betId: string; closedAt: string }
  | {
      type: "resolve-bet";
      teamId: string;
      betId: string;
      resolution: BetResolution;
      deltas: SettlementDelta[];
    }
  | { type: "add-transaction"; transaction: Transaction };

function patchMembers(
  teams: Team[],
  teamId: string,
  patch: (member: TeamMember) => TeamMember,
): Team[] {
  return teams.map((team) =>
    team.id === teamId ? { ...team, members: team.members.map(patch) } : team,
  );
}

/**
 * Mechanical state application only — every domain decision (validation,
 * permissions, settlement math, ledger snapshots) happens in the mutators via
 * the shared pure functions, so Phases 5–7 can lift them into RPCs unchanged.
 */
function teamDataReducer(data: TeamData, action: TeamDataAction): TeamData {
  switch (action.type) {
    case "add-bet":
      return { ...data, bets: [...data.bets, action.bet] };
    case "place-wager": {
      // The stake leaves the balance at placement (decision §4.6 money model).
      const { wager } = action;
      return {
        ...data,
        wagers: [...data.wagers, wager],
        teams: patchMembers(data.teams, action.teamId, (m) =>
          m.userId === wager.userId
            ? { ...m, coinBalance: m.coinBalance - wager.amount }
            : m,
        ),
      };
    }
    case "close-bet":
      // DOM-012: closesAt is exactly when open→closed happened — an early
      // close moves it to "now" so countdowns and "closed Xm ago" stay honest.
      return {
        ...data,
        bets: data.bets.map((b) =>
          b.id === action.betId
            ? { ...b, state: "closed" as const, closesAt: action.closedAt }
            : b,
        ),
      };
    case "resolve-bet": {
      const deltaByUser = new Map(action.deltas.map((d) => [d.userId, d]));
      return {
        ...data,
        bets: data.bets.map((b) =>
          b.id === action.betId
            ? { ...b, state: "resolved" as const, resolution: action.resolution }
            : b,
        ),
        // Settlement credits balances + realized P/L; no Transaction rows
        // (decision §4.6 — resolution is not a ledger event).
        teams: patchMembers(data.teams, action.teamId, (m) => {
          const delta = deltaByUser.get(m.userId);
          return delta
            ? {
                ...m,
                coinBalance: m.coinBalance + delta.balanceDelta,
                profitLoss: m.profitLoss + delta.profitLossDelta,
              }
            : m;
        }),
      };
    }
    case "add-transaction": {
      const { transaction } = action;
      return {
        ...data,
        transactions: [...data.transactions, transaction],
        teams: patchMembers(data.teams, transaction.teamId, (m) =>
          m.userId === transaction.userId
            ? { ...m, coinBalance: transaction.balanceAfter }
            : m,
        ),
      };
    }
  }
}

const initialTeamData: TeamData = {
  teams: mockTeams,
  bets: mockBets,
  wagers: mockWagers,
  transactions: mockTransactions,
};

const TeamContext = createContext<TeamState | null>(null);

export function TeamProvider({ children }: { children: ReactNode }) {
  const [data, dispatch] = useReducer(teamDataReducer, initialTeamData);
  const [currentTeamId, setCurrentTeamId] = useState<string>(mockTeams[0].id);

  const setTeamId = useCallback((id: string) => {
    setCurrentTeamId(id);
  }, []);

  const addBet = useCallback(
    (draft: NewBetDraft): MutationResult => {
      const team = data.teams.find((t) => t.id === currentTeamId);
      if (!team) return { ok: false, error: "Team not found." };
      if (!permitCreateBet(team, mockCurrentUserId)) {
        return {
          ok: false,
          error: "Only the leader or moderators can create bets in this team.",
        };
      }
      const firstIssue = validateBetDraft(draft, Date.now())[0];
      if (firstIssue) return { ok: false, error: firstIssue.message };

      const id = generateId("b");
      const bet: Bet = {
        id,
        teamId: team.id,
        creatorId: mockCurrentUserId,
        title: draft.title.trim(),
        iconEmoji: draft.iconEmoji?.trim() || undefined,
        options: draft.options
          .map((label) => label.trim())
          .filter((label) => label.length > 0)
          .map((label, index) => ({ id: `${id}-o${index + 1}`, label })),
        state: "open",
        closesAt: draft.closesAt,
        maxWagerPerUser: draft.maxWagerPerUser,
        createdAt: new Date().toISOString(),
      };
      dispatch({ type: "add-bet", bet });
      return { ok: true };
    },
    [data.teams, currentTeamId],
  );

  const placeWager = useCallback(
    (betId: string, optionId: string, amount: number): MutationResult => {
      const bet = data.bets.find((b) => b.id === betId);
      if (!bet) return { ok: false, error: "This bet no longer exists." };
      const team = data.teams.find((t) => t.id === bet.teamId);
      const member = team?.members.find((m) => m.userId === mockCurrentUserId);
      if (!team || !member) {
        return { ok: false, error: "You are not a member of this team." };
      }
      if (!canAcceptWagers(bet, Date.now())) {
        return { ok: false, error: "Betting is closed for this bet." };
      }
      if (!bet.options.some((o) => o.id === optionId)) {
        return { ok: false, error: "Pick one of the bet's options." };
      }
      const existingStake = data.wagers
        .filter((w) => w.betId === bet.id && w.userId === mockCurrentUserId)
        .reduce((sum, w) => sum + w.amount, 0);
      const firstIssue = validateWager({
        amount,
        balance: member.coinBalance,
        maxWagerPerUser: bet.maxWagerPerUser,
        existingStake,
      })[0];
      if (firstIssue) return { ok: false, error: firstIssue.message };

      dispatch({
        type: "place-wager",
        teamId: team.id,
        wager: {
          id: generateId("w"),
          betId: bet.id,
          userId: mockCurrentUserId,
          optionId,
          amount,
          placedAt: new Date().toISOString(),
        },
      });
      return { ok: true };
    },
    [data.bets, data.teams, data.wagers],
  );

  const closeBetEarly = useCallback(
    (betId: string): MutationResult => {
      const bet = data.bets.find((b) => b.id === betId);
      if (!bet) return { ok: false, error: "This bet no longer exists." };
      const team = data.teams.find((t) => t.id === bet.teamId);
      if (!team) return { ok: false, error: "Team not found." };
      if (!permitCloseBetEarly(team, mockCurrentUserId, bet)) {
        return {
          ok: false,
          error: "Only the bet creator or a moderator can close betting early.",
        };
      }
      const now = Date.now();
      const effectiveState = computeEffectiveState(bet, now);
      if (!canTransitionBetState(effectiveState, "closed")) {
        return {
          ok: false,
          error:
            effectiveState === "resolved"
              ? "This bet is already resolved."
              : "Betting is already closed.",
        };
      }
      dispatch({
        type: "close-bet",
        betId: bet.id,
        closedAt: new Date(now).toISOString(),
      });
      return { ok: true };
    },
    [data.bets, data.teams],
  );

  const resolveBet = useCallback(
    (betId: string, resolution: BetResolution): MutationResult => {
      const bet = data.bets.find((b) => b.id === betId);
      if (!bet) return { ok: false, error: "This bet no longer exists." };
      const team = data.teams.find((t) => t.id === bet.teamId);
      if (!team) return { ok: false, error: "Team not found." };
      if (!permitResolveBet(team, mockCurrentUserId, bet)) {
        return {
          ok: false,
          error: "Only the bet creator or a moderator can resolve this bet.",
        };
      }
      const effectiveState = computeEffectiveState(bet, Date.now());
      if (!canTransitionBetState(effectiveState, "resolved")) {
        return {
          ok: false,
          error:
            effectiveState === "open"
              ? "Close betting before resolving."
              : "This bet is already resolved.",
        };
      }
      if (
        resolution.kind === "winner" &&
        !bet.options.some((o) => o.id === resolution.winningOptionId)
      ) {
        return { ok: false, error: "Pick one of the bet's options as the winner." };
      }
      dispatch({
        type: "resolve-bet",
        teamId: bet.teamId,
        betId: bet.id,
        resolution,
        deltas: settleBet(bet, data.wagers, resolution),
      });
      return { ok: true };
    },
    [data.bets, data.teams, data.wagers],
  );

  const addTransaction = useCallback(
    (input: {
      userId: string;
      kind: Transaction["kind"];
      amount: number;
      description: string;
    }): MutationResult => {
      const team = data.teams.find((t) => t.id === currentTeamId);
      const member = team?.members.find((m) => m.userId === input.userId);
      if (!team || !member) {
        return { ok: false, error: "Member not found in this team." };
      }
      try {
        const { transaction } = applyTransaction({
          member,
          teamId: team.id,
          id: generateId("tx"),
          kind: input.kind,
          amount: input.amount,
          description: input.description,
          createdAt: new Date().toISOString(),
        });
        dispatch({ type: "add-transaction", transaction });
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "Could not apply the transaction.",
        };
      }
    },
    [data.teams, currentTeamId],
  );

  const value = useMemo<TeamState>(() => {
    const team =
      data.teams.find((t) => t.id === currentTeamId) ?? data.teams[0];
    // Fallback to a synthetic empty user only guards against unknown ids;
    // mockCurrentUserId always resolves in the shipped mock data.
    const currentUser: User =
      getUser(mockCurrentUserId) ??
      ({ id: mockCurrentUserId, displayName: "?", nameColor: "#909592", avatar: "" } as User);

    const member = team.members.find((m) => m.userId === currentUser.id) ?? null;
    const isLeader = team.leaderId === currentUser.id;
    const isModerator = member?.role === "moderator";
    const canManage = isLeader || isModerator;

    // Inline access-mode computation — Phase 2 migrates these three flags
    // onto packages/shared permissions.ts (the mutators already use it).
    const accessGated = member != null && (team.accessMode === "free-for-all" || canManage);
    const canCreateBet = accessGated;
    const canInvite = accessGated;

    const balance = member?.coinBalance ?? 0;

    const bets = data.bets.filter((b) => b.teamId === team.id);
    const betIds = new Set(bets.map((b) => b.id));
    const wagers = data.wagers.filter((w) => betIds.has(w.betId));
    const transactions = data.transactions.filter((t) => t.teamId === team.id);

    const richest = [...team.members].sort((a, b) => b.coinBalance - a.coinBalance);
    const poorest = [...team.members].sort((a, b) => a.profitLoss - b.profitLoss);

    const bottomFive = new Set(
      poorest.slice(0, 5).filter((m) => m.profitLoss < 0).map((m) => m.userId),
    );

    const rankBadgeFor = (userId: string): RankBadgeKind | null => {
      const richestIndex = richest.findIndex((m) => m.userId === userId);
      if (richestIndex === 0) return "1";
      if (richestIndex === 1) return "2";
      if (richestIndex === 2) return "3";
      if (richestIndex === 3 || richestIndex === 4) return "top5";
      if (bottomFive.has(userId)) return "bottom5";
      return null;
    };

    const openBetCountFor = (teamId: string): number =>
      data.bets.filter((b) => b.teamId === teamId && b.state === "open").length;

    return {
      team,
      teams: data.teams,
      setTeamId,
      currentUser,
      member,
      isLeader,
      isModerator,
      canCreateBet,
      canInvite,
      canManage,
      balance,
      bets,
      wagers,
      transactions,
      richest,
      poorest,
      rankBadgeFor,
      openBetCountFor,
      addBet,
      placeWager,
      closeBetEarly,
      resolveBet,
      addTransaction,
    };
  }, [
    data,
    currentTeamId,
    setTeamId,
    addBet,
    placeWager,
    closeBetEarly,
    resolveBet,
    addTransaction,
  ]);

  return <TeamContext.Provider value={value}>{children}</TeamContext.Provider>;
}

export function useTeam(): TeamState {
  const ctx = useContext(TeamContext);
  if (!ctx) {
    throw new Error("useTeam must be used within a TeamProvider");
  }
  return ctx;
}
