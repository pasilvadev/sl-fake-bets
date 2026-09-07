"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { SMark } from "@/components/sl/s-mark";
import { SITE_NAME } from "@/lib/site";
import type { MutationErrorCode } from "@repo/shared";
import { createClient } from "@/lib/supabase/client";
import { useErrorText } from "@/lib/use-error-text";
import { useTranslations } from "next-intl";
import { LocaleTextSwitcher } from "@/components/shell/locale-switcher";
import { authCallbackUrl, safeNextPath } from "@/lib/auth-redirect";
import { useOnboardingStep } from "@/components/onboarding/steps";

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
  // Onboarding's first step (UX-028, roadmap Phase 7.5) — see
  // `components/onboarding/steps.ts` for why the marker is here and what
  // Phase 9 does with it.
  useOnboardingStep("signup");

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createClient(), []);
  const { codeText } = useErrorText();
  const t = useTranslations("authPage");

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
  //
  // The param carries a `MutationErrorCode` since UX-027 (D8), so it is
  // translated here rather than rendered as-is. `codeText` falls back to the
  // key for a value that is not a code, which is the right behaviour for a
  // query string anyone can type: visible, harmless, and obviously wrong.
  const [error, setError] = useState<string | null>(() => {
    const code = searchParams.get("auth_error");
    return code ? codeText(code as MutationErrorCode) : null;
  });
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
        setError(t("invalidEmail"));
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
      if (kind === "resend") setNotice(t("codeSent"));
    },
    [email, supabase, t],
  );

  const verifyCode = useCallback(async () => {
    const token = code.trim();
    if (token.length === 0) {
      setError(t("codeMissing"));
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
  }, [code, email, supabase, router, destination, t]);

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
    // <main>, not <div> (UX-017, roadmap Phase 9 task 4): signed out, this IS
    // the landing page — the only page in the app a crawler or an AI answer
    // engine ever reaches — so it needs a landmark and real prose, not just a
    // wordmark and a form.
    <main className="flex min-h-svh flex-col bg-background lg:flex-row">
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
        <div className="relative max-w-md">
          <div className="flex items-center gap-3">
            <SMark className="size-10 text-text-strong" />
            <span className="text-2xl font-semibold tracking-tight text-text-strong">SL</span>
          </div>

          {/* The crawlable half of UX-017. Three sentences, present in the
              server-rendered HTML, saying what the product is in the words
              someone would actually search ("bet with friends", "fake coins",
              "no real money"). Kept to muted body copy so the hero stays the
              wordmark-over-black lockup design-visual-identity.md §9 specifies. */}
          <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
            {t("heroLead")}
          </p>
          <ul className="mt-4 space-y-1 text-sm text-muted-foreground">
            <li>{t("heroPoint1")}</li>
            <li>{t("heroPoint2")}</li>
            <li>{t("heroPoint3")}</li>
          </ul>
        </div>
      </div>

      {/* Compositional divider — the brand slash (§9), not decoration. */}
      <div
        aria-hidden
        className="hidden w-px shrink-0 bg-border-strong lg:block"
        style={{ transform: "rotate(calc(90deg - var(--brand-slash-angle)))" }}
      />

      <div className="flex flex-1 flex-col items-center justify-center p-8 lg:p-12">
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

        {/* The signed-out half of D12. A visitor here has no profile menu, so
            without this a Brazilian on an English-configured browser cannot
            switch language before signing in — the moment they most want to.
            Absent entirely when `locale-pt-br` is off (D13). */}
        <LocaleTextSwitcher className="mt-8 w-full max-w-sm justify-end" />
      </div>
    </main>
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
  const t = useTranslations("authPage");
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
        <h1 className="text-2xl font-semibold tracking-tight text-text-strong">
          {t("signInTitle", { siteName: SITE_NAME })}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("signInLead")}</p>
      </div>

      <Button
        type="button"
        variant="outline"
        disabled={busy}
        onClick={onGoogle}
        className="h-10 w-full justify-center rounded-sm"
      >
        {pending === "google" ? t("redirecting") : t("google")}
      </Button>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        {t("or")}
        <div className="h-px flex-1 bg-border" />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <label
            htmlFor="email"
            className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
          >
            {t("emailLabel")}
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            placeholder={t("emailPlaceholder")}
            className="h-10 rounded-sm border border-border bg-surface-1 px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-jade focus:ring-1 focus:ring-jade/40"
          />
        </div>

        <Message error={error} />

        <Button
          type="submit"
          disabled={busy}
          className="h-10 w-full cut-sm justify-center rounded-none font-semibold uppercase hover:bg-primary hover:brightness-110 active:brightness-95"
        >
          {pending === "request" ? t("sendingCode") : t("continueEmail")}
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
  const t = useTranslations("authPage");
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
        <h1 className="text-2xl font-semibold tracking-tight text-text-strong">
          {t("otpTitle")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("otpLead", { email: email || t("otpLeadFallback") })}
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
            {t("devMailpit")}{" "}
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
          {t("codeLabel")}
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
        {pending === "verify" ? t("verifying") : t("verify")}
      </Button>

      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={onBack}
          className="h-8 px-2 text-muted-foreground hover:bg-surface-3 hover:text-foreground"
        >
          {t("back")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={busy || cooldown > 0}
          onClick={onResend}
          className="h-8 px-2 text-muted-foreground hover:bg-surface-3 hover:text-foreground"
        >
          {cooldown > 0 ? t("resendIn", { seconds: cooldown }) : t("resend")}
        </Button>
      </div>
    </form>
  );
}
