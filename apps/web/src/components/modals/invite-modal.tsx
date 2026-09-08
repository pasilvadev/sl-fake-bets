"use client";

import { useState } from "react";
import { cn } from "cn";
import { Link2Off } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  CONFIG,
  inviteCreationBlocker,
  liveInvites,
  type TeamInvite,
} from "@repo/shared";
import { useModal } from "@/lib/modal-context";
import { useTeam } from "@/lib/team-context";
import { useToast } from "@/lib/toast-context";
import { useErrorText } from "@/lib/use-error-text";
import { useNow } from "@/lib/use-now";
import { formatTimeLeft } from "@/lib/format";
import { ModalShell } from "@/components/sl/modal-shell";
import { SMark } from "@/components/sl/s-mark";

type InviteKind = "permanent" | "temporary";

/**
 * Destructive ordinary trigger (§5.3), the exact class `team-settings-modal.tsx`'s
 * `MemberRow` uses for Kick/Ban: neutral surface, ember icon only, the label
 * itself never ember. Copied rather than imported — that module exports no
 * shared constant, and the two rows are not otherwise coupled.
 */
const iconButtonClass =
  "p-1.5 text-foreground transition-colors hover:bg-ember-wash";

/**
 * UX-023's invite surface, amended by `plan-invite-links.md` into a small link
 * manager. Closes open decision #6 (`AGENT_SPEC.md` §6 item 6): a team can now
 * hold several live links at once, each either permanent (D1: `expiresAt ===
 * null`, the UX-005 default, never touched by a clock) or a 24-hour link that
 * dies on its own — and any of them can be revoked by hand.
 *
 * What each decision buys this file, one sentence each:
 * D5 — creation still follows `canInvite` (DOM-006's access mode), but
 * revocation is per-row (`canRevokeInvite(invite)`): the leader, a moderator,
 * or whoever minted THAT link, so an ordinary member's row can carry a revoke
 * control a moderator's neighbouring row does not.
 * D7 — there is no scalar link any more, only `team.invites`; every list here
 * is derived from it with an injected clock rather than read once at load, so
 * a link dying while this modal is open is reflected without a reload.
 * D8 — minting a second permanent link is refused, not silently regenerated:
 * the composer disables "Permanent" the moment a live one exists and explains
 * why, and revoking is a separate, confirmed action from creating a new one.
 * D10 — there is no realtime channel for `invite_codes`; a teammate's own
 * create/revoke is seen on this screen only after ITS OWN mutation reloads
 * (`createInvite`/`revokeInvite` in `team-context.tsx` both do), same as
 * `createTeam`/`joinTeamByCode` already trade off.
 *
 * The origin comes from `window` — a hardcoded host would hand a teammate a
 * link to somebody else's machine. Safe to read during render: ModalRoot only
 * mounts a modal in response to a click, so this component never renders on
 * the server. The guard is there for the type, not for a real code path.
 */
