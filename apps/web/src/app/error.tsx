"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { SMark } from "@/components/sl/s-mark";
import { buildTag } from "@/lib/build-info";

/**
 * The root error boundary (design-visual-identity.md §5.10's empty/ghost
 * pattern, §7's dry voice; plan-hosted-early-access.md D8, Phase 1 task 6).
 *
 * Before this file existed, an unanticipated client exception anywhere in the
 * tree fell all the way to Next's own bare default error page — the one
 * surface in the app with no house style at all. This is what a visitor sees
 * instead: the same ghost-S-mark-plus-one-line pattern every other empty
 * state uses (`empty-state.tsx`), `reset()` behind one button, and the build
 * tag so a report in team chat (the alpha's feedback channel, D8) can name
 * exactly which deploy it happened on.
 *
 * The raw error is LOGGED, never rendered — the same rule D9 applies to a
 * Postgres exception applies here to a client one: whatever `error.message`
 * says is for the console, and the reader gets one steady sentence regardless
 * of what actually broke.
 *
 * Must be a Client Component (Next's own convention for `error.tsx`): a
 * Server Component cannot catch an error thrown during its own render. This
 * is the segment-level boundary, not `global-error.tsx` — it renders inside
 * the root layout's existing `<html>`/`<body>`, which is untouched by
 * whatever broke below it.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errorPage");
  const tag = buildTag();

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="relative flex min-h-svh flex-col items-center justify-center bg-background px-4 py-10 text-center">
      <SMark className="pointer-events-none absolute left-1/2 top-1/2 size-48 -translate-x-1/2 -translate-y-1/2 opacity-5" />
      <div className="relative space-y-4">
        <p className="text-sm text-foreground">{t("message")}</p>
        <button
          type="button"
          onClick={() => reset()}
          className="cut-sm h-9 px-5 text-xs font-semibold uppercase tracking-wide text-black bg-jade transition-[filter] motion-safe:hover:brightness-110 motion-safe:active:brightness-95"
        >
          {t("retry")}
        </button>
        {tag && (
          <p className="font-mono text-[10px] text-muted-foreground">{tag}</p>
        )}
      </div>
    </div>
  );
}
