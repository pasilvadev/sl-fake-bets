"use client";

import { useCallback, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { isAuthRetryableFetchError, type AuthError } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { SMark } from "@/components/sl/s-mark";
import { AlphaTag } from "@/components/sl/alpha-tag";
import { SITE_NAME } from "@/lib/site";
import {
  CONFIG,
  isEmailShaped,
  validateSignupDraft,
  type MutationErrorCode,
  type SignupDraft,
} from "@repo/shared";
import { createClient } from "@/lib/supabase/client";
import { useErrorText } from "@/lib/use-error-text";
import { useFeatureFlag } from "@/lib/feature-flags";
import { buildTag } from "@/lib/build-info";
import { useTranslations } from "next-intl";
import { LocaleTextSwitcher } from "@/components/shell/locale-switcher";
import { authCallbackUrl, safeNextPath } from "@/lib/auth-redirect";
import { useOnboardingStep } from "@/components/onboarding/steps";

type AuthMode = "signIn" | "createAccount";
type Pending = "none" | "google" | "submit";

/**
 * GoTrue's `error.code` (node_modules/@supabase/auth-js's own error-code list,
 * read rather than remembered — D9's rule for every mutator mapping applies
 * here too) reduced to a `MutationErrorCode`, with the one values bag a
 * mapped code ever needs. `isAuthRetryableFetchError` is auth-js's own type
 * guard for a transient FETCH failure — the one case with no `.code` at all,
 * because nothing ever reached GoTrue to answer.
 *
 * Two GoTrue codes are deliberately absent from the switch:
 * `weak_password` and `validation_failed` reduce to the client-side
 * validator's OWN codes (`password-too-short`, `email-invalid` —
 * `packages/shared/src/validation.ts`) rather than getting a `MutationErrorCode`
 * of their own, because a server-side rejection of a fact the client already
 * checks is not a second fact (plan-hosted-early-access.md D1/D8).
 *
 * The raw code and message are always logged, never rendered (D9) — every
 * branch below returns a code, none of them `error.message`.
 */
function mapAuthError(
  error: AuthError,
): { code: MutationErrorCode; values?: Record<string, string | number> } {
  console.error("[auth-page] auth error:", error.code ?? error.name, error.message);

  if (isAuthRetryableFetchError(error)) return { code: "network-error" };

  switch (error.code) {
    case "invalid_credentials":
      return { code: "invalid-credentials" };
    case "user_already_exists":
    case "email_exists":
      return { code: "email-already-registered" };
    case "weak_password":
      return {
        code: "password-too-short",
        values: { min: CONFIG.MIN_PASSWORD_LENGTH },
      };
    case "validation_failed":
    // GoTrue's own address check, which is STRICTER than UX-003's loose shape
    // (`isEmailShaped`) on purpose — the client's job is catching a typo, and
    // GoTrue's is refusing an address it cannot deliver to. It reduces to the
    // same code for the same D1/D8 reason `weak_password` does: the reader has
    // one rule about their email address, so they get one sentence about it,
    // not "That didn't go through" for the half the client cannot judge.
    case "email_address_invalid":
      return { code: "email-invalid" };
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return { code: "rate-limited" };
    // A GoTrue-side timeout is the same fact `isAuthRetryableFetchError`
    // catches on this side — the request did not complete — and wants the same
    // "check your connection and try again" sentence rather than the catch-all.
    case "request_timeout":
      return { code: "network-error" };
    case "signup_disabled":
    case "email_provider_disabled":
      return { code: "auth-disabled" };
    default:
      return { code: "unexpected" };
  }
}

/**
 * Auth screen (plan-hosted-early-access.md D1/D6/D7/D8, replacing the email-OTP
 * design roadmap Phase 4 built behind the Phase 1 visual design,
 * design-visual-identity.md §9 checklist): a left-aligned wordmark lockup over
 * a hard-black hero, the brand slash as a compositional divider (banned-list
 * #10 — no centered blob), minimal-field card on the right.
 *
 * Two MODES on one card now, not two sequential steps: **sign in** (email +
 * password) and **create account** (display name + email + password) — D1's
 * answer to §2.1's finding that the hosted free tier's built-in mailer cannot
 * reach anyone outside the owner's own Supabase team. Google OAuth stays, and
 * renders only when the `auth-google` ops flag (D7, a kill switch for a login
 * method whose availability depends on Google's own console, not on whether
 * it is finished) is on.
 *
 * Default mode is **sign in**, unless `?mode=create` or the visitor arrived
 * from `/join/[code]` — an invite is almost always a new person, and `AuthPage`
 * already knows the pathname. The destination survives both modes and both
 * providers: a logged-out visitor on a deep link is rendered here by
 * `AuthGated` at their own URL, so the current pathname IS the destination
 * unless an explicit `?next=` overrides it (UX-012's invite links).
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
  const { codeText, issueText } = useErrorText();
  const t = useTranslations("authPage");
  const authGoogleEnabled = useFeatureFlag("auth-google");
  const tag = buildTag();

  const destination = useMemo(() => {
    const explicit = searchParams.get("next");
    return explicit ? safeNextPath(explicit) : safeNextPath(pathname);
  }, [searchParams, pathname]);

  const [mode, setMode] = useState<AuthMode>(() => {
    if (searchParams.get("mode") === "create") return "createAccount";
    if (pathname.startsWith("/join/")) return "createAccount";
    return "signIn";
  });
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState<Pending>("none");
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

  const toggleMode = useCallback(() => {
    setError(null);
    setMode((m) => (m === "signIn" ? "createAccount" : "signIn"));
  }, []);

  const signIn = useCallback(async () => {
    const address = email.trim();
    // `isEmailShaped` + `email-invalid`, not a local regex and a local
    // sentence: the create-account form already refuses a malformed address
    // through `validateSignupDraft`'s `email-invalid` issue (D8), and one rule
    // gets one shape check and one sentence in both languages. `@repo/shared`
    // owns the check (UX-003's loose shape) and the catalog owns the words.
    if (!isEmailShaped(address)) {
      setError(codeText("email-invalid"));
      return;
    }

    setError(null);
    setPending("submit");
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: address,
      password,
    });

    if (signInError) {
      setPending("none");
      const { code, values } = mapAuthError(signInError);
      setError(codeText(code, values));
      return;
    }

    // The browser client has written the session cookies; AuthProvider's
    // listener swaps the tree over. `pending` stays set so the button cannot
    // be pressed twice during the navigation.
    router.replace(destination);
    router.refresh();
  }, [email, password, supabase, router, destination, codeText]);

  const createAccount = useCallback(async () => {
    const draft: SignupDraft = { displayName, email: email.trim(), password };
    const issues = validateSignupDraft(draft);
    if (issues.length > 0) {
      setError(issueText(issues[0]));
      return;
    }

    setError(null);
    setPending("submit");
    // Confirmations are off (D1) so this already returns a session and sends
    // nothing — no separate "check your inbox" step. `display_name` is the
    // exact metadata key `auth_profile_bootstrap.sql`'s sign-up trigger reads
    // (§2.5), which is the whole reason this form needs no migration.
    const { error: signUpError } = await supabase.auth.signUp({
      email: draft.email,
      password: draft.password,
      options: { data: { display_name: draft.displayName.trim() } },
    });

    if (signUpError) {
      setPending("none");
      const { code, values } = mapAuthError(signUpError);
      setError(codeText(code, values));
      return;
    }

    router.replace(destination);
    router.refresh();
  }, [displayName, email, password, supabase, router, destination, issueText, codeText]);

  const signInWithGoogle = useCallback(async () => {
    setError(null);
    setPending("google");
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: authCallbackUrl(window.location.origin, destination) },
    });
    // Success navigates away to Google, so this only runs on failure.
    if (oauthError) {
      setPending("none");
      const { code, values } = mapAuthError(oauthError);
      setError(codeText(code, values));
    }
  }, [supabase, destination, codeText]);

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
            <SMark className="h-10 w-auto text-text-strong" />
            <span className="text-2xl font-semibold tracking-tight text-text-strong">SL</span>
            {/* The alpha sticker (owner ruling 2026-09-08 — see sl/alpha-tag.tsx).
                `self-start` parks it on the wordmark's upper-right shoulder;
                `-ml-1` tightens the lockup's 12px gap to 8px so it reads as
                attached to "SL" rather than as a fourth item in the row. */}
            <AlphaTag size="md" className="-ml-1 self-start" />
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
          <AuthForm
            mode={mode}
            displayName={displayName}
            email={email}
            password={password}
            pending={pending}
            error={error}
            showGoogle={authGoogleEnabled}
            onDisplayNameChange={setDisplayName}
            onEmailChange={setEmail}
            onPasswordChange={setPassword}
            onSubmit={mode === "signIn" ? signIn : createAccount}
            onGoogle={signInWithGoogle}
          />

          <button
            type="button"
            onClick={toggleMode}
            className="mt-4 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {mode === "signIn" ? t("toggleToCreate") : t("toggleToSignIn")}
          </button>
        </div>

        {/* The signed-out footer: privacy link + build tag (D8, tasks 7/8) on
            the left, the language switch on the right. The switcher is the
            signed-out half of D12 — without it a Brazilian on an
            English-configured browser cannot change language before signing
            in, the moment they most want to — and is absent entirely when
            `locale-pt-br` is off (D13). */}
        <div className="mt-8 flex w-full max-w-sm items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <Link
              href="/privacy"
              className="transition-colors hover:text-foreground hover:underline"
            >
              {t("privacyLink")}
            </Link>
            {tag && <span className="font-mono">{tag}</span>}
          </div>
          <LocaleTextSwitcher className="justify-end" />
        </div>
      </div>
    </main>
  );
}

