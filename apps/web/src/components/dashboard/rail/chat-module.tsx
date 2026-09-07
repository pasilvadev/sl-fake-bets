"use client";

import { useEffect, useRef, useState } from "react";
import { Maximize2 } from "lucide-react";
import { useModal } from "@/lib/modal-context";
import { useTeam, type MutationResult } from "@/lib/team-context";
import { useToast } from "@/lib/toast-context";
import { useErrorText } from "@/lib/use-error-text";
import {
  ChatComposer,
  ChatEmpty,
  ChatEndOfHistory,
  ChatNewPill,
  ChatRows,
  ChatSkeleton,
  useStickToBottom,
} from "./chat-thread";

/** ~7 dense rows (§4.5) — enough to feel like a live channel, small enough
 * that the module doesn't dominate a rail that also holds Wallet/Standings/
 * Team. The scrollable region below is THIS module's own, distinct from the
 * outer sticky aside's scroll in `dashboard-page.tsx` — nested scroll is
 * fine here because the outer one only ever engages once every module's
 * combined natural height (this one bounded, the others not) exceeds the
 * viewport, which is the existing behavior for all four rail modules. */
const RAIL_SCROLL_MAX_HEIGHT_PX = 288;

/**
 * Pulse Rail module 4/4 (design-dashboard.md §4.4, roadmap §8 Extra Phase 1
 * task 10) — the real UX-019 team channel, replacing
 * `chat-stub-module.tsx`'s greyed-out `SOON` teaser with a working one.
 * Reads and writes the ONE chat store `team-context.tsx` owns
 * (`TeamState.chat`) — this module holds no messages of its own, which is
 * exactly the property `chat-modal.tsx` (task 11, built in this same
 * sitting per the plan's own instruction not to split the two) exists to
 * prove: both surfaces render the identical `chat.messages` array through
 * the identical `chat-thread.tsx` presentation.
 *
 * **The `earlierMessagesMode` prop.** D4 requires TWO ways to reach full
 * 30-day scrollback from this module — the header's expand control and the
 * "See earlier messages" line above the oldest loaded row — and BOTH must
 * behave differently at the two breakpoints this module is mounted at
 * (`pulse-rail.tsx`, `>=lg`, vs `module-chip-strip.tsx`'s bottom sheet,
 * `<lg`): opening `chat-modal.tsx` on top of an already-open bottom sheet is
 * exactly the "modal stacked on a sheet" design-dashboard.md §6 forbids,
 * because below `lg` the sheet already IS the full chat experience. Rather
 * than this module sniffing the viewport itself (in two places, for two
 * controls), the CALLER — who already knows which shell it is mounting this
 * into — says so once:
 *
 *   "modal" — both controls call `useModal().open("chat")`. This is
 *             `pulse-rail.tsx`'s mode: a permanently-docked module with a
 *             modal layer free to open above it.
 *   "page"  — the header's expand control does not render at all (there is
 *             nothing further to expand to — the sheet already shows this
 *             exact module at full size), and "See earlier messages"
 *             instead calls `loadEarlierChat()` and grows this module's own
 *             in-place scrollback. This is `module-chip-strip.tsx`'s mode.
 *
 * **ARC-014/DOM-030 boundary**, stated once for this whole file: nothing
 * below produces a push, an email, a `document.title` count, or any other
 * notification — the unread badge and `ChatNewPill` are in-app markers only,
 * rendered because the surface is open, never because of anything that
 * happened while it wasn't. And there is no per-row control here that hides,
 * flags, or deletes anyone else's message — `chat_messages_delete_own`
 * (20260906120000_team_chat.sql) grants a member DELETE on their OWN row,
 * but this phase ships no UI for it anywhere, on purpose (see
 * `chat-thread.tsx`'s header for the fuller version of this note).
 */
