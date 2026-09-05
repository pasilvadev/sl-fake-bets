import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client (roadmap Phase 3, task 7).
 *
 * Phase 3 wires the CONNECTION only. Nothing in the app reads from it yet: the
 * dashboard, team context and auth context all still run on Phase 1/2 in-memory
 * state, and rewiring them is Phases 4–8's work, one subsystem at a time.
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
