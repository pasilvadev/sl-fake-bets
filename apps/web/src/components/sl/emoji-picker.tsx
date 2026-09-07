"use client";

import { useId, useMemo, useRef, useState } from "react";
import { cn } from "cn";
import {
  BET_EMOJI_CATEGORIES,
  betEmojiFor,
  searchBetEmoji,
  type BetEmoji,
} from "@repo/shared";

/**
 * The bet icon picker — `design-visual-identity.md` §5.8's "Icon-set grid
 * picker (avatar / bet emoji)" row, which specified this control before it
 * existed: a `cut-sm` chip per option, selection marked by a jade BORDER and
 * not a filled background.
 *
 * It replaces a two-character text input, which was the wrong control on the
 * obvious grounds — this is a web app, and picking an emoji from a keyboard is
 * something a phone does and a desktop browser does not — and was quietly
 * worse than that: `maxLength={2}` counts UTF-16 code units, so 🌧️ arrived as
 * 🌧 (variation selector dropped, monochrome on some platforms) and 🏴‍☠️
 * arrived as 🏴, a different emoji. Nothing downstream needed the cap: the
 * column is bare `text` and `create_bet` only trims.
 *
 * ## Why it renders in flow instead of in a popover
 *
 * The same reason `player-search.tsx` does, and it is worth restating because
 * it is the trap: this control's only caller is a modal, `ModalShell`'s body is
 * `overflow-y-auto` inside an `overflow-hidden` panel, and absolutely
 * positioned content in there is clipped AND contributes no scroll height, so
 * it cannot be scrolled to. The three Radix popovers in the app
 * (`profile-menu`, `team-switcher`, `ui/tooltip`) all portal out of that
 * problem and all live in top-bar chrome, outside any modal; a portal here
 * would need a z-index above the modal's own tier, and `globals.css` reserves
 * the only one above it (z-60) for toasts. So the panel pushes the fields
 * below it down, and the modal body scrolls, exactly as the roster typeahead
 * already taught this codebase to accept.
 *
 * ## Grid, not tabs
 *
 * ~350 entries with a search field and one overline heading per category, all
 * in one scroll container. Category TABS were the other option and are a new
 * pattern: banned-list #13 reserves dropdowns for long/rare lists and offers
 * segmented controls for "short frequent choices", and nine categories in a
 * 464px modal body is neither. Headings reuse the label/overline type row the
 * bet feed already uses for its groups, and cost nothing to scroll past.
 */
