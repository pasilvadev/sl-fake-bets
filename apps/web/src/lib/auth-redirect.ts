import type { Route } from "next";

/**
 * `?next=` destination handling for the auth flows (roadmap Phase 4, task 3).
 *
 * This is the groundwork UX-012 builds on in Phase 5: a visitor who lands on
 * an invite or bet-share link while logged out must come back to that exact
 * destination after signing in, not to a generic landing page. Phase 4 makes
 * the parameter round-trip through both the OTP flow and the OAuth callback;
 * Phase 5 adds the `/join/[code]` route that spends it.
 */

/** Where a signed-in user goes when no destination was preserved (UX-011). */
export const DEFAULT_AUTH_DESTINATION = "/" satisfies Route;

/**
 * Reduce an untrusted `?next=` value to a same-origin path, or the default.
 *
 * `next` is attacker-controllable by construction — it is copied out of a URL
 * anyone can hand a user — so an unchecked value here is the textbook open
 * redirect: `?next=https://evil.example` would send a freshly authenticated
 * user off-site. Only path-absolute, single-slash values survive; `//host` and
 * `/\host` are rejected because browsers resolve both as protocol-relative
 * URLs to another origin.
 *
 * Returning `Route` is a deliberate assertion, and the only one in the auth
 * code: `typedRoutes` can prove a LITERAL href is a real route, and a value
 * that arrives at runtime from a query string is by definition not one. This
 * function is where that fact is acknowledged once, behind the same check
 * that makes the value safe at all — rather than at each call site.
 */
export function safeNextPath(raw: string | null | undefined): Route {
  if (!raw || !raw.startsWith("/")) return DEFAULT_AUTH_DESTINATION;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return DEFAULT_AUTH_DESTINATION;
  return raw as Route;
}

/**
 * The absolute URL an auth provider redirects back to. Must be in
 * `additional_redirect_urls` (supabase/config.toml) or Supabase rejects it —
 * both `localhost:3000` and `127.0.0.1:3000` are listed there because the two
 * spellings are NOT interchangeable to that allow-list.
 */
export function authCallbackUrl(origin: string, next: string): string {
  const url = new URL("/auth/callback", origin);
  url.searchParams.set("next", safeNextPath(next));
  return url.toString();
}
