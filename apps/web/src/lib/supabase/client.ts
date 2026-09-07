import { createBrowserClient } from "@supabase/ssr";
import { supabaseEnv } from "./env";

/**
 * Browser-side Supabase client (roadmap Phase 3, task 7).
 *
 * Since Phase 4 this is the app's auth surface (auth-page.tsx runs the
 * password and Google flows through it, auth-context.tsx listens for session
 * changes), and since Phase 5 it is also the data surface: team-context.tsx
 * reads the whole world through it and writes team/membership changes through
 * the RPCs in lib/data/. Bets and wagers still MUTATE in session-local state —
 * persisting those is Phase 6.
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
  const { url, anonKey } = supabaseEnv();
  return createBrowserClient(url, anonKey);
}
