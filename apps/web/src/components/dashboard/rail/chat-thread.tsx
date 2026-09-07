"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ArrowDown } from "lucide-react";
import { cn } from "cn";
import { useLocale, useTranslations } from "next-intl";
import { CONFIG, validateChatMessage, type ChatMessage, type User } from "@repo/shared";
import { UserAvatar } from "@/components/sl/user-avatar";
import { UserName } from "@/components/sl/user-name";
import { EmptyState } from "@/components/dashboard/empty-state";
import { useTeam, type MutationResult } from "@/lib/team-context";
import { useNow } from "@/lib/use-now";
import { formatRelativePast } from "@/lib/format";

/**
 * Team chat's SHARED presentation (roadmap §8 Extra Phase 1, tasks 10 + 11).
 * Every export below is consumed by BOTH `chat-module.tsx` (the rail) and
 * `chat-modal.tsx` (the full-scrollback modal) — the plan is explicit that
 * these two files are written in one sitting *because* building the second
 * surface is what proves the first did not quietly fork a private copy of
 * this row/composer/skeleton markup. If a change here only looks right in
 * one of the two surfaces, it is wrong, not "not yet applied to the other
 * one" — there is exactly one copy of this code to get right.
 *
 * Design refs, all binding: design-visual-identity.md §5.7 (chat row
 * anatomy), §5.8 (forms, for the composer's field chrome), §5.9 (n/a here —
 * the two surfaces raise the failure sentence through `lib/toast-context.tsx`
 * and the app's single portalled `ToastRoot` paints it; no file in this
 * feature renders a toast), §5.10 (empty + skeleton), §6 (motion, every
 * animation below `motion-safe:`-guarded).
 *
 * **ARC-014 boundary.** Nothing in this file produces a push, an email, a
 * `document.title` count, a sound, or a call into the `Notification` API.
 * The `NEW` divider and `ChatNewPill` below are IN-APP markers only — the
 * same category as an unread badge on a browser tab you're already looking
 * at, never a notification a member could receive without the tab open.
 *
 * **DOM-030 boundary — read this before adding anything to `ChatRows`.**
 * There is no per-row control here of any kind: no flag, no hide, no delete,
 * no report. `20260906120000_team_chat.sql` DOES grant a member DELETE on
 * their OWN row (`chat_messages_delete_own`) — that policy exists so a
 * future "unsend" feature has somewhere to land, but Extra Phase 1 ships no
 * UI for it. A future session reading only this file should not mistake the
 * policy's existence for a missing feature here: it is an unused capability,
 * not an oversight, and it grants nothing over anyone else's message — DOM-
 * 030 forbids that categorically, for every member including a moderator.
 */

// A "small threshold" (task 10's phrasing) for "close enough to the sill to
// count as AT the bottom" — big enough that the sub-pixel scroll-rounding
// noise real browsers produce doesn't flicker `atBottom` on every render,
// small enough that a reader who has genuinely scrolled up into scrollback
// never reads as "at the bottom." Roughly one dense row (§4.5).
const STICK_TO_BOTTOM_THRESHOLD_PX = 40;

/** Show the composer's character counter only once a body is within this
 * many characters of `CONFIG.CHAT_MESSAGE_MAX_CHARS` (task 10: "only as it
 * approaches" the cap) — a counter present on every keystroke from an empty
 * field is noise; its only job is warning someone about to trip
 * `validateChatMessage`'s own `chat-too-long` issue. */
const NEAR_LIMIT_SLACK = 40;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    // A hostile/old `matchMedia` throwing is not a reason to crash a scroll
    // helper — fall back to "motion is fine," the more common case.
    return false;
  }
}

// `useLayoutEffect` warns on the server ("does nothing during SSR"). Every
// caller of this file's hook is a "use client" dashboard surface mounted
// behind sign-in, but Next still renders a first pass on the server, so this
// is the standard escape hatch rather than a bespoke one: synchronous
// measurement on the client, a no-op (silently, no warning) on the server.
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

