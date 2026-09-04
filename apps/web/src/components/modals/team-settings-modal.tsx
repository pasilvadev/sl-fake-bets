"use client";

import { useState } from "react";
import { cn } from "cn";
import { Ban, UserX } from "lucide-react";
import type { TeamAccessMode, TeamMember } from "@repo/shared";
import { useModal } from "@/lib/modal-context";
import { useTeam } from "@/lib/team-context";
import { ModalShell } from "@/components/sl/modal-shell";
import { UserAvatar } from "@/components/sl/user-avatar";
import { UserName } from "@/components/sl/user-name";
import { CoinAmount } from "@/components/sl/coin-amount";

type RowAction = "kick" | "ban" | "inject";

/**
 * Destructive ordinary trigger (§5.3): neutral surface, ember icon only, the
 * label itself never ember.
 */
const iconButtonClass =
  "p-1.5 text-foreground transition-colors hover:bg-ember-wash";

/** DOM-002 access-mode switch — jade = on, N4 track = off, never a red "off". */
function AccessModeToggle({
  accessMode,
  editable,
  onChange,
}: {
  accessMode: TeamAccessMode;
  editable: boolean;
  onChange: (next: TeamAccessMode) => void;
}) {
  const freeForAll = accessMode === "free-for-all";

  return (
    <div className="flex items-center justify-between border border-border p-3">
      <div>
        <p className="text-sm text-foreground">Free-for-all</p>
        <p className="text-xs text-muted-foreground">
          {freeForAll
            ? "Anyone can create bets & invite."
            : "Only mods & the leader can create bets & invite."}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={freeForAll}
        aria-label="Free-for-all access mode"
        disabled={!editable}
        onClick={() => onChange(freeForAll ? "restricted" : "free-for-all")}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center transition-colors",
          freeForAll ? "bg-jade" : "bg-input",
          editable
            ? "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-jade/40"
            : "opacity-60 pointer-events-none",
        )}
      >
        <span
          className={cn(
            "absolute size-3.5 rounded-full bg-surface-2 transition-transform",
            freeForAll ? "translate-x-4" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}

/**
 * One roster row. Moderation controls (DOM-031) confirm inline before firing,
 * and the leader-only Inject (DOM-024) opens an amount field in place rather
 * than a second modal.
 */
function MemberRow({ member }: { member: TeamMember }) {
  const { team, canManage, canInject, userById, kickMember, banMember, injectCoins } =
    useTeam();
  const [action, setAction] = useState<RowAction | null>(null);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  const user = userById(member.userId);
  if (!user) return null;

  const isTeamLeader = member.userId === team.leaderId;
  const roleLabel = isTeamLeader
    ? "LEADER"
    : member.role === "moderator"
      ? "MOD"
      : "—";
  // The leader can't be kicked, banned, or removed at all (DOM-001).
  const showActions = canManage && !isTeamLeader;

  function reset() {
    setAction(null);
    setAmount("");
    setError(null);
  }

  function run(result: { ok: true } | { ok: false; error: string }) {
    if (result.ok) reset();
    else setError(result.error);
  }

  return (
    <li className="border-b border-border py-2.5">
      <div className="flex items-center gap-3">
        <UserAvatar user={user} size={28} />
        <div className="min-w-0 flex-1">
          <UserName user={user} badge />
        </div>
        <span className="w-12 shrink-0 text-[11px] font-semibold uppercase text-muted-foreground">
          {roleLabel}
        </span>
        <CoinAmount amount={member.coinBalance} className="text-sm" />
        {showActions && (
          <div className="flex shrink-0 items-center gap-1">
            {canInject && (
              <button
                type="button"
                onClick={() => setAction(action === "inject" ? null : "inject")}
                className="px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground"
              >
                Inject
              </button>
            )}
            <button
              type="button"
              onClick={() => setAction(action === "kick" ? null : "kick")}
              aria-label={`Kick ${user.displayName}`}
              className={iconButtonClass}
            >
              <UserX className="size-3.5 text-ember" />
            </button>
            <button
              type="button"
              onClick={() => setAction(action === "ban" ? null : "ban")}
              aria-label={`Ban ${user.displayName}`}
              className={iconButtonClass}
            >
              <Ban className="size-3.5 text-ember" />
            </button>
          </div>
        )}
      </div>

      {action === "inject" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(injectCoins(member.userId, Number(amount)));
          }}
          className="mt-2 flex items-center gap-2 pl-10"
        >
          <input
            type="number"
            min={1}
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Amount"
            className="h-8 w-28 border border-border bg-surface-1 px-2 font-mono text-xs tabular-nums text-foreground placeholder:text-muted-foreground/60 focus:border-jade focus:outline-none focus:ring-1 focus:ring-jade/40"
          />
          <button
            type="submit"
            className="h-8 rounded-sm bg-jade px-3 text-xs font-semibold uppercase text-black transition-[filter] motion-safe:hover:brightness-110"
          >
            Inject
          </button>
          <button
            type="button"
            onClick={reset}
            className="h-8 px-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Cancel
          </button>
        </form>
      )}

      {(action === "kick" || action === "ban") && (
        <div className="mt-2 flex flex-wrap items-center gap-2 pl-10">
          <span className="text-xs text-muted-foreground">
            {action === "kick"
              ? `Kick ${user.displayName}? Their balance and active wagers go with them.`
              : `Ban ${user.displayName}? Same as a kick, and the invite link stops working for them.`}
          </span>
          <button
            type="button"
            onClick={() =>
              run(
                action === "kick"
                  ? kickMember(member.userId)
                  : banMember(member.userId),
              )
            }
            className="cut-danger h-8 bg-destructive px-3 text-xs font-semibold uppercase text-black transition-[filter] motion-safe:hover:brightness-110"
          >
            Confirm {action}
          </button>
          <button
            type="button"
            onClick={reset}
            className="h-8 rounded-sm border border-border px-3 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      )}

      {error && <p className="mt-1.5 pl-10 text-xs text-negative">{error}</p>}
    </li>
  );
}

