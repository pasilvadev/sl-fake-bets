import { CONFIG, NAME_COLORS } from "./config";
import type { BetState, Team, TeamAccessMode } from "./types";

/**
 * Pure domain validation — the single source of truth shared by client-side
 * gating today (Phase 1) and server-side RPCs later (Phases 5–7). UI code
 * must route its gating through these instead of re-deriving the rules.
 */

/**
 * Why a draft is invalid. The code was ALWAYS the contract here — this union
 * has been stable since Phase 1 — which is why the localization pass
 * (plan-i18n-ptbr.md D8) cost this layer a deleted field and nothing else.
 */
export type ValidationCode =
  | "title-required"
  | "options-min"
  | "closes-at-required"
  | "closes-at-past"
  | "max-wager-invalid"
  | "amount-invalid"
  | "over-max-wager"
  | "over-balance"
  | "team-name-required"
  | "display-name-required"
  | "name-color-invalid"
  | "avatar-required"
  | "comment-empty"
  | "invite-code-required"
  | "inject-amount-invalid"
  | "chat-empty"
  | "chat-too-long"
  // Extra Phase 2 (1v1 duels). Five codes for a form with four fields,
  // because "no target" and "yourself" want different sentences and the
  // resolver rule can fail two different ways.
  | "duel-target-required"
  | "duel-target-self"
  | "duel-mediator-invalid"
  | "duel-resolver-required"
  | "duel-stake-invalid";

/**
 * A rejected field, as a code the UI translates (D8).
 *
 * `message` is GONE. It was a convenience the UI should never have been
 * reading — a sentence produced in `@repo/shared`, which has no idea what
 * language the reader speaks — and every consumer now renders
 * `validation.<code>` from the message catalog instead.
 *
 * `values` is what survived of it, and only for the three codes whose sentence
 * quotes a number: the limit is domain knowledge this module already has, and
 * making each call site re-derive `CONFIG.CHAT_MESSAGE_MAX_CHARS` (or, worse,
 * the bet's own `maxWagerPerUser`) would put the same fact in two places. It
 * is a bag of ICU arguments, never a sentence — the distinction the deleted
 * field failed to make.
 */
export interface ValidationIssue {
  code: ValidationCode;
  values?: Record<string, string | number>;
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
    issues.push({ code: "title-required" });
  }

  const options = draft.options.filter((o) => o.trim().length > 0);
  if (options.length < MIN_BET_OPTIONS) {
    issues.push({
      code: "options-min",
      values: { min: MIN_BET_OPTIONS },
    });
  }

  const closesAtMs = Date.parse(draft.closesAt);
  if (draft.closesAt.trim().length === 0 || Number.isNaN(closesAtMs)) {
    issues.push({ code: "closes-at-required" });
  } else if (closesAtMs <= nowMs) {
    issues.push({ code: "closes-at-past" });
  }

  if (!Number.isInteger(draft.maxWagerPerUser) || draft.maxWagerPerUser < 1) {
    issues.push({ code: "max-wager-invalid" });
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
    issues.push({ code: "amount-invalid" });
    return issues;
  }
  if (check.amount + existingStake > check.maxWagerPerUser) {
    issues.push({
      code: "over-max-wager",
      values: { max: check.maxWagerPerUser },
    });
  }
  if (check.amount > check.balance) {
    issues.push({ code: "over-balance" });
  }
  return issues;
}

/**
 * Draft payload for challenging one teammate to a duel (Extra Phase 2, D1/D5/D7).
 *
 * Shorter than `BetDraft` on purpose, and every absence is a decision:
 *  - no `options` — `create_duel` generates exactly two from the participants'
 *    display names, position 0 = challenger, position 1 = challengee (DOM-007's
 *    floor is met structurally and there is nothing for a person to type);
 *  - no `closesAt` — the accept deadline is `now() + app.duel_accept_window()`
 *    (D2), never a client value, so there is no past-date rule to check here;
 *  - no `maxWagerPerUser` — it IS the stake (task 6), which is what makes a
 *    third wager impossible and a new settlement path unnecessary.
 */
export interface DuelDraft {
  title: string;
  /** Who is being challenged. A teammate, and never the challenger. */
  challengeeId: string;
  /** The named resolver (D7), or null to rely on the any-moderator pool. */
  mediatorId: string | null;
  /** D7's additive half — moderators/leader may resolve it too, whoever acts first. */
  anyModerator: boolean;
  /** Symmetric stake, paid by both sides (D5). */
  stake: number;
}

