"use client";

import { useState, type ReactNode } from "react";
import { useErrorText } from "@/lib/use-error-text";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("teamGate");

  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-3 border border-border bg-surface-1 p-6">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ember">
          {t("loadFailedTitle")}
        </p>
        <p className="text-sm text-foreground">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="cut-sm h-9 px-5 text-xs font-semibold uppercase tracking-wide text-black bg-jade transition-[filter] motion-safe:hover:brightness-110"
        >
          {t("retry")}
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
 * here there is nothing. Both ways in (spend an invite code, or create) sit on
 * the same screen, invite code first — most arrivals were invited by a
 * teammate and already have a code, so creating a team stays a collapsed
 * button rather than an open form someone could fill in by mistake.
 */
export function NoTeamsScreen() {
  // Onboarding's second step (UX-028, roadmap Phase 7.5): signup → **team** →
  // profile → dashboard. Marked on the screen rather than on the mutation
  // because reaching the step is what the funnel measures drop-off from.
  useOnboardingStep("team");

  const { createTeam, joinTeamByCode } = useTeamSession();
  const { signOut } = useAuth();

  const { errorText } = useErrorText();
  const t = useTranslations("teamGate");
  const [name, setName] = useState("");
  const [accessMode, setAccessMode] = useState<TeamAccessMode>("free-for-all");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Most arrivals have a friend's code already, not a team to name — the
  // create-team form only expands once someone actually asks for it.
  const [showCreateForm, setShowCreateForm] = useState(false);

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    setPending("create");
    setError(null);
    const result = await createTeam({ name, accessMode });
    setPending(null);
    if (!result.ok) setError(errorText(result));
  }

  async function submitJoin(e: React.FormEvent) {
    e.preventDefault();
    setPending("join");
    setError(null);
    const result = await joinTeamByCode(code);
    setPending(null);
    if (!result.ok) setError(errorText(result));
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <div className="flex items-center gap-3">
          <SMark className="h-8 w-auto text-jade" />
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("noTeamsEyebrow")}
            </p>
            <h1 className="text-lg font-semibold text-foreground">
              {t("noTeamsTitle")}
            </h1>
          </div>
        </div>

        <form onSubmit={submitJoin} className="space-y-3 border border-border p-4">
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("codeLabel")}
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t("codePlaceholder")}
              className={cn(fieldClass, "font-mono")}
            />
            <button
              type="submit"
              disabled={code.trim().length === 0 || pending !== null}
              className="shrink-0 border border-border px-4 text-xs font-semibold uppercase tracking-wide text-foreground transition-colors hover:border-jade/50 hover:text-jade disabled:opacity-40 disabled:pointer-events-none"
            >
              {pending === "join" ? t("joining") : t("join")}
            </button>
          </div>
        </form>

        {showCreateForm ? (
          <form onSubmit={submitCreate} className="space-y-3 border border-border p-4">
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("nameLabel")}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("namePlaceholder")}
              className={fieldClass}
              autoFocus
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
                  {mode === "free-for-all" ? t("freeForAll") : t("restricted")}
                </button>
              ))}
            </div>
            <button
              type="submit"
              disabled={name.trim().length === 0 || pending !== null}
              className="cut-sm h-9 w-full px-5 text-xs font-semibold uppercase tracking-wide text-black bg-jade transition-[filter] motion-safe:hover:brightness-110 disabled:opacity-40 disabled:pointer-events-none"
            >
              {pending === "create" ? t("creating") : t("createTeam")}
            </button>
            <p className="text-[11px] text-muted-foreground">
              {t("leadNote", { coins: CONFIG.ONBOARDING_GRANT_COINS })}
            </p>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setShowCreateForm(true)}
            className="w-full border border-border p-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:border-jade/50 hover:text-jade"
          >
            {t("createTeamPrompt")}
          </button>
        )}

        {error && <p className="text-xs text-negative">{error}</p>}

        <button
          type="button"
          onClick={() => void signOut()}
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("signOut")}
        </button>
      </div>
    </div>
  );
}

/** Renders `children` only once a current team exists. */
export function TeamGate({ children }: { children: ReactNode }) {
  const { status, error, teams, reload } = useTeamSession();
  const { codeText } = useErrorText();

  if (status === "loading") return <Splash />;
  if (status === "error") {
    return (
      <LoadFailed
        error={codeText(error ?? "team-load-failed")}
        onRetry={() => void reload()}
      />
    );
  }
  if (teams.length === 0) return <NoTeamsScreen />;

  return <>{children}</>;
}
