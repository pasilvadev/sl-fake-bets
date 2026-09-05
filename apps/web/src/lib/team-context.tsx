"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
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
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { EMPTY_TEAM_DATA, loadTeamData, type TeamData } from "@/lib/data/team-data";
import * as db from "@/lib/data/team-mutations";
import { fail, ok, type MutationResult } from "@/lib/data/result";

export type { MutationResult } from "@/lib/data/result";

/** Inline rank-badge kinds (design-visual-identity.md §5.6). */
export type RankBadgeKind = "1" | "2" | "3" | "top5" | "bottom5";

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
  // --- mutators ---
  //
  // Two kinds since roadmap Phase 5, and the split is the phase boundary
  // itself, not a style choice:
  //
  //  * TEAM mutators are async. They write to Postgres first (Phase 5's RPCs
  //    and policies) and only then apply the same local change, so what the
  //    screen shows is what the database accepted.
  //  * BET mutators are still synchronous local state. Placing a wager has to
  //    debit a stored coin_balance in the same transaction, which the Phase 3
  //    column trigger reserves for the leader and for SECURITY DEFINER
  //    functions — so it needs an RPC that does not exist yet. That is
  //    Phase 6's whole job. Until it lands, bets/wagers/comments LOAD from
  //    Postgres but any change made here lives for the session only.
  addBet: (draft: NewBetDraft) => MutationResult;
  placeWager: (betId: string, optionId: string, amount: number) => MutationResult;
  closeBetEarly: (betId: string) => MutationResult;
  resolveBet: (betId: string, resolution: BetResolution) => MutationResult;
  deleteBet: (betId: string) => MutationResult;
  addComment: (betId: string, body: string) => MutationResult;
  createTeam: (draft: TeamDraft) => Promise<MutationResult>;
  joinTeamByCode: (code: string) => Promise<MutationResult>;
  kickMember: (userId: string) => Promise<MutationResult>;
  banMember: (userId: string) => Promise<MutationResult>;
  updateTeamSettings: (settings: { accessMode: TeamAccessMode }) => Promise<MutationResult>;
  deleteTeam: () => Promise<MutationResult>;
  leaveTeam: () => Promise<MutationResult>;
  updateProfile: (draft: ProfileDraft) => Promise<MutationResult>;
  injectCoins: (userId: string, amount: number) => Promise<MutationResult>;
}

/**
 * What the app knows before (or without) a current team: whether the world has
 * loaded, and the two actions that can create one.
 *
 * Separate from TeamState because both of its consumers exist precisely when
 * TeamState cannot: the loading/empty gate, and the `/join/[code]` route a
 * brand-new user lands on with no team at all. Making TeamState.team nullable
 * instead would push a null check into every module that renders a team name.
 */
export interface TeamSession {
  status: "loading" | "ready" | "error";
  error: string | null;
  /** Teams the signed-in user belongs to — empty for a brand-new account. */
  teams: Team[];
  currentUserId: string | null;
  setTeamId: (id: string) => void;
  reload: () => Promise<void>;
  createTeam: (draft: TeamDraft) => Promise<MutationResult>;
  joinTeamByCode: (code: string) => Promise<MutationResult>;
}

type TeamDataAction =
  /** A fresh load from Postgres replaces the world wholesale. */
  | { type: "replace"; data: TeamData }
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
 * the shared pure functions, and since Phase 5 the team-shape ones have already
 * been accepted by Postgres before they reach here.
 */
