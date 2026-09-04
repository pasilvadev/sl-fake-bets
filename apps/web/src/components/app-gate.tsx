"use client";

import { AuthProvider, useAuth } from "@/lib/auth-context";
import { AuthPage } from "@/components/auth/auth-page";
import { DashboardPage } from "@/components/dashboard-page";
import { SMark } from "@/components/sl/s-mark";

/**
 * Auth gate (fake auth, Phase 1): while `signedIn` is unresolved, render a
 * neutral splash instead of flashing the auth screen or the dashboard
 * (UX-011). Once resolved, hand off to AuthPage or DashboardPage — both sit
 * inside AuthProvider so ProfileMenu's sign-out can reach it.
 */
export function AppGate() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}

function Gate() {
  const { signedIn } = useAuth();

  if (signedIn === null) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background">
        <SMark className="size-8 text-foreground motion-safe:animate-pulse" />
      </div>
    );
  }

  return signedIn ? <DashboardPage /> : <AuthPage />;
}
