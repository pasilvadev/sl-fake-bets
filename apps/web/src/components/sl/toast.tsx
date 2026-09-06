"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "cn";

/**
 * The app's first toast (Extra Phase 1, UX-019 plan tasks 4 + 8) — design
 * spec is design-visual-identity.md §5.9 (verbatim below) plus the generic
 * motion table in §6:
 *
 *   "bg-surface-2 border-border, left rail 2px by type: jade (success) / N4
 *   (info/neutral) / ember (destructive-confirmation only) — never
 *   red/green. Icon slot reuses the glyph system: `/` jade for success, `\`
 *   N6 for failure — no check/x icon-library glyphs. Position bottom-right
 *   desktop / bottom-center mobile. Motion: slide+fade, 3.5s auto-dismiss,
 *   transform+opacity only, no blur."
 *
 * **Deliberately not a system.** Grep found zero matches for "toast" in this
 * codebase before this file — every error surface up to Extra Phase 1 was
 * inline `text-negative`/ember copy next to the control that failed. Chat is
 * the first flow that needs a fire-and-forget message that outlives the
 * control that caused it (task 8: the optimistic row is already gone by the
 * time the failure needs reporting), so this is the first toast, not a
 * toast *system*. The two chat surfaces (rail, modal) are the only planned
 * consumers, each already owns its own render tree, and each will call
 * `useToast()` and render its own `<Toast />` independently — no shared
 * queue, no portal, no global store. That is a scope decision, not an
 * oversight: a provider/registry earns its cost the second surface needs
 * toasts to survive *its own* unmount (e.g. a toast that must outlive the
 * modal that spawned it), and nothing in this phase does. Add one then, with
 * a real second consumer in hand — not speculatively here.
 *
 * **ARC-014 boundary.** `role="status"` + `aria-live="polite"` below make a
 * screen reader announce the text — that is an in-app accessibility
 * affordance, the same category as the chat unread badge, and it is the
 * *only* thing this component does when the tab is unfocused: no push, no
 * email, no service worker, no `document.title` counter, no sound, no
 * `Notification` API. A toast that fires while the tab is in the background
 * is simply never seen, same as any other DOM update — that is the accepted
 * shape, not a gap to close later.
 *
 * **Only two kinds exist because only two are real.** §5.9 names three rail
 * colors, but ember is scoped to *destructive-confirmation* (the "type
 * TEAM_NAME to confirm" flows in the delete/leave modals) — a family of
 * dialogs, not a toast, and nothing routes a destructive-confirmation
 * outcome through this component. So `ToastMessage["kind"]` is exactly
 * `"success" | "failure"`, not the three-way rail taxonomy: adding an unused
 * `"destructive"` variant here would be dead code pretending to be a
 * feature. "Failure" takes the middle, neutral rail (§5.9's "N4/info", read
 * as this codebase's `border-strong` token — the one other edge in this
 * system already reserved for "must read as a boundary", see globals.css)
 * rather than ember, because a failed send is routine and recoverable, not
 * a destructive act — and because §5.9 says "never red/green" in the same
 * breath it defines the rail, so an error toast still isn't a red toast.
 *
 * **Entrance only, no exit transition.** §6's Toast row reads as "how it
 * arrives and how long it stays", not a symmetric enter/exit pair, and nothing
 * in the frozen signature below gives `Toast` anywhere to hold a "still
 * playing its exit" state: it is `(toast) => JSX | null`, driven entirely by
 * the caller's `toast` value. Doing a real exit fade would mean `Toast`
 * keeping its own last-seen copy and unmount timer independent of the prop —
 * exactly the kind of internal machinery the smallest-honest-thing brief for
 * this file rules out. So dismissal, timed or manual, is an immediate
 * unmount. `motion-safe:` still guards the one animation that exists (the
 * slide+fade entrance) per §6's reduced-motion rule: under
 * `prefers-reduced-motion: reduce` the toast simply appears, no transform,
 * which already *is* that rule's "instant opacity/state swap" for a toast
 * (there is no separate reduced-motion opacity fade to write — the element
 * has no transition property at all outside `motion-safe:`).
 *
 * **Click-anywhere-to-dismiss, not a close icon.** §5.9's anatomy is rail +
 * icon slot + text + position + motion — it does not name a close control,
 * and inventing one would mean either a third glyph the glyph system doesn't
 * define or a `lucide-react` `X` import, which this file is explicitly told
 * not to reach for. The whole card is instead the dismiss control (a real
 * `<button>`, so it is keyboard-reachable and gets the standard
 * `hover:bg-surface-3` affordance already used for every other clickable row
 * in this app), which is what `onDismiss` in the frozen signature is for —
 * `useToast`'s own timer is what the *auto*-dismiss runs on.
 */

