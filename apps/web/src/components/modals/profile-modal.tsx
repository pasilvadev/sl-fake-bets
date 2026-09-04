"use client";

import { useState } from "react";
import { cn } from "cn";
import { Crown, Dice5, Flame, Ghost, Moon, Skull, Star, Zap } from "lucide-react";
import { useModal } from "@/lib/modal-context";
import { useTeam } from "@/lib/team-context";
import { ModalShell } from "@/components/sl/modal-shell";

// Literal class names, not interpolated — Tailwind v4 only generates
// utilities for class strings it can see statically in source.
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

/** UX-022: profile editor — shaped, Phase-1 inert (client state only, Save disabled). */
export function ProfileModal() {
  const { close } = useModal();
  const { currentUser } = useTeam();

  const [displayName, setDisplayName] = useState(currentUser.displayName);
  const [colorIndex, setColorIndex] = useState<number | null>(null);
  const [avatarId, setAvatarId] = useState(currentUser.avatar);

  return (
    <ModalShell
      eyebrow="PROFILE"
      title="Edit profile"
      onClose={close}
      footer={
        <div className="space-y-1.5">
          <button
            type="button"
            disabled
            className="h-9 w-full px-5 text-xs font-semibold uppercase tracking-wide text-black bg-jade opacity-40 pointer-events-none"
          >
            Save
          </button>
          <p className="text-[11px] text-muted-foreground">
            Profile editing wires up in Phase 2.
          </p>
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
              const n = i + 1;
              return (
                <button
                  key={n}
                  type="button"
                  aria-label={`Name color ${n}`}
                  onClick={() => setColorIndex(n)}
                  className={cn(
                    "size-7 shrink-0 rounded-full ring-offset-2 ring-offset-surface-2 transition-shadow",
                    swatchClass,
                    colorIndex === n && "ring-2 ring-jade",
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
            title="Phase 1 — not wired"
            className="mt-2 border border-border px-3 py-1.5 text-xs font-medium text-foreground opacity-40 pointer-events-none"
          >
            Upload image
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
