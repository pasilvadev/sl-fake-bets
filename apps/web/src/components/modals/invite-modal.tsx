"use client";

import { useState } from "react";
import { cn } from "cn";
import { useModal } from "@/lib/modal-context";
import { useTeam } from "@/lib/team-context";
import { useTranslations } from "next-intl";
import { ModalShell } from "@/components/sl/modal-shell";
import { SMark } from "@/components/sl/s-mark";

/**
 * UX-023: invite-friends modal — preview card + copyable link.
 *
 * The link is real since roadmap Phase 5: it carries the team's active
 * `invite_codes` row and points at `/join/[code]`, the route that spends it
 * (UX-012). Codes never expire (UX-005/DOM-005); revoke/regenerate is open
 * decision #6.
 *
 * The origin comes from `window` — a hardcoded host would hand a teammate a
 * link to somebody else's machine. Safe to read during render: ModalRoot only
 * mounts a modal in response to a click, so this component never renders on
 * the server. The guard is there for the type, not for a real code path.
 */
export function InviteModal() {
  const t = useTranslations("inviteModal");
  const { close } = useModal();
  const { team, bets } = useTeam();
  const [copied, setCopied] = useState(false);
  const [origin] = useState(() =>
    typeof window === "undefined" ? "" : window.location.origin,
  );

  const openCount = bets.filter((b) => b.state === "open").length;
  const inviteUrl = `${origin}/join/${team.inviteCode}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
    } catch {
      // clipboard API unavailable — Phase 1 has no fallback UI for this.
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <ModalShell
      eyebrow={t("eyebrow")}
      title={team.name}
      onClose={close}
      footer={
        <p className="text-[11px] text-muted-foreground">
          Revoke/regenerate — future.
        </p>
      }
    >
      <div className="space-y-4">
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

        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("linkLabel")}
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              readOnly
              value={inviteUrl}
              className="w-full border border-border bg-surface-1 px-3 py-2 font-mono text-xs tabular-nums text-foreground focus:border-jade focus:outline-none focus:ring-1 focus:ring-jade/40"
            />
            <button
              type="button"
              onClick={copyLink}
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
          <p className="text-xs text-muted-foreground">{t("neverExpires")}</p>
        </div>
      </div>
    </ModalShell>
  );
}
