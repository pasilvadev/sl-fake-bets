"use client";

import { getUser } from "@repo/shared";
import { UserAvatar } from "./user-avatar";

/** Overlapping avatar stack + trailing "+N" mono circle for the overflow. */
export function AvatarCluster({
  userIds,
  max = 3,
  size = 20,
}: {
  userIds: string[];
  max?: number;
  size?: number;
}) {
  const shown = userIds.slice(0, max);
  const extra = userIds.length - shown.length;

  return (
    <div className="flex items-center -space-x-2">
      {shown.map((userId) => {
        const user = getUser(userId);
        if (!user) return null;
        return (
          <UserAvatar
            key={userId}
            user={user}
            size={size}
            className="border-2 border-background"
          />
        );
      })}
      {extra > 0 && (
        <div
          className="flex items-center justify-center rounded-full border-2 border-background bg-surface-3 font-mono text-[10px] tabular-nums text-muted-foreground"
          style={{ width: size, height: size }}
        >
          +{extra}
        </div>
      )}
    </div>
  );
}
