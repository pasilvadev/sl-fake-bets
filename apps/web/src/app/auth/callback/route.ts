import { NextResponse, type NextRequest } from "next/server";
import type { MutationErrorCode } from "@repo/shared";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/auth-redirect";

/**
 * OAuth return leg (roadmap Phase 4, task 3).
 *
 * Google sends the browser back here with a one-time `code`; exchanging it is
 * what turns the provider round-trip into a Supabase session. It has to happen
 * server-side in a Route Handler because that is the only place `cookies()` is
 * writable — a Server Component could read the exchange result and then drop
 * it on the floor.
 *
 * The PKCE verifier the exchange needs was written as a cookie by
 * `createBrowserClient` when the flow started, which is why both halves must
 * stay on `@supabase/ssr`.
 *
 * `next` is carried through the provider round-trip and honored here (UX-012
 * groundwork); `safeNextPath` is what keeps it from becoming an open redirect.
 *
 * There is no OTP leg here on purpose, and since
 * plan-hosted-early-access.md D1 there is no OTP at all: the alpha signs
 * people in with a password or with Google and sends no email whatsoever, so
 * `code` below is always an OAuth authorization code. The dormant email flow
 * (decision §4.1) ships a CODE rather than a magic link — see
 * `supabase/templates/magic_link.html` — which is why even the full release
 * adds a verify step to the auth screen rather than a second leg here.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safeNextPath(searchParams.get("next"));

  /**
   * `auth_error` carries a `MutationErrorCode`, not a sentence (UX-027, D8).
   *
   * It used to carry English prose straight into `auth-page.tsx`'s error slot,
   * which made it the one remaining path by which text written outside
   * `messages/*.json` reached a screen. The page now translates the code.
   */
  const fail = (code: MutationErrorCode) => {
    // Errors go back to the auth screen rather than to a dead-end page: the
    // screen is rendered by AppGate at whatever route the user was heading
    // for, so the destination survives a failed attempt too.
    const url = new URL(next, origin);
    url.searchParams.set("auth_error", code);
    return NextResponse.redirect(url);
  };

  // Google can return a refusal instead of a code (consent denied, app not
  // authorized). It is logged rather than shown, for the same reason D9 logs
  // a Postgres exception: the text is whatever Google felt like sending, in
  // whatever language, and `access_denied` was never actionable prose anyway.
  const providerError =
    searchParams.get("error_description") ?? searchParams.get("error");
  if (providerError) {
    console.error("[auth/callback] provider refused:", providerError);
    return fail("sign-in-incomplete");
  }

  const code = searchParams.get("code");
  if (!code) return fail("sign-in-incomplete");

  // 8s: comfortably under every Vercel plan's default function timeout, so a
  // slow/hung Supabase↔Google round trip fails here — cleanly, as `error`,
  // per @supabase/auth-js's fetch wrapper turning an abort into an
  // AuthRetryableFetchError rather than throwing — instead of the platform
  // killing the function later and the browser only ever seeing a bare
  // aborted connection (a Google-login 499 for an existing user, root-caused
  // to this route having no bound on how long it would wait).
  const supabase = await createClient({ fetchTimeoutMs: 8_000 });
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    // Deliberately NOT surfaced verbatim. The common failure here is a missing
    // PKCE verifier — someone opened the callback in a different browser than
    // the one that started the flow — and Supabase's message for it is three
    // lines of SSR-framework advice aimed at the developer, not the person
    // staring at the screen. The detail goes to the server log instead.
    console.error("[auth/callback] code exchange failed:", error.message);
    return fail("sign-in-incomplete");
  }

  return NextResponse.redirect(new URL(next, origin));
}
