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
  CONFIG,
  canAcceptDuel as permitAcceptDuel,
  canAcceptWagers,
  canBan as permitBan,
  canCloseBetEarly as permitCloseBetEarly,
  canComment as permitComment,
  canCreateBet as permitCreateBet,
  canDeclineDuel as permitDeclineDuel,
  canDeleteBet as permitDeleteBet,
  canDeleteDuel as permitDeleteDuel,
  canDeleteTeam as permitDeleteTeam,
  canInjectCoins as permitInjectCoins,
  canInvite as permitInvite,
  canJoinTeam as permitJoinTeam,
  canKick as permitKick,
  canLeaveTeam as permitLeaveTeam,
  canManageTeam as permitManageTeam,
  canResolveBet as permitResolveBet,
  canResolveDuel as permitResolveDuel,
  canRevokeInvite as permitRevokeInvite,
  canStartDuel as permitStartDuel,
  canTransitionBetState,
  computeDuelPhase,
  computeEffectiveState,
  deriveStandings,
  effectiveBetState,
  generateId,
  inviteCreationBlocker,
  removeMemberWagersInTeam,
  validateBetDraft,
  validateChatMessage,
  validateCommentBody,
  validateDuelDraft,
  validateInjection,
  validateInviteCode,
  validateProfileDraft,
  validateTeamDraft,
  validateWager,
  voidDuelsForDepartingMember,
  type Bet,
  type BetResolution,
  type BetVoidReason,
  type ChatMessage,
  type Comment,
  type Duel,
  type DuelDraft,
  type MutationErrorCode,
  type ProfileDraft,
  type Team,
  type TeamAccessMode,
  type TeamDraft,
  type TeamInvite,
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
  fetchUser,
  loadTeamData,
  toComment,
  toDuel,
  toMember,
  toResolution,
  toWager,
  type FetchedUser,
  type MemberRow,
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
/**
 * Re-exported so a duel surface never has to import from `lib/data/*` to name
 * the argument of a context mutator (Extra Phase 2). `declineDuel`'s second
 * parameter is deliberately NOT the full `BetVoidReason`: `'mediator'`,
 * `'expired'` and `'participant-left'` are written by the resolver, the sweep
 * and the kick/ban cascade respectively, and none of the three is the
 * challengee's to claim — see `bet-mutations.ts` for the whole argument.
 */
export type { DuelDeclineReason } from "@/lib/data/bet-mutations";

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
 * Payload for `startDuel` (Extra Phase 2, D1/D5/D9) — the shared `DuelDraft`
 * plus the one field the compose form has that the domain draft does not.
 *
 * `iconEmoji` lives here rather than in `DuelDraft` for the same reason it is
 * optional on `Bet`: DOM-009 makes it decoration on the BET, and a duel is a
 * bet (D1), so `create_duel` takes `p_icon_emoji` exactly as `create_bet` does
 * — but it is not part of what makes a challenge well-formed, which is all
 * `validateDuelDraft` answers. Passing one of these where a `DuelDraft` is
 * expected is fine and intended; the extra property is ignored by the
 * validator.
 *
 * Everything else this type does NOT carry is a decision recorded in
 * `validation.ts`'s `DuelDraft`: no `options` (the RPC generates exactly two
 * from the participants' display names, position 0 = challenger), no
 * `closesAt` (the accept window is `CONFIG.DUEL_ACCEPT_WINDOW_HOURS`' SQL twin
 * and the server owns the clock), and no `maxWagerPerUser` (it IS the stake,
 * which is what makes a third wager structurally impossible — task 6).
 */
