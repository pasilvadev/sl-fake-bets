"use client";

import { useState } from "react";
import { useErrorText } from "@/lib/use-error-text";
import { useTranslations } from "next-intl";
import { useModal } from "@/lib/modal-context";
import { useTeam } from "@/lib/team-context";
import { useToast } from "@/lib/toast-context";
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
  const { show } = useToast();
  const { errorText } = useErrorText();
  const t = useTranslations("leaveTeamModal");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    setError(null);
    // Captured before the await: leaving drops the membership, so the team is
    // gone from context by the time the promise resolves.
    const name = team.name;
    const result = await leaveTeam();
    setPending(false);
    if (result.ok) {
      close();
      // D3: leaving is one of the six destructive successes, so it takes the
      // ember rail. The store is above ModalRoot and above the TeamGate this
      // tears down, which is why the toast survives both (D1).
      show({ kind: "destructive", text: t("left", { team: name }) });
    } else setError(errorText(result));
  }

  return (
    <ModalShell
      eyebrow={t("eyebrow")}
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
              {t("stay")}
            </button>
            <button
              type="button"
              disabled={!canLeave || pending}
              onClick={() => void submit()}
              className="cut-danger h-9 flex-1 bg-destructive px-5 text-xs font-semibold uppercase tracking-wide text-black transition-[filter] motion-safe:hover:brightness-110 disabled:opacity-40 disabled:pointer-events-none"
            >
              {pending ? t("submitting") : t("submit")}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-foreground">
          {t("lead", { team: team.name })}
        </p>
        <ul className="space-y-1.5 text-xs text-muted-foreground">
          <li className="flex items-center gap-1.5">
            {t("balancePrefix")} <CoinAmount amount={balance} />{" "}
            {t("balanceSuffix")}
          </li>
          <li>{t("wagersPulled")}</li>
          <li>{t("historyKept")}</li>
        </ul>
        {!canLeave && (
          <p className="text-xs text-negative">
            {t("leaderNote")}
          </p>
        )}
      </div>
    </ModalShell>
  );
}
