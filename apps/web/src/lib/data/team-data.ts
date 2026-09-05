import type {
  Bet,
  BetResolution,
  Comment,
  Team,
  TeamAccessMode,
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
 * `Team.inviteCode` is a row in `invite_codes`, `Team.bannedUserIds` is the
 * `team_bans` table. Those joins happen here, once, so nothing downstream has
 * to know the schema is not the model.
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
}

export const EMPTY_TEAM_DATA: TeamData = {
  users: [],
  onboarding: {},
  teams: [],
  bets: [],
  wagers: [],
  transactions: [],
  comments: [],
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

interface MemberRow {
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

interface InviteCodeRow {
  team_id: string;
  code: string;
}

interface BetOptionRow {
  id: string;
  label: string;
  position: number;
}

interface BetRow {
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
  created_at: string;
  bet_options: BetOptionRow[];
}

interface WagerRow {
  id: string;
  bet_id: string;
  option_id: string;
  user_id: string;
  amount: number;
  placed_at: string;
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

interface CommentRow {
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
  };
}

function toMember(row: MemberRow): TeamMember {
  return {
    userId: row.user_id,
    role: row.role,
    coinBalance: row.coin_balance,
    profitLoss: row.profit_loss,
    joinedAt: row.joined_at,
  };
}

/** Flattened resolution columns → types.ts's discriminated union (DOM-018/019). */
function toResolution(row: BetRow): BetResolution | undefined {
  if (row.resolution_kind === "winner" && row.winning_option_id) {
    return { kind: "winner", winningOptionId: row.winning_option_id };
  }
  if (row.resolution_kind === "void") return { kind: "void" };
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
    createdAt: row.created_at,
  };
}

function toWager(row: WagerRow): Wager {
  return {
    id: row.id,
    betId: row.bet_id,
    userId: row.user_id,
    optionId: row.option_id,
    amount: row.amount,
    placedAt: row.placed_at,
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

function toComment(row: CommentRow): Comment {
  return {
    id: row.id,
    betId: row.bet_id,
    userId: row.user_id,
    body: row.body,
    createdAt: row.created_at,
  };
}

// --- the load -----------------------------------------------------------------

/** Any PostgREST error, turned into the one sentence the UI can show. */
function firstError(
  ...results: { error: { message: string } | null }[]
): string | null {
  return results.find((r) => r.error)?.error?.message ?? null;
}

/**
 * One round of queries for everything the app renders, issued together rather
 * than in sequence — nine dependent awaits would make the dashboard's first
 * paint the sum of nine round-trips (UX-006 targets low-end devices on ordinary
 * connections).
 */
export async function loadTeamData(
  supabase: Client,
): Promise<{ data: TeamData; error: string | null }> {
  const [users, teams, members, bans, codes, bets, wagers, transactions, comments] =
    await Promise.all([
      supabase
        .from("users")
        .select("id, display_name, name_color, avatar, onboarded_at, profile_prefill"),
      supabase.from("teams").select("id, name, leader_id, access_mode, created_at"),
      supabase
        .from("team_members")
        .select("team_id, user_id, role, coin_balance, profit_loss, joined_at"),
      supabase.from("team_bans").select("team_id, user_id"),
      supabase.from("invite_codes").select("team_id, code").is("revoked_at", null),
      supabase
        .from("bets")
        .select(
          // The embed names its foreign key explicitly because `bets` and
          // `bet_options` are related BOTH ways (an option belongs to a bet;
          // a resolved bet points at its winning option), and PostgREST
          // refuses to guess which one an unqualified embed meant.
          "id, team_id, creator_id, title, icon_emoji, state, closes_at, max_wager_per_user, resolution_kind, winning_option_id, created_at, bet_options!bet_options_bet_id_fkey(id, label, position)",
        ),
      supabase.from("wagers").select("id, bet_id, option_id, user_id, amount, placed_at"),
      supabase
        .from("transactions")
        .select("id, team_id, user_id, kind, amount, description, balance_after, created_at"),
      supabase.from("comments").select("id, bet_id, user_id, body, created_at"),
    ]);

  const error = firstError(
    users, teams, members, bans, codes, bets, wagers, transactions, comments,
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

  // The partial unique index allows exactly one active code per team, so this
  // reproduces the `Team.inviteCode` scalar without a choice to make.
  const codeByTeam = new Map(codeRows.map((row) => [row.team_id, row.code]));

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
        inviteCode: codeByTeam.get(row.id) ?? "",
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
    },
  };
}