/** One toast's content. No id: `useToast` holds at most one at a time. */
export interface ToastMessage {
  kind: "success" | "failure";
  text: string;
}

/** §5.9/§6: "3.5s auto-dismiss" is the one duration this component owns. */
const TOAST_DURATION_MS = 3500;

/**
 * Owns the single auto-dismiss timer for one toast slot. A component calls
 * `show` to (re)start the clock and `dismiss` to end it early; both are
 * stable across renders so effects that depend on them don't re-fire.
 *
 * Replacing an unread toast restarts the full 3.5s rather than letting the
 * new text inherit however much time was left on the old one — the clock is
 * "since this text appeared," never "since the first toast of a burst
 * appeared," or a fast second error could flash for a few hundred ms.
 */
export function useToast(): {
  toast: ToastMessage | null;
  show: (toast: ToastMessage) => void;
  dismiss: () => void;
} {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPendingTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    clearPendingTimer();
    setToast(null);
  }, [clearPendingTimer]);

  const show = useCallback(
    (next: ToastMessage) => {
      clearPendingTimer();
      setToast(next);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setToast(null);
      }, TOAST_DURATION_MS);
    },
    [clearPendingTimer],
  );

  // Unmounting mid-timer (surface closed, e.g. the chat modal, before the
  // 3.5s elapsed) must not fire a state update on a gone component.
  useEffect(() => clearPendingTimer, [clearPendingTimer]);

  return { toast, show, dismiss };
}

/**
 * Renders nothing while there is no toast — callers mount this
 * unconditionally next to their surface rather than gating it themselves.
 *
 * Fixed position, bottom-right desktop / bottom-center mobile per §5.9. The
 * outer strip spans the relevant edge with no transform of its own so the
 * card's `transform` stays free for the enter animation alone — composing a
 * static centering `translate-x` with the animation's own translateY is what
 * produces the diagonal-drift glitch this two-layer structure avoids. The
 * strip is `pointer-events-none` and only the card opts back in, so an empty
 * toast-shaped strip never steals a click or a scroll from whatever sits
 * behind it (the chat composer, most likely).
 */
export function Toast({
  toast,
  onDismiss,
}: {
  toast: ToastMessage | null;
  onDismiss: () => void;
}) {
  if (!toast) return null;

  const isFailure = toast.kind === "failure";

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4 sm:inset-x-auto sm:right-4 sm:justify-end sm:px-0">
      <div
        role="status"
        aria-live="polite"
        className={cn(
          "pointer-events-auto w-full max-w-sm border border-border bg-surface-2",
          "border-l-2",
          isFailure ? "border-l-border-strong" : "border-l-jade-border",
          // Entrance only (see header comment) — transform + opacity, no
          // blur, wrapped in motion-safe so reduced-motion gets an instant
          // appearance instead. Duration/curve reused from §6's Row/modal
          // enter treatment; the Toast row in that table names the lifespan
          // (3.5s) and the properties (transform+opacity), not a bespoke
          // easing of its own.
          "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2",
          "motion-safe:duration-200 motion-safe:ease-[cubic-bezier(0.16,1,0.3,1)]",
        )}
      >
        <button
          type="button"
          onClick={onDismiss}
          className="flex w-full items-start gap-2.5 py-3 pl-3 pr-4 text-left transition-colors hover:bg-surface-3"
        >
          {/* Glyph system, not an icon library: `/` jade for success, `\`
              N6/muted for failure — §5.9 forbids a check/x import here. */}
          <span
            aria-hidden
            className={cn(
              "mt-0.5 font-mono text-sm leading-none",
              isFailure ? "text-muted-foreground" : "text-jade",
            )}
          >
            {isFailure ? "\\" : "/"}
          </span>
          <span className="flex-1 text-sm text-foreground">{toast.text}</span>
        </button>
      </div>
    </div>
  );
}
