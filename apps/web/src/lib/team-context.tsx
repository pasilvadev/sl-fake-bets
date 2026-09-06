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
  validateChatMessage,
  validateCommentBody,
  validateInjection,
  validateInviteCode,
  validateProfileDraft,
  validateTeamDraft,
  validateWager,
  type Bet,
  type BetResolution,
  type ChatMessage,
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
import { trackSignupCompleted } from "@/lib/analytics";
import { useAuth } from "@/lib/auth-context";
import {
  EMPTY_TEAM_DATA,
  fetchBet,
  loadTeamData,
  toComment,
  toResolution,
  toWager,
  type OnboardingInfo,
  type TeamData,
} from "@/lib/data/team-data";
import {
  subscribeBetChannel,
  subscribeTeamChannel,
  type RemoteEvent,
} from "@/lib/data/realtime";
import { reportConsistency } from "@/lib/data/consistency-guard";
import * as db from "@/lib/data/team-mutations";
import * as betDb from "@/lib/data/bet-mutations";
import * as chatDb from "@/lib/data/chat";
import {
  readChatSeen,
  writeChatSeen,
  type ChatSeenMarker,
} from "@/lib/chat-seen";
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

/**
 * Team chat's exposed slice (UX-019, Extra Phase 1) — everything a chat
 * surface (the rail module, the modal, the mobile chip strip) needs for the
 * CURRENT team, already derived from the store's two seen markers. See the
 * `chatReducer`/`ChatSlice` comment block further down for `seenAtOpen` vs
 * `seenLive` in full; the short version, because both fields below are built
 * from that pair and nothing else:
 *
 *   `unreadCount`   — vs the LIVE marker (D2). The rail-header count and the
 *                     mobile chip's dot; both must actually drop to zero the
 *                     moment `markChatSeen()` fires, which is the one thing
 *                     `firstUnreadId` below must NOT do.
 *   `firstUnreadId` — vs the marker AS OF OPEN (D2), frozen for the life of
 *                     this team's chat session. The `NEW` divider's row id;
 *                     it must not move every time `unreadCount` does, or a
 *                     member mid-scrollback would watch the divider jump or
 *                     vanish out from under them while they are still
 *                     reading toward it.
 *
 * Neither field is ever "everything is unread." With no marker at all — a
 * private window, cleared storage, the first time this device has ever
 * opened this team's chat — both derive to the empty case:
 * `firstUnreadId: null`, `unreadCount: 0`. A channel with three years of
 * history is not a wall of NEW just because this browser has no memory of it.
 */
