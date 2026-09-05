import type { User } from "@supabase/supabase-js";

/**
 * The slice of a Supabase auth identity the app actually carries around
 * (roadmap Phase 4).
 *
 * Deliberately NOT `types.ts`'s `User`: that is the UX-022 PROFILE (display
 * name, name color, avatar) and lives in `public.users`, while this is the
 * auth identity from `auth.users`. Since Phase 5 both are real Postgres rows,
 * which is exactly when keeping the shapes apart starts to matter: the id they
 * share is the only thing that ties them, and `useTeam().currentUser` — not
 * this — is what the UI renders.
 *
 * Defined in its own module because both a server module (supabase/server.ts)
 * and a client one (auth-context.tsx) need it; parking it in either would make
 * the other import across the server/client boundary for a type.
 */
export interface SessionUser {
  id: string;
  email: string | null;
}

export function toSessionUser(user: User | null | undefined): SessionUser | null {
  return user ? { id: user.id, email: user.email ?? null } : null;
}
