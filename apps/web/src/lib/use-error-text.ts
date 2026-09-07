"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import type { MutationErrorCode, ValidationIssue } from "@repo/shared";
import type { MutationResult } from "@/lib/data/result";
import { errorNamespaceFor } from "@/i18n/messages";

/**
 * A failed mutation, or a rejected field, as a sentence in the reader's
 * language (plan-i18n-ptbr.md D8, Phase 2 task 5).
 *
 * Every consumer used to do `setError(result.error)` — rendering a sentence
 * written a hundred lines deep in `team-context.tsx`. They now do
 * `setError(errorText(result))`, and this is the only module that knows where
 * the words come from.
 *
 * One hook returning two functions rather than two hooks, because 20 of the 26
 * call sites need `errorText` and 2 need `issueText`, and both need the same
 * pair of `useTranslations` calls — which must be unconditional anyway.
 */
export function useErrorText() {
  const tErrors = useTranslations("errors");
  const tValidation = useTranslations("validation");

  /**
   * The `values` bag defeats next-intl's per-key argument typing: `code` is a
   * union of ~74 keys, so the compiler would demand the union of every key's
   * arguments at a call site that passes a bag valid for exactly one of them.
   * This cast is where that is absorbed, once, deliberately — the exhaustive
   * `Record` asserts in `i18n/messages.ts` are what keep the KEYS honest, and
   * a wrong `values` bag renders the placeholder rather than throwing.
   */
  const lookup = useCallback(
    (
      code: MutationErrorCode,
      values: Record<string, string | number> | undefined,
    ): string => {
      const t = errorNamespaceFor(code) === "validation" ? tValidation : tErrors;
      return (t as (key: string, values?: Record<string, string | number>) => string)(
        code,
        values,
      );
    },
    [tErrors, tValidation],
  );

  return {
    /**
     * Takes the FAILURE arm only, and returns a plain `string`.
     *
     * Every call site is already inside an `if (!result.ok)` or the false leg
     * of a ternary, so narrowing does the work — and the alternative
     * (`MutationResult` in, `string | null` out) would hand a `null` to the
     * several sites whose consumer wants a `string`, for no gain.
     */
    errorText: useCallback(
      (result: Extract<MutationResult, { ok: false }>): string =>
        lookup(result.code, result.values),
      [lookup],
    ),
    /**
     * A bare code, for the one failure shape that is not a `MutationResult`:
     * `uploadAvatar`'s `{ url, error }` pair (Phase 2, task 7).
     */
    codeText: useCallback(
      (code: MutationErrorCode): string => lookup(code, undefined),
      [lookup],
    ),
    /** The inline, field-attached half (§5.8). */
    issueText: useCallback(
      (issue: ValidationIssue): string => lookup(issue.code, issue.values),
      [lookup],
    ),
  };
}