/**
 * Extra Phase 2 task 5 — the duel counterpart of `validateBetDraft`, and the
 * single statement of what a well-formed challenge is. `create_duel` in
 * `20260906130100_duel_rpcs.sql` re-checks every rule below, per the
 * convention every RPC in this repo follows: the client gates so a person sees
 * the rule before submitting, and the database enforces it so the rule
 * survives Studio and PostgREST.
 *
 * The RPCs still raise English sentences and that is now deliberate rather
 * than duplicative (plan-i18n-ptbr.md D9): those strings are the last line of
 * defence against races and tampering, they are LOGGED and never rendered, and
 * pattern-matching on them to recover a code would break silently the day
 * someone edits a migration. What a person actually hits is this function,
 * whose codes the UI translates.
 *
 * `context` is the roster the ids are checked against plus the challenger's
 * own per-team balance (DOM-013 — balances are per-team, so the caller must
 * pass the balance for THIS team; there is no global one to fall back on).
 *
 * **D9 is deliberately NOT enforced here, and this is the paragraph that stops
 * the next reader from "fixing" it.** In a `restricted` team a draft with
 * `anyModerator: false` is perfectly valid and must NOT be rejected:
 * `create_duel` silently stores `true` instead. Coercion, not refusal — the
 * challenger never sees an error for a checkbox the UI had already ticked and
 * disabled on their behalf. `mustForceAnyModerator(team)` in permissions.ts is
 * what the UI asks to render that state; nothing in this function may consult
 * `team.accessMode`, and `canStartDuel` is likewise plain membership, because
 * DOM-002 rations bets posted for a team to wager into, and a duel is a
 * private arrangement between two people who have already agreed to it.
 *
 * Also not here, and for the same reason it is not in `validateBetDraft`: the
 * clock, the pending-challenge cap (`CONFIG.DUEL_MAX_PENDING_PER_CHALLENGER`,
 * server-side only — the client cannot count another session's in-flight
 * challenges) and whether the challengee can afford the stake (they are not
 * the one filling in this form).
 */
