"use client";

import { useState } from "react";
import { useErrorText } from "@/lib/use-error-text";
import { validateProfileDraft, type ProfileDraft } from "@repo/shared";
import { useModal } from "@/lib/modal-context";
import { useTeam } from "@/lib/team-context";
import { ModalShell } from "@/components/sl/modal-shell";
import { ProfileFields } from "@/components/profile/profile-fields";

/**
 * UX-022: profile editor — display name, one of the 10 curated name colors
 * (§2.4), and an avatar: either a platform icon or, since roadmap Phase 5, a
 * custom image in the Supabase `avatars` bucket. Saving applies everywhere the
 * name renders, immediately, and persists to `public.users`.
 *
 * The fields themselves live in `profile/profile-fields.tsx` since Phase 7.5 —
 * this modal and the first-run profile step must edit the same three fields
 * under the same `validateProfileDraft` contract, and the only way to keep two
 * surfaces in agreement about a color palette and an icon grid is to have one
 * of each. What stays here is what is actually modal-shaped: the shell, the
 * save button, and closing on success.
 *
 * This is also the answer to "what if they wanted to change it later" that lets
 * the first-run step be skippable — the profile is editable forever, from the
 * profile menu.
 */
export function ProfileModal() {
  const { close } = useModal();
  const { currentUser, updateProfile } = useTeam();

  const { errorText, codeText } = useErrorText();
  const [draft, setDraft] = useState<ProfileDraft>({
    displayName: currentUser.displayName,
    nameColor: currentUser.nameColor,
    avatar: currentUser.avatar,
  });
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [uploading, setUploading] = useState(false);

  const canSubmit =
    validateProfileDraft(draft).length === 0 && !pending && !uploading;

  async function submit() {
    if (!canSubmit) return;
    setSubmitError(null);
    setPending(true);
    const result = await updateProfile(draft);
    setPending(false);
    if (result.ok) {
      close();
    } else {
      setSubmitError(errorText(result));
    }
  }

  return (
    <ModalShell
      eyebrow="PROFILE"
      title="Edit profile"
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
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      }
    >
      <ProfileFields
        userId={currentUser.id}
        draft={draft}
        onChange={setDraft}
        onBusyChange={setUploading}
        // A CODE, not a sentence (D8) — `codeText` is what makes it one.
        onUploadError={(code) => setSubmitError(code && codeText(code))}
      />
    </ModalShell>
  );
}
