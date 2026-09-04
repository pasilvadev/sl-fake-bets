"use client";

import { useState } from "react";
import { cn } from "cn";
import type { TeamAccessMode } from "@repo/shared";
import { useModal } from "@/lib/modal-context";
import { ModalShell } from "@/components/sl/modal-shell";

/** DOM-002: new-team form. Phase 1 shaped-but-inert — Save closes without persisting. */
export function CreateTeamModal() {
  const { close } = useModal();
  const [name, setName] = useState("");
  const [accessMode, setAccessMode] = useState<TeamAccessMode>("free-for-all");

  return (
    <ModalShell
      eyebrow="NEW TEAM"
      title="Create a team"
      onClose={close}
      footer={
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={close}
            className="cut-sm h-9 w-full px-5 text-xs font-semibold uppercase tracking-wide text-black bg-jade transition-[filter] motion-safe:hover:brightness-110 motion-safe:active:brightness-95"
          >
            Create team
          </button>
          <p className="text-[11px] text-muted-foreground">
            Phase 2 wires this.
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
