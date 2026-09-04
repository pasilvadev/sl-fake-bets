"use client";

import { useState } from "react";
import { cn } from "cn";
import { useModal } from "@/lib/modal-context";
import { useTeam } from "@/lib/team-context";
import { ModalShell } from "@/components/sl/modal-shell";
import { SMark } from "@/components/sl/s-mark";

/** UX-023: invite-friends modal — OG-preview mock + copyable link. */
export function InviteModal() {
  const { close } = useModal();
  const { team, bets } = useTeam();
  const [copied, setCopied] = useState(false);

  const openCount = bets.filter((b) => b.state === "open").length;
  const inviteUrl = `https://sl.bet/i/${team.inviteCode}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
    } catch {
      // clipboard API unavailable — Phase 1 has no fallback UI for this.
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <ModalShell
      eyebrow="INVITE FRIENDS"
      title={team.name}
      onClose={close}
      footer={
        <p className="text-[11px] text-muted-foreground">
          Revoke/regenerate — future.
        </p>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-3 border border-border bg-surface-1 p-4">
          <SMark className="size-8 text-jade" />
          <div>
            <p className="text-sm font-medium text-text-strong">
              Join {team.name} on SL
            </p>
            <p className="text-xs text-muted-foreground">
              {team.members.length} members · {openCount} open bets
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Invite link
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              readOnly
              value={inviteUrl}
              className="w-full border border-border bg-surface-1 px-3 py-2 font-mono text-xs tabular-nums text-foreground focus:border-jade focus:outline-none focus:ring-1 focus:ring-jade/40"
            />
            <button
              type="button"
              onClick={copyLink}
              className={cn(
                "shrink-0 border px-3 text-xs font-semibold uppercase tracking-wide transition-colors",
                copied
                  ? "border-jade text-jade"
                  : "border-border text-foreground hover:border-jade/50 hover:text-jade",
              )}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">Links never expire.</p>
        </div>
      </div>
    </ModalShell>
  );
}