// -----------------------------------------------------------------------------
// ChatRows
// -----------------------------------------------------------------------------

/**
 * The message list itself — §5.7's anatomy, exactly: dense rows (`flex
 * gap-2 py-1.5`), NO bubble, NO hover card, NO message background; whitespace
 * alone carries separation. 24px avatar, `UserName` in the sender's own
 * name-color with its inline rank badge, body at N7 (`text-foreground`,
 * §2.1's rule that default body text is N7 not N8), trailing mono N6
 * timestamp — the same four-cell shape `bet-detail-page.tsx`'s
 * `CommentsSection` already uses for UX-018, reused here rather than
 * re-invented for UX-019.
 *
 * Resolves `message.userId` -> `User` via `useTeam().userById` rather than
 * taking a lookup as a prop — the frozen signature is exactly `{ messages,
 * firstUnreadId }`, and `standings-module.tsx`'s `StandingRow` already
 * reaches into the same context for the identical reason: this component
 * only ever renders inside `TeamProvider`, so there is nowhere else for that
 * lookup to sensibly come from.
 *
 * The `NEW` divider (D2, task 9's client half) renders once, immediately
 * above the first message whose id is `firstUnreadId` — a plain hairline +
 * small uppercase label in jade, never red, never a badge-count on the
 * divider itself (task 10 is explicit: the COUNT lives on the rail header /
 * mobile chip, not here).
 *
 * Arrival animation is opacity/transform only (§6), `motion-safe:`-guarded,
 * and costs nothing for scrollback: React only plays an "enter" transition
 * for an element that WASN'T there on the previous render, so a row keyed by
 * `message.id` that was already on screen never replays it — only a message
 * that is genuinely new to this render (a fresh send, a realtime insert, or
 * — see `useStickToBottom` below — the newest page of a scroll-restored
 * PREPEND) animates in.
 */
export function ChatRows({
  messages,
  firstUnreadId,
}: {
  /** ASCENDING (oldest first) — the order `TeamState.chat.messages` holds. */
  messages: ChatMessage[];
  firstUnreadId: string | null;
}) {
  const { userById } = useTeam();
  const now = useNow();

  return (
    <>
      {messages.map((message) => (
        <Fragment key={message.id}>
          {message.id === firstUnreadId && <NewDivider />}
          <ChatRow message={message} user={userById(message.userId)} now={now} />
        </Fragment>
      ))}
    </>
  );
}

function NewDivider() {
  const t = useTranslations("chatThread");

  // A hairline, not a pill or a count (task 10) — the badge-shaped "N new"
  // affordance is `ChatNewPill` below, and it answers a DIFFERENT question
  // (how many arrived since I scrolled away just now) from this divider's
  // (where did I leave off last time I was here, per D2's FROZEN marker).
  //
  // N6 (`muted-foreground`), NOT jade, per §5.7's unread-divider bullet. Jade
  // carries one meaning in this system — live/open — and "where I left off" is
  // a structural marker, not a live state; spending jade on it would make every
  // reload look like something was happening. §5.2's no-colored-chip rule is
  // cited in the spec for the same reason. The one place jade IS correct here
  // is `ChatNewPill`, which really does report live arrivals.
  return (
    <div
      role="separator"
      aria-label={t("newMessages")}
      className="my-1.5 flex items-center gap-2"
    >
      <span className="h-px flex-1 bg-muted-foreground/40" />
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {t("newDivider")}
      </span>
      <span className="h-px flex-1 bg-muted-foreground/40" />
    </div>
  );
}

