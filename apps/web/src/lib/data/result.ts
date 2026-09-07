import type { MutationErrorCode } from "@repo/shared";

/**
 * Uniform mutator outcome — modals surface the failure as the visible reason.
 *
 * Its own module since roadmap Phase 5: both the Supabase write layer
 * (team-mutations.ts) and team-context.tsx speak in it, and the context
 * imports the write layer, so the type cannot live in either.
 *
 * The failure arm carries a CODE since UX-027 (plan-i18n-ptbr.md D8), not a
 * sentence. Everything user-visible now comes out of `messages/*.json`, which
 * is what makes §4's promise true: there is exactly one place a failure
 * sentence lives, and `errors` is typed `Record<MutationErrorCode, string>` so
 * a code without one does not compile.
 */
export type MutationResult =
  | { ok: true }
  | {
      ok: false;
      code: MutationErrorCode;
      /**
       * ICU arguments for the two codes whose sentence quotes something —
       * the pending-challenge cap and the name of the team you are already
       * in. Same shape and same rule as `ValidationIssue.values`: a bag of
       * arguments, never a sentence.
       */
      values?: MutationErrorValues;
      /**
       * Raw upstream text, **for logs only** (D9).
       *
       * A Postgres exception message, essentially always. It must never be
       * rendered: it is English regardless of the reader, it leaks schema
       * detail, and it is the reason `asChatFailure` used to put a SQLSTATE
       * on someone's screen. `console.error` is its whole audience.
       */
      detail?: string;
    };

export type MutationErrorValues = Record<string, string | number>;

export const ok: MutationResult = { ok: true };

/**
 * `fail("bet-not-found")` for the ~60 that need nothing else;
 * `fail("unexpected", { detail: error.message })` where D9 sends the raw
 * Postgres text to the log; `fail("already-in-team", { values: { team } })`
 * for the two that interpolate.
 */
export function fail(
  code: MutationErrorCode,
  extra?: { values?: MutationErrorValues; detail?: string },
): MutationResult {
  return { ok: false, code, ...extra };
}

/**
 * D9's one exit for an RPC exception this app has no code for.
 *
 * The 125 `raise exception` strings in `supabase/migrations` are the last line
 * of defence against races and tampering — the shared validation layer catches
 * essentially everything a normal user does, before the RPC runs — so they
 * are not worth 125 translated sentences. What they ARE worth is a log line:
 * the SQLSTATE plus the raw text, which is the evidence Phase 4 item 2 will
 * use to promote the handful that turn out to be genuinely race-reachable.
 *
 * **Do not pattern-match on `error.message` to do better than this.** English
 * message text is fragile, and matching it would start failing silently the
 * day someone edits a migration — the failure mode being a user seeing the
 * generic sentence where a specific one used to appear, which nobody notices.
 * Promote by SQLSTATE, from evidence, or not at all.
 */
export function unexpected(error: {
  code?: string;
  message: string;
  details?: string | null;
}): MutationResult {
  console.error(
    `[mutation] unmapped Postgres error ${error.code ?? "(no SQLSTATE)"}: ${error.message}`,
    error.details ?? "",
  );
  return fail("unexpected", { detail: error.message });
}
