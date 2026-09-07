/**
 * Guards the two env vars every Supabase client needs (roadmap
 * plan-hosted-early-access.md Phase 1 task 3, D8's "a friendly throw when the
 * Supabase env vars are missing").
 *
 * `client.ts`, `server.ts` and `proxy.ts` all used to read
 * `process.env.NEXT_PUBLIC_SUPABASE_URL!` with a bare `!` assertion. That
 * compiles, but an unset value at runtime hands `createBrowserClient` /
 * `createServerClient` the literal string `"undefined"`, which `@supabase/ssr`
 * fails on deep inside its own URL parsing — a stack trace that means nothing
 * to whoever is staring at a fresh clone wondering why `pnpm dev` won't start.
 * This throws ONE sentence, at the one place both call sites already run
 * through, naming the exact variable and where to fix it.
 *
 * Thrown, not returned: every caller needs both values before it can do
 * anything else, so there is no partial-success shape worth modeling — an
 * exception here is exactly what the root `error.tsx` (task 6) exists to
 * catch in production, and what Next's own dev overlay renders plainly in
 * `next dev`.
 */
export interface SupabaseEnv {
  url: string;
  anonKey: string;
}

export function supabaseEnv(): SupabaseEnv {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL — see supabase/README.md §Hosted",
    );
  }

  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_ANON_KEY — see supabase/README.md §Hosted",
    );
  }

  return { url, anonKey };
}
