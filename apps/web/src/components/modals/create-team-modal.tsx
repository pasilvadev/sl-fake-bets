"use client";

import { useState } from "react";
import { useErrorText } from "@/lib/use-error-text";
import { useTranslations } from "next-intl";
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

  const { errorText } = useErrorText();
  const t = useTranslations("createTeamModal");
  const [name, setName] = useState("");
  const [accessMode, setAccessMode] = useState<TeamAccessMode>("free-for-all");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const canSubmit = validateTeamDraft({ name, accessMode }).length === 0 && !pending;

  // Async since roadmap Phase 5: the team, its founding membership, its
  // onboarding grant and its invite code are created by one Postgres
  // transaction (the `create_team` RPC), not by local state.
  async function submit() {
    if (!canSubmit) return;
    setSubmitError(null);
    setPending(true);
    const result = await createTeam({ name, accessMode });
    setPending(false);
    if (result.ok) {
      close();
    } else {
      setSubmitError(errorText(result));
    }
  }

  return (
    <ModalShell
      eyebrow={t("eyebrow")}
      title={t("title")}
      onClose={close}
      footer={
        <div className="space-y-2">
          {submitError && <p className="text-xs text-negative">{submitError}</p>}
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => void submit()}
            className="cut-sm h-9 w-full px-5 text-xs font-semibold uppercase tracking-wide text-black bg-jade transition-[filter] motion-safe:hover:brightness-110 motion-safe:active:brightness-95 disabled:opacity-40 disabled:pointer-events-none"
          >
            {pending ? t("submitting") : t("submit")}
          </button>
          <p className="text-[11px] text-muted-foreground">
            {t("footerNote", { coins: CONFIG.ONBOARDING_GRANT_COINS })}
          </p>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("nameLabel")}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("namePlaceholder")}
            className="w-full border border-border bg-surface-1 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-jade focus:outline-none focus:ring-1 focus:ring-jade/40"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("accessLabel")}
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
              <p className="text-sm font-medium text-foreground">{t("freeForAll")}</p>
              <p className="text-xs text-muted-foreground">{t("freeForAllHint")}</p>
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
              <p className="text-sm font-medium text-foreground">{t("restricted")}</p>
              <p className="text-xs text-muted-foreground">{t("restrictedHint")}</p>
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
