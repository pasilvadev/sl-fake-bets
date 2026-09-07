# messages/ — every word a user can read

**To change any text in the app, edit one of the two files in this folder.**
`en.json` is the English, `pt-BR.json` the Portuguese. Save; the dev server
reloads. There is no component to open, no build step, no other place a
user-visible sentence lives.

Full reasoning in `agent-docs/plan-i18n-ptbr.md`. This file is the short
version, so the conventions survive a session that has not read the plan.

---

## Finding the string you want to change

Three ways, in the order you would reach for them:

1. **The namespace is the filename.** A string in
   `src/components/modals/wager-modal.tsx` lives under `"wagerModal"`. One in
   `src/components/dashboard/bet-row.tsx` lives under `"betRow"`. camelCase,
   one hop, no index to maintain.
2. **Search the English.** `en.json` holds the exact sentence you see on
   screen. Paste it into a search, land on the key, edit that same key in
   `pt-BR.json`.
3. **Key-reveal mode.** Put `NEXT_PUBLIC_I18N_DEBUG=keys` in
   `apps/web/.env.local` and restart the dev server. Every translated string
   renders as its own key instead of its text, so you can point at anything on
   screen, read `wagerModal.cap.atMax`, and edit that line. Inert in a
   production build regardless of the value.

## The cross-cutting namespaces

Four namespaces are not named after a file, because their strings are shared:

| Namespace | What lives there |
|---|---|
| `errors` | Every failure sentence the app can produce, one per `MutationErrorCode`, alphabetical. There is no second place an error sentence can hide. |
| `validation` | The inline field errors, one per `ValidationIssue` code. |
| `state` | The §5.2 uppercase state vocabulary (`OPEN`/`ABERTA`, …) and the five void labels — shared by the bet row, the detail page and the ticker. |
| `format` | Countdown unit letters (`d`/`h`/`m`/`s`) and the words `closed`, `just now` and the `{n} ago` frame. |

Plus two conveniences: `common` (genuinely app-wide, currently just
`language`), and `emptyState` — the §5.10 ghost-pattern lines. `emptyState` is
the one deliberate exception to rule 1: the copy is passed as a prop from
several callers, and the five dry lines read better edited side by side than
scattered across the files that happen to render them.

## Rules for editing

- **Keys are semantic, never the English text.** `wagerModal.notFound.title`,
  not `betNotFound`. A key derived from the sentence orphans the translation
  the moment the sentence changes — which is exactly the change this setup
  exists to make cheap.
- **`en.json` is the key authority.** Add a key there first. `pt-BR.json` is
  type-checked against it, so a missing or misspelled key fails
  `pnpm typecheck` rather than surfacing at runtime. If you only have the
  English, add the English to both and translate later — a pt-BR value that is
  still English is visible; a missing key is not.
- **Never translate a language's own name.** "Português" reads Português in
  the English UI too. Those labels live in `src/i18n/config.ts`, deliberately
  outside these files.
- **"SL" is never translated or expanded** (UX-021). Where a sentence needs it,
  it arrives as `{siteName}`.
- **User-generated content is never in here**: bet titles, option labels, team
  names, display names, chat messages, comments, invite codes.

## Writing the Portuguese

`design-visual-identity.md` §7 is the voice spec and §8 is the banned list;
both apply to the Portuguese. The rulings that make it tractable:

- **The nouns are fixed.** `bet` = **aposta** (feminine), `duel` = **duelo**
  (masculine), `team` = **time** (masculine), `coin` = **moeda** (feminine),
  `wager` = **aposta** / the verb **apostar**. Fixing the head nouns fixes
  every adjective downstream: `OPEN`→`ABERTA`, `CLOSED`→`FECHADA`,
  `VOID`→`ANULADA`, `RESOLVED`→`RESOLVIDA`.
- **Never inflect for the player's gender.** The app has no gender field and
  must not acquire one. Prefer verb phrases and non-inflecting nouns over agent
  nouns — *"House's favorite donor"* is **"Quem mais financia a casa"**, not
  *"Doador oficial da casa"*.
- **Register: Brazilian informal `você`.** Never `tu`, never `vós`, never the
  corporate-formal imperative.
- **Two Portuguese-specific bans**, on top of §8's list: **"Ops!"** is banned
  exactly as *"Oops!"* is, and **exclamation marks are banned in error copy**.
- **Accents survive uppercase.** `ANULADA · NÃO ACEITA A TEMPO`, `FECHA ÀS 18H`
  — standard pt-BR keeps diacritics in caps, and `tracking-wider` at 11px
  renders them fine.
- **Portuguese runs 15–25% longer than English.** When a translation breaks a
  tight layout the fix is to compress the COPY first — `FECHANDO` over
  `FECHA EM BREVE` — and never to shrink §3's type scale.

Calibration lines, for matching the register:

| English | pt-BR |
|---|---|
| No bets yet. Someone has to make the first bad decision. | Nenhuma aposta ainda. Alguém tem que tomar a primeira decisão ruim. |
| Nobody's lost anything here. Yet. | Ninguém perdeu nada aqui. Ainda. |
| Everyone's still solvent. Suspicious. | Todo mundo ainda tá no azul. Suspeito. |
| Not enough coins. | Saldo insuficiente. |
| `VOID · COULDN'T COVER IT` | `ANULADA · SEM SALDO` |
