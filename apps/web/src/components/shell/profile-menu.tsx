"use client";

import { LogOut } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useTranslations } from "next-intl";
import { UserAvatar } from "@/components/sl/user-avatar";
import { UserName } from "@/components/sl/user-name";
import { CoinAmount } from "@/components/sl/coin-amount";
import { useTeam } from "@/lib/team-context";
import { useModal } from "@/lib/modal-context";
import { useAuth } from "@/lib/auth-context";
import { buildTag } from "@/lib/build-info";
import { LocaleSubmenu } from "./locale-switcher";

const itemClass =
  "flex h-8 cursor-pointer items-center rounded-sm px-2 text-sm text-foreground outline-none transition-colors data-[highlighted]:bg-surface-3";

/**
 * Profile dropdown (design-dashboard.md §1.1): avatar trigger, current-user
 * header, then Edit profile / Team settings-or-info / (mobile) Invite /
 * Leave team / Language / Sign out.
 *
 * The Language row stopped being a stub in i18n Phase 1 (UX-027, D12): it is
 * now a submenu with one radio item per locale, and it disappears entirely
 * rather than greying out when `locale-pt-br` is off. Its position in the
 * order is unchanged.
 */
export function ProfileMenu() {
  const { currentUser, balance, canManage, canInvite } = useTeam();
  const { open } = useModal();
  const { signOut } = useAuth();
  const t = useTranslations("profileMenu");
  const tag = buildTag();

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
            {t("editProfile")}
          </DropdownMenu.Item>

          <DropdownMenu.Item className={itemClass} onSelect={() => open("team-settings")}>
            {canManage ? t("teamSettings") : t("teamInfo")}
          </DropdownMenu.Item>

          {canInvite && (
            <DropdownMenu.Item
              className={`${itemClass} md:hidden`}
              onSelect={() => open("invite")}
            >
              {t("inviteFriends")}
            </DropdownMenu.Item>
          )}

          <DropdownMenu.Separator className="my-1 h-px bg-border" />

          {/* Ordinary-destructive (§5.3): neutral text, ember icon only, ember-wash on hover/highlight. */}
          <DropdownMenu.Item
            onSelect={() => open("leave-team")}
            className="flex h-8 cursor-pointer items-center gap-2 rounded-sm px-2 text-sm text-foreground outline-none transition-colors data-[highlighted]:bg-ember-wash"
          >
            <LogOut className="size-3.5 text-ember" />
            {t("leaveTeam")}
          </DropdownMenu.Item>

          <LocaleSubmenu triggerClassName={itemClass} />

          <DropdownMenu.Separator className="my-1 h-px bg-border" />

          <DropdownMenu.Item
            className={itemClass}
            // signOut is async since Phase 4 (it clears the Supabase session);
            // Radix's onSelect wants a void handler.
            onSelect={() => void signOut()}
          >
            {t("signOut")}
          </DropdownMenu.Item>

          {/* The build tag (plan-hosted-early-access.md D8): a footer row, not
              an alpha banner — absent entirely on a local build (buildTag()
              returns ""), present as a short mono SHA on Vercel. */}
          {tag && (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-border" />
              <div className="px-2 py-1.5 font-mono text-[10px] text-muted-foreground">
                {tag}
              </div>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
