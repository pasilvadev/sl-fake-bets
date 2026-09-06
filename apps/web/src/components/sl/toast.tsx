"use client";

import { cn } from "cn";
import type { ActiveToast, ToastKind } from "@/lib/toast-context";

/**
 * One toast card — **presentation only** (Extra Phase 4, task 4). State, the
 * stack and the dismiss timers all live in `lib/toast-context.tsx`; this file
 * renders what it is handed and reports hover/focus back up.
 *
 * Design spec is `design-visual-identity.md` §5.9, verbatim:
 *
 *   "bg-surface-2 border-border, left rail 2px by type: jade (success) / N4
 *   (info/neutral) / ember (destructive-confirmation only) — never
 *   red/green. Icon slot reuses the glyph system: `/` jade for success, `\`
 *   N6 for failure — no check/x icon-library glyphs. Position bottom-right
 *   desktop / bottom-center mobile. Motion: slide+fade, 3.5s auto-dismiss,
 *   transform+opacity only, no blur."
 *
 * Three departures from that paragraph, all deliberate and all recorded back
 * into §5.9 by this phase's task 13:
 *
 * **1. The neutral rail is `--border-strong`, not N4 (D8).** N4 is `--input`
 * (#3B403D, 1.87:1) — one of the *surface*-elevation steps §2.1 explicitly
 * says not to read as a graded boundary. (§2.1's N4 row does carry the stale
 * role string "Border strong / input outline", which is very likely how §5.9
 * came to say N4 — but `--border-strong` is a separate token declared at N5's
 * value, #656A67, glossed "edges that must read as a boundary (≥3:1)".)
 * Extra Phase 1 shipped `--border-strong` and was right to; the doc moves to
 * the code.
 *
 * **2. The destructive rail is `ember-border` and its glyph is `/` in
 * `ember-icon` (D9).** §5.9 names three rails in one sentence and glyphs for
 * only two in the next — a gap in the doc, not a rule to guess at. The app's
 * glyph vocabulary is exactly two marks (`/` and `\`, §2.3/§5.5) and a
 * destructive action that *succeeded* is a completion, so it takes the
 * completion mark; the ember **rail** is what says the completion was
 * destructive. §2.3 sanctions exactly this — ember "only fills icons, thin
 * borders, and the one final confirm-button background" — and a 2px rail is a
 * thin border while a glyph is an icon. No `lucide-react` import, per §5.9.
 * The step choice (dim `--ember-border` rail + bright `--ember-icon` glyph) is
 * not invented here: it is `auth-page.tsx`'s shipped pairing for its error
 * rail, and it keeps the three rails at comparable weight instead of letting
 * the destructive one shout with `--destructive`, which §2.3 rations to the
 * one final confirm button.
 *
 * **3. Body copy stays N7 on all three rails.** §2.3's hard rule — ember
 * "never colors a state *word*" — and §2.3b's ban on rust for "any *action*".
 * The rail and the glyph carry the colour; the sentence never does. Same shape
 * as `auth-page.tsx`'s `Message`, which is the only other place in the app
 * that implements this grammar in full.
 *
 * **No shadow, no glow.** §4.2 and §6 each reserve the single soft `box-shadow`
 * for the modal overlay, and the Jade Glow Ration's one wired anchor is
 * bet-detail's hero countdown. A toast's elevation comes from `bg-surface-2`
 * plus a border, per §2.1's "elevation reads via brightness, never shadow
 * weight".
 *
 * **Timing, and which WCAG rule is which** — record both, because the wrong
 * one is easy to "fix":
 *  - **SC 2.2.1 Timing Adjustable applies.** A 3.5s auto-dismiss is a time
 *    limit set by the content and matches none of 2.2.1's three exceptions
 *    (real-time / essential / 20-hour). There is no minimum duration below
 *    which it stops applying. Pausing on hover *and* on focus is the standard
 *    mitigation and is what the handlers below do; D7 (a toast is the sole
 *    channel only for an idempotent action whose control is still on screen)
 *    covers the residual "the message is gone forever" risk.
 *  - **SC 2.2.2's moving/blinking bullet does not apply** — its trigger is
 *    content lasting *more than five seconds*, and 3.5s is under that floor.
 *    Do **not** raise the duration to 5s+ "for 2.2.2": that newly engages the
 *    very bullet it would be trying to satisfy. (2.2.2's *auto-updating*
 *    bullet has no five-second floor and arguably does reach a self-reflowing
 *    stack — the same hover/focus pause plus the dismiss control answers it,
 *    which is why one mechanism covers both.)
 *  - **SC 4.1.3 Status Messages** is what the persistent live region in
 *    `toast-layer.tsx` satisfies — see that file.
 *
 * **The card is the dismiss control**, as it was in Extra Phase 1: §5.9's
 * anatomy is rail + icon slot + text + position + motion and names no close
 * affordance, and inventing one would mean a third glyph the system doesn't
 * define or the `lucide-react` import §5.9 forbids. One `<button>` carrying
 * the whole chrome also keeps this out of the nested-interactive-content trap
 * (a focusable card wrapping a focusable close button) and gives task 11's
 * §5.8 focus ring exactly one element to land on. Per D6 there is no *action*
 * affordance and never will be: recovery belongs back at the control that
 * failed.
 */

