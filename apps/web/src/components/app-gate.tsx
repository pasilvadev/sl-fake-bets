"use client";

import { Suspense, type ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";
import { AuthPage } from "@/components/auth/auth-page";
import { DashboardPage } from "@/components/dashboard-page";
import { TeamGate } from "@/components/team-gate";
import { SMark } from "@/components/sl/s-mark";

function Splash() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background">
      <SMark className="size-8 text-foreground motion-safe:animate-pulse" />
    </div>
  );
}

/**
 * Auth gate (real Supabase session since roadmap Phase 4). `signedIn` is
 * resolved before the first render — the root layout reads the session cookie
 * server-side — so the splash below is a fallback, not the normal path it was
 * under the localStorage fake auth.
 *
 * Providers live in the root layout (app-providers.tsx); this only gates.
 * Reused by every routed page — dashboard and bet detail — which is what makes
 * a logged-out visitor on a deep link (UX-012) see the auth screen at their
 * destination's URL rather than at a generic landing page.
 *
 * AuthPage sits behind Suspense because it reads `?next=` / `?auth_error=` via
 * useSearchParams, which Next requires a boundary for.
 */
export function AuthGated({ children }: { children: ReactNode }) {
  const { signedIn } = useAuth();

  if (signedIn === null) return <Splash />;

  return signedIn ? (
    <>{children}</>
  ) : (
    <Suspense fallback={<Splash />}>
      <AuthPage />
    </Suspense>
  );
}

/**
 * The dashboard's two gates, in the only order they work in: identity first
 * (Phase 4), then the team world that identity owns (Phase 5). TeamGate is
 * what makes `useTeam()` safe for everything below it.
 */
export function AppGate() {
  return (
    <AuthGated>
      <TeamGate>
        <DashboardPage />
      </TeamGate>
    </AuthGated>
  );
}
