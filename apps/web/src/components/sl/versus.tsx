"use client";

import { cn } from "cn";
import { useTeam } from "@/lib/team-context";
import { UserAvatar } from "./user-avatar";
import { UserName } from "./user-name";

/**
 * Two identity clusters opposed across a `VS` mark — the duel's face
 * (Extra Phase 3, task 4; a new entry in `design-visual-identity.md` §5.6).
 *
 * It exists because nothing in the system could express *opposition*.
 * `avatar-cluster.tsx` is same-side by construction — an overlapping
 * `-space-x-2` stack whose whole grammar is "these people are together" — and
 * §5.1's Participants cell is that stack. A duel needs the opposite reading,
 * and reading it wrong is not cosmetic: a symmetric two-person bet rendered as
 * a huddle of participants is exactly the pari-mutuel misread task 5 replaces
 * the odds cell to avoid.
 *
 * Composed, never re-rendered: `UserAvatar` + `UserName badge` per side, which
 * is §5.11's "same atomic identity cluster as chat (§5.7/§5.6)" — the name in
 * the user's own `nameColor` and, glued to it, the slanted-parallelogram rank
 * badge `UserName` already appends. Nothing here re-implements a name, a color
 * or a badge; that is the entire reason those three components exist.
 *
 * **The separator is a `VS` word mark, not a diagonal.** §4.3's motif table
 * puts "List separators, chat separators, table rows (stay horizontal — scan
 * speed wins there)" in the must-NOT column for the 68° hairline, and the one
 * viewport where a diagonal would be sanctioned — the bet-detail hero — has
 * already spent its single-cut budget on §5.11's `cut-md` header. So both
 * sizes get the same neutral mark, and the composition carries the opposition
 * through layout (left-aligned vs right-aligned, `justify-between`) rather
 * than through a brand element it cannot afford.
 *
 * Two sizes, because the row and the detail page are different density tiers
 * (§4.5): `"dense"` for the 64px feed row, `"comfortable"` for the detail
 * hero. They differ only in avatar px and type scale — never in what is shown,
 * so a duel does not gain or lose a badge by being looked at more closely.
 *
 * A participant whose `User` this client does not hold renders as a neutral
 * `—` placeholder rather than collapsing the side (`avatar-cluster.tsx`'s
 * `if (!user) return null` is right for a stack and wrong here): a versus with
 * one side missing is unreadable, and the case is reachable — the departure
 * cascade voids a *live* duel whose participant leaves, but a duel that
 * settled months ago keeps naming someone who has since gone.
 */
export type VersusSize = "dense" | "comfortable";

const SIZES = {
  dense: { avatar: 20, name: "text-xs", gap: "gap-1.5" },
  comfortable: { avatar: 32, name: "text-sm", gap: "gap-2" },
} as const;

function Side({
  userId,
  size,
  align,
}: {
  userId: string;
  size: VersusSize;
  align: "start" | "end";
}) {
  const { userById } = useTeam();
  const user = userById(userId);
  const spec = SIZES[size];

  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 items-center",
        spec.gap,
        align === "end" && "flex-row-reverse text-right",
      )}
    >
      {user ? (
        <>
          <UserAvatar user={user} size={spec.avatar} />
          {/* `truncate` rides a wrapper, not `UserName`'s own className: that
              class lands on its outer `inline-flex`, which clips nothing. A
              truncating block DOES clip the inline run inside it, badge
              included, which is the behaviour a 64px row needs. */}
          <div className={cn("min-w-0 truncate", spec.name)}>
            <UserName user={user} badge />
          </div>
        </>
      ) : (
        <>
          <div
            className="shrink-0 rounded-full bg-surface-3"
            style={{ width: spec.avatar, height: spec.avatar }}
          />
          <span className={cn("truncate text-muted-foreground", spec.name)}>—</span>
        </>
      )}
    </div>
  );
}

export function Versus({
  challengerId,
  challengeeId,
  size = "dense",
  className,
}: {
  challengerId: string;
  challengeeId: string;
  size?: VersusSize;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center",
        size === "dense" ? "gap-2" : "gap-4",
        className,
      )}
    >
      <Side userId={challengerId} size={size} align="start" />

      {/* §3's label role — sans 600, 11px, uppercase, wide tracking, N6. Not a
          chip and not a glyph: `/` and `\` are the gain/loss vocabulary (§5.5)
          and mean something else entirely. */}
      <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        vs
      </span>

      <Side userId={challengeeId} size={size} align="end" />
    </div>
  );
}
