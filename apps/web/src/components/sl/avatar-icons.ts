import {
  Crown,
  Dice5,
  Flame,
  Ghost,
  Moon,
  Skull,
  Star,
  Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * The platform avatar set (UX-022) — one registry, because two places have to
 * agree about it: the profile modal's picker and `user-avatar.tsx`, which
 * renders whatever the picker stored. They used to agree only by coincidence
 * (the modal held its own list and the avatar component knew nothing about
 * icon ids at all, so every pick fell through to initials).
 *
 * The ids are also the values `app.default_avatar` hands a new account when
 * the OAuth provider gives no picture, so this list and that SQL array are the
 * same eight by design — a default the user cannot re-select in the picker
 * would be a dead end.
 */
export const AVATAR_ICONS: readonly { id: string; Icon: LucideIcon }[] = [
  { id: "icon-dice", Icon: Dice5 },
  { id: "icon-crown", Icon: Crown },
  { id: "icon-ghost", Icon: Ghost },
  { id: "icon-flame", Icon: Flame },
  { id: "icon-bolt", Icon: Zap },
  { id: "icon-star", Icon: Star },
  { id: "icon-skull", Icon: Skull },
  { id: "icon-moon", Icon: Moon },
];

const BY_ID = new Map(AVATAR_ICONS.map(({ id, Icon }) => [id, Icon]));

/**
 * The component for a stored avatar id, or undefined when the value is not one
 * of ours — an uploaded/provider URL, or a legacy id the picker never offered
 * (mock-data.ts still carries `icon-fish` and `icon-target`). Callers fall
 * back to initials, which is why an unknown id degrades instead of breaking.
 */
export function avatarIconFor(avatar: string): LucideIcon | undefined {
  return BY_ID.get(avatar);
}
