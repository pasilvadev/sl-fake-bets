"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  getUser,
  mockBets,
  mockCurrentUserId,
  mockTeams,
  mockTransactions,
  mockWagers,
  type Bet,
  type Team,
  type TeamMember,
  type Transaction,
  type User,
  type Wager,
} from "@repo/shared";

/** Inline rank-badge kinds (design-visual-identity.md §5.6). */
export type RankBadgeKind = "1" | "2" | "3" | "top5" | "bottom5";

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
}

const TeamContext = createContext<TeamState | null>(null);

export function TeamProvider({ children }: { children: ReactNode }) {
  const [currentTeamId, setCurrentTeamId] = useState<string>(mockTeams[0].id);

  const setTeamId = useCallback((id: string) => {
    setCurrentTeamId(id);
  }, []);

  const value = useMemo<TeamState>(() => {
    const team =
      mockTeams.find((t) => t.id === currentTeamId) ?? mockTeams[0];
    // Fallback to a synthetic empty user only guards against unknown ids;
    // mockCurrentUserId always resolves in the shipped mock data.
    const currentUser: User =
      getUser(mockCurrentUserId) ??
      ({ id: mockCurrentUserId, displayName: "?", nameColor: "#909592", avatar: "" } as User);

    const member = team.members.find((m) => m.userId === currentUser.id) ?? null;
    const isLeader = team.leaderId === currentUser.id;
    const isModerator = member?.role === "moderator";
    const canManage = isLeader || isModerator;

    const accessGated = member != null && (team.accessMode === "free-for-all" || canManage);
    const canCreateBet = accessGated;
    const canInvite = accessGated;

    const balance = member?.coinBalance ?? 0;

    const bets = mockBets.filter((b) => b.teamId === team.id);
    const betIds = new Set(bets.map((b) => b.id));
    const wagers = mockWagers.filter((w) => betIds.has(w.betId));
    const transactions = mockTransactions.filter((t) => t.teamId === team.id);

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

    return {
      team,
      teams: mockTeams,
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
    };
  }, [currentTeamId, setTeamId]);

  return <TeamContext.Provider value={value}>{children}</TeamContext.Provider>;
}

export function useTeam(): TeamState {
  const ctx = useContext(TeamContext);
  if (!ctx) {
    throw new Error("useTeam must be used within a TeamProvider");
  }
  return ctx;
}
