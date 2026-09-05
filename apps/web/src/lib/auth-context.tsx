"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toSessionUser, type SessionUser } from "@/lib/session-user";

export interface AuthState {
  /**
   * null = not yet resolved. With the session read on the server and handed
   * down as `initialUser`, that state no longer occurs during a normal page
   * load — it is kept because AppGate must still render something safe for a
   * provider mounted without a server-resolved value.
   */
  signedIn: boolean | null;
  /** The auth identity (NOT the UX-022 profile — see session-user.ts). */
  user: SessionUser | null;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * Real Supabase auth (roadmap Phase 4), replacing the `sl:signed-in`
 * localStorage boolean of Phases 1–2.
 *
 * The session lives in cookies (that is the whole point of `@supabase/ssr`),
 * so unlike the fake auth it can be read during the server render. The root
 * layout does exactly that and passes the result in as `initialUser`, which
 * is what makes the first client render match the server one — the same
 * hydration-safety the null-until-mount pattern bought, minus the splash
 * frame that pattern forced on every visit (UX-011: returning users land on
 * their dashboard, not on a loading state).
 *
 * Session RENEWAL is not this component's job: `src/proxy.ts` refreshes the
 * token on every navigation, server-side, which is what actually delivers
 * ARC-007's "returning users rarely see a login screen".
 */
export function AuthProvider({
  initialUser,
  children,
}: {
  initialUser: SessionUser | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [user, setUser] = useState<SessionUser | null>(initialUser);

  // The identity the server tree was rendered for. Compared against, rather
  // than `user`, so the effect below can stay mounted once with no deps churn.
  const renderedUserId = useRef<string | null>(initialUser?.id ?? null);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const next = toSessionUser(session?.user);
      // TOKEN_REFRESHED fires on a timer for the same person; only an actual
      // change of identity is worth a re-render, and re-fetching the server
      // tree on every silent refresh would make the app flicker hourly.
      if ((next?.id ?? null) === renderedUserId.current) return;
      renderedUserId.current = next?.id ?? null;
      setUser(next);
      // Server Components rendered for the old identity (and the layout's own
      // session read) are now stale.
      router.refresh();
    });

    return () => subscription.unsubscribe();
  }, [supabase, router]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    // onAuthStateChange handles state + refresh; this only guarantees the user
    // is not left standing on a deep link they can no longer read (UX-011).
    router.replace("/");
  }, [supabase, router]);

  const value = useMemo<AuthState>(
    () => ({ signedIn: user !== null, user, signOut }),
    [user, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
