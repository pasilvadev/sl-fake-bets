/**
 * Domain model for SL Fake Bets (see agent-docs/AGENT_SPEC.md).
 * Phase 1: these types shape the mock data; Phase 2+ maps them onto Postgres.
 * Designed so notification events can hang off them later without redesign (ARC-015).
 */

/** Two assignable roles (DOM-003). Leader is a status on the team, not a role. */
export type TeamRole = "moderator" | "member";

/** Who may create bets/invites (DOM-002). */
export type TeamAccessMode = "free-for-all" | "restricted";

/** Strictly ordered lifecycle (DOM-012). */
export type BetState = "open" | "closed" | "resolved";

/**
 * Which SHAPE of bet a row is (D1, Extra Phase 2) — and the entirety of what
 * `Bet` itself learns about duels. Everything kind-specific lives in `Duel`
 * below, keyed by bet id, so `Bet` never grows a second set of mostly-null
 * fields describing a shape 99% of its rows are not. The next kind after this
 * one is a single member added here plus a single side interface; it is never
 * six more optional fields on `Bet`, and that is the whole point of having a
 * discriminator at all.
 *
 * SQL twin: the `public.bet_kind` enum and `bets.kind`
 * (`not null default 'pool'`) in `20260906130000_duel_schema.sql`. The column
 * default is what makes every pre-existing row correct with no backfill, and
 * it is also why `Bet.kind` below is REQUIRED rather than optional: no row
 * that comes out of the database can lack one, so a mapper or fixture that
 * forgets it is a bug the compiler should catch here, not a `?? "pool"`
 * quietly written at each of the dozen read sites — where the failure mode is
 * a duel rendering as an ordinary pool bet, which is exactly the bug nobody
 * would notice until someone wagered into it.
 */
export type BetKind = "pool" | "duel";

/**
 * WHY a bet was voided (D3, Extra Phase 2). Nullable next to a `"void"`
 * resolution, and `null` for every pool bet and for every void that already
 * existed before this phase — so D3 costs no backfill.
 *
 * An enum rather than free text because the next feature that voids a bet for
 * a new reason should have to add a value in three coordinated places (here,
 * `public.bet_void_reason`, and the copy that renders it) instead of inventing
 * a string convention no other reader knows about.
 *
 * The reason is a SUFFIX, never a second state. A void is still a void: every
 * stake refunded, zero realized P/L, one `VOID · REFUNDED` treatment on
 * screen — `settleBet`'s refund branch does not look at this field and must
 * not start. It exists so the history row can say the challengee *couldn't
 * afford it* rather than the flat "void" the owner rejected, and so that
 * `bets_void_reason_shape` (the CHECK that forbids a reason on a non-void
 * resolution) has something to enforce.
 *
 * - `"mediator"` — a human resolver declared a draw/void. The pre-duel
 *   meaning of every existing void, and the default a duel resolution falls
 *   back to when a resolver voids without saying why.
 * - `"declined"` — the challengee said no while the duel was still pending.
 * - `"insufficient-funds"` — the challengee wanted in and could not cover the
 *   stake. DOM-014 is absolute, so accept is refused and this is the decline
 *   path the UI offers instead (D5).
 * - `"expired"` — nobody accepted before `closesAt` (D8). Written by
 *   `app.expire_stale_duels`, lazily, whenever someone next looks.
 * - `"participant-left"` — a participant was kicked, banned, or left (task
 *   11). A departing MEDIATOR voids nothing (D7): `app.can_resolve_duel`
 *   falls back to the any-moderator pool at read time, so that duel is still
 *   resolvable and nothing is stranded.
 */
export type BetVoidReason =
  | "mediator"
  | "declined"
  | "insufficient-funds"
  | "expired"
  | "participant-left";

/** Resolution outcome (DOM-018/019). Only present when state is "resolved". */
export type BetResolution =
  | { kind: "winner"; winningOptionId: string }
  // draw/void — all wagers refunded. `reason` (D3) is OPTIONAL, and that is
  // not laziness: the column is nullable and nothing backfilled it, so every
  // void written before Extra Phase 2 legitimately has none. `undefined` here
  // means "voided, reason not recorded", never "voided for some other reason",
  // and no payout path may branch on it — see BetVoidReason above.
  | { kind: "void"; reason?: BetVoidReason };

