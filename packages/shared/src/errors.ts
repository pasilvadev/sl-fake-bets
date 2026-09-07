import type { ValidationCode } from "./validation";

/**
 * Every reason a mutation can refuse, as a stable code
 * (plan-i18n-ptbr.md D8 — the debt `plan-mvp-roadmap.md` §8 Extra Phase 4
 * recorded and deferred).
 *
 * **Why this exists.** Before UX-027 a failed mutation carried a bare English
 * sentence written at the point of failure, ~68 call sites deep inside
 * `team-context.tsx` and the `lib/data/*` write layer. That made the sentence
 * unlocalizable, un-greppable and un-auditable all at once: there was no list
 * of what the app could say, and nothing stopped a new refusal from inventing
 * its own phrasing for a rule that already had one. A code fixes all three —
 * the catalog's `errors` namespace is typed `Record<MutationErrorCode, string>`,
 * so a code without a sentence is a compile error and a sentence without a
 * code is one too.
 *
 * **Why it is a SUPERSET of `ValidationCode`.** The two overlap for real:
 * `over-balance` and the mutator's old "Not enough coins." were the same fact
 * refused twice, once before submitting and once after. One union means one
 * `errors.*` namespace, one exhaustive record, and no chance of the two halves
 * drifting into different sentences for the same rule. Eleven mutators already
 * hand a `ValidationIssue`'s code straight to `fail()`; that is only sound
 * because of the `extends` line below.
 *
 * **What is NOT here:** the 125 `raise exception` strings in the migrations.
 * D9 is explicit — they are the last line of defence against races and
 * tampering, they reach `console.error` and never the screen, and
 * pattern-matching English message text to recover a code would break silently
 * the day someone edits a migration. They all arrive as `unexpected`. Codes
 * for the handful that are genuinely race-reachable are Phase 4, scoped from
 * logged evidence rather than from guessing.
 */
export type MutationErrorCode =
  // --- the validation half, verbatim ---------------------------------------
  | ValidationCode
  // --- identity and membership ---------------------------------------------
  | "not-signed-in"
  | "sign-in-incomplete"
  | "profile-not-found"
  | "team-not-found"
  | "not-a-member"
  | "member-not-on-team"
  // --- authorization -------------------------------------------------------
  | "manager-only-create-bet"
  | "manager-only-team-settings"
  | "manager-only-remove-member"
  | "leader-only-inject"
  | "leader-only-delete-team"
  | "creator-or-mod-only-resolve"
  | "creator-or-mod-only-delete"
  | "creator-or-mod-only-close"
  | "member-only-comment"
  | "member-only-chat"
  | "duel-resolver-only"
  | "cannot-remove-self"
  | "cannot-remove-leader"
  | "leader-cannot-leave"
  | "already-in-team"
  // --- bet lifecycle -------------------------------------------------------
  | "bet-not-found"
  | "bet-already-resolved"
  | "betting-closed"
  | "betting-already-closed"
  | "close-before-resolve"
  | "option-required"
  | "winning-option-required"
  // --- duels ---------------------------------------------------------------
  | "not-a-duel"
  | "duel-not-open"
  | "duel-expired"
  | "duel-not-accepted"
  | "duel-already-accepted"
  | "duel-already-pending"
  | "duel-pending-cap"
  | "duel-not-challengee-accept"
  | "duel-not-challengee-decline"
  | "duel-no-direct-wager"
  | "duel-no-betting-window"
  | "duel-delete-after-accept"
  // --- chat ----------------------------------------------------------------
  | "chat-invalid"
  | "chat-duplicate"
  | "chat-rate-limited"
  // --- avatar upload (the one non-MutationResult shape, Phase 2 task 7) -----
  | "avatar-too-large"
  // --- write failures, where the RPC said no for a reason we cannot name ----
  | "bet-create-failed"
  | "bet-close-failed"
  | "wager-failed"
  | "comment-failed"
  | "duel-create-failed"
  | "duel-accept-failed"
  | "invite-code-failed"
  // Two READS, named rather than folded into `unexpected`: both render on a
  // whole surface rather than in a toast, and "Couldn't load your teams" tells
  // a reader what to retry where "That didn't go through" does not. The raw
  // Postgres text is still logged and still never shown — D9 forbids matching
  // on message TEXT, not naming a call site we already know.
  | "team-load-failed"
  | "chat-load-failed"
  /**
   * D9's catch-all: an RPC raised something we have no code for.
   *
   * The raw text and its SQLSTATE go to `console.error`; the reader gets one
   * localized sentence. This is the ONLY correct destination for an unmapped
   * Postgres exception, and it must stay a dead end — a future session
   * tempted to `switch` on `error.message` to do better should read D9 first.
   */
  | "unexpected";

/**
 * The superset relation D8 requires, checked rather than asserted in a comment.
 *
 * Delete this and `fail(issue.code)` at eleven call sites silently becomes a
 * cast: the codes would still compile as strings and the missing sentences
 * would only show up as a raw key on someone's screen.
 */
type _ValidationCodesAreMutationCodes =
  ValidationCode extends MutationErrorCode ? true : never;
const _supersetHolds: _ValidationCodesAreMutationCodes = true;
void _supersetHolds;
