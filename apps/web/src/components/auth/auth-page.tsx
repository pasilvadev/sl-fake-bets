"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { SMark } from "@/components/sl/s-mark";
import { createClient } from "@/lib/supabase/client";
import { authCallbackUrl, safeNextPath } from "@/lib/auth-redirect";

/** Seconds before "Resend code" re-arms — a nudge, not a security control. */
const RESEND_COOLDOWN_SECONDS = 30;

/** UX-003: the lowest-friction check that still catches a typo'd address. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Pending = "none" | "google" | "request" | "verify" | "resend";

/**
 * Auth screen (roadmap Phase 4 — real Supabase sessions behind the Phase 1
 * visual design, design-visual-identity.md §9 checklist): a left-aligned
 * wordmark lockup over a hard-black hero, the brand slash as a compositional
 * divider (banned-list #10 — no centered blob), minimal-field card on the
 * right.
 *
 * Two flows, both real, both the lowest-friction option available (UX-003,
 * ARC-006): email OTP — a 6-digit CODE, not a magic link (decision §4.1, see
 * supabase/templates/magic_link.html for why) — and Google OAuth.
 *
 * The destination survives both. A logged-out visitor on a deep link is
 * rendered here by AuthGated at their own URL, so the current pathname IS the
 * destination unless an explicit `?next=` overrides it — the groundwork
 * UX-012's invite links spend in Phase 5.
 */
export function AuthPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createClient(), []);

  const destination = useMemo(() => {
    const explicit = searchParams.get("next");
    return explicit ? safeNextPath(explicit) : safeNextPath(pathname);
  }, [searchParams, pathname]);

  const [step, setStep] = useState<"landing" | "otp">("landing");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState<Pending>("none");
  const [notice, setNotice] = useState<string | null>(null);
  // Seeded once from the callback route's `?auth_error=` (a failed OAuth round
  // trip lands back here); every later value comes from an action below.
  const [error, setError] = useState<string | null>(() =>
    searchParams.get("auth_error"),
  );
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const sendCode = useCallback(
    async (kind: "request" | "resend") => {
      const address = email.trim();
      if (!EMAIL_SHAPE.test(address)) {
        setError("Enter a valid email address.");
        return;
      }

      setError(null);
      setNotice(null);
      setPending(kind);
      // No `emailRedirectTo`: the template renders {{ .Token }}, so there is
      // no link to come back through — the code is verified on this screen.
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: address,
        options: { shouldCreateUser: true },
      });
      setPending("none");

      if (otpError) {
        setError(otpError.message);
        return;
      }
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setStep("otp");
      if (kind === "resend") setNotice("New code sent.");
    },
    [email, supabase],
  );

  const verifyCode = useCallback(async () => {
    const token = code.trim();
    if (token.length === 0) {
      setError("Enter the code from your email.");
      return;
    }

    setError(null);
    setNotice(null);
    setPending("verify");
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token,
      type: "email",
    });

    if (verifyError) {
      setPending("none");
      setError(verifyError.message);
      return;
    }

    // The browser client has written the session cookies; AuthProvider's
    // listener swaps the tree over. `pending` stays set so the button cannot
    // be pressed twice during the navigation.
    router.replace(destination);
    router.refresh();
  }, [code, email, supabase, router, destination]);

  const signInWithGoogle = useCallback(async () => {
    setError(null);
    setNotice(null);
    setPending("google");
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: authCallbackUrl(window.location.origin, destination) },
    });
    // Success navigates away to Google, so this only runs on failure.
    if (oauthError) {
      setPending("none");
      setError(oauthError.message);
    }
  }, [supabase, destination]);

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
              pending={pending}
              error={error}
              onEmailChange={setEmail}
              onGoogle={signInWithGoogle}
              onContinue={() => sendCode("request")}
            />
          ) : (
            <OtpStep
              email={email}
              code={code}
              pending={pending}
              error={error}
              notice={notice}
              cooldown={cooldown}
              onCodeChange={setCode}
              onBack={() => {
                setError(null);
                setNotice(null);
                setStep("landing");
              }}
              onVerify={verifyCode}
              onResend={() => sendCode("resend")}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Inline feedback, per design-visual-identity.md §5: a validation error is
 * told by an ember ICON and an ember BORDER — body copy stays neutral, and
 * there is no red error text anywhere in this system. Success takes the jade
 * `/` glyph rather than a check mark, same rule from the other direction.
 */
function Message({ error, notice }: { error: string | null; notice?: string | null }) {
  if (error) {
    return (
      <p
        role="alert"
        className="flex items-start gap-2 border-l-2 border-ember-border bg-surface-2 px-3 py-2 text-xs text-foreground"
      >
        <AlertTriangle aria-hidden className="mt-px size-3.5 shrink-0 text-ember" />
        {error}
      </p>
    );
  }
  if (notice) {
    return (
      <p className="flex items-start gap-2 border-l-2 border-jade-border bg-surface-2 px-3 py-2 text-xs text-foreground">
        <span aria-hidden className="font-mono font-semibold text-jade">
          /
        </span>
        {notice}
      </p>
    );
  }
  return null;
}

function LandingStep({
  email,
  pending,
  error,
  onEmailChange,
  onGoogle,
  onContinue,
}: {
  email: string;
  pending: Pending;
  error: string | null;
  onEmailChange: (value: string) => void;
  onGoogle: () => void;
  onContinue: () => void;
}) {
  const busy = pending !== "none";

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        onContinue();
      }}
    >
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text-strong">Sign in to SL</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Bet fake coins with your friends on anything.
        </p>
      </div>

      <Button
        type="button"
        variant="outline"
        disabled={busy}
        onClick={onGoogle}
        className="h-10 w-full justify-center rounded-sm"
      >
        {pending === "google" ? "Redirecting…" : "Continue with Google"}
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
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            placeholder="you@example.com"
            className="h-10 rounded-sm border border-border bg-surface-1 px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-jade focus:ring-1 focus:ring-jade/40"
          />
        </div>

        <Message error={error} />

        <Button
          type="submit"
          disabled={busy}
          className="h-10 w-full cut-sm justify-center rounded-none font-semibold uppercase hover:bg-primary hover:brightness-110 active:brightness-95"
        >
          {pending === "request" ? "Sending code…" : "Continue with email"}
        </Button>
      </div>
    </form>
  );
}