/**
 * The UI languages a profile may store (UX-027, plan-i18n-ptbr.md D4).
 *
 * Here rather than in `apps/web/src/i18n/config.ts` because it describes a
 * COLUMN — `users.locale`, added by `20260907120000_user_locale.sql`, whose
 * CHECK constraint pins the same two values — and `types.ts` is where this
 * project keeps the shapes Postgres hands back. Everything else about
 * localization (the runtime list, the labels, the cookie, the negotiation)
 * stays in the web app, which is the only thing that renders.
 *
 * `en` first: it is the source locale, the key authority and the fallback.
 */
export type Locale = "en" | "pt-BR";

export interface User {
  id: string;
  /** Twitch-style customization (UX-022), all pre-filled with defaults (UX-002). */
  displayName: string;
  /** Hex color applied everywhere the name renders (chats and bets). */
  nameColor: string;
  /**
   * One of three things, all discriminated by `user-avatar.tsx`: a platform
   * icon id, an avatars-bucket URL (UX-022 upload), or an OAuth provider's
   * picture URL (the Phase 4 signup default).
   */
  avatar: string;
  /**
   * Chosen UI language, or `null` for "never chose" (UX-027, D3).
   *
   * `null` is load-bearing rather than a missing value: it is what lets
   * `Accept-Language` keep deciding for someone who has not expressed a
   * preference. Only `currentUser`'s is ever read — see
   * `components/shell/locale-sync.tsx` for the one thing that does with it.
   */
  locale: Locale | null;
}

export interface TeamMember {
  userId: string;
  role: TeamRole;
  /**
   * Per-team, never global (DOM-013). Non-negative in normal play (DOM-014:
   * wagers are capped at this value) with exactly one exception, per the owner
   * ruling of 2026-09-05: deleting a RESOLVED bet claws its payout back, and
   * that may leave a member who already spent it overdrawn. A leader injection
   * is how they get out.
   */
  coinBalance: number;
  /** Aggregated profit/loss standing (DOM-026) — feeds the "podium of the poor" (DOM-028). */
  profitLoss: number;
  joinedAt: string; // ISO datetime
}

export interface Team {
  id: string;
  name: string;
  /** Exactly one leader (DOM-001); holds all moderator powers plus leader-only ones (A-1). */
  leaderId: string;
  accessMode: TeamAccessMode;
  /** Non-expiring invite token (UX-005/DOM-005). */
  inviteCode: string;
  members: TeamMember[];
  /**
   * Banned users (DOM-031 + assumption A-4): a ban removes the membership AND
   * blocks re-joining via the invite link, which a kick does not. Kept as its
   * own list because the membership row is gone (Phase 3 maps it to a
   * `team_bans` table).
   */
  bannedUserIds: string[];
  createdAt: string;
}

export interface BetOption {
  id: string;
  label: string;
}

export interface Wager {
  id: string;
  betId: string;
  userId: string;
  optionId: string;
  amount: number;
  placedAt: string;
}

export interface Bet {
  id: string;
  teamId: string;
  creatorId: string;
  title: string;
  /** MVP icon input is emoji only (DOM-009). */
  iconEmoji?: string;
  options: BetOption[]; // at least 2 (DOM-007)
  state: BetState;
  /** Exactly when open→closed happens automatically (DOM-012). */
  closesAt: string;
  /**
   * Per-user max wager set by creator (DOM-017). On a duel this is not a
   * preference but a structural guarantee: `create_duel` writes it equal to
   * the stake, which makes a third wager impossible even if a write path ever
   * leaked (task 6). Cheaper than a new formula, and it is why duels need no
   * settlement code of their own.
   */
  maxWagerPerUser: number;
  resolution?: BetResolution;
  /**
   * pool vs duel (D1). REQUIRED — see `BetKind` for why this is not optional
   * even though it was added in a later phase than the rest of this interface.
   */
  kind: BetKind;
  createdAt: string;
}

/**
 * The duel half of a duel bet (D1, Extra Phase 2): 1:1 with the `Bet` whose
 * `kind` is `"duel"`, joined by `betId`, and deliberately a SEPARATE interface
 * rather than six optional fields bolted onto `Bet`. Two consequences worth
 * stating before someone "simplifies" them away:
 *
 *  - Every duel is also a full `Bet`, so `closesAt`, `state`, `resolution`,
 *    UX-008's sort, `computeEffectiveState` and the countdown all keep working
 *    with no special case (D2). A duel is not a fourth `BetState`.
 *  - There is no `teamId` here. A duel reaches its team through its bet, the
 *    way `Comment` does and unlike `ChatMessage`, which carries one. That is
 *    the same trade the chat migration argued in reverse: chat denormalizes
 *    because every read is an unbounded scroll and the join would repeat per
 *    page, while a duel is loaded exactly once alongside the bet it hangs off.
 *    It is also why the realtime binding on `bet_duels` cannot be filtered
 *    server-side by team and leans on RLS instead — there is no column to
 *    filter on, by design.
 *
 * Money is already gone from balances by the time you read this row (D5):
 * the challenger's stake left at creation and the challengee's at accept,
 * both as ordinary `wagers` rows through the same lock-then-debit sequence
 * `place_wager` uses. There is no escrow field here and there must not be one.
 */