function teamDataReducer(data: TeamData, action: TeamDataAction): TeamData {
  switch (action.type) {
    case "replace":
      return action.data;
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
      // ledger with it (in Postgres, by ON DELETE CASCADE). Balances are
      // per-team (DOM-013), so nothing survives to refund.
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

/** Teams the given user is actually on — what the switcher may show (UX-009). */
function teamsOf(teams: Team[], userId: string): Team[] {
  return teams.filter((t) => t.members.some((m) => m.userId === userId));
}

const TeamContext = createContext<TeamState | null>(null);
const TeamSessionContext = createContext<TeamSession | null>(null);

export function TeamProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const currentUserId = user?.id ?? null;
  const supabase = useMemo(() => createClient(), []);

  const [data, dispatch] = useReducer(teamDataReducer, EMPTY_TEAM_DATA);
  const [status, setStatus] = useState<TeamSession["status"]>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentTeamId, setCurrentTeamId] = useState<string | null>(null);

  const setTeamId = useCallback((id: string) => {
    setCurrentTeamId(id);
  }, []);

  /**
   * Pull the whole world down again. Used on sign-in, on team switching
   * between accounts, and after the two mutations whose result includes
   * server-generated rows the client cannot predict (create/join a team).
   *
   * Every other mutation applies its own local change instead, which is not an
   * optimization: a reload would also discard the session-local bet and wager
   * state that Phase 6 has not yet made durable.
   */
  const reload = useCallback(async () => {
    if (!currentUserId) {
      dispatch({ type: "replace", data: EMPTY_TEAM_DATA });
      setStatus("ready");
      return;
    }
    const { data: loaded, error } = await loadTeamData(supabase);
    if (error) {
      setLoadError(error);
      setStatus("error");
      return;
    }
    dispatch({ type: "replace", data: loaded });
    setLoadError(null);
    setStatus("ready");
  }, [supabase, currentUserId]);

  // Identity change (sign-in, sign-out, a different account) is the only thing
  // that invalidates the whole load.
  const loadedForUserId = useRef<string | null>(null);
  useEffect(() => {
    if (loadedForUserId.current === currentUserId) return;
    loadedForUserId.current = currentUserId;
    setStatus("loading");
    setCurrentTeamId(null);
    void reload();
  }, [currentUserId, reload]);

  const myTeams = useMemo(
    () => (currentUserId ? teamsOf(data.teams, currentUserId) : []),
    [data.teams, currentUserId],
  );

  // UX-011: a returning user lands on a team dashboard, never on a picker.
  // The selection follows the roster rather than being pinned, so leaving or
  // being kicked from the current team cannot strand the app on a team the
  // user can no longer read.
  const team =
    myTeams.find((t) => t.id === currentTeamId) ?? myTeams[0] ?? null;

  const requireContext = useCallback(
    (): { team: Team; userId: string } | null =>
      team && currentUserId ? { team, userId: currentUserId } : null,
    [team, currentUserId],
  );

  // --- bet lifecycle: still session-local state (see the TeamState comment) ---

  const addBet = useCallback(
    (draft: NewBetDraft): MutationResult => {
      const ctx = requireContext();
      if (!ctx) return fail("Team not found.");
      if (!permitCreateBet(ctx.team, ctx.userId)) {
        return fail("Only the leader or moderators can create bets in this team.");
      }
      const firstIssue = validateBetDraft(draft, Date.now())[0];
      if (firstIssue) return fail(firstIssue.message);

      const id = generateId("b");
      const bet: Bet = {
        id,
        teamId: ctx.team.id,
        creatorId: ctx.userId,
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
    [requireContext],
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
          userId: member.userId,
          optionId,
          amount,
          placedAt: new Date().toISOString(),
        },
      });
      return ok;
    },
    [data.bets, data.teams, data.wagers, currentUserId],
  );

  const closeBetEarly = useCallback(
    (betId: string): MutationResult => {
      const bet = data.bets.find((b) => b.id === betId);
      if (!bet) return fail("This bet no longer exists.");
      const team = data.teams.find((t) => t.id === bet.teamId);
      if (!team || !currentUserId) return fail("Team not found.");
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
    [data.bets, data.teams, currentUserId],
  );

  const resolveBet = useCallback(
    (betId: string, resolution: BetResolution): MutationResult => {
      const bet = data.bets.find((b) => b.id === betId);
      if (!bet) return fail("This bet no longer exists.");
      const team = data.teams.find((t) => t.id === bet.teamId);
      if (!team || !currentUserId) return fail("Team not found.");
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
    [data.bets, data.teams, data.wagers, currentUserId],
  );

  /** DOM-033/034: hard delete; reverseBet undoes the bet's money effects. */
  const deleteBet = useCallback(
    (betId: string): MutationResult => {
      const bet = data.bets.find((b) => b.id === betId);
      if (!bet) return fail("This bet no longer exists.");
      const team = data.teams.find((t) => t.id === bet.teamId);
      if (!team || !currentUserId) return fail("Team not found.");
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
    [data.bets, data.teams, data.wagers, currentUserId],
  );

  /** UX-018 + DOM-030: any member of the bet's team, no content filtering. */
  const addComment = useCallback(
    (betId: string, body: string): MutationResult => {
      const bet = data.bets.find((b) => b.id === betId);
      if (!bet) return fail("This bet no longer exists.");
      const team = data.teams.find((t) => t.id === bet.teamId);
      if (!team || !currentUserId || !permitComment(team, currentUserId)) {
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
    [data.bets, data.teams, currentUserId],
  );

  // --- team lifecycle: real Postgres writes (roadmap Phase 5) ---

  /** DOM-001/002 + DOM-021: creator becomes the leader and gets the grant. */
  const createTeam = useCallback(
    async (draft: TeamDraft): Promise<MutationResult> => {
      if (!currentUserId) return fail("You must be signed in.");
      const firstIssue = validateTeamDraft(draft)[0];
      if (firstIssue) return fail(firstIssue.message);

      const result = await db.createTeam(supabase, draft);
      if (!result.ok) return result;

      await reload();
      // UX-010: switching re-scopes the whole app.
      if (result.teamId) setCurrentTeamId(result.teamId);
      return ok;
    },
    [supabase, currentUserId, reload],
  );

  /** UX-005/DOM-005/006 + A-4: codes never expire, bans still keep you out. */
  const joinTeamByCode = useCallback(
    async (code: string): Promise<MutationResult> => {
      if (!currentUserId) return fail("You must be signed in.");
      const firstIssue = validateInviteCode(code)[0];
      if (firstIssue) return fail(firstIssue.message);

      // The client's own copy of canJoinTeam only answers for teams it can
      // already see; the authoritative check is inside join_team_with_code.
      const known = data.teams.find(
        (t) => t.inviteCode.toLowerCase() === code.trim().toLowerCase(),
      );
      if (known && !permitJoinTeam(known, currentUserId)) {
        return fail(`You are already in ${known.name}.`);
      }

      const result = await db.joinTeamByCode(supabase, code);
      if (!result.ok) return result;

      await reload();
      if (result.teamId) setCurrentTeamId(result.teamId);
      return ok;
    },
    [supabase, currentUserId, data.teams, reload],
  );

  /**
   * DOM-031/032: kick and ban share one path — the only difference is whether
   * re-joining stays open (A-4). The wager cascade goes through settlement.ts,
   * team-scoped so other teams' pools are untouched (decision §4.4); the ids it
   * drops are what the RPC applies in Postgres.
   */
  const removeMember = useCallback(
    async (userId: string, ban: boolean): Promise<MutationResult> => {
      const ctx = requireContext();
      if (!ctx) return fail("Team not found.");
      const permitted = ban ? permitBan : permitKick;
      if (!permitted(ctx.team, ctx.userId)) {
        return fail("Only the leader or moderators can remove members.");
      }
      if (userId === ctx.userId) {
        return fail("Use Leave team to remove yourself.");
      }
      if (userId === ctx.team.leaderId) {
        return fail("The team leader can't be removed.");
      }
      if (!ctx.team.members.some((m) => m.userId === userId)) {
        return fail("That member is not on this team.");
      }

      const keptWagers = removeMemberWagersInTeam(
        userId,
        ctx.team.id,
        data.bets,
        data.wagers,
      );
      const kept = new Set(keptWagers.map((w) => w.id));
      const removedIds = data.wagers
        .filter((w) => !kept.has(w.id))
        .map((w) => w.id);

      const result = await db.removeMembership(supabase, {
        teamId: ctx.team.id,
        userId,
        ban,
        wagerIds: removedIds,
      });
      if (!result.ok) return result;

      dispatch({
        type: "remove-membership",
        teamId: ctx.team.id,
        userId,
        ban,
        wagers: keptWagers,
      });
      return ok;
    },
    [supabase, requireContext, data.bets, data.wagers],
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
    async (settings: { accessMode: TeamAccessMode }): Promise<MutationResult> => {
      const ctx = requireContext();
      if (!ctx) return fail("Team not found.");
      if (!permitManageTeam(ctx.team, ctx.userId)) {
        return fail("Only the leader or moderators can change team settings.");
      }
      if (ctx.team.accessMode === settings.accessMode) return ok;

      const result = await db.updateTeamSettings(supabase, {
        teamId: ctx.team.id,
        accessMode: settings.accessMode,
      });
      if (!result.ok) return result;

      dispatch({
        type: "update-team-access",
        teamId: ctx.team.id,
        accessMode: settings.accessMode,
      });
      return ok;
    },
    [supabase, requireContext],
  );

  /**
   * DOM-033/034: leader-only hard delete. Unlike Phase 2, deleting your only
   * team is allowed now — Phase 5 has a screen for having no team (the create/
   * join gate), so refusing would only trap the leader in a team they wanted
   * gone.
   */
  const deleteTeam = useCallback(async (): Promise<MutationResult> => {
    const ctx = requireContext();
    if (!ctx) return fail("Team not found.");
    if (!permitDeleteTeam(ctx.team, ctx.userId)) {
      return fail("Only the team leader can delete the team.");
    }

    const result = await db.deleteTeam(supabase, ctx.team.id);
    if (!result.ok) return result;

    dispatch({ type: "delete-team", teamId: ctx.team.id });
    setCurrentTeamId(null);
    return ok;
  }, [supabase, requireContext]);

  /** The membership and its per-team balance go; wagers cascade as on a kick. */
  const leaveTeam = useCallback(async (): Promise<MutationResult> => {
    const ctx = requireContext();
    if (!ctx) return fail("Team not found.");
    if (!permitLeaveTeam(ctx.team, ctx.userId)) {
      return fail(
        ctx.team.leaderId === ctx.userId
          ? "The leader can't leave — delete the team instead."
          : "You are not a member of this team.",
      );
    }

    const keptWagers = removeMemberWagersInTeam(
      ctx.userId,
      ctx.team.id,
      data.bets,
      data.wagers,
    );
    const kept = new Set(keptWagers.map((w) => w.id));
    const removedIds = data.wagers.filter((w) => !kept.has(w.id)).map((w) => w.id);

    const result = await db.removeMembership(supabase, {
      teamId: ctx.team.id,
      userId: ctx.userId,
      ban: false,
      wagerIds: removedIds,
    });
    if (!result.ok) return result;

    dispatch({
      type: "remove-membership",
      teamId: ctx.team.id,
      userId: ctx.userId,
      ban: false,
      wagers: keptWagers,
    });
    setCurrentTeamId(null);
    return ok;
  }, [supabase, requireContext, data.bets, data.wagers]);

  /** UX-022: name, curated name color, avatar — applied everywhere at once. */
  const updateProfile = useCallback(
    async (draft: ProfileDraft): Promise<MutationResult> => {
      if (!currentUserId) return fail("You must be signed in.");
      const user = data.users.find((u) => u.id === currentUserId);
      if (!user) return fail("Profile not found.");
      const firstIssue = validateProfileDraft(draft)[0];
      if (firstIssue) return fail(firstIssue.message);

      const result = await db.updateProfile(supabase, currentUserId, draft);
      if (!result.ok) return result;

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
    [supabase, currentUserId, data.users],
  );

  /** DOM-024/025: leader-only credit, written as an "injection" ledger row. */
  const injectCoins = useCallback(
    async (userId: string, amount: number): Promise<MutationResult> => {
      const ctx = requireContext();
      if (!ctx) return fail("Team not found.");
      if (!permitInjectCoins(ctx.team, ctx.userId)) {
        return fail("Only the team leader can inject coins.");
      }
      if (!ctx.team.members.some((m) => m.userId === userId)) {
        return fail("That member is not on this team.");
      }
      const firstIssue = validateInjection(amount)[0];
      if (firstIssue) return fail(firstIssue.message);

      const result = await db.injectCoins(supabase, {
        teamId: ctx.team.id,
        userId,
        amount,
      });
      if (!result.ok) return result;

      const injector = data.users.find((u) => u.id === ctx.userId);
      dispatch({
        type: "add-transaction",
        transaction: {
          // The row exists in Postgres with its own uuid; this local copy only
          // has to be distinct until the next reload replaces it.
          id: generateId("tx"),
          teamId: ctx.team.id,
          userId,
          kind: "injection",
          amount,
          description: `Injected by ${injector?.displayName ?? "the leader"} (leader)`,
          // The authoritative snapshot, straight from app.apply_transaction.
          balanceAfter: result.balanceAfter ?? 0,
          createdAt: new Date().toISOString(),
        },
      });
      return ok;
    },
    [supabase, requireContext, data.users],
  );

  const session = useMemo<TeamSession>(
    () => ({
      status,
      error: loadError,
      teams: myTeams,
      currentUserId,
      setTeamId,
      reload,
      createTeam,
      joinTeamByCode,
    }),
    [
      status,
      loadError,
      myTeams,
      currentUserId,
      setTeamId,
      reload,
      createTeam,
      joinTeamByCode,
    ],
  );

  const value = useMemo<TeamState | null>(() => {
    if (!team || !currentUserId) return null;

    const userById = (userId: string) => data.users.find((u) => u.id === userId);
    // A signed-in user always has a profile row (the Phase 4 signup trigger),
    // so this fallback only guards the frame between a fresh signup and the
    // load that follows it.
    const currentUser: User =
      userById(currentUserId) ??
      ({
        id: currentUserId,
        displayName: "?",
        nameColor: "#909592",
        avatar: "",
      } as User);

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
      // Authorization lives in packages/shared permissions.ts and nowhere else
      // on the client; RLS and the Phase 5 RPCs are its server-side mirror.
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
      addComment,
      createTeam,
      joinTeamByCode,
      kickMember,
      banMember,
      updateTeamSettings,
      deleteTeam,
      leaveTeam,
      updateProfile,
      injectCoins,
    };
  }, [
    data,
    team,
    myTeams,
    currentUserId,
    setTeamId,
    addBet,
    placeWager,
    closeBetEarly,
    resolveBet,
    deleteBet,
    addComment,
    createTeam,
    joinTeamByCode,
    kickMember,
    banMember,
    updateTeamSettings,
    deleteTeam,
    leaveTeam,
    updateProfile,
    injectCoins,
  ]);

  return (
    <TeamSessionContext.Provider value={session}>
      <TeamContext.Provider value={value}>{children}</TeamContext.Provider>
    </TeamSessionContext.Provider>
  );
}

/**
 * The current team and everything scoped to it. Only valid under `TeamGate`,
 * which is what guarantees a loaded world with at least one team — every
 * consumer of this hook renders a team, so a nullable return would buy nothing
 * but a null check per module.
 */
export function useTeam(): TeamState {
  const ctx = useContext(TeamContext);
  if (!ctx) {
    throw new Error(
      "useTeam must be used within a TeamProvider, behind <TeamGate> (no team is loaded)",
    );
  }
  return ctx;
}

/** Load status + the team-independent actions. Valid anywhere under the provider. */
export function useTeamSession(): TeamSession {
  const ctx = useContext(TeamSessionContext);
  if (!ctx) {
    throw new Error("useTeamSession must be used within a TeamProvider");
  }
  return ctx;
}
