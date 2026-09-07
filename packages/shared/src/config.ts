/**
 * Tunable product config — no magic numbers in app code (ARC-018, DOM-021/022, design-stack §4.4).
 * Values are references from the vision, meant for fine-tuning later.
 */

export interface BetDurationPreset {
  label: string;
  minutes: number;
  isDefault: boolean;
}

export const CONFIG = Object.freeze({
  /** Coins granted to every new user (DOM-021). Currency name is still an open decision (#1). */
  ONBOARDING_GRANT_COINS: 100,
  /** Unconditional grant on first login of each calendar day (DOM-022, assumption A-2). */
  DAILY_REWARD_COINS: 5,
  /** Soft planning target, not hard-enforced (DOM-004 / ARC-018, open decision #5). */
  TEAM_TARGET_SIZE: 30,
  /**
   * Exactly 3 presets + one pre-selected default (DOM-008).
   * PLACEHOLDER values — open decision #2; owner picks the real ones later.
   */
  BET_DURATION_PRESETS: [
    { label: "1 hour", minutes: 60, isDefault: false },
    { label: "24 hours", minutes: 60 * 24, isDefault: true },
    { label: "7 days", minutes: 60 * 24 * 7, isDefault: false },
  ] as readonly BetDurationPreset[],
  /**
   * Team chat message length cap (UX-019, Extra Phase 1). Has a SQL twin —
   * the `body` CHECK in `20260906120000_team_chat.sql` — that must move with
   * it: this is the value `validateChatMessage` enforces client-side, the
   * migration enforces it again at the row, and the two must never drift.
   */
  CHAT_MESSAGE_MAX_CHARS: 500,
  /**
   * Team chat retention window in days (UX-019, D1, Extra Phase 1).
   * HARD WARNING: this is NOT the authoritative interval. The one authority
   * is `app.chat_retention_interval()` in `20260906120000_team_chat.sql` —
   * every prune and every read-path window predicate calls that function,
   * never this constant. This number exists ONLY to drive user-facing copy
   * ("messages older than 30 days are cleared"). Change one and you must
   * change the other in the same commit, or the copy will lie about what
   * the database actually enforces.
   */
  CHAT_RETENTION_DAYS: 30,
  /**
   * How long a challenge stays open for the challengee to answer (D2/D8,
   * Extra Phase 2). `create_duel` writes `closes_at = now() + this window`, and
   * from that moment the EXISTING clock carries the whole feature: UX-008's
   * sort, the countdown, `computeEffectiveState` and `computeDuelPhase` all
   * read `bet.closesAt` with no duel-specific branch.
   *
   * HARD WARNING, in the same shape as CHAT_RETENTION_DAYS above: this is NOT
   * the authority. `app.duel_accept_window()` in
   * `20260906130100_duel_rpcs.sql` is — it is what actually computes the
   * deadline the row stores, and no client value is ever sent for it. This
   * constant exists to write the sentence ("they have 24 hours to accept") and
   * to preview the deadline in the compose form before the round trip.
   *
   * That makes it the FOURTH duplicated constant in this schema, after
   * `app.onboarding_grant_coins()` (DOM-021), `app.daily_reward_coins()`
   * (DOM-022) and `app.chat_retention_interval()` (UX-019). Every one of them
   * carries this same warning in both places on purpose: change one half and
   * the copy starts lying about what the database enforces, silently, with no
   * test to catch it. Change both in the same commit or change neither.
   */
  DUEL_ACCEPT_WINDOW_HOURS: 24,
  /**
   * How many challenges one person may have outstanding (unaccepted and
   * unresolved) in one team at once — Extra Phase 2 task 9's anti-spam cap.
   *
   * This is RATE CONTROL, NOT MODERATION, and the distinction matters enough
   * that the trigger enforcing it says so too: it bounds how many challenges
   * are in flight from one account and says nothing whatsoever about who they
   * are aimed at or what they say. DOM-030 (no content moderation, ever) is
   * untouched by it, and nobody reading this later should mistake a cap on
   * volume for permission to build one on content.
   *
   * Enforced server-side twice, both in `20260906130100_duel_rpcs.sql`: once
   * inside `create_duel` so the refusal is a sentence a person can read, and
   * again by the BEFORE INSERT trigger on `bet_duels` (SQLSTATE `SLD01`) so a
   * write arriving any other way is still bounded — the same belt-and-braces
   * shape `enforce_chat_flood_control` uses. The second half of the rule, "no
   * second PENDING challenge to the same person", is a partial unique index
   * rather than a count and raises `SLD02`. The client keys its copy on those
   * codes, never on the message text.
   *
   * The number lives here rather than in the trigger's body for the same
   * reason every other tunable does (ARC-018, design-stack §4 rule 4) — and
   * like the window above, the SQL copy must move with it.
   */
  DUEL_MAX_PENDING_PER_CHALLENGER: 3,
});

/** Suggested default per-user max wager = onboarding grant (DOM-017). */
export const DEFAULT_MAX_WAGER = CONFIG.ONBOARDING_GRANT_COINS;

/**
 * The 10 curated name colors (design-visual-identity.md §2.4) — the only
 * values `User.nameColor` may take (UX-022). Index + 1 lines up with the
 * `--name-color-N` CSS tokens and the `bg-name-color-N` swatch utilities, so
 * the profile picker can render a swatch and store a hex from one list.
 */
export const NAME_COLORS = Object.freeze([
  "#2C9297", // 1 Harbor Teal
  "#2C91AA", // 2 Signal Cyan
  "#2B8DBF", // 3 Skyline Blue
  "#2D88EC", // 4 Voltage Blue
  "#647BF1", // 5 Indigo Pulse
  "#8C70F2", // 6 Ultraviolet
  "#B45CF5", // 7 Neon Orchid
  "#DB36E3", // 8 Magenta Static
  "#EC35B3", // 9 Flare Pink
  "#F33483", // 10 Coral Flare
] as const);
