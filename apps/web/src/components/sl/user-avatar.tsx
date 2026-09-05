"use client";

import { createElement } from "react";
import { cn } from "cn";
import type { User } from "@repo/shared";
import { avatarIconFor } from "@/components/sl/avatar-icons";

/** True for values that look like a real image reference, not a mock icon id. */
function isImageSrc(avatar: string): boolean {
  return /^(https?:)?\//.test(avatar);
}

/**
 * Rounded-full user avatar, resolving `user.avatar`'s three possible kinds in
 * order (types.ts): a URL — an uploaded image or an OAuth provider's picture —
 * renders as an image; one of the platform icon ids the profile modal offers
 * renders as that icon; anything else falls back to initials on
 * `bg-surface-3`. Optional 1px ring in the user's own name color.
 *
 * Initials used to catch the icon ids too, which meant the picker's eight
 * icons were selectable and then invisible everywhere. They are now the last
 * resort only: an id no longer in the set (mock-data.ts's `icon-fish` /
 * `icon-target`) still renders as something rather than nothing.
 */
export function UserAvatar({
  user,
  size = 24,
  ring = false,
  className,
}: {
  user: User;
  size?: number;
  ring?: boolean;
  className?: string;
}) {
  const initials = user.displayName.slice(0, 2).toUpperCase();
  const showImage = isImageSrc(user.avatar);
  // Lowercase, and rendered through createElement rather than as `<Icon />`:
  // a capitalized binding assigned during render reads to the React compiler
  // as a component being DEFINED here, which is the one thing this is not.
  const icon = showImage ? undefined : avatarIconFor(user.avatar);

  return (
    <div
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-3 text-foreground",
        className,
      )}
      style={{
        width: size,
        height: size,
        border: ring ? `1px solid ${user.nameColor}` : undefined,
      }}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- avatar src may be an arbitrary uploaded URL
        <img
          src={user.avatar}
          alt=""
          className="h-full w-full object-cover"
        />
      ) : icon ? (
        // Sized off `size` rather than a fixed class: the same component
        // renders at 16px in a byline and 28px in the profile preview, and a
        // glyph that does not scale with the circle reads as a mistake at one
        // end or the other.
        createElement(icon, {
          "aria-hidden": true,
          strokeWidth: 1.75,
          style: { width: size * 0.58, height: size * 0.58 },
        })
      ) : (
        <span
          className="select-none font-medium leading-none"
          style={{ fontSize: Math.max(9, size * 0.4) }}
        >
          {initials}
        </span>
      )}
    </div>
  );
}
