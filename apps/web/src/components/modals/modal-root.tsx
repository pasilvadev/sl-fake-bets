"use client";

import { useModal } from "@/lib/modal-context";
import { useTeamSession } from "@/lib/team-context";
import { useFeatureFlag } from "@/lib/feature-flags";
import { WagerModal } from "./wager-modal";
import { CreateBetModal } from "./create-bet-modal";
import { InviteModal } from "./invite-modal";
import { StandingsFullModal } from "./standings-full-modal";
import { TransactionsModal } from "./transactions-modal";
import { ProfileModal } from "./profile-modal";
import { TeamSettingsModal } from "./team-settings-modal";
import { CreateTeamModal } from "./create-team-modal";
import { LeaveTeamModal } from "./leave-team-modal";
import { ChatModal } from "./chat-modal";
import { StartDuelModal } from "./start-duel-modal";
import { DuelAcceptModal } from "./duel-accept-modal";

/**
 * Single modal mount point — reads the active modal id and renders it.
 *
 * Mounted in app-providers.tsx, beside the routed page rather than inside its
 * TeamGate, because modals are route-independent (UX-014/016). That placement
 * means it can survive the disappearance of the last team: leaving or deleting
 * one from inside a modal empties the roster a frame before the modal itself
 * closes, and every modal below calls `useTeam()`. Standing down when there is
 * no team is what keeps that ordinary sequence from throwing.
 *
 * The `duel-bets` kill switch (ARC-016) is read here rather than only at the
 * two entry points, because a modal is route-independent: flipping the flag
 * off must close the door, not just hide the handle. It gates the UI and only
 * the UI — `app.expire_stale_duels`, `app.void_duel` and `resolve_bet` go on
 * refunding underneath a hidden surface, because a flag that could strand
 * coins would be a leak rather than a kill switch.
 */
export function ModalRoot() {
  const { active } = useModal();
  const { teams } = useTeamSession();
  const duelsEnabled = useFeatureFlag("duel-bets");

  if (!active || teams.length === 0) return null;

  switch (active.id) {
    case "wager":
      return <WagerModal betId={active.payload as string} />;
    case "create-bet":
      return <CreateBetModal />;
    case "invite":
      return <InviteModal />;
    case "standings-full":
      return <StandingsFullModal />;
    case "transactions":
      return <TransactionsModal />;
    case "profile":
      return <ProfileModal />;
    case "team-settings":
      return <TeamSettingsModal />;
    case "create-team":
      return <CreateTeamModal />;
    case "leave-team":
      return <LeaveTeamModal />;
    case "chat":
      return <ChatModal />;
    case "start-duel":
      return duelsEnabled ? <StartDuelModal /> : null;
    case "duel-accept":
      return duelsEnabled ? (
        <DuelAcceptModal betId={active.payload as string} />
      ) : null;
    default:
      return null;
  }
}