export interface Duel {
  /** PK and FK at once — `bet_duels.bet_id references bets on delete cascade`. */
  betId: string;
  /** Sent the challenge, created the `Bet`, and holds position-0's option. */
  challengerId: string;
  /** Must answer it; holds position-1's option. Never equal to challengerId. */
  challengeeId: string;
  /**
   * The named resolver (D7): any teammate who is not one of the two
   * participants, or `null` when the duel relies on the any-moderator pool.
   * Goes `null` if that person's user row ever disappears, which strands
   * nothing precisely because `anyModerator` below is additive, not an
   * alternative.
   */
  mediatorId: string | null;
  /**
   * D7's additive half: any moderator or the leader may also resolve this,
   * whoever acts first, so a duel is never frozen behind one quiet person.
   * D9's stored guarantee too — a duel created while the team was
   * `restricted` has this `true` no matter what the challenger ticked, and
   * flipping the team's access mode afterwards never rewrites it. The row,
   * not the team's current settings, is the truth about who may resolve THIS
   * duel.
   */
  anyModerator: boolean;
  /** Symmetric, chosen by the challenger, paid by both sides (D5). >= 1. */
  stake: number;
  /**
   * When the challengee accepted, or `null` while the challenge is still
   * outstanding. Do NOT read this alone to decide what a duel is doing — an
   * unaccepted duel past its deadline is expired, and only
   * `computeDuelPhase(bet, duel, nowMs)` knows that, because the deadline
   * lives on the bet and the clock is nobody's stored state (D8).
   */
  acceptedAt: string | null;
  /**
   * The accept deadline, written equal to the bet's `closesAt` at creation.
   * Duplicated on purpose: `closesAt` is overwritten to `now()` on accept (D2
   * — a duel does exactly what `close_bet_early` does), so after acceptance
   * the bet no longer remembers when the challenge would have lapsed. This
   * field does, which is what lets a settled duel's history still say how long
   * the challengee took.
   */
  expiresAt: string;
}

/** Bet-scoped mini chat / comments (UX-018). */
export interface Comment {
  id: string;
  betId: string;
  userId: string;
  body: string;
  createdAt: string;
}

/**
 * Team-wide chat (UX-019, Extra Phase 1). Easy to mistake for `Comment` above
 * because the shapes rhyme, but the scope is the whole point: chat is
 * TEAM-scoped and lives on the dashboard (one channel per team, always
 * mounted), while comments are BET-scoped and live on the bet page (one
 * thread per bet). `teamId` here is a direct column, not reached through a
 * bet the way a comment reaches its team — every chat read is "this team,
 * this window, this page", and routing that through a bet join would put a
 * join on every scroll. Neither surface replaces the other, and they share
 * no table: this type has no `betId`, and `Comment` above gets no `teamId`.
 */
export interface ChatMessage {
  id: string;
  teamId: string;
  userId: string;
  body: string;
  createdAt: string;
}

/**
 * Coin-ledger entry (DOM-025): grants, leader injections, future donations.
 * Deliberately NOT per-wager (DOM-026) — wager outcomes only aggregate into
 * TeamMember.profitLoss.
 */
export interface Transaction {
  id: string;
  teamId: string;
  /** Whose balance this entry belongs to. */
  userId: string;
  kind: "onboarding-grant" | "daily-reward" | "injection" | "donation";
  /** Positive = credit, negative = debit. */
  amount: number;
  /** e.g. injector/donor display context; free text for the history row. */
  description: string;
  balanceAfter: number;
  createdAt: string;
}

/** Live pari-mutuel view of one option's pool share (DOM-016). */
export interface OptionPoolStat {
  optionId: string;
  label: string;
  total: number;
  /** Share of the whole pool, 0..1 (0 when the pool is empty). */
  share: number;
  /** Payout multiplier for 1 coin on this option (pool / optionTotal), null when no wagers on it. */
  multiplier: number | null;
}
