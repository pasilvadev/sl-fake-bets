"use client";

import { useState, type ReactNode } from "react";
import { cn } from "cn";
import { CONFIG, type TeamAccessMode } from "@repo/shared";
import { useTeamSession } from "@/lib/team-context";
import { useAuth } from "@/lib/auth-context";
import { SMark } from "@/components/sl/s-mark";
import { useOnboardingStep } from "@/components/onboarding/steps";

/**
 * The team world is real Postgres data since roadmap Phase 5, so it has the
 * three states a network read always has — and one the fixtures could never
 * produce: a signed-in account that belongs to no team at all.
 *
 * This gate resolves all four before anything that renders a team mounts,
 * which is what lets `useTeam()` keep returning a non-null team to every
 * module downstream instead of pushing a null check into each of them.
 */

function Splash() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background">
      <SMark className="size-8 text-foreground motion-safe:animate-pulse" />
    </div>
  );
}

function LoadFailed({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-3 border border-border bg-surface-1 p-6">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ember">
          Couldn&apos;t load your teams
        </p>
        <p className="text-sm text-foreground">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="cut-sm h-9 px-5 text-xs font-semibold uppercase tracking-wide text-black bg-jade transition-[filter] motion-safe:hover:brightness-110"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

const fieldClass =
  "w-full border border-border bg-surface-1 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-jade focus:outline-none focus:ring-1 focus:ring-jade/40";

/**
 * UX-028's first moment: an account with no team yet. Deliberately NOT the
 * create-team modal — a modal implies something behind it to go back to, and
 * here there is nothing. Both ways in (create, or spend an invite code) sit on
 * the same screen because a new arrival usually already has one of the two.
 */
export function NoTeamsScreen() {
  // Onboarding's second step (UX-028, roadmap Phase 7.5): signup → **team** →
  // profile → dashboard. Marked on the screen rather than on the mutation
  // because reaching the step is what the funnel measures drop-off from.
  useOnboardingStep("team");

  const { createTeam, joinTeamByCode } = useTeamSession();
  const { signOut } = useAuth();

  const [name, setName] = useState("");
  const [accessMode, setAccessMode] = useState<TeamAccessMode>("free-for-all");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    setPending("create");
    setError(null);
    const result = await createTeam({ name, accessMode });
    setPending(null);
    if (!result.ok) setError(result.error);
  }

  async function submitJoin(e: React.FormEvent) {
    e.preventDefault();
    setPending("join");
    setError(null);
    const result = await joinTeamByCode(code);
    setPending(null);
    if (!result.ok) setError(result.error);
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <div className="flex items-center gap-3">
          <SMark className="size-8 text-jade" />
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              No teams yet
            </p>
            <h1 className="text-lg font-semibold text-foreground">
              Start one, or join with a code
            </h1>
          </div>
        </div>

        <form onSubmit={submitCreate} className="space-y-3 border border-border p-4">
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Team name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Sl Originals"
            className={fieldClass}
          />
          <div className="flex gap-2">
            {(["free-for-all", "restricted"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setAccessMode(mode)}
                className={cn(
                  "flex-1 border p-2 text-left text-xs transition-colors",
                  accessMode === mode
                    ? "border-jade bg-jade-wash text-foreground"
                    : "border-border text-muted-foreground hover:border-border-strong",
                )}
              >
                {mode === "free-for-all" ? "Free-for-all" : "Restricted"}
              </button>
            ))}
          </div>
          <button
            type="submit"
            disabled={name.trim().length === 0 || pending !== null}
            className="cut-sm h-9 w-full px-5 text-xs font-semibold uppercase tracking-wide text-black bg-jade transition-[filter] motion-safe:hover:brightness-110 disabled:opacity-40 disabled:pointer-events-none"
          >
            {pending === "create" ? "Creating…" : "Create team"}
          </button>
          <p className="text-[11px] text-muted-foreground">
            You lead it, and start with {CONFIG.ONBOARDING_GRANT_COINS} coins.
          </p>
        </form>

        <form onSubmit={submitJoin} className="space-y-3 border border-border p-4">
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Have an invite code?
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="xxxx-xxxx"
              className={cn(fieldClass, "font-mono")}
            />
            <button
              type="submit"
              disabled={code.trim().length === 0 || pending !== null}
              className="shrink-0 border border-border px-4 text-xs font-semibold uppercase tracking-wide text-foreground transition-colors hover:border-jade/50 hover:text-jade disabled:opacity-40 disabled:pointer-events-none"
            >
              {pending === "join" ? "Joining…" : "Join"}
            </button>
          </div>
        </form>

        {error && <p className="text-xs text-negative">{error}</p>}

        <button
          type="button"
          onClick={() => void signOut()}
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

/** Renders `children` only once a current team exists. */
export function TeamGate({ children }: { children: ReactNode }) {
  const { status, error, teams, reload } = useTeamSession();

  if (status === "loading") return <Splash />;
  if (status === "error") {
    return <LoadFailed error={error ?? "Unknown error."} onRetry={() => void reload()} />;
  }
  if (teams.length === 0) return <NoTeamsScreen />;

  return <>{children}</>;
}
