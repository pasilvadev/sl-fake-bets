"use client";

import { useState } from "react";
import { useModal } from "@/lib/modal-context";
import { useTeam } from "@/lib/team-context";
import { ModalShell } from "@/components/sl/modal-shell";
import { CoinAmount } from "@/components/sl/coin-amount";

/**
 * Leaving is irreversible in the same way a kick is (DOM-032): the per-team
 * balance (DOM-013) and every active wager go with the membership, so it gets
 * real warning language and a confirm step rather than a one-click menu item.
 * No type-to-confirm — DOM-034 reserves that for hard deletes.
 */
export function LeaveTeamModal() {
  const { close } = useModal();
  const { team, balance, canLeave, leaveTeam } = useTeam();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    setError(null);
    const result = await leaveTeam();
    setPending(false);
    if (result.ok) close();
    else setError(result.error);
  }

  return (
    <ModalShell
      eyebrow="LEAVE TEAM"
      title={team.name}
      onClose={close}
      danger
      footer={
        <div className="space-y-2">
          {error && <p className="text-xs text-negative">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={close}
              className="h-9 flex-1 border border-border px-5 text-xs font-semibold uppercase tracking-wide text-foreground transition-colors hover:border-jade/50 hover:text-jade"
            >
              Stay
            </button>
            <button
              type="button"
              disabled={!canLeave || pending}
              onClick={() => void submit()}
              className="cut-danger h-9 flex-1 bg-destructive px-5 text-xs font-semibold uppercase tracking-wide text-black transition-[filter] motion-safe:hover:brightness-110 disabled:opacity-40 disabled:pointer-events-none"
            >
              {pending ? "Leaving…" : "Leave team"}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-foreground">
          Leaving drops your membership in {team.name} for good.
        </p>
        <ul className="space-y-1.5 text-xs text-muted-foreground">
          <li className="flex items-center gap-1.5">
            Your balance here — <CoinAmount amount={balance} /> — is deleted.
            Balances are per team.
          </li>
          <li>Your wagers on open and closed bets are pulled from their pools.</li>
          <li>Resolved bets keep their history. You can rejoin with the invite code.</li>
        </ul>
        {!canLeave && (
          <p className="text-xs text-negative">
            You lead this team — delete it instead, or hand it over once
            leadership transfer exists.
          </p>
        )}
      </div>
    </ModalShell>
  );
}
