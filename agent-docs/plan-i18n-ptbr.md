# SL Fake Bets — pt-BR Localization Plan (UX-027)

Delivers **UX-027 [future]** — pt-BR localization — without retiring **UX-026** (English at launch): English stays the source locale, the fallback, and the default for anyone whose browser does not ask for Portuguese. The `locale-pt-br` feature flag seeded `false` by `20260905120100_infra_tables.sql` is the kill switch that already exists for exactly this phase.

**Owner requirement, stated verbatim (2026-09-07):** *"Deve ser fácil pra eu mudar um texto que eu ache que precise de personalização."* That is not a nice-to-have of this plan, it is its primary design constraint — §4 exists only to serve it, and every decision in §3 was taken with it as the tiebreaker.

---

## 0. Scope, in one paragraph

Two locales, `en` and `pt-BR`. The locale follows the **person**, not the URL: negotiated from `Accept-Language` on first visit, overridable from the profile dropdown's existing (today disabled) `Language: English` row, persisted per-account so it crosses devices. Every string a user can read moves into one catalog file per locale; numbers, dates and countdowns become locale-aware without losing the mono/`tabular-nums` density §3 of `design-visual-identity.md` requires. User-generated content — bet titles, team names, chat, display names — is never touched. Three build phases plus one explicitly deferred set.

---

## 1. Read first

**Docs.** `AGENT_SPEC.md` §4.1 UX-026/UX-027 (the two requirements this plan sits between) and §0 (doc protocol — this file must be registered in §1). `design-visual-identity.md` **§7 Voice & microcopy tone** — the whole section is the copy spec for the pt-BR pass, and its table of example lines is what "translate the voice, not the words" means in practice; **§8 Banned list** rows 2 and 14 (uppercase confined to short status labels and eyebrows — the rule that survives translation and constrains it); **§3 Typography** (the uppercase-discipline rule and the mandatory mono + `tabular-nums` for scanned numerals — D7 exists because of it); **§5.2** (state language), **§5.8** (a field owns its own validation error — the boundary D8 must not cross), **§5.9** (toast copy). `design-dashboard.md` §1.1 (the profile menu whose Language row this plan makes real) and §1.2 (the 40px ticker, the tightest surface pt-BR will hit). `plan-mvp-roadmap.md` §8 Extra Phase 4's **shipped-note 1** — it names widening `MutationResult` to carry a code as an out-of-scope refactor it wanted; this plan is where that debt comes due.

**Code.** `apps/web/src/app/layout.tsx` (the hardcoded `lang="en"`, `locale: "en_US"`, and the `Promise.all` the locale read joins). `apps/web/src/components/app-providers.tsx` (where `NextIntlClientProvider` mounts and why order matters). `apps/web/src/components/shell/profile-menu.tsx` (the disabled stub at the bottom). `apps/web/src/lib/format.ts` (three hardcoded `en-US` formatters and the compact shapes D7 protects). `apps/web/src/lib/data/result.ts` + `apps/web/src/lib/team-context.tsx` (the `MutationResult` string and its 78 producers). `packages/shared/src/validation.ts` (the `ValidationIssue` union — the one place in this codebase that was already i18n-ready). `apps/web/src/proxy.ts` (runs before every render; deliberately **not** where locale negotiation goes — see D3).

---

## 2. Current state — audited 2026-09-07

| Fact | Number | Where |
|---|---|---|
| Source files in `apps/web/src` | 90 | 61 of them carry `"use client"` |
| Distinct user-facing copy strings | **~271** across 44 files | conservative extraction; real figure ~300–350 once `aria-label`s and interpolated JSX are counted |
| Heaviest files | `bet-detail-page.tsx` (33), `start-duel-modal.tsx` (16), `bet-row.tsx` (14), `auth-page.tsx` (13), `create-bet-modal.tsx` (13) | |
| `fail("…")` call sites | **92** | 78 in `team-context.tsx`, 4 `chat.ts`, 4 `bet-mutations.ts`, 2 `team-mutations.ts` |
| …collapsing to distinct sentences | **42** | so the error-code union is ~42 mutator codes |
| `ValidationIssue` codes | **22** | already `{ code, message }` — the code was always the contract |
| `raise exception '…'` in SQL | **125** across 20 migrations | English, reaching the UI verbatim via `fail(error.message)` |
| Hardcoded `en-US` number/date formatting | 3 | `format.ts` ×2, `transactions-modal.tsx` ×1 |
| Hand-rolled `"s"`-suffix plurals | 4 | `join/[code]/page.tsx` ×2, `team-settings-modal.tsx`, `bet-row.tsx` |
| Emoji catalog | 9 category labels (displayed) + ~350 `name`/`keywords` (aria-label + search) | `packages/shared/src/emoji-catalog.ts` |
| `users.locale` column | does not exist | `20260905120000_domain_schema.sql` |
| `locale-pt-br` flag | seeded, `false` | `20260905120100_infra_tables.sql:80` |
| Language switcher | present and **disabled** | `profile-menu.tsx`, `Language: English`, `opacity-40` |
| Test runner in `apps/web` | none | vitest 5.0.0 exists only in `@repo/shared` |
| `resolveJsonModule` | `true` | `apps/web/tsconfig.json` — D5's type-level parity check needs it |

**The good news the audit found:** `ValidationIssue` has carried a stable `code` since Phase 1, so the client-side validation layer — which is what a normal user actually hits — needs no new contract, only a different consumer. **The bad news:** `MutationResult` carries a bare sentence, `asChatFailure` ends in `return fail(error.message)`, and 125 Postgres exception strings are one `catch` away from the screen. That asymmetry is why the error layer is its own phase.

---

