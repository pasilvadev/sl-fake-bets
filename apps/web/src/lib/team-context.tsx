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
  CONFIG,
  applyTransaction,
  canAcceptWagers,
  canBan as permitBan,
  canCloseBetEarly as permitCloseBetEarly,
  canComment as permitComment,
  canCreateBet as permitCreateBet,
  canDeleteBet as permitDeleteBet,
  canDeleteTeam as permitDeleteTeam,
  canInjectCoins as permitInjectCoins,
  canInvite as permitInvite,
  canJoinTeam as permitJoinTeam,
  canKick as permitKick,
  canLeaveTeam as permitLeaveTeam,
  canManageTeam as permitManageTeam,
  canResolveBet as permitResolveBet,
  canTransitionBetState,
  computeEffectiveState,
  generateId,
  generateInviteCode,
  hasExactlyOneLeader,
  mockBets,
  mockComments,
  mockCurrentUserId,
  mockTeams,
  mockTransactions,
  mockUsers,
  mockWagers,
  removeMemberWagersInTeam,
  reverseBet,
  settleBet,
  validateBetDraft,
  validateCommentBody,
  validateInjection,
  validateInviteCode,
  validateProfileDraft,
  validateTeamDraft,
  validateWager,
  type Bet,
  type BetResolution,
  type Comment,
  type ProfileDraft,
  type SettlementDelta,
  type Team,
  type TeamAccessMode,
  type TeamDraft,
  type TeamMember,
  type Transaction,
  type User,
  type Wager,
} from "@repo/shared";

/**
 * The identity every mutator below reads, kept deliberately on the fixture id.
 *
 * Phase 4 made AUTH real (useAuth().user is a genuine Supabase identity), but
 * teams, bets and wagers are still the in-memory Phase 1/2 fixtures, whose
 * rows are keyed by `u-01` — pointing this at the real session's uuid would
 * simply detach the signed-in user from every fixture they appear in. The swap
 * belongs to Phase 5, together with the move of this whole context onto
 * Supabase queries. One place to change, exactly as before.
 */
const currentUserId = mockCurrentUserId;

/** Inline rank-badge kinds (design-visual-identity.md §5.6). */
export type RankBadgeKind = "1" | "2" | "3" | "top5" | "bottom5";

/** Uniform mutator outcome — modals surface `error` as the visible reason. */
export type MutationResult = { ok: true } | { ok: false; error: string };

const ok: MutationResult = { ok: true };
function fail(error: string): MutationResult {
  return { ok: false, error };
}

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
  /** Only the teams the current user actually belongs to (UX-009). */
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
  /** DOM-024: leader-only coin injection — moderators excluded. */
  canInject: boolean;
  /** DOM-033: leader-only hard delete of the whole team. */
  canDelete: boolean;
  /** DOM-001: the leader has no exit but deleting the team. */
  canLeave: boolean;
  /** Current member's coinBalance (0 if not a member). */
  balance: number;
  bets: Bet[];
  wagers: Wager[];
  transactions: Transaction[];
  /** Comments on this team's bets (UX-018). */
  comments: Comment[];
  /** Live user lookup — profile edits must show up everywhere a name renders. */
  userById: (userId: string) => User | undefined;
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
  // Mutators — thin wrappers over the shared pure functions (validation.ts /
  // state-machine.ts / settlement.ts / ledger.ts / permissions.ts / id.ts).
  // Phase 1: the bet lifecycle. Phase 2: team lifecycle + comments.
  addBet: (draft: NewBetDraft) => MutationResult;
  placeWager: (betId: string, optionId: string, amount: number) => MutationResult;
  closeBetEarly: (betId: string) => MutationResult;
  resolveBet: (betId: string, resolution: BetResolution) => MutationResult;
  deleteBet: (betId: string) => MutationResult;
  createTeam: (draft: TeamDraft) => MutationResult;
  joinTeamByCode: (code: string) => MutationResult;
  kickMember: (userId: string) => MutationResult;
  banMember: (userId: string) => MutationResult;
  updateTeamSettings: (settings: { accessMode: TeamAccessMode }) => MutationResult;
  deleteTeam: () => MutationResult;
  leaveTeam: () => MutationResult;
  updateProfile: (draft: ProfileDraft) => MutationResult;
  addComment: (betId: string, body: string) => MutationResult;
  injectCoins: (userId: string, amount: number) => MutationResult;
}

