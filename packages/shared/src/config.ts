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
