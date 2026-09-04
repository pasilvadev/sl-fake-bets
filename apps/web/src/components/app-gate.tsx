"use client";

import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";
import { AuthPage } from "@/components/auth/auth-page";
import { DashboardPage } from "@/components/dashboard-page";
import { SMark } from "@/components/sl/s-mark";

/**
 * Auth gate (fake auth, Phase 1): while `signedIn` is unresolved, render a
 * neutral splash instead of flashing the auth screen or the content (UX-011).
 * Providers live in the root layout (app-providers.tsx); this only gates.
 * Reused by every routed page — dashboard and bet detail — so children also
 * never render on the server (they mount only after signedIn resolves).
 */
export function AuthGated({ children }: { children: ReactNode }) {
  const { signedIn } = useAuth();

  if (signedIn === null) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background">
        <SMark className="size-8 text-foreground motion-safe:animate-pulse" />
      </div>
    );
  }

  return signedIn ? <>{children}</> : <AuthPage />;
}

export function AppGate() {
  return (
    <AuthGated>
      <DashboardPage />
    </AuthGated>
  );
}