export function InviteModal() {
  const t = useTranslations("inviteModal");
  const { close } = useModal();
  const { team, bets, canInvite, createInvite } = useTeam();
  const { errorText, codeText } = useErrorText();
  const now = useNow();
  const [origin] = useState(() =>
    typeof window === "undefined" ? "" : window.location.origin,
  );
  const [selected, setSelected] = useState<InviteKind | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const openCount = bets.filter((b) => b.state === "open").length;

  /**
   * D3: `liveInvites` needs a real clock to tell an already-lapsed 24-hour
   * link from a live one, and `now` reads `null` for exactly one frame after
   * mount — `useNow` is hydration-safe by design, the same `now == null` gap
   * `bet-row.tsx` renders through on its first frame. Substituting a stand-in
   * clock here (as the row below safely does for the PERMANENT-only question)
   * would read an expired temporary link as live for a tick, which is the
   * wrong direction to be wrong in — so this one frame shows every
   * non-revoked link, unfiltered, rather than guess.
   */
  const rows = now == null ? team.invites : liveInvites(team, now);

  /**
   * D6/D8's client half, read once here rather than re-derived per option
   * button: `inviteCreationBlocker`'s permanent branch never actually
   * consults the clock (a permanent link's liveness is `expiresAt === null`,
   * unconditionally true), so `now ?? 0` is not a guess for it, it is the
   * exact right answer a tick early. The cap branch genuinely needs the real
   * clock — an already-expired 24-hour link must not count toward it — so it
   * stays `false` (not merely optimistic) until `now` is real; the RPC still
   * re-checks both inside its own transaction regardless (D6's own comment),
   * so an unblocked button here is advice, never the enforcement.
   */
  const permanentBlocked =
    inviteCreationBlocker(team, now ?? 0, false) === "invite-permanent-exists";
  const temporaryBlocked =
    now != null && inviteCreationBlocker(team, now, true) === "invite-temp-cap";

  // D8's starting point only: steer toward whichever kind is not already
  // taken. `selected` overrides this the moment either button is pressed, and
  // a disabled button never fires `onClick`, so a blocked kind is never
  // reachable through this fallback alone.
  const effectiveSelected: InviteKind =
    selected ?? (permanentBlocked ? "temporary" : "permanent");
  const selectedBlocked =
    effectiveSelected === "permanent" ? permanentBlocked : temporaryBlocked;

  async function submitCreate() {
    setCreateError(null);
    setCreating(true);
    const result = await createInvite(effectiveSelected === "temporary");
    setCreating(false);
    // Deliberately no toast on success (task 1): the new row's own Copy
    // button is the next action a person takes, and it is the feedback.
    if (!result.ok) setCreateError(errorText(result));
  }

  return (
    <ModalShell
      eyebrow={t("eyebrow")}
      title={team.name}
      onClose={close}
      footer={
        <p className="text-[11px] text-muted-foreground">{t("footerNote")}</p>
      }
    >
      <div className="space-y-5">
        <div className="flex items-center gap-3 border border-border bg-surface-1 p-4">
          <SMark className="size-8 text-jade" />
          <div>
            <p className="text-sm font-medium text-text-strong">
              {t("join", { team: team.name })}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("stats", { members: team.members.length, openBets: openCount })}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("activeLinks")}
          </p>
          {rows.length === 0 ? (
            // Deliberately NOT <EmptyState> (§5.10) — that component is a
            // whole-surface pattern (128px watermark, py-16), and this is one
            // sub-section of a sm:max-w-lg modal, not a surface of its own.
            <p className="text-xs text-muted-foreground">{t("noLinks")}</p>
          ) : (
            <ul className="space-y-2">
              {rows.map((invite) => (
                <LiveInviteRow key={invite.id} invite={invite} origin={origin} now={now} />
              ))}
            </ul>
          )}
        </div>

        {canInvite && (
          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("newLink")}
            </p>
            {/* The two-choice idiom copied from `create-team-modal.tsx`'s
                access-mode buttons (lines 84-115): two independently
                focusable plain buttons, selected state `border-jade
                bg-jade-wash`. Not a `role="radiogroup"` — the app has none
                and a conformant one needs roving arrow-key focus this modal
                does not need — but that precedent carries no ARIA state at
                all, and a two-way exclusive choice is exactly what
                `aria-pressed` describes, so it gains that one attribute. */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                aria-pressed={effectiveSelected === "permanent"}
                disabled={permanentBlocked}
                onClick={() => setSelected("permanent")}
                className={cn(
                  "border p-3 text-left transition-colors disabled:opacity-40 disabled:pointer-events-none",
                  effectiveSelected === "permanent"
                    ? "border-jade bg-jade-wash"
                    : "border-border hover:border-border-strong",
                )}
              >
                <p className="text-sm font-medium text-foreground">
                  {t("optionPermanent")}
                </p>
              </button>
              <button
                type="button"
                aria-pressed={effectiveSelected === "temporary"}
                disabled={temporaryBlocked}
                onClick={() => setSelected("temporary")}
                className={cn(
                  "border p-3 text-left transition-colors disabled:opacity-40 disabled:pointer-events-none",
                  effectiveSelected === "temporary"
                    ? "border-jade bg-jade-wash"
                    : "border-border hover:border-border-strong",
                )}
              >
                <p className="text-sm font-medium text-foreground">
                  {t("optionTemporary", { hours: CONFIG.INVITE_TEMPORARY_TTL_HOURS })}
                </p>
              </button>
            </div>
            {/* One hint line for the SELECTED option only. When it is
                blocked the hint becomes the REASON, read from the `errors`
                namespace via `codeText` (D8 of the i18n plan) — the same
                sentence a failed create would show, so it exists in exactly
                one place. */}
            <p className="text-xs text-muted-foreground">
              {effectiveSelected === "permanent"
                ? permanentBlocked
                  ? codeText("invite-permanent-exists")
                  : t("permanentHint")
                : temporaryBlocked
                  ? codeText("invite-temp-cap", {
                      max: CONFIG.INVITE_MAX_LIVE_TEMPORARY_PER_TEAM,
                    })
                  : t("temporaryHint", {
                      hours: CONFIG.INVITE_TEMPORARY_TTL_HOURS,
                    })}
            </p>
            <button
              type="button"
              disabled={creating || selectedBlocked}
              onClick={() => void submitCreate()}
              className="cut-sm h-9 w-full px-5 text-xs font-semibold uppercase tracking-wide text-black bg-jade transition-[filter] motion-safe:hover:brightness-110 motion-safe:active:brightness-95 disabled:opacity-40 disabled:pointer-events-none"
            >
              {creating ? t("creating") : t("create")}
            </button>
            {createError && (
              <p className="text-xs text-negative">{createError}</p>
            )}
          </div>
        )}
      </div>
    </ModalShell>
  );
}