export function ChatModule({
  earlierMessagesMode,
}: {
  earlierMessagesMode: "modal" | "page";
}) {
  const { chat, loadChat, loadEarlierChat, sendChatMessage, markChatSeen } =
    useTeam();
  const { open } = useModal();
  const { show } = useToast();

  const { errorText, codeText } = useErrorText();
  const [sendPending, setSendPending] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const loadingEarlierRef = useRef(false);

  const rootRef = useRef<HTMLElement | null>(null);
  const [rootVisible, setRootVisible] = useState(false);

  const { scrollRef, atBottom, scrollToBottom } = useStickToBottom(chat.messages);

  // Lazy load (task 7): a no-op once `chat.status` leaves "idle" for this
  // team, and fires again on its own the moment a team switch resets it back
  // to "idle" — see `loadChat`'s own doc comment in team-context.tsx for why
  // that reset, not a dependency on the team id here, is what re-triggers
  // this effect.
  useEffect(() => {
    if (chat.status === "idle") void loadChat();
  }, [chat.status, loadChat]);

  // The "visible" half of `markChatSeen`'s contract below: the sticky aside
  // can scroll this module out of view while it stays mounted, so "mounted"
  // alone isn't "visible." A plain IntersectionObserver on the module's own
  // root answers that without a second copy of scroll math.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setRootVisible(entry.isIntersecting),
      { threshold: 0.4 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The whole enforcement point for D2/task 9's rule: advance the LIVE
  // marker ONLY while this surface is visible AND scrolled to the bottom —
  // never on mount (`markChatSeen` itself is a no-op with zero messages, but
  // the visible+bottom gate here is what stops it from eating days of
  // backlog the instant a member merely glances at the dashboard).
  useEffect(() => {
    if (!atBottom || !rootVisible) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      return;
    }
    markChatSeen();
    // `chat.messages.length` (not `chat.messages` itself) is the dependency:
    // a NEW message while already visible+at-bottom must re-fire this, but a
    // patched `createdAt` on the same set of ids (send-settled) must not.
  }, [atBottom, rootVisible, chat.messages.length, markChatSeen]);

  // Covers the one case the effect above can't: the tab was backgrounded
  // while this module sat visible+at-bottom with nothing new arriving, then
  // came back — no dependency above changes, so nothing would otherwise
  // re-run this check on refocus.
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === "visible" && atBottom && rootVisible) {
        markChatSeen();
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [atBottom, rootVisible, markChatSeen]);

  // "N new" since the reader last scrolled away from the bottom — a
  // DIFFERENT count from `chat.unreadCount` (which is vs the LIVE seen
  // marker, D2). This one resets every time `atBottom` returns to true, so
  // it answers "how much did I just miss while I was reading up there,"
  // not "how much is unread since I last opened this team's chat." The
  // baseline lives in a ref (it must survive across renders without itself
  // triggering one), but the DERIVED count is real state, computed only
  // inside the effect — react-hooks/refs forbids reading `.current` during
  // render, so this can't instead be a plain expression evaluated below.
  const awayBaselineRef = useRef<number | null>(null);
  const [newSinceScrolledAway, setNewSinceScrolledAway] = useState(0);
  useEffect(() => {
    if (!atBottom) {
      if (awayBaselineRef.current === null) {
        awayBaselineRef.current = chat.messages.length;
      }
      setNewSinceScrolledAway(Math.max(0, chat.messages.length - awayBaselineRef.current));
    } else {
      awayBaselineRef.current = null;
      setNewSinceScrolledAway(0);
    }
  }, [atBottom, chat.messages.length]);

  async function handleSend(body: string): Promise<MutationResult> {
    setSendPending(true);
    const result = await sendChatMessage(body);
    setSendPending(false);
    // The store has already removed the optimistic row on failure (task 8) —
    // this toast is the ONLY trace of that vanished row (the composer keeps
    // the text itself, D6). The key is the literal `"chat-send"` and NOT a
    // per-file one: at >=lg the rail and `chat-modal.tsx` are mounted at the
    // same time, so a per-surface key would let one rejection stack two cards
    // in the shared layer. One card per burst, whichever surface sent (D6).
    if (!result.ok) show({ kind: "failure", text: errorText(result), key: "chat-send" });
    return result;
  }

  async function handleSeeEarlier() {
    if (earlierMessagesMode === "modal") {
      open("chat");
      return;
    }
    if (loadingEarlierRef.current || !chat.hasMore) return;
    loadingEarlierRef.current = true;
    setLoadingEarlier(true);
    await loadEarlierChat();
    loadingEarlierRef.current = false;
    setLoadingEarlier(false);
  }

  const composerDisabled = chat.status !== "ready";

  return (
    <section
      ref={rootRef}
      className="relative rounded-sm border border-border bg-surface-1 p-4"
    >
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          TEAM CHAT
        </p>
        <div className="flex items-center gap-2">
          {chat.unreadCount > 0 && (
            <span className="rounded-sm bg-jade-wash px-1.5 py-0.5 text-[10px] font-semibold text-jade">
              {chat.unreadCount}
            </span>
          )}
          {/* D4's header expand control — gated on the same prop as "See
              earlier messages" below; see this file's header comment for
              why "page" mode renders neither as an open-the-modal control. */}
          {earlierMessagesMode === "modal" && (
            <button
              type="button"
              onClick={() => open("chat")}
              aria-label="Open full chat history"
              className="text-muted-foreground transition-colors hover:text-jade"
            >
              <Maximize2 className="size-3.5" aria-hidden />
            </button>
          )}
        </div>
      </div>

      {chat.status === "idle" || chat.status === "loading" ? (
        <ChatSkeleton rows={4} />
      ) : chat.status === "error" ? (
        <p className="py-4 text-sm text-negative">
          {codeText(chat.error ?? "chat-load-failed")}
        </p>
      ) : chat.messages.length === 0 ? (
        <ChatEmpty />
      ) : (
        <div
          ref={scrollRef}
          className="relative overflow-y-auto"
          style={{ maxHeight: RAIL_SCROLL_MAX_HEIGHT_PX }}
        >
          {chat.hasMore ? (
            <button
              type="button"
              onClick={() => void handleSeeEarlier()}
              disabled={loadingEarlier}
              className="mb-1 block w-full py-1 text-center text-xs text-jade hover:underline disabled:pointer-events-none disabled:opacity-40"
            >
              {loadingEarlier ? "Loading…" : "See earlier messages"}
            </button>
          ) : (
            <ChatEndOfHistory />
          )}
          <ChatRows messages={chat.messages} firstUnreadId={chat.firstUnreadId} />
          <ChatNewPill count={newSinceScrolledAway} onClick={() => scrollToBottom()} />
        </div>
      )}

      <ChatComposer
        onSend={handleSend}
        pending={sendPending}
        disabled={composerDisabled}
        placeholder={composerDisabled ? "Loading chat…" : "Say something"}
      />
    </section>
  );
}
