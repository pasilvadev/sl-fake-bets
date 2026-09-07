import en from "../../messages/en.json";
import ptBR from "../../messages/pt-BR.json";
import { DEFAULT_LOCALE, type Locale } from "./config";

/**
 * The two catalogs, and the type-level parity check that keeps them in step
 * (plan-i18n-ptbr.md D5).
 *
 * `en` is the key authority (D4): its shape IS the `Messages` type, so
 * `pnpm typecheck` fails the moment `pt-BR.json` is missing a key or spells
 * one differently. That check is the entire drift defence and it replaces a
 * test runner `apps/web` does not have — **do not** loosen `Messages` to
 * `Record<string, unknown>` and do not delete the assert below because it went
 * noisy (risk 7). A noisy assert means the catalogs actually drifted.
 *
 * Extra keys in `pt-BR.json` are deliberately NOT an error: excess-property
 * checking only applies to object literals, and a stale key is harmless where
 * a missing one is a visible bug.
 */
export type Messages = typeof en;

/** Missing or misspelled keys in pt-BR are a typecheck error, not a runtime surprise. */
const _ptBRIsComplete: Messages = ptBR;
void _ptBRIsComplete;

const CATALOGS: Record<Locale, Messages> = {
  en,
  // The assert above is what makes this cast safe — remove one and the other
  // stops meaning anything.
  "pt-BR": ptBR as Messages,
};

/**
 * Is the key-reveal dev mode on? (§4 affordance 3, Phase 1 task 7.)
 *
 * `NEXT_PUBLIC_I18N_DEBUG=keys` renders every translated string as its own
 * dotted key, which turns "which of ~300 strings is this?" into a glance —
 * point at anything on screen, read `wagerModal.cap.atMax`, edit that line in
 * `messages/*.json`.
 *
 * The `NODE_ENV` half of the guard is not belt-and-braces, it is the contract:
 * the env var is `NEXT_PUBLIC_`, so it is inlined into the client bundle at
 * build time and a stray value in a deploy environment would otherwise ship a
 * production app rendering `topBar.invite` at users. Next inlines both sides
 * of this `&&` as literals, so a production build drops the whole branch.
 */
export function isKeyRevealMode(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_I18N_DEBUG === "keys"
  );
}

/**
 * The catalog to render this request with — the one place both `i18n/request.ts`
 * and the pure formatters in `lib/format.ts` read from, so the debug mode
 * covers the countdown units and date words too rather than stopping at the
 * strings that happen to go through a React hook.
 */
export function messagesFor(locale: Locale): Messages {
  // Built from `en` rather than the active catalog so a key missing from
  // pt-BR still reveals a key instead of falling through to English text —
  // the point of the mode is to find strings, and a string that looks
  // translated because the fallback caught it is exactly the one worth finding.
  if (isKeyRevealMode()) return walk(en, "") as Messages;
  return CATALOGS[locale] ?? CATALOGS[DEFAULT_LOCALE];
}

function walk(node: unknown, prefix: string): unknown {
  if (typeof node === "string") return prefix;
  if (node === null || typeof node !== "object") return node;

  return Object.fromEntries(
    Object.entries(node as Record<string, unknown>).map(([key, value]) => [
      key,
      walk(value, prefix ? `${prefix}.${key}` : key),
    ]),
  );
}
