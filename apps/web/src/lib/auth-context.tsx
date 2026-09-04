"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "sl:signed-in";

export interface AuthState {
  /** null until the client mounts and localStorage is read (hydration-safe). */
  signedIn: boolean | null;
  signIn: () => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * Fake auth (Phase 1, frontend-only, no backend): a boolean persisted in
 * localStorage. `signedIn` starts null so the first client render matches
 * the server render — resolved in an effect after mount to dodge hydration
 * mismatch and the logged-out flash (UX-011).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    // Reading a browser-only API post-mount, same idiom as use-now.ts —
    // needed to keep the server/first-client render null (no flash/mismatch).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSignedIn(window.localStorage.getItem(STORAGE_KEY) === "true");
  }, []);

  const signIn = useCallback(() => {
    window.localStorage.setItem(STORAGE_KEY, "true");
    setSignedIn(true);
  }, []);

  const signOut = useCallback(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    setSignedIn(false);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ signedIn, signIn, signOut }),
    [signedIn, signIn, signOut],
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
