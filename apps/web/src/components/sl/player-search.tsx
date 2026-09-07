"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Shield } from "lucide-react";
import { cn } from "cn";
import type { TeamMember, User } from "@repo/shared";
import { useTeam } from "@/lib/team-context";
import { UserAvatar } from "./user-avatar";

/**
 * Roster typeahead (Extra Phase 3, task 1) — the app's first combobox, and a
 * new row in `design-visual-identity.md` §5.8.
 *
 * **It queries nothing.** The roster is already in `team.members` and
 * `userById`, so this is a client-side substring filter with zero egress and
 * no new vendor (`design-stack.md` §4 rule 5 — the trap this component exists
 * to avoid is `npm i` on downshift/cmdk/react-select to save an afternoon).
 * Banned-list #13 reserves dropdowns for "genuinely long/rare lists"; a
 * ~30-person roster (`CONFIG.TEAM_TARGET_SIZE`) picked once per challenge is
 * precisely that carve-out, and a segmented control — #13's replacement for
 * short frequent choices — would be 30 tabs.
 *
 * Four things it invents, because the codebase had none of them (verified by
 * grep across `apps/web/src` before it was written: zero `onKeyDown` props,
 * zero `useId`, zero hand-written `role="combobox"`/`listbox`/`option`, zero
 * `.focus()` calls). Each is annotated at its site below:
 *
 *  1. Roving VIRTUAL focus — DOM focus never leaves the input;
 *     `aria-activedescendant` names the highlighted `<li>`.
 *  2. Generated per-option ids, hence `useId()`. The app's only two
 *     `htmlFor`/`id` pairs use hardcoded literals, which cannot work here.
 *  3. Focus return on select — the chip's remove button takes focus so a
 *     keyboard run does not dead-end on an element that just unmounted.
 *  4. An IN-FLOW list rather than an absolutely-positioned popup. See the
 *     block comment on the list itself; this is the decision most likely to
 *     be "fixed" by someone who has not hit the clipping.
 *
 * Used for both the opponent and the mediator field. Moderators (and the
 * leader, A-1) sort first and carry §5.6's ROLE badge — the plain
 * square-cornered icon label, never `RankBadge`'s slanted parallelogram, which
 * §5.6's last bullet requires stay visually non-confusable in exactly this
 * name-adjacent slot.
 */

interface Candidate {
  user: User;
  member: TeamMember;
  isModerator: boolean;
}

/** §5.4/§5.8's input chrome, byte-identical to `create-bet-modal.tsx`'s. */
const inputClass =
  "w-full border border-border bg-surface-1 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-jade focus:outline-none focus:ring-1 focus:ring-jade/40";

const labelClass =
  "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

/**
 * §5.6: "Role badges (moderator/member) … are a plain square-cornered label
 * with an icon (shield/star glyph), never the parallelogram shape". Square
 * corners are the point — `RankBadge` is the skewed tag and the two must not
 * be confusable where both could sit beside a name.
 */
function ModeratorBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 border border-border px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      <Shield aria-hidden className="size-2.5" />
      Mod
    </span>
  );
}

