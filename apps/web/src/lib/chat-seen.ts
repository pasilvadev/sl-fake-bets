/**
 * Chat "seen" marker — the client half of catch-up state (UX-019, D2, Extra
 * Phase 1, plan task 9). The server half doesn't exist: this file IS the
 * whole feature.
 *
 * **D2 in full, and its accepted cost.** The last-seen marker lives in
 * `localStorage`, not a `last_read_at` column on `team_members` or anywhere
 * else. That means the "NEW" divider this drives is **per-device by design**:
 * right on the laptop that read the channel an hour ago, absent on the phone
 * that never opened it. A read receipt synced across devices was the
 * alternative, and it was rejected on arrival — the whole point of D2 is that
 * *seeing* a message writes nothing to the database. No `last_read_at`
 * column, no read-receipt row, no write of any kind for a read. The database
 * only ever hears about a message being SENT; every other view of "have I
 * seen this" lives here, in the one browser that asked.
 *
 * **ARC-014 boundary — say it here, because this is the file where someone
 * will reach for it.** This module is in-app bookkeeping only: a divider
 * line and an unread count, both rendered by the store that reads this
 * marker. It must never grow into a push notification, an email, a
 * `document.title` unread counter, a sound, or a call into the Notification
 * API. If a future change wants any of those, ARC-014 has to be relitigated
 * with the owner first — this file is not the place a "just a badge, not a
 * notification" exception gets to start.
 *
 * **The marker-advance rule this module does NOT enforce.** Reading this
 * file top to bottom, it looks like `writeChatSeen` could be called the
 * moment a message renders. It must not be, and the discipline lives in the
 * chat store (`team-context.tsx`'s `markChatSeen`), not here: the marker may
 * advance only while the chat surface is both VISIBLE and scrolled to the
 * BOTTOM. Call it on mount, or from a rail that is merely present on screen,
 * and a member who glances at the dashboard silently eats three days of
 * backlog — every message that arrived while they were away gets marked seen
 * before they read a word of it. This module just persists whatever marker
 * it is handed; the "when" is the store's job.
 *
 * **Why per (userId, teamId), not per user.** A reading position is exactly
 * as team-scoped as a balance or a roster membership — a user in five teams
 * has five independent "where was I" positions, one per channel, and a
 * single global marker would either show a false NEW divider in a team that
 * has been read for days or hide one in a team that hasn't.
 *
 * **Failure posture.** Every read and every write below is wrapped in its
 * own try/catch and never lets a throw escape. `localStorage` throws
 * outright in private/incognito contexts in some browsers, can be disabled
 * by policy, and can hold a value some other code (or a future shape change
 * to `ChatSeenMarker`) wrote malformed or partial JSON — none of that may
 * ever surface as an unhandled error in a render path. On any of those
 * outcomes, `readChatSeen` returns `null`, and `null` here means "no marker
 * ever recorded", which the store renders as *no divider at all* — not as
 * "everything is unread". That's the correct read for a first-ever open on a
 * new device, a cleared-storage browser, or a private window, all of which
 * hit this same path and none of which should paint a channel that has
 * plenty of history as one giant wall of NEW.
 */

/** One reading position: the newest message a device has marked seen. */
export interface ChatSeenMarker {
  messageId: string;
  createdAt: string;
}

/**
 * `localStorage` key for one (user, team) reading position. Exported so the
 * store and any test on it can assert against the exact key shape rather
 * than guessing it — the shape itself is fixed: per-user AND per-team, never
 * shared across either axis.
 */
export function chatSeenStorageKey(userId: string, teamId: string): string {
  return `sl:chat-seen:${userId}:${teamId}`;
}

/**
 * Reads the last-seen marker for this (user, team), or `null` when there is
 * none — no entry was ever written, storage was cleared, this is a private
 * window, or the stored value doesn't parse into a `ChatSeenMarker`. Never
 * throws: this runs on every chat surface mount, and a storage failure must
 * degrade to "no divider", not break the page.
 */
export function readChatSeen(userId: string, teamId: string): ChatSeenMarker | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(chatSeenStorageKey(userId, teamId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "messageId" in parsed &&
      "createdAt" in parsed &&
      typeof (parsed as { messageId: unknown }).messageId === "string" &&
      typeof (parsed as { createdAt: unknown }).createdAt === "string"
    ) {
      return { messageId: (parsed as { messageId: string }).messageId, createdAt: (parsed as { createdAt: string }).createdAt };
    }
    // Present but malformed (partial write, a shape from some future/past
    // version of this file) — treated exactly like absent, not like an error.
    return null;
  } catch {
    // Private mode, storage disabled by policy, or a JSON.parse throw on a
    // corrupted value. Same outcome as "never written": no divider.
    return null;
  }
}

/**
 * Persists the last-seen marker for this (user, team). The caller — the chat
 * store, never a component directly — owns *when* this fires; see the
 * marker-advance rule in the header comment. This function itself has no
 * opinion about visibility or scroll position and applies whatever marker it
 * is given.
 *
 * Swallows every failure (quota exceeded, storage disabled, private mode):
 * losing an updated marker means the NEW divider is stale by however many
 * messages arrived since the last successful write, which is a strictly
 * smaller problem than a write throwing out of a click handler.
 */
export function writeChatSeen(userId: string, teamId: string, marker: ChatSeenMarker): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(chatSeenStorageKey(userId, teamId), JSON.stringify(marker));
  } catch {
    // See above — a stale marker on the next open beats a thrown error now.
  }
}
