"use client";

import { mockUsers } from "@repo/shared";
import { UserAvatar } from "@/components/sl/user-avatar";
import { UserName } from "@/components/sl/user-name";

const SAMPLE_MESSAGES = [
  { user: mockUsers[1], body: "gg ez" },
  { user: mockUsers[5], body: "quem topa nova bet?" },
];

/**
 * Pulse Rail module 4/4 (design-dashboard.md §4.4, UX-019 future-stub).
 * Distinct from per-bet chat (UX-018, bet-detail only). Two greyed sample
 * rows using real §5.7 chat-row anatomy + a fully disabled input row with
 * the future `/` send-glyph affordance drawn but inert.
 */
export function ChatStubModule() {
  return (
    <section className="rounded-sm border border-border bg-surface-1 p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          TEAM CHAT
        </p>
        <span className="rounded-sm border border-border px-1.5 text-[10px] uppercase text-muted-foreground">
          SOON
        </span>
      </div>

      <div className="opacity-40">
        {SAMPLE_MESSAGES.map(({ user, body }) => (
          <div key={user.id} className="flex items-center gap-2 py-1.5">
            <UserAvatar user={user} size={24} />
            <UserName user={user} />
            <span className="truncate text-sm text-foreground">{body}</span>
          </div>
        ))}
      </div>

      <div className="mt-2 flex gap-2 border-t border-border bg-surface-1 pt-2 pointer-events-none">
        <input
          disabled
          placeholder="Coming soon"
          className="h-8 flex-1 rounded-none border border-border bg-surface-2 px-2 text-sm text-foreground placeholder:text-muted-foreground"
        />
        <span className="flex items-center px-1 font-mono text-muted-foreground">
          /
        </span>
      </div>
    </section>
  );
}
