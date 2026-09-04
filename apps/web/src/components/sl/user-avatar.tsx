"use client";

import { cn } from "cn";
import type { User } from "@repo/shared";

/** True for values that look like a real image reference, not a mock icon id. */
function isImageSrc(avatar: string): boolean {
  return /^(https?:)?\//.test(avatar);
}

/**
 * Rounded-full user avatar. Renders `user.avatar` as an image when it looks
 * like a real URL; otherwise (Phase-1 mock icon ids) falls back to initials
 * on `bg-surface-3`. Optional 1px ring in the user's own name color.
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