/**
 * Inline feedback, per design-visual-identity.md §5: a validation error is
 * told by an ember ICON and an ember BORDER — body copy stays neutral, and
 * there is no red error text anywhere in this system.
 */
function Message({ error }: { error: string | null }) {
  if (!error) return null;

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

const labelClass =
  "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";
const inputClass =
  "h-10 rounded-sm border border-border bg-surface-1 px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-jade focus:ring-1 focus:ring-jade/40";

/**
 * The one form both modes share, parameterized rather than duplicated: the
 * two modes differ only in the title/lead copy, the presence of the display
 * name field, the password field's `autoComplete` token, and the submit
 * label — everything else (Google button, divider, email field, message,
 * submit button) is identical markup.
 */
function AuthForm({
  mode,
  displayName,
  email,
  password,
  pending,
  error,
  showGoogle,
  onDisplayNameChange,
  onEmailChange,
  onPasswordChange,
  onSubmit,
  onGoogle,
}: {
  mode: AuthMode;
  displayName: string;
  email: string;
  password: string;
  pending: Pending;
  error: string | null;
  showGoogle: boolean;
  onDisplayNameChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
  onGoogle: () => void;
}) {
  const t = useTranslations("authPage");
  const busy = pending !== "none";
  const isCreate = mode === "createAccount";

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text-strong">
          {isCreate ? t("createAccountTitle") : t("signInTitle", { siteName: SITE_NAME })}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isCreate ? t("createAccountLead") : t("signInLead")}
        </p>
      </div>

      {showGoogle && (
        <>
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
        </>
      )}

      <div className="flex flex-col gap-3">
        {isCreate && (
          <div className="flex flex-col gap-2">
            <label htmlFor="displayName" className={labelClass}>
              {t("displayNameLabel")}
            </label>
            <input
              id="displayName"
              name="displayName"
              type="text"
              autoFocus
              autoComplete="nickname"
              value={displayName}
              onChange={(e) => onDisplayNameChange(e.target.value)}
              placeholder={t("displayNamePlaceholder")}
              className={inputClass}
            />
          </div>
        )}

        <div className="flex flex-col gap-2">
          <label htmlFor="email" className={labelClass}>
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
            className={inputClass}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="password" className={labelClass}>
            {t("passwordLabel")}
          </label>
          <input
            id="password"
            name="password"
            type="password"
            // Distinct tokens on purpose: `new-password` is what prompts a
            // phone's password manager to OFFER to save one (Phase 3 step 5),
            // `current-password` is what prompts it to FILL a saved one.
            autoComplete={isCreate ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            className={inputClass}
          />
        </div>

        <Message error={error} />

        <Button
          type="submit"
          disabled={busy}
          className="h-10 w-full cut-sm justify-center rounded-none font-semibold uppercase hover:bg-primary hover:brightness-110 active:brightness-95"
        >
          {isCreate
            ? pending === "submit"
              ? t("creatingAccount")
              : t("createAccountSubmit")
            : pending === "submit"
              ? t("signingIn")
              : t("signIn")}
        </Button>
      </div>
    </form>
  );
}
