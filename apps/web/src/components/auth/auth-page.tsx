"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SMark } from "@/components/sl/s-mark";
import { useAuth } from "@/lib/auth-context";

/**
 * Fake auth screen (Phase 1, design-visual-identity.md §9 checklist): a
 * left-aligned wordmark lockup over a hard-black hero, the brand slash as a
 * compositional divider (banned-list #10 — no centered blob), minimal-field
 * card on the right. Every button is fake — Google and Verify sign in
 * immediately, nothing is validated, nothing is required.
 */
export function AuthPage() {
  const { signIn } = useAuth();
  const [step, setStep] = useState<"landing" | "otp">("landing");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");

  return (
    <div className="flex min-h-svh flex-col bg-background lg:flex-row">
      <div className="relative flex flex-1 items-end overflow-hidden p-8 lg:items-center lg:p-12">
        {/* The one sanctioned gradient in the system (§9 banned-list #3
            exception): monochrome black -> jade-at-1%, this hero only. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(135deg, transparent, color-mix(in oklch, var(--jade-base), transparent 99%))",
          }}
        />
        <div className="relative flex items-center gap-3">
          <SMark className="size-10 text-text-strong" />
          <span className="text-2xl font-semibold tracking-tight text-text-strong">SL</span>
        </div>
      </div>

      {/* Compositional divider — the brand slash (§9), not decoration. */}
      <div
        aria-hidden
        className="hidden w-px shrink-0 bg-border-strong lg:block"
        style={{ transform: "rotate(calc(90deg - var(--brand-slash-angle)))" }}
      />

      <div className="flex flex-1 items-center justify-center p-8 lg:p-12">
        <div className="w-full max-w-sm">
          {step === "landing" ? (
            <LandingStep
              email={email}
              onEmailChange={setEmail}
              onGoogle={signIn}
              onContinue={() => setStep("otp")}
            />
          ) : (
            <OtpStep
              email={email}
              code={code}
              onCodeChange={setCode}
              onBack={() => setStep("landing")}
              onVerify={signIn}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function LandingStep({
  email,
  onEmailChange,
  onGoogle,
  onContinue,
}: {
  email: string;
  onEmailChange: (value: string) => void;
  onGoogle: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text-strong">Sign in to SL</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Bet fake coins with your friends on anything.
        </p>
      </div>

      <Button
        type="button"
        variant="outline"
        onClick={onGoogle}
        className="h-10 w-full justify-center rounded-sm"
      >
        Continue with Google
      </Button>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        or
        <div className="h-px flex-1 bg-border" />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <label
            htmlFor="email"
            className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
          >
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            placeholder="you@example.com"
            className="h-10 rounded-sm border border-border bg-surface-1 px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-jade focus:ring-1 focus:ring-jade/40"
          />
        </div>

        <Button
          type="button"
          onClick={onContinue}
          className="h-10 w-full cut-sm justify-center rounded-none font-semibold uppercase hover:bg-primary hover:brightness-110 active:brightness-95"
        >
          Continue with email
        </Button>
      </div>
    </div>
  );
}

function OtpStep({
  email,
  code,
  onCodeChange,
  onBack,
  onVerify,
}: {
  email: string;
  code: string;
  onCodeChange: (value: string) => void;
  onBack: () => void;
  onVerify: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text-strong">Enter your code</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          We sent a code to {email || "your email"}.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <label
          htmlFor="otp"
          className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Verification code
        </label>
        <input
          id="otp"
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(e) => onCodeChange(e.target.value)}
          placeholder="000000"
          className="h-12 w-full rounded-sm border border-border bg-surface-1 px-3 text-center font-mono text-2xl font-semibold tabular-nums text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-jade focus:ring-1 focus:ring-jade/40"
        />
      </div>

      <Button
        type="button"
        onClick={onVerify}
        className="h-10 w-full cut-sm justify-center rounded-none font-semibold uppercase hover:bg-primary hover:brightness-110 active:brightness-95"
      >
        Verify
      </Button>

      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          onClick={onBack}
          className="h-8 px-2 text-muted-foreground hover:bg-surface-3 hover:text-foreground"
        >
          Back
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-8 px-2 text-muted-foreground hover:bg-surface-3 hover:text-foreground"
        >
          Resend code
        </Button>
      </div>
    </div>
  );
}
