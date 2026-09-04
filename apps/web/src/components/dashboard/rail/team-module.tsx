"use client";

import { CONFIG } from "@repo/shared";
import { AvatarCluster } from "@/components/sl/avatar-cluster";
import { useModal } from "@/lib/modal-context";
import { useTeam } from "@/lib/team-context";

/**
 * Pulse Rail module 3/4 (design-dashboard.md §4.3): member count, avatar
 * cluster, access-mode readout, Invite (gated) + Manage/View team actions.
 */
export function TeamModule() {
  const { team, canInvite, canManage } = useTeam();
  const { open } = useModal();

  const memberIds = team.members.map((m) => m.userId);

  return (
    <section className="rounded-sm border border-border bg-surface-1 p-4">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        TEAM
      </p>

      <p className="font-mono text-sm text-foreground">
        {memberIds.length} / {CONFIG.TEAM_TARGET_SIZE} members
      </p>

      <div className="mt-2">
        <AvatarCluster userIds={memberIds} max={6} size={24} />
      </div>

      <p className="mt-2 text-[11px] uppercase text-muted-foreground">
        {team.accessMode}
      </p>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => open("invite")}
          disabled={!canInvite}
          className="h-8 flex-1 rounded-sm border border-border bg-transparent px-3 text-xs text-foreground transition-colors hover:border-jade/50 hover:text-jade disabled:opacity-40 disabled:pointer-events-none"
        >
          Invite
        </button>
        <button
          type="button"
          onClick={() => open("team-settings")}
          className="h-8 flex-1 rounded-sm px-3 text-xs text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground"
        >
          {canManage ? "Manage team" : "View team"}
        </button>
      </div>
    </section>
  );
}
