"use client";

import { useState } from "react";
import { cn } from "cn";
import { CONFIG, validateTeamDraft, type TeamAccessMode } from "@repo/shared";
import { useModal } from "@/lib/modal-context";
import { useTeam } from "@/lib/team-context";
import { ModalShell } from "@/components/sl/modal-shell";

/**
 * DOM-001/002: new-team form. The creator becomes the team's single leader and
 * their membership is seeded with the onboarding grant (DOM-021, decision
 * §4.2) inside `createTeam`; submitting switches the app to the new team
 * (UX-010).
 */
export function CreateTeamModal() {
  const { close } = useModal();
  const { createTeam } = useTeam();

  const [name, setName] = useState("");
  const [accessMode, setAccessMode] = useState<TeamAccessMode>("free-for-all");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const canSubmit = validateTeamDraft({ name, accessMode }).length === 0;

  function submit() {
    if (!canSubmit) return;
    setSubmitError(null);
    const result = createTeam({ name, accessMode });
    if (result.ok) {
      close();
    } else {
      setSubmitError(result.error);
    }
  }

  return (
    <ModalShell
      eyebrow="NEW TEAM"
      title="Create a team"
      onClose={close}
      footer={
        <div className="space-y-2">
          {submitError && <p className="text-xs text-negative">{submitError}</p>}
          <button
            type="button"
            disabled={!canSubmit}
            onClick={submit}
            className="cut-sm h-9 w-full px-5 text-xs font-semibold uppercase tracking-wide text-black bg-jade transition-[filter] motion-safe:hover:brightness-110 motion-safe:active:brightness-95 disabled:opacity-40 disabled:pointer-events-none"
          >
            Create team
          </button>
          <p className="text-[11px] text-muted-foreground">
            You lead it, and start with {CONFIG.ONBOARDING_GRANT_COINS} coins.
          </p>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Team name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Sl Originals"
            className="w-full border border-border bg-surface-1 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-jade focus:outline-none focus:ring-1 focus:ring-jade/40"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Access mode
          </label>
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setAccessMode("free-for-all")}
              className={cn(
                "w-full border p-3 text-left transition-colors",
                accessMode === "free-for-all"
                  ? "border-jade bg-jade-wash"
                  : "border-border hover:border-border-strong",
              )}
            >
              <p className="text-sm font-medium text-foreground">Free-for-all</p>
              <p className="text-xs text-muted-foreground">
                Anyone creates bets &amp; invites.
              </p>
            </button>
            <button
              type="button"
              onClick={() => setAccessMode("restricted")}
              className={cn(
                "w-full border p-3 text-left transition-colors",
                accessMode === "restricted"
                  ? "border-jade bg-jade-wash"
                  : "border-border hover:border-border-strong",
              )}
            >
              <p className="text-sm font-medium text-foreground">Restricted</p>
              <p className="text-xs text-muted-foreground">
                Only mods &amp; leader create bets &amp; invites.
              </p>
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
