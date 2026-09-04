"use client";

import { useModal } from "@/lib/modal-context";
import { WagerModal } from "./wager-modal";
import { CreateBetModal } from "./create-bet-modal";
import { InviteModal } from "./invite-modal";
import { StandingsFullModal } from "./standings-full-modal";
import { TransactionsModal } from "./transactions-modal";
import { ProfileModal } from "./profile-modal";
import { TeamSettingsModal } from "./team-settings-modal";
import { CreateTeamModal } from "./create-team-modal";
import { LeaveTeamModal } from "./leave-team-modal";

/** Single modal mount point — reads the active modal id and renders it. */
export function ModalRoot() {
  const { active } = useModal();

  if (!active) return null;

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
    default:
      return null;
  }
}
