"use client";

import { useMemo, useRef, useState } from "react";
import { cn } from "cn";
import { NAME_COLORS, type ProfileDraft } from "@repo/shared";
import { createClient } from "@/lib/supabase/client";
import { AVATAR_MAX_BYTES, uploadAvatar } from "@/lib/data/team-mutations";
import { AVATAR_ICONS } from "@/components/sl/avatar-icons";
import { UserAvatar } from "@/components/sl/user-avatar";

// Literal class names, not interpolated — Tailwind v4 only generates
// utilities for class strings it can see statically in source. Index-aligned
// with NAME_COLORS, so the swatch shown and the hex stored are one list.
const NAME_COLOR_SWATCHES = [
  "bg-name-color-1",
  "bg-name-color-2",
  "bg-name-color-3",
  "bg-name-color-4",
  "bg-name-color-5",
  "bg-name-color-6",
  "bg-name-color-7",
  "bg-name-color-8",
  "bg-name-color-9",
  "bg-name-color-10",
] as const;

/**
 * UX-022's three profile fields — display name, one of the 10 curated name
 * colors (§2.4), and an avatar (a platform icon or an uploaded image) — plus
 * the live identity preview, as one component.
 *
 * Extracted from `profile-modal.tsx` in roadmap Phase 7.5, when the first-run
 * profile step became a second surface editing exactly the same three fields.
 * Two hand-maintained copies of the color grid and the icon grid is precisely
 * the drift `avatar-icons.ts` exists to prevent, one level up: a swatch added
 * to the modal and not to the step would make a brand-new account unable to
 * pick a color that every established account has.
 *
 * The draft is fully controlled by the caller, because the two surfaces do
 * different things with it (the modal saves and closes; the step saves and
 * completes onboarding) and neither wants the other's submit button.
 *
 * The image is uploaded when it is PICKED, not when the form is submitted, so
 * the value in the draft is always a URL that already resolves. That is why
 * this component reports `busy` — a caller must not let a save race an upload.
 */
export function ProfileFields({
  userId,
  draft,
  onChange,
  onBusyChange,
  onUploadError,
  ringPreview = true,
}: {
  /** Whose avatar folder an upload writes to — the storage authorization boundary. */
  userId: string;
  draft: ProfileDraft;
  onChange: (draft: ProfileDraft) => void;
  /** True while an avatar upload is in flight; the caller disables submit. */
  onBusyChange?: (busy: boolean) => void;
  /** Upload failures — the caller owns where errors render. */
  onUploadError?: (message: string | null) => void;
  ringPreview?: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  function setUploadingState(next: boolean) {
    setUploading(next);
    onBusyChange?.(next);
  }

  async function pickImage(file: File) {
    onUploadError?.(null);
    setUploadingState(true);
    const { url, error } = await uploadAvatar(supabase, userId, file);
    setUploadingState(false);
    if (url) onChange({ ...draft, avatar: url });
    else onUploadError?.(error);
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <label
          htmlFor="profile-display-name"
          className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Display name
        </label>
        <input
          id="profile-display-name"
          type="text"
          value={draft.displayName}
          onChange={(e) => onChange({ ...draft, displayName: e.target.value })}
          className="w-full border border-border bg-surface-1 px-3 py-2 text-sm text-foreground focus:border-jade focus:outline-none focus:ring-1 focus:ring-jade/40"
        />
      </div>

      <div className="space-y-1.5">
        <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Name color
        </span>
        <div className="flex flex-wrap gap-2">
          {NAME_COLOR_SWATCHES.map((swatchClass, i) => {
            const hex = NAME_COLORS[i];
            return (
              <button
                key={hex}
                type="button"
                aria-label={`Name color ${i + 1}`}
                aria-pressed={draft.nameColor === hex}
                onClick={() => onChange({ ...draft, nameColor: hex })}
                className={cn(
                  "size-7 shrink-0 rounded-full ring-offset-2 ring-offset-surface-2 transition-shadow",
                  swatchClass,
                  draft.nameColor === hex && "ring-2 ring-jade",
                )}
              />
            );
          })}
        </div>
      </div>

      <div className="space-y-1.5">
        <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Avatar
        </span>
        <div className="grid grid-cols-4 gap-2">
          {AVATAR_ICONS.map(({ id, Icon }) => (
            <button
              key={id}
              type="button"
              aria-label={id.replace("icon-", "Avatar ")}
              aria-pressed={draft.avatar === id}
              onClick={() => onChange({ ...draft, avatar: id })}
              className={cn(
                "cut-sm flex aspect-square items-center justify-center border bg-surface-1 text-foreground transition-colors",
                draft.avatar === id ? "border-jade text-jade" : "border-border",
              )}
            >
              <Icon className="size-5" />
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-3">
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Reset first: picking the same file twice must re-fire change.
              e.target.value = "";
              if (file) void pickImage(file);
            }}
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInput.current?.click()}
            className="border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-jade/50 hover:text-jade disabled:opacity-40 disabled:pointer-events-none"
          >
            {uploading ? "Uploading…" : "Upload image"}
          </button>
          <span className="text-[11px] text-muted-foreground">
            PNG, JPEG, WebP or GIF · max {AVATAR_MAX_BYTES / 1024 / 1024} MB
          </span>
          <UserAvatar
            user={{
              id: userId,
              displayName: draft.displayName,
              nameColor: draft.nameColor,
              avatar: draft.avatar,
              // Preview object — UserAvatar reads none of it, and a draft
              // profile has no language of its own.
              locale: null,
            }}
            size={28}
            ring={ringPreview}
            className="ml-auto"
          />
        </div>
      </div>
    </div>
  );
}
