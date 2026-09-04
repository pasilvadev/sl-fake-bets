"use client";

import { cn } from "cn";
import type { User } from "@repo/shared";
import { useTeam } from "@/lib/team-context";
import { RankBadge } from "./rank-badge";

/** Display name colored via the user's own name-color, with an optional inline rank badge. */
export function UserName({
  user,
  badge = false,
  className,
}: {
  user: User;
  badge?: boolean;
  className?: string;
}) {
  const { rankBadgeFor } = useTeam();
  const kind = badge ? rankBadgeFor(user.id) : null;

  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <span className="font-medium" style={{ color: user.nameColor }}>
        {user.displayName}
      </span>
      {kind && <RankBadge kind={kind} />}
    </span>
  );
}