/**
 * One live link: kind, countdown, the read-only URL, Copy, and — when
 * `canRevokeInvite` says so (D5) — a revoke control that opens an inline
 * confirm copied from `team-settings-modal.tsx`'s `MemberRow` kick/ban block
 * (`:222-255`): the same sentence-then-`cut-danger`-Confirm-then-outline-
 * Cancel shape, because this codebase confirms every destructive action
 * inline and never invents a second pattern for a third one (D8's own
 * reasoning for why regenerate is two actions, not one).
 *
 * A component of its own, not inlined in the list above, for the same reason
 * `MemberRow` is one: `copied` and the confirm's `pending`/`error` are each
 * ONE row's business, and a single `useState` in the parent would make every
 * row's Copy button flip together.
 */
function LiveInviteRow({
  invite,
  origin,
  now,
}: {
  invite: TeamInvite;
  origin: string;
  now: number | null;
}) {
  const t = useTranslations("inviteModal");
  const locale = useLocale();
  const { canRevokeInvite, revokeInvite } = useTeam();
  const { show } = useToast();
  const { errorText } = useErrorText();
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const url = `${origin}/join/${invite.code}`;
  const isTemporary = invite.expiresAt !== null;
  // Same `now == null` stand-in as `bet-row.tsx`'s countdown: a dash rather
  // than a number until the real clock arrives, never a computed guess.
  const countdown =
    now == null || invite.expiresAt == null
      ? "—"
      : formatTimeLeft(locale, invite.expiresAt, now).label;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard API unavailable — same no-fallback-UI note the old modal
      // carried; nothing here is worse off for the rewrite.
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function confirmRevoke() {
    setPending(true);
    setError(null);
    const result = await revokeInvite(invite.id);
    setPending(false);
    if (result.ok) {
      // D3 (design-visual-identity.md §5.9): a completed revoke is
      // destructive, not a jade success — the same rail `MemberRow`'s
      // kick/ban toast uses, and unkeyed for the same reason: revoking one
      // link and revoking the next each deserve their own row.
      show({ kind: "destructive", text: t("revoked") });
      // The row itself disappears once `revokeInvite`'s own `reload()`
      // lands and this invite drops out of `team.invites` — nothing to
      // unmount here by hand.
    } else {
      setError(errorText(result));
    }
  }

  return (
    <li className="space-y-1.5 border border-border bg-surface-1 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {isTemporary ? t("kindTemporary") : t("kindPermanent")}
          </span>
          {isTemporary && (
            <span className="text-xs text-muted-foreground">
              {t("expiresIn", { time: countdown })}
            </span>
          )}
        </div>
        {canRevokeInvite(invite) && (
          <button
            type="button"
            onClick={() => setConfirming((v) => !v)}
            aria-label={t("revoke", { code: invite.code })}
            className={iconButtonClass}
          >
            <Link2Off className="size-3.5 text-ember" />
          </button>
        )}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          readOnly
          value={url}
          aria-label={t("linkLabel")}
          className="w-full border border-border bg-surface-1 px-3 py-2 font-mono text-xs tabular-nums text-foreground focus:border-jade focus:outline-none focus:ring-1 focus:ring-jade/40"
        />
        <button
          type="button"
          onClick={() => void copyLink()}
          className={cn(
            "shrink-0 border px-3 text-xs font-semibold uppercase tracking-wide transition-colors",
            copied
              ? "border-jade text-jade"
              : "border-border text-foreground hover:border-jade/50 hover:text-jade",
          )}
        >
          {copied ? t("copied") : t("copy")}
        </button>
      </div>

      {confirming && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-xs text-muted-foreground">
            {t("revokeConfirm")}
          </span>
          <button
            type="button"
            disabled={pending}
            onClick={() => void confirmRevoke()}
            className="cut-danger disabled:opacity-40 disabled:pointer-events-none h-8 bg-destructive px-3 text-xs font-semibold uppercase text-black transition-[filter] motion-safe:hover:brightness-110"
          >
            {t("confirmRevoke")}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="h-8 rounded-sm border border-border px-3 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {t("cancel")}
          </button>
        </div>
      )}

      {error && <p className="text-xs text-negative">{error}</p>}
    </li>
  );
}