export function EmojiPicker({
  value,
  onChange,
}: {
  /** The stored icon — a catalog char, or "" for no icon (DOM-009: optional). */
  value: string;
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const matches = useMemo(() => searchBetEmoji(query), [query]);
  const searching = query.trim().length > 0;

  // The categories, filtered to what the current query left standing, so the
  // browsing and searching views are one render path rather than two. A
  // matched set is cheap to intersect per category: the catalog is a few
  // hundred entries and this recomputes only when the query does.
  const groups = useMemo(() => {
    if (!searching) return BET_EMOJI_CATEGORIES;
    const kept = new Set(matches.map((m) => m.char));
    return BET_EMOJI_CATEGORIES.map((category) => ({
      ...category,
      emoji: category.emoji.filter((e) => kept.has(e.char)),
    })).filter((category) => category.emoji.length > 0);
  }, [searching, matches]);

  // The visible tiles as one flat sequence, which is what the roving tabindex
  // indexes into. Derived from `groups` rather than from `matches` so the
  // keyboard order and the reading order are the same list by construction.
  const visible = useMemo(() => groups.flatMap((g) => g.emoji), [groups]);

  const selected = value ? betEmojiFor(value) : undefined;
  const emptyLine = "No emoji matches that.";

  // Clamped at read time rather than stored-and-corrected: a query that
  // shrinks the grid under the active index must not leave `tabIndex={0}` on a
  // tile that no longer exists, and clamping here is one expression instead of
  // an effect that fires after a render has already shipped the bad value.
  const activeIndex = Math.min(active, Math.max(0, visible.length - 1));

  function pick(char: string) {
    // Picking the selected one again clears it — the same "click it off"
    // affordance the option rows have, and the only way to get back to no
    // icon without a second control competing for the same 24px of form.
    onChange(char === value ? "" : char);
  }

  /**
   * Close the panel AND put focus back on the trigger.
   *
   * The focus half is not a nicety. The panel — search field and every tile —
   * is conditionally rendered, and real DOM focus normally sits inside it (the
   * search field takes focus on open; the arrows move focus onto a tile). When
   * `open` flips to false the focused node is removed from the document, and
   * the HTML focus-fixup rule then resets focus to `<body>` — so a keyboard
   * user who pressed Escape would find their next Tab restarting from the top
   * of the page instead of continuing to the Options field.
   *
   * `player-search.tsx` never hits this because its input never unmounts and
   * its roving focus is virtual. This control made the opposite (correct for a
   * grid) choice, so it owes the user the explicit focus return instead.
   */
  function closePanel() {
    setOpen(false);
    trigger.current?.focus();
  }

  /**
   * Move the roving tabindex, and DOM focus with it.
   *
   * Real focus, not the virtual `aria-activedescendant` focus
   * `player-search.tsx` uses — and the difference is the control, not a change
   * of mind. A combobox has to keep DOM focus in its text input because the
   * user is still typing into it. A grid of buttons has nothing to type into,
   * so the standard grid pattern applies: exactly one tile is tabbable and the
   * arrows move which one, which makes the whole grid ONE tab stop instead of
   * 373. Without it, a keyboard user heading for the Options field below had
   * to press Tab once per emoji in the catalog.
   */
  function moveActive(next: number) {
    if (visible.length === 0) return;
    const clamped = Math.max(0, Math.min(next, visible.length - 1));
    setActive(clamped);
    // Focus waits a frame: the tile exists already (only its tabindex is
    // changing), but React has not committed that change yet, and focusing a
    // `tabindex={-1}` button then re-rendering it is how focus gets dropped.
    requestAnimationFrame(() => {
      const tile = grid.current?.querySelectorAll<HTMLButtonElement>(
        "button[data-emoji-tile]",
      )[clamped];
      tile?.focus();
      tile?.scrollIntoView({ block: "nearest" });
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      if (!open) return;
      // `stopImmediatePropagation`, and it has to be that one — the reasoning
      // is written out in full in `player-search.tsx`: ModalShell's Escape
      // listener and React's delegated one sit on the SAME node (`document`),
      // so `stopPropagation` would close this panel and the whole half-filled
      // bet with it. Guarded on `open` so Escape still closes the modal when
      // there is no panel to close.
      e.nativeEvent.stopImmediatePropagation();
      closePanel();
      return;
    }

    if (!open) return;

    // Which element the key came from decides what the arrows mean, and both
    // of these tests are on the SPECIFIC element rather than on "not the other
    // one". An earlier version asked only `!inGrid`, which made every node in
    // this field's subtree — the trigger, the "clear" link — an ArrowDown that
    // yanked focus into the grid. Shift+Tab back out of the search field, tap
    // Down out of habit, and focus jumped somewhere you never asked it to go.
    const target = e.target instanceof HTMLElement ? e.target : null;
    const inGrid = target?.hasAttribute("data-emoji-tile") ?? false;
    const inSearch = target === searchInput.current;

    if (!inGrid) {
      // Down FROM the search field is the standard way into a grid, and the
      // one arrow that field gives up: Left/Right still move its caret.
      if (inSearch && e.key === "ArrowDown") {
        e.preventDefault();
        moveActive(activeIndex);
      }
      return;
    }

    // COLUMNS mirrors `grid-cols-8` below. Up/Down step a whole row, which is
    // exact inside a category and approximate across a heading (the row above
    // a heading is not eight tiles wide). Approximate is the right trade here:
    // it always moves, never traps, and Left/Right are exact everywhere.
    const COLUMNS = 8;
    const step: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: COLUMNS,
      ArrowUp: -COLUMNS,
    };
    const delta = step[e.key];
    if (delta !== undefined) {
      e.preventDefault();
      moveActive(activeIndex + delta);
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      moveActive(0);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      moveActive(visible.length - 1);
    }
  }

  return (
    <div className="space-y-2" onKeyDown={onKeyDown}>
      <div className="flex items-center gap-3">
        <button
          ref={trigger}
          type="button"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={() => {
            const next = !open;
            setOpen(next);
            setQuery("");
            setActive(0);
            // Focus follows the panel, so a keyboard user lands in the search
            // field rather than having to tab back through the trigger.
            if (next) requestAnimationFrame(() => searchInput.current?.focus());
          }}
          className={cn(
            "cut-sm flex size-11 shrink-0 items-center justify-center border bg-surface-1 text-xl outline-none transition-colors focus-visible:ring-1 focus-visible:ring-jade/40",
            value ? "border-jade" : "border-border hover:border-jade/50",
          )}
        >
          {value ? (
            <span aria-hidden>{value}</span>
          ) : (
            // The 🎲 a bet without an icon actually renders with
            // (`bet-row.tsx`), dimmed, so the empty state shows the real
            // default rather than a placeholder that lies about it.
            <span aria-hidden className="opacity-40">
              🎲
            </span>
          )}
          <span className="sr-only">
            {selected
              ? `Bet icon: ${selected.name}. Change it.`
              : value
                ? `Bet icon: ${value}. Change it.`
                : "Pick a bet icon"}
          </span>
        </button>

        <div className="min-w-0 text-xs text-muted-foreground">
          {value ? (
            <>
              <span className="text-foreground">
                {selected ? selected.name : value}
              </span>
              {" · "}
              <button
                type="button"
                onClick={() => onChange("")}
                className="underline-offset-2 outline-none transition-colors hover:text-foreground hover:underline focus-visible:ring-1 focus-visible:ring-jade/40"
              >
                clear
              </button>
            </>
          ) : (
            "Optional — a bet with no icon gets the dice."
          )}
        </div>
      </div>

      {open && (
        <div id={panelId} className="border border-border-strong bg-surface-2">
          <div className="border-b border-border p-2">
            <input
              ref={searchInput}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                // A new result set starts the roving index over. Clamping
                // alone would leave it pointing at whatever is now 40th.
                setActive(0);
              }}
              placeholder="Search icons…"
              aria-label="Search bet icons"
              // Byte-identical to `create-bet-modal.tsx`'s `inputClass` and to
              // `player-search.tsx`'s field, `px-3 py-2` included: §5.8 has one
              // row for text fields, and a search box a few pixels shorter than
              // the Title field directly above it reads as unfinished.
              className="w-full border border-border bg-surface-1 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-jade focus:outline-none focus:ring-1 focus:ring-jade/40"
            />
          </div>

          {groups.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {emptyLine}
            </p>
          ) : (
            <div ref={grid} className="max-h-56 space-y-3 overflow-y-auto p-2">
              {(() => {
                // A running offset across the groups, so each tile knows its
                // index in the FLAT visible sequence — which is the index the
                // roving tabindex and the arrow keys both speak in. Computed
                // here rather than with a `visible.indexOf` per tile, which
                // would be 373 linear scans per render.
                let flat = -1;
                return groups.map((category) => (
                  <div key={category.id} className="space-y-1.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {category.label}
                    </p>
                    <div className="grid grid-cols-8 gap-1.5">
                      {category.emoji.map((entry) => {
                        flat += 1;
                        return (
                          <EmojiTile
                            key={entry.char}
                            entry={entry}
                            selected={entry.char === value}
                            // Exactly one tile in the whole grid is tabbable.
                            tabbable={flat === activeIndex}
                            index={flat}
                            onFocused={setActive}
                            onPick={pick}
                          />
                        );
                      })}
                    </div>
                  </div>
                ));
              })()}
            </div>
          )}
        </div>
      )}

      {/*
        Mounted from the start and mounted EMPTY, per §5.9's rule for the toast
        layer and the same pattern `player-search.tsx` uses: a live region that
        appears already carrying text is the classic dropped announcement
        (WCAG SC 4.1.3).
      */}
      <p role="status" aria-live="polite" aria-atomic="false" className="sr-only">
        {open && searching && groups.length === 0 ? emptyLine : ""}
      </p>
    </div>
  );
}