function OtpStep({
  email,
  code,
  pending,
  error,
  notice,
  cooldown,
  onCodeChange,
  onBack,
  onVerify,
  onResend,
}: {
  email: string;
  code: string;
  pending: Pending;
  error: string | null;
  notice: string | null;
  cooldown: number;
  onCodeChange: (value: string) => void;
  onBack: () => void;
  onVerify: () => void;
  onResend: () => void;
}) {
  const busy = pending !== "none";

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        onVerify();
      }}
    >
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text-strong">Enter your code</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          We sent a code to {email || "your email"}.
        </p>
        {/*
          Dev only, and it earns its place: a 100% local stack (vision Phase 2)
          has no SMTP server — `supabase start` runs Mailpit, which CAPTURES
          every outgoing email instead of delivering it. Without this line the
          first reasonable conclusion is "email login is broken", because a
          real address genuinely never receives anything.
        */}
        {process.env.NODE_ENV === "development" && (
          <p className="mt-2 text-xs text-muted-foreground">
            Local stack — no mail leaves this machine. Read the code in{" "}
            <a
              href="http://127.0.0.1:54324"
              target="_blank"
              rel="noreferrer"
              className="text-jade underline-offset-2 hover:underline"
            >
              Mailpit
            </a>
            .
          </p>
        )}
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
          name="otp"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={6}
          value={code}
          // Digits only: pasting the code out of a mail client drags spaces in.
          onChange={(e) => onCodeChange(e.target.value.replace(/\D/g, ""))}
          placeholder="000000"
          className="h-12 w-full rounded-sm border border-border bg-surface-1 px-3 text-center font-mono text-2xl font-semibold tabular-nums text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-jade focus:ring-1 focus:ring-jade/40"
        />
      </div>

      <Message error={error} notice={notice} />

      <Button
        type="submit"
        disabled={busy}
        className="h-10 w-full cut-sm justify-center rounded-none font-semibold uppercase hover:bg-primary hover:brightness-110 active:brightness-95"
      >
        {pending === "verify" ? "Verifying…" : "Verify"}
      </Button>

      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={onBack}
          className="h-8 px-2 text-muted-foreground hover:bg-surface-3 hover:text-foreground"
        >
          Back
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={busy || cooldown > 0}
          onClick={onResend}
          className="h-8 px-2 text-muted-foreground hover:bg-surface-3 hover:text-foreground"
        >
          {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
        </Button>
      </div>
    </form>
  );
}
