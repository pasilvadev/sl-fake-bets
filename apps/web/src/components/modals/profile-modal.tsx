"use client";

import { useState } from "react";
import { cn } from "cn";
import { Crown, Dice5, Flame, Ghost, Moon, Skull, Star, Zap } from "lucide-react";
import { NAME_COLORS, validateProfileDraft } from "@repo/shared";
import { useModal } from "@/lib/modal-context";
import { useTeam } from "@/lib/team-context";
import { ModalShell } from "@/components/sl/modal-shell";

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

const AVATAR_ICONS = [
  { id: "icon-dice", Icon: Dice5 },
  { id: "icon-crown", Icon: Crown },
  { id: "icon-ghost", Icon: Ghost },
  { id: "icon-flame", Icon: Flame },
  { id: "icon-bolt", Icon: Zap },
  { id: "icon-star", Icon: Star },
  { id: "icon-skull", Icon: Skull },
  { id: "icon-moon", Icon: Moon },
] as const;

/**
 * UX-022: profile editor — display name, one of the 10 curated name colors
 * (§2.4), and an avatar from the platform icon set. Saving applies everywhere
 * the name renders, immediately. Custom image upload needs real storage, so it
 * arrives with the Supabase bucket in a later phase.
 */
export function ProfileModal() {
  const { close } = useModal();
  const { currentUser, updateProfile } = useTeam();

  const [displayName, setDisplayName] = useState(currentUser.displayName);
  const [nameColor, setNameColor] = useState(currentUser.nameColor);
  const [avatarId, setAvatarId] = useState(currentUser.avatar);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const draft = { displayName, nameColor, avatar: avatarId };
  const canSubmit = validateProfileDraft(draft).length === 0;

  function submit() {
    if (!canSubmit) return;
    setSubmitError(null);
    const result = updateProfile(draft);
    if (result.ok) {
      close();
    } else {
      setSubmitError(result.error);
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
            onClick={submit}
            className="cut-sm h-9 w-full px-5 text-xs font-semibold uppercase tracking-wide text-black bg-jade transition-[filter] motion-safe:hover:brightness-110 motion-safe:active:brightness-95 disabled:opacity-40 disabled:pointer-events-none"
          >
            Save
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Display name
          </label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full border border-border bg-surface-1 px-3 py-2 text-sm text-foreground focus:border-jade focus:outline-none focus:ring-1 focus:ring-jade/40"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Name color
          </label>
          <div className="flex flex-wrap gap-2">
            {NAME_COLOR_SWATCHES.map((swatchClass, i) => {
              const hex = NAME_COLORS[i];
              return (
                <button
                  key={hex}
                  type="button"
                  aria-label={`Name color ${i + 1}`}
                  aria-pressed={nameColor === hex}
                  onClick={() => setNameColor(hex)}
                  className={cn(
                    "size-7 shrink-0 rounded-full ring-offset-2 ring-offset-surface-2 transition-shadow",
                    swatchClass,
                    nameColor === hex && "ring-2 ring-jade",
                  )}
                />
              );
            })}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Avatar
          </label>
          <div className="grid grid-cols-4 gap-2">
            {AVATAR_ICONS.map(({ id, Icon }) => (
              <button
                key={id}
                type="button"
                aria-pressed={avatarId === id}
                onClick={() => setAvatarId(id)}
                className={cn(
                  "cut-sm flex aspect-square items-center justify-center border bg-surface-1 text-foreground transition-colors",
                  avatarId === id ? "border-jade text-jade" : "border-border",
                )}
              >
                <Icon className="size-5" />
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled
            title="Custom image upload arrives with file storage"
            className="mt-2 border border-border px-3 py-1.5 text-xs font-medium text-foreground opacity-40 pointer-events-none"
          >
            Upload image
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