export interface NewDuelDraft extends DuelDraft {
  iconEmoji?: string;
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
  /** A code (D8), not a sentence — the consumer translates it. */
  error: MutationErrorCode | null;
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
  /**
   * D5 (`plan-invite-links.md`): may the current user revoke THIS link — the
   * leader, a moderator, or whoever made it. A FUNCTION rather than a boolean,
   * unlike every other `can*` member on this object: revocation is a per-row
   * question (a `free-for-all` member may revoke their own 24-hour link but
   * not a moderator's), where `canInvite` above answers once for the whole
   * team because DOM-006 gates creation by access mode alone. Wraps
   * `packages/shared/src/permissions.ts`'s `canRevokeInvite(team, userId,
   * invite)` with `team`/`currentUser.id` already applied, the same way
   * `duelFor` wraps a lookup rather than leaving every surface to reconstruct
   * the roster+id check itself.
   */
  canRevokeInvite: (invite: TeamInvite) => boolean;
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
  /**
   * This team's `bet_duels` side rows (Extra Phase 2, D1) — the kind-specific
   * half of every bet above whose `kind` is `"duel"`.
   *
   * A sibling array rather than six optional fields on `Bet`, because 99% of
   * bets are pool bets that would carry six `undefined`s each and the next
   * bet kind after this one would add six more. Scoped to the current team the
   * same way `wagers` and `comments` are — through the bet ids, since
   * `bet_duels` has no `team_id` column at all (the bet owns the team, which
   * is also how RLS reaches the table).
   *
   * What is NOT here, deliberately: a `canStartDuel` boolean beside
   * `canCreateBet`. D9 makes starting a duel PLAIN MEMBERSHIP — not
   * `canCreateBet`, and explicitly not gated by `accessMode` — so for anyone
   * who can see this object at all it would be a constant `true`, and a
   * permission field that is always true reads as a gate where there is none.
   * A restricted team rations bets POSTED FOR THE TEAM TO WAGER INTO; a duel
   * is a private arrangement between two people who have already agreed to it.
   * What the leader keeps instead is `mustForceAnyModerator(team)`, a pure
   * function any surface can call with the `team` it already has.
   */
  duels: Duel[];
  /**
   * The duel for a bet, or `undefined` if that bet is a pool bet.
   *
   * Exposed as a lookup rather than leaving every surface to `.find()` its way
   * through `duels`, so the indexing decision lives in exactly one place (it is
   * a Map, built once per render of the memo below). Ask it whenever
   * `bet.kind === "duel"`; the two answers cannot disagree, because a `bets`
   * row with `kind='duel'` and no `bet_duels` row is a state `create_duel`'s
   * single transaction cannot produce.
   *
   * The result is roster+id state and nothing else. It does not say what the
   * duel is currently DOING — `computeDuelPhase(bet, duel, nowMs)` owns that,
   * and needs the bet as well, because an unaccepted duel past its deadline is
   * expired before anything has persisted the void (D8 half (a)).
   */
  duelFor: (betId: string) => Duel | undefined;
  /** Live user lookup — profile edits must show up everywhere a name renders. */
  userById: (userId: string) => User | undefined;
  /** Members sorted coinBalance desc — see `deriveStandings` (`@repo/shared`). */
  richest: TeamMember[];
  /**
   * The exact mirror of `richest`: sorted coinBalance ASC, same tie-break.
   * Owner decision (`agent-docs/found-bugs.md`, "Richest/poorest leaderboard
   * wrong") — Poorest used to rank by realized profit/loss (DOM-028's
   * original "podium of the poor"), which left it empty whenever fewer than
   * 5 members were in the red and padded with winners otherwise. Balance has
   * no such gap: every member has one, so this list is always fully
   * populated.
   */
  poorest: TeamMember[];
  /**
   * One badge max per user, richest-rank precedence:
   * "1"/"2"/"3" richest ranks, "top5" richest ranks 4-5, otherwise "bottom5"
   * if the user is among the 5 lowest balances (`poorest`'s own top 5, now
   * that both boards share one metric).
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
  /**
   * DOM-016/018/019 for pool bets, D6/D7 for duels — one mutator, because
   * `resolve_bet` is one RPC (task 8). The resolution's void arm carries an
   * optional `reason` (D3) which only a duel ever stores; a pool bet's void
   * writes `NULL` no matter what is passed, which is why D3 needed no backfill.
   */
  resolveBet: (betId: string, resolution: BetResolution) => Promise<MutationResult>;
  addComment: (betId: string, body: string) => Promise<MutationResult>;
  // --- 1v1 duels (Extra Phase 2, D1-D9) ---
  //
  // Three write paths, and between them money moves twice and never on credit
  // (D5): the challenger's stake leaves at `startDuel`, the challengee's at
  // `acceptDuel`, and any void — declined, expired, participant-left,
  // pre-acceptance delete — hands both back through the refund machinery that
  // already existed. There is no escrow field and no held-balance column.
  //
  // ARC-014/DOM-030 boundary, stated once for this whole group exactly as the
  // chat group below states its own: NOTHING HERE NOTIFIES ANYONE. No push, no
  // email, no bell, no `document.title` count, not even a badge — and that is
  // the constraint a duel strains hardest, because a challenge that lapses in
  // 24 hours is the most tempting thing in this product to tap someone on the
  // shoulder about. D4's answer is a FEED RE-ORDER: a duel awaiting *your*
  // acceptance (or *your* ruling, as the mediator) sorts to the top of its
  // group for you and carries a distinct row treatment. That is Extra Phase
  // 3's work, on the surfaces, and it needs nothing from this file beyond
  // `duels`/`duelFor` and `computeDuelPhase` — no ordering, no unread state
  // and no "seen" marker of the kind chat needs, because nothing here is a
  // message. DOM-030 is untouched for a different reason worth writing down:
  // the only rate control in this feature (`CONFIG.DUEL_MAX_PENDING_PER_CHALLENGER`
  // and the one-pending-per-pair rule) bounds how many challenges one person
  // may have in flight and says nothing about who they are or what they wrote.
  /**
   * Send a challenge (D1/D5/D9). Validates with `validateDuelDraft`, then one
   * RPC writes six rows in one transaction — the bet, its two auto-generated
   * options, the duel row, and the challenger's own wager, which is what
   * debits their balance immediately.
   *
   * `anyModerator` in the draft is the challenger's INTENT; what gets stored
   * may differ, and the local copy takes the server's answer (D9: a
   * `restricted` team coerces it to `true`, silently and only at creation).
   */
  startDuel: (draft: NewDuelDraft) => Promise<MutationResult>;
  /**
   * Accept a challenge (D2/D5). Only the challengee, only while it is
   * unaccepted and unexpired, and only if they can cover the stake right now —
   * DOM-014 is absolute and nothing is ever accepted on credit. On success the
   * bet does exactly what an early close does (`closed`, `closesAt = now`) and
   * lands in AWAITING RESULT.
   */
  acceptDuel: (betId: string) => Promise<MutationResult>;
  /**
   * Refuse a challenge (D3/D5). Voids the bet and refunds the challenger
   * through the same settlement path every other void uses. `reason` defaults
   * to `"declined"`; the surface passes `"insufficient-funds"` from the path
   * `acceptDuel` refused for money, because the owner requires the history row
   * to say the challengee COULDN'T afford it rather than wouldn't.
   */
  declineDuel: (
    betId: string,
    reason?: betDb.DuelDeclineReason,
  ) => Promise<MutationResult>;
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
  /**
   * Mint one link, permanent or 24-hour (`plan-invite-links.md` D2/D6/D8).
   * Refuses `manager-only-invite` when `!canInvite` (DOM-006's access-mode
   * gate, same as `addBet`'s `manager-only-create-bet`), then
   * `inviteCreationBlocker(team, now, temporary)` for D8's second-permanent
   * refusal and D6's cap — both re-checked inside `create_invite_code`'s own
   * transaction regardless, because a concurrent create from another tab can
   * always land between this client-side read and that write. On success,
   * `reload()` — D10: an invite link is not dashboard-live, so, exactly like
   * `createTeam`/`joinTeamByCode`, the mutation earns its own round trip
   * instead of a local patch.
   */
  createInvite: (temporary: boolean) => Promise<MutationResult & { inviteId?: string }>;
  /**
   * Revoke one link by id (D4/D5). Looks it up in `team.invites` first
   * (`team-not-found` if absent — the list is already stale either way, and
   * `reload()` below is what actually fixes that), refuses
   * `creator-or-mod-only-revoke-invite` when `!canRevokeInvite(invite)`, then
   * `reload()` on success — same D10 reasoning as `createInvite` above.
   */
  revokeInvite: (inviteId: string) => Promise<MutationResult>;
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
  /** A code (D8), not a sentence — the consumer translates it. */
  error: MutationErrorCode | null;
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
      /**
       * A bet resolving — pool or duel. Carries no `deltas` any more (the
       * negative-balance drift fix, `agent-docs/found-bugs.md`): balances are
       * server-authoritative via the `member-update` case below, so this
       * action only ever flips the bet's own state/resolution. The acting
       * client's own balance moves through its RPC's `balanceAfter` (see
       * `resolveBet` below) or, for `resolve_bet`/`delete_bet` which return
       * deltas rather than a snapshot, through its own realtime echo of the
       * `team_members` UPDATE the RPC wrote — same channel, same event every
       * other open tab receives.
       */
      type: "resolve-bet";
      teamId: string;
      betId: string;
      resolution: BetResolution;
    }
  | { type: "delete-bet"; teamId: string; betId: string }
  // --- duels (Extra Phase 2) ---
  // Four actions for three mutators and one remote event. Each of the three
  // writes is COMPOUND — a duel is never one row — so each gets one action
  // rather than a burst of `add-bet` + `place-wager` + something: the reducer
  // must never be able to commit a duel bet without its `bet_duels` row, or a
  // surface rendering between the two dispatches would ask `duelFor` for a
  // duel that is a millisecond away from existing and be told there is none.
  | { type: "start-duel"; teamId: string; bet: Bet; duel: Duel; wager: Wager }
  | {
      type: "accept-duel";
      teamId: string;
      betId: string;
      /** The server's clock, written to `bet_duels.accepted_at`. */
      acceptedAt: string;
      /** The bet's NEW closesAt — the same instant (D2). */
      closesAt: string;
      /** The challengee's stake on position 1, which is what debits them. */
      wager: Wager;
    }
  /**
   * A duel voided with a reason (D3) — decline today, and shaped for the rest
   * tomorrow. Deliberately not named `decline-duel`: a decline IS a void with a
   * suffix, and modelling it as its own kind of resolution is how a second
   * settlement path gets written. The expiry sweep and the kick/ban cascade
   * reach this client by other routes (a `bets` UPDATE over realtime, and
   * `remove-membership` below, which must void duels and drop a membership in
   * ONE commit) — but all four are the same void, refunding through the same
   * `app.settle_bet`.
   */
  | {
      /** No `deltas` field for the same reason `resolve-bet` above has none
       * — the refund is server-authoritative via `member-update`. */
      type: "void-duel";
      teamId: string;
      betId: string;
      reason: BetVoidReason;
    }
  /** A `bet_duels` INSERT or UPDATE off the team channel — see realtime.ts for
   * why one variant covers both, and `applyRemote` for the receive rule. */
  | { type: "duel-upsert"; duel: Duel }
  /**
   * A `team_members` INSERT off the team channel (bug fix, amending
   * design-realtime.md §5 rule 3 — see realtime.ts's `subscribeTeamChannel`
   * for the full argument for why an INSERT-only exception is safe).
   *
   * Carries only the membership — no `user` field, unlike before the
   * negative-balance drift fix. Dispatched SYNCHRONOUSLY, before
   * `applyRemote`'s `member-insert` case even starts its conditional
   * `fetchUser`, so the row exists on this client's copy of the roster the
   * instant the event arrives rather than after a round trip — see that
   * case's own comment for why the old ordering (await first, dispatch
   * second) silently dropped a `member-update` that landed in the gap.
   * `add-user` below is the joiner's `users` row, when this client needs it,
   * as its own separate, later dispatch.
   */
  | { type: "add-member"; teamId: string; member: TeamMember }
  /**
   * The joiner's `users` row (and onboarding fact), fetched only when
   * `member-insert` finds this client has never held it — a brand-new
   * account, or an existing one this client has simply never shared a team
   * with. A separate action from `add-member` (which it used to ride as an
   * optional field) precisely so the membership is not held hostage to this
   * fetch: see `add-member`'s own comment. `update-user` below cannot serve
   * this role — it only ever replaces an existing entry in `data.users`, and
   * this is the one case that has to APPEND a new one.
   */
  | { type: "add-user"; user: FetchedUser }
  /**
   * One or more `team_members` UPDATEs off the team channel (the
   * negative-balance drift fix, `agent-docs/found-bugs.md`) — `coinBalance`,
   * `profitLoss` and `role` applied ABSOLUTELY from each row, replacing the
   * member wholesale rather than adding to whatever this client currently
   * shows. This is what makes every open tab, including the one that caused
   * the change, agree with Postgres: see realtime.ts's `subscribeTeamChannel`
   * for the full argument for why an UPDATE binding is now safe where
   * design-realtime.md §5 rule 3 used to forbid one.
   *
   * Plural, and always dispatched through the coalescing buffer
   * (`flushMemberUpdates` below) even for a single row: a resolution moves
   * many members in one Postgres transaction but arrives as that many
   * separate Realtime messages, and batching them into one dispatch is what
   * keeps the standings module from re-sorting once per row.
   */
  | { type: "member-updates"; teamId: string; members: TeamMember[] }
  /**
   * The acting client's own instant balance feedback (negative-balance drift
   * fix) — set ABSOLUTELY from an RPC's own `balance_after`, exactly the way
   * `add-transaction` below already does for a ledger credit. Only
   * `place_wager`/`create_duel`/`accept_duel` dispatch this: each returns a
   * snapshot already. `resolve_bet`/`delete_bet` return deltas instead of a
   * snapshot, so the actor does not get a second, competing local write for
   * the same field — it simply waits for its own `member-update` echo of the
   * `team_members` UPDATE the RPC already wrote, same as every other open tab.
   */
  | { type: "set-balance"; teamId: string; userId: string; balanceAfter: number }
  | {
      type: "remove-membership";
      teamId: string;
      userId: string;
      ban: boolean;
      wagers: Wager[];
      /**
       * The bet ids of the duels this departure voids (Extra Phase 2, task
       * 11), computed by `departureCascade` below from
       * `voidDuelsForDepartingMember` — carried on THIS action rather than
       * dispatched as a burst of `void-duel`s because the voids, the wager
       * cascade and the membership deletion are one server transaction and
       * must be one local commit too. Empty for the overwhelmingly common
       * departure of somebody who was in no duel — and empty, by D7, for a
       * departing MEDIATOR, who strands nothing.
       *
       * No `deltas` alongside them (unlike before the negative-balance drift
       * fix): the refund each voided duel pays out is server-authoritative
       * via `member-update`, so this list only has to say WHICH bets flip to
       * resolved, never how much money moved.
       */
      voidedBetIds: string[];
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

/**
 * The resolution a duel takes when one of its two participants leaves the team
 * — kicked, banned, or walking out (Extra Phase 2, task 11, D3). A module
 * constant so the two mutators that can cause a departure, the reducer case
 * that applies it, and the deltas computed from it are provably the same
 * object shape; `void_reason='participant-left'` is what `app.void_duel`
 * stores for the same event server-side.
 */
const DEPARTURE_VOID: BetResolution = { kind: "void", reason: "participant-left" };

/**
 * Everything a departure does to this team's bets, wagers and balances, worked
 * out BEFORE the RPC so the same numbers can be sent, applied and reasoned
 * about (Extra Phase 2, task 11 — the client-side half of the cascade that
 * `remove_membership` runs in Postgres).
 *
 * **Why this exists at all, when `removeMemberWagersInTeam` already handled
 * departures perfectly well for two phases.** That function is pool-shaped and
 * correctly so: dropping one bettor from a many-bettor pool leaves a valid pool
 * that simply pays out differently, and DOM-032 says the leaver's stake
 * evaporates with their per-team balance. Drop one of EXACTLY TWO and what is
 * left is not a smaller duel — it is one person's stake with nothing on the
 * other side to settle against, a bet that can never legally resolve and whose
 * surviving participant is out real coins forever. So the duel is voided and
 * the survivor refunded, which is `settleBet`'s ordinary void branch doing
 * ordinary work. No new money path (this phase's named risk 3).
 *
 * **The ORDER below is a mirror, not a preference, and getting it backwards
 * silently strands a wager.** `remove_membership` voids the duels FIRST and
 * only then deletes the departing member's wagers, narrowed by
 * `and b.state <> 'resolved'` — which is `removeMemberActiveWagers`'s own rule
 * ("wagers on resolved bets stay untouched") enforced server-side. By the time
 * that DELETE runs, the duels this departure voided ARE resolved, so both
 * stakes survive on them. Computing the local wager cascade against
 * `data.bets` as loaded would instead drop the leaver's duel wager here while
 * Postgres keeps it, and the local world would then replay a resolved duel
 * with one stake missing — which is exactly the drift the Phase 7 consistency
 * guard reports and cannot attribute. Hence `betsAfterVoid`.
 *
 * `removedWagerIds` is what goes over the wire, and it is now a NARROWER list
 * than it used to be for a departing duellist. That is belt and braces rather
 * than the guarantee: the server's `state <> 'resolved'` narrowing already
 * refuses to delete those rows even if this list still named them, precisely
 * because `20260905150000_bet_rpcs.sql`'s header only ever promised that a
 * client-supplied id list "can only narrow what the cascade already permits".
 *
 * A departing MEDIATOR produces an empty result and must (D7):
 * `app.can_resolve_duel` falls back to the any-moderator pool at READ time, so
 * a duel whose named mediator has gone is resolvable by any moderator the
 * moment they leave. A runtime fallback, never a stored reassignment — nothing
 * to void and nothing to fix. `voidDuelsForDepartingMember` is where that rule
 * is written down; this function only asks it.
 */
function departureCascade(
  data: TeamData,
  teamId: string,
  userId: string,
): {
  voidedBetIds: string[];
  keptWagers: Wager[];
  removedWagerIds: string[];
} {
  const voidedBetIds = voidDuelsForDepartingMember(
    userId,
    teamId,
    data.bets,
    data.duels,
  );
  const voided = new Set(voidedBetIds);

  const betsAfterVoid =
    voided.size === 0
      ? data.bets
      : data.bets.map((b) =>
          voided.has(b.id)
            ? { ...b, state: "resolved" as const, resolution: DEPARTURE_VOID }
            : b,
        );

  const keptWagers = removeMemberWagersInTeam(
    userId,
    teamId,
    betsAfterVoid,
    data.wagers,
  );
  const kept = new Set(keptWagers.map((w) => w.id));

  return {
    // Already in `bets` order — `voidDuelsForDepartingMember` promises it and
    // `voidedBetIds` is that function's return value, untouched. No `deltas`
    // alongside them (the negative-balance drift fix): the refund is
    // server-authoritative via the `member-update` reducer case, so the
    // reducer only needs to know WHICH bets this departure resolved.
    voidedBetIds,
    keptWagers,
    removedWagerIds: data.wagers.filter((w) => !kept.has(w.id)).map((w) => w.id),
  };
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
      // The stake leaves the balance at placement (decision §4.6 money
      // model), but the debit itself is no longer applied here — the
      // negative-balance drift fix (`agent-docs/found-bugs.md`) made balances
      // server-authoritative, so the wagerer's `coinBalance` moves only
      // through `member-update` (their own realtime echo of `place_wager`'s
      // debit, or `placeWager`'s own instant `set-balance` dispatch for the
      // acting client — see that mutator below). This case only ever adds the
      // wager row.
      const { wager } = action;
      if (data.wagers.some((w) => w.id === wager.id)) return data;
      return { ...data, wagers: [...data.wagers, wager] };
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
      // Settlement credits balances + realized P/L (decision §4.6 — no
      // Transaction rows, resolution is not a ledger event), but not here any
      // more: the negative-balance drift fix made balances
      // server-authoritative, so this case only ever flips the bet's own
      // state/resolution and every member's `coinBalance`/`profitLoss` moves
      // through its own `member-update` echo instead.
      return {
        ...data,
        bets: data.bets.map((b) =>
          b.id === action.betId
            ? { ...b, state: "resolved" as const, resolution: action.resolution }
            : b,
        ),
      };
    case "delete-bet":
      // DOM-033 hard delete: the bet, its wagers and its comments go. The
      // money reversal `delete_bet` applied no longer lands here (see
      // `resolve-bet` above for why) — it arrives as `member-update`.
      return {
        ...data,
        bets: data.bets.filter((b) => b.id !== action.betId),
        wagers: data.wagers.filter((w) => w.betId !== action.betId),
        comments: data.comments.filter((c) => c.betId !== action.betId),
        // `bet_duels.bet_id references bets on delete cascade`, so the duel row
        // goes with the bet in Postgres and must go with it here. Unconditional
        // rather than guarded on `bet.kind`: filtering a list that holds no
        // matching row costs one pass and cannot be forgotten later, whereas a
        // guard has to stay in step with what `kind` means.
        duels: data.duels.filter((d) => d.betId !== action.betId),
      };
    case "start-duel": {
      // Idempotent in THREE places rather than one, and the split matters.
      // This action's rows also arrive independently over the team channel —
      // `bet-insert` (answered by `fetchBet`), `duel-upsert` and
      // `wager-insert` — so the creating client can hold any subset of them by
      // the time its own RPC returns. A single "do I already have the bet?"
      // guard would then drop the duel row and the wager on the floor and
      // leave `duelFor` answering `undefined` for a bet whose whole point is
      // that it has a duel. Each part carries its own id check instead.
      const { bet, duel, wager } = action;
      const hasBet = data.bets.some((b) => b.id === bet.id);
      const hasDuel = data.duels.some((d) => d.betId === duel.betId);
      const hasWager = data.wagers.some((w) => w.id === wager.id);
      if (hasBet && hasDuel && hasWager) return data;
      // The debit (decision §4.6 money model — D5: no escrow, no held-balance
      // column) no longer lands here: it is server-authoritative via
      // `member-update`, and the acting client gets its instant feedback from
      // `startDuel`'s own `set-balance` dispatch below instead.
      return {
        ...data,
        bets: hasBet ? data.bets : [...data.bets, bet],
        duels: hasDuel ? data.duels : [...data.duels, duel],
        wagers: hasWager ? data.wagers : [...data.wagers, wager],
      };
    }
    case "accept-duel": {
      // D2: accepting does exactly what an early close does — `state='closed'`
      // and `closesAt` moved to the instant it happened — plus the challengee's
      // stake. No fourth `BetState` is invented and
      // `enforce_bet_state_transition` stays byte-for-byte unchanged (D1).
      // `Duel.expiresAt` is untouched on purpose: after this the bet no longer
      // remembers when the challenge would have lapsed, and that column is the
      // only surviving record of it.
      // The challengee's debit, likewise, is server-authoritative via
      // `member-update` now — `acceptDuel`'s own `set-balance` dispatch below
      // is the acting client's instant feedback.
      const { wager } = action;
      const hasWager = data.wagers.some((w) => w.id === wager.id);
      return {
        ...data,
        bets: data.bets.map((b) =>
          b.id === action.betId
            ? { ...b, state: "closed" as const, closesAt: action.closesAt }
            : b,
        ),
        duels: data.duels.map((d) =>
          d.betId === action.betId ? { ...d, acceptedAt: action.acceptedAt } : d,
        ),
        wagers: hasWager ? data.wagers : [...data.wagers, wager],
      };
    }
    case "void-duel": {
      // The guard against a duel appearing resolved twice (a client that
      // declines a duel receives its own `bets` UPDATE echo on the team
      // channel, and if that echo wins the race against the RPC's return,
      // `applyRemote`'s `bet-update` case has already flipped this bet's
      // state). Money is no longer this guard's concern — the refund is
      // server-authoritative via `member-update`, which has its own,
      // independent idempotency (Realtime never redelivers the same UPDATE),
      // so a redundant state flip here would be harmless on its own; the
      // guard stays because re-running it costs nothing and keeps this case
      // provably idempotent rather than merely lucky.
      const bet = data.bets.find((b) => b.id === action.betId);
      if (!bet || bet.state === "resolved") return data;
      return {
        ...data,
        bets: data.bets.map((b) =>
          b.id === action.betId
            ? {
                ...b,
                state: "resolved" as const,
                resolution: { kind: "void", reason: action.reason },
                // `closesAt` is deliberately NOT pulled back to now, even
                // though `app.void_duel` writes `least(closes_at, now())`.
                // The browser clock never writes a stored timestamp in this
                // file (DOM-012: `closesAt` is the moment open→closed actually
                // happened, and only the server knows it), and nothing reads it
                // once the bet is resolved — `computeEffectiveState` returns
                // `"resolved"` and `computeDuelPhase` returns `"settled"`, both
                // before they look at a date. The next load replaces the value
                // with the server's.
              }
            : b,
        ),
      };
    }
    case "duel-upsert": {
      // The universal receive rule, one level of indirection deeper: this
      // client must hold the duel's BET, not the duel, because for an INSERT
      // it obviously holds no duel yet. Together with RLS
      // (`bet_duels_select_bet_team_member`) that is what drops rows for teams
      // this client cannot read — the `bet_duels` realtime binding carries no
      // team filter, since the table has no team column to filter on.
      const { duel } = action;
      if (!data.bets.some((b) => b.id === duel.betId)) return data;
      // NOT "ignore any id you already hold", which is the rule for every
      // insert case in this reducer. An UPDATE payload is a whole `bet_duels`
      // row and the newer truth, so a held duel is REPLACED rather than kept —
      // that is the entire reason one `duel-upsert` variant covers both events
      // (see realtime.ts). The only UPDATE a duel row ever takes is
      // `accepted_at` going from null to a timestamp, so "replace wholesale" and
      // "patch acceptedAt" agree today; replacing is what stays correct if a
      // second mutable column ever appears.
      return {
        ...data,
        duels: data.duels.some((d) => d.betId === duel.betId)
          ? data.duels.map((d) => (d.betId === duel.betId ? duel : d))
          : [...data.duels, duel],
      };
    }
    case "add-member": {
      // The universal insert guard: a member this client already holds for
      // this team is ignored rather than replaced — this client's own
      // `joinTeamByCode` already went through `reload()` (D10, same as
      // `createTeam`), so the overwhelmingly common receiver of this event is
      // an EXISTING member's dashboard learning about someone else's arrival,
      // and the rare self-echo (this device catching its own join over the
      // socket before its `reload()` lands) must not clobber a row `reload()`
      // may already have refreshed.
      const team = data.teams.find((t) => t.id === action.teamId);
      if (!team || team.members.some((m) => m.userId === action.member.userId)) {
        return data;
      }
      const teams = data.teams.map((t) =>
        t.id === action.teamId
          ? {
              ...t,
              // Same order `loadTeamData` produces (join order) — append then
              // resort, rather than trusting "this INSERT is the newest
              // member," so a channel that reconnects and replays a backlog
              // out of order still lands the roster in the one order every
              // other surface assumes.
              members: [...t.members, action.member].sort((a, b) =>
                a.joinedAt.localeCompare(b.joinedAt),
              ),
            }
          : t,
      );
      return { ...data, teams };
    }
    case "add-user":
      // Universal insert guard, same shape as `add-bet`/`add-comment`: two
      // concurrent `member-insert`s for the same never-before-seen user (one
      // person joining two of this client's teams close together) can both
      // decide "not known yet" before either dispatches, so this is what
      // keeps the second `fetchUser`'s answer from duplicating `data.users`.
      if (data.users.some((u) => u.id === action.user.user.id)) return data;
      return {
        ...data,
        users: [...data.users, action.user.user],
        onboarding: {
          ...data.onboarding,
          [action.user.user.id]: action.user.onboarding,
        },
      };
    case "member-updates": {
      // The negative-balance drift fix's whole point: overwrite each member
      // ABSOLUTELY from the row Postgres just wrote — no delta math, ever.
      // Ignore any member this client does not already hold (the universal
      // receive rule) rather than inserting one: an UPDATE can only ever be
      // about a row that already exists on this client's copy of the roster,
      // since the INSERT that created it is a separate, older event.
      const byUserId = new Map(action.members.map((m) => [m.userId, m]));
      return {
        ...data,
        teams: patchMembers(
          data.teams,
          action.teamId,
          (m) => byUserId.get(m.userId) ?? m,
        ),
      };
    }
    case "set-balance":
      // The acting client's own instant feedback (see this action's doc
      // comment) — absolute, exactly like `member-update` and
      // `add-transaction`, just narrower: only `coinBalance` is known at the
      // call site, not the whole row.
      return {
        ...data,
        teams: patchMembers(data.teams, action.teamId, (m) =>
          m.userId === action.userId
            ? { ...m, coinBalance: action.balanceAfter }
            : m,
        ),
      };
    case "remove-membership": {
      // DOM-031/032: the membership (and with it the per-team balance) goes,
      // the pre-computed cascade replaces the wager list, and a ban — unlike a
      // kick — additionally records the block on re-joining (A-4).
      //
      // Extra Phase 2 task 11 adds the duel half, and it has to happen in this
      // same commit: a departing participant's duels are voided and the
      // survivor refunded (D3's `'participant-left'`), because half of a
      // two-person bet is not a smaller bet — see `departureCascade` above for
      // the whole argument and for why `action.wagers` was computed against a
      // world in which these bets are already resolved.
      //
      // Skipping a duel this client already holds as resolved is the same
      // guard `void-duel` carries, for the same race: the `bets` UPDATE the
      // server's void produced may have arrived on the team channel before
      // the RPC returned, in which case `bet-update` has already flipped it.
      // The refund itself is no longer applied here either way (negative-
      // balance drift fix) — it is server-authoritative via `member-update`,
      // including for the departing member's own transient credit: Postgres
      // still applies it (`app.void_duel` before `remove_membership` deletes
      // the row), this client just never has to mirror it locally, because
      // that membership is filtered out of `data.teams` two lines below
      // regardless of what its balance briefly was.
      const voided = new Set(
        action.voidedBetIds.filter((betId) =>
          data.bets.some((b) => b.id === betId && b.state !== "resolved"),
        ),
      );
      return {
        ...data,
        wagers: action.wagers,
        bets:
          voided.size === 0
            ? data.bets
            : data.bets.map((b) =>
                voided.has(b.id)
                  ? {
                      ...b,
                      state: "resolved" as const,
                      resolution: DEPARTURE_VOID,
                    }
                  : b,
              ),
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
    }
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
        // Duels go the same way as wagers and comments, through the same set of
        // doomed bet ids: `bet_duels` hangs off the bet, the bet hangs off the
        // team, and Postgres removes both by ON DELETE CASCADE. A duel is not a
        // reason to refuse a team deletion — balances are per-team (DOM-013),
        // so nothing survives to refund to.
        duels: data.duels.filter((d) => !doomedBetIds.has(d.betId)),
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
  error: MutationErrorCode | null;
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
  | { type: "error"; error: MutationErrorCode }
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
  const [loadError, setLoadError] = useState<MutationErrorCode | null>(null);
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
   * Coalesces `member-update` events within one animation frame (negative-
   * balance drift fix, step 8 of the plan in `agent-docs/found-bugs.md`).
   *
   * A single `resolve_bet` can rewrite dozens of `team_members` rows in one
   * transaction — the exact shape `design-realtime.md` §5 rule 3 counts as
   * "~30 balance rows" — and each arrives here as its OWN Realtime message,
   * not as one batch. Dispatching one `member-update` per message would
   * re-sort the standings module and re-render every roster row as many
   * times, milliseconds apart, each showing a still-incomplete picture of the
   * same resolution — a visible shuffle for a change that is really one
   * event from the user's point of view. Buffered per team, keyed by user id
   * (a later row for the same member during the same frame replaces the
   * earlier one rather than queuing both), and flushed as a single
   * `member-updates` dispatch on the next animation frame, so the roster
   * moves once, straight to its final state.
   */
  const memberUpdateBuffer = useRef(new Map<string, Map<string, MemberRow>>());
  const memberUpdateFrame = useRef<number | null>(null);
  const flushMemberUpdates = useCallback(() => {
    memberUpdateFrame.current = null;
    for (const [teamId, byUser] of memberUpdateBuffer.current) {
      dispatch({
        type: "member-updates",
        teamId,
        members: [...byUser.values()].map(toMember),
      });
    }
    memberUpdateBuffer.current.clear();
  }, []);
  // Belt and braces: a frame queued just before unmount must not dispatch
  // into a provider that is no longer there.
  useEffect(
    () => () => {
      if (memberUpdateFrame.current !== null) {
        cancelAnimationFrame(memberUpdateFrame.current);
      }
    },
    [],
  );

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
   *   * **Apply the payload, never refetch the world.** The two reads in here
   *     are `fetchBet` — one row, because a `bets` INSERT arrives without its
   *     options — and `fetchUser`, one row, for a `member-insert` whose
   *     joiner this client has never seen. Neither is `reload()`: answering
   *     every event with a full reload would cost more than the polling
   *     Realtime replaced (design-realtime.md §2).
   *   * **Ignore any id you do not already hold.** That single rule does three
   *     jobs at once: it drops the DELETE events RLS cannot filter (§4.3), it
   *     drops the client's own echo of a change it has already applied — which
   *     is what keeps money from moving twice — and it makes at-least-once
   *     delivery harmless.
   *
   * Balances used to move here purely by re-deriving them from a resolution's
   * or a deletion's own event, with `team_members` UPDATEs never subscribed at
   * all (§5 rule 3) — until the negative-balance drift fix
   * (`agent-docs/found-bugs.md`) found the two write paths that broke that
   * model (a joiner's balance snapshotted at zero before their grant landed;
   * every ledger credit invisible to anyone but the credited member's own
   * tab) and replaced it with the simpler rule realtime.ts's header argues
   * for at length: `team_members` UPDATE is now subscribed, and every
   * `coinBalance`/`profitLoss` on this client is SET FROM that row, never
   * computed from a delta. `resolve-bet` and `delete-bet` above therefore
   * carry no money at all any more — the `member-update` case below is where
   * it arrives, for every wagerer, on every open tab. `team_members` INSERT
   * remains the narrower, earlier exception it always was — see the
   * `member-insert` case below.
   *
   * Extra Phase 1 (UX-019) adds a fourth event, `chat-insert` — see that case
   * below for the two EXTRA guards it needs beyond the two invariants above
   * (a team-id check and an idle check, neither of which any other case
   * needs). It reads `teamIdRef`/`chatRef` rather than closing over
   * `teamId`/`chatSlice` from the surrounding render, which is what keeps
   * this whole callback `[supabase]`-stable — see those refs' own comment,
   * beside `dataRef`, for why that stability matters for a channel this
   * function has nothing to do with.
   *
   * Extra Phase 2 (1v1 duels) adds `duel-upsert`, which needs no extra guard
   * at all — only the second invariant, applied through a foreign key: a duel
   * belongs to a team solely through its bet, so "ignore any id you do not
   * already hold" becomes "ignore any duel whose BET you do not already hold."
   * That single check is what drops duels on bets in a team this client cannot
   * read, and it is doing more work here than for the other cases: the
   * `bet_duels` realtime binding cannot be filtered server-side, because the
   * table has no team column to filter on (see realtime.ts).
   *
   * The post-launch bug fix adds `member-insert`, which borrows `chat-insert`'s
   * team-id recheck (this binding IS filtered server-side, unlike `bet_duels`,
   * but the same "don't trust it blindly" reasoning applies) and adds a THIRD
   * kind of read to the one invariant allows only two of: `fetchUser`, and only
   * conditionally, because whether this client already holds the joiner's
   * `users` row is exactly the fact this case exists to not get wrong. Skipping
   * the fetch for an already-known user is not an optimization bolted on after
   * the fact — it is what keeps a member joining their SECOND visible team from
   * reading as a second, duplicate `users` row.
   *
   * The second post-launch bug fix (the negative-balance drift) adds
   * `member-update`, which needs no read at all — the row is a complete
   * `MemberRow` and `toMember` maps it exactly as `loadTeamData` does — only
   * the same team-id recheck `member-insert` already carries, plus the
   * universal receive rule applied literally: a member this client does not
   * already hold is ignored rather than inserted, because an UPDATE is never
   * the first thing this client learns about a row.
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
            // No `deltas` any more (negative-balance drift fix): the payout
            // `resolve_bet` wrote reaches every subscriber, this one included,
            // as its own `member-update` event(s) on this same channel — this
            // dispatch only has to flip the bet's state/resolution.
            dispatch({
              type: "resolve-bet",
              teamId: bet.teamId,
              betId: bet.id,
              resolution,
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
          // No `deltas` (see "bet-update" above) — `delete_bet`'s reversal
          // arrives as its own `member-update` event(s).
          dispatch({ type: "delete-bet", teamId: bet.teamId, betId: bet.id });
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
        case "duel-upsert": {
          // ONE case for the `bet_duels` INSERT and UPDATE both, which is
          // realtime.ts's decision and worth restating from the receiving end:
          // a `bet_duels` payload is the COMPLETE row either way (no embed, no
          // ordering column, nothing this module has to go back for — unlike a
          // `bets` INSERT, which arrives without its options and is the sole
          // reason `fetchBet` exists), and the rule here is identical for both
          // — hold the duel for this bet id, or ignore it.
          //
          // The bet check is the universal receive rule reaching through the
          // foreign key, since a duel names no team of its own. It also drops
          // the case that RLS cannot: a duel on a bet in another of this
          // user's teams, which this client legitimately holds but whose bet
          // may not be loaded on this channel.
          // Nothing here closes the bet or credits a wager when a duel is
          // ACCEPTED, and that is not an omission: the same transaction also
          // writes a `bets` UPDATE and a `wagers` INSERT, which arrive as their
          // own events on this same channel and are applied by the two cases
          // above. This one carries `acceptedAt` and nothing else, because
          // `bet_duels` is the only table that knows it.
          const duel = toDuel(event.row);
          if (!dataRef.current.bets.some((b) => b.id === duel.betId)) return;
          dispatch({ type: "duel-upsert", duel });
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
        case "member-insert": {
          const { row } = event;
          // Defense in depth, matching `chat-insert`'s identical guard: the
          // INSERT binding is already filtered server-side to this team, but
          // a server-side filter is not a boundary this file trusts blindly.
          if (row.team_id !== teamIdRef.current) return;
          const team = dataRef.current.teams.find((t) => t.id === row.team_id);
          // Ignore any id already held — the universal receive rule, and also
          // what makes this client's own `joinTeamByCode` echo (racing its
          // own `reload()`, D10) harmless rather than a second row.
          if (!team || team.members.some((m) => m.userId === row.user_id)) {
            return;
          }
          const member = toMember(row);
          // Dispatched SYNCHRONOUSLY, before the `fetchUser` below even
          // starts — the second half of the negative-balance drift fix's
          // `member-insert` ordering repair (`agent-docs/found-bugs.md`).
          // This used to await `fetchUser` first, so an UPDATE for the
          // joiner landing during that round trip (the onboarding grant, the
          // first daily reward) was dropped as "unknown member" — nothing
          // in `patchMembers` found a row to patch. Dispatching the
          // membership immediately shrinks that window to nothing: the row
          // exists on this client's copy the instant this handler runs, and
          // any `member-update` that arrives after it, even a microtask
          // later, has somewhere to land.
          dispatch({ type: "add-member", teamId: row.team_id, member });
          // This is the bug fix's other half, and it can now run AFTER the
          // dispatch above rather than gating it: a BRAND-NEW account — one
          // no team this client belongs to has ever put in `data.users` —
          // leaves `userById(member.userId)` answering `undefined` the
          // instant this member's own bet or wager arrives on this same
          // channel, and the "created by" tag it should carry renders blank
          // until the next full load (`bet-row.tsx`'s `creator && (...)`).
          // `known` short-circuits the round trip for the ordinary case: an
          // existing account joining a SECOND team this client can already
          // see. The blank-name window this leaves is now bounded to one
          // fetch round trip rather than the whole membership — the fix
          // above is what stops a joiner's own balance from going missing
          // too, which was the worse half of this bug.
          if (dataRef.current.users.some((u) => u.id === member.userId)) return;
          const user = await fetchUser(supabase, member.userId);
          if (user) dispatch({ type: "add-user", user });
          return;
        }
        case "member-update": {
          const { row } = event;
          // Same defense-in-depth as `member-insert`'s identical guard.
          if (row.team_id !== teamIdRef.current) return;
          // The universal receive rule: a member this client does not already
          // hold is ignored, never inserted — an UPDATE cannot be the first
          // this client learns of a row; the INSERT that created it is a
          // separate, earlier event.
          const team = dataRef.current.teams.find((t) => t.id === row.team_id);
          if (!team || !team.members.some((m) => m.userId === row.user_id)) {
            return;
          }
          // Buffered rather than dispatched straight away — see
          // `flushMemberUpdates`'s own doc comment for why a resolution's
          // worth of these must land as one `member-updates` dispatch, not
          // one per row.
          let byUser = memberUpdateBuffer.current.get(row.team_id);
          if (!byUser) {
            byUser = new Map();
            memberUpdateBuffer.current.set(row.team_id, byUser);
          }
          byUser.set(row.user_id, row);
          if (memberUpdateFrame.current === null) {
            memberUpdateFrame.current = requestAnimationFrame(flushMemberUpdates);
          }
          return;
        }
      }
    },
    [supabase, flushMemberUpdates],
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
   * DOM-022 / A-2 / decision §4.3: the daily reward and its sibling, the
   * weekly login reward (DOM-036, owner order 2026-09-09), both claimed lazily
   * on team load — once per (user, team, calendar day) and once per (user,
   * team, ISO week in UTC) respectively. "Once" is the database's word in both cases —
   * `claim_daily_reward` and `claim_weekly_reward` are each idempotent against
   * their own partial unique index — so the ref below is only there to keep a
   * re-render from issuing a round trip that is already known to return
   * nothing.
   *
   * It runs per team rather than once per session because balances are
   * per-team (DOM-013): switching to a team you have not opened today (or this
   * week) owes you that team's reward(s).
   *
   * The two claims run SEQUENTIALLY, daily awaited before weekly starts, and
   * that order is load-bearing, not a style choice: the "add-transaction"
   * reducer case applies `balanceAfter` as an ABSOLUTE overwrite of
   * `coinBalance`, not a delta, because that is what the server's own ledger
   * snapshot says the balance now is. Two claims dispatched out of server
   * order would leave the wallet showing whichever response's `balanceAfter`
   * happened to land second in the JS event loop — not necessarily the truly
   * latest one — until the next `team_members` realtime echo quietly corrected
   * it. Awaiting daily before firing weekly makes dispatch order match the
   * server's write order, so the balance is right the first time. The second
   * round trip (weekly) is a background gift nobody is blocking on; nothing
   * downstream waits for it.
   */
  const claimedRewards = useRef(new Set<string>());
  useEffect(() => {
    if (!currentUserId || !team) return;
    const key = `${currentUserId}:${team.id}`;
    if (claimedRewards.current.has(key)) return;
    claimedRewards.current.add(key);

    const teamId = team.id;
    void (async () => {
      const daily = await db.claimDailyReward(supabase, teamId);
      // A failure here is not worth a visible error: the reward is a gift, and
      // Extra Phase 4 task 12 froze this path as deliberately silent — do NOT
      // add a toast. Let the ref forget so the next load retries BOTH claims;
      // both are idempotent, so retrying the one that already succeeded costs
      // nothing.
      if (!daily.ok) {
        claimedRewards.current.delete(key);
        return;
      }
      if (daily.reward) {
        dispatch({
          type: "add-transaction",
          transaction: {
            id: daily.reward.transactionId,
            teamId,
            userId: currentUserId,
            kind: "daily-reward",
            amount: daily.reward.amount,
            description: "Daily login reward",
            balanceAfter: daily.reward.balanceAfter,
            createdAt: daily.reward.createdAt,
          },
        });
      }

      const weekly = await db.claimWeeklyReward(supabase, teamId);
      if (!weekly.ok) {
        claimedRewards.current.delete(key);
        return;
      }
      if (weekly.reward) {
        dispatch({
          type: "add-transaction",
          transaction: {
            id: weekly.reward.transactionId,
            teamId,
            userId: currentUserId,
            kind: "weekly-reward",
            amount: weekly.reward.amount,
            description: "Weekly login reward",
            balanceAfter: weekly.reward.balanceAfter,
            createdAt: weekly.reward.createdAt,
          },
        });
      }
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
      if (!ctx) return fail("team-not-found");
      if (!permitCreateBet(ctx.team, ctx.userId)) {
        return fail("manager-only-create-bet");
      }
      const firstIssue = validateBetDraft(draft, Date.now())[0];
      if (firstIssue) return fail(firstIssue.code, { values: firstIssue.values });

      const result = await betDb.createBet(supabase, {
        teamId: ctx.team.id,
        title: draft.title,
        iconEmoji: draft.iconEmoji,
        options: draft.options,
        closesAt: draft.closesAt,
        maxWagerPerUser: draft.maxWagerPerUser,
      });
      if (!result.ok || !result.bet) {
        return result.ok ? fail("bet-create-failed") : result;
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
        // Spelled out, not inherited: `bets.kind` is `not null default 'pool'`
        // in Postgres — which is exactly what let Extra Phase 2 add the column
        // with no backfill — but a TypeScript object literal has no default to
        // fall back on, and `Bet.kind` is deliberately REQUIRED rather than
        // optional so the compiler asks this question at every construction
        // site. `create_bet` writes pool bets and only pool bets; duels are
        // `startDuel` below, through their own RPC.
        kind: "pool",
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
      if (!bet) return fail("bet-not-found");
      const team = data.teams.find((t) => t.id === bet.teamId);
      const member = team?.members.find((m) => m.userId === currentUserId);
      if (!team || !member) return fail("not-a-member");
      // Extra Phase 2 task 8's first guard, and it is refused BEFORE the clock
      // and the option check because it is not a wagering problem: a duel has
      // exactly two wagers, one per participant, placed by `create_duel` and
      // `accept_duel` themselves. `place_wager` refuses the same thing with the
      // same sentence server-side, which is the only enforcement that counts
      // (`wagers` INSERT has been revoked from `authenticated` since Phase 6,
      // so that RPC is the sole write path). This copy exists so a surface that
      // offers the wager modal on a duel row says why instead of round-tripping
      // to find out. Keyed on `bet.kind`, exactly as the RPC is — not on
      // `duelFor(betId)`, so the two tests cannot drift apart.
      if (bet.kind === "duel") {
        return fail("duel-no-direct-wager");
      }
      if (!canAcceptWagers(bet, Date.now())) {
        return fail("betting-closed");
      }
      if (!bet.options.some((o) => o.id === optionId)) {
        return fail("option-required");
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
      if (firstIssue) return fail(firstIssue.code, { values: firstIssue.values });

      const result = await betDb.placeWager(supabase, {
        betId: bet.id,
        optionId,
        amount,
      });
      if (!result.ok || !result.wager) {
        return result.ok ? fail("wager-failed") : result;
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
      // Instant feedback (negative-balance drift fix): `place_wager` already
      // returns the post-debit snapshot, so the actor's own balance is set
      // from it immediately rather than waiting for its `member-update`
      // echo. That echo still arrives a moment later and simply confirms the
      // same number — Realtime delivers in commit order, so it can never be
      // stale here.
      dispatch({
        type: "set-balance",
        teamId: team.id,
        userId: member.userId,
        balanceAfter: result.wager.balanceAfter,
      });
      return ok;
    },
    [supabase, data.bets, data.teams, data.wagers, currentUserId],
  );

  /** DOM-011/DOM-012: creator or moderator, and only while it is really open. */
  const closeBetEarly = useCallback(
    async (betId: string): Promise<MutationResult> => {
      const bet = data.bets.find((b) => b.id === betId);
      if (!bet) return fail("bet-not-found");
      const team = data.teams.find((t) => t.id === bet.teamId);
      if (!team || !currentUserId) return fail("team-not-found");
      if (!permitCloseBetEarly(team, currentUserId, bet)) {
        return fail("creator-or-mod-only-close");
      }
      // Task 8's second guard. A duel's "betting window" is its ACCEPT window,
      // and closing it early is not a thing anyone can want: the challengee
      // either accepts (which closes the bet, D2), declines, or lets it lapse.
      // Refused outright rather than quietly aliased to something — a bet
      // nobody may wager in has no wagering window to close, and `close_bet_early`
      // says exactly this sentence server-side.
      if (bet.kind === "duel") {
        return fail("duel-no-betting-window");
      }
      const effectiveState = computeEffectiveState(bet, Date.now());
      if (!canTransitionBetState(effectiveState, "closed")) {
        return fail(
          effectiveState === "resolved"
            ? "bet-already-resolved"
            : "betting-already-closed",
        );
      }

      const result = await betDb.closeBetEarly(supabase, bet.id);
      if (!result.ok || !result.closedAt) {
        return result.ok ? fail("bet-close-failed") : result;
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
   *
   * **ONE mutator resolves every bet, pool and duel alike (Extra Phase 2, task
   * 8), because one RPC does.** `resolve_bet` was extended with a fourth
   * argument rather than joined by a sibling `resolve_duel`, so there is still
   * exactly one place in the schema that writes a resolution and moves the
   * balances behind it. What forks — here and inside the RPC, in the same shape
   * — is AUTHORIZATION and the precondition:
   *
   *   * a pool bet keeps `canResolveBet` (creator, moderator or leader) and
   *     `canTransitionBetState` over its effective state;
   *   * a duel gets `canResolveDuel` (the named mediator, or any moderator when
   *     the ROW says so — never a participant, D6/D7) and `computeDuelPhase`,
   *     because "has betting closed?" is the wrong question to ask of a bet
   *     whose stakes are placed by accepting it.
   *
   * `app.can_manage_bet` was deliberately NOT widened to admit the mediator,
   * server-side: three RPCs share it, and one line there would have handed the
   * mediator `delete_bet` and `close_bet_early` too. That is this phase's named
   * risk 1, and the client mirrors the fork rather than the shortcut.
   */
  const resolveBet = useCallback(
    async (betId: string, resolution: BetResolution): Promise<MutationResult> => {
      const bet = data.bets.find((b) => b.id === betId);
      if (!bet) return fail("bet-not-found");
      const team = data.teams.find((t) => t.id === bet.teamId);
      if (!team || !currentUserId) return fail("team-not-found");

      const duel = data.duels.find((d) => d.betId === bet.id);
      if (duel) {
        if (!permitResolveDuel(team, currentUserId, duel)) {
          return fail("duel-resolver-only");
        }
        // D8 half (a) decides the sentence here, not just the gate. An expired
        // unaccepted duel already READS as void on every surface before
        // anything has persisted it, and the RPC sweeps stale duels before it
        // looks at state — so by the time it answers, that duel really is
        // resolved and it says so. Reporting "hasn't been accepted yet" for the
        // expired case would be a client sentence the server would never
        // produce, and it would tell a mediator to wait for an acceptance that
        // can no longer arrive.
        const phase = computeDuelPhase(bet, duel, Date.now());
        if (phase === "settled" || phase === "expired") {
          return fail("bet-already-resolved");
        }
        if (phase !== "accepted") {
          return fail("duel-not-accepted");
        }
      } else {
        if (!permitResolveBet(team, currentUserId, bet)) {
          return fail("creator-or-mod-only-resolve");
        }
        const effectiveState = computeEffectiveState(bet, Date.now());
        if (!canTransitionBetState(effectiveState, "resolved")) {
          return fail(
            effectiveState === "open"
              ? "close-before-resolve"
              : "bet-already-resolved",
          );
        }
      }
      if (
        resolution.kind === "winner" &&
        !bet.options.some((o) => o.id === resolution.winningOptionId)
      ) {
        return fail("winning-option-required");
      }

      const result = await betDb.resolveBet(supabase, { betId: bet.id, resolution });
      if (!result.ok) return result;

      // D3, and the one place this file mirrors a SQL DEFAULT rather than
      // reading a value back. `resolve_bet` stores `'mediator'` when a DUEL is
      // voided and the caller named no reason — it can, because the only way to
      // reach that line is a human resolver who passed `app.can_resolve_duel`.
      // The argument sent stays `undefined` (bet-mutations.ts is explicit that
      // the client does not guess it, and PostgREST needs the null for the
      // default to apply); what is mirrored is only the LOCAL copy, so the
      // history row does not sit there reasonless for the rest of the session
      // while Postgres holds a reason. A pool bet is untouched by this — its
      // void writes NULL no matter what was passed, which is precisely why D3
      // needed no backfill.
      const applied: BetResolution =
        duel && resolution.kind === "void"
          ? { kind: "void", reason: resolution.reason ?? "mediator" }
          : resolution;

      // No local balance patch here (negative-balance drift fix): the payout
      // `resolve_bet` wrote reaches this same client as its own
      // `member-update` echo, exactly as it reaches every other open tab —
      // `result.deltas` is no longer read for anything but has stayed on the
      // RPC's return shape (see bet-mutations.ts) since `resolve_bet` has no
      // cheaper snapshot to offer for potentially dozens of wagerers at once.
      dispatch({
        type: "resolve-bet",
        teamId: bet.teamId,
        betId: bet.id,
        resolution: applied,
      });
      return ok;
    },
    [supabase, data.bets, data.teams, data.duels, currentUserId],
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
      if (!bet) return fail("bet-not-found");
      const team = data.teams.find((t) => t.id === bet.teamId);
      if (!team || !currentUserId) return fail("team-not-found");
      if (!permitDeleteBet(team, currentUserId, bet)) {
        return fail("creator-or-mod-only-delete");
      }
      // D6, task 8's third guard: a duel may be deleted only BEFORE it is
      // accepted. Once both stakes are down, deleting is the challenger's
      // escape hatch from a bet they are losing — the honest exits after
      // acceptance are a resolution or a void, both of which move money through
      // `app.settle_bet` and leave a history row. Before acceptance there is
      // nothing to protect: the ordinary delete path's `app.reverse_bet_effects`
      // already refunds the challenger's stake, which is why one refusal is the
      // whole change and no second reversal path exists.
      //
      // `canDeleteDuel` rather than an inline `acceptedAt === null`, so the
      // composite rule (`canDeleteBet` AND unaccepted) has exactly one written
      // form; and the check reads the stored fact, never the clock — an EXPIRED
      // unaccepted duel is still deletable, and both routes refund the same
      // coins to the same person.
      const duel = data.duels.find((d) => d.betId === bet.id);
      if (duel && !permitDeleteDuel(team, currentUserId, bet, duel)) {
        return fail("duel-delete-after-accept");
      }

      const result = await betDb.deleteBet(supabase, bet.id);
      if (!result.ok) return result;

      // No local balance patch (see `resolveBet` above for the same note) —
      // `delete_bet`'s reversal arrives as this client's own `member-update`
      // echo.
      dispatch({ type: "delete-bet", teamId: bet.teamId, betId: bet.id });
      return ok;
    },
    [supabase, data.bets, data.teams, data.duels, currentUserId],
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
      if (!bet) return fail("bet-not-found");
      const team = data.teams.find((t) => t.id === bet.teamId);
      if (!team || !currentUserId || !permitComment(team, currentUserId)) {
        return fail("member-only-comment");
      }
      const firstIssue = validateCommentBody(body)[0];
      if (firstIssue) return fail(firstIssue.code, { values: firstIssue.values });

      const result = await betDb.addComment(supabase, {
        betId: bet.id,
        userId: currentUserId,
        body: body.trim(),
      });
      if (!result.ok || !result.comment) {
        return result.ok ? fail("comment-failed") : result;
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

  // --- 1v1 duels: three write paths, one lifecycle (roadmap §8 Extra Phase 2) ---
  //
  // D1-D9. A duel is a `bets` row with `kind='duel'` plus a 1:1 `bet_duels`
  // side row, so everything below reuses the machinery that already exists:
  // `resolve_bet` resolves it, `delete_bet` deletes it, `app.settle_bet`
  // settles it, and `enforce_bet_state_transition` — the one trigger in this
  // schema with no service-context escape hatch — still sees only the two legal
  // hops it has always seen. Nothing here is a second settlement path, and the
  // temptation to write one (a "simpler" direct transfer between two people)
  // is this phase's named risk 3: it would end up a coin apart from
  // `resolve_bet` somewhere and break `delete_bet`'s reversal.
  //
  // Each mutator gates locally with the SAME shared predicates the RPC's SQL
  // twins evaluate, and returns the RPC's own sentence on refusal, which is why
  // the strings below are byte-identical to the ones in
  // `20260906130100_duel_rpcs.sql`. The client gate is not the enforcement —
  // every rule below is re-checked in one transaction with the row locked —
  // it is what lets a surface say why before a round trip.
  //
  // ARC-014, once more where the code is rather than only in the interface
  // above: nothing here notifies anybody. No push, no email, no bell, no tab
  // title. A challenge that lapses in 24 hours is the single most tempting
  // thing in this product to tap someone on the shoulder about, and D4's answer
  // is that the FEED RE-ORDERS for the person who owes an answer — Extra Phase
  // 3's job, on the surfaces, out of `computeDuelPhase` and the ids on these
  // rows. Nothing in this file is asked to change for it.

  /**
   * Send a challenge (D1/D5/D9, roadmap task 8).
   *
   * `canStartDuel` is PLAIN MEMBERSHIP and is deliberately not `canCreateBet`:
   * D9 says a `restricted` team does not ration duels, because DOM-002 rations
   * bets posted for a team to wager into and a duel is a private arrangement
   * between two people who have already agreed to it. What a restricted team
   * gets instead is a guarantee it never has to ask for — `create_duel` stores
   * `any_moderator = true` for any duel created while the team is restricted,
   * whatever the challenger ticked. That coercion is NOT mirrored here and must
   * not be: it lives in the RPC, inside the transaction that reads the team's
   * access mode, and this function takes the server's answer back rather than
   * predicting it (`result.duel.anyModerator` below, never `draft.anyModerator`).
   * Predicting it locally would be a second copy of D9 that goes stale the
   * moment the leader flips the mode mid-compose.
   *
   * The local patch afterwards rebuilds what the RPC wrote from what it
   * returned plus what this client already knows. Two values are echoes rather
   * than reads, and both are safe in a way worth stating:
   *
   *   * The option LABELS. `create_duel` snapshots the two participants'
   *     `users.display_name` at insert time (bet_options has no UPDATE path at
   *     all, by design, so a later rename must not silently relabel a bet
   *     somebody has already wagered on). This client reads the same two names
   *     out of `data.users`. They can only differ if a rename raced the
   *     insert, which is cosmetic and gone on the next load.
   *   * `placedAt` on the challenger's wager, taken from the bet's
   *     `created_at`. `now()` in Postgres is the TRANSACTION timestamp, and all
   *     six rows are one transaction, so `wagers.placed_at` and
   *     `bets.created_at` are the same instant to the microsecond — not
   *     approximately, exactly.
   */
  const startDuel = useCallback(
    async (draft: NewDuelDraft): Promise<MutationResult> => {
      const ctx = requireContext();
      if (!ctx) return fail("team-not-found");
      if (!permitStartDuel(ctx.team, ctx.userId)) {
        return fail("not-a-member");
      }
      const balance =
        ctx.team.members.find((m) => m.userId === ctx.userId)?.coinBalance ?? 0;
      const firstIssue = validateDuelDraft(draft, {
        team: ctx.team,
        challengerId: ctx.userId,
        balance,
      })[0];
      if (firstIssue) return fail(firstIssue.code, { values: firstIssue.values });

      // Normalised once, here, so the same value is validated, sent and stored
      // locally. `validateDuelDraft` trims before it compares and treats an
      // empty mediator as "none", so a form that binds an empty string to a
      // cleared picker passes validation — and would then send `""` as a uuid
      // and get a type error from PostgREST instead of a sentence.
      const challengeeId = draft.challengeeId.trim();
      const mediatorId = draft.mediatorId?.trim() || null;

      const result = await betDb.startDuel(supabase, {
        teamId: ctx.team.id,
        title: draft.title,
        iconEmoji: draft.iconEmoji,
        challengeeId,
        mediatorId,
        anyModerator: draft.anyModerator,
        stake: draft.stake,
      });
      if (!result.ok || !result.duel) {
        return result.ok ? fail("duel-create-failed") : result;
      }

      const started = result.duel;
      const nameOf = (userId: string) =>
        data.users.find((u) => u.id === userId)?.displayName ?? "?";
      const bet: Bet = {
        id: started.betId,
        teamId: ctx.team.id,
        creatorId: ctx.userId,
        title: draft.title.trim(),
        iconEmoji: draft.iconEmoji?.trim() || undefined,
        // Position 0 IS the challenger and position 1 IS the challengee — the
        // convention `create_duel` fixed with an explicit `values` list, which
        // every surface, every test and `accept_duel` itself depend on.
        // `option_ids` comes back in that order.
        options: [
          { id: started.optionIds[0], label: nameOf(ctx.userId) },
          { id: started.optionIds[1], label: nameOf(challengeeId) },
        ],
        // D2: `open` with `closesAt` = the ACCEPT deadline, so the existing
        // clock carries "waiting to be accepted" — UX-008's sort, the countdown
        // and `computeEffectiveState` all work with no duel-specific branch and
        // no fourth bet state.
        state: "open",
        closesAt: started.closesAt,
        // Task 6's structural guarantee, and the reason this phase adds no
        // payout code: a per-user cap equal to the stake makes a third wager on
        // this bet impossible even if a write path ever leaked, which is what
        // lets `settleBet` be reused unchanged.
        maxWagerPerUser: draft.stake,
        kind: "duel",
        createdAt: started.createdAt,
      };
      const duel: Duel = {
        betId: started.betId,
        challengerId: ctx.userId,
        challengeeId,
        mediatorId,
        // AS STORED, not as sent — D9's coercion, taken from the server's
        // answer. See this function's doc comment.
        anyModerator: started.anyModerator,
        stake: draft.stake,
        acceptedAt: null,
        // Equal to the bet's `closesAt` at creation, and the two stay equal
        // until `accept_duel` moves the bet's to now(). After that this is the
        // only surviving record of when the challenge would have lapsed.
        expiresAt: started.closesAt,
      };
      const wager: Wager = {
        id: started.wagerId,
        betId: started.betId,
        userId: ctx.userId,
        optionId: started.optionIds[0],
        amount: draft.stake,
        placedAt: started.createdAt,
      };
      dispatch({ type: "start-duel", teamId: ctx.team.id, bet, duel, wager });
      // Instant feedback (negative-balance drift fix), exactly as `placeWager`
      // does: `create_duel` already returns the post-debit snapshot.
      dispatch({
        type: "set-balance",
        teamId: ctx.team.id,
        userId: ctx.userId,
        balanceAfter: started.balanceAfter,
      });
      return ok;
    },
    [supabase, requireContext, data.users],
  );

  /**
   * Accept a challenge (D2/D5, roadmap task 8) — the challengee's stake, and
   * the bet's move into AWAITING RESULT.
   *
   * Both halves of the guard are needed and neither implies the other, which is
   * the single most likely bug in every duel surface Extra Phase 3 will build:
   * `canAcceptDuel` is a roster+id rule (a member, the challengee, not yet
   * accepted) and never looks at the clock, while `computeDuelPhase` is the
   * clock and knows nothing about who is asking. An unaccepted duel past its
   * deadline is EXPIRED before anything has persisted the void (D8 half (a)),
   * so accepting it must be refused here even though the stored row still says
   * `open` and `accepted_at is null`. The server agrees the hard way: it sweeps
   * stale duels for the team before it reads the row, so what it refuses is a
   * duel that is already void and already refunded.
   *
   * DOM-014 is absolute (D5): the balance check below is the same one
   * `accept_duel` re-runs with the member row LOCKED, and the sentence is
   * `validateWager`'s own. Nothing is ever accepted on credit, and the surface's
   * answer to a refusal is `declineDuel(betId, "insufficient-funds")` — which
   * is exactly why that void reason exists as a distinct value.
   */
  const acceptDuel = useCallback(
    async (betId: string): Promise<MutationResult> => {
      const bet = data.bets.find((b) => b.id === betId);
      if (!bet) return fail("bet-not-found");
      const team = data.teams.find((t) => t.id === bet.teamId);
      const member = team?.members.find((m) => m.userId === currentUserId);
      if (!team || !member || !currentUserId) {
        return fail("not-a-member");
      }
      // The duel row and the challengee's side of it, together: position 1 is
      // theirs by the convention `create_duel` fixed, and `toBet` sorts options
      // by `position` precisely so an index means what it says here. A duel bet
      // with fewer than two options cannot exist — `create_duel` writes both in
      // the same statement — so this reads as one "is this a well-formed duel"
      // test with one sentence, rather than two guards for a state the schema
      // cannot produce.
      const duel = data.duels.find((d) => d.betId === bet.id);
      const challengeeSide = bet.options[1];
      if (!duel || !challengeeSide) return fail("not-a-duel");

      // ONE call to the shared predicate, then the sentence chosen by asking
      // which of its clauses failed — the same shape `closeBetEarly` above uses
      // after `canTransitionBetState`, and it keeps `canAcceptDuel` the single
      // written form of the rule instead of an inlined copy of its three
      // conditions. Identity is tested before acceptance because `accept_duel`
      // tests them in that order: a stranger tapping an already-accepted duel
      // must be told it is not theirs, not that it is taken.
      if (!permitAcceptDuel(team, currentUserId, duel)) {
        return fail(
          currentUserId !== duel.challengeeId
            ? "duel-not-challengee-accept"
            : "duel-already-accepted",
        );
      }
      const phase = computeDuelPhase(bet, duel, Date.now());
      if (phase !== "pending") {
        // One knowingly benign divergence, recorded so nobody hunts it: for a
        // duel that is BOTH resolved and past its deadline (every declined or
        // swept one, since voiding pulls `closes_at` back to the moment it
        // happened) `accept_duel` tests the clock first and says "expired",
        // while `computeDuelPhase` puts `resolved` first — deliberately, so a
        // duel settled yesterday does not read as expired today — and lands
        // here on "no longer open". Both are true, both refuse, and the phase's
        // ordering is the one the whole feature is built on.
        return fail(phase === "expired" ? "duel-expired" : "duel-not-open");
      }
      if (duel.stake > member.coinBalance) return fail("over-balance");

      const result = await betDb.acceptDuel(supabase, bet.id);
      if (!result.ok || !result.accepted) {
        return result.ok ? fail("duel-accept-failed") : result;
      }

      dispatch({
        type: "accept-duel",
        teamId: team.id,
        betId: bet.id,
        acceptedAt: result.accepted.acceptedAt,
        closesAt: result.accepted.closesAt,
        wager: {
          id: result.accepted.wagerId,
          betId: bet.id,
          userId: currentUserId,
          optionId: challengeeSide.id,
          amount: duel.stake,
          // The server's clock again, and the same transaction-timestamp
          // argument as `startDuel`: `accept_duel` reads `now()` once and the
          // wager's default takes the same value, so `acceptedAt` IS this
          // wager's `placed_at`.
          placedAt: result.accepted.acceptedAt,
        },
      });
      // Instant feedback (negative-balance drift fix), exactly as `placeWager`
      // and `startDuel` do: `accept_duel` already returns the post-debit
      // snapshot.
      dispatch({
        type: "set-balance",
        teamId: team.id,
        userId: currentUserId,
        balanceAfter: result.accepted.balanceAfter,
      });
      return ok;
    },
    [supabase, data.bets, data.teams, data.duels, currentUserId],
  );

  /**
   * Refuse a challenge (D3/D5, roadmap task 8): the bet is voided, the
   * challenger's stake comes back, and the reason is recorded as a suffix on
   * the void rather than as a second kind of it.
   *
   * **The clock is deliberately not consulted here, and the asymmetry with
   * `acceptDuel` directly above is the interesting part.** Declining a duel
   * that has already expired is harmless: both paths void it and refund the
   * challenger identically, through the same `app.settle_bet`. So
   * `decline_duel` is the one duel RPC that does NOT sweep stale duels first —
   * sweeping there would turn a no-consequence action into an error for no gain
   * — and this mutator matches it. Refusing an expired challenge locally would
   * be a client-side rule the server does not have, and it would strand a
   * challengee who tapped Decline a second after the deadline with an error
   * about a duel that was about to be voided anyway.
   *
   * `reason` is narrowed to two values at the type level (`DuelDeclineReason`)
   * and again server-side. The other three `BetVoidReason`s are not the
   * challengee's to claim: `'mediator'` belongs to whoever resolved the duel,
   * `'expired'` is written by the sweep with no human in the loop, and
   * `'participant-left'` by the kick/ban/leave cascade.
   */
  const declineDuel = useCallback(
    async (
      betId: string,
      reason: betDb.DuelDeclineReason = "declined",
    ): Promise<MutationResult> => {
      const bet = data.bets.find((b) => b.id === betId);
      if (!bet) return fail("bet-not-found");
      const team = data.teams.find((t) => t.id === bet.teamId);
      if (!team || !currentUserId) return fail("not-a-member");
      const duel = data.duels.find((d) => d.betId === bet.id);
      if (!duel) return fail("not-a-duel");

      // `canDeclineDuel` answers false for BOTH "not the challengee" and
      // "already accepted", so the sentence is chosen by asking which clause
      // failed — identity first, matching `decline_duel`'s own check order.
      if (!permitDeclineDuel(team, currentUserId, duel)) {
        return fail(
          currentUserId !== duel.challengeeId
            ? "duel-not-challengee-decline"
            : "duel-already-accepted",
        );
      }
      // `bet.state`, not `computeDuelPhase` — this is the one duel guard that
      // must not consult the clock (see the doc comment above). An already
      // resolved challenge is gone; an expired-but-unswept one is still
      // declinable, and declining it lands in the same place the sweep would.
      if (bet.state === "resolved") {
        return fail("duel-not-open");
      }

      const result = await betDb.declineDuel(supabase, bet.id, reason);
      if (!result.ok) return result;

      // The refund `app.void_duel` applied (via `app.settle_bet(bet, 'void',
      // null)` — the SQL twin of `settleBet`) is no longer read from
      // `result.deltas` here: it reaches the challenger, on every open tab
      // including this one, as its own `member-update` echo.
      dispatch({ type: "void-duel", teamId: bet.teamId, betId: bet.id, reason });
      return ok;
    },
    [supabase, data.bets, data.teams, data.duels, currentUserId],
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
      dispatchChat({ type: "error", error: error ?? "chat-load-failed" });
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
      if (!ctx) return fail("team-not-found");
      if (!permitComment(ctx.team, ctx.userId)) {
        return fail("member-only-chat");
      }
      const firstIssue = validateChatMessage(body)[0];
      if (firstIssue) return fail(firstIssue.code, { values: firstIssue.values });

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
      if (!currentUserId) return fail("not-signed-in");
      const firstIssue = validateTeamDraft(draft)[0];
      if (firstIssue) return fail(firstIssue.code, { values: firstIssue.values });

      const result = await db.createTeam(supabase, draft);
      if (!result.ok) return result;

      await reload();
      // UX-010: switching re-scopes the whole app.
      if (result.teamId) setCurrentTeamId(result.teamId);
      return ok;
    },
    [supabase, currentUserId, reload],
  );

  /**
   * UX-005/DOM-005/006 + A-4, amended by `plan-invite-links.md`: permanent by
   * default, a link may now also be a 24-hour one that dies on its own or be
   * revoked by hand — bans still keep a banned user out regardless of which
   * kind of link they hold.
   */
  const joinTeamByCode = useCallback(
    async (code: string): Promise<MutationResult> => {
      if (!currentUserId) return fail("not-signed-in");
      const firstIssue = validateInviteCode(code)[0];
      if (firstIssue) return fail(firstIssue.code, { values: firstIssue.values });

      // The client's own copy of canJoinTeam only answers for teams it can
      // already see; the authoritative check is inside join_team_with_code.
      // D7: this matches against EVERY non-revoked link the team holds, not
      // one scalar code — a live 24-hour link joins exactly like the
      // permanent one. Liveness (`isInviteLive`) is deliberately NOT checked
      // here: the RPC is the authority on expiry (D3), and a stale local
      // match against an already-expired code still reaches
      // `join_team_with_code`, which is what actually refuses it.
      const known = data.teams.find((t) =>
        t.invites.some((i) => i.code.toLowerCase() === code.trim().toLowerCase()),
      );
      if (known && !permitJoinTeam(known, currentUserId)) {
        return fail("already-in-team", { values: { team: known.name } });
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
   *
   * Extra Phase 2 task 11 gives the departure a second half: any DUEL the
   * leaver is a participant in is voided and the survivor refunded, because
   * dropping one of exactly two leaves the other's stake with nothing to settle
   * against. `departureCascade` above computes both halves together and
   * explains why their ORDER is a mirror of the RPC's rather than a choice.
   * The duel deltas are the only part of this the server derives entirely on
   * its own — a client-supplied list of BALANCE DELTAS would be free coins, as
   * `20260905150000_bet_rpcs.sql`'s header says in as many words — so what is
   * computed here is the local patch, and `app.void_duels_for_departing_member`
   * is the authority.
   */
  const removeMember = useCallback(
    async (userId: string, ban: boolean): Promise<MutationResult> => {
      const ctx = requireContext();
      if (!ctx) return fail("team-not-found");
      const permitted = ban ? permitBan : permitKick;
      if (!permitted(ctx.team, ctx.userId)) {
        return fail("manager-only-remove-member");
      }
      if (userId === ctx.userId) {
        return fail("cannot-remove-self");
      }
      if (userId === ctx.team.leaderId) {
        return fail("cannot-remove-leader");
      }
      if (!ctx.team.members.some((m) => m.userId === userId)) {
        return fail("member-not-on-team");
      }

      const cascade = departureCascade(data, ctx.team.id, userId);

      const result = await db.removeMembership(supabase, {
        teamId: ctx.team.id,
        userId,
        ban,
        wagerIds: cascade.removedWagerIds,
      });
      if (!result.ok) return result;

      dispatch({
        type: "remove-membership",
        teamId: ctx.team.id,
        userId,
        ban,
        wagers: cascade.keptWagers,
        voidedBetIds: cascade.voidedBetIds,
      });
      return ok;
    },
    [supabase, requireContext, data],
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
      if (!ctx) return fail("team-not-found");
      if (!permitManageTeam(ctx.team, ctx.userId)) {
        return fail("manager-only-team-settings");
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
   * `plan-invite-links.md` D2/D5/D6/D8: mint one link, permanent or 24-hour.
   * `requireContext` → permit → db → reload, the same idiom `createTeam` and
   * `joinTeamByCode` already use — an invite link is not one of the
   * dashboard's live-scoped facts (D10), so the round trip earns its own
   * reload rather than a hand-rolled local patch.
   *
   * Gate order matters and mirrors the RPC exactly: DOM-006's access-mode
   * check first (`manager-only-invite`, `permitInvite` — the same predicate
   * `canInvite` above is built from), THEN D6/D8's per-kind blocker
   * (`inviteCreationBlocker`, which needs to know WHICH kind is being
   * requested and returns its own `MutationErrorCode` directly — no `fail()`
   * mapping table to keep in step with `invites.ts`'s two string literals).
   * Both are advice: `create_invite_code` re-checks everything inside its own
   * transaction, because a concurrent create from another tab can always land
   * between this read and that write (the same sentence `inviteCreationBlocker`'s
   * own doc comment makes).
   */
  const createInvite = useCallback(
    async (temporary: boolean): Promise<MutationResult & { inviteId?: string }> => {
      const ctx = requireContext();
      if (!ctx) return fail("team-not-found");
      if (!permitInvite(ctx.team, ctx.userId)) {
        return fail("manager-only-invite");
      }
      const blocker = inviteCreationBlocker(ctx.team, Date.now(), temporary);
      if (blocker === "invite-temp-cap") {
        return fail(blocker, {
          values: { max: CONFIG.INVITE_MAX_LIVE_TEMPORARY_PER_TEAM },
        });
      }
      if (blocker) return fail(blocker);

      const result = await db.createInviteCode(supabase, {
        teamId: ctx.team.id,
        temporary,
      });
      if (!result.ok) return result;

      await reload();
      return result;
    },
    [supabase, requireContext, reload],
  );

  /**
   * D4/D5: revoke one link by id. The invite is looked up in the CURRENT
   * `team.invites` rather than trusted from the caller, for the same reason
   * `removeMember` looks the member up on the roster before acting: a stale
   * id (a link already gone from a list rendered a while ago) fails here as
   * `team-not-found` instead of reaching the RPC with nothing local to show
   * for it either way, and `reload()` on success is what actually clears a
   * stale list, exactly as it is for `createInvite` above.
   */
  const revokeInvite = useCallback(
    async (inviteId: string): Promise<MutationResult> => {
      const ctx = requireContext();
      if (!ctx) return fail("team-not-found");
      const invite = ctx.team.invites.find((i) => i.id === inviteId);
      if (!invite) return fail("team-not-found");
      if (!permitRevokeInvite(ctx.team, ctx.userId, invite)) {
        return fail("creator-or-mod-only-revoke-invite");
      }

      const result = await db.revokeInviteCode(supabase, inviteId);
      if (!result.ok) return result;

      await reload();
      return ok;
    },
    [supabase, requireContext, reload],
  );

  /**
   * DOM-033/034: leader-only hard delete. Unlike Phase 2, deleting your only
   * team is allowed now — Phase 5 has a screen for having no team (the create/
   * join gate), so refusing would only trap the leader in a team they wanted
   * gone.
   */
  const deleteTeam = useCallback(async (): Promise<MutationResult> => {
    const ctx = requireContext();
    if (!ctx) return fail("team-not-found");
    if (!permitDeleteTeam(ctx.team, ctx.userId)) {
      return fail("leader-only-delete-team");
    }

    const result = await db.deleteTeam(supabase, ctx.team.id);
    if (!result.ok) return result;

    dispatch({ type: "delete-team", teamId: ctx.team.id });
    setCurrentTeamId(null);
    return ok;
  }, [supabase, requireContext]);

  /**
   * The membership and its per-team balance go; wagers — and, since Extra
   * Phase 2, duels — cascade exactly as on a kick. One `departureCascade` call
   * serves both, because DOM-032 draws no distinction between being removed and
   * walking out: the money consequences are identical and the leaver's duels
   * strand their opponent either way.
   */
  const leaveTeam = useCallback(async (): Promise<MutationResult> => {
    const ctx = requireContext();
    if (!ctx) return fail("team-not-found");
    if (!permitLeaveTeam(ctx.team, ctx.userId)) {
      return fail(
        ctx.team.leaderId === ctx.userId ? "leader-cannot-leave" : "not-a-member",
      );
    }

    const cascade = departureCascade(data, ctx.team.id, ctx.userId);

    const result = await db.removeMembership(supabase, {
      teamId: ctx.team.id,
      userId: ctx.userId,
      ban: false,
      wagerIds: cascade.removedWagerIds,
    });
    if (!result.ok) return result;

    dispatch({
      type: "remove-membership",
      teamId: ctx.team.id,
      userId: ctx.userId,
      ban: false,
      wagers: cascade.keptWagers,
      voidedBetIds: cascade.voidedBetIds,
    });
    setCurrentTeamId(null);
    return ok;
  }, [supabase, requireContext, data]);

  /** UX-022: name, curated name color, avatar — applied everywhere at once. */
  const updateProfile = useCallback(
    async (draft: ProfileDraft): Promise<MutationResult> => {
      if (!currentUserId) return fail("not-signed-in");
      const user = data.users.find((u) => u.id === currentUserId);
      if (!user) return fail("profile-not-found");
      const firstIssue = validateProfileDraft(draft)[0];
      if (firstIssue) return fail(firstIssue.code, { values: firstIssue.values });

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
      if (!currentUserId) return fail("not-signed-in");
      const user = data.users.find((u) => u.id === currentUserId);
      if (!user) return fail("profile-not-found");

      const onboardedAt = new Date().toISOString();

      if (draft) {
        const firstIssue = validateProfileDraft(draft)[0];
        if (firstIssue) return fail(firstIssue.code, { values: firstIssue.values });

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
      if (!ctx) return fail("team-not-found");
      if (!permitInjectCoins(ctx.team, ctx.userId)) {
        return fail("leader-only-inject");
      }
      if (!ctx.team.members.some((m) => m.userId === userId)) {
        return fail("member-not-on-team");
      }
      const firstIssue = validateInjection(amount)[0];
      if (firstIssue) return fail(firstIssue.code, { values: firstIssue.values });

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
      userById(currentUserId) ?? {
        id: currentUserId,
        displayName: "?",
        nameColor: "#909592",
        avatar: "",
        // "Never chose" — Accept-Language keeps deciding (UX-027, D3), which
        // is the right answer for an identity we do not have a row for yet.
        locale: null,
      };

    const member = team.members.find((m) => m.userId === currentUser.id) ?? null;
    const isLeader = team.leaderId === currentUser.id;
    const isModerator = member?.role === "moderator";

    const balance = member?.coinBalance ?? 0;

    const bets = data.bets.filter((b) => b.teamId === team.id);
    const betIds = new Set(bets.map((b) => b.id));
    const wagers = data.wagers.filter((w) => betIds.has(w.betId));
    const transactions = data.transactions.filter((t) => t.teamId === team.id);
    const comments = data.comments.filter((c) => betIds.has(c.betId));
    // Scoped through the bet ids exactly as `wagers` and `comments` are, and
    // here it is the ONLY way: `bet_duels` has no `team_id` column at all (D1 —
    // the bet owns the team), which is the same fact that makes RLS reach the
    // table through `app.is_bet_team_member(bet_id)` and makes its realtime
    // binding impossible to filter server-side.
    //
    // UX-010, confirmed rather than assumed: `duels` rides `TeamData`, whose
    // only whole-world write is the `"replace"` action, so a reload swaps duels
    // out with everything else. Switching TEAMS does not refetch anything at
    // all in this app — `setTeamId` moves a single id and this memo re-derives
    // every list above from the one loaded world — so duels are re-scoped by
    // the same line that re-scopes bets, in the same render, and cannot lag a
    // switch. (Chat is the exception, and has its own reset effect precisely
    // because it is NOT a `TeamData` field.)
    const duels = data.duels.filter((d) => betIds.has(d.betId));
    const duelByBetId = new Map(duels.map((d) => [d.betId, d]));
    const duelFor = (betId: string) => duelByBetId.get(betId);

    const { richest, poorest, bottomFive } = deriveStandings(team.members);

    const rankBadgeFor = (userId: string): RankBadgeKind | null => {
      const richestIndex = richest.findIndex((m) => m.userId === userId);
      if (richestIndex === 0) return "1";
      if (richestIndex === 1) return "2";
      if (richestIndex === 2) return "3";
      if (richestIndex === 3 || richestIndex === 4) return "top5";
      if (bottomFive.has(userId)) return "bottom5";
      return null;
    };

    // DOM-012: raw `b.state` never flips on a scheduled close, so this badge
    // held a lapsed pool bet as "open" indefinitely, disagreeing with that
    // team's own feed the moment it's opened. `Date.now()` rather than a
    // threaded clock, same as closeBetEarly/resolveBet's own gates below:
    // this is called at render time by team-switcher.tsx, not itself a
    // ticking hook, so there is nothing to memoize a clock into.
    const openBetCountFor = (teamId: string): number =>
      data.bets.filter(
        (b) => b.teamId === teamId && effectiveBetState(b, Date.now()) === "open",
      ).length;

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
      canRevokeInvite: (invite: TeamInvite) =>
        permitRevokeInvite(team, currentUser.id, invite),
      canManage: permitManageTeam(team, currentUser.id),
      canInject: permitInjectCoins(team, currentUser.id),
      canDelete: permitDeleteTeam(team, currentUser.id),
      canLeave: permitLeaveTeam(team, currentUser.id),
      balance,
      bets,
      wagers,
      transactions,
      comments,
      duels,
      duelFor,
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
      startDuel,
      acceptDuel,
      declineDuel,
      loadChat,
      loadEarlierChat,
      sendChatMessage,
      markChatSeen,
      createTeam,
      joinTeamByCode,
      kickMember,
      banMember,
      updateTeamSettings,
      createInvite,
      revokeInvite,
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
    startDuel,
    acceptDuel,
    declineDuel,
    loadChat,
    loadEarlierChat,
    sendChatMessage,
    markChatSeen,
    createTeam,
    joinTeamByCode,
    kickMember,
    banMember,
    updateTeamSettings,
    createInvite,
    revokeInvite,
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