## 3. Decisions this plan takes (owner may overrule)

- **D1 — `next-intl` 4.14.2, not a hand-rolled dictionary.** Peer range is `next: ^16.0.0` / `react: ^19.0.0`, so it matches the pinned stack exactly. What it buys that a hand-rolled `t()` does not: ICU MessageFormat (`plural`, `select` — pt-BR needs `select` far more than English does, see D10), typed message keys via the global `AppConfig["Messages"]` interface so a typo is a compile error, rich-text messages (`<b>{name}</b>` inside a string, so a bold span does not force a sentence to be split into three keys), and `useFormatter`/`Intl` integration. A hand-rolled layer is ~80 lines and then re-implements all five, badly, for the rest of the project's life. **Rejected alternative:** `next-international`, `lingui` — both fine, neither has next-intl's App-Router-native request config, and lingui adds a compile step.
- **D2 — No `[locale]` URL segment.** next-intl's "without i18n routing" setup. Reasons, in order of weight: (a) the root layout's own header comment already establishes that *"every page in this app is per-user by definition"* and reads the session on every request, so there is no static output for a locale segment to shard; (b) `typedRoutes: true` is on and every internal `href` in the app would have to become locale-aware; (c) a shared bet or invite link with `/pt-BR/` baked in sends a Brazilian's URL to an English-speaking friend in Portuguese — the locale belongs to the reader, not to the link; (d) it keeps 5 route files where they are. **What would force a revisit:** UX-017 growing into real multi-language SEO. Today the only genuinely public, crawled surface is the logged-out landing page, and §3's `alternates.languages` handles it without moving a route.
- **D3 — Locale resolution: cookie, then `Accept-Language`, then `en` — and the account column reconciles the cookie, it does not join the request path.**

  ```
  request:  NEXT_LOCALE cookie  →  Accept-Language (matched)  →  "en"
  account:  users.locale        →  writes the cookie on mismatch, once, client-side
  ```

  The cookie is written **only** by an explicit switch or by reconciliation — never by negotiation. That makes "cookie present" mean "a human chose this", which is what lets reconciliation know when to stay quiet. `Accept-Language` is negotiated per request instead of being cached in a cookie, because it is free (`@formatjs/intl-localematcher`, already a next-intl dependency) and because writing it would destroy that signal.

  **Why the column is not read server-side.** `loadTeamData` already `select`s the `users` rows for `currentUser`; adding `locale` to that column list is a one-word change and costs **zero** extra queries. Reading it in the root layout instead would need either a new RPC or a serialized second round trip after `getSessionUser`, on every navigation, forever. The cost of the cheap version is named and bounded: a user whose account says pt-BR, on a **new device** whose browser asks for English, sees one English frame before the reconciliation `router.refresh()` lands. One frame, first load on a new device only, and only when browser and account disagree. That is the right trade; do not "fix" it with a per-request query.

  **`proxy.ts` is deliberately not involved.** It spends a single-use Supabase refresh token on every navigation and its comment explains why that must stay the only thing it does. Locale negotiation needs no proxy: `i18n/request.ts` runs inside the render, where the cookie and headers are both readable.
- **D4 — `en` is the source locale, the key authority, and the fallback.** Keys are authored in English. `en.json` is the canonical key list; `pt-BR.json` is type-asserted against it (D5) so drift is a `pnpm typecheck` failure, and next-intl's runtime fallback covers anything that slips through — a missing pt-BR key renders the English sentence, never a raw key like `wagerModal.title`. UX-026 is therefore not violated but preserved: with the flag off, or a browser that does not ask for Portuguese, the app is exactly what it is today.
- **D5 — Two files, `messages/en.json` and `messages/pt-BR.json`, namespaced by source file.** Not one file per component and not one giant flat blob. The top-level key is the component's filename in camelCase — `wagerModal`, `betRow`, `profileMenu`, `ticker` — plus four cross-cutting namespaces: `errors` (D8), `validation`, `state` (the §5.2 uppercase vocabulary, shared by row, detail page and ticker), and `format` (D7's unit letters). Parity is enforced at the type level, no new test runner:

  ```ts
  // apps/web/src/i18n/messages.ts
  import en from "../../messages/en.json";
  import ptBR from "../../messages/pt-BR.json";
  export type Messages = typeof en;
  // Missing or misspelled keys in pt-BR are a typecheck error, not a runtime surprise.
  const _ptBRIsComplete: Messages = ptBR;
  ```

  At ~300 keys each file is ~350 lines — one file to open, one search to find a string, one diff to review. Splitting is the wrong instinct at this size; revisit past ~800 keys.