function EmojiTile({
  entry,
  selected,
  tabbable,
  index,
  onFocused,
  onPick,
}: {
  entry: BetEmoji;
  selected: boolean;
  /** The one tile the roving tabindex currently rests on. */
  tabbable: boolean;
  /** This tile's position in the flat visible sequence. */
  index: number;
  /** Reports that focus arrived here by any route, so the rover can follow. */
  onFocused: (index: number) => void;
  onPick: (char: string) => void;
}) {
  return (
    <button
      type="button"
      data-emoji-tile=""
      tabIndex={tabbable ? 0 : -1}
      aria-label={entry.name}
      aria-pressed={selected}
      // The rover follows focus rather than only leading it. A `tabIndex={-1}`
      // button is still mouse-focusable, so a CLICK moved real focus to a tile
      // the rover knew nothing about — and the next arrow key then stepped
      // from the stale index, throwing focus back to wherever the keyboard had
      // last been. Syncing here covers the click, and every other way focus
      // can arrive, with one handler instead of one per route.
      onFocus={() => onFocused(index)}
      onClick={() => onPick(entry.char)}
      className={cn(
        "cut-sm flex aspect-square items-center justify-center border bg-surface-1 text-xl leading-none outline-none transition-colors focus-visible:ring-1 focus-visible:ring-jade/40",
        selected ? "border-jade" : "border-border hover:bg-surface-3",
      )}
    >
      <span aria-hidden>{entry.char}</span>
    </button>
  );
}
