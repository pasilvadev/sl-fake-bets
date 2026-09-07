"use client";

import { useMemo, useState } from "react";
import { cn } from "cn";
import { CONFIG, mustForceAnyModerator, validateDuelDraft } from "@repo/shared";
import { useModal } from "@/lib/modal-context";
import { useTeam } from "@/lib/team-context";
import { useToast } from "@/lib/toast-context";
import { ModalShell } from "@/components/sl/modal-shell";
import { PlayerSearch } from "@/components/sl/player-search";
import { CoinAmount } from "@/components/sl/coin-amount";

const QUICK_CHIPS = [10, 25, 50] as const;

const inputClass =
  "w-full border border-border bg-surface-1 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-jade focus:outline-none focus:ring-1 focus:ring-jade/40";

const labelClass =
  "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

/**
 * D7's additive "any moderator" control (Extra Phase 3, task 2).
 *
 * **It is a toggle, not a checkbox, and that substitution is deliberate.** The
 * owner's wording was "the *any moderator* checkbox"; `design-visual-identity`
 * §5.8 specifies a Toggle/switch row and contains the word "checkbox" nowhere
 * in its 699 lines, and no `<input type="checkbox">` exists anywhere in this
 * app. Shipping an unspecified control silently was the one option the roadmap
 * ruled out, so this is the specified control and §5.8 records the
 * substitution. Chrome copied from `team-settings-modal.tsx`'s
 * `AccessModeToggle`, the doc's only other realization: jade = on, `bg-input`
 * (N4) track = off, never a red "off".
 *
 * D9's forced state renders here and NOWHERE else. In a `restricted` team the
 * toggle is on and disabled with the reason beneath it in N6 — never a silent
 * lock, and never an error: `create_duel` COERCES `any_moderator` to true in
 * the same transaction that writes the row, so `validateDuelDraft` has no
 * issue code for this and must not grow one. The component asks
 * `mustForceAnyModerator(team)` and never reads `team.accessMode` itself.
 *
 * Disabled is `opacity-40 pointer-events-none` — §5.3's rule ("on any variant
 * — no separate gray palette"), not `AccessModeToggle`'s `opacity-60`. The two
 * disabled states mean different things: that one is "you may not change
 * this", this one is "this is settled for you", and the stronger dim is what
 * keeps a forced-on switch from reading as something still worth pressing.
 */
function AnyModeratorToggle({
  checked,
  forced,
  onChange,
}: {
  checked: boolean;
  forced: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3 border border-border p-3">
        <div className="min-w-0">
          <p className="text-sm text-foreground">Any moderator can resolve it</p>
          <p className="text-xs text-muted-foreground">
            Additive — whoever acts first settles it, so it never waits on one
            quiet person.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label="Any moderator can resolve it"
          disabled={forced}
          onClick={() => onChange(!checked)}
          className={cn(
            "relative inline-flex h-5 w-9 shrink-0 items-center transition-colors",
            checked ? "bg-jade" : "bg-input",
            forced
              ? "opacity-40 pointer-events-none"
              : "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-jade/40",
          )}
        >
          <span
            className={cn(
              // `motion-safe:` on the transition, not on the translate: under
              // reduced motion §6 wants the knob to arrive instantly, not to
              // stop moving. The shipped access-mode switch predates the rule
              // and is left alone; this one is new code and follows it.
              "absolute size-3.5 rounded-full bg-surface-2 motion-safe:transition-transform",
              checked ? "translate-x-4" : "translate-x-0.5",
            )}
          />
        </button>
      </div>
      {forced && (
        <p className="text-xs text-muted-foreground">
          Restricted team: moderators can always resolve.
        </p>
      )}
    </div>
  );
}