/** Rail + glyph per kind. The only place the three-way taxonomy is spelled out. */
const KIND_CHROME: Record<
  ToastKind,
  { rail: string; glyph: string; glyphTone: string }
> = {
  // §5.9: jade rail, `/` glyph. Same dim ramp step the shipped card used.
  success: {
    rail: "border-l-jade-border",
    glyph: "/",
    glyphTone: "text-jade",
  },
  // D8: `--border-strong`, not N4. `\` in N6 (`--muted-foreground`) per §5.9 —
  // note N6 is *not* rust: §2.1 aliases `--negative` to N6 while §2.3b
  // re-points it at rust-base, so `text-negative` here would silently ship a
  // rust failure glyph and break §2.3b's ban on rust for any action.
  failure: {
    rail: "border-l-border-strong",
    glyph: "\\",
    glyphTone: "text-muted-foreground",
  },
  // D9: ember rail, completion glyph, ember icon tone.
  destructive: {
    rail: "border-l-ember-border",
    glyph: "/",
    glyphTone: "text-ember",
  },
};

export function Toast({
  toast,
  onDismiss,
  onPause,
  onResume,
}: {
  toast: ActiveToast;
  onDismiss: () => void;
  onPause: () => void;
  onResume: () => void;
}) {
  const chrome = KIND_CHROME[toast.kind];

  return (
    <button
      type="button"
      onClick={onDismiss}
      // Hover *and* focus, because a keyboard user never triggers the first:
      // they Tab onto the card, and a toast that vanished under their hand
      // mid-Tab is the exact 2.2.1 failure this pair exists to prevent.
      onMouseEnter={onPause}
      onMouseLeave={onResume}
      onFocus={onPause}
      onBlur={onResume}
      className={cn(
        "pointer-events-auto flex w-full max-w-sm items-start gap-2.5 border border-border border-l-2 bg-surface-2 py-3 pl-3 pr-4 text-left",
        chrome.rail,
        "transition-colors hover:bg-surface-3",
        // §5.8: "jade, 1–2px, on every interactive element". The shipped card
        // had none. `ring-1`/`jade/40` is the app's own idiom for a
        // hand-written control (profile-menu.tsx, bet-row.tsx,
        // team-settings-modal.tsx) and sits inside §5.8's stated 1–2px, which
        // `ui/button.tsx`'s `ring-3` does not.
        "outline-none focus-visible:ring-1 focus-visible:ring-jade/40",
        // §6: transform + opacity only, no blur, `motion-safe:`-gated so
        // reduced-motion gets the instant state swap §6 asks for rather than a
        // separate reduced-motion animation. Duration/curve are §6's Row/modal
        // enter treatment; §6's Toast row names the lifespan and the
        // properties, not a bespoke easing.
        "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2",
        "motion-safe:duration-200 motion-safe:ease-[cubic-bezier(0.16,1,0.3,1)]",
      )}
    >
      {/* Glyph system, not an icon library — §5.9 forbids a check/x import. */}
      <span
        aria-hidden
        className={cn(
          "mt-0.5 font-mono text-sm leading-none",
          chrome.glyphTone,
        )}
      >
        {chrome.glyph}
      </span>
      <span className="flex-1 text-sm text-foreground">{toast.text}</span>
      {/*
        The message itself is announced by the live region in
        `toast-layer.tsx`; this only tells a keyboard user what activating the
        card does, since §5.9 gives it no visible close affordance to infer it
        from.
      */}
      <span className="sr-only"> (press to dismiss)</span>
    </button>
  );
}
