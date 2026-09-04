"use client";

import { LogOut } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { UserAvatar } from "@/components/sl/user-avatar";
import { UserName } from "@/components/sl/user-name";
import { CoinAmount } from "@/components/sl/coin-amount";
import { useTeam } from "@/lib/team-context";
import { useModal } from "@/lib/modal-context";
import { useAuth } from "@/lib/auth-context";

const itemClass =
  "flex h-8 cursor-pointer items-center rounded-sm px-2 text-sm text-foreground outline-none transition-colors data-[highlighted]:bg-surface-3";

/**
 * Profile dropdown (design-dashboard.md §1.1): avatar trigger, current-user
 * header, then Edit profile / Team settings-or-info / (mobile) Invite /
 * Leave team / Language stub / Sign out.
 */
export function ProfileMenu() {
  const { currentUser, balance, canManage, canInvite } = useTeam();
  const { open } = useModal();
  const { signOut } = useAuth();

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="rounded-full outline-none focus-visible:ring-1 focus-visible:ring-jade/40"
        >
          <UserAvatar user={currentUser} size={28} ring />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 w-56 border border-border-strong bg-surface-2 p-1"
        >
          <div className="flex items-center gap-2 border-b border-border px-2 py-2.5">
            <UserAvatar user={currentUser} size={28} />
            <div className="min-w-0 flex-1">
              <UserName user={currentUser} badge className="text-sm" />
              <div>
                <CoinAmount amount={balance} className="text-xs text-muted-foreground" />
              </div>
            </div>
          </div>

          <DropdownMenu.Item className={itemClass} onSelect={() => open("profile")}>
            Edit profile
          </DropdownMenu.Item>

          <DropdownMenu.Item className={itemClass} onSelect={() => open("team-settings")}>
            {canManage ? "Team settings" : "Team info"}
          </DropdownMenu.Item>

          {canInvite && (
            <DropdownMenu.Item
              className={`${itemClass} md:hidden`}
              onSelect={() => open("invite")}
            >
              Invite friends
            </DropdownMenu.Item>
          )}

          <DropdownMenu.Separator className="my-1 h-px bg-border" />

          {/* Ordinary-destructive (§5.3): neutral text, ember icon only, ember-wash on hover/highlight. */}
          <DropdownMenu.Item
            title="Phase 1 — not wired"
            className="flex h-8 cursor-pointer items-center gap-2 rounded-sm px-2 text-sm text-foreground outline-none transition-colors data-[highlighted]:bg-ember-wash"
          >
            <LogOut className="size-3.5 text-ember" />
            Leave team
          </DropdownMenu.Item>

          <DropdownMenu.Item
            disabled
            className="flex h-8 items-center rounded-sm px-2 text-sm text-muted-foreground opacity-40 outline-none"
          >
            Language: English
          </DropdownMenu.Item>

          <DropdownMenu.Separator className="my-1 h-px bg-border" />

          <DropdownMenu.Item className={itemClass} onSelect={signOut}>
            Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
