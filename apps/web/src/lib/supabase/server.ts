import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server-side Supabase client (roadmap Phase 3, task 7).
 *
 * Reads the session from cookies so Server Components run as the signed-in
 * user and RLS applies to them exactly as it does in the browser. Must be
 * created per request — never hoisted to a module-level singleton, which would
 * leak one user's session into another's render.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot set cookies. Harmless here: token
            // refresh is the middleware's job once Phase 4 adds it.
          }
        },
      },
    },
  );
}

export interface SmokeTestResult {
  ok: boolean;
  flagCount: number;
  error?: string;
}

/**
 * The one read-only query Phase 3 ships, to prove the app can reach the local
 * stack before any feature depends on it.
 *
 * It reads `feature_flags` specifically. Every domain table is gated by team
 * membership, so a signed-out smoke test against one of those cannot tell
 * "the connection is broken" apart from "RLS correctly returned nothing".
 * feature_flags is the single table whose SELECT policy grants `anon` (ARC-016
 * needs the app to read flags before login), so a non-empty result here proves
 * three things at once: the URL and key are right, PostgREST is up, and RLS is
 * being applied rather than bypassed.
 */
export async function smokeTest(): Promise<SmokeTestResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("feature_flags").select("key");

  if (error) return { ok: false, flagCount: 0, error: error.message };
  return { ok: true, flagCount: data.length };
}