export interface ChatState {
  /** ASCENDING (oldest first) — the order both the rail and the modal render. */
  messages: ChatMessage[];
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  hasMore: boolean;
  unreadCount: number;
  firstUnreadId: string | null;
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
  // --- team chat (UX-019, Extra Phase 1) ---
  //
  // A team-wide channel, distinct from the per-bet comments just above: chat
  // is team-scoped and lives on the dashboard, comments are bet-scoped and
  // live on the bet page — neither replaces the other and they share no
  // table. ARC-014/DOM-030 boundary, stated once for this whole group:
  // nothing below ever produces a push, an email, a `document.title` count,
  // or any other notification, and no control anywhere lets a member hide,
  // flag, or delete anyone else's message — the only per-row action a member
  // has is sending their own.
  /**
   * The current team's live chat slice — messages, load status, and the two
   * D2 markers already resolved into `unreadCount`/`firstUnreadId` (see
   * `ChatState` above). Deliberately NOT a `TeamData`/`bets`/`comments`
   * field: chat lives in its own store, loaded lazily by `loadChat` below,
   * precisely so `loadTeamData` keeps its nine queries — a HARD requirement
   * (roadmap §8 Extra Phase 1 task 7), not a preference, and one of the
   * phase's own exit criteria tests exactly this.
   */
  chat: ChatState;
  /**
   * Lazily loads this team's most recent page of chat (D4,
   * `CHAT_RAIL_PAGE_SIZE` rows). Idempotent per team: a no-op unless
   * `chat.status === "idle"` for the CURRENT team, because both the rail
   * module and the mobile chip strip call this on mount and neither may
   * assume it is the only caller.
   */
  loadChat: () => Promise<void>;
  /**
   * Pages one older `CHAT_MODAL_PAGE_SIZE` batch back with the stored keyset
   * cursor and PREPENDS it, still ascending. A no-op when `!chat.hasMore` or
   * a page is already in flight (D4: the "See earlier messages" control and
   * the modal's scroll-to-top both call this against the one shared slice).
   */
  loadEarlierChat: () => Promise<void>;
  /**
   * Sends one message, optimistically: `validateChatMessage` first, then an
   * immediate optimistic row under a CLIENT-generated id (so the realtime
   * echo of this very send dedupes by that id — see `lib/data/chat.ts`'s
   * header), then the real insert. On success the optimistic row's
   * `createdAt` is patched to the server's clock; on failure the optimistic
   * row is REMOVED and the sentence is returned — never leaves a message on
   * screen that is not in the table. The toast is the caller's job.
   */
  sendChatMessage: (body: string) => Promise<MutationResult>;
  /**
   * Advances the LIVE seen marker (D2) to the newest held message and
   * persists it via `writeChatSeen` — plain, synchronous, and a no-op when
   * there are no messages yet. The rule this enforces on the caller's
   * behalf, stated once here because `lib/chat-seen.ts` deliberately does
   * not enforce it itself: call this ONLY while the chat surface is VISIBLE
   * and SCROLLED TO THE BOTTOM, never on mount — a rail that is merely
   * present on screen must not silently mark days of backlog read.
   */
  markChatSeen: () => void;
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
      // The id guard is Phase 8's: Realtime delivers at least once, and the
      // client that created the bet also receives its own INSERT event. Every
      // insert action below is idempotent on the row id for the same reason —
      // it is cheaper to state that here, once, than to trust five callers.
      if (data.bets.some((b) => b.id === action.bet.id)) return data;
      return { ...data, bets: [...data.bets, action.bet] };
    case "place-wager": {
      // The stake leaves the balance at placement (decision §4.6 money model).
      const { wager } = action;
      if (data.wagers.some((w) => w.id === wager.id)) return data;
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
      if (data.comments.some((c) => c.id === action.comment.id)) return data;
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

// =============================================================================
// Team chat's OWN store — roadmap §8 Extra Phase 1, task 7 (store half) and
// task 9 (catch-up markers). This is a SECOND, independent `useReducer`
// inside `TeamProvider` below, not a slice of `TeamData`/`teamDataReducer`
// above, and that separation is a HARD REQUIREMENT the phase plan states
// explicitly, not a stylistic preference:
//
//   `loadTeamData` (team-data.ts) is already nine unbounded queries and this
//   app's named egress weakness (design-scale-and-free-tier.md §2.2/§4.1). A
//   tenth query for `chat_messages` — a table with no natural row ceiling
//   other than the 30-day retention window (D1) — would make every sign-in,
//   every team switch, and every realtime-recovery `reload()` (this file's
//   `onResubscribe`) pay for up to 30 days of scrollback whether or not a
//   chat surface is even mounted that render. So chat is NOT a `TeamData`
//   field, the `"replace"` action above never touches it, and this module is
//   not imported by `loadTeamData`'s call site. One of this phase's own exit
//   criteria is literally "`loadTeamData` still issues its nine queries —
//   chat is not one of them," and folding this reducer into the one above
//   would fail that criterion even if every pixel still looked right.
//
//   Instead, chat loads LAZILY: `loadChat` (below, in `TeamProvider`) is a
//   no-op until some chat surface — the rail, the modal, the mobile chip
//   strip — actually calls it, which is why `ChatSlice.status` starts at
//   `"idle"` rather than `"loading"`: nothing is owed until a surface asks.
// =============================================================================

/**
 * True when `message` is strictly newer than `marker` — compared as the pair
 * `(createdAt, id)`, never `createdAt` alone. Two messages CAN share a
 * millisecond, and the keyset index this table is built around
 * (`(team_id, created_at desc, id desc)`, 20260906120000_team_chat.sql)
 * already assumes that tie-break; every "is this unread" comparison in this
 * file uses the identical two-key order so a tie resolves the same way here
 * as it would in a page fetched from Postgres.
 */
function isAfterMarker(message: ChatMessage, marker: ChatSeenMarker): boolean {
  if (message.createdAt !== marker.createdAt) {
    return message.createdAt > marker.createdAt;
  }
  return message.id > marker.messageId;
}

/**
 * The chat store's internal shape — a superset of the `ChatState` the
 * provider exposes on `TeamState.chat`. The fields below never leave this
 * file; the `value` memo in `TeamProvider` derives the public shape from
 * them.
 *
 *   `teamId`      — which team this slice's data belongs to. Every async
 *                   mutator below reads the CURRENT team id off `teamIdRef`
 *                   (never this field, and never a closed-over `team`)
 *                   before acting, and compares the two again after an
 *                   `await` to DISCARD a response that lands after a team
 *                   switch (task 7: "dropped and refetched on team switch")
 *                   rather than commit it to the wrong team's slice.
 *   `cursor`      — the oldest loaded row's keyset position; the next
 *                   `before` that `loadEarlierChat` will send.
 *   `loadingMore` — guards `loadEarlierChat` against a second page request
 *                   while one is already in flight.
 *   `seenAtOpen`  — D2's FROZEN marker. Read once, from `readChatSeen`, the
 *                   moment `loadChat` first succeeds for this team, and
 *                   never updated again until the NEXT team switch re-reads
 *                   it. `firstUnreadId` derives from this alone, on purpose:
 *                   a divider that recomputed every time the LIVE marker
 *                   advanced would jump or vanish out from under a member
 *                   who is still reading toward it.
 *   `seenLive`    — D2's LIVE marker. Starts equal to `seenAtOpen` (both
 *                   come from the very same `readChatSeen` call) and moves
 *                   only when `markChatSeen()` fires. `unreadCount` derives
 *                   from THIS one, so it actually reaches zero once the
 *                   surface is read — the one job `seenAtOpen` must never
 *                   do, or the divider's position would move under the
 *                   reader.
 *
 * Two markers, not one, is the whole point of D2 (plan task 9, "Catch-up"):
 * one field frozen for a stable divider, one field live for an accurate
 * badge. A single marker would force a choice between a divider that jumps
 * mid-read and a count that never clears; this store's job is to not have
 * to make that choice.
 */
interface ChatSlice {
  teamId: string | null;
  status: ChatState["status"];
  error: string | null;
  /** ASCENDING (oldest first) — the order both the rail and the modal render. */
  messages: ChatMessage[];
  hasMore: boolean;
  cursor: chatDb.ChatPageCursor | null;
  loadingMore: boolean;
  seenAtOpen: ChatSeenMarker | null;
  seenLive: ChatSeenMarker | null;
}

const EMPTY_CHAT_SLICE: ChatSlice = {
  teamId: null,
  status: "idle",
  error: null,
  messages: [],
  hasMore: false,
  cursor: null,
  loadingMore: false,
  seenAtOpen: null,
  seenLive: null,
};

type ChatAction =
  /** UX-010's full re-scope (task 7: "dropped and refetched on team switch"):
   * drop everything back to idle/empty for the (possibly null) new team.
   * Both markers are re-read from scratch the next time `loadChat` succeeds
   * for it — nothing here re-reads them itself, since chat stays lazy even
   * across a team switch. */
  | { type: "reset"; teamId: string | null }
  | { type: "loading" }
  | { type: "error"; error: string }
  | {
      type: "loaded";
      messages: ChatMessage[];
      hasMore: boolean;
      cursor: chatDb.ChatPageCursor | null;
      seenAtOpen: ChatSeenMarker | null;
      seenLive: ChatSeenMarker | null;
    }
  | {
      type: "prepend";
      messages: ChatMessage[];
      hasMore: boolean;
      cursor: chatDb.ChatPageCursor | null;
    }
  | { type: "loading-more"; loading: boolean }
  | { type: "send-optimistic"; message: ChatMessage }
  | { type: "send-settled"; id: string; createdAt: string }
  | { type: "send-failed"; id: string }
  | { type: "remote-insert"; message: ChatMessage }
  | { type: "mark-seen"; marker: ChatSeenMarker };

function chatReducer(state: ChatSlice, action: ChatAction): ChatSlice {
  switch (action.type) {
    case "reset":
      return { ...EMPTY_CHAT_SLICE, teamId: action.teamId };
    case "loading":
      // The real idempotency guard lives in `loadChat` — it checks BEFORE
      // dispatching this — but a defensive no-op here means a stray second
      // "loading" action can never regress an already "ready"/"error" slice
      // and lose its messages or its error sentence.
      return state.status === "idle"
        ? { ...state, status: "loading", error: null }
        : state;
    case "error":
      return { ...state, status: "error", error: action.error };
    case "loaded":
      return {
        ...state,
        status: "ready",
        error: null,
        messages: action.messages,
        hasMore: action.hasMore,
        cursor: action.cursor,
        seenAtOpen: action.seenAtOpen,
        seenLive: action.seenLive,
      };
    case "prepend": {
      // Dedupe on id (task 7's paging): a page fetched just as a remote
      // insert or this member's own optimistic send landed could otherwise
      // double a row.
      const known = new Set(state.messages.map((m) => m.id));
      const fresh = action.messages.filter((m) => !known.has(m.id));
      return {
        ...state,
        messages: [...fresh, ...state.messages],
        hasMore: action.hasMore,
        cursor: action.cursor,
        loadingMore: false,
      };
    }
    case "loading-more":
      return { ...state, loadingMore: action.loading };
    case "send-optimistic":
      if (state.messages.some((m) => m.id === action.message.id)) return state;
      return { ...state, messages: [...state.messages, action.message] };
    case "send-settled":
      // Patches the optimistic row's createdAt to the server's clock (task
      // 8) — the id is the very one the caller minted, so this can't miss.
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === action.id ? { ...m, createdAt: action.createdAt } : m,
        ),
      };
    case "send-failed":
      // Task 8's hard rule: never leave a message on screen that is not in
      // the table. Removed by id, never by matching body text.
      return {
        ...state,
        messages: state.messages.filter((m) => m.id !== action.id),
      };
    case "remote-insert":
      // The universal receive rule (see applyRemote's "chat-insert" case
      // below): ignore any id already held. This is what makes the sender's
      // own realtime echo of their optimistic row, and any replay out of the
      // reload-race queue, a no-op instead of a second copy of one message.
      if (state.messages.some((m) => m.id === action.message.id)) return state;
      return { ...state, messages: [...state.messages, action.message] };
    case "mark-seen":
      // Only `seenLive` moves here — `seenAtOpen` is frozen for the life of
      // this team's chat session (see the ChatSlice doc comment above).
      return { ...state, seenLive: action.marker };
  }
}

