import { NextResponse, type NextRequest } from "next/server";
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
 * There is no OTP leg here on purpose: the email template ships a CODE
 * (decision §4.1), which auth-page.tsx verifies in place — there is no link to
 * land on.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safeNextPath(searchParams.get("next"));

  const fail = (reason: string) => {
    // Errors go back to the auth screen rather than to a dead-end page: the
    // screen is rendered by AppGate at whatever route the user was heading
    // for, so the destination survives a failed attempt too.
    const url = new URL(next, origin);
    url.searchParams.set("auth_error", reason);
    return NextResponse.redirect(url);
  };

  // Google can return a refusal instead of a code (consent denied, app not
  // authorized). Its message is the only useful thing the user can act on.
  const providerError =
    searchParams.get("error_description") ?? searchParams.get("error");
  if (providerError) return fail(providerError);

  const code = searchParams.get("code");
  if (!code) return fail("That sign-in didn't complete. Try again.");

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    // Deliberately NOT surfaced verbatim. The common failure here is a missing
    // PKCE verifier — someone opened the callback in a different browser than
    // the one that started the flow — and Supabase's message for it is three
    // lines of SSR-framework advice aimed at the developer, not the person
    // staring at the screen. The detail goes to the server log instead.
    console.error("[auth/callback] code exchange failed:", error.message);
    return fail("That sign-in didn't complete. Try again.");
  }

  return NextResponse.redirect(new URL(next, origin));
}
