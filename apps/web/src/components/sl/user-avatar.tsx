"use client";

import { createElement, useState } from "react";
import { cn } from "cn";
import type { User } from "@repo/shared";
import { avatarIconFor } from "@/components/sl/avatar-icons";

/**
 * True for values that look like a real image reference, not a mock icon id.
 *
 * Narrower than the `^(https?:)?\/` it used to be: that also matched a bare
 * `"/"` and any root-relative path, which put the app's own HTML document into
 * an `<img src>` and drew the browser's broken-image glyph for a value that was
 * never a url. `users.avatar` has `check (length(btrim(avatar)) > 0)` and
 * nothing more, so "not empty" is the only guarantee the column carries — the
 * discrimination has to happen here.
 */
function isImageSrc(avatar: string): boolean {
  return /^(https?:\/\/|\/\/)\S/.test(avatar);
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
 *
 * **A url that fails to load falls back too.** It did not, and that was the
 * entire reported bug: the fallback this component documents was reachable
 * only for values that never looked like a url in the first place, so a Google
 * `picture` claim that 403s or 404s left the browser to draw its own
 * broken-image glyph where a face used to be. The avatar url is third-party and
 * outside our control — `app.default_avatar` stores whatever Google put in the
 * identity metadata, verbatim and forever (there is no login-time refresh) —
 * which makes "this url stopped resolving" a normal state to render, not an
 * exception.
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
  /**
   * WHICH src failed, not a boolean. The profile surfaces mutate `user.avatar`
   * under a mounted avatar (pick an icon, then upload a file, then pick
   * another), and a latched boolean would hold the fallback over the new value
   * too. Comparing against the src that failed re-arms the `<img>` for every
   * subsequent one, and still never retries a url already known to be dead.
   */
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  const initials = user.displayName.slice(0, 2).toUpperCase();
  const showImage = isImageSrc(user.avatar) && failedSrc !== user.avatar;
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
          // `lh3.googleusercontent.com` serves the profile pictures Phase 4
          // captures, and it refuses some of them when the request carries a
          // Referer naming another origin. A request that sends no Referer
          // cannot be refused for that reason, and nothing here wants one:
          // this is a decorative third-party image, not a navigation.
          referrerPolicy="no-referrer"
          // Everything the above cannot fix — a picture deleted on Google's
          // side, a rotated url, an avatars-bucket object wiped by a
          // `supabase db reset` — lands here and demotes to the icon/initials
          // branch below.
          onError={() => setFailedSrc(user.avatar)}
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
