"use client";

import { useEffect, useMemo, useState } from "react";
import { useErrorText } from "@/lib/use-error-text";
import { useRouter } from "next/navigation";
import { useTeamSession } from "@/lib/team-context";
import { useAuth } from "@/lib/auth-context";
import { trackInviteOpened } from "@/lib/analytics";
import { reachOnboardingStep } from "@/components/onboarding/steps";
import { createClient } from "@/lib/supabase/client";
import { previewTeamByCode, type TeamPreview } from "@/lib/data/team-mutations";
import { AuthGated } from "@/components/app-gate";
import { SMark } from "@/components/sl/s-mark";

/**
 * Invite landing page (UX-012, roadmap Phase 5, task 5).
 *
 * Wrapped in AuthGated and nothing else: this route must work for someone with
 * no team at all, which is exactly the case TeamGate intercepts. A logged-out
 * visitor gets the auth screen at this URL and lands back here after signing
 * up, because AuthGated renders in place (Phase 4).
 *
 * The team preview comes from the `team_preview_by_code` RPC rather than a
 * SELECT: `teams` is membership-scoped by RLS, and the whole point here is to
 * show a team to someone who is not a member yet. Holding the code is the
 * authorization.
 *
 * Since roadmap Phase 9 the route fetches that preview on the SERVER too — for
 * the invite card's `generateMetadata` (UX-023) — and passes it in, so the
 * team name is in the delivered HTML rather than arriving a round trip later.
 * The client still re-reads it on mount: the server render may have been
 * produced before this visitor signed in, and `isMember`/`isBanned` are
 * answers about *them*.
 */
function JoinFlow({
  code,
  initialPreview,
}: {
  code: string;
  initialPreview: TeamPreview | null;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { joinTeamByCode, setTeamId, status, teams } = useTeamSession();
  const { user } = useAuth();

  const { errorText } = useErrorText();
  const [preview, setPreview] = useState<TeamPreview | null>(initialPreview);
  const [loading, setLoading] = useState(initialPreview === null);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { preview: found, error: previewError } = await previewTeamByCode(
        supabase,
        code,
      );
      if (cancelled) return;
      setPreview(found);
      setError(previewError);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, code]);

  /**
   * This screen is onboarding's `team` step for anyone who arrived by invite
   * (UX-028, roadmap Phase 9 task 1) — spending a code is one of the two ways
   * that step names, and `NoTeamsScreen` is simply the other one. Without this
   * the funnel reads a total drop-off at `team` for exactly the population
   * metric 2 is about: everyone who came through an invite link.
   *
   * Conditional, so it is a plain effect rather than `useOnboardingStep`: a
   * member who already has teams and reopens an old invite is not onboarding,
   * and counting them would inflate a step nobody dropped out of.
   */
  useEffect(() => {
    if (status !== "ready" || !user || teams.length > 0) return;
    reachOnboardingStep("team", user.id);
  }, [status, teams.length, user]);

  function openTeam(teamId: string) {
    setTeamId(teamId);
    router.replace("/");
  }

  async function join() {
    setJoining(true);
    setError(null);
    const result = await joinTeamByCode(code);
    setJoining(false);
    if (result.ok) router.replace("/");
    else setError(errorText(result));
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-5 border border-border bg-surface-1 p-6">
        <div className="flex items-center gap-3">
          <SMark className="size-8 text-jade" />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Invite
            </p>
            <h1 className="truncate text-lg font-semibold text-foreground">
              {loading
                ? "Checking the code…"
                : (preview?.teamName ?? "Invite not found")}
            </h1>
          </div>
        </div>

        {!loading && !preview && (
          <p className="text-sm text-muted-foreground">
            No team matches this invite code. Ask whoever sent it for a fresh
            link — codes don&apos;t expire, but they can be revoked.
          </p>
        )}

        {preview && (
          <>
            <p className="text-xs text-muted-foreground">
              {preview.memberCount} members · {preview.openBetCount} open bets
            </p>

            {preview.isBanned ? (
              <p className="text-sm text-negative">
                You can&apos;t rejoin {preview.teamName}.
              </p>
            ) : preview.isMember ? (
              <button
                type="button"
                onClick={() => openTeam(preview.teamId)}
                className="cut-sm h-9 w-full px-5 text-xs font-semibold uppercase tracking-wide text-black bg-jade transition-[filter] motion-safe:hover:brightness-110"
              >
                You&apos;re already in — open {preview.teamName}
              </button>
            ) : (
              <button
                type="button"
                disabled={joining}
                onClick={() => void join()}
                className="cut-sm h-9 w-full px-5 text-xs font-semibold uppercase tracking-wide text-black bg-jade transition-[filter] motion-safe:hover:brightness-110 disabled:opacity-40 disabled:pointer-events-none"
              >
                {joining ? "Joining…" : `Join ${preview.teamName}`}
              </button>
            )}
          </>
        )}

        {error && <p className="text-xs text-negative">{error}</p>}

        <button
          type="button"
          onClick={() => router.replace("/")}
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          Not now
        </button>
      </div>
    </main>
  );
}

export function JoinPage({
  code,
  initialPreview = null,
}: {
  code: string;
  initialPreview?: TeamPreview | null;
}) {
  const { user } = useAuth();

  /**
   * Metric 2's first half (ARC-017, roadmap Phase 9 task 1): an invite link was
   * opened. Fired whether or not anyone is signed in — most of the time nobody
   * is, which is the entire reason `analytics_events` carries an anonymous id
   * and its RLS policy grants INSERT to `anon`. The matching
   * `signup_completed` row is written by `team-context.tsx` under the same
   * anonymous id, and the conversion is the join between them.
   *
   * It sits OUTSIDE `AuthGated` — the one placement detail that decides whether
   * this metric measures anything. Inside, a logged-out visitor renders the
   * auth screen instead of `JoinFlow`, and the invites that never converted —
   * the denominator — would be the exact population that never fired an event.
   *
   * The team id comes from the server-fetched preview, so it is present on the
   * very first render, before any client round trip.
   *
   * Deliberately on the OPEN, not on the join: the metric is invite-open →
   * signup conversion, so counting only the invites that worked would make it
   * unmeasurable by construction.
   */
  useEffect(() => {
    trackInviteOpened(code, initialPreview?.teamId ?? null, user?.id ?? null);
  }, [code, initialPreview?.teamId, user?.id]);

  return (
    <AuthGated>
      <JoinFlow code={code} initialPreview={initialPreview} />
    </AuthGated>
  );
}
