import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client (roadmap Phase 3, task 7).
 *
 * Since Phase 4 this is the app's auth surface: auth-page.tsx runs the OTP and
 * Google flows through it and auth-context.tsx listens for session changes.
 * Everything else — dashboard, team context, bets — still runs on Phase 1/2
 * in-memory state; rewiring those is Phases 5–8's work, one subsystem at a
 * time.
 *
 * `createBrowserClient` specifically, not supabase-js's `createClient`: it
 * persists the session (and the PKCE verifier the OAuth callback route needs)
 * in COOKIES rather than localStorage, which is the only reason the server can
 * read the same session the browser wrote.
 *
 * Both values are public by design — the anon key is a client-side credential
 * whose whole security model is Row Level Security, which is why Phase 3 wrote
 * the policies before anything could call this.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