const TeamContext = createContext<TeamState | null>(null);
const TeamSessionContext = createContext<TeamSession | null>(null);

/**
 * Roadmap Phase 8. The bet-detail page owns a channel of its own — one open
 * bet's comment thread — but not the state it feeds, which is the reducer up
 * here. This context is the whole seam: subscribe, get a teardown back.
 */
interface TeamRealtime {
  subscribeBet: (betId: string) => () => void;
}
const TeamRealtimeContext = createContext<TeamRealtime | null>(null);

export function TeamProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const currentUserId = user?.id ?? null;
  const supabase = useMemo(() => createClient(), []);

  const [data, dispatch] = useReducer(teamDataReducer, EMPTY_TEAM_DATA);
  // Team chat's own store (Extra Phase 1) — see the big comment above
  // `chatReducer` for why this is a second, independent `useReducer` rather
  // than a field folded into `data` above.
  const [chatSlice, dispatchChat] = useReducer(chatReducer, EMPTY_CHAT_SLICE);
  const [status, setStatus] = useState<TeamSession["status"]>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentTeamId, setCurrentTeamId] = useState<string | null>(null);

  const setTeamId = useCallback((id: string) => {
    setCurrentTeamId(id);
  }, []);

  /**
   * The realtime handlers' view of the current world (roadmap Phase 8).
   *
   * A ref rather than the `data` closure: the channels must be created once per
   * team and torn down once, so their handlers cannot re-close over every
   * render's state without resubscribing on every keystroke of activity.
   */
  const dataRef = useRef(data);
  // Synced in an effect, not during render: effects run on commit, and the
  // only things that read this ref are network callbacks, which cannot fire
  // before the commit that produced the state they would read.
  useEffect(() => {
    dataRef.current = data;
  }, [data]);
  /**
   * Same discipline as `dataRef` immediately above, for team chat (Extra
   * Phase 1): `chatRef` gives `applyRemote`'s "chat-insert" case, `loadChat`
   * and `loadEarlierChat` a way to read the CURRENT chat slice without
   * putting `chatSlice` in any of their dependency arrays.
   *
   * `teamIdRef` does the equivalent job for "which team is current." It is
   * not merely a convenience: `applyRemote` (below) is deliberately
   * `[supabase]`-stable, because the same callback (via `handleRemote`) is
   * also what `TeamRealtime.subscribeBet` binds for the bet-page channel.
   * Adding a value that changes on every team switch to `applyRemote`'s
   * dependency list would recreate it on every switch, and recreating it
   * would tear down and rebuild that unrelated bet-page channel too, for a
   * team change it has no stake in.
   */
  const chatRef = useRef(chatSlice);
  useEffect(() => {
    chatRef.current = chatSlice;
  }, [chatSlice]);
  const teamIdRef = useRef<string | null>(null);
  const reloadInFlight = useRef(false);
  const pendingRemote = useRef<RemoteEvent[]>([]);
  const [flushTick, setFlushTick] = useState(0);

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
    // Phase 8, task 3: a realtime event that lands while these nine queries are
    // in flight would be applied to a world the snapshot is about to overwrite,
    // and the snapshot may predate the event. Queue instead, and replay after
    // the replace — the id guards make a replay of something the snapshot
    // already contains a no-op.
    reloadInFlight.current = true;
    const { data: loaded, error } = await loadTeamData(supabase);
    reloadInFlight.current = false;
    if (error) {
      setLoadError(error);
      setStatus("error");
      setFlushTick((t) => t + 1);
      return;
    }
    dispatch({ type: "replace", data: loaded });
    setLoadError(null);
    setStatus("ready");
    setFlushTick((t) => t + 1);
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

  /**
   * Metric 2's conversion event (ARC-017, roadmap Phase 9 task 1): this
   * identity is brand new.
   *
   * `onboarded_at IS NULL` is the signal, and it is the only durable one the
   * client has. "The auth state just changed to signed-in" cannot tell a signup
   * apart from the returning user ARC-007 works hard to keep signed in, and a
   * localStorage marker would be per-device rather than per-account. The stamp
   * is written exactly once per account, by either exit from the Phase 7.5
   * profile step, so an account is in this state for precisely its first run.
   *
   * It sits in the provider rather than in `OnboardingGate` because the
   * provider is mounted on every route — someone who signs up through an
   * invite link is on `/join/[code]`, which never mounts that gate. The insert
   * is fire-and-forget and the metric counts distinct users, so a reload
   * during first run costs a duplicate row and changes no number.
   */
  useEffect(() => {
    if (status !== "ready" || !currentUserId) return;
    const mine = data.onboarding[currentUserId];
    if (mine && mine.onboardedAt === null) trackSignupCompleted(currentUserId);
  }, [status, currentUserId, data.onboarding]);

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

  // --- realtime propagation (roadmap Phase 8) ---------------------------------

  /**
   * Turn one Postgres Changes event into the same local action the acting
   * client already dispatches for it (ARC-005 / UX-013 / UX-018).
   *
   * Two invariants hold every case together:
   *
   *   * **Apply the payload, never refetch the world.** The only read in here
   *     is `fetchBet` — one row — and it exists because a `bets` INSERT arrives
   *     without its options. Answering events with `reload()` would cost more
   *     than the polling Realtime replaced (design-realtime.md §2).
   *   * **Ignore any id you do not already hold.** That single rule does three
   *     jobs at once: it drops the DELETE events RLS cannot filter (§4.3), it
   *     drops the client's own echo of a change it has already applied — which
   *     is what keeps money from moving twice — and it makes at-least-once
   *     delivery harmless.
   *
   * Balances move here without `team_members` ever being subscribed (§5 rule
   * 3): a resolution or a deletion carries enough to recompute the same deltas
   * Postgres applied, through the same `settleBet` / `reverseBet` the RPCs are
   * SQL twins of.
   *
   * Extra Phase 1 (UX-019) adds a fourth event, `chat-insert` — see that case
   * below for the two EXTRA guards it needs beyond the two invariants above
   * (a team-id check and an idle check, neither of which any other case
   * needs). It reads `teamIdRef`/`chatRef` rather than closing over
   * `teamId`/`chatSlice` from the surrounding render, which is what keeps
   * this whole callback `[supabase]`-stable — see those refs' own comment,
   * beside `dataRef`, for why that stability matters for a channel this
   * function has nothing to do with.
   */
  const applyRemote = useCallback(
    async (event: RemoteEvent) => {
      switch (event.kind) {
        case "bet-insert": {
          if (dataRef.current.bets.some((b) => b.id === event.betId)) return;
          const bet = await fetchBet(supabase, event.betId);
          // No rows means RLS said no — a bet in a team this client cannot read.
          if (bet) dispatch({ type: "add-bet", bet });
          return;
        }
        case "bet-update": {
          const bet = dataRef.current.bets.find((b) => b.id === event.row.id);
          if (!bet) return;
          const resolution = toResolution(event.row);
          if (event.row.state === "resolved" && bet.state !== "resolved") {
            if (!resolution) return;
            dispatch({
              type: "resolve-bet",
              teamId: bet.teamId,
              betId: bet.id,
              resolution,
              // The deltas `resolve_bet` wrote, recomputed rather than shipped:
              // the RPC is settleBet's SQL twin over the same wagers, and this
              // client holds those wagers because they arrived on this channel.
              deltas: settleBet(bet, dataRef.current.wagers, resolution),
            });
            return;
          }
          // DOM-012: an early close moves closes_at to when it happened, so the
          // countdown and "closed Xm ago" stay honest on every screen.
          if (event.row.state === "closed" && bet.state === "open") {
            dispatch({
              type: "close-bet",
              betId: bet.id,
              closedAt: event.row.closes_at,
            });
          }
          return;
        }
        case "bet-delete": {
          const bet = dataRef.current.bets.find((b) => b.id === event.betId);
          if (!bet) return;
          dispatch({
            type: "delete-bet",
            teamId: bet.teamId,
            betId: bet.id,
            deltas: reverseBet(bet, dataRef.current.wagers),
          });
          return;
        }
        case "wager-insert": {
          const wager = toWager(event.row);
          const bet = dataRef.current.bets.find((b) => b.id === wager.betId);
          if (!bet) return;
          dispatch({ type: "place-wager", teamId: bet.teamId, wager });
          return;
        }
        case "comment-insert": {
          const comment = toComment(event.row);
          if (!dataRef.current.bets.some((b) => b.id === comment.betId)) return;
          dispatch({ type: "add-comment", comment });
          return;
        }
        case "chat-insert": {
          const row = event.row;
          // Defense in depth, matching this file's practice everywhere
          // else (e.g. `wager-insert` above still checks that this client
          // holds the wager's bet even though RLS already scoped the row):
          // the INSERT binding is already filtered server-side to this team
          // (realtime.ts's own comment on `subscribeTeamChannel` says so),
          // but a server-side filter is not a boundary this file trusts
          // blindly, and the recheck costs one string comparison.
          if (row.team_id !== teamIdRef.current) return;
          // Ignore entirely while this team's chat is "idle" — a real
          // decision, not an omission. `loadChat` has not run yet, so this
          // slice holds no scrollback at all; appending one live message to
          // it would render a thread that starts mid-conversation and looks
          // complete. Nothing is lost: the message is a normal row in
          // `chat_messages`, and it will simply be present the moment
          // `loadChat` performs this team's first `fetchChatPage`.
          if (chatRef.current.status === "idle") return;
          // Id-dedupe is the whole rule (see `lib/data/chat.ts`'s header for
          // why the id is minted client-side, not server-side): it makes
          // the sender's own realtime echo of an optimistic row a no-op,
          // and a replay out of the reload-race queue below equally
          // harmless — no second queue needed for chat.
          dispatchChat({
            type: "remote-insert",
            message: chatDb.toChatMessage(row),
          });
          return;
        }
      }
    },
    [supabase],
  );

  /** Hold events aside while a full load is in flight; see `reload`. */
  const handleRemote = useCallback(
    (event: RemoteEvent) => {
      if (reloadInFlight.current) {
        pendingRemote.current.push(event);
        return;
      }
      void applyRemote(event);
    },
    [applyRemote],
  );

  // Replay what arrived during a load, once the snapshot has been committed —
  // `data` in the deps is what guarantees dataRef is the post-replace world.
  useEffect(() => {
    if (reloadInFlight.current || pendingRemote.current.length === 0) return;
    const queued = pendingRemote.current;
    pendingRemote.current = [];
    for (const event of queued) void applyRemote(event);
  }, [flushTick, data, applyRemote]);

  /**
   * One channel per team, for as long as that team is the current one — the
   * coarse granularity design-stack.md §4 rule 1 and design-realtime.md §5 rule
   * 1 both require. Keyed on the id and not on `team`, whose identity changes
   * with every state patch: a channel that resubscribed on each new wager would
   * drop events in the gap it opened.
   */
  const teamId = team?.id ?? null;

  // Sync the ref `applyRemote`'s "chat-insert" case, `loadChat` and
  // `loadEarlierChat` read for "which team is current" — commit-time only,
  // same discipline as `dataRef`'s own sync effect above.
  useEffect(() => {
    teamIdRef.current = teamId;
  }, [teamId]);

  /**
   * UX-010's full re-scope, task 7 of Extra Phase 1: a team switch —
   * including the very first team resolving after sign-in, and dropping to
   * no team at all — puts chat back to idle/empty. Nothing here re-fetches:
   * chat stays LAZY even across a switch, so the next time a mounted chat
   * surface calls `loadChat` (its own effect fires again because `chat`
   * itself, via this reset, is now a fresh object), it fetches this team's
   * first page and reads both seen markers fresh for this (userId, teamId)
   * pair. An in-flight fetch for the OLD team that resolves after this runs
   * is discarded by `loadChat`/`loadEarlierChat`'s own `teamIdRef` check —
   * this effect's job is only to make sure nothing is left on screen in the
   * meantime that belongs to a team that is no longer current.
   */
  useEffect(() => {
    dispatchChat({ type: "reset", teamId });
  }, [teamId]);

  useEffect(() => {
    if (!currentUserId || !teamId) return;
    const channel = subscribeTeamChannel(supabase, teamId, {
      onEvent: handleRemote,
      // Recovery, not the normal path: the events from the dropped window are
      // gone, so the only way back to a correct world is to fetch it.
      onResubscribe: () => void reload(),
    });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, currentUserId, teamId, handleRemote, reload]);

  const realtime = useMemo<TeamRealtime>(
    () => ({
      subscribeBet: (betId: string) => {
        const channel = subscribeBetChannel(supabase, betId, {
          onEvent: handleRemote,
          onResubscribe: () => void reload(),
        });
        return () => {
          void supabase.removeChannel(channel);
        };
      },
    }),
    [supabase, handleRemote, reload],
  );


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

  // --- team chat: its own store, its own lazy load (roadmap §8 Extra Phase 1) ---
  //
  // UX-019, D1/D2/D4 — see the `chatReducer`/`ChatSlice` comment block above
  // `TeamContext` for D1 (retention shapes why chat stays lazy) and D2 (the
  // two seen markers) in full, and `lib/chat-seen.ts`'s header for D2's
  // whole client-side story; D4 (two surfaces, one store) is why `loadChat`/
  // `loadEarlierChat` below must be safe to call from more than one place at
  // once.
  //
  // ARC-014/DOM-030 boundary, stated once for this
  // whole group: nothing below produces a push, an email, a `document.title`
  // count, or any other notification, and nothing below can hide, flag, or
  // delete anyone else's message — the only per-row action a member has is
  // sending their own.

  /**
   * Lazily loads this team's most recent page of chat (task 7,
   * `CHAT_RAIL_PAGE_SIZE` rows). Idempotent per team: a no-op unless
   * `chatRef.current` is BOTH already scoped to this team (the team-switch
   * reset effect above already ran) AND sitting at `"idle"` — the guard both
   * the rail module and the mobile chip strip lean on, since either one may
   * call this on mount with no way to know whether the other already did.
   *
   * Reads `teamIdRef`/`chatRef` rather than closing over `team`/`chatSlice`,
   * which is what keeps this callback's identity `[supabase,
   * currentUserId]`-stable — there is no reason for the rail module to
   * receive a fresh function reference every time a message arrives.
   */
  const loadChat = useCallback(async () => {
    const forTeamId = teamIdRef.current;
    if (!forTeamId) return;
    if (
      chatRef.current.teamId !== forTeamId ||
      chatRef.current.status !== "idle"
    ) {
      return;
    }
    dispatchChat({ type: "loading" });

    const { page, error } = await chatDb.fetchChatPage(supabase, {
      teamId: forTeamId,
      limit: chatDb.CHAT_RAIL_PAGE_SIZE,
    });

    // The team changed while this fetch was in flight (task 7's own
    // requirement): DISCARD rather than commit a response that no longer
    // belongs to the now-current team. The team-switch effect above already
    // put that team's slice back to idle; a stray "loaded" here would
    // overwrite it with rows for a team nobody is looking at any more.
    if (teamIdRef.current !== forTeamId) return;

    if (error || !page) {
      dispatchChat({ type: "error", error: error ?? "Could not load chat." });
      return;
    }

    // D2: both markers come from the SAME `readChatSeen` call, at the
    // SAME moment. `seenAtOpen` then never moves again until the next team
    // switch re-reads it (see the ChatSlice doc comment above); `seenLive`
    // starts equal but is free to advance the moment `markChatSeen` fires.
    const marker = currentUserId ? readChatSeen(currentUserId, forTeamId) : null;
    dispatchChat({
      type: "loaded",
      messages: page.messages,
      hasMore: page.hasMore,
      cursor: page.cursor,
      seenAtOpen: marker,
      seenLive: marker,
    });
  }, [supabase, currentUserId]);

  /**
   * Pages one older `CHAT_MODAL_PAGE_SIZE` batch back with the stored keyset
   * cursor and PREPENDS it, still ascending (task 7). A no-op when there is
   * no more history, when a page is already in flight, or when the team
   * changed out from under an in-flight page — the same discard rule as
   * `loadChat` just above.
   */
  const loadEarlierChat = useCallback(async () => {
    const forTeamId = teamIdRef.current;
    if (!forTeamId) return;
    const slice = chatRef.current;
    if (slice.teamId !== forTeamId) return;
    if (!slice.hasMore || slice.loadingMore || !slice.cursor) return;

    dispatchChat({ type: "loading-more", loading: true });
    const { page, error } = await chatDb.fetchChatPage(supabase, {
      teamId: forTeamId,
      before: slice.cursor,
      limit: chatDb.CHAT_MODAL_PAGE_SIZE,
    });

    if (teamIdRef.current !== forTeamId) return; // discarded — see loadChat

    if (error || !page) {
      // No dedicated error state for a failed OLDER page: the slice already
      // holds a good, current thread, and regressing the whole-slice
      // `status` to "error" here would hide it behind an error view for a
      // failure that only affects scrollback. Stop the spinner and leave
      // "See earlier messages" in place for another try.
      dispatchChat({ type: "loading-more", loading: false });
      return;
    }

    dispatchChat({
      type: "prepend",
      messages: page.messages,
      hasMore: page.hasMore,
      cursor: page.cursor,
    });
  }, [supabase]);

  /**
   * Sends one message, optimistically (task 8). Membership first, exactly
   * as `addComment` above checks it — `permitComment` is reused rather than
   * inventing a `canChat`-shaped predicate, because DOM-030 gives chat the
   * identical rule comments already have (any team member, no content
   * check): a second name for the same `isMember` test would only be two
   * things to keep in sync instead of one.
   *
   * The id is minted on the CLIENT (`chatDb.newChatMessageId`) before either
   * the optimistic row or the real insert exists, so the realtime echo of
   * this very send — `chat-insert`, applied by `applyRemote` above — dedupes
   * BY ID; see `lib/data/chat.ts`'s header for the full argument. The
   * reducer's `send-optimistic`/`remote-insert` cases are both idempotent on
   * that id, which is what makes the sender's own echo a no-op instead of a
   * second copy of the same message on screen.
   *
   * On success the optimistic row's `createdAt` is patched to the server's
   * clock, never the browser's (see `chat.ts`'s `sendChatMessage`). On
   * failure the optimistic row is REMOVED, not left on screen — the plan is
   * explicit that no message may ever be visible that is not in the table.
   * The toast is the caller's job; this returns the sentence for it to show.
   */
  const sendChatMessage = useCallback(
    async (body: string): Promise<MutationResult> => {
      const ctx = requireContext();
      if (!ctx) return fail("Team not found.");
      if (!permitComment(ctx.team, ctx.userId)) {
        return fail("Only team members can send messages in this team.");
      }
      const firstIssue = validateChatMessage(body)[0];
      if (firstIssue) return fail(firstIssue.message);

      const id = chatDb.newChatMessageId();
      const trimmed = body.trim();
      dispatchChat({
        type: "send-optimistic",
        message: {
          id,
          teamId: ctx.team.id,
          userId: ctx.userId,
          body: trimmed,
          createdAt: new Date().toISOString(),
        },
      });

      const result = await chatDb.sendChatMessage(supabase, {
        id,
        teamId: ctx.team.id,
        userId: ctx.userId,
        body: trimmed,
      });
      if (!result.ok) {
        dispatchChat({ type: "send-failed", id });
        return result;
      }
      // Always present on a successful send (chat.ts selects it back), but
      // guarded rather than asserted: a missing value should degrade to
      // "keep the optimistic timestamp," never throw inside a send path.
      if (result.message) {
        dispatchChat({
          type: "send-settled",
          id,
          createdAt: result.message.createdAt,
        });
      }
      return ok;
    },
    [supabase, requireContext],
  );

  /**
   * Advances the LIVE marker (D2) to the newest held message and
   * persists it via `writeChatSeen`. Plain and synchronous — no round trip,
   * nothing to await — and a no-op when there are no messages, so a surface
   * that renders before `loadChat` resolves can never mark an empty thread
   * seen.
   *
   * The rule this enforces on every caller's behalf, stated once here
   * because `lib/chat-seen.ts` deliberately does not enforce it itself: call
   * this ONLY while the chat surface is VISIBLE and SCROLLED TO THE BOTTOM —
   * never on mount, never from a rail that is merely present on screen. A
   * member who glances at the dashboard and has this fire on mount would
   * have three days of backlog marked seen before reading a word of it.
   */
  const markChatSeen = useCallback(() => {
    const ctx = requireContext();
    if (!ctx) return;
    const messages = chatRef.current.messages;
    const latest = messages[messages.length - 1];
    if (!latest) return;
    const marker: ChatSeenMarker = {
      messageId: latest.id,
      createdAt: latest.createdAt,
    };
    dispatchChat({ type: "mark-seen", marker });
    writeChatSeen(ctx.userId, ctx.team.id, marker);
  }, [requireContext]);

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

    // D2: derived from the two stored markers, never stored directly —
    // see the ChatState/ChatSlice doc comments for why there are two and
    // exactly which one drives which field.
    const firstUnreadId = chatSlice.seenAtOpen
      ? chatSlice.messages.find((m) =>
          isAfterMarker(m, chatSlice.seenAtOpen as ChatSeenMarker),
        )?.id ?? null
      : null;
    const unreadCount = chatSlice.seenLive
      ? chatSlice.messages.filter((m) =>
          isAfterMarker(m, chatSlice.seenLive as ChatSeenMarker),
        ).length
      : 0; // no marker at all => no divider, never "everything is unread"

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
      chat: {
        messages: chatSlice.messages,
        status: chatSlice.status,
        error: chatSlice.error,
        hasMore: chatSlice.hasMore,
        unreadCount,
        firstUnreadId,
      },
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
      loadChat,
      loadEarlierChat,
      sendChatMessage,
      markChatSeen,
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
    chatSlice,
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
    loadChat,
    loadEarlierChat,
    sendChatMessage,
    markChatSeen,
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
      <TeamRealtimeContext.Provider value={realtime}>
        <TeamContext.Provider value={value}>{children}</TeamContext.Provider>
      </TeamRealtimeContext.Provider>
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

/**
 * Subscribe the open bet page to its own comment thread (UX-018) for as long as
 * it is mounted — roadmap Phase 8.
 *
 * A hook rather than something the page assembles itself, because the channel
 * and the store it writes into must not be two decisions: the provider owns
 * both, and the page only says which bet it is showing. Bets and wagers need no
 * hook here — the team channel already carries them into the same store.
 */
export function useLiveBetThread(betId: string): void {
  const realtime = useContext(TeamRealtimeContext);
  useEffect(() => {
    if (!realtime) return;
    return realtime.subscribeBet(betId);
  }, [realtime, betId]);
}
