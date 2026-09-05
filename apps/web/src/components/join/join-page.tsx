"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTeamSession } from "@/lib/team-context";
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
 */
function JoinFlow({ code }: { code: string }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { joinTeamByCode, setTeamId } = useTeamSession();

  const [preview, setPreview] = useState<TeamPreview | null>(null);
  const [loading, setLoading] = useState(true);
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
    else setError(result.error);
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-4">
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
    </div>
  );
}

export function JoinPage({ code }: { code: string }) {
  return (
    <AuthGated>
      <JoinFlow code={code} />
    </AuthGated>
  );
}
