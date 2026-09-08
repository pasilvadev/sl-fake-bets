"use client";

import { useState } from "react";
import { validateProfileDraft, type ProfileDraft } from "@repo/shared";
import { useTeam } from "@/lib/team-context";
import { SMark } from "@/components/sl/s-mark";
import { UserAvatar } from "@/components/sl/user-avatar";
import { ProfileFields } from "@/components/profile/profile-fields";
import { useOnboardingStep } from "@/components/onboarding/steps";
import { useErrorText } from "@/lib/use-error-text";
import { useTranslations } from "next-intl";

/**
 * The first-run profile step (roadmap Phase 7.5, decision §4.7) — the third of
 * onboarding's four steps: signup → team → **profile** → dashboard.
 *
 * A full-screen step, not a modal, for the reason `team-gate.tsx` gives about
 * its own screen: a modal implies something behind it to go back to, and a
 * dashboard the user has never seen is not that. A modal's close affordance is
 * an X in a corner, which reads as *dismiss and lose*; a step owns the viewport,
 * so skipping can be a real, labeled button that says what it does.
 *
 * It runs AFTER the team step because both ways in are better served that way:
 * the invite-link visitor came to join a specific team and the cold-start
 * visitor came to make one, and interposing a name-and-color screen is a
 * decision between the user and the thing they clicked (UX-001). Profile-last
 * also lets the step frame itself as *this is how your team sees you*, which is
 * the only reason to care about the field at all.
 *
 * Nothing here is required and nothing validates against the user: every field
 * arrived pre-filled and valid from Phase 4's signup trigger (UX-002). The two
 * actions are the same two actions in both modes — finish, and finish without
 * changing anything — and `prefill` only decides which one is primary:
 *
 *   * **provider** — Google gave a real name (and usually a real picture), so
 *     this is a confirmation. Primary = continue as-is; editing is one visible
 *     secondary action away, on this same screen.
 *   * **derived** — the name is an email local part or the literal 'Player',
 *     which the user has never seen and did not choose. Primary = save; the
 *     skip stays present and honest, labeled with the placeholder it accepts
 *     rather than a bare "Skip" or a guilt-worded one.
 *
 * Both paths stamp `onboarded_at`, so this screen never returns. That is not a
 * shortcut: a step that reappears until satisfied is nagware, and it would
 * re-fire the Phase 9 funnel. The profile stays editable forever from the
 * profile menu.
 */
export function ProfileStep() {
  const { currentUser, onboarding, completeOnboarding } = useTeam();
  useOnboardingStep("profile");

  const isProvider = onboarding.prefill === "provider";

  // A provider-named account opens on the confirmation; a derived one opens
  // straight into the fields, because that is the case where the pre-filled
  // value is a placeholder rather than an answer.
  const { errorText, codeText } = useErrorText();
  const t = useTranslations("profileStep");
  const [editing, setEditing] = useState(!isProvider);
  const [draft, setDraft] = useState<ProfileDraft>({
    displayName: currentUser.displayName,
    nameColor: currentUser.nameColor,
    avatar: currentUser.avatar,
  });
  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState<"save" | "skip" | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** The name the skip accepts — always the stored one, never the edited draft. */
  const keptName = currentUser.displayName;

  const canSave =
    validateProfileDraft(draft).length === 0 && pending === null && !uploading;

  async function finish(withDraft: ProfileDraft | null) {
    setError(null);
    setPending(withDraft ? "save" : "skip");
    const result = await completeOnboarding(withDraft);
    // On success the gate unmounts this screen; only a failure needs state.
    if (!result.ok) {
      setPending(null);
      setError(errorText(result));
    }
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <div className="flex items-center gap-3">
          <SMark className="h-8 w-auto text-jade" />
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("eyebrow")}
            </p>
            <h1 className="text-lg font-semibold text-foreground">
              {isProvider ? t("titleProvider") : t("titlePick")}
            </h1>
          </div>
        </div>

        <div className="space-y-4 border border-border bg-surface-1 p-4">
          {editing ? (
            <ProfileFields
              userId={currentUser.id}
              draft={draft}
              onChange={setDraft}
              onBusyChange={setUploading}
              // A CODE, not a sentence (D8) — `codeText` is what makes it one.
              onUploadError={(code) => setError(code && codeText(code))}
            />
          ) : (
            <div className="flex items-center gap-3">
              <UserAvatar
                user={{ ...currentUser, ...draft }}
                size={44}
                ring
              />
              <div className="min-w-0">
                <p
                  className="truncate text-base font-semibold"
                  style={{ color: draft.nameColor }}
                >
                  {draft.displayName}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {t("previewNote")}
                </p>
              </div>
            </div>
          )}

          {error && <p className="text-xs text-negative">{error}</p>}

          {/*
            Two actions, one order, chosen by `prefill`. Whichever is primary,
            the other is immediately available and never hidden behind a
            confirmation — a failed save must still leave the way out reachable.
          */}
          <div className="space-y-2">
            {editing ? (
              <button
                type="button"
                disabled={!canSave}
                onClick={() => void finish(draft)}
                className="cut-sm h-9 w-full px-5 text-xs font-semibold uppercase tracking-wide text-black bg-jade transition-[filter] motion-safe:hover:brightness-110 motion-safe:active:brightness-95 disabled:opacity-40 disabled:pointer-events-none"
              >
                {pending === "save" ? t("saving") : t("save")}
              </button>
            ) : (
              <button
                type="button"
                disabled={pending !== null}
                onClick={() => void finish(null)}
                className="cut-sm h-9 w-full px-5 text-xs font-semibold uppercase tracking-wide text-black bg-jade transition-[filter] motion-safe:hover:brightness-110 motion-safe:active:brightness-95 disabled:opacity-40 disabled:pointer-events-none"
              >
                {pending === "skip" ? t("oneMoment") : t("looksGood")}
              </button>
            )}

            {editing ? (
              <button
                type="button"
                disabled={pending !== null}
                onClick={() => void finish(null)}
                className="h-9 w-full border border-border px-5 text-xs font-medium text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
              >
                {pending === "skip"
                  ? t("oneMoment")
                  : t("keepName", { name: keptName })}
              </button>
            ) : (
              <button
                type="button"
                disabled={pending !== null}
                onClick={() => setEditing(true)}
                className="h-9 w-full border border-border px-5 text-xs font-medium text-foreground transition-colors hover:border-jade/50 hover:text-jade disabled:opacity-40 disabled:pointer-events-none"
              >
                {t("editProfile")}
              </button>
            )}
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground">
          {t("changeLater")}
        </p>
      </div>
    </div>
  );
}
