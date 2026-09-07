"use client";

import { useTransition } from "react";
import { Check } from "lucide-react";
import { cn } from "cn";
import { DropdownMenu } from "radix-ui";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { setLocale } from "@/i18n/actions";
import { LOCALES, LOCALE_LABELS, LOCALE_SHORT_LABELS, type Locale } from "@/i18n/config";
import { useFeatureFlag } from "@/lib/feature-flags";

/**
 * The language switch (plan-i18n-ptbr.md D12, Phase 1 tasks 11 and 12).
 *
 * Two surfaces, one action, because there are two places a reader can be when
 * they want to change language and only one of them has a profile menu:
 *
 *   * `LocaleSubmenu` — the signed-in case, replacing the `Language: English`
 *     stub `profile-menu.tsx` has carried disabled since Phase 1.
 *   * `LocaleTextSwitcher` — the signed-out case: `EN · PT` in the auth page
 *     footer. Without it a Brazilian arriving on an English-configured browser
 *     has no way to switch BEFORE signing in, which is the moment they most
 *     need one.
 *
 * A submenu with radio items rather than a segmented control, per D12: banned
 * list #13 reserves the segmented control for choices that are short AND
 * frequent, and this one is short and rare — the same row names a dropdown as
 * the right shape for exactly that.
 *
 * Both are inert when `locale-pt-br` is off (D13). Not disabled — absent: a
 * greyed-out control asks a question the flag has already answered, and
 * UX-026's app is one with no language affordance at all.
 */
function useLocaleSwitch() {
  const router = useRouter();
  const active = useLocale();
  const enabled = useFeatureFlag("locale-pt-br");
  const [pending, startTransition] = useTransition();

  function switchTo(next: Locale) {
    if (next === active) return;
    startTransition(async () => {
      await setLocale(next);
      // The Server Action wrote the cookie; this is what re-runs
      // `i18n/request.ts` against it. `refresh()` rather than a reload:
      // the change has to reach the whole tree without dropping the
      // in-memory team state the providers are holding.
      router.refresh();
    });
  }

  return { active, pending, switchTo, enabled };
}

const itemClass =
  "flex h-8 cursor-pointer items-center justify-between gap-2 rounded-sm px-2 text-sm text-foreground outline-none transition-colors data-[highlighted]:bg-surface-3";

export function LocaleSubmenu({ triggerClassName }: { triggerClassName: string }) {
  const t = useTranslations("common");
  const { active, pending, switchTo, enabled } = useLocaleSwitch();

  if (!enabled) return null;

  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger
        className={cn(triggerClassName, "justify-between gap-2")}
      >
        {t("language")}
        {/* The active locale's own name, never translated (risk 6). */}
        <span className="text-xs text-muted-foreground">{LOCALE_LABELS[active]}</span>
      </DropdownMenu.SubTrigger>

      <DropdownMenu.Portal>
        <DropdownMenu.SubContent
          sideOffset={4}
          className="z-50 w-44 border border-border-strong bg-surface-2 p-1"
        >
          <DropdownMenu.RadioGroup
            value={active}
            onValueChange={(value) => switchTo(value as Locale)}
          >
            {LOCALES.map((locale) => (
              <DropdownMenu.RadioItem
                key={locale}
                value={locale}
                disabled={pending}
                className={itemClass}
              >
                {LOCALE_LABELS[locale]}
                <DropdownMenu.ItemIndicator>
                  <Check className="size-3.5 text-jade" />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
}

/**
 * `EN · PT`, for a page with no profile menu.
 *
 * The two-letter labels live in `i18n/config.ts` beside the full ones and are
 * subject to the same never-translated rule: "PT" reads PT in the English UI.
 */
export function LocaleTextSwitcher({ className }: { className?: string }) {
  const t = useTranslations("common");
  const { active, pending, switchTo, enabled } = useLocaleSwitch();

  if (!enabled) return null;

  return (
    <div
      className={cn("flex items-center gap-1.5 text-xs", className)}
      aria-label={t("language")}
    >
      {LOCALES.map((locale, index) => (
        <span key={locale} className="flex items-center gap-1.5">
          {index > 0 && <span aria-hidden className="text-border-strong">·</span>}
          <button
            type="button"
            disabled={pending}
            aria-current={locale === active ? "true" : undefined}
            onClick={() => switchTo(locale)}
            className={cn(
              "rounded-sm px-1 py-0.5 outline-none transition-colors",
              "focus-visible:ring-1 focus-visible:ring-jade/40",
              locale === active
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
              pending && "pointer-events-none opacity-60",
            )}
          >
            {LOCALE_SHORT_LABELS[locale]}
          </button>
        </span>
      ))}
    </div>
  );
}
