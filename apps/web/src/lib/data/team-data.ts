import type {
  Bet,
  BetKind,
  BetResolution,
  BetVoidReason,
  Comment,
  Duel,
  Locale,
  MutationErrorCode,
  Team,
  TeamAccessMode,
  TeamInvite,
  TeamMember,
  TeamRole,
  Transaction,
  User,
  Wager,
} from "@repo/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Postgres → domain-model loader (roadmap Phase 5).
 *
 * Every read the app makes now comes from here. The queries carry no `where`
 * clause on team membership because they do not have to: RLS already scopes
 * each table to the teams the caller belongs to (Phase 3's policies), so
 * "select everything visible" IS "select my world". Adding a redundant filter
 * would mean two places to keep in agreement about what a member may see.
 *
 * The mapping is deliberately explicit rather than generated: `types.ts` is the
 * product's model and the schema is its Postgres representation, and Phase 3
 * recorded two places where the two shapes differ on purpose —
 * `Team.invites` is a group of rows in `invite_codes` (D7,
 * `plan-invite-links.md` — replaces the old `Team.inviteCode` scalar),
 * `Team.bannedUserIds` is the `team_bans` table. Those joins happen here,
 * once, so nothing downstream has to know the schema is not the model.
 *
 * Extra Phase 2 (1v1 duels) adds a third such difference and one thing this
 * module had never done before. The difference: a duel is a `bets` row with
 * `kind = 'duel'` plus a 1:1 side row in `bet_duels` (owner decision D1 — a
 * future bet kind is one enum value and one side table, never six more
 * nullable columns on `bets`), so `TeamData` carries `duels` alongside `bets`
 * and `Duel` hangs off `Bet` by id rather than being folded into it. The new
 * thing: `loadTeamData` now issues a WRITE before its reads —
 * `sweep_stale_duels` — and that call's own comment argues at length for why
 * it is sequential rather than folded into the parallel batch. Read it before
 * "optimising" a round trip away.
 */

/** The subset of supabase-js this module needs — untyped rows, mapped below. */
type Client = SupabaseClient;

/** How good the signup-time profile prefill was (roadmap Phase 7.5). */
export type ProfilePrefill = "provider" | "derived";

/**
 * The first-run profile step's two facts about one account: whether the step
 * is still owed (`onboardedAt === null`), and which of its two actions should
 * be primary when it is.
 *
 * Deliberately NOT on `@repo/shared`'s `User`. Every teammate object in the app
 * is a `User`, and these are a per-viewer concern about exactly one of them —
 * putting them there would make every fixture in `mock-data.ts` carry an
 * onboarding state it has no opinion about. They ride the `users` select, so
 * they cost no extra round trip.
 */
export interface OnboardingInfo {
  onboardedAt: string | null;
  prefill: ProfilePrefill;
}

export interface TeamData {
  users: User[];
  /** Keyed by user id — see OnboardingInfo for why this is not on `User`. */
  onboarding: Record<string, OnboardingInfo>;
  teams: Team[];
  bets: Bet[];
  wagers: Wager[];
  transactions: Transaction[];
  comments: Comment[];
  /**
   * The `bet_duels` side rows for whichever of `bets` above have
   * `kind === "duel"` (D1). A separate array rather than a field on `Bet`, and
   * separate for the same reason the type is: 99% of bets are pool bets that
   * would carry six `undefined`s each. Look one up with `team-context.tsx`'s
   * `duelFor(betId)`, which is the single place that indexing decision lives.
   */
  duels: Duel[];
}

export const EMPTY_TEAM_DATA: TeamData = {
  users: [],
  onboarding: {},
  teams: [],
  bets: [],
  wagers: [],
  transactions: [],
  comments: [],
  duels: [],
};

// --- row shapes ---------------------------------------------------------------
// Hand-written rather than `supabase gen types`: these are the only tables the
// app reads, and a generated 800-line file would have to be regenerated (and
// reviewed) on every migration for no gain at this size.

interface UserRow {
  id: string;
  display_name: string;
  name_color: string;
  avatar: string;
  // UX-027. NULL = never chose; Accept-Language keeps deciding (D3).
  locale: Locale | null;
  // Phase 7.5. Readable for teammates too (users_select_self_or_teammate is
  // row-wide), which is harmless — only the current user's pair is ever read.
  onboarded_at: string | null;
  profile_prefill: ProfilePrefill;
}

interface TeamRow {
  id: string;
  name: string;
  leader_id: string;
  access_mode: TeamAccessMode;
  created_at: string;
}

/**
 * A `team_members` row. Exported, unlike most row shapes in this file, for the
 * same reason `DuelRow` is: the realtime layer's `member-insert` event
 * (roadmap Phase 8 extension — see `realtime.ts`'s `subscribeTeamChannel`)
 * carries one of these verbatim off the wire, and `toMember` below maps it the
 * same way whether it arrived through `loadTeamData` or over the socket.
 */
export interface MemberRow {
  team_id: string;
  user_id: string;
  role: TeamRole;
  coin_balance: number;
  profit_loss: number;
  joined_at: string;
}

interface BanRow {
  team_id: string;
  user_id: string;
}

/**
 * A non-revoked `invite_codes` row (D7/plan-invite-links.md's `expires_at`
 * column, `20260907150000_invite_links.sql`). The query below already filters
 * `revoked_at is null`, so every row this shape describes is one `toInvite`
 * maps straight across with no extra branch for the revoked case.
 */
interface InviteCodeRow {
  id: string;
  team_id: string;
  code: string;
  created_by: string | null;
  created_at: string;
  expires_at: string | null;
}

interface BetOptionRow {
  id: string;
  label: string;
  position: number;
}

export interface BetRow {
  id: string;
  team_id: string;
  creator_id: string;
  title: string;
  icon_emoji: string | null;
  state: Bet["state"];
  closes_at: string;
  max_wager_per_user: number;
  resolution_kind: "winner" | "void" | null;
  winning_option_id: string | null;
  /**
   * `'pool' | 'duel'` (Extra Phase 2 task 1). NOT nullable and not optional:
   * the column is `not null default 'pool'`, so every row written before that
   * migration reads `'pool'` without a backfill having run, and every row
   * written since says which it is. Typing it optional here would invite a
   * `row.kind ?? "pool"` somewhere downstream that quietly disagreed with the
   * column's own default the day the default changed.
   */
  kind: BetKind;
  /**
   * D3's void reason, and the one resolution column that IS nullable for a
   * legitimate reason rather than a schema accident: `null` for every pool bet
   * forever, `null` for every void written before Extra Phase 2 (nothing was
   * backfilled), and one of five enum values for a duel void. See
   * `toResolution` for how that null becomes the union's optional `reason`.
   */
  void_reason: BetVoidReason | null;
  created_at: string;
  bet_options: BetOptionRow[];
}

export interface WagerRow {
  id: string;
  bet_id: string;
  option_id: string;
  user_id: string;
  amount: number;
  placed_at: string;
}

/**
 * A `bet_duels` row (Extra Phase 2 task 1) — the kind-specific half of a duel.
 *
 * Exported, unlike most row shapes in this file, because `realtime.ts`'s
 * `duel-upsert` event carries one of these verbatim off the wire. It can,
 * where a `bets` INSERT cannot: this table has no embed and no ordering
 * column, so every field the domain model needs is present in the payload and
 * the event is applied as-is. That is design-realtime.md §5 rule 2's normal
 * path; `bet-insert` has to fall back to `fetchBet` only because a bet without
 * its `bet_options` is not renderable.
 *
 * No `team_id`. Deliberately, and it is load-bearing twice: RLS reaches this
 * table through `app.is_bet_team_member(bet_id)` (the bet owns the team, D1),
 * and the realtime binding therefore cannot be filtered server-side the way
 * the `bets` and `chat_messages` ones are — see `subscribeTeamChannel`.
 */
export interface DuelRow {
  bet_id: string;
  challenger_id: string;
  challengee_id: string;
  mediator_id: string | null;
  any_moderator: boolean;
  stake: number;
  accepted_at: string | null;
  expires_at: string;
}

interface TransactionRow {
  id: string;
  team_id: string;
  user_id: string;
  kind: Transaction["kind"];
  amount: number;
  description: string;
  balance_after: number;
  created_at: string;
}

export interface CommentRow {
  id: string;
  bet_id: string;
  user_id: string;
  body: string;
  created_at: string;
}

// --- mappers ------------------------------------------------------------------

function toUser(row: UserRow): User {
  return {
    id: row.id,
    displayName: row.display_name,
    nameColor: row.name_color,
    avatar: row.avatar,
    locale: row.locale,
  };
}

export function toMember(row: MemberRow): TeamMember {
  return {
    userId: row.user_id,
    role: row.role,
    coinBalance: row.coin_balance,
    profitLoss: row.profit_loss,
    joinedAt: row.joined_at,
  };
}

/**
 * `invite_codes` row → `TeamInvite` (D7). Straight across, no revocation field
 * to translate — see `TeamInvite`'s own doc comment for why the type has none:
 * the query below already filters `revoked_at is null`, so a row reaching this
 * mapper was never revoked in the first place.
 */
function toInvite(row: InviteCodeRow): TeamInvite {
  return {
    id: row.id,
    code: row.code,
    createdBy: row.created_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

/**
 * D7's list order: permanent first (there is at most one live one, D1, but
 * this does not assume that — it only decides where a permanent row sorts
 * relative to temporary ones), then soonest-to-expire, then oldest-created.
 * The same order `invites.ts`'s `liveInvites` renders in, so a load and a
 * modal left open agree on where a link sits without either re-sorting the
 * other's work — this is the load-time order, that is the live-render order,
 * and D3 is why the two are allowed to differ only by which rows are IN the
 * list, never by how the shared ones are ordered.
 */
function compareInvites(a: TeamInvite, b: TeamInvite): number {
  if ((a.expiresAt === null) !== (b.expiresAt === null)) {
    return a.expiresAt === null ? -1 : 1;
  }
  if (a.expiresAt !== null && b.expiresAt !== null && a.expiresAt !== b.expiresAt) {
    return a.expiresAt.localeCompare(b.expiresAt);
  }
  return a.createdAt.localeCompare(b.createdAt);
}

/**
 * Flattened resolution columns → types.ts's discriminated union (DOM-018/019).
 *
 * Takes just the three columns rather than a whole `BetRow` because a Realtime
 * UPDATE payload (Phase 8) carries the bet's own columns and no embedded
 * options — the same three fields, arriving without the rest of the row. That
 * is also why `void_reason` is a REQUIRED key of this `Pick` rather than an
 * optional one, now that Extra Phase 2 has added it: `RealtimeBetRow` is
 * `Omit<BetRow, "bet_options">`, so the column rides every UPDATE payload
 * exactly as `resolution_kind` does, and making it optional here would buy
 * nothing except the ability for a future caller to forget to select it and
 * still compile.
 *
 * `void_reason ?? undefined` is where D3's nullable column meets the union's
 * OPTIONAL `reason`. The two are not the same shape and the translation is
 * one-directional on purpose: SQL `null` means "voided, reason not recorded"
 * — true of every pool-bet void forever and of every void written before
 * Extra Phase 2, since nothing backfilled them — and `BetResolution`'s void
 * arm has no `null` member, so `reason: null` would not even type-check. It
 * would also read as a third meaning that nothing consumes.
 *
 * Nothing downstream may branch a PAYOUT on this field. A void is a void: full
 * refund, zero realized P/L, the `VOID · REFUNDED` treatment, whether the
 * mediator called it, the challengee declined it, the challengee could not
 * afford it, the clock ran out, or a participant left the team. The reason is
 * a suffix the history line shows, never a second state (D3).
 */
export function toResolution(
  row: Pick<BetRow, "resolution_kind" | "winning_option_id" | "void_reason">,
): BetResolution | undefined {
  if (row.resolution_kind === "winner" && row.winning_option_id) {
    return { kind: "winner", winningOptionId: row.winning_option_id };
  }
  if (row.resolution_kind === "void") {
    return { kind: "void", reason: row.void_reason ?? undefined };
  }
  return undefined;
}

function toBet(row: BetRow): Bet {
  return {
    id: row.id,
    teamId: row.team_id,
    creatorId: row.creator_id,
    title: row.title,
    iconEmoji: row.icon_emoji ?? undefined,
    // `position` exists precisely because a set of rows has no order and
    // `Bet.options` is an ordered array.
    options: [...row.bet_options]
      .sort((a, b) => a.position - b.position)
      .map((o) => ({ id: o.id, label: o.label })),
    state: row.state,
    closesAt: row.closes_at,
    maxWagerPerUser: row.max_wager_per_user,
    resolution: toResolution(row),
    // Straight across — the discriminator every duel-aware surface reads
    // BEFORE it asks `duelFor(betId)`, so that a pool bet never pays for a
    // lookup that could only ever miss.
    kind: row.kind,
    createdAt: row.created_at,
  };
}

export function toWager(row: WagerRow): Wager {
  return {
    id: row.id,
    betId: row.bet_id,
    userId: row.user_id,
    optionId: row.option_id,
    amount: row.amount,
    placedAt: row.placed_at,
  };
}

/**
 * `bet_duels` row → `Duel`. Exported for the same reason `toWager` and
 * `toComment` are: `realtime.ts` delivers rows of this shape that this module
 * never loaded, and team-context.tsx maps them with this function so a duel
 * that arrived over the socket is byte-for-byte the object a duel that arrived
 * through `loadTeamData` is.
 *
 * There is deliberately no clock in here. `acceptedAt` and `expiresAt` are
 * copied across untouched and nothing in this mapper decides what the duel is
 * currently DOING — `computeDuelPhase(bet, duel, nowMs)` (state-machine.ts)
 * owns that question, and it needs the bet as well as the duel to answer it,
 * because D8 half (a) says an unaccepted duel past `bet.closesAt` reads as
 * expired before anything has persisted the void. A mapper that helpfully
 * returned an `isExpired` boolean would freeze that answer at load time and be
 * silently wrong 24 hours later with nothing having changed in Postgres. Same
 * reason `computeEffectiveState` is not baked into `toBet`.
 */
export function toDuel(row: DuelRow): Duel {
  return {
    betId: row.bet_id,
    challengerId: row.challenger_id,
    challengeeId: row.challengee_id,
    mediatorId: row.mediator_id,
    anyModerator: row.any_moderator,
    stake: row.stake,
    acceptedAt: row.accepted_at,
    expiresAt: row.expires_at,
  };
}

function toTransaction(row: TransactionRow): Transaction {
  return {
    id: row.id,
    teamId: row.team_id,
    userId: row.user_id,
    kind: row.kind,
    amount: row.amount,
    description: row.description,
    balanceAfter: row.balance_after,
    createdAt: row.created_at,
  };
}

export function toComment(row: CommentRow): Comment {
  return {
    id: row.id,
    betId: row.bet_id,
    userId: row.user_id,
    body: row.body,
    createdAt: row.created_at,
  };
}

/**
 * The bets select, shared by the full load and Phase 8's single-bet hydration.
 *
 * The embed names its foreign key explicitly because `bets` and `bet_options`
 * are related BOTH ways (an option belongs to a bet; a resolved bet points at
 * its winning option), and PostgREST refuses to guess which one an unqualified
 * embed meant.
 *
 * `kind` and `void_reason` (Extra Phase 2) are listed here rather than in the
 * one caller that "needs" them, because BOTH callers do: `fetchBet` hydrates a
 * bet that arrived as a realtime INSERT, and a duel's `bets` row is the first
 * half of a duel reaching this client. A `BetRow` missing `kind` would map to
 * a `Bet` whose required `kind` was `undefined` at runtime while type-checking
 * clean — the exact failure an explicit, hand-written select list is supposed
 * to make impossible.
 */
const BET_SELECT =
  "id, team_id, creator_id, title, icon_emoji, state, closes_at, max_wager_per_user, resolution_kind, winning_option_id, kind, void_reason, created_at, bet_options!bet_options_bet_id_fkey(id, label, position)";

/**
 * One bet, by id — the only read Phase 8's realtime layer performs.
 *
 * A `bets` INSERT event carries the bet's own columns and nothing from
 * `bet_options`, and a bet without its options is not renderable, so a new
 * remote bet costs exactly one scoped round trip for one row. That is the
 * shape design-realtime.md §5 rule 2 permits: a single row, not the world —
 * `loadTeamData`'s ten unbounded queries are what a handler must never call.
 *
 * RLS answers the authorization question for free: a bet in a team the caller
 * does not belong to comes back as no rows.
 */
export async function fetchBet(
  supabase: Client,
  betId: string,
): Promise<Bet | null> {
  const { data, error } = await supabase
    .from("bets")
    .select(BET_SELECT)
    .eq("id", betId)
    .maybeSingle();
  if (error || !data) return null;
  return toBet(data as unknown as BetRow);
}

/** What `fetchUser` hydrates a brand-new user id into — `User` for every
 * surface that renders one, `OnboardingInfo` alongside it only because the
 * two ride the same `users` row and `loadTeamData` never separates them
 * either (see `OnboardingInfo`'s own doc comment for why it is not a `User`
 * field). */
export interface FetchedUser {
  user: User;
  onboarding: OnboardingInfo;
}

/**
 * One user, by id — the realtime layer's second scoped fetch (Phase 8
 * extension), for `member-insert` events whose `user_id` this client has
 * never seen before: a brand-new account (no prior team ever put them in this
 * client's `users` array) joining by invite code while an existing member's
 * dashboard is open. Without this, `userById` answers `undefined` for the
 * joiner everywhere — the roster, the standings module, and any bet or wager
 * they place, whose "created by" would otherwise render blank until the next
 * full load.
 *
 * RLS (`users_select_self_or_teammate`) is what makes this safe to call the
 * instant the `member-insert` event fires and not a moment before: the
 * `team_members` row it is reacting to has already committed by then, so the
 * joiner is already a teammate and the policy already admits this row. A
 * caller who is not on the same team gets no rows, same as `fetchBet`.
 */
export async function fetchUser(
  supabase: Client,
  userId: string,
): Promise<FetchedUser | null> {
  const { data, error } = await supabase
    .from("users")
    .select(
      "id, display_name, name_color, avatar, locale, onboarded_at, profile_prefill",
    )
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as UserRow;
  return {
    user: toUser(row),
    onboarding: { onboardedAt: row.onboarded_at, prefill: row.profile_prefill },
  };
}

// --- the load -----------------------------------------------------------------

/**
 * Any PostgREST error, turned into the one CODE the UI can show (D8/D9).
 *
 * It used to hand back `error.message` — a Postgres sentence, in English,
 * straight onto the load-failed screen. That was the read-path twin of the
 * `fail(error.message)` D9 closed on the write path, and it gets the same
 * treatment: the raw text and its SQLSTATE go to the log, where they are
 * actually useful, and the reader gets one localized sentence.
 */
function firstError(
  ...results: { error: { message: string; code?: string } | null }[]
): MutationErrorCode | null {
  const hit = results.find((r) => r.error)?.error;
  if (!hit) return null;
  console.error(
    `[team-data] load failed ${hit.code ?? "(no SQLSTATE)"}: ${hit.message}`,
  );
  return "team-load-failed";
}

/**
 * One round of queries for everything the app renders, issued together rather
 * than in sequence — ten dependent awaits would make the dashboard's first
 * paint the sum of ten round-trips (UX-006 targets low-end devices on ordinary
 * connections).
 *
 * TEN since Extra Phase 2, not nine: `bet_duels` joined the batch, and the
 * count is written down in design-scale-and-free-tier.md §2.2 rather than left
 * to drift, because §4.1 already named this function the app's egress
 * weakness. The reason a tenth was affordable here when chat's was not is
 * boundedness, not size: `bet_duels` holds at most one row per duel bet, so it
 * grows with the `bets` table this function already loads in full and can
 * never outgrow it, whereas `chat_messages` grows with a message rate no bet
 * count bounds. That asymmetry is why `chat.ts` loads lazily on first mount
 * and this does not — and it is the bar the ELEVENTH query has to clear.
 */
export async function loadTeamData(
  supabase: Client,
): Promise<{ data: TeamData; error: MutationErrorCode | null }> {
  // D8 half (b): persist any duel nobody accepted before its deadline, BEFORE
  // reading the world. Sequential, on purpose, and the round trip it costs on
  // cold start is not an oversight to fold into the Promise.all below.
  //
  // `sweep_stale_duels` loops the caller's own team memberships and voids each
  // stale duel: `bets` (state → resolved, resolution_kind → 'void',
  // void_reason → 'expired') and `team_members` (the challenger's stake back)
  // both move. Issued alongside the ten reads, it would race them — the writes
  // could land after the `bets` select and before the `team_members` select,
  // handing this client a bet still reading `open` next to a balance that had
  // already been refunded for it. Phase 7's consistency guard replays
  // `deriveProfitLoss` over exactly that pair, so the snapshot would surface
  // as a drift report about a corruption that never happened. One extra round
  // trip is the price of a coherent snapshot, and it is cheap: the sweep does
  // nothing at all on the overwhelmingly common load where no duel expired.
  //
  // D8 half (a) is what makes the FEATURE correct regardless:
  // `computeDuelPhase` reads an unaccepted duel past `bet.closesAt` as expired
  // whether or not this call ever ran, so a failed sweep costs nobody a
  // correct screen — only a delayed refund, which the next sweep applies.
  // Which is precisely why the result is dropped here and deliberately NOT
  // threaded into `firstError` below: a load that showed the member no teams,
  // no bets and no balance because a refund could not be persisted this second
  // would be strictly worse than a load that shows the whole world with one
  // duel's coins still sitting where the next sweep will move them. PostgREST
  // reports failures in `.error` rather than by rejecting, so this bare await
  // cannot throw past this line either.
  await supabase.rpc("sweep_stale_duels");

  const [users, teams, members, bans, codes, bets, wagers, transactions, comments, duels] =
    await Promise.all([
      supabase
        .from("users")
        // `locale` is UX-027's whole server-side cost: one more column on a
        // SELECT that was already happening, zero extra queries. D3 explains
        // why the root layout does NOT read it instead.
        .select(
          "id, display_name, name_color, avatar, locale, onboarded_at, profile_prefill",
        ),
      supabase.from("teams").select("id, name, leader_id, access_mode, created_at"),
      supabase
        .from("team_members")
        .select("team_id, user_id, role, coin_balance, profit_loss, joined_at"),
      supabase.from("team_bans").select("team_id, user_id"),
      supabase
        .from("invite_codes")
        .select("id, team_id, code, created_by, created_at, expires_at")
        .is("revoked_at", null),
      supabase.from("bets").select(BET_SELECT),
      supabase.from("wagers").select("id, bet_id, option_id, user_id, amount, placed_at"),
      supabase
        .from("transactions")
        .select("id, team_id, user_id, kind, amount, description, balance_after, created_at"),
      supabase.from("comments").select("id, bet_id, user_id, body, created_at"),
      // No `where` clause, exactly like every other query here — and here the
      // reason is not merely that RLS suffices but that there is nothing to
      // filter ON: `bet_duels` carries no team column at all (D1 — the bet
      // owns the team), and `bet_duels_select_bet_team_member` scopes it via
      // `app.is_bet_team_member(bet_id)`. "Select everything visible" is once
      // again "select my world", one level of indirection deeper.
      supabase
        .from("bet_duels")
        .select(
          "bet_id, challenger_id, challengee_id, mediator_id, any_moderator, stake, accepted_at, expires_at",
        ),
    ]);

  const error = firstError(
    users, teams, members, bans, codes, bets, wagers, transactions, comments, duels,
  );
  if (error) return { data: EMPTY_TEAM_DATA, error };

  const memberRows = (members.data ?? []) as MemberRow[];
  const banRows = (bans.data ?? []) as BanRow[];
  const codeRows = (codes.data ?? []) as InviteCodeRow[];

  const membersByTeam = new Map<string, TeamMember[]>();
  for (const row of memberRows) {
    const list = membersByTeam.get(row.team_id) ?? [];
    list.push(toMember(row));
    membersByTeam.set(row.team_id, list);
  }

  const bansByTeam = new Map<string, string[]>();
  for (const row of banRows) {
    bansByTeam.set(row.team_id, [...(bansByTeam.get(row.team_id) ?? []), row.user_id]);
  }

  // D7: every non-revoked link this team holds, grouped by team. Ordering is
  // applied once at assembly below (`compareInvites`), the same way
  // `membersByTeam` defers its sort to the final `Team.members` line rather
  // than sorting a group that might still gain more rows here.
  const invitesByTeam = new Map<string, TeamInvite[]>();
  for (const row of codeRows) {
    const list = invitesByTeam.get(row.team_id) ?? [];
    list.push(toInvite(row));
    invitesByTeam.set(row.team_id, list);
  }

  const userRows = (users.data ?? []) as UserRow[];

  return {
    error: null,
    data: {
      users: userRows.map(toUser),
      onboarding: Object.fromEntries(
        userRows.map((row) => [
          row.id,
          { onboardedAt: row.onboarded_at, prefill: row.profile_prefill },
        ]),
      ),
      teams: ((teams.data ?? []) as TeamRow[]).map((row) => ({
        id: row.id,
        name: row.name,
        leaderId: row.leader_id,
        accessMode: row.access_mode,
        invites: (invitesByTeam.get(row.id) ?? []).sort(compareInvites),
        // Roster order is not a product decision anywhere, so join order it is
        // — stable across reloads, and oldest-first reads as a history.
        members: (membersByTeam.get(row.id) ?? []).sort((a, b) =>
          a.joinedAt.localeCompare(b.joinedAt),
        ),
        bannedUserIds: bansByTeam.get(row.id) ?? [],
        createdAt: row.created_at,
      })),
      bets: ((bets.data ?? []) as BetRow[]).map(toBet),
      wagers: ((wagers.data ?? []) as WagerRow[]).map(toWager),
      transactions: ((transactions.data ?? []) as TransactionRow[]).map(toTransaction),
      comments: ((comments.data ?? []) as CommentRow[]).map(toComment),
      // Unsorted, unlike `Team.members` above: duels are looked up by bet id
      // (`duelFor`), never iterated for display in their own right — the bets
      // they hang off carry the ordering every surface actually renders.
      duels: ((duels.data ?? []) as DuelRow[]).map(toDuel),
    },
  };
}
