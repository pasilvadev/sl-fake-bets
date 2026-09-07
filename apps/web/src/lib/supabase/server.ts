import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { SessionUser } from "@/lib/session-user";
import { supabaseEnv } from "./env";

/**
 * Server-side Supabase client (Phase 3, task 7; carrying the session since
 * Phase 4).
 *
 * Reads the session from cookies so Server Components run as the signed-in
 * user and RLS applies to them exactly as it does in the browser. Must be
 * created per request — never hoisted to a module-level singleton, which would
 * leak one user's session into another's render.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = supabaseEnv();

  return createServerClient(
    url,
    anonKey,
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
            // Server Components cannot set cookies — only Route Handlers and
            // Server Actions can. Harmless: token refresh is src/proxy.ts's
            // job, and the auth callback route is where a write actually has
            // to land.
          }
        },
      },
    },
  );
}

/**
 * The signed-in identity for the current request, or null (roadmap Phase 4).
 *
 * `getClaims()` rather than `getUser()`: it is the call `@supabase/ssr`
 * documents for triggering lazy session init, and it answers the only
 * question the root layout asks — who is this request for — without a
 * round-trip per render once the local stack signs asymmetrically. The token
 * it reads has already been refreshed by src/proxy.ts for this navigation.
 */
export async function getSessionUser(
  client?: SupabaseClient,
): Promise<SessionUser | null> {
  // The root layout also reads feature flags on the same request (Phase 9), so
  // it passes its client in rather than making a second one per render.
  const supabase = client ?? (await createClient());
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims?.sub) return null;
  const { sub, email } = data.claims;
  return { id: sub, email: typeof email === "string" ? email : null };
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