function ChatRow({
  message,
  user,
  now,
}: {
  message: ChatMessage;
  user: User | undefined;
  now: number | null;
}) {
  const locale = useLocale();

  // Same defensive shape as every other identity-cluster row in this app
  // (e.g. `StandingRow`): a `userId` this device's roster snapshot can't
  // resolve renders nothing rather than a broken half-row. DOM-030 note: this
  // is a lookup miss, never a moderation hide — the row is gone from the
  // screen only because there is no profile to draw, not because anyone
  // acted on the message.
  if (!user) return null;

  return (
    <div
      className={cn(
        "flex items-start gap-2 py-1.5",
        "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1",
        "motion-safe:duration-200 motion-safe:ease-[cubic-bezier(0.16,1,0.3,1)]",
      )}
    >
      <UserAvatar user={user} size={24} />
      <UserName user={user} badge className="shrink-0 text-sm" />
      <span className="min-w-0 flex-1 break-words text-sm text-foreground">
        {message.body}
      </span>
      <span className="w-14 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
        {now == null ? "—" : formatRelativePast(locale, message.createdAt, now)}
      </span>
    </div>
  );
}

// -----------------------------------------------------------------------------
// ChatComposer
// -----------------------------------------------------------------------------

/**
 * The send row — §5.7: fixed to the panel bottom, `bg-surface-1 border-t`,
 * plain `rounded-none` field, jade focus ring (§5.4/§5.8's one focus color).
 * The send control is the diagonal slash **itself**, `/`, styled as the
 * hover-jade send arrow — not a `lucide-react` icon — matching
 * `CommentsSection`'s button exactly (same size, same disabled/hover
 * treatment), because §5.7 names this glyph once for chat/comments together
 * and a second visual language for the same affordance would be the kind of
 * drift that section is written to prevent.
 *
 * Owns its own `body` state — the caller (`ChatModule`/`ChatModal`) owns
 * `pending` (a send in flight) and hands back a `MutationResult` from
 * `onSend`, because the toast-on-failure behavior (task 10/11) needs that
 * result too, one level up, at the same time this component needs it to
 * decide whether to clear the field. Task 10's rule verbatim: "the input
 * keeps its text until the write is accepted" — so a failed send leaves
 * `body` exactly as typed; only `result.ok` clears it.
 */
export function ChatComposer({
  onSend,
  pending,
  disabled,
  placeholder,
}: {
  onSend: (body: string) => Promise<MutationResult>;
  pending: boolean;
  disabled: boolean;
  placeholder?: string;
}) {
  const t = useTranslations("chatThread");
  const [body, setBody] = useState("");

  const overLimit = body.length > CONFIG.CHAT_MESSAGE_MAX_CHARS;
  const nearLimit = body.length >= CONFIG.CHAT_MESSAGE_MAX_CHARS - NEAR_LIMIT_SLACK;
  const canSubmit = !disabled && !pending && validateChatMessage(body).length === 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    const result = await onSend(body);
    // Only a SUCCESSFUL write clears the field — see header comment. On
    // failure `body` is left exactly as typed; the sentence itself is the
    // caller's toast, not this component's job.
    if (result.ok) setBody("");
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="flex flex-col gap-1 border-t border-border bg-surface-1 p-2"
    >
      <div className="flex items-center gap-2">
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={disabled || pending}
          placeholder={placeholder ?? t("placeholder")}
          className="h-8 min-w-0 flex-1 rounded-none border border-border bg-surface-2 px-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-jade focus:outline-none focus:ring-1 focus:ring-jade/40 disabled:opacity-40"
        />
        {/* Send affordance is the brand slash itself (§5.7) — see header. */}
        <button
          type="submit"
          disabled={!canSubmit}
          aria-label={t("send")}
          className="flex size-8 shrink-0 items-center justify-center font-mono text-muted-foreground transition-colors hover:text-jade disabled:opacity-40 disabled:pointer-events-none"
        >
          /
        </button>
      </div>
      {nearLimit && (
        <p
          className={cn(
            "text-right font-mono text-[11px] tabular-nums",
            overLimit ? "text-negative" : "text-muted-foreground",
          )}
        >
          {body.length}/{CONFIG.CHAT_MESSAGE_MAX_CHARS}
        </p>
      )}
    </form>
  );
}

