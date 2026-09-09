/**
 * Tunable product config — no magic numbers in app code (ARC-018, DOM-021/022, design-stack §4.4).
 * Values are references from the vision, meant for fine-tuning later.
 */

export interface BetDurationPreset {
  /**
   * The whole preset. No `label` since UX-027: a duration chip has to read
   * "24 hours" or "24 horas" depending on the reader, and this package cannot
   * know which. `create-bet-modal.tsx` derives the label from `minutes` via
   * the `createBetModal.duration*` messages — which is strictly better than
   * the string it replaced, because open decision #2 says these numbers are
   * placeholders the owner will retune, and a hand-typed "24 hours" beside a
   * changed `minutes` would have been a lie the compiler could not see.
   */
  minutes: number;
  isDefault: boolean;
}

export const CONFIG = Object.freeze({
  /** Coins granted to every new user (DOM-021). Currency name is still an open decision (#1). */
  ONBOARDING_GRANT_COINS: 100,
  /**
   * Unconditional grant on first login of each calendar day (DOM-022,
   * assumption A-2). Retuned from the vision's reference value of 5 to 10 by
   * owner order 2026-09-09, alongside the new weekly reward below. SQL twin:
   * `app.daily_reward_coins()`, now living in
   * `20260909100100_login_rewards_retune.sql` — that migration's
   * `create or replace` supersedes the function body first written in
   * `20260905170000_resolution_rewards_ledger.sql`, so a reader who finds the
   * old file first should follow the trail to the new one rather than trust
   * what is on the page there.
   */
  DAILY_REWARD_COINS: 10,
  /**
   * Unconditional grant once per (user, team, calendar WEEK) — the owner's
   * 2026-09-09 order, sibling to the daily reward above and granted the same
   * lazy way: on team load, once the current claim window has not already
   * been paid.
   *
   * HARD WARNING, in the same shape as `CHAT_RETENTION_DAYS` and
   * `DUEL_ACCEPT_WINDOW_HOURS` elsewhere in this file: this is NOT the
   * authority. `app.weekly_reward_coins()` in
   * `20260909100100_login_rewards_retune.sql` is — the grant has to be
   * decided inside the transaction that writes it, where TypeScript cannot
   * reach, exactly like the daily reward. This constant exists ONLY to write
   * the wallet readout ("Weekly login: +100"). Change one half and not the
   * other and the copy starts lying about what the database actually pays
   * out — change both in the same commit.
   *
   * The "week" is the ISO week in UTC — Monday 00:00 UTC through the instant
   * before the next Monday 00:00 UTC, i.e. Postgres's
   * `date_trunc('week', ...)`. That is the exact calendar the partial unique
   * index `transactions_one_weekly_reward_per_week_idx` counts against, and
   * `wallet-module.tsx`'s `utcWeekStart()` must compute the same boundary —
   * three places agreeing on one definition of "week" by construction, not by
   * coincidence.
   */
  WEEKLY_REWARD_COINS: 100,
  /** Soft planning target, not hard-enforced (DOM-004 / ARC-018, open decision #5). */
  TEAM_TARGET_SIZE: 30,
  /**
   * Exactly 3 presets + one pre-selected default (DOM-008).
   * PLACEHOLDER values — open decision #2; owner picks the real ones later.
   */
  BET_DURATION_PRESETS: [
    { minutes: 60, isDefault: false },
    { minutes: 60 * 24, isDefault: true },
    { minutes: 60 * 24 * 7, isDefault: false },
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
  /**
   * plan-hosted-early-access.md D1/D8: the password floor for the
   * create-account form. Has a config twin — `supabase/config.toml`'s
   * `[auth] minimum_password_length` — in the same duplicated-constant shape
   * every other value in this file warns about: this is what
   * `validateSignupDraft` checks client-side so a person reads the rule
   * before the round trip, GoTrue's own `weak_password` is the server
   * enforcing the SAME number, and the two must move together or the copy
   * starts lying about what the database actually accepts.
   */
  MIN_PASSWORD_LENGTH: 6,
  /**
   * The one temporary-link duration `plan-invite-links.md` (D2) offers: an
   * invite link that dies on its own after this many hours instead of living
   * until someone revokes it. `invite-modal.tsx`'s composer shows "{hours}
   * hours" for its opt-in option, derived from this number rather than a
   * hand-typed sentence, for the same reason `BET_DURATION_PRESETS.minutes`
   * above is not paired with a hand-typed label: the owner may retune it, and
   * this way the copy cannot fall out of step with the value.
   *
   * HARD WARNING, in the same shape as `DUEL_ACCEPT_WINDOW_HOURS` above: this
   * is NOT the authority. `app.invite_temporary_ttl()` in
   * `20260907150000_invite_links.sql` is — `create_invite_code` writes
   * `expires_at = now() + app.invite_temporary_ttl()` and no client value is
   * ever accepted for it (a client with a wrong clock could otherwise mint a
   * link that dies in the past or lives for years). This constant exists only
   * to write the sentence ("expires in 24 hours") and to preview the option
   * before the round trip. Change one half and the other must move with it in
   * the same commit, or the copy starts lying about what the database
   * actually enforces — silently, with no test to catch it.
   */
  INVITE_TEMPORARY_TTL_HOURS: 24,
  /**
   * At most this many LIVE 24-hour links per team at once (D6,
   * `plan-invite-links.md`) — rate control, not moderation (Extra Phase 2
   * task 9's sentence applies verbatim here too: this bounds volume and says
   * nothing about content). The permanent link is not counted by this number
   * at all; it has its own one-live-per-team rule (D1/D8), enforced by a
   * unique index rather than a count, because two permanents disagreeing on
   * "the" link is a correctness bug and eleven temporary links is merely
   * noise.
   *
   * HARD WARNING, same shape as every constant above: this is NOT the
   * authority. `app.invite_max_live_temporary_per_team()` in
   * `20260907150000_invite_links.sql` is — `create_invite_code` counts live
   * temporary rows against it inside the same transaction that inserts, and
   * raises SQLSTATE `SLI02` at the cap. This constant exists only to write the
   * refusal sentence (`errors.invite-temp-cap`, interpolating `{max}`) and to
   * disable the option client-side before the round trip. Change one half and
   * the other must move with it in the same commit.
   */
  INVITE_MAX_LIVE_TEMPORARY_PER_TEAM: 10,
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
