"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { cn } from "cn";
import { useToast } from "@/lib/toast-context";
import { Toast } from "./toast";

/**
 * "Has this hydrated yet?" — `false` on the server, `true` on the client.
 *
 * `document` does not exist during the server render and this component is
 * mounted inside the root layout's provider tree, so the portal has to wait for
 * the client. The obvious `useState(false)` + `useEffect(() => setState(true))`
 * is a lint error in this repo (`react-hooks/set-state-in-effect`) and is
 * genuinely a cascading render; `useSyncExternalStore` with a never-firing
 * subscribe is React's own idiom for the same question and costs no re-render.
 */
const NEVER_CHANGES = () => () => {};

/**
 * The single toast mount point (Extra Phase 4, tasks 2 + 3 + 5). Mounted once
 * in `app-providers.tsx` beside `<ModalRoot />`, which is the file this one
 * mirrors: read the store, render the live stack, own no state.
 *
 * **This is the app's first hand-written `createPortal`, and it earns the
 * exception twice over.** (The three Radix surfaces — tooltip, profile
 * dropdown, team-switcher popover — already portal to `document.body`, which
 * is precisely why they win at `z-50` without anyone thinking about it. Every
 * *hand-written* fixed-position surface in this app renders in flow and gets
 * its stacking order from mount order.) Two present-tense defects make that
 * accident unacceptable here:
 *
 *  1. `ModalShell`'s backdrop and the old toast strip both hard-code `z-50`,
 *     and `app-providers.tsx` renders `{children}` **before** `<ModalRoot />`
 *     — so on the tie the later DOM node wins and an open modal already paints
 *     over any toast fired outside its own subtree. `z-[60]` below fixes that
 *     order-independently (reordering the two mounts instead would only move
 *     the bug to the next `z-50` surface anyone adds).
 *  2. `ModalShell`'s panel carries `overflow-hidden` **and** `cut-md`, and a
 *     `clip-path` clips descendants unconditionally — `position: fixed` ones
 *     included. A toast rendered anywhere inside a modal's subtree is
 *     invisible no matter what its z-index says. Only leaving the subtree
 *     fixes that, which is what the portal does.
 *
 * `z-[60]` is the tier, recorded once in `globals.css` alongside the three
 * below it. (The bracket form is not load-bearing: Tailwind v4 takes a bare
 * `z-<number>` as a dynamic utility, so `z-60` compiles to the same rule —
 * v3's fixed 0/10/…/50 z-scale is gone. Verified in the built CSS.)
 *
 * **The live region is persistent and split by kind (D10).** Two `sr-only`
 * siblings, both rendered from mount and both usually empty. That fixes two
 * defects in the shipped component: it returned `null` between toasts, so
 * every real toast inserted a live-region node *already populated with text*
 * — the classic dropped-announcement case, and the thing SC 4.1.3 asks for
 * instead; and it applied `polite` to failures, where the repo's own
 * precedent (`auth-page.tsx`'s `Message`) uses `role="alert"`. Two nodes
 * rather than one node whose `role` flips, because a screen reader latches a
 * live region's politeness when the node is inserted — swapping the attribute
 * on a mounted node looks correct in review and drops announcements. The
 * visible cards carry no live-region role at all, so nothing is announced
 * twice.
 *
 * **`--fab-stack-height`** (task 5) is the mobile FAB dodge. Below `sm` the
 * strip is bottom-centred and the Create-Bet FAB occupies the same
 * 16px-from-bottom band, so the layer clears the whole FAB tier plus a gap;
 * at `sm` and up the FAB is gone (`sm:hidden`) and the strip returns to
 * `bottom-4` at the right edge, per §5.9's "bottom-right desktop /
 * bottom-center mobile". The offset is static and therefore also applies on
 * the routes that have no FAB — the FAB mounts on the dashboard only, and
 * plumbing `canCreateBet` into this layer would couple the toast system to
 * team context for a few pixels of bottom margin. One token, one place, no
 * coupling: Extra Phase 3's second FAB bumps the number in `globals.css` and
 * nothing here changes.
 *
 * **Reflow when a card ages out is instant, and that is not an oversight.**
 * The stack grows upward from a bottom anchor, so evicting the oldest — the
 * top card, and the common case since toasts share a duration — moves nothing
 * that remains. Animating the other cases would need FLIP measurement, i.e.
 * exactly the per-card machinery the provider was created to absorb, and §6's
 * reduced-motion rule would then have to gate it. Instant satisfies §6 under
 * both preferences.
 */
export function ToastRoot() {
  const { toasts, dismiss, pause, resume } = useToast();

  const hydrated = useSyncExternalStore(
    NEVER_CHANGES,
    () => true,
    () => false,
  );
  if (!hydrated) return null;

  // Split by politeness. Failure is assertive because it reports something
  // that did not happen and the person may be about to move on; a success or a
  // completed destructive act is polite because the state change is already
  // visible on screen (D7).
  const polite = toasts.filter((t) => t.kind !== "failure");
  const assertive = toasts.filter((t) => t.kind === "failure");

  return createPortal(
    <>
      {/*
        Both regions mount empty and stay mounted for the life of the app.
        `aria-atomic="false"` is load-bearing and not a default: `role="status"`
        and `role="alert"` both carry an implicit `aria-atomic="true"`, which
        makes a screen reader re-read the WHOLE region on every change — so a
        second toast would replay the first, and a third would replay both.
        Each region holds one <p> per live toast, so only additions should be
        announced.
        `document.body` is `flex flex-col` (layout.tsx), so every child here
        must be taken out of flow or it becomes a flex item and stretches the
        shell — the strip below is `fixed`, and these two are `sr-only`, which
        is `position: absolute`.
      */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="false">
        {polite.map((t) => (
          <p key={t.id}>{t.text}</p>
        ))}
      </div>
      <div
        className="sr-only"
        role="alert"
        aria-live="assertive"
        aria-atomic="false"
      >
        {assertive.map((t) => (
          <p key={t.id}>{t.text}</p>
        ))}
      </div>

      <div
        className={cn(
          // Tier 60 — above the z-50 overlay tier. See globals.css.
          "pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4",
          // Mobile: bottom-centre, clear of the FAB tier (task 5).
          "bottom-[calc(var(--fab-stack-height)+0.5rem)]",
          // ≥sm: bottom-right, no FAB to dodge.
          "sm:inset-x-auto sm:right-4 sm:bottom-4 sm:items-end sm:px-0",
        )}
      >
        {/*
          Oldest first, so the newest card sits nearest the screen corner and
          the stack grows away from it. The strip is `pointer-events-none` and
          only the cards opt back in, so an empty toast-shaped band never
          steals a click from the FAB or the chat composer behind it.
        */}
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            toast={toast}
            onDismiss={() => dismiss(toast.id)}
            onPause={() => pause(toast.id)}
            onResume={() => resume(toast.id)}
          />
        ))}
      </div>
    </>,
    document.body,
  );
}