/** The mutable frontend-only world: everything the reducer owns, seeded from mocks. */
interface TeamData {
  users: User[];
  teams: Team[];
  bets: Bet[];
  wagers: Wager[];
  transactions: Transaction[];
  comments: Comment[];
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
  | { type: "delete-bet"; teamId: string; betId: string; deltas: SettlementDelta[] }
  | { type: "create-team"; team: Team; transaction: Transaction }
  | {
      type: "join-team";
      teamId: string;
      member: TeamMember;
      transaction: Transaction;
    }
  | {
      type: "remove-membership";
      teamId: string;
      userId: string;
      ban: boolean;
      wagers: Wager[];
    }
  | { type: "update-team-access"; teamId: string; accessMode: TeamAccessMode }
  | { type: "delete-team"; teamId: string }
  | { type: "update-user"; user: User }
  | { type: "add-comment"; comment: Comment }
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

/** Apply per-member balance/profitLoss deltas from settlement.ts. */
function applyDeltas(
  teams: Team[],
  teamId: string,
  deltas: SettlementDelta[],
): Team[] {
  const deltaByUser = new Map(deltas.map((d) => [d.userId, d]));
  return patchMembers(teams, teamId, (m) => {
    const delta = deltaByUser.get(m.userId);
    return delta
      ? {
          ...m,
          coinBalance: m.coinBalance + delta.balanceDelta,
          profitLoss: m.profitLoss + delta.profitLossDelta,
        }
      : m;
  });
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
    case "resolve-bet":
      return {
        ...data,
        bets: data.bets.map((b) =>
          b.id === action.betId
            ? { ...b, state: "resolved" as const, resolution: action.resolution }
            : b,
        ),
        // Settlement credits balances + realized P/L; no Transaction rows
        // (decision §4.6 — resolution is not a ledger event).
        teams: applyDeltas(data.teams, action.teamId, action.deltas),
      };
    case "delete-bet":
      // DOM-033 hard delete: the bet, its wagers and its comments go, and the
      // deltas (from settlement.ts reverseBet) undo its money effects.
      return {
        ...data,
        bets: data.bets.filter((b) => b.id !== action.betId),
        wagers: data.wagers.filter((w) => w.betId !== action.betId),
        comments: data.comments.filter((c) => c.betId !== action.betId),
        teams: applyDeltas(data.teams, action.teamId, action.deltas),
      };
    case "create-team":
      return {
        ...data,
        teams: [...data.teams, action.team],
        transactions: [...data.transactions, action.transaction],
      };
    case "join-team":
      // The member arrives already credited by ledger.ts, so the row and the
      // transaction's balanceAfter snapshot cannot drift apart.
      return {
        ...data,
        teams: data.teams.map((t) =>
          t.id === action.teamId
            ? { ...t, members: [...t.members, action.member] }
            : t,
        ),
        transactions: [...data.transactions, action.transaction],
      };
    case "remove-membership":
      // DOM-031/032: the membership (and with it the per-team balance) goes,
      // the pre-computed cascade replaces the wager list, and a ban — unlike a
      // kick — additionally records the block on re-joining (A-4).
      return {
        ...data,
        wagers: action.wagers,
        teams: data.teams.map((t) =>
          t.id === action.teamId
            ? {
                ...t,
                members: t.members.filter((m) => m.userId !== action.userId),
                bannedUserIds: action.ban
                  ? [...t.bannedUserIds, action.userId]
                  : t.bannedUserIds,
              }
            : t,
        ),
      };
    case "update-team-access":
      return {
        ...data,
        teams: data.teams.map((t) =>
          t.id === action.teamId ? { ...t, accessMode: action.accessMode } : t,
        ),
      };
    case "delete-team": {
      // DOM-033 hard delete: the team takes its bets, wagers, comments and
      // ledger with it. Balances are per-team (DOM-013), so nothing survives
      // to refund.
      const doomedBetIds = new Set(
        data.bets.filter((b) => b.teamId === action.teamId).map((b) => b.id),
      );
      return {
        ...data,
        teams: data.teams.filter((t) => t.id !== action.teamId),
        bets: data.bets.filter((b) => b.teamId !== action.teamId),
        wagers: data.wagers.filter((w) => !doomedBetIds.has(w.betId)),
        comments: data.comments.filter((c) => !doomedBetIds.has(c.betId)),
        transactions: data.transactions.filter((t) => t.teamId !== action.teamId),
      };
    }
    case "update-user":
      return {
        ...data,
        users: data.users.map((u) => (u.id === action.user.id ? action.user : u)),
      };
    case "add-comment":
      return { ...data, comments: [...data.comments, action.comment] };
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
  users: mockUsers,
  teams: mockTeams,
  bets: mockBets,
  wagers: mockWagers,
  transactions: mockTransactions,
  comments: mockComments,
};

/** Teams the given user is actually on — what the switcher may show (UX-009). */
function teamsOf(teams: Team[], userId: string): Team[] {
  return teams.filter((t) => t.members.some((m) => m.userId === userId));
}

/**
 * A new membership starts at the onboarding grant (decision §4.2) — built
 * through ledger.ts so the member row and the Transaction's balanceAfter
 * snapshot are produced together (DOM-021/025).
 */
function seedMembership(
  teamId: string,
  userId: string,
  createdAt: string,
): { member: TeamMember; transaction: Transaction } {
  return applyTransaction({
    member: {
      userId,
      role: "member",
      coinBalance: 0,
      profitLoss: 0,
      joinedAt: createdAt,
    },
    teamId,
    id: generateId("tx"),
    kind: "onboarding-grant",
    amount: CONFIG.ONBOARDING_GRANT_COINS,
    description: "Onboarding grant",
    createdAt,
  });
}

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
      if (!team) return fail("Team not found.");
      if (!permitCreateBet(team, currentUserId)) {
        return fail("Only the leader or moderators can create bets in this team.");
      }
      const firstIssue = validateBetDraft(draft, Date.now())[0];
      if (firstIssue) return fail(firstIssue.message);

