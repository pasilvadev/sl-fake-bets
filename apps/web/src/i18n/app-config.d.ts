import type { Locale } from "./config";
import type { Messages } from "./messages";

/**
 * Typed message keys (plan-i18n-ptbr.md D1).
 *
 * This is the augmentation that turns `t("topBar.invte")` from a runtime
 * "MISSING_MESSAGE" console warning into a compile error, and it is one of the
 * five things D1 bought `next-intl` for. It also narrows `useLocale()` to our
 * two-locale union, so a `Locale` from a hook can be handed straight to
 * `lib/format.ts` without a guard.
 *
 * `Messages` is `typeof en` (D4/D5): the English catalog is the key authority,
 * and pt-BR is checked against it separately in `messages.ts`.
 */
declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: Messages;
  }
}
