-- =============================================================================
-- Alpha launch flags — plan-hosted-early-access.md D9, Phase 1 task 2.
--
-- Two independent flips, each following the shape its existing row already
-- established rather than a shape invented for this file:
--
--   * `locale-pt-br` already exists (20260905120100_infra_tables.sql, seeded
--     false). A bare UPDATE by primary key, the same shape
--     20260906120000_team_chat.sql used for `global-team-chat` — no-op-safe on
--     a `supabase db reset` re-run. The owner confirmed ON for the alpha
--     2026-09-07 (Phase 0 part A): the pt-BR pass is complete and
--     browser-verified (plan-i18n-ptbr.md §8) and the friend group is
--     Brazilian. Unlike duel-bets there is no "an operator already turned this
--     off in Studio, respect that" concern to protect against on the FIRST
--     push of this file — dev and prod both still carry the seed's `false`
--     today, so there is nothing yet for `enabled` to clobber.
--
--   * `auth-google` does not exist yet — an ops kill switch (D7), not a
--     feature gate: whether "Continue with Google" can render depends on the
--     Google OAuth consent screen being Published, a fact that lives in
--     Google's console, not in this codebase. INSERT ... ON CONFLICT, the
--     20260906130000_duel_schema.sql shape, because the key is new (a bare
--     UPDATE would match zero rows and fail silently, and the flag would read
--     absent — which `useFeatureFlag` treats as off — with nothing anywhere
--     reporting why). `enabled` is deliberately absent from the DO UPDATE
--     list, for the same reason duel-bets' is: whoever last flipped it in
--     Studio owns the switch position, this migration only owns the
--     description.
-- =============================================================================

update public.feature_flags
   set enabled = true,
       description = 'UX-027: pt-BR localization. LIVE as of the hosted early access (plan-hosted-early-access.md D9) — this is now the kill switch, not a future-feature placeholder: the pass is complete and browser-verified (plan-i18n-ptbr.md §8). Flipping to false hides the language switcher and reverts to English-only on the next load, no deploy, no rebuild (ARC-016).'
 where key = 'locale-pt-br';

insert into public.feature_flags (key, enabled, description)
values (
  'auth-google',
  true,
  'plan-hosted-early-access.md D7/D9: ops kill switch for Google sign-in, seeded ON. Availability depends on the Google OAuth consent screen being Published in Google Cloud, not on whether the feature is finished — flipping it false hides the "Continue with Google" button on the next load (ARC-016, no deploy, no rebuild); email + password (D1) remains a complete, working alpha on its own.'
)
on conflict (key) do update
  set description = excluded.description;
