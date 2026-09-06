"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * The app's toast store (Extra Phase 4, tasks 1 + D1/D4/D6).
 *
 * Modelled line-for-line on `lib/modal-context.tsx`: one provider mounted once
 * in `app-providers.tsx`, one throwing hook, one memoized value. The two
 * differences from that file are both forced by what a toast is:
 *
 *  - **State is an ordered array, not a single slot.** Nine call sites can
 *    each raise a message; a replace-in-place model silently eats one the
 *    person needed. Capped at `TOAST_MAX_VISIBLE` (D6) — a taller stack is the
 *    feed shape ARC-014 forbids, and the cap is what keeps it structurally
 *    awkward to grow this into a notification list.
 *  - **The provider owns the timers.** One `setTimeout` per toast, so three
 *    toasts age out independently, and — crucially — the clock outlives the
 *    component that started it. Extra Phase 1's local `useToast` could not:
 *    a kick, a delete or a leave is fired by a modal that closes in the same
 *    tick, and a component-local timer dies before it can render (D1b).
 *
 * **ARC-014 boundary — D5, as a rule and not an intention.** A toast may only
 * be raised **synchronously, in the handler of an action the person themselves
 * took**. Forbidden by name so no future session has to re-reason it: a `show`
 * called from a realtime event handler, from `onResubscribe`, from a polling
 * result, from a `setInterval`, or from any background write; any persistence
 * of a toast across a reload; any list, log, drawer or history of past toasts;
 * any count, dot or badge derived from them; a live reader on the deliberately
 * inert notifications bell (`design-dashboard.md` §1.1) or on the ARC-015 pip
 * slot in `team-switcher.tsx`. This store deliberately has no `toasts` history,
 * no persistence, and no subscribe API — the only way to read it is to render
 * the live stack.
 */

/**
 * §5.9's three rails. `destructive` is the third one the doc has named since
 * before Phase 1 and that nothing consumed until this phase (D3): a completed
 * kick, ban, coin injection, team delete, bet delete or leave. It is not a
 * failure — the act worked — and it is not a jade success either, because a
 * ban reading as a cheerful success is semantically wrong.
 */
export type ToastKind = "success" | "failure" | "destructive";

/** What a caller passes to `show`. */
export interface ToastRequest {
  kind: ToastKind;
  /**
   * §7's "Error toast" row is the copy spec for every kind here: a plain
   * statement of what happened, past tense, no exclamation points, no "Oops!".
   * §7's deadpan humor budget is spent on empty states and the poor podium,
   * not on transactional acknowledgements.
   */
  text: string;
  /**
   * Dedupe handle (D6). A `show` whose key matches a live toast replaces that
   * toast's text and restarts its timer **in place** rather than stacking a
   * second card. The realistic burst is not three different failures but the
   * same failure N times — Extra Phase 1's flood trigger rejects a run of
   * sends, and ten rapid clicks on a copy icon fire ten writes. Omit the key
   * only when repeats genuinely deserve their own row.
   */
  key?: string;
  /**
   * Per-caller dismiss override (D4). Defaults to exactly
   * `TOAST_DEFAULT_DURATION_MS`, so §5.9's 3.5s stays the number rather than
   * quietly becoming a floor. The call site is the only thing that knows
   * whether its sentence is four words or twenty.
   */
  durationMs?: number;
}

/** One live toast. `id` is internal; callers never see or need it. */
export interface ActiveToast {
  id: string;
  kind: ToastKind;
  text: string;
  key: string;
  durationMs: number;
}

export interface ToastState {
  /** Oldest first — `toast-layer.tsx` renders them top-to-bottom on that order. */
  toasts: ActiveToast[];
  show: (toast: ToastRequest) => void;
  dismiss: (id: string) => void;
  /** Hover/focus pause (WCAG 2.2.1) — see `toast.tsx`. */
  pause: (id: string) => void;
  resume: (id: string) => void;
}

/**
 * §5.9/§6: "3.5s auto-dismiss". Exported so the one number lives here and the
 * doc's value is the default a caller inherits by saying nothing (D4).
 */
export const TOAST_DEFAULT_DURATION_MS = 3500;

/**
 * D6's cap. Three is not a tuning knob: it is the number at which a stack
 * still reads as "the app answering you" rather than as a feed. Raising it —
 * or adding a "show more" — is the first step of the notification system
 * ARC-014 has held out through nine phases.
 */
export const TOAST_MAX_VISIBLE = 3;

const ToastContext = createContext<ToastState | null>(null);

/**
 * One toast's auto-dismiss clock.
 *
 * `holds` is a reference count, not a boolean, because a card can be paused by
 * two independent sources at once — the pointer resting on it and keyboard
 * focus sitting in it. With a single flag, whichever released first (a
 * `mouseleave` while the card still held focus, or a `blur` while the pointer
 * still rested on it) restarted the clock for both, and the toast could vanish
 * out from under the element that had focus — the exact WCAG 2.2.1 failure the
 * pause exists to prevent.
 */
interface ToastTimer {
  timeoutId: ReturnType<typeof setTimeout> | null;
  /** Wall-clock deadline; only meaningful while `timeoutId` is running. */
  endsAt: number;
  /** Time left on the clock. Authoritative while paused. */
  remainingMs: number;
  /** How many of {hover, focus} are currently holding this toast open. */
  holds: number;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ActiveToast[]>([]);

