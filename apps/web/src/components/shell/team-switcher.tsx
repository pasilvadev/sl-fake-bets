"use client";

import { useState } from "react";
import { useErrorText } from "@/lib/use-error-text";
import { ChevronDown } from "lucide-react";
import { Popover } from "radix-ui";
import { type Team } from "@repo/shared";
import { useTeam } from "@/lib/team-context";
import { useModal } from "@/lib/modal-context";

function TeamRow({
  team,
  openBetCount,
  active,
  onSelect,
}: {
  team: Team;
  openBetCount: number;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="relative flex h-10 w-full items-center gap-2 px-3 text-left transition-colors hover:bg-surface-3"
    >
      {/* 3px jade left rail on the active row — reuses the bet-row rail motif. */}
      {active && <span className="absolute inset-y-0 left-0 w-[3px] bg-jade" />}
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{team.name}</span>
      <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
        {openBetCount}
      </span>
      {/* Reserved slot for a future per-team notification pip (ARC-015).
          Intentionally empty in Phase 1 — renders nothing. */}
      <span className="size-1.5 shrink-0" />
    </button>
  );
}

/**
 * Team switcher (design-dashboard.md §1.1): Radix popover trigger showing the
 * current team, with rows for every team + create-team / join-with-code
 * footer actions.
 */
export function TeamSwitcher() {
  const { team, teams, setTeamId, openBetCountFor, joinTeamByCode } = useTeam();
  const { open } = useModal();
  const { errorText } = useErrorText();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  // UX-005/DOM-005: codes never expire; joinTeamByCode seeds the onboarding
  // grant (decision §4.2) and re-scopes the app to the joined team (UX-010).
  async function submitJoin(e: React.FormEvent) {
    e.preventDefault();
    setJoining(true);
    const result = await joinTeamByCode(joinCode);
    setJoining(false);
    if (result.ok) {
      setJoinCode("");
      setJoinError(null);
      setPopoverOpen(false);
    } else {
      setJoinError(errorText(result));
    }
  }

  return (
    <Popover.Root open={popoverOpen} onOpenChange={setPopoverOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="flex min-w-0 items-center gap-2 rounded-sm px-1.5 py-1 text-foreground transition-colors hover:bg-surface-2"
        >
          <span className="flex size-5 shrink-0 items-center justify-center rounded-sm bg-surface-2 text-[10px] font-semibold uppercase">
            {team.name.slice(0, 1)}
          </span>
          <span className="hidden max-w-40 truncate text-sm font-medium sm:inline">
            {team.name}
          </span>
          <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
            {team.members.length}
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-50 w-72 border border-border-strong bg-surface-2 p-0"
        >
          <div className="max-h-72 overflow-y-auto">
            {teams.map((t) => (
              <TeamRow
                key={t.id}
                team={t}
                openBetCount={openBetCountFor(t.id)}
                active={t.id === team.id}
                onSelect={() => {
                  setTeamId(t.id);
                  setPopoverOpen(false);
                }}
              />
            ))}
          </div>

          <div className="border-t border-border p-2">
            <button
              type="button"
              onClick={() => {
                open("create-team");
                setPopoverOpen(false);
              }}
              className="flex h-8 w-full items-center rounded-sm px-2 text-left text-sm text-foreground transition-colors hover:bg-surface-3"
            >
              Create a team
            </button>

            {/* Inline join-code form, one fewer hop than a modal. */}
            <form
              onSubmit={(e) => void submitJoin(e)}
              className="mt-2 flex items-center gap-1.5"
            >
              <input
                value={joinCode}
                onChange={(e) => {
                  setJoinCode(e.target.value);
                  setJoinError(null);
                }}
                placeholder="Invite code"
                className="h-7 min-w-0 flex-1 rounded-sm border border-border bg-surface-1 px-2 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-jade focus:outline-none focus:ring-1 focus:ring-jade/40"
              />
              <button
                type="submit"
                disabled={joining}
                className="h-7 shrink-0 rounded-sm px-2 text-xs text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
              >
                {joining ? "…" : "Join"}
              </button>
            </form>
            {joinError && (
              <p className="mt-1.5 px-0.5 text-[11px] text-negative">{joinError}</p>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
