import type { MutationErrorCode, ValidationCode } from "@repo/shared";
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

/**
 * The two error namespaces together are EXHAUSTIVE over `MutationErrorCode`,
 * and they do not overlap (plan-i18n-ptbr.md D8, Phase 2 task 6).
 *
 * This is the half of §4's contract a type can actually enforce: "there is no
 * second place a user-visible sentence can hide". Add a `MutationErrorCode`
 * and forget its sentence and one of these lines fails.
 *
 * **Why two namespaces and not one.** D8 makes `MutationErrorCode` a superset
 * of `ValidationCode`, so a single exhaustive `errors` record would have to
 * repeat all 22 field sentences — and then "Not enough coins." would live in
 * two places, in two languages, for the owner to edit twice and get wrong
 * once. So `validation` owns the field half and `errors` owns the REST, with
 * `Exclude` making that split a compile-time fact rather than a convention.
 * `errorNamespaceFor()` below is the one place that has to know which is
 * which, and it is four lines.
 *
 * `Record<..., string>` rather than the catalogs' own inferred shapes on
 * purpose: an inferred shape would happily be a subset, which is exactly the
 * bug — a missing sentence renders as a raw key like `errors.duel-expired` on
 * someone's screen, and nothing else would catch it.
 */
type MutatorOnlyCode = Exclude<MutationErrorCode, ValidationCode>;
const _errorsAreExhaustive: Record<MutatorOnlyCode, string> = en.errors;
const _validationIsExhaustive: Record<ValidationCode, string> = en.validation;
void _errorsAreExhaustive;
void _validationIsExhaustive;

/**
 * Which namespace holds this code's sentence.
 *
 * The `in` test is against the ENGLISH catalog, which D4 makes the key
 * authority: a code present there is present in every locale, because
 * `_ptBRIsComplete` above says so.
 */
export function errorNamespaceFor(
  code: MutationErrorCode,
): "errors" | "validation" {
  return code in en.validation ? "validation" : "errors";
}

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
