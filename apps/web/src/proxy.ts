import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Session refresh on every navigation (roadmap Phase 4, task 5 — ARC-007).
 *
 * `proxy.ts`, not `middleware.ts`: Next 16 deprecated and renamed that
 * convention (see node_modules/next/dist/docs/01-app/03-api-reference/
 * 03-file-conventions/proxy.md). Same runtime, same matcher, different name.
 *
 * Why it exists at all: ARC-007's "returning users rarely see a login screen"
 * is delivered by the REFRESH token, not by a long access token — the access
 * token deliberately stays at the 1-hour default (config.toml). Something has
 * to spend the refresh token before the server renders, or a returning visitor
 * arrives with an hour-old access token and the layout reads them as logged
 * out. That is this file. Supabase refresh tokens are single-use, so doing it
 * once per navigation here, before any route code runs, also keeps parallel
 * renders from racing each other for the same token.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          // The rotated tokens have to reach BOTH sides: the request, so this
          // navigation's server render sees the fresh session, and the
          // response, so the browser stores it for the next one.
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          // no-store/no-cache, supplied by the library: a cached response that
          // carries Set-Cookie hands one user's session to the next visitor.
          for (const [key, value] of Object.entries(headers ?? {})) {
            response.headers.set(key, value);
          }
        },
      },
    },
  );

  // Triggers the lazy init + refresh. The return value is deliberately unused;
  // the point is the cookie write above, not the claims.
  await supabase.auth.getClaims();

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except Next's own static output and image files. Auth cookies
     * are worth refreshing on page and API requests; spending a single-use
     * refresh token on a favicon request is not.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