/** DOM-033/034: hard delete behind an exact-name type-to-confirm gate. */
function DeleteTeamPanel() {
  const { close } = useModal();
  const { team, deleteTeam } = useTeam();
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const matches = confirmText === team.name;

  function submit() {
    const result = deleteTeam();
    if (result.ok) close();
    else setError(result.error);
  }

  return (
    <div className="space-y-2 rounded-sm border border-ember-border p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Danger zone
      </p>
      <p className="text-sm text-foreground">Delete team</p>
      <p
        className={cn(
          "text-xs text-muted-foreground transition-opacity",
          matches && "opacity-0",
        )}
      >
        Permanent. Every bet, wager, balance and history row goes with it.
      </p>
      <input
        type="text"
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        placeholder={`Type "${team.name}" to confirm`}
        className={cn(
          "w-full border bg-surface-1 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none",
          matches ? "border-jade" : "border-border",
        )}
      />
      <button
        type="button"
        disabled={!matches}
        onClick={submit}
        className="cut-danger h-9 w-full px-5 text-xs font-semibold uppercase tracking-wide text-black bg-destructive opacity-40 pointer-events-none transition-opacity enabled:opacity-100 enabled:pointer-events-auto"
      >
        Delete team
      </button>
      {error && <p className="text-xs text-negative">{error}</p>}
    </div>
  );
}

/** DOM-002/024/031/033/034: team settings — full for leader/mod, read-only for members. */
export function TeamSettingsModal() {
  const { close } = useModal();
  const { team, isLeader, canManage, canDelete, updateTeamSettings } = useTeam();
  const [settingsError, setSettingsError] = useState<string | null>(null);

  function changeAccessMode(accessMode: TeamAccessMode) {
    const result = updateTeamSettings({ accessMode });
    setSettingsError(result.ok ? null : result.error);
  }

  return (
    <ModalShell
      eyebrow="TEAM"
      title={team.name}
      onClose={close}
      danger={canDelete}
      footer={
        !canManage ? undefined : (
          <p className="text-[11px] text-muted-foreground">
            {isLeader ? "Leader controls" : "Moderator controls"} — changes apply
            immediately.
          </p>
        )
      }
    >
      <div className="space-y-6">
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Access mode
          </p>
          <AccessModeToggle
            accessMode={team.accessMode}
            editable={canManage}
            onChange={changeAccessMode}
          />
          {settingsError && (
            <p className="text-xs text-negative">{settingsError}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Roster ({team.members.length})
          </p>
          <ul>
            {team.members.map((member) => (
              <MemberRow key={member.userId} member={member} />
            ))}
          </ul>
        </div>

        {canDelete && <DeleteTeamPanel />}
      </div>
    </ModalShell>
  );
}
