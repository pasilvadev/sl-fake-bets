"use client";

import { useState } from "react";
import { cn } from "cn";
import { Ban, UserX } from "lucide-react";
import { getUser } from "@repo/shared";
import { useModal } from "@/lib/modal-context";
import { useTeam } from "@/lib/team-context";
import { ModalShell } from "@/components/sl/modal-shell";
import { UserAvatar } from "@/components/sl/user-avatar";
import { UserName } from "@/components/sl/user-name";
import { CoinAmount } from "@/components/sl/coin-amount";

/** DOM-002/024/031/033/034: team settings — full for leader/mod, read-only for members. */
export function TeamSettingsModal() {
  const { close } = useModal();
  const { team, isLeader, canManage } = useTeam();
  const [confirmText, setConfirmText] = useState("");

  const matches = confirmText === team.name;

  return (
    <ModalShell
      eyebrow="TEAM"
      title={team.name}
      onClose={close}
      danger={isLeader}
      footer={
        !canManage ? undefined : (
          <p className="text-[11px] text-muted-foreground">
            {isLeader ? "Leader controls" : "Moderator controls"} — Phase 1 demo, nothing is saved.
          </p>
        )
      }
    >
      <div className="space-y-6">
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Access mode
          </p>
          <div
            className="flex items-center justify-between border border-border p-3"
            title="Phase 1 — not wired"
          >
            <div>
              <p className="text-sm text-foreground">Free-for-all</p>
              <p className="text-xs text-muted-foreground">
                {team.accessMode === "free-for-all"
                  ? "Anyone can create bets & invite."
                  : "Only mods & the leader can create bets & invite."}
              </p>
            </div>
            <span
              aria-disabled
              className={cn(
                "relative inline-flex h-5 w-9 shrink-0 items-center opacity-60",
                team.accessMode === "free-for-all" ? "bg-jade" : "bg-input",
              )}
            >
              <span
                className={cn(
                  "absolute size-3.5 rounded-full bg-surface-2 transition-transform",
                  team.accessMode === "free-for-all"
                    ? "translate-x-4"
                    : "translate-x-0.5",
                )}
              />
            </span>
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Roster ({team.members.length})
          </p>
          <ul>
            {team.members.map((member) => {
              const user = getUser(member.userId);
              if (!user) return null;
              const roleLabel =
                member.userId === team.leaderId
                  ? "LEADER"
                  : member.role === "moderator"
                    ? "MOD"
                    : "—";
              const showActions = canManage && member.userId !== team.leaderId;

              return (
                <li
                  key={member.userId}
                  className="flex items-center gap-3 border-b border-border py-2.5"
                >
                  <UserAvatar user={user} size={28} />
                  <div className="min-w-0 flex-1">
                    <UserName user={user} badge />
                  </div>
                  <span className="w-12 shrink-0 text-[11px] font-semibold uppercase text-muted-foreground">
                    {roleLabel}
                  </span>
                  <CoinAmount amount={member.coinBalance} className="text-sm" />
                  {showActions && (
                    <div className="flex shrink-0 items-center gap-1">
                      {isLeader && (
                        <button
                          type="button"
                          title="Phase 1 — not wired"
                          className="px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground"
                        >
                          Inject
                        </button>
                      )}
                      <button
                        type="button"
                        title="Phase 1 — not wired"
                        aria-label="Kick"
                        className="p-1.5 text-foreground transition-colors hover:bg-ember-wash"
                      >
                        <UserX className="size-3.5 text-ember" />
                      </button>
                      <button
                        type="button"
                        title="Phase 1 — not wired"
                        aria-label="Ban"
                        className="p-1.5 text-foreground transition-colors hover:bg-ember-wash"
                      >
                        <Ban className="size-3.5 text-ember" />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {isLeader && (
          <div className="space-y-2 rounded-sm border border-ember-border p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Danger zone
            </p>
            <p className="text-sm text-foreground">Delete team</p>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={`Type "${team.name}" to confirm`}
              className={cn(
                "w-full border bg-surface-1 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none",
                matches ? "border-jade" : "border-border",
              )}
            />
            <button
              type="button"
              disabled={!matches}
              onClick={close}
              className="cut-danger h-9 w-full px-5 text-xs font-semibold uppercase tracking-wide text-black bg-destructive opacity-40 pointer-events-none transition-opacity enabled:opacity-100 enabled:pointer-events-auto"
            >
              Delete team
            </button>
          </div>
        )}
      </div>
    </ModalShell>
  );
}
