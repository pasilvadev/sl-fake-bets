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

/** Resolution outcome (DOM-018/019). Only present when state is "resolved". */
export type BetResolution =
  | { kind: "winner"; winningOptionId: string }
  | { kind: "void" }; // draw/void — all wagers refunded

export interface User {
  id: string;
  /** Twitch-style customization (UX-022), all pre-filled with defaults (UX-002). */
  displayName: string;
  /** Hex color applied everywhere the name renders (chats and bets). */
  nameColor: string;
  /** Platform icon id or uploaded-image URL. Mock data uses icon ids. */
  avatar: string;
}

export interface TeamMember {
  userId: string;
  role: TeamRole;
  /** Coin balance is per-team, never global (DOM-013). */
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
  /** Per-user max wager set by creator (DOM-017). */
  maxWagerPerUser: number;
  resolution?: BetResolution;
  createdAt: string;
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
