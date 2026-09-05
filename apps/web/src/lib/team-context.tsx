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
import {
  EMPTY_TEAM_DATA,
  loadTeamData,
  type OnboardingInfo,
  type TeamData,
} from "@/lib/data/team-data";
import { reportConsistency } from "@/lib/data/consistency-guard";
import * as db from "@/lib/data/team-mutations";
import * as betDb from "@/lib/data/bet-mutations";
import { fail, ok, type MutationResult } from "@/lib/data/result";

export type { MutationResult } from "@/lib/data/result";
export type { OnboardingInfo, ProfilePrefill } from "@/lib/data/team-data";

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
  // Every mutator writes to Postgres first (its RPC, or the policy behind its
  // table write) and only then applies the same change locally, so what the
  // screen shows is what the database accepted. Since roadmap Phase 7 that has
  // no exceptions left: resolveBet pays out through `resolve_bet` and
  // addComment inserts into `comments`, which is why both are async now.
  addBet: (draft: NewBetDraft) => Promise<MutationResult>;
  placeWager: (
    betId: string,
    optionId: string,
    amount: number,
  ) => Promise<MutationResult>;
  closeBetEarly: (betId: string) => Promise<MutationResult>;
  deleteBet: (betId: string) => Promise<MutationResult>;
  resolveBet: (betId: string, resolution: BetResolution) => Promise<MutationResult>;
  addComment: (betId: string, body: string) => Promise<MutationResult>;
  createTeam: (draft: TeamDraft) => Promise<MutationResult>;
  joinTeamByCode: (code: string) => Promise<MutationResult>;
  kickMember: (userId: string) => Promise<MutationResult>;
  banMember: (userId: string) => Promise<MutationResult>;
  updateTeamSettings: (settings: { accessMode: TeamAccessMode }) => Promise<MutationResult>;
  deleteTeam: () => Promise<MutationResult>;
  leaveTeam: () => Promise<MutationResult>;
  updateProfile: (draft: ProfileDraft) => Promise<MutationResult>;
  injectCoins: (userId: string, amount: number) => Promise<MutationResult>;
  /**
   * Roadmap Phase 7.5. `onboardedAt === null` is the whole gate condition —
   * the first-run profile step is owed — and `prefill` is what decides which of
   * its two actions is primary (see `components/onboarding/profile-step.tsx`).
   */
  onboarding: OnboardingInfo;
  /**
   * Finish the first-run step. With a draft it saves the profile AND stamps
   * `onboarded_at` in one update; with `null` it stamps only (the skip). Both
   * complete the step — a screen that comes back until it is satisfied is
   * nagware, and re-firing would corrupt the Phase 9 funnel.
   */
  completeOnboarding: (draft: ProfileDraft | null) => Promise<MutationResult>;
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
  | { type: "complete-onboarding"; userId: string; onboardedAt: string }
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
      // deltas undo its money effects. Since Phase 6 they arrive from the
      // delete_bet RPC — the reversal Postgres actually applied — rather than
      // being recomputed here from settlement.ts.
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
    case "complete-onboarding":
      // Phase 7.5: the gate reads this, so the step falls away without a
      // refetch. Any profile fields saved alongside it arrive as their own
      // "update-user" — this action carries the stamp and nothing else.
      return {
        ...data,
        onboarding: {
          ...data.onboarding,
          [action.userId]: {
            prefill: data.onboarding[action.userId]?.prefill ?? "derived",
            onboardedAt: action.onboardedAt,
          },
        },
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
   * between accounts, and after the two mutations that change which teams the
   * user belongs to (create/join a team) — those re-scope everything.
   *
   * Every other mutation applies its own local change instead — an ordinary
   * avoid-a-round-trip decision now that Phase 7 has put the last two
   * session-local mutators (resolveBet, addComment) on Postgres: a reload
   * after any of them would return exactly what is already on screen.
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

  /**
   * DOM-022 / A-2 / decision §4.3: the daily reward is claimed lazily, on team
   * load, once per (user, team, calendar day). "Once" is the database's word —
   * `claim_daily_reward` is idempotent against a unique index — so the ref
   * below is only there to keep a re-render from issuing a round trip that is
   * already known to return nothing.
   *
   * It runs per team rather than once per session because balances are
   * per-team (DOM-013): switching to a team you have not opened today owes you
   * that team's reward.
   */
  const claimedRewards = useRef(new Set<string>());
  useEffect(() => {
    if (!currentUserId || !team) return;
    const key = `${currentUserId}:${team.id}`;
    if (claimedRewards.current.has(key)) return;
    claimedRewards.current.add(key);

    const teamId = team.id;
    void (async () => {
      const result = await db.claimDailyReward(supabase, teamId);
      // A failure here is not worth a visible error: the reward is a gift, and
      // the next load asks again. Let the ref forget so it does.
      if (!result.ok) {
        claimedRewards.current.delete(key);
        return;
      }
      if (!result.reward) return;
      dispatch({
        type: "add-transaction",
        transaction: {
          id: result.reward.transactionId,
          teamId,
          userId: currentUserId,
          kind: "daily-reward",
          amount: result.reward.amount,
          description: "Daily login reward",
          balanceAfter: result.reward.balanceAfter,
          createdAt: result.reward.createdAt,
        },
      });
    })();
  }, [supabase, currentUserId, team]);

  /**
   * The consistency guard (Phase 7, task 3). Stored balances are the model
   * (decision §4.6), so nothing structurally forces them to match the events
   * behind them; in development this recomputes what they ought to be and
   * complains when they do not. Keyed on `data` rather than on the load, so it
   * covers the local patches every mutator applies as well as what Postgres
   * returned.
   */
  useEffect(() => {
    if (status !== "ready" || !currentUserId) return;
    reportConsistency(data, currentUserId);
  }, [data, status, currentUserId]);

  const requireContext = useCallback(
    (): { team: Team; userId: string } | null =>
      team && currentUserId ? { team, userId: currentUserId } : null,
    [team, currentUserId],
  );

  // --- bet lifecycle: real Postgres writes (roadmap Phase 6) ---

  /**
   * DOM-007/008/009/017. The client still runs validateBetDraft and
   * canCreateBet first so a bad draft never leaves the modal, but neither is
   * the enforcement: `create_bet` re-checks both, and it is the only thing
   * that can enforce the two-option floor, which spans two tables.
   */
  const addBet = useCallback(
    async (draft: NewBetDraft): Promise<MutationResult> => {
      const ctx = requireContext();
      if (!ctx) return fail("Team not found.");
      if (!permitCreateBet(ctx.team, ctx.userId)) {
        return fail("Only the leader or moderators can create bets in this team.");
      }
      const firstIssue = validateBetDraft(draft, Date.now())[0];
      if (firstIssue) return fail(firstIssue.message);

      const result = await betDb.createBet(supabase, {
        teamId: ctx.team.id,
        title: draft.title,
        iconEmoji: draft.iconEmoji,
        options: draft.options,
        closesAt: draft.closesAt,
        maxWagerPerUser: draft.maxWagerPerUser,
      });
      if (!result.ok || !result.bet) {
        return result.ok ? fail("Could not create the bet.") : result;
      }

      // Labels are trimmed and blank slots dropped the same way create_bet
      // did before inserting, so these line up with the returned option ids.
      const labels = draft.options
        .map((label) => label.trim())
        .filter((label) => label.length > 0);
      const bet: Bet = {
        id: result.bet.betId,
        teamId: ctx.team.id,
        creatorId: ctx.userId,
        title: draft.title.trim(),
        iconEmoji: draft.iconEmoji?.trim() || undefined,
        options: labels.map((label, index) => ({
          id: result.bet!.optionIds[index],
          label,
        })),
        state: "open",
        closesAt: result.bet.closesAt,
        maxWagerPerUser: draft.maxWagerPerUser,
        createdAt: result.bet.createdAt,
      };
      dispatch({ type: "add-bet", bet });
      return ok;
    },
    [supabase, requireContext],
  );

  /**
   * DOM-013/014/016/017 + DOM-012. The gating below is the same set of shared
   * checks `place_wager` performs, run here first so the modal can say why
   * before a round trip — but the debit and the limits are decided server-side
   * (the exit criterion for this phase is exactly that).
   */
  const placeWager = useCallback(
    async (
      betId: string,
      optionId: string,
      amount: number,
    ): Promise<MutationResult> => {
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

      const result = await betDb.placeWager(supabase, {
        betId: bet.id,
        optionId,
        amount,
      });
      if (!result.ok || !result.wager) {
        return result.ok ? fail("Could not place the wager.") : result;
      }

      dispatch({
        type: "place-wager",
        teamId: team.id,
        wager: {
          id: result.wager.wagerId,
          betId: bet.id,
          userId: member.userId,
          optionId,
          amount,
          placedAt: result.wager.placedAt,
        },
      });
      return ok;
    },
    [supabase, data.bets, data.teams, data.wagers, currentUserId],
  );

  /** DOM-011/DOM-012: creator or moderator, and only while it is really open. */
  const closeBetEarly = useCallback(
    async (betId: string): Promise<MutationResult> => {
      const bet = data.bets.find((b) => b.id === betId);
      if (!bet) return fail("This bet no longer exists.");
      const team = data.teams.find((t) => t.id === bet.teamId);
      if (!team || !currentUserId) return fail("Team not found.");
      if (!permitCloseBetEarly(team, currentUserId, bet)) {
        return fail("Only the bet creator or a moderator can close betting early.");
      }
      const effectiveState = computeEffectiveState(bet, Date.now());
      if (!canTransitionBetState(effectiveState, "closed")) {
        return fail(
          effectiveState === "resolved"
            ? "This bet is already resolved."
            : "Betting is already closed.",
        );
      }

      const result = await betDb.closeBetEarly(supabase, bet.id);
      if (!result.ok || !result.closedAt) {
        return result.ok ? fail("Could not close the bet.") : result;
      }

      // DOM-012: closesAt is exactly when open→closed happened, and the value
      // that lands here is the server's — the browser clock never writes it.
      dispatch({
        type: "close-bet",
        betId: bet.id,
        closedAt: result.closedAt,
      });
      return ok;
    },
    [supabase, data.bets, data.teams, currentUserId],
  );

  /**
   * DOM-016/018/019: the payout, for real (roadmap Phase 7). `resolve_bet`
   * moves the state, the resolution columns and every wagerer's stored balance
   * and P/L in one transaction, and hands back the deltas it applied — the
   * same SQL twin of settleBet that `delete_bet` would later unwind, so the
   * two can never disagree. No ledger rows: resolution is not a transfer
   * (decision §4.6).
   *
   * The stored state may still read 'open' for a bet whose closes_at has
   * passed — nothing persists that transition on its own — which is why the
   * gate below is computeEffectiveState and not `bet.state`. The RPC writes
   * the missing open→closed step itself before resolving.
   */
  const resolveBet = useCallback(
    async (betId: string, resolution: BetResolution): Promise<MutationResult> => {
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

      const result = await betDb.resolveBet(supabase, { betId: bet.id, resolution });
      if (!result.ok) return result;

      dispatch({
        type: "resolve-bet",
        teamId: bet.teamId,
        betId: bet.id,
        resolution,
        deltas: result.deltas ?? [],
      });
      return ok;
    },
    [supabase, data.bets, data.teams, currentUserId],
  );

  /**
   * DOM-033/034: hard delete. The bet, its options, its wagers and its
   * comments go by ON DELETE CASCADE; the money is unwound by the SQL twin of
   * settlement.ts's reverseBet and the deltas it actually applied come back,
   * so the balances on screen are the ones Postgres wrote.
   */
  const deleteBet = useCallback(
    async (betId: string): Promise<MutationResult> => {
      const bet = data.bets.find((b) => b.id === betId);
      if (!bet) return fail("This bet no longer exists.");
      const team = data.teams.find((t) => t.id === bet.teamId);
      if (!team || !currentUserId) return fail("Team not found.");
      if (!permitDeleteBet(team, currentUserId, bet)) {
        return fail("Only the bet creator or a moderator can delete this bet.");
      }

      const result = await betDb.deleteBet(supabase, bet.id);
      if (!result.ok) return result;

      dispatch({
        type: "delete-bet",
        teamId: bet.teamId,
        betId: bet.id,
        deltas: result.deltas ?? [],
      });
      return ok;
    },
    [supabase, data.bets, data.teams, currentUserId],
  );

  /**
   * UX-018 + DOM-030: any member of the bet's team, no content filtering.
   * Persisted since roadmap Phase 7 — a plain insert, because
   * `comments_insert_own` already states the whole rule and DOM-030 rules out
   * the moderation surface that would justify an RPC. The id and timestamp
   * come back from the row so the thread does not re-sort on the next reload.
   */
  const addComment = useCallback(
    async (betId: string, body: string): Promise<MutationResult> => {
      const bet = data.bets.find((b) => b.id === betId);
      if (!bet) return fail("This bet no longer exists.");
      const team = data.teams.find((t) => t.id === bet.teamId);
      if (!team || !currentUserId || !permitComment(team, currentUserId)) {
        return fail("Only team members can comment on this bet.");
      }
      const firstIssue = validateCommentBody(body)[0];
      if (firstIssue) return fail(firstIssue.message);

      const result = await betDb.addComment(supabase, {
        betId: bet.id,
        userId: currentUserId,
        body: body.trim(),
      });
      if (!result.ok || !result.comment) {
        return result.ok ? fail("Could not post the comment.") : result;
      }

      dispatch({
        type: "add-comment",
        comment: {
          id: result.comment.id,
          betId: bet.id,
          userId: currentUserId,
          body: body.trim(),
          createdAt: result.comment.createdAt,
        },
      });
      return ok;
    },
    [supabase, data.bets, data.teams, currentUserId],
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

  /**
   * Roadmap Phase 7.5: the first-run profile step's one exit, both ways out.
   *
   * A draft saves and stamps in a single UPDATE (see db.updateProfile); `null`
   * is the skip and stamps only, changing nothing about the profile. Both come
   * back through the same local dispatch, so the gate falls away on the same
   * render either way.
   *
   * A save that fails leaves `onboarded_at` NULL, which is correct: the step is
   * still owed, and the user still has the skip. It must never trap them.
   */
  const completeOnboarding = useCallback(
    async (draft: ProfileDraft | null): Promise<MutationResult> => {
      if (!currentUserId) return fail("You must be signed in.");
      const user = data.users.find((u) => u.id === currentUserId);
      if (!user) return fail("Profile not found.");

      const onboardedAt = new Date().toISOString();

      if (draft) {
        const firstIssue = validateProfileDraft(draft)[0];
        if (firstIssue) return fail(firstIssue.message);

        const result = await db.updateProfile(supabase, currentUserId, draft, {
          onboardedAt,
        });
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
      } else {
        const result = await db.markOnboarded(supabase, currentUserId, onboardedAt);
        if (!result.ok) return result;
      }

      dispatch({ type: "complete-onboarding", userId: currentUserId, onboardedAt });
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
      // Same unreachable frame as the `currentUser` fallback above — a member
      // of a team whose own profile row is missing contradicts the
      // `team_members.user_id` foreign key. If it ever happened, showing a
      // step that skips in one click is the harmless direction.
      onboarding: data.onboarding[currentUserId] ?? {
        onboardedAt: null,
        prefill: "derived" as const,
      },
      completeOnboarding,
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
    completeOnboarding,
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