export function validateDuelDraft(
  draft: DuelDraft,
  context: { team: Team; challengerId: string; balance: number },
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const isTeammate = (userId: string): boolean =>
    context.team.members.some((m) => m.userId === userId);

  if (draft.title.trim().length === 0) {
    // Same code as validateBetDraft's — a duel IS a bet (D1), so the title
    // rule is not a duel rule and gets no duel-specific copy. Diverging here
    // would put two sentences on one requirement.
    issues.push({ code: "title-required" });
  }

  // Three outcomes, one issue at most, and the ORDER is the whole design:
  // self-challenge is tested before roster membership because the challenger
  // trivially passes the roster test, so a plain "is a teammate" check would
  // wave a self-challenge through. And blank is tested first because "pick who
  // you're challenging" is the sentence for an untouched field, whereas an id
  // that is simply not on the roster (a stale picker, a kicked member) is the
  // same *user-facing* problem — pick someone — so it reuses that code rather
  // than inventing a third.
  const challengeeId = draft.challengeeId.trim();
  if (challengeeId.length === 0) {
    issues.push({ code: "duel-target-required" });
  } else if (challengeeId === context.challengerId) {
    issues.push({ code: "duel-target-self" });
  } else if (!isTeammate(challengeeId)) {
    issues.push({ code: "duel-target-required" });
  }

  // D7: the named mediator is any teammate EXCEPT the two participants, and
  // "any moderator" is additive rather than an alternative — so the real rule
  // is "at least one possible resolver exists", which can fail in two ways.
  // Its SQL twins are two CHECKs on `bet_duels`:
  // `bet_duels_mediator_not_participant` and `bet_duels_has_a_resolver`.
  const mediatorId = draft.mediatorId?.trim() ?? "";
  if (mediatorId.length > 0) {
    if (
      !isTeammate(mediatorId) ||
      mediatorId === context.challengerId ||
      mediatorId === challengeeId
    ) {
      issues.push({ code: "duel-mediator-invalid" });
    }
    // Note what does NOT also fire: an invalid mediator with `anyModerator`
    // false is not additionally "resolver-required". They picked someone;
    // telling them to pick a mediator when they just did is noise, and the
    // draft is refused either way until the pick is fixed.
  } else if (!draft.anyModerator) {
    issues.push({ code: "duel-resolver-required" });
  }

  // One code and one sentence for what `validateWager` splits into
  // `amount-invalid` and `over-balance`, because this is one field on one form
  // and "whole amount you can afford" covers both failures without making the
  // person read two errors about the same box. The split still exists where it
  // matters: at creation the stake becomes a real wager, and `create_duel`
  // refuses an unaffordable one with `Not enough coins.` — validateWager's own
  // DOM-014 sentence — because by then it is a placement, not a draft.
  if (
    !Number.isInteger(draft.stake) ||
    draft.stake < 1 ||
    draft.stake > context.balance
  ) {
    issues.push({ code: "duel-stake-invalid" });
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

/** Draft payload for creating a team (DOM-001/002). */
export interface TeamDraft {
  name: string;
  accessMode: TeamAccessMode;
}

/**
 * DOM-001/002: a team needs a name and one of the two access modes. The
 * exactly-one-leader half of DOM-001 is `hasExactlyOneLeader` below — checked
 * against the assembled team, since the creator's membership is what satisfies
 * it.
 */
export function validateTeamDraft(draft: TeamDraft): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (draft.name.trim().length === 0) {
    issues.push({ code: "team-name-required" });
  }
  return issues;
}

/** UX-005/DOM-005: codes never expire, so joining only needs a non-blank one. */
export function validateInviteCode(code: string): ValidationIssue[] {
  return code.trim().length === 0
    ? [{ code: "invite-code-required" }]
    : [];
}

/** Draft payload for profile edits (UX-022). */
export interface ProfileDraft {
  displayName: string;
  /** One of the 10 curated hexes (NAME_COLORS) — see design-visual-identity §2.4. */
  nameColor: string;
  /** A platform icon id, or an avatars-bucket URL once uploaded (UX-022). */
  avatar: string;
}

/**
 * UX-022: name/color/avatar all have defaults (UX-002), so the only real rules
 * are a non-blank name and a color from the curated palette — an arbitrary hex
 * would break the identity system that renders names everywhere.
 */
export function validateProfileDraft(draft: ProfileDraft): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (draft.displayName.trim().length === 0) {
    issues.push({ code: "display-name-required" });
  }
  // Widened to string[]: NAME_COLORS is a literal tuple, so `includes` would
  // otherwise refuse to be asked about an arbitrary string.
  const palette: readonly string[] = NAME_COLORS;
  if (!palette.includes(draft.nameColor)) {
    issues.push({ code: "name-color-invalid" });
  }
  if (draft.avatar.trim().length === 0) {
    issues.push({ code: "avatar-required" });
  }

  return issues;
}

/**
 * UX-018 + DOM-030: bet comments are free-form with no moderation, so the only
 * check is that something was actually typed.
 */
export function validateCommentBody(body: string): ValidationIssue[] {
  return body.trim().length === 0
    ? [{ code: "comment-empty" }]
    : [];
}

/**
 * UX-019 + DOM-030: team chat is `validateCommentBody`'s twin plus a length
 * cap. Free-form with no moderation, so the only two checks that exist are
 * "something was typed" and "it fits" — there is no profanity filter, no link
 * check, nothing that inspects *what* was said, because DOM-030 rules that
 * out categorically, not just for this surface. The length cap has a SQL
 * twin: the `body` CHECK in `20260906120000_team_chat.sql` enforces the same
 * `CONFIG.CHAT_MESSAGE_MAX_CHARS` bound at the row, per the invariants
 * migration's own rationale — a rule that lives only here stops being an
 * invariant the moment a write arrives from Studio or PostgREST.
 */
export function validateChatMessage(body: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const trimmed = body.trim();

  if (trimmed.length === 0) {
    issues.push({ code: "chat-empty" });
    return issues;
  }
  if (trimmed.length > CONFIG.CHAT_MESSAGE_MAX_CHARS) {
    issues.push({
      code: "chat-too-long",
      values: { max: CONFIG.CHAT_MESSAGE_MAX_CHARS },
    });
  }

  return issues;
}

/** DOM-024: an injection is a credit — a positive whole amount, never a debit. */
export function validateInjection(amount: number): ValidationIssue[] {
  return !Number.isInteger(amount) || amount < 1
    ? [
        { code: "inject-amount-invalid" },
      ]
    : [];
}