// -----------------------------------------------------------------------------
// ChatSkeleton / ChatEmpty / ChatEndOfHistory
// -----------------------------------------------------------------------------

/**
 * §5.10's row-shaped skeleton, chat's variant: avatar BLOCK + two text bars —
 * a plain square placeholder, not a `rounded-full` circle, even though the
 * real avatar it stands in for IS circular. That is the letter of §5.10's own
 * rule ("no rounded-full placeholder blobs") applied literally rather than
 * "wherever real content happens to be rectangular": a skeleton's job is a
 * cheap, generic silhouette, not a pixel-accurate stand-in, and `bet-row.tsx`'s
 * `BetRowSkeleton` makes the identical call for its own square icon tile.
 * Opacity-breathe via Tailwind's stock `animate-pulse` (`motion-safe`-guarded)
 * — the same utility `BetRowSkeleton` already uses for this app's one
 * skeleton treatment, not a bespoke keyframe.
 */
export function ChatSkeleton({ rows }: { rows: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex gap-2 py-1.5">
          <div className="size-6 shrink-0 bg-surface-3 motion-safe:animate-pulse" />
          <div className="flex-1 space-y-1.5 py-0.5">
            <div className="h-2.5 w-24 bg-surface-3 motion-safe:animate-pulse" />
            <div className="h-2.5 w-3/5 max-w-56 bg-surface-3 motion-safe:animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * §5.10's shared ghost pattern, reused verbatim via `EmptyState` — one dry
 * line, no CTA (there is nothing to create; the composer right below it
 * already IS the call to action). Shared, not bespoke, per §5.10's own text:
 * "dashboard, poor podium, transaction history, chat, and participant list."
 */
export function ChatEmpty() {
  const t = useTranslations("emptyState");
  return <EmptyState line={t("noMessages")} />;
}

/**
 * The 30-day retention edge (D1), rendered explicitly once `!chat.hasMore` —
 * "not an empty spinner," per the phase's own exit criterion. Copy names
 * `CONFIG.CHAT_RETENTION_DAYS` rather than a hardcoded "30" so the one
 * authoritative number (flagged to move together with its SQL twin,
 * `app.chat_retention_interval()`) is the only place this sentence can drift
 * from what the database actually enforces.
 */
export function ChatEndOfHistory() {
  const t = useTranslations("chatThread");

  return (
    <div className="flex items-center gap-2 py-3">
      <span className="h-px flex-1 bg-border" />
      <p className="shrink-0 px-1 text-center text-[11px] text-muted-foreground">
        {t("endOfHistory", { days: CONFIG.CHAT_RETENTION_DAYS })}
      </p>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

// -----------------------------------------------------------------------------
// ChatNewPill
// -----------------------------------------------------------------------------

/**
 * "N new ↓" — the floating pill `useStickToBottom` earns its keep for: a
 * member reading scrollback who is NOT at the bottom gets this instead of
 * being yanked down (task 10's named risk). `count` and the click handler
 * are both the caller's to compute/wire (this file's `useStickToBottom`
 * exposes only `atBottom`, not a running "how many arrived while scrolled
 * up" count — that bookkeeping is a couple of refs in the module/modal, not
 * a second responsibility for this hook).
 *
 * No shadow (§4.2: exactly one `box-shadow` exists in this whole app, and it
 * belongs to the modal overlay) — border + jade-wash fill only. Positioned
 * absolutely by this component itself (`inset-x-0 bottom-2`), so both
 * callers get identical placement without each re-deriving it; the
 * containing scroll region just needs to be `relative`.
 */
export function ChatNewPill({
  count,
  onClick,
}: {
  count: number;
  onClick: () => void;
}) {
  const t = useTranslations("chatThread");

  if (count <= 0) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150">
      <button
        type="button"
        onClick={onClick}
        className="pointer-events-auto flex items-center gap-1.5 border border-jade-border bg-jade-wash px-3 py-1 text-xs font-semibold text-jade transition motion-safe:hover:brightness-110 motion-safe:active:brightness-95"
      >
        {t("newCount", { count })}
        <ArrowDown className="size-3" aria-hidden />
      </button>
    </div>
  );
}

// -----------------------------------------------------------------------------
// useStickToBottom
// -----------------------------------------------------------------------------

/**
 * Owns the one behavior the plan names as this phase's time sink (risk 2):
 * a chat surface must stick to the bottom on a new message ONLY if it was
 * already there, and must NEVER move a single visible row when an OLDER page
 * is prepended, regardless of scroll position.
 *
 * `deps` is the surface's current `chat.messages` (ASCENDING) — not an
 * opaque `useEffect`-style array. Two signals are pulled out of it,
 * `messages.length` and `messages[0]?.id`, because those two together are
 * exactly what distinguishes the two ways this array changes shape:
 *
 *   - APPEND  (a send, or a realtime `chat-insert`): length grows, the
 *     OLDEST id is unchanged — the array only grew at its tail.
 *   - PREPEND (`loadEarlierChat` resolved): length grows AND the oldest id
 *     changed — an older page landed in FRONT of everything already held.
 *
 * scrollHeight alone can't tell these apart (both grow it), which is why
 * this hook does not just diff `scrollRef.current.scrollHeight` on every
 * commit and call it a day — see the two branches below.
 *
 * **The "measure before the commit" rule.** `atBottomRef` is kept current by
 * a live `scroll` listener, not re-measured inside the commit-time effect.
 * That matters: by the time ANY effect (layout or passive) runs, React has
 * already mutated the DOM for this render, so re-measuring there would see
 * the NEW (already-taller) content and could misjudge "was I at the bottom
 * a moment ago." A `scroll` event, in contrast, only ever fires from an
 * actual user or programmatic scroll — never merely because rows were
 * added — so the ref it maintains is guaranteed to hold the true "as of
 * just before this commit" answer.
 *
 * **The prepend anchor.** Inserting nodes above an existing `scrollTop`
 * leaves that numeric value untouched, which is the teleport bug itself:
 * every row the reader had in view gets pushed down by the new page's
 * height, so their eye lands on whatever now sits at the OLD `scrollTop`
 * instead of what they were reading. Adding `scrollHeight`'s growth back to
 * `scrollTop` restores the same rows to the same visual position. (A
 * genuinely simultaneous prepend-and-append landing in one commit — a
 * realtime message arriving mid-page-load — is the one case this
 * approximation doesn't perfectly anchor; accepted rather than solved with a
 * per-row DOM anchor, which the plan's own sizing guidance does not budget
 * for.)
 *
 * **Why `scrollRef` is a callback ref, not a plain `useRef` object.** Both
 * callers mount their scrollable container conditionally — `chat.status`
 * starts `"idle"`/`"loading"` (`ChatSkeleton` renders instead) and the div
 * this hook needs only appears once a page has actually loaded. A plain
 * `useRef` gives no signal of THAT moment: an effect keyed on a stable
 * callback runs once, at this hook's own mount, finds the ref still `null`,
 * and never gets a reason to run again — the scroll listener would simply
 * never attach. A callback ref fires on every mount/unmount of the node
 * it's given; this one stores the node itself in a plain `useRef` (DOM
 * nodes are exactly what refs are for — mutating `.scrollTop` on one is not
 * a React-state mutation) and bumps a small `mountTick` COUNTER in state
 * purely as a signal for "the node identity may have changed," so every
 * effect below can depend on that counter the normal way instead of
 * depending on the mutable node itself.
 */
export function useStickToBottom(deps: readonly ChatMessage[]): {
  scrollRef: (node: HTMLDivElement | null) => void;
  atBottom: boolean;
  /** Explicit, user-intent scroll (the `ChatNewPill` click) — smooth unless
   * `prefers-reduced-motion` says otherwise. Distinct from the hook's own
   * internal auto-stick, which jumps instantly so a burst of arrivals never
   * queues up a stack of competing smooth-scrolls (§6: motion should be
   * cheap on weak devices, not just pretty on fast ones). */
  scrollToBottom: (behavior?: ScrollBehavior) => void;
} {
  const domRef = useRef<HTMLDivElement | null>(null);
  const [mountTick, setMountTick] = useState(0);
  const scrollRef = useCallback((node: HTMLDivElement | null) => {
    domRef.current = node;
    setMountTick((t) => t + 1);
  }, []);

  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);

  const count = deps.length;
  const oldestId = deps[0]?.id;
  const prevCountRef = useRef(count);
  const prevOldestIdRef = useRef(oldestId);
  const prevScrollHeightRef = useRef(0);

  const measureAtBottom = useCallback(() => {
    const el = domRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_TO_BOTTOM_THRESHOLD_PX;
  }, []);

  const scrollToBottom = useCallback((behavior?: ScrollBehavior) => {
    const el = domRef.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: behavior ?? (prefersReducedMotion() ? "auto" : "smooth"),
    });
  }, []);

  // Live-tracks `atBottom` from real scroll events — see header comment for
  // why this, and not a re-measure inside the commit-time effect below, is
  // the value that effect reads. Keyed on `mountTick` so a node that mounts
  // AFTER this hook's first render (the normal case — see the callback-ref
  // note above) still gets its listener attached.
  useEffect(() => {
    const el = domRef.current;
    if (!el) return;
    function onScroll() {
      const next = measureAtBottom();
      atBottomRef.current = next;
      setAtBottom(next);
    }
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
    // `mountTick` is a deliberate re-run signal (see the callback-ref note
    // above), not a value this effect reads.
  }, [mountTick, measureAtBottom]);

  // The stick/anchor decision itself — synchronous and pre-paint
  // (`useIsomorphicLayoutEffect`) so a prepend's compensating `scrollTop`
  // write lands before the browser ever paints the un-anchored frame. Also
  // keyed on `mountTick`: the node's FIRST appearance (the initial page
  // finishing its load) must run this exactly like any later append does.
  useIsomorphicLayoutEffect(() => {
    const el = domRef.current;
    const prevCount = prevCountRef.current;
    const prevOldestId = prevOldestIdRef.current;

    // `grew` guards against misreading a SHRINK (a team switch's `"reset"`
    // drops `chat.messages` back to `[]`) as a prepend — a prepend is by
    // definition growth from the front, never a drop to nothing.
    const grew = count > prevCount;
    const isPrepend = grew && oldestId !== prevOldestId && prevOldestId !== undefined;

    if (el && count !== prevCount) {
      if (isPrepend) {
        el.scrollTop += el.scrollHeight - prevScrollHeightRef.current;
      } else if (atBottomRef.current) {
        // Append while already at the sill: follow it down, instantly (see
        // `scrollToBottom`'s own comment for why not smooth here). Append
        // while scrolled up needs no action at all — the browser already
        // leaves `scrollTop` untouched when content lands below the fold,
        // which IS "don't yank a reader mid-scrollback."
        el.scrollTop = el.scrollHeight;
      }
    }

    prevCountRef.current = count;
    prevOldestIdRef.current = oldestId;
    prevScrollHeightRef.current = el?.scrollHeight ?? 0;

    // A programmatic scroll write above may not have a native `scroll`
    // event delivered to the listener above before the next render reads
    // `atBottomRef` — re-measure explicitly rather than wait for it.
    if (el) {
      const next = measureAtBottom();
      atBottomRef.current = next;
      setAtBottom(next);
    }
    // Keyed on `mountTick` and the two primitive signals — not on `deps`
    // itself, so a new array reference from the caller's own re-render
    // can't re-run this when neither the node nor either signal changed.
    // `measureAtBottom` is stable (empty-dep `useCallback` above), so it's
    // intentionally left out rather than listed for its own sake.
  }, [mountTick, count, oldestId]);

  return { scrollRef, atBottom, scrollToBottom };
}