      const id = generateId("b");
      const bet: Bet = {
        id,
        teamId: team.id,
        creatorId: currentUserId,
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
      return ok;
    },
    [data.teams, currentTeamId],
  );

  const placeWager = useCallback(
    (betId: string, optionId: string, amount: number): MutationResult => {
      const bet = data.bets.find((b) => b.id === betId);
      if (!bet) return fail("This bet no longer exists.");
      const team = data.teams.find((t) => t.id === bet.teamId);
      const member = team?.members.find((m) => m.userId === currentUserId);
      if (!team || !member) return fail("You are not a member of this team.");
      if (!canAcceptWagers(bet, Date.now())) {
        return fail("Betting is closed for this bet.");
      }
      if (!bet.options.some((o) => o.id === optionId)) {
        return fail("Pick one of the bet's options.");
      }
      const existingStake = data.wagers
        .filter((w) => w.betId === bet.id && w.userId === currentUserId)
        .reduce((sum, w) => sum + w.amount, 0);
      const firstIssue = validateWager({
        amount,
        balance: member.coinBalance,
        maxWagerPerUser: bet.maxWagerPerUser,
        existingStake,
      })[0];
      if (firstIssue) return fail(firstIssue.message);

      dispatch({
        type: "place-wager",
        teamId: team.id,
        wager: {
          id: generateId("w"),
          betId: bet.id,
          userId: currentUserId,
          optionId,
          amount,
          placedAt: new Date().toISOString(),
        },
      });
      return ok;
    },
    [data.bets, data.teams, data.wagers],
  );

  const closeBetEarly = useCallback(
    (betId: string): MutationResult => {
      const bet = data.bets.find((b) => b.id === betId);
      if (!bet) return fail("This bet no longer exists.");
      const team = data.teams.find((t) => t.id === bet.teamId);
      if (!team) return fail("Team not found.");
      if (!permitCloseBetEarly(team, currentUserId, bet)) {
        return fail("Only the bet creator or a moderator can close betting early.");
      }
      const now = Date.now();
      const effectiveState = computeEffectiveState(bet, now);
      if (!canTransitionBetState(effectiveState, "closed")) {
        return fail(
          effectiveState === "resolved"
            ? "This bet is already resolved."
            : "Betting is already closed.",
        );
      }
      dispatch({
        type: "close-bet",
        betId: bet.id,
        closedAt: new Date(now).toISOString(),
      });
      return ok;
    },
    [data.bets, data.teams],
  );

  const resolveBet = useCallback(
    (betId: string, resolution: BetResolution): MutationResult => {
      const bet = data.bets.find((b) => b.id === betId);
      if (!bet) return fail("This bet no longer exists.");
      const team = data.teams.find((t) => t.id === bet.teamId);
      if (!team) return fail("Team not found.");
      if (!permitResolveBet(team, currentUserId, bet)) {
        return fail("Only the bet creator or a moderator can resolve this bet.");
      }
      const effectiveState = computeEffectiveState(bet, Date.now());
      if (!canTransitionBetState(effectiveState, "resolved")) {
        return fail(
          effectiveState === "open"
            ? "Close betting before resolving."
            : "This bet is already resolved.",
        );
      }
      if (
        resolution.kind === "winner" &&
        !bet.options.some((o) => o.id === resolution.winningOptionId)
      ) {
        return fail("Pick one of the bet's options as the winner.");
      }
      dispatch({
        type: "resolve-bet",
        teamId: bet.teamId,
        betId: bet.id,
        resolution,
        deltas: settleBet(bet, data.wagers, resolution),
      });
      return ok;
    },
    [data.bets, data.teams, data.wagers],
  );

  /** DOM-033/034: hard delete; reverseBet undoes the bet's money effects. */
  const deleteBet = useCallback(
    (betId: string): MutationResult => {
      const bet = data.bets.find((b) => b.id === betId);
      if (!bet) return fail("This bet no longer exists.");
      const team = data.teams.find((t) => t.id === bet.teamId);
      if (!team) return fail("Team not found.");
      if (!permitDeleteBet(team, currentUserId, bet)) {
        return fail("Only the bet creator or a moderator can delete this bet.");
      }
      dispatch({
        type: "delete-bet",
        teamId: bet.teamId,
        betId: bet.id,
        deltas: reverseBet(bet, data.wagers),
      });
      return ok;
    },
    [data.bets, data.teams, data.wagers],
  );

  /** DOM-001/002 + DOM-021: creator becomes the leader and gets the grant. */
  const createTeam = useCallback(
    (draft: TeamDraft): MutationResult => {
      const firstIssue = validateTeamDraft(draft)[0];
      if (firstIssue) return fail(firstIssue.message);

      const createdAt = new Date().toISOString();
      const teamId = generateId("t");
      const { member, transaction } = seedMembership(
        teamId,
        currentUserId,
        createdAt,
      );
      const team: Team = {
        id: teamId,
        name: draft.name.trim(),
        leaderId: currentUserId,
        accessMode: draft.accessMode,
        inviteCode: generateInviteCode(data.teams.map((t) => t.inviteCode)),
        members: [member],
        bannedUserIds: [],
        createdAt,
      };
      if (!hasExactlyOneLeader(team)) {
        return fail("A team needs exactly one leader (DOM-001).");
      }

      dispatch({ type: "create-team", team, transaction });
      setCurrentTeamId(teamId); // UX-010: switching re-scopes the whole app.
      return ok;
    },
    [data.teams],
  );

  /** UX-005/DOM-005/006 + A-4: codes never expire, bans still keep you out. */
  const joinTeamByCode = useCallback(
    (code: string): MutationResult => {
      const firstIssue = validateInviteCode(code)[0];
      if (firstIssue) return fail(firstIssue.message);

      const normalized = code.trim().toLowerCase();
      const team = data.teams.find(
        (t) => t.inviteCode.toLowerCase() === normalized,
      );
      if (!team) return fail("No team matches that invite code.");
      if (!permitJoinTeam(team, currentUserId)) {
        return fail(
          team.members.some((m) => m.userId === currentUserId)
            ? `You are already in ${team.name}.`
            : `You can't rejoin ${team.name}.`,
        );
      }

      const { member, transaction } = seedMembership(
        team.id,
        currentUserId,
        new Date().toISOString(),
      );
      dispatch({ type: "join-team", teamId: team.id, member, transaction });
      setCurrentTeamId(team.id);
      return ok;
    },
    [data.teams],
  );

  /**
   * DOM-031/032: kick and ban share one path — the only difference is whether
   * re-joining stays open (A-4). The wager cascade goes through settlement.ts,
   * team-scoped so other teams' pools are untouched (decision §4.4).
   */
  const removeMember = useCallback(
    (userId: string, ban: boolean): MutationResult => {
      const team = data.teams.find((t) => t.id === currentTeamId);
      if (!team) return fail("Team not found.");
      const permitted = ban ? permitBan : permitKick;
      if (!permitted(team, currentUserId)) {
        return fail("Only the leader or moderators can remove members.");
      }
      if (userId === currentUserId) {
        return fail("Use Leave team to remove yourself.");
      }
      if (userId === team.leaderId) {
        return fail("The team leader can't be removed.");
      }
      if (!team.members.some((m) => m.userId === userId)) {
        return fail("That member is not on this team.");
      }

      dispatch({
        type: "remove-membership",
        teamId: team.id,
        userId,
        ban,
        wagers: removeMemberWagersInTeam(userId, team.id, data.bets, data.wagers),
      });
      return ok;
    },
    [data.teams, data.bets, data.wagers, currentTeamId],
  );

  const kickMember = useCallback(
    (userId: string) => removeMember(userId, false),
    [removeMember],
  );
  const banMember = useCallback(
    (userId: string) => removeMember(userId, true),
    [removeMember],
  );

  /** DOM-002: access mode gates bet creation and invites; mods may change it. */
  const updateTeamSettings = useCallback(
    (settings: { accessMode: TeamAccessMode }): MutationResult => {
      const team = data.teams.find((t) => t.id === currentTeamId);
      if (!team) return fail("Team not found.");
      if (!permitManageTeam(team, currentUserId)) {
        return fail("Only the leader or moderators can change team settings.");
      }
      if (team.accessMode === settings.accessMode) return ok;

      dispatch({
        type: "update-team-access",
        teamId: team.id,
        accessMode: settings.accessMode,
      });
      return ok;
    },
    [data.teams, currentTeamId],
  );

  /**
   * DOM-033/034: leader-only hard delete. Blocked when it would leave the user
   * with no team at all — a team-less shell is onboarding's job (UX-028), not
   * something Phase 2 has a screen for.
   */
  const deleteTeam = useCallback((): MutationResult => {
    const team = data.teams.find((t) => t.id === currentTeamId);
    if (!team) return fail("Team not found.");
    if (!permitDeleteTeam(team, currentUserId)) {
      return fail("Only the team leader can delete the team.");
    }
    const myTeams = teamsOf(data.teams, currentUserId);
    if (myTeams.length <= 1) {
      return fail("This is your only team — create or join another one first.");
    }

    dispatch({ type: "delete-team", teamId: team.id });
    setCurrentTeamId(myTeams.find((t) => t.id !== team.id)!.id);
    return ok;
  }, [data.teams, currentTeamId]);

  /** The membership and its per-team balance go; wagers cascade as on a kick. */
  const leaveTeam = useCallback((): MutationResult => {
    const team = data.teams.find((t) => t.id === currentTeamId);
    if (!team) return fail("Team not found.");
    if (!permitLeaveTeam(team, currentUserId)) {
      return fail(
        team.leaderId === currentUserId
          ? "The leader can't leave — delete the team instead."
          : "You are not a member of this team.",
      );
    }
    const myTeams = teamsOf(data.teams, currentUserId);
    if (myTeams.length <= 1) {
      return fail("This is your only team — create or join another one first.");
    }

    dispatch({
      type: "remove-membership",
      teamId: team.id,
      userId: currentUserId,
      ban: false,
      wagers: removeMemberWagersInTeam(
        currentUserId,
        team.id,
        data.bets,
        data.wagers,
      ),
    });
    setCurrentTeamId(myTeams.find((t) => t.id !== team.id)!.id);
    return ok;
  }, [data.teams, data.bets, data.wagers, currentTeamId]);

  /** UX-022: name, curated name color, avatar — applied everywhere at once. */
  const updateProfile = useCallback(
    (draft: ProfileDraft): MutationResult => {
      const user = data.users.find((u) => u.id === currentUserId);
      if (!user) return fail("Profile not found.");
      const firstIssue = validateProfileDraft(draft)[0];
      if (firstIssue) return fail(firstIssue.message);

      dispatch({
        type: "update-user",
        user: {
          ...user,
          displayName: draft.displayName.trim(),
          nameColor: draft.nameColor,
          avatar: draft.avatar,
        },
      });
      return ok;
    },
    [data.users],
  );

  /** UX-018 + DOM-030: any member of the bet's team, no content filtering. */
  const addComment = useCallback(
    (betId: string, body: string): MutationResult => {
      const bet = data.bets.find((b) => b.id === betId);
      if (!bet) return fail("This bet no longer exists.");
      const team = data.teams.find((t) => t.id === bet.teamId);
      if (!team || !permitComment(team, currentUserId)) {
        return fail("Only team members can comment on this bet.");
      }
      const firstIssue = validateCommentBody(body)[0];
      if (firstIssue) return fail(firstIssue.message);

      dispatch({
        type: "add-comment",
        comment: {
          id: generateId("c"),
          betId: bet.id,
          userId: currentUserId,
          body: body.trim(),
          createdAt: new Date().toISOString(),
        },
      });
      return ok;
    },
    [data.bets, data.teams],
  );

  /** DOM-024/025: leader-only credit, written as an "injection" ledger row. */
  const injectCoins = useCallback(
    (userId: string, amount: number): MutationResult => {
      const team = data.teams.find((t) => t.id === currentTeamId);
      if (!team) return fail("Team not found.");
      if (!permitInjectCoins(team, currentUserId)) {
        return fail("Only the team leader can inject coins.");
      }
      const member = team.members.find((m) => m.userId === userId);
      if (!member) return fail("That member is not on this team.");
      const firstIssue = validateInjection(amount)[0];
      if (firstIssue) return fail(firstIssue.message);

      const injector = data.users.find((u) => u.id === currentUserId);
      const { transaction } = applyTransaction({
        member,
        teamId: team.id,
        id: generateId("tx"),
        kind: "injection",
        amount,
        description: `Injected by ${injector?.displayName ?? "the leader"} (leader)`,
        createdAt: new Date().toISOString(),
      });
      dispatch({ type: "add-transaction", transaction });
      return ok;
    },
    [data.teams, data.users, currentTeamId],
  );

  const value = useMemo<TeamState>(() => {
    // Only the user's own teams are selectable — leaving one must drop it from
    // the switcher, not leave a team they can no longer act in reachable.
    const myTeams = teamsOf(data.teams, currentUserId);
    // The last fallback is unreachable today — deleting or leaving your only
    // team is blocked — but it degrades to a read-only view instead of a crash
    // rather than making `team` nullable for every consumer.
    const team =
      myTeams.find((t) => t.id === currentTeamId) ?? myTeams[0] ?? data.teams[0];
    const userById = (userId: string) => data.users.find((u) => u.id === userId);
    // Fallback to a synthetic empty user only guards against unknown ids;
    // currentUserId always resolves in the shipped mock data.
    const currentUser: User =
      userById(currentUserId) ??
      ({ id: currentUserId, displayName: "?", nameColor: "#909592", avatar: "" } as User);

    const member = team.members.find((m) => m.userId === currentUser.id) ?? null;
    const isLeader = team.leaderId === currentUser.id;
    const isModerator = member?.role === "moderator";

    const balance = member?.coinBalance ?? 0;

    const bets = data.bets.filter((b) => b.teamId === team.id);
    const betIds = new Set(bets.map((b) => b.id));
    const wagers = data.wagers.filter((w) => betIds.has(w.betId));
    const transactions = data.transactions.filter((t) => t.teamId === team.id);
    const comments = data.comments.filter((c) => betIds.has(c.betId));

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
      teams: myTeams,
      setTeamId,
      currentUser,
      member,
      isLeader,
      isModerator,
      // Authorization lives in packages/shared permissions.ts and nowhere else.
      canCreateBet: permitCreateBet(team, currentUser.id),
      canInvite: permitInvite(team, currentUser.id),
      canManage: permitManageTeam(team, currentUser.id),
      canInject: permitInjectCoins(team, currentUser.id),
      canDelete: permitDeleteTeam(team, currentUser.id),
      canLeave: permitLeaveTeam(team, currentUser.id),
      balance,
      bets,
      wagers,
      transactions,
      comments,
      userById,
      richest,
      poorest,
      rankBadgeFor,
      openBetCountFor,
      addBet,
      placeWager,
      closeBetEarly,
      resolveBet,
      deleteBet,
      createTeam,
      joinTeamByCode,
      kickMember,
      banMember,
      updateTeamSettings,
      deleteTeam,
      leaveTeam,
      updateProfile,
      addComment,
      injectCoins,
    };
  }, [
    data,
    currentTeamId,
    setTeamId,
    addBet,
    placeWager,
    closeBetEarly,
    resolveBet,
    deleteBet,
    createTeam,
    joinTeamByCode,
    kickMember,
    banMember,
    updateTeamSettings,
    deleteTeam,
    leaveTeam,
    updateProfile,
    addComment,
    injectCoins,
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
