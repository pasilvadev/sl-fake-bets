import type { BetState, Team } from "./types";

/**
 * Pure domain validation — the single source of truth shared by client-side
 * gating today (Phase 1) and server-side RPCs later (Phases 5–7). UI code
 * must route its gating through these instead of re-deriving the rules.
 */

export interface ValidationIssue {
  code:
    | "title-required"
    | "options-min"
    | "closes-at-required"
    | "closes-at-past"
    | "max-wager-invalid"
    | "amount-invalid"
    | "over-max-wager"
    | "over-balance";
  message: string;
}

/** Options floor is 2, deliberately no maximum (decision §4.5 on DOM-007). */
export const MIN_BET_OPTIONS = 2;

/** Draft payload for creating a bet (DOM-007/008/017). */
export interface BetDraft {
  title: string;
  /** Raw option labels — blank entries are ignored (the form keeps empty slots). */
  options: string[];
  /** ISO datetime the bet auto-closes (DOM-012). */
  closesAt: string;
  maxWagerPerUser: number;
}

/** DOM-007: title + ≥2 options + close time; DOM-017: sane per-user max. */
export function validateBetDraft(draft: BetDraft, nowMs: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (draft.title.trim().length === 0) {
    issues.push({ code: "title-required", message: "Give the bet a title." });
  }

  const options = draft.options.filter((o) => o.trim().length > 0);
  if (options.length < MIN_BET_OPTIONS) {
    issues.push({
      code: "options-min",
      message: `A bet needs at least ${MIN_BET_OPTIONS} options.`,
    });
  }

  const closesAtMs = Date.parse(draft.closesAt);
  if (draft.closesAt.trim().length === 0 || Number.isNaN(closesAtMs)) {
    issues.push({ code: "closes-at-required", message: "Pick a close time." });
  } else if (closesAtMs <= nowMs) {
    issues.push({
      code: "closes-at-past",
      message: "Close time must be in the future.",
    });
  }

  if (!Number.isInteger(draft.maxWagerPerUser) || draft.maxWagerPerUser < 1) {
    issues.push({
      code: "max-wager-invalid",
      message: "Max wager per user must be at least 1.",
    });
  }

  return issues;
}

export interface WagerCheck {
  amount: number;
  /** Placing user's per-team coinBalance (DOM-013/014). */
  balance: number;
  maxWagerPerUser: number;
  /**
   * The user's existing total stake on this bet — DOM-017's per-user max caps
   * the user's TOTAL on the bet, otherwise repeat wagers trivially bypass it.
   */
  existingStake?: number;
}

/** DOM-014 (never over balance / negative) + DOM-017 (per-user max). */
export function validateWager(check: WagerCheck): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const existingStake = check.existingStake ?? 0;

  if (!Number.isInteger(check.amount) || check.amount < 1) {
    issues.push({
      code: "amount-invalid",
      message: "Wager must be a positive whole amount.",
    });
    return issues;
  }
  if (check.amount + existingStake > check.maxWagerPerUser) {
    issues.push({
      code: "over-max-wager",
      message: `Max ${check.maxWagerPerUser} per user on this bet.`,
    });
  }
  if (check.amount > check.balance) {
    issues.push({ code: "over-balance", message: "Not enough coins." });
  }
  return issues;
}

const LEGAL_BET_TRANSITIONS: Record<BetState, readonly BetState[]> = {
  open: ["closed"],
  closed: ["resolved"],
  resolved: [],
};

/** DOM-012: strictly ordered lifecycle — open→closed→resolved, nothing else. */
export function canTransitionBetState(from: BetState, to: BetState): boolean {
  return LEGAL_BET_TRANSITIONS[from].includes(to);
}

/**
 * DOM-001's exactly-one-leader invariant as its own explicit, named check for
 * reuse anywhere leadership matters: the team names exactly one leader (the
 * single `leaderId` field) and that leader is actually on the roster.
 */
export function hasExactlyOneLeader(
  team: Pick<Team, "leaderId" | "members">,
): boolean {
  return (
    team.leaderId.trim().length > 0 &&
    team.members.some((m) => m.userId === team.leaderId)
  );
}