- **D6 — Keys are semantic, never the English text.** `wagerModal.notFound.title`, not `"Bet not found"`. A key derived from the English sentence orphans every translation the moment the English changes, which is precisely the change this plan is built to make cheap.
- **D7 — The compact formatters stay compact; only their units and separators are localized.** `formatTimeLeft` keeps `3d 4h`, `formatRelativePast` keeps its two-character shape. **Do not** replace them with `Intl.RelativeTimeFormat`: pt-BR renders `há 2 horas` where the ticker and bet-row have room for `há 2h`, and §3 requires those numerals to stay mono `tabular-nums` so they can be scanned without jitter. What *does* become locale-aware: `Intl.NumberFormat(locale)` for coin grouping (`12,450` → `12.450` — and `transactions-modal.tsx`'s inline `toLocaleString("en-US")` moves into `formatCoins` while we are there), `Intl.DateTimeFormat(locale)` for `formatShortDate` (`Sep 3` → `3 de set`), and the unit letters `d`/`h`/`m`/`s` plus the words `closed` / `just now` / the `{n} ago` frame, which come from the `format` namespace. Every one of the 4 hand-rolled `"s"`-suffix plurals becomes an ICU `plural` block.
- **D8 — `MutationResult` carries a code, and `ValidationIssue.message` is deleted.** This is the enabling refactor, and it is the one Extra Phase 4 flagged and postponed.

  ```ts
  export type MutationResult =
    | { ok: true }
    | { ok: false; code: MutationErrorCode; /** raw upstream text, for logs only */ detail?: string };
  ```

  `MutationErrorCode` lives in `@repo/shared` beside `ValidationIssue` and is a **superset** of `ValidationIssue["code"]` — the two overlap (`over-balance` and `"Not enough coins."` are the same fact) and one union means one `errors.*` namespace typed as `Record<MutationErrorCode, string>`, which gives compile-time completeness for free. Roughly 42 mutator codes ∪ 22 validation codes minus ~4 overlaps ≈ **60 codes**, and 60 sentences in one place is the single biggest win this plan hands the owner. `ValidationIssue` keeps only `{ code }`: the `message` field was always a convenience the UI should not have been reading.
- **D9 — Unlocalized RPC exceptions get one generic sentence and a log, not a lookup table.** The 125 SQL strings are the last line of defence against races and tampering; the shared validation layer catches essentially everything a normal user does, before the RPC runs. So `code: "unexpected"`, one localized sentence, and `console.error` with the raw text and the SQLSTATE. **Do not** pattern-match on English message text — it is fragile, and it would silently start failing the day someone edits a migration. Codes for the handful of genuinely race-reachable RPC errors are §5's Phase 4, scoped by evidence rather than by guessing.
- **D10 — pt-BR copy carries §7's voice, and two grammatical rulings make that tractable.**
  - **The nouns are fixed once.** `bet` = **aposta** (feminine), `duel` = **duelo** (masculine), `team` = **time** (masculine), `coin` = **moeda** (feminine), `wager` = **aposta**/verb **apostar**. Fixing the two head nouns fixes every adjective downstream, which is what makes the §5.2 state vocabulary fall out in one piece: `OPEN`→**ABERTA**, `CLOSED`→**FECHADA**, `VOID`→**ANULADA**, `RESOLVED`→**RESOLVIDA**, `CLOSING SOON`→**FECHANDO** (8 characters against the English 12 — the compression rule of §5, working in our favour for once).
  - **Never inflect for the player's gender.** The app has no gender field and must not acquire one. Prefer verb phrases and non-inflecting nouns over agent nouns: §7's *"House's favorite donor"* becomes **"Quem mais financia a casa"**, not *"Doador oficial da casa"*. Where ICU `select` is genuinely needed it is for the *bet kind*, not the person.
  - **Register: Brazilian informal `você`.** Never `tu`, never `vós`, never the corporate-formal imperative. §8's banned list applies to the Portuguese too, and gains two Portuguese-specific entries: **"Ops!"** is banned exactly as *"Oops!"* is, and **exclamation marks are banned in error copy**, per §7's Error-toast row.
  - **Calibration lines, for the translator to match:** *"No bets yet. Someone has to make the first bad decision."* → **"Nenhuma aposta ainda. Alguém tem que tomar a primeira decisão ruim."** · *"Nobody's lost anything here. Yet."* → **"Ninguém perdeu nada aqui. Ainda."** · *"Everyone's still solvent. Suspicious."* → **"Todo mundo ainda tá no azul. Suspeito."** · *"Not enough coins."* → **"Saldo insuficiente."** · `VOID · COULDN'T COVER IT` → **`ANULADA · SEM SALDO`**.
- **D11 — Uppercase labels keep their accents.** `ANULADA`, not `ANULADA` stripped of anything; `FECHA ÀS 18H`, not `FECHA AS 18H`. Standard pt-BR retains diacritics in uppercase, and `tracking-wider` at 11px renders them fine. §3's uppercase discipline is unchanged: still only short status labels and eyebrows.
- **D12 — The switcher is a Radix submenu with two radio items, replacing the disabled stub.** `DropdownMenu.Sub` + `RadioGroup`, so the current locale is visibly checked. Not a segmented control: Banned-list #13's segmented-control rule is for *short and frequent* choices, and this is short and **rare**, which is the same row's stated case for a dropdown. Signed-out visitors have no profile menu at all, so the auth page gets its own minimal `EN · PT` text pair in its footer — otherwise a Brazilian arriving with an English-configured browser has no way to switch before signing in. The switch is a **Server Action** (`cookies().set` then `router.refresh()`), plus a `users.locale` update when signed in; a client-side `document.cookie` write would leave one render disagreeing with the server.
- **D13 — The whole thing is gated on the seeded `locale-pt-br` flag.** Flag off ⇒ `pt-BR` is not in the negotiable set, the switcher does not render, and the app is English for everyone. That is what makes Phase 3 shippable in pieces: partially-translated copy is invisible until the flag flips. Flipping it off after launch degrades to English on next load and cannot strand anything — unlike `duel-bets`, no money moves through this flag.

---

## 4. The owner's editing surface

This section is the requirement, so it gets stated as a contract rather than left implicit.

**To change any text in the app, open exactly one file:** `apps/web/messages/pt-BR.json` (or `en.json` for the English). Edit the sentence. Save. That is the whole procedure — no `.tsx` file, no component, no rebuild step beyond the dev server's own reload.

**To find the string you want to change**, three affordances, in the order you would reach for them:

1. **The namespace is the filename.** A string in `components/modals/wager-modal.tsx` lives under `"wagerModal"`. A string in `components/dashboard/bet-row.tsx` lives under `"betRow"`. One hop, no index to maintain.
2. **Search the English.** `en.json` holds the exact sentence you see on screen, so pasting it into a search lands on the key; the same key in `pt-BR.json` is the line to edit.
3. **The key-reveal dev mode.** With `NEXT_PUBLIC_I18N_DEBUG=keys` in `.env.local`, every translated string renders as its own key instead of its text. Point at anything on screen, read `wagerModal.cap.atMax`, edit that line. This is ~10 lines in the provider (a custom `getMessageFallback` plus a wrapping `messages` transform) and it is the single highest-value affordance in this plan for the stated requirement — it turns "which of 300 strings is this?" into a glance.

**Errors and validation are one namespace each.** Every one of the ~60 error sentences the app can produce sits under `"errors"` in the same file, alphabetically by code, typed as an exhaustive record. There is no second place a user-visible sentence can hide — after Phase 2, a string literal reaching the screen from `team-context.tsx` or a `lib/data/*.ts` module is a bug, and the `errors` record's exhaustiveness is what makes that checkable.

**A `messages/README.md`** records the namespace-equals-filename rule, the D6 key-naming rule, and the D10 voice rules, so the convention survives a session that has not read this plan.

---

## 5. Phases

Three build phases plus one deferred set. The split is by **risk**, not by file count: Phase 1 is new machinery that touches little, Phase 2 is an invasive refactor of a load-bearing type, Phase 3 is large but mechanical. Do not merge 1 and 2 — combined they exceed the repo's ~15-file session guideline and the error refactor deserves its own exit criteria.

### i18n Phase 1 — The machine

**Goal:** a working locale system with a real switcher, proven on the shell, with the rest of the app still hardcoded English. Ends with a demonstrable "flip to Português, the top bar / ticker / profile menu / empty state change language, reload, it stuck, open on your phone, it followed you."

**Lifts from `plan-mvp-roadmap.md` §6 risk 7: nothing.** No notification surface, no new realtime reader, no money path. It adds one nullable column and one cookie.

**Tasks:**

1. **Install and wire.** `pnpm --filter web add next-intl@4.14.2`. `next.config.ts` wraps the export in `createNextIntlPlugin()` — keep `transpilePackages`, `outputFileTracingRoot` and `typedRoutes` exactly as they are; the plugin composes and none of the three is affected by D2.
2. **`apps/web/src/i18n/config.ts`** — `LOCALES = ["en", "pt-BR"] as const`, `DEFAULT_LOCALE = "en"`, `Locale` type, `isLocale()` guard, and `LOCALE_LABELS` (`{ en: "English", "pt-BR": "Português" }` — the switcher's own labels are the one place a locale name is written in its own language, never translated).
3. **`apps/web/src/i18n/request.ts`** — the `getRequestConfig` D3 describes: cookie, then `match()` from `@formatjs/intl-localematcher` over `Accept-Language`, then `en`; `pt-BR` is removed from the candidate set when the `locale-pt-br` flag is off (D13). Returns `{ locale, messages }`. The flag is already loaded once per request by the layout — read it here from the same helper rather than duplicating the query, and record in a comment that this is the one place a flag read is allowed to precede the layout's.
4. **`messages/en.json` + `messages/pt-BR.json`**, the `i18n/messages.ts` parity assert of D5, and `messages/README.md`. Seed with only the namespaces Phase 1 needs: `topBar`, `ticker`, `profileMenu`, `emptyState`, `format`, `common`.
5. **`layout.tsx`** — `lang={locale}` instead of `lang="en"`, and `openGraph.locale` becomes the active locale (`en_US` / `pt_BR`) with the other listed in `alternates.languages`. Metadata itself moves to `generateMetadata` so the title/description come from messages; the static `metadata` export cannot read the request locale. `metadataBase` and the title template are unchanged.
6. **`app-providers.tsx`** — `NextIntlClientProvider` **outermost**, above `FeatureFlagProvider`. Reason: a provider below it may render copy (a flag-gated empty state already does), and a translation hook must never be the thing that is not ready yet. Messages cross the boundary as a prop from the layout, like `initialUser` and `flags` already do; note in the header comment that only the **active** locale's messages are serialized (~10 KB gzipped at this catalog size) and that pre-emptively narrowing with `pick()` is not warranted below ~800 keys.
7. **The key-reveal debug mode** (§4, affordance 3). `NEXT_PUBLIC_I18N_DEBUG=keys`. Guard it so it cannot activate in production regardless of the env value.
8. **`lib/format.ts` becomes locale-aware** per D7. The three functions take a `locale` (or read it via next-intl's `useFormatter` at the call site — pick one and be consistent; a `locale` parameter keeps the module pure and server-safe, which its header comment currently promises). `transactions-modal.tsx`'s inline `toLocaleString("en-US")` moves into `formatCoins`. `formatVoidLabel` moves its five suffixes into the `state` namespace and returns a key, not a sentence — the function's long comment about rust being banned and N5/N6 stays, because it documents the *caller's* rendering and is still true.
9. **The migration.** `alter table public.users add column locale text` — nullable, `check (locale in ('en','pt-BR'))`, no default. **Nullable and defaultless on purpose:** `null` means "never chose", which is what lets `Accept-Language` keep deciding for a user who has not expressed a preference, and a `default 'en'` would silently make every existing row an explicit English choice. `users_update_self` already permits the write and `users_select_self_or_teammate` already permits the read — no policy change, and the `grant` on line 320 already covers it.
10. **`loadTeamData`'s users select gains `locale`** (one word, zero extra queries) and it reaches the client on `currentUser`. `types.ts`'s `User` gains `locale: Locale | null`.
11. **The switcher (D12).** `profile-menu.tsx`'s disabled row becomes a `DropdownMenu.Sub` with two radio items. A Server Action `setLocale(locale)` writes the `NEXT_LOCALE` cookie (`path=/`, `max-age` 1 year, `sameSite=lax`, not `httpOnly` — it is a display preference, not a secret) and, when signed in, updates `users.locale`; then `router.refresh()`.
12. **Reconciliation (D3).** One effect where `currentUser` is available: if the cookie is **absent** and `currentUser.locale` is set and differs from the active locale, call the same Server Action. Absent-cookie-only is the whole guard — it is what stops an account preference from overriding a deliberate switch on this device. Add the `EN · PT` pair to the auth page footer for the signed-out case.
13. **Translate the Phase-1 surfaces only:** `top-bar.tsx`, `ticker.tsx`, `profile-menu.tsx`, `dashboard/empty-state.tsx`. Four files, chosen because they are the shell — visible on every screen, so the switcher's effect is unmistakable — and because `ticker.tsx` is the tightest layout in the app and is therefore where text expansion should be discovered first, not last.

**Exit criteria:**

- A browser configured `pt-BR` gets Portuguese on the four Phase-1 surfaces on first visit, with **no** cookie written; a browser configured `en-US` gets English.
- Switching in the profile menu changes the language without a full page load, survives a reload, and survives sign-out → sign-in on the same device.
- Signing in on a second browser with the opposite `Accept-Language` lands on the **account's** locale after one refresh, and switching there does not get overwritten by the account value on the next navigation.
- With `locale-pt-br` off: no switcher anywhere, `Accept-Language: pt-BR` gets English, `lang="en"`.
- `<html lang>` matches the rendered language on every route. `og:locale` matches, with the other locale in `alternates.languages`.
- `pnpm typecheck` fails if a key is removed from `pt-BR.json` and passes when it is restored. Deleting a key from **both** files fails at every call site.
- `formatCoins(12450)` is `12,450` in `en` and `12.450` in `pt-BR`, still mono `tabular-nums`, still not jittering as it updates. `formatShortDate` reads `3 de set`. `formatTimeLeft` still reads `3d 4h` in both — **not** `há 3 dias`.
- `NEXT_PUBLIC_I18N_DEBUG=keys` renders keys in dev and is inert in a production build.
- The ticker does not wrap, overflow or reflow at 375px in pt-BR.

**Sizing:** ~14 files — five new (`i18n/config.ts`, `i18n/request.ts`, `i18n/messages.ts`, two message catalogs, plus `messages/README.md` and one migration), nine edited (`next.config.ts`, `layout.tsx`, `app-providers.tsx`, `format.ts`, `team-data.ts`, `types.ts`, `profile-menu.tsx`, `top-bar.tsx`, `ticker.tsx`, `empty-state.tsx`, `transactions-modal.tsx`, `auth-page.tsx`). At the guideline's edge. **If it runs long, split at task 8** — the machine plus the formatters is a complete verifiable session, and the switcher plus reconciliation is the other half.

---

### i18n Phase 2 — The error layer speaks codes

**Goal:** no user-visible sentence originates outside a message catalog. This is the phase that makes §4's contract true rather than mostly true, and it pays down the debt Extra Phase 4 recorded and deferred.

**Why it is a phase and not a chore:** it changes the shape of `MutationResult`, which 16 component files consume and 92 call sites produce. Done as a slice of Phase 3 it would be the thing that breaks, silently, in the middle of a 40-file mechanical edit.

**Tasks:**

1. **`MutationErrorCode` in `@repo/shared`**, beside `ValidationIssue`, as a superset of `ValidationIssue["code"]` (D8). Derive the mutator half mechanically from the 42 distinct `fail()` sentences — the audit list is in this file's §2 and the extraction is `grep -rho 'fail("[^"]*")' src | sort -u`.
2. **`ValidationIssue` loses `message`.** `packages/shared/src/validation.ts` drops ~22 sentences. Its two test files (`duel.test.ts`, `settlement.test.ts`) assert on codes already or should; check and fix.
3. **`result.ts`'s `fail()` takes a code**, plus an optional `detail` for logs. The 92 call sites convert mechanically; the compiler finds every one.
4. **`asChatFailure` maps its three SQLSTATEs to codes** and its `return fail(error.message)` becomes `fail("unexpected", error.message)` — the raw text goes to `console.error`, not to the screen (D9). This closes the one path by which a Postgres string reaches a user today.
5. **The 16 consumers translate.** Each already renders `result.error`; it now renders `t(\`errors.${result.code}\`)`. Inline field errors stay inline — §5.8 and Extra Phase 4's task 12 both say the field owns its own error, and this phase must not become an excuse to move 21 of them into toasts.
6. **`errors` and `validation` namespaces in both catalogs**, typed `Record<MutationErrorCode, string>` so a new code without a sentence is a compile error.
7. **`team-mutations.ts`'s `"Image must be 2 MB or smaller."`** — the one `{ url, error }` shape outside `MutationResult` — gets the same treatment rather than being left as the exception that proves the rule.
8. **Grep the diff for survivors.** No `fail("` with a sentence, no `result.error` rendered raw, no string literal in `team-context.tsx` or `lib/data/*.ts` that a user could read.

**Exit criteria:**

- `MutationResult`'s failure arm has no `string` message field. Every `fail()` argument is a `MutationErrorCode`.
- Every one of the ~60 codes has an `en` and a `pt-BR` sentence; removing either fails `pnpm typecheck`.
- With every RPC stubbed to raise an unmapped exception, the UI shows one localized generic sentence and the raw Postgres text appears in `console.error` with its SQLSTATE — and appears nowhere on screen.
- A rejected chat burst still produces exactly one toast (Extra Phase 4's dedupe survives the refactor), now localized.
- `pnpm test` passes in `@repo/shared` with the `message` field gone.
- The 21 inline validation errors are still inline and still attached to their fields.

**Sizing:** ~20 files, but the compiler drives nearly all of it: 3 shared, 4 `lib/`, 16 components (most a one-line change each), 2 catalogs. Mechanical after task 1, and task 1 is where the thinking is.

---

### i18n Phase 3 — The copy, and the pt-BR pass

**Goal:** every remaining string in the catalog, and a pt-BR translation that reads like §7 wrote it rather than like a machine translated it.

**Tasks:**

1. **Extract, surface by surface**, heaviest first so the hard layout problems surface early: `bet-detail-page.tsx` (33) → `start-duel-modal.tsx` (16) → `bet-row.tsx` (14) → `auth-page.tsx` (13) → `create-bet-modal.tsx` (13) → `duel-accept-modal.tsx` (11) → `team-settings-modal.tsx` (10) → the remaining ~37 files. Namespace per D5, keys per D6.
2. **The 4 hand-rolled plurals become ICU `plural` blocks.** `join/[code]/page.tsx`'s two are in an OG `description`, so they are also the SEO surface — get them right.
3. **The `state` namespace**, shared: the §5.2 uppercase vocabulary and `formatVoidLabel`'s five suffixes, per D10's fixed-gender ruling.
4. **The 9 emoji category labels** move to the catalog. The picker reads them by id — `emoji-catalog.ts` keeps the ids and loses the English `label`s, or keeps them as the `en` values; either way the displayed label comes from messages. The ~350 `name`/`keywords` do **not** move (see Phase 4).
5. **The pt-BR pass, as a distinct pass with §7 open.** Not file-by-file alongside extraction — the voice is a property of the whole catalog, and a per-file translation drifts in register. Read §7's table and §8's banned list first; D10's calibration lines are the target.
6. **Text-expansion audit at 375px and at `sm`.** pt-BR runs ~15–25% longer. The surfaces to check by name, because they are the ones with no slack: `ticker.tsx`'s uppercase chips in a 40px strip; `bet-row.tsx`'s state label + countdown; `top-bar.tsx`'s three buttons at the `sm` boundary; `rank-badge.tsx`; `module-chip-strip.tsx`; `ui/button.tsx`'s uppercase primary CTA; `auth-page.tsx`'s `Resend code` → `Reenviar código`. Fixes are **copy compression first** (D10's `FECHANDO` over `FECHA EM BREVE` is the pattern), layout second, and a font-size change never — §3's scale is not negotiable for a translation.
7. **The metadata pass.** `generateMetadata` for `layout.tsx`, `join/[code]/page.tsx` and `bet/[id]/page.tsx`; `SITE_TAGLINE` becomes a message while `SITE_NAME` stays a constant (UX-021: "SL" is not translatable). `robots.ts`/`sitemap.ts` are locale-agnostic under D2 and need no change — confirm rather than assume.
8. **The email template.** `supabase/templates/magic_link.html` becomes **bilingual** — pt-BR block, then English — because self-hosted GoTrue has exactly one template per email type and no per-recipient locale. Four lines twice is cheaper than the alternative (a Supabase send-email auth hook and our own sender), which is out of scope. Update the file's header comment: its *"Copy stays English-only (UX-026)"* line is what this task falsifies, and the next reader deserves the reason.
9. **Docs.** (`AGENT_SPEC.md` §1's doc registry already carries this file — registered when it was written, per §0's protocol.) UX-027 moves from `[future]` to shipped; UX-026 gains one clause recording that English is now the source locale and fallback rather than the only locale — **do not reword the owner's requirement text**, append. `design-visual-identity.md` §7 gains D10's noun table, gender rule and register ruling, because §7 is where a future session looks before writing a Portuguese sentence. §8's banned list gains the two Portuguese rows. `plan-mvp-roadmap.md` §8 gains this plan's phases as a pointer, not a copy.

**Exit criteria:**

- No user-facing string literal remains in `apps/web/src`. The grep that proves it is part of the session's report, and the known-allowed exceptions are enumerated (`SITE_NAME`, locale labels, `0000` numeric placeholders, `+5`, `1v1`).
- Both catalogs are complete; `pnpm typecheck` and `pnpm lint` pass; `pnpm test` passes.
- Every screen at 375px and 1280px in pt-BR: nothing wraps that should not, nothing truncates a word mid-glyph, no uppercase label overflows its chip, no button reflows the top bar.
- The `en` app is **byte-identical in meaning** to today — extraction is not an editing pass. Any English sentence that genuinely improves is flagged separately for the owner, not slipped in.
- An OG card for an invite link and a bet link renders in the default locale with correct plurals, and its `alternates.languages` lists both.
- The sign-in email arrives with both languages, still says "SL", still renders `{{ .Token }}` as a code and not a link.
- `NEXT_PUBLIC_I18N_DEBUG=keys` reveals a key for every visible string — the practical proof that nothing was missed.

**Sizing:** ~48 files, and it is the one phase that must be split. Suggested cut, by surface: **3a** dashboard + shell + rail (~12 files), **3b** modals (~13 files), **3c** bet detail + auth + join + onboarding (~10 files), **3d** the pt-BR pass + expansion audit + metadata + email + docs. Extraction is mechanical and parallelizable; the pt-BR pass is not and should be one session with §7 open.

---

### i18n Phase 4 — Deferred, explicitly

Recorded so a future session finds a decision rather than a gap.

1. **Emoji search in Portuguese.** ~350 entries × N keywords, and `searchBetEmoji` matches ASCII-lowercase terms, so `coração` needs both a diacritic-folding matcher and a second keyword set. Interim behaviour is honest and worth stating: the picker's **categories** are Portuguese, its **search** is English, and a pt-BR user browses instead of typing. Revisit when someone actually complains. When it happens, the shape is a per-locale keyword map keyed on `char`, not a fork of the catalog — `emoji-catalog.test.ts` is what keeps the glyphs honest and must keep covering exactly one catalog.
2. **Stable codes for race-reachable RPC exceptions.** D9's generic fallback is correct for 120 of the 125, but a handful are genuinely reachable by two people acting at once — bet closed under you, funds spent elsewhere, duel already accepted or declined. Those deserve real sentences. Scope it from **evidence**: log the SQLSTATE + code with D9's `console.error`, wait, then promote the ones that actually appear. Do not pre-emptively code all 125.
3. **A third locale.** Nothing in this plan is two-locale-specific except `LOCALE_LABELS` and the bilingual email. Adding `es` is a catalog file plus one entry in `LOCALES`. The email is where a third locale stops being free — that is the point at which the auth-hook sender becomes worth its cost.
4. **`Intl.PluralRules`-aware coin phrasing beyond `plural`.** Not needed: pt-BR has the same two-form cardinal system English does, and ICU `plural` covers it. Recorded so nobody "fixes" it.
5. **`transactions.description`, for the two kinds that embed a name.** *(Found during execution; this plan did not anticipate it.)* The ledger RPCs write that column in English, and the history modal renders it on every visit — the read-side twin of the problem D9 solved for exception text, except routine rather than race-only. Phase 3 recovers the two FIXED sentences from `kind` client-side (`daily-reward`, `onboarding-grant`), which covers the rows a normal user sees. `injection` and the unused `donation` embed a display NAME the row carries no column for, so there is nothing to rebuild them from and they fall through to the stored English. Closing that needs a `description_code` (or an actor column) on `public.transactions` plus every ledger RPC — a migration, not a copy change, which is why it is here and not in Phase 3. Scope it the same way as item 2: from evidence, once someone actually reads an injection row in Portuguese and minds.
6. **A `timeZone` that follows the reader.** `i18n/request.ts` pins `UTC` because next-intl warns on every render without one and nothing in the app renders a wall-clock time — `lib/format.ts` does its own date math (D7) and `useFormatter` has no callers. The day a surface shows a time of day, the honest answer is the READER's zone, resolved client-side after hydration; the comment in `request.ts` says so, so that day starts from a choice rather than from a default nobody remembers making.

---

## 6. Risks

1. **The `MutationResult` refactor is invasive and the compiler is the only thing catching it.** 92 producers, 16 consumers. Mitigation: it is its own phase with its own exit criteria, and the change is type-driven end to end — there is no runtime-only path. The real risk is a session merging it into Phase 3's 48 files.
2. **Text expansion breaks a dense layout and gets "fixed" by shrinking type.** §3's scale is load-bearing. Mitigation: Phase 3 task 6 fixes by compressing copy first — which is also what §7's voice wants — and `ticker.tsx` is translated in Phase 1 specifically so this is discovered on day one rather than on the last file.
3. **A half-translated app ships.** Mitigation: D13's flag. pt-BR is not offerable until it is complete, and the flag was seeded `false` for precisely this.
4. **Extraction quietly becomes a copy-editing pass.** 300 strings is a lot of temptation. Mitigation: the exit criterion is that the English app is unchanged in meaning, and improvements are flagged for the owner separately.
5. **The reconciliation effect loops.** Switch writes cookie → refresh → effect sees mismatch → switches back. Mitigation: the absent-cookie guard in D3 is the entire defence and it is one condition; the exit criterion that a deliberate switch survives the next navigation is what tests it. Get this wrong and the app flickers between languages forever, so it is worth writing the test before the effect.
6. **A locale name gets translated.** "Português" must read Português in the English UI too. Mitigation: `LOCALE_LABELS` is a constant in `i18n/config.ts`, deliberately outside the catalogs.
7. **The catalogs drift out of the type check.** If `pt-BR.json` is ever typed as `Record<string, unknown>` or the assert is deleted "because it was noisy", D5's guarantee is gone and nothing replaces it. Mitigation: the assert carries a comment saying so, and Phase 1's exit criteria tests it by deletion.

---

## 7. What is deliberately not localized

- **User-generated content**: bet titles, option labels, team names, display names, chat messages, comments, invite codes. Obviously — but stated, because a bulk extraction pass touching `types.ts` could get confused about `bet.title`.
- **`SITE_NAME`** — UX-021: the product is "SL", in every language, never expanded.
- **Emoji `name`/`keywords`** — Phase 4, item 1, with the interim behaviour stated.
- **`ONBOARDING_STEP_DESCRIPTIONS`** (`onboarding/steps.ts`) — its own comment says it is *"for whoever reads the funnel's drop-off later"*. Developer-facing, analytics-adjacent, never rendered.
- **`ANALYTICS_EVENTS`** values — matched as literals by `supabase/queries/arc-017-metrics.sql`.
- **`consistency-guard.ts`** — development-only console output.
- **`KnownFeatureFlag` descriptions** — Studio-facing, read by us.
- **SQL comments, migration text, and everything under `agent-docs/`** — agent- and developer-facing. `vision.md` is the owner's and is already Portuguese; per `AGENT_SPEC.md` §0, agents never edit it.

---

## 8. What shipped

All three phases, 2026-09-07, on `main`. Commits: Phase 1 `ee0e463`, Phase 2 `1cecb7b`, Phase 3a/3b `d0bde5c`, Phase 3c/3d in the commit this section lands with.

**Where the execution diverged from the plan, and why:**

- **`negotiator` was dropped.** D3's `Accept-Language` parse was to reuse next-intl's own dependency. It ships no types at its 1.x and `@types/negotiator` still describes 0.6, so `i18n/request.ts` carries a 12-line q-value parser instead. `@formatjs/intl-localematcher` is a direct dependency and still does the matching that turns `pt`, `pt-PT` and `pt-br` into `pt-BR`.
- **`errors` and `validation` do not overlap.** D8 says one union, one `errors.*` namespace typed `Record<MutationErrorCode, string>`. Taken literally that repeats all 22 field sentences, in two languages, and hands the owner two places to edit "Not enough coins." — against §4's whole point. So `validation` owns the field half, `errors` owns `Exclude<MutationErrorCode, ValidationCode>`, and the two asserts together are still exhaustive over the union.
- **`ValidationIssue` kept a `values` bag.** D8 says it keeps only `{ code }`. Three of its sentences quote a number the validator already knows (`options-min`, `over-max-wager`, `chat-too-long`); making each call site re-derive `CONFIG.CHAT_MESSAGE_MAX_CHARS` — or, worse, the bet's own `maxWagerPerUser` — would put the same fact in two places. `values` is ICU arguments, never a sentence, which is the distinction the deleted `message` field failed to make. `MutationResult` carries the same bag for its two interpolating codes.
- **Two READ paths got named codes rather than `unexpected`.** D9 is about unmapped RPC exceptions, and `firstError` (the team load) and `fetchChatPage` were rendering raw Postgres text on a whole-surface error screen. They return `team-load-failed` / `chat-load-failed`: the raw text is still logged and still never shown, and "Couldn't load your teams" tells a reader what to retry where the generic sentence does not.
- **`BetDurationPreset.label` and `BetEmojiCategory.label` were deleted, not kept as `en` values.** Phase 3 task 4 allowed either. Keeping them would put the same sentence in two files. The duration chip is now derived from `minutes` — strictly better, because open decision #2 says the owner will retune those numbers and a hand-typed "24 hours" beside a changed `minutes` was a lie waiting to happen. `emoji-catalog.test.ts` lost one assertion and gained a pointer to where the headings live.
- **The OAuth callback's `?auth_error=` was in scope after all.** It is not on any task list, but it was redirecting Google's own prose straight into the auth page's error slot — the last path by which text written outside `messages/*.json` reached a screen.

**Two defects this pass found in code it was only supposed to move:**

1. **The emoji-category exhaustiveness check was vacuous.** `BET_EMOJI_CATEGORIES: readonly BetEmojiCategory[]` widened every `id` to `string`, so `Record<EmojiCategoryId, string>` was asserting `Record<string, string>` and passing for the wrong reason. `BetEmojiCategoryId` is a real union now.
2. **`uploadAvatar`'s error and `profile-fields.tsx`'s `onUploadError` type-checked after being narrowed to a code** — a `(v: string | null) => void` is assignable where a `(c: Code | null) => void` is expected — so both callers would have silently rendered `avatar-too-large` at a user. Caught by reading the diff, not by the compiler.

**Verified in a real browser** against the local stack, over raw CDP: the negotiation matrix (`pt`, `pt-PT`, `pt-BR`, q-values, cookie precedence, a garbage cookie); switch → cookie → account write → survives reload; new-device reconciliation landing on the account's locale after one refresh and a deliberate switch surviving two further navigations without flipping back; `locale-pt-br` off ⇒ `lang="en"` even with a `pt-BR` cookie AND a `pt-BR` `Accept-Language`, and no switcher anywhere; inline validation in both languages; `create_bet` stubbed to `raise exception … errcode XX999` producing one localized generic sentence with the raw text and SQLSTATE in `console.error` and nowhere on screen; a production build rendering real English with `NEXT_PUBLIC_I18N_DEBUG=keys` set; and the key-reveal sweep itself, in which every visible string on the dashboard, the bet page and three modals is a dotted key, and every survivor is user-generated content, a date, a numeral or a glyph.

**Text expansion, measured** at 375px and 1280px in both locales: the ticker holds one row at exactly 40px, the header holds 56px, and `document.body.scrollWidth` is byte-identical between locales at 375px (the dashboard grid's own overflow there predates this work and is unchanged by it). pt-BR's ticker measures **20px narrower** than the English — §5's compression rule working in our favour, as D10 predicted. The one place pt-BR is wider is the bet row's primary CTA (`Wager` → `Apostar`, 12px), absorbed by a title cell that was already truncating in English.

**Known and accepted, in one place:**

- The emoji picker's ~350 `name`/`keywords` stay English (Phase 4, item 1): its CATEGORIES are Portuguese, its SEARCH is English, and a pt-BR user browses instead of typing.
- `transactions.description` for `injection` (Phase 4, item 5).
- The sign-in email is bilingual rather than per-recipient, because self-hosted GoTrue has one template per type and no session to read a preference from.

---

## 9. Provenance

Written 2026-09-07 against `main` at `d756b0f`, on an audit of `apps/web/src` (90 files), `packages/shared/src` (17 files), 20 migrations and `supabase/templates/`. Requirement anchors: **UX-027** (this plan's deliverable), **UX-026** (preserved, not retired), **UX-021** (SITE_NAME), **UX-022** (`users` is where the preference lands), **UX-017/023/024** (the metadata surfaces D2 trades against), **ARC-016** (the `locale-pt-br` flag). Design anchors: `design-visual-identity.md` §3, §5.2, §5.8, §5.9, §7, §8; `design-dashboard.md` §1.1, §1.2. Library facts verified against the npm registry on 2026-09-07: `next-intl@4.14.2`, peers `next: ^12–^16`, `react: ^16.8–^19`.