  /**
   * The stack, mirrored in a ref, and the reason every mutation below goes
   * through `commit` rather than through a `setToasts(prev => ...)` updater.
   *
   * A toast mutation is inseparably a state change *and* a timer side effect,
   * and a React state updater must be pure: React invokes it twice under
   * StrictMode and may discard and re-run it when a concurrent render is
   * thrown away. Scheduling a `setTimeout` or bumping an id counter inside one
   * therefore leaks timers and burns ids in development. Keeping the array in
   * a ref lets `show` read the current stack, do its timer work, and commit —
   * all synchronously, all exactly once. Two `show` calls in the same tick
   * still compose correctly because the ref updates synchronously while React
   * batches the renders.
   */
  const toastsRef = useRef<ActiveToast[]>([]);
  const timersRef = useRef<Map<string, ToastTimer>>(new Map());
  // Monotonic, not random: two toasts raised in the same millisecond still get
  // distinct React keys, and nothing here needs unpredictability.
  const nextIdRef = useRef(0);

  const commit = useCallback((next: ActiveToast[]) => {
    toastsRef.current = next;
    setToasts(next);
  }, []);

  const clearTimer = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer?.timeoutId != null) clearTimeout(timer.timeoutId);
    timersRef.current.delete(id);
  }, []);

  const remove = useCallback(
    (id: string) => {
      clearTimer(id);
      commit(toastsRef.current.filter((t) => t.id !== id));
    },
    [clearTimer, commit],
  );

  /**
   * (Re)start a toast's clock at `ms`, preserving any hover/focus hold: a
   * deduped repeat of a message the person is currently reading must reset the
   * duration without quietly cancelling their pause.
   */
  const startTimer = useCallback((id: string, ms: number) => {
    const existing = timersRef.current.get(id);
    if (existing?.timeoutId != null) clearTimeout(existing.timeoutId);
    const holds = existing?.holds ?? 0;
    timersRef.current.set(id, {
      timeoutId:
        holds > 0
          ? null
          : setTimeout(() => {
              timersRef.current.delete(id);
              commit(toastsRef.current.filter((t) => t.id !== id));
            }, ms),
      endsAt: Date.now() + ms,
      remainingMs: ms,
      holds,
    });
  }, [commit]);

  const dismiss = useCallback((id: string) => remove(id), [remove]);

  const show = useCallback(
    (request: ToastRequest) => {
      const durationMs = request.durationMs ?? TOAST_DEFAULT_DURATION_MS;
      const current = toastsRef.current;

      // D6 dedupe: a repeat of a live key replaces its text and restarts its
      // clock in place, keeping its position in the stack. Ten rapid copies or
      // a flood-rejected burst of five sends produce one card, not ten.
      const dedupeKey = request.key;
      const live = dedupeKey == null ? undefined : current.find((t) => t.key === dedupeKey);
      if (live) {
        startTimer(live.id, durationMs);
        commit(
          current.map((t) =>
            t.id === live.id
              ? { ...t, kind: request.kind, text: request.text, durationMs }
              : t,
          ),
        );
        return;
      }

      const id = `toast-${nextIdRef.current++}`;
      const next: ActiveToast = {
        id,
        kind: request.kind,
        text: request.text,
        // An unkeyed toast gets a key nothing can collide with, so it always
        // stacks rather than silently replacing an unrelated message.
        key: dedupeKey ?? id,
        durationMs,
      };
      startTimer(id, durationMs);

      // Cap by evicting the oldest, never by refusing the newest: the most
      // recent thing the person did is the one they are looking for.
      const kept = [...current, next];
      while (kept.length > TOAST_MAX_VISIBLE) {
        const evicted = kept.shift();
        if (evicted) clearTimer(evicted.id);
      }
      commit(kept);
    },
    [clearTimer, commit, startTimer],
  );

  /**
   * WCAG 2.2.1 (see `toast.tsx`): hovering or focusing a toast stops its clock.
   * The card cannot do this itself — the `setTimeout` lives here — so it calls
   * back up. A card-local "paused" flag would look right and change nothing.
   */
  const pause = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (!timer) return;
    const running = timer.timeoutId != null;
    if (running) clearTimeout(timer.timeoutId!);
    timersRef.current.set(id, {
      timeoutId: null,
      endsAt: timer.endsAt,
      // Freeze what is left only on the transition from running to paused; a
      // second hold must not overwrite an already-frozen remainder with a
      // deadline that stopped advancing.
      remainingMs: running
        ? Math.max(0, timer.endsAt - Date.now())
        : timer.remainingMs,
      holds: timer.holds + 1,
    });
  }, []);

  const resume = useCallback(
    (id: string) => {
      const timer = timersRef.current.get(id);
      // Gone already (aged out, evicted, or dismissed under the pointer).
      if (!timer) return;
      // `max(0, …)`: a card that appears under a stationary pointer can emit a
      // `mouseleave` it never had an enter for.
      const holds = Math.max(0, timer.holds - 1);
      if (holds > 0 || timer.timeoutId != null) {
        timersRef.current.set(id, { ...timer, holds });
        return;
      }
      timersRef.current.set(id, { ...timer, holds });
      startTimer(id, timer.remainingMs);
    },
    [startTimer],
  );

  // Unmounting the provider (a full client navigation away, or a test's
  // cleanup) must not leave a timer that fires a state update into a gone tree.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => {
        if (timer.timeoutId != null) clearTimeout(timer.timeoutId);
      });
      timers.clear();
    };
  }, []);

  const value = useMemo<ToastState>(
    () => ({ toasts, show, dismiss, pause, resume }),
    [toasts, show, dismiss, pause, resume],
  );

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast(): ToastState {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}