export function PlayerSearch({
  label,
  value,
  onChange,
  excludeUserIds,
  placeholder,
  emptyLine,
  hint,
}: {
  label: string;
  /** The picked user's id, or `null` for "nobody picked yet". */
  value: string | null;
  onChange: (userId: string | null) => void;
  /** Ids this field must never offer — always includes the viewer. */
  excludeUserIds: string[];
  placeholder: string;
  /** The dry line shown when the filter matches nobody (§7 voice). */
  emptyLine: string;
  hint?: string;
}) {
  const { team, userById } = useTeam();

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  /**
   * (3) Focus return. Selecting swaps the input out for the chip and clearing
   * swaps it back, so the element that had focus is gone by the next paint.
   * The ref records where focus should land and the effect below moves it —
   * only after a real interaction, never on mount, so a field that opens with
   * a value already set does not steal focus from the title field above it.
   */
  const focusAfterSwap = useRef<"chip" | "input" | null>(null);

  // (2) The app's first `useId`. `aria-activedescendant` has to name a real,
  // unique element id, and both instances of this component are mounted in the
  // same modal at once — hardcoded literals (the app's only other id idiom)
  // would collide between the opponent field and the mediator field.
  const uid = useId();
  const labelId = `${uid}-label`;
  const inputId = `${uid}-input`;
  const listId = `${uid}-listbox`;
  const optionId = (index: number) => `${uid}-option-${index}`;

  const selected = value == null ? undefined : userById(value);

  const roster = useMemo<Candidate[]>(() => {
    const excluded = new Set(excludeUserIds);
    return team.members
      .filter((m) => !excluded.has(m.userId))
      .flatMap((member) => {
        const user = userById(member.userId);
        if (!user) return [];
        return [
          {
            user,
            member,
            // A-1: the leader holds every moderator power, so they belong in
            // the moderator tier here too — this mirrors `permissions.ts`'s
            // private `isModeratorOrLeader`, which is not exported.
            isModerator:
              member.role === "moderator" || member.userId === team.leaderId,
          },
        ];
      })
      .sort(
        (a, b) =>
          Number(b.isModerator) - Number(a.isModerator) ||
          a.user.displayName.localeCompare(b.user.displayName),
      );
  }, [team.members, team.leaderId, excludeUserIds, userById]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return roster;
    return roster.filter((c) =>
      c.user.displayName.toLowerCase().includes(needle),
    );
  }, [roster, query]);

  // The highlight must never point past the end of a list that just shrank
  // under a keystroke; clamping here rather than in the change handler keeps
  // it true no matter which of query/roster moved.
  const active = matches.length === 0 ? -1 : Math.min(activeIndex, matches.length - 1);

  // The list caps at `max-h-52` — about five 40px rows — against a roster the
  // schema plans for at ~30. Without this, arrowing past the fifth teammate
  // moves `aria-activedescendant` to a row nobody can see: a screen reader
  // follows it and a sighted keyboard user watches the highlight vanish.
  // `block: "nearest"` scrolls only when it has to, so it never fights the
  // pointer.
  useEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
    // `optionId` is a pure function of `uid`, which `useId` pins for the life
    // of the component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active, uid]);

  useEffect(() => {
    const target = focusAfterSwap.current;
    if (!target) return;
    focusAfterSwap.current = null;
    if (target === "chip") chipRef.current?.focus();
    else inputRef.current?.focus();
  }, [value]);

  function select(candidate: Candidate) {
    focusAfterSwap.current = "chip";
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
    onChange(candidate.user.id);
  }

  function clear() {
    focusAfterSwap.current = "input";
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
    onChange(null);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(0);
        return;
      }
      if (matches.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((i) => {
        const from = Math.min(i, matches.length - 1);
        return (from + step + matches.length) % matches.length;
      });
      return;
    }

    if (e.key === "Enter") {
      // Only swallow Enter when it is actually picking someone. A form inside
      // a modal has no submit button of its own here, but an Enter that does
      // nothing visible and is silently eaten is its own bug.
      if (open && active >= 0) {
        e.preventDefault();
        select(matches[active]);
      }
      return;
    }

    if (e.key === "Escape") {
      // `stopImmediatePropagation`, and it has to be that one.
      //
      // `sl/modal-shell.tsx` closes the modal from a listener on `document`,
      // and the Next.js App Router hydrates on `document` too — react-dom
      // delegates `keydown` to the hydration container, which here IS the
      // document node. So React's handler and ModalShell's are two listeners
      // on the SAME node. `stopPropagation` only stops the event moving to the
      // next node in the path; siblings already registered on the current node
      // still run. Using it here would close the list and the whole modal at
      // once, losing a half-filled challenge to a keystroke that was meant to
      // dismiss a dropdown.
      //
      // Ordering makes this work: React registers at hydration, ModalShell in
      // a `useEffect` when the modal mounts, so React's runs first and this
      // call lands before ModalShell's. Guarded on `open` precisely so that
      // when there is no list to close, Escape reaches ModalShell exactly as
      // it always has.
      if (open) {
        e.nativeEvent.stopImmediatePropagation();
        setOpen(false);
      }
      return;
    }

    if (e.key === "Tab") setOpen(false);
  }

  return (
    <div className="space-y-1.5">
      <p id={labelId} className={labelClass}>
        {label}
      </p>

      {selected ? (
        <div className="flex items-center gap-2 border border-jade bg-surface-1 px-2 py-1.5">
          <UserAvatar user={selected} size={20} />
          <span
            className="min-w-0 flex-1 truncate text-sm font-medium"
            style={{ color: selected.nameColor }}
          >
            {selected.displayName}
          </span>
          {/* The `✕` character, not lucide's `<X>`: two remove glyphs coexist
              in this codebase and the literal one is the *remove a row* button
              (`create-bet-modal.tsx`), while `<X>` is *close this surface*
              (`modal-shell.tsx`). This is the former. */}
          <button
            ref={chipRef}
            type="button"
            onClick={clear}
            aria-label={`Remove ${selected.displayName}`}
            className="shrink-0 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-jade/40"
          >
            ✕
          </button>
        </div>
      ) : (
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          // (1) Virtual focus: DOM focus stays here for the whole interaction
          // and `aria-activedescendant` moves instead. The alternative —
          // roving `tabIndex` over the options — would take focus off the
          // field the person is still typing into.
          role="combobox"
          // Both keyed on the listbox ACTUALLY being rendered, not merely on
          // the panel being open: the empty arm below renders no `<ul>`, and
          // `aria-expanded="true"` pointing `aria-controls` at an id that is
          // not in the document is a broken reference — assistive tech is told
          // to look at a popup that does not exist.
          aria-expanded={open && matches.length > 0}
          aria-controls={matches.length > 0 ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={
            open && active >= 0 ? optionId(active) : undefined
          }
          aria-labelledby={labelId}
          autoComplete="off"
          value={query}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          className={inputClass}
        />
      )}

      {/*
        (4) IN-FLOW, not an absolutely-positioned popup — and this is deliberate
        enough to be worth the paragraph, because every other floating surface
        in this app is a Radix portal and the reflex is to reach for one.

        This list lives inside `ModalShell`'s body, which is
        `flex-1 overflow-y-auto` inside a panel that is `overflow-hidden`. An
        absolute list is clipped at that body's edge, and because absolutely
        positioned content contributes no scroll height, the clipped part
        cannot be scrolled to — the mediator field, which sits low in the form,
        would lose its own dropdown. A portal would escape the clip but
        reintroduces anchoring math the app has never had, plus a z-index above
        the modal's own tier (`globals.css` says not to renumber those).

        Expanding in flow cannot clip at any breakpoint, needs no measurement,
        and is what the roadmap's "inline dropdown at every breakpoint — do not
        invent a nested bottom-sheet-inside-a-modal" asks for most literally.
        The cost is that the fields below shift down while the list is open;
        `max-h-52` bounds that, and the modal body already scrolls.

        Chrome is §4.2's floating row — N2 surface, `--border-strong` edge —
        and NO shadow: the one soft `box-shadow` in the app belongs to the
        modal overlay alone. No `cut-*` either; §4.3's single-cut budget in an
        open modal is already spent on `ModalShell`'s `cut-md`.
      */}
      {open && (
        <div className="border border-border-strong bg-surface-2">
          {matches.length === 0 ? (
            // Not a validation error, so no ember border and no `role="alert"`
            // — a filter matching nothing is not a bad field. Same shape as
            // `standings-full-modal.tsx`'s all-solvent line. It carries no
            // `role` of its own: the announcement is the always-mounted live
            // region at the foot of this component, for the reason
            // `sl/toast-layer.tsx` already documents — a live region that is
            // created in the same commit as its own text is usually not
            // announced at all, because there was no region to observe when
            // the text arrived.
            <p className="py-6 text-center text-sm text-muted-foreground">
              {emptyLine}
            </p>
          ) : (
            <ul
              id={listId}
              role="listbox"
              aria-labelledby={labelId}
              className="max-h-52 overflow-y-auto"
            >
              {matches.map((candidate, index) => (
                <li
                  key={candidate.user.id}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === active}
                  // Pointer and keyboard must never highlight two different
                  // rows, so hovering MOVES the active index rather than
                  // painting a second `bg-surface-3` of its own.
                  onMouseEnter={() => setActiveIndex(index)}
                  // Keeps focus on the input so `onBlur` does not close the
                  // list out from under the click that is selecting from it.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => select(candidate)}
                  className={cn(
                    "flex h-10 cursor-pointer items-center gap-2 px-3 transition-colors",
                    index === active && "bg-surface-3",
                  )}
                >
                  <UserAvatar user={candidate.user} size={20} />
                  <span
                    className="min-w-0 flex-1 truncate text-sm font-medium"
                    style={{ color: candidate.user.nameColor }}
                  >
                    {candidate.user.displayName}
                  </span>
                  {candidate.isModerator && <ModeratorBadge />}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}

      {/* Mounted for the life of the field and empty until it has something to
          say (`toast-layer.tsx`'s precedent, and its reasoning applies here
          unchanged). `polite` because a filter that matched nothing is not an
          error and must not interrupt; `aria-atomic="false"` because the
          implicit `true` on `role="status"` would re-announce the whole region
          every time it changed. */}
      <p role="status" aria-live="polite" aria-atomic="false" className="sr-only">
        {open && matches.length === 0 ? emptyLine : ""}
      </p>
    </div>
  );
}
