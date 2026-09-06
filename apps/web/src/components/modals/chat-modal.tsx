"use client";

import { useEffect, useRef, useState } from "react";
import { useModal } from "@/lib/modal-context";
import { useTeam, type MutationResult } from "@/lib/team-context";
import { ModalShell } from "@/components/sl/modal-shell";
import { useToast } from "@/lib/toast-context";
import {
  ChatComposer,
  ChatEmpty,
  ChatEndOfHistory,
  ChatNewPill,
  ChatRows,
  ChatSkeleton,
  useStickToBottom,
} from "@/components/dashboard/rail/chat-thread";

/** Scroll-to-top pagination fires once the reader is within this many
 * pixels of the top — a real threshold, not `scrollTop === 0`, because a
 * momentum-scroll or a trackpad can overshoot the exact top by a few px and
 * a member who meant to trigger it shouldn't have to hit the pixel. */
const LOAD_EARLIER_SCROLL_THRESHOLD_PX = 64;

/** Fixed message-area height so the panel reads as a real chat surface —
 * "full-height" per task 11 — even for a team whose chat is nearly empty,
 * rather than a modal that hugs three rows of content. Comfortably inside
 * `ModalShell`'s own `max-h-[85vh]` panel cap alongside its header/close
 * row and this file's composer footer. */
const MODAL_SCROLL_HEIGHT = "60vh";

/**
 * The full-scrollback chat surface (roadmap §8 Extra Phase 1, task 11) —
 * `ModalShell` chrome, opened through `modal-context` like every other
 * modal in this app (UX-014/015/016), registered as `"chat"` by the agent
 * that owns `modal-context.tsx`/`modal-root.tsx` (this file does not touch
 * either, per this phase's own instructions).
 *
 * **The one property this file exists to prove.** It reads the EXACT SAME
 * `useTeam().chat` slice `chat-module.tsx` (the rail) reads — no local copy
 * of messages, no second fetch of the current page, no parallel keyset
 * cursor. The plan is explicit that tasks 10 and 11 are written in one
 * sitting for exactly this reason: a session that builds only the rail can
 * make `chat-thread.tsx`'s presentation look shared while secretly wiring a
 * private store underneath it, and the only way to catch that is to build
 * the second consumer and watch it read the identical state. `loadChat` /
 * `loadEarlierChat` / `sendChatMessage` / `markChatSeen` below are the exact
 * same four functions `chat-module.tsx` calls — this file just calls them
 * from a taller box.
 *
 * **Paging.** Scroll-to-top triggered (no manual "See earlier messages"
 * link here — that control is D4's RAIL-specific affordance; a modal a
 * member deliberately opened for history is already committing to
 * scrolling it), with a `ChatSkeleton` standing in for "a page is in
 * flight" and `ChatEndOfHistory` at the 30-day edge once `!chat.hasMore` —
 * "not an empty spinner," the phase's own exit criterion.
 *
 * **ARC-014/DOM-030 boundary** — identical to `chat-module.tsx`'s: nothing
 * here produces a push, an email, a `document.title` count, or any other
 * notification, and there is no control on any row that hides, flags, or
 * deletes anyone else's message. `chat_messages_delete_own`
 * (20260906120000_team_chat.sql) grants a member DELETE on their own row
 * only, and this phase ships no UI for it here either — see
 * `chat-thread.tsx`'s header for the full note; it is not repeated a third
 * time per file, just true of all three.
 */
export function ChatModal() {
  const { close } = useModal();
  const { team, chat, loadChat, loadEarlierChat, sendChatMessage, markChatSeen } =
    useTeam();
  const { show } = useToast();

  const [sendPending, setSendPending] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const loadingEarlierRef = useRef(false);

  const { scrollRef, atBottom, scrollToBottom } = useStickToBottom(chat.messages);

  // Same idempotent lazy load as the rail (task 7): a no-op once this
  // team's chat has left "idle," and safe to call from both surfaces at
  // once — D4's whole point.
  useEffect(() => {
    if (chat.status === "idle") void loadChat();
  }, [chat.status, loadChat]);

  // The modal, while mounted, IS the visible surface (it's the topmost
  // thing on screen) — so the only extra gate `markChatSeen`'s contract
  // needs here, beyond `atBottom`, is the tab actually being focused.
  useEffect(() => {
    if (!atBottom) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      return;
    }
    markChatSeen();
  }, [atBottom, chat.messages.length, markChatSeen]);

  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === "visible" && atBottom) markChatSeen();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [atBottom, markChatSeen]);

  // Same "away from bottom" tally as the rail — see chat-module.tsx's
  // comment on the identical block for why the derived count is real state
  // (react-hooks/refs forbids reading `.current` during render), not a
  // plain expression over the baseline ref.
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
    // Same literal `"chat-send"` key the rail uses — at >=lg both surfaces
    // are mounted at once and share one toast layer, so a per-file key would
    // let a single rejected burst stack two cards (D6).
    if (!result.ok) show({ kind: "failure", text: result.error, key: "chat-send" });
    return result;
  }

  async function handleLoadEarlier() {
    if (loadingEarlierRef.current || !chat.hasMore || chat.status !== "ready") return;
    loadingEarlierRef.current = true;
    setLoadingEarlier(true);
    await loadEarlierChat();
    loadingEarlierRef.current = false;
    setLoadingEarlier(false);
  }

  const composerDisabled = chat.status !== "ready";

  return (
    <ModalShell eyebrow="TEAM CHAT" title={team.name} onClose={close}>
      {/* Negative margins cancel ModalShell's own `px-6 py-4` on this
          content slot so the composer's `border-t` runs edge-to-edge across
          the panel — §5.7's "fixed to panel bottom" read literally — while
          the message list re-applies that same padding just for itself. */}
      <div className="-mx-6 -my-4 flex flex-col">
        <div
          ref={scrollRef}
          onScroll={(e) => {
            if (e.currentTarget.scrollTop <= LOAD_EARLIER_SCROLL_THRESHOLD_PX) {
              void handleLoadEarlier();
            }
          }}
          className="relative overflow-y-auto px-6 py-4"
          style={{ height: MODAL_SCROLL_HEIGHT }}
        >
          {chat.status === "idle" || chat.status === "loading" ? (
            <ChatSkeleton rows={10} />
          ) : chat.status === "error" ? (
            <p className="py-6 text-center text-sm text-negative">
              {chat.error ?? "Could not load chat."}
            </p>
          ) : chat.messages.length === 0 ? (
            <ChatEmpty />
          ) : (
            <>
              {loadingEarlier ? (
                <ChatSkeleton rows={2} />
              ) : !chat.hasMore ? (
                <ChatEndOfHistory />
              ) : null}
              <ChatRows messages={chat.messages} firstUnreadId={chat.firstUnreadId} />
              <ChatNewPill count={newSinceScrolledAway} onClick={() => scrollToBottom()} />
            </>
          )}
        </div>

        <ChatComposer
          onSend={handleSend}
          pending={sendPending}
          disabled={composerDisabled}
          placeholder={composerDisabled ? "Loading chat…" : "Say something"}
        />
      </div>
    </ModalShell>
  );
}
