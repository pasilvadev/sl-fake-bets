-- =============================================================================
-- Per-account UI language — plan-i18n-ptbr.md Phase 1, task 9 (UX-027).
--
-- The preference follows the PERSON, not the URL and not the device: D2 keeps
-- the `[locale]` segment out of the route tree, and this column is what makes
-- a switch on a laptop show up on a phone.
--
-- Nullable and defaultless, both on purpose:
--
--   * NULL means "never chose", which is the state that lets `Accept-Language`
--     keep deciding. A `default 'en'` would silently record every existing row
--     as an explicit English choice, and a Brazilian signing in on a pt-BR
--     browser would then get English because the account "already decided".
--   * There is no separate "has chosen" boolean for the same reason
--     `onboarded_at` has none: the value and the fact of having one are the
--     same fact asked twice.
--
-- The check pins the two locales `src/i18n/config.ts` declares rather than a
-- shape like `name_color`'s hex pattern, because unlike a swatch this list IS
-- a code-level contract — `LOCALES` and this constraint have to agree or the
-- client writes a value the column rejects. Adding `es` (Phase 4, item 3) is a
-- one-line migration, and that is the right amount of friction for it.
--
-- No policy and no grant changes. `users_select_self_or_teammate` is row-wide,
-- `users_update_self` already covers "the caller's own profile row", and
-- 20260905120400_rls_policies.sql line 320 already grants update on the table.
-- Teammates being able to read each other's locale is harmless and unused —
-- only `currentUser.locale` is ever consulted.
-- =============================================================================

alter table public.users
  add column locale text check (locale in ('en', 'pt-BR'));

comment on column public.users.locale is
  'Chosen UI language (UX-027). NULL = never chose; Accept-Language decides. '
  'Read by loadTeamData onto currentUser, reconciled into the NEXT_LOCALE '
  'cookie client-side — never read during locale negotiation (see D3).';
