/**
 * Uniform mutator outcome — modals surface `error` as the visible reason.
 *
 * Its own module since roadmap Phase 5: both the Supabase write layer
 * (team-mutations.ts) and team-context.tsx speak in it, and the context
 * imports the write layer, so the type cannot live in either.
 */
export type MutationResult = { ok: true } | { ok: false; error: string };

export const ok: MutationResult = { ok: true };

export function fail(error: string): MutationResult {
  return { ok: false, error };
}
