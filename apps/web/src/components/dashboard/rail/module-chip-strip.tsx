"use client";

import { useEffect, useState } from "react";
import { CONFIG } from "@repo/shared";
import { CoinAmount } from "@/components/sl/coin-amount";
import { ModalShell } from "@/components/sl/modal-shell";
import { useTeam } from "@/lib/team-context";
import { useFeatureFlag } from "@/lib/feature-flags";
import { WalletModule } from "./wallet-module";
import { StandingsModule } from "./standings-module";
import { TeamModule } from "./team-module";
import { ChatModule } from "./chat-module";

type SheetId = "wallet" | "standings" | "team" | "chat";

const SHEET_EYEBROWS: Record<SheetId, string> = {
  wallet: "WALLET",
  standings: "STANDINGS",
  team: "TEAM",
  chat: "TEAM CHAT",
};

/**
 * Mobile/tablet (<1024px) replacement for the rail (design-dashboard.md §6):
 * a horizontal chip strip under the ticker. Each chip opens its module as a
 * bottom sheet via ModalShell, reusing the exact same module component.
 *
 * **The chat chip is now the real UX-019 channel (roadmap §8 Extra Phase 1),
 * not the "SOON" teaser it was through Phase 9.** It reads `global-team-chat`
 * (seeded `true` by that phase's migration) — the SAME flag `pulse-rail.tsx`
 * gates its module 4 on, and deliberately not a second flag: a toggle that
 * hides the module on desktop and leaves it reachable on mobile is a bug that
 * only shows up on someone else's phone, and one flag driving both
 * breakpoints is what rules that out by construction. (`coming-soon-teasers`
 * used to gate this chip's `SOON` badge; it has no subject here any more —
 * see `pulse-rail.tsx`'s header for where that flag's live reader moved and
 * why it was re-pointed rather than deleted.)
 *
 * **Unread dot, not a notification (ARC-014).** The chip shows a small jade
 * dot plus `chat.unreadCount` whenever that count is positive — an in-app
 * marker painted only while this strip is on screen, exactly like the rail's
 * badge (`chat-module.tsx`). Nothing here changes the tab title, plays a
 * sound, or fires a push/email; it disappears the moment the count returns to
 * zero, same as it appeared.
 *
 * **`earlierMessagesMode="page"` (D4).** Below `lg` this sheet IS the whole
 * chat experience — there is no further "expand" destination, because the
 * sheet already shows the exact module the modal would. Passing "page" (as
 * opposed to `pulse-rail.tsx`'s "modal") tells `ChatModule` to hide its
 * header expand control and make "See earlier messages" grow this same
 * module's in-place scrollback via `loadEarlierChat()`, rather than opening
 * `chat-modal.tsx` on top of an already-open sheet — exactly the "modal
 * stacked on a sheet" `design-dashboard.md` §6 forbids. See `chat-module.tsx`'s
 * header for the full contract this prop carries.
 */
export function ModuleChipStrip() {
  const { team, balance, richest, currentUser, chat, loadChat } = useTeam();
  const showChat = useFeatureFlag("global-team-chat");
  const [active, setActive] = useState<SheetId | null>(null);

  const richestRankIndex = richest.findIndex((m) => m.userId === currentUser.id);
  const richestRank = richestRankIndex === -1 ? null : richestRankIndex + 1;

  // The unread dot has to be REAL the first time this strip renders, before
  // the sheet is ever opened — so this mount, not the sheet opening, is what
  // triggers the load. This is one small RPC (`chat_page`, `CHAT_RAIL_PAGE_SIZE`
  // rows via `fetchChatPage` — same call `chat-module.tsx`/`chat-modal.tsx`
  // make), idempotent per team (`loadChat` is a no-op once `chat.status`
  // leaves "idle"), and NOT `loadTeamData` — chat stays out of that function
  // on purpose (task 7's hard requirement) and this effect must never become
  // the back door that puts it there.
  useEffect(() => {
    if (showChat && chat.status === "idle") void loadChat();
  }, [showChat, chat.status, loadChat]);

  return (
    <>
      <div className="flex h-14 items-center gap-2 overflow-x-auto border-b border-border px-3 lg:hidden">
        <button
          type="button"
          onClick={() => setActive("wallet")}
          className="flex h-9 shrink-0 items-center gap-2 rounded-sm border border-border bg-surface-1 px-3 text-xs text-foreground"
        >
          Wallet
          <CoinAmount amount={balance} />
        </button>

        <button
          type="button"
          onClick={() => setActive("standings")}
          className="flex h-9 shrink-0 items-center gap-2 rounded-sm border border-border bg-surface-1 px-3 text-xs text-foreground"
        >
          Standings
          <span className="font-mono tabular-nums text-muted-foreground">
            #{richestRank ?? "–"}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActive("team")}
          className="flex h-9 shrink-0 items-center gap-2 rounded-sm border border-border bg-surface-1 px-3 text-xs text-foreground"
        >
          Team
          <span className="font-mono tabular-nums text-muted-foreground">
            {team.members.length}/{CONFIG.TEAM_TARGET_SIZE}
          </span>
        </button>

        {showChat && (
          <button
            type="button"
            onClick={() => setActive("chat")}
            className="flex h-9 shrink-0 items-center gap-2 rounded-sm border border-border bg-surface-1 px-3 text-xs text-foreground"
          >
            Chat
            {chat.unreadCount > 0 && (
              <span className="flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-jade" aria-hidden />
                <span className="font-mono tabular-nums text-jade">
                  {chat.unreadCount}
                </span>
              </span>
            )}
          </button>
        )}
      </div>

      {active && (
        <ModalShell
          eyebrow={SHEET_EYEBROWS[active]}
          title={team.name}
          onClose={() => setActive(null)}
        >
          {active === "wallet" && <WalletModule />}
          {active === "standings" && <StandingsModule />}
          {active === "team" && <TeamModule />}
          {active === "chat" && <ChatModule earlierMessagesMode="page" />}
        </ModalShell>
      )}
    </>
  );
}