/**
 * Send a challenge (Extra Phase 3, task 2; D1/D5/D7/D9).
 *
 * Gates through the shared `validateDuelDraft` — the same five rules
 * `create_duel` re-checks with byte-identical sentences — then submits through
 * `startDuel` and surfaces `MutationResult.error` inline, exactly as every
 * other form modal does (§5.8: a field owns its error; a toast never reports a
 * bad form field).
 *
 * Four fields the RPC does NOT take, and none of them is an oversight: no
 * options (it generates exactly two from the participants' display names,
 * position 0 = challenger), no close time (the accept window is
 * `app.duel_accept_window()`'s and a browser that could name its own deadline
 * could name one ten years out), no per-user max (it IS the stake, which is
 * what makes a third wager structurally impossible), and no icon — DOM-009
 * makes it decoration, `found-bugs.md` already records that the emoji text
 * input is the wrong control on a web app, and a duel has a glyph of its own
 * (§5.1: ⚔️ when none is set) rather than the 🎲 fallback a pool bet takes.
 */
export function StartDuelModal() {
  const { close } = useModal();
  const { team, currentUser, balance, startDuel } = useTeam();
  const { show } = useToast();

  const [title, setTitle] = useState("");
  const [challengeeId, setChallengeeId] = useState<string | null>(null);
  const [mediatorId, setMediatorId] = useState<string | null>(null);
  const forceAnyModerator = mustForceAnyModerator(team);
  const [anyModerator, setAnyModerator] = useState(false);
  const [stake, setStake] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // The stored value the challenger is choosing; in a restricted team D9 makes
  // it `true` no matter what this state holds, and the toggle renders that.
  const effectiveAnyModerator = forceAnyModerator || anyModerator;

  // Memoized because `PlayerSearch` keys its roster memo on this array; a
  // fresh literal per render would make that memo recompute every keystroke.
  const opponentExcludes = useMemo(() => [currentUser.id], [currentUser.id]);
  const mediatorExcludes = useMemo(
    () => (challengeeId ? [currentUser.id, challengeeId] : [currentUser.id]),
    [currentUser.id, challengeeId],
  );

  const issues = validateDuelDraft(
    {
      title,
      challengeeId: challengeeId ?? "",
      mediatorId,
      anyModerator: effectiveAnyModerator,
      stake,
    },
    { team, challengerId: currentUser.id, balance },
  );
  const canSubmit = issues.length === 0 && !pending;

  // Which issue is worth saying out loud before submit, and which is simply
  // "you have not finished the form yet". A blank title, an unpicked opponent
  // and a zero stake are all the latter — the disabled button already says so,
  // and shouting "Pick who you're challenging." at someone who has not reached
  // that field is the noise §7 tells us not to make.
  //
  // The rest all share one shape: **the form looks finished and the refusal is
  // invisible.** A stake above the balance is the obvious one. `resolver-
  // required` is the one that actually bit — it is the state this form OPENS
  // in outside a restricted team (no mediator, toggle off), so someone could
  // fill in every field, follow the mediator hint's own advice to leave it
  // blank, and be left with a dead primary and nothing on screen explaining
  // it. Its message names both escapes ("Pick a mediator, or let any moderator
  // resolve it."), which is exactly what that person needs to read.
  const visibleIssue =
    stake > 0 && issues.some((i) => i.code === "duel-stake-invalid")
      ? issues.find((i) => i.code === "duel-stake-invalid")
      : issues.find(
          (i) =>
            i.code === "duel-target-self" ||
            i.code === "duel-mediator-invalid" ||
            i.code === "duel-resolver-required",
        );

  function setClampedStake(next: number) {
    setStake(Math.max(0, Math.min(balance, Math.round(next))));
  }

  async function submit() {
    if (!canSubmit || challengeeId == null) return;
    setSubmitError(null);
    setPending(true);
    const result = await startDuel({
      title,
      challengeeId,
      mediatorId,
      // The challenger's INTENT. What gets stored may differ — D9's coercion
      // lives in `create_duel` and `startDuel` takes the server's answer back
      // rather than predicting it — which is why nothing here echoes this
      // value into the local row.
      anyModerator: effectiveAnyModerator,
      stake,
    });
    setPending(false);
    if (!result.ok) {
      setSubmitError(result.error);
      return;
    }
    // Synchronous, in the handler of the action this person took — the only
    // shape §5.9/D5 permits. Nothing notifies the challengee (ARC-014); their
    // signal is the feed pin, pull-based, on their next look.
    show({ kind: "success", text: "Challenge sent.", key: "duel-start" });
    close();
  }

  const footerError = submitError ?? visibleIssue?.message ?? null;

  return (
    <ModalShell
      eyebrow="NEW 1V1"
      title="Challenge a teammate"
      onClose={close}
      footer={
        <div className="space-y-2">
          {footerError && <p className="text-xs text-negative">{footerError}</p>}
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => void submit()}
            className="cut-sm h-9 w-full px-5 text-xs font-semibold uppercase tracking-wide text-black bg-jade transition-[filter] motion-safe:hover:brightness-110 motion-safe:active:brightness-95 disabled:opacity-40 disabled:pointer-events-none"
          >
            {pending ? "Sending…" : "Send challenge"}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="space-y-1.5">
          {/* `htmlFor`/`id` rather than the app's usual bare `<label>`: with no
              association these fields take their accessible name from the
              placeholder, so the stake input announces as "0". Both ids are
              namespaced because two modals can never be open at once but a
              hardcoded `title` would be a poor neighbour if that changed. */}
          <label htmlFor="start-duel-title" className={labelClass}>
            Title
          </label>
          <input
            id="start-duel-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Who wins at pool on Saturday?"
            className={inputClass}
          />
        </div>

        <PlayerSearch
          label="Opponent"
          value={challengeeId}
          onChange={(next) => {
            setChallengeeId(next);
            // A mediator may not be a participant, so promoting someone to
            // opponent has to release them from the mediator field rather
            // than leave a draft the RPC will refuse.
            if (next != null && next === mediatorId) setMediatorId(null);
          }}
          excludeUserIds={opponentExcludes}
          placeholder="Search the roster"
          emptyLine="Nobody on the roster by that name."
        />

        <div className="space-y-1.5">
          <label htmlFor="start-duel-stake" className={labelClass}>
            Stake
          </label>
          <input
            id="start-duel-stake"
            type="number"
            min={0}
            max={balance}
            value={stake === 0 ? "" : stake}
            onChange={(e) => setClampedStake(Number(e.target.value) || 0)}
            placeholder="0"
            className={cn(inputClass, "font-mono tabular-nums")}
          />
          <div className="flex gap-2">
            {QUICK_CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => setClampedStake(chip)}
                className="border border-border px-2.5 py-1 font-mono text-xs tabular-nums text-muted-foreground transition-colors hover:border-jade/50 hover:text-jade"
              >
                {chip}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setClampedStake(balance)}
              className="border border-border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:border-jade/50 hover:text-jade"
            >
              Max
            </button>
          </div>
          {/* The symmetric-stake sentence, live under the field. It is the
              whole of a duel's math: both sides put up the same amount and
              `settleBet` pays a flat 2.00x, which is why this feature added no
              payout formula at all (Extra Phase 2, task 6). */}
          <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            You both put up <CoinAmount amount={stake} /> · winner takes{" "}
            <CoinAmount amount={stake * 2} />
          </p>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            Your balance: <CoinAmount amount={balance} />
          </p>
        </div>

        <PlayerSearch
          label="Mediator"
          value={mediatorId}
          onChange={setMediatorId}
          excludeUserIds={mediatorExcludes}
          placeholder="Search the roster"
          emptyLine="Nobody on the roster by that name."
          hint="Anyone but the two of you — or leave it empty and turn on the switch below."
        />

        <AnyModeratorToggle
          checked={effectiveAnyModerator}
          forced={forceAnyModerator}
          onChange={setAnyModerator}
        />

        {/* `CONFIG.DUEL_ACCEPT_WINDOW_HOURS` writes the sentence and nothing
            else — `app.duel_accept_window()` is the authority that computes
            the deadline the row stores, and no client value is ever sent for
            it (design-stack.md §4 rule 4; the two must move together). */}
        <p className="text-xs text-muted-foreground">
          They have {CONFIG.DUEL_ACCEPT_WINDOW_HOURS} hours to accept. Your
          stake leaves your balance now and comes back if they don&apos;t.
        </p>
      </div>
    </ModalShell>
  );
}
