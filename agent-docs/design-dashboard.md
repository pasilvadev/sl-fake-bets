# Design: Dashboard (logged-in home)

**Status: implemented Phase-1 (mock data), 2026-09-04.** Decision process: 3 independent IA proposals (data-density / retention / shell-scalability lenses), adversarially judged by 2 judges against AGENT_SPEC + `design-visual-identity.md`. Winner: **"Feed & Pulse Rail"** (data-density), with grafts from the losers noted in §5. Visual identity doc remains binding for all styling; this doc owns the dashboard's information architecture.

## 1. Shell — no nav sidebar, three horizontal bands

The app is one dashboard + one bet-detail page (UX-015); everything else is a modal (UX-014/016). A nav sidebar would list destinations that don't exist — its pixels go to a data-carrying right rail instead.

Grid rows: **top bar 56px (sticky)** · **stat ticker 40px (not sticky)** · **body**.

### 1.1 Top bar (`sticky top-0`, `bg-surface-1 border-b`)
Left: SL S-mark (20px, currentColor) · **team switcher** trigger (team initial chip + name + chevron) opening a popover:
- One row per team in `mockTeams`: 3px jade left rail on the active row (reuses the bet-row rail motif — no second "selected" language), team name, per-team open-bet count (mono), and a reserved slot for a future per-team notification pip (ARC-015 — still empty and still unread after Extra Phase 4: nothing derives a pip from a toast, D5).
- Footer: "Create a team" row (modal stub) + **inline** "Join with invite code" input (one fewer hop than a modal; graft from retention proposal).
- Switching re-scopes everything (UX-010): feed, balance, ticker, rail, all via `TeamProvider` context.

Right, fixed order:
1. **Balance pill** — coin glyph + mono balance (current team, DOM-013); jade `+5` micro-tag docked for the daily grant (DOM-022/A-2 — automatic, never a claim button); click opens Wallet popover-equivalent (transactions modal).
2. **Invite Friends** (outline) → invite modal (UX-023 preview).
3. **Start 1v1** (outline/secondary, `rounded-sm`, sentence case — §5.3 reserves uppercase button text for the primary style, and §3's scarcity ruling keeps the cut off this bar) → start-duel modal (Extra Phase 3). Gated on plain membership and the `duel-bets` flag. **Note the asymmetry with the next entry and do not "fix" it:** in a `restricted` team an ordinary member sees Start 1v1 while Create Bet is refused, because D9 rations bets POSTED FOR THE TEAM TO WAGER INTO and a duel is a private arrangement between two people who have already agreed to it.
4. **Create Bet** (primary jade/black, `rounded-sm`, **no cut-sm here** — see §3 scarcity ruling) → create-bet modal. Disabled with tooltip when team is `restricted` and user is a plain member (DOM-002/006).
5. **Notifications bell** — permanent slot, `opacity-40 pointer-events-none`, tooltip "Notifications — coming soon" (ARC-014/015 future-stub; still inert after Extra Phase 4's toast system — no count, dot or badge is ever derived from a toast, D5).
6. **Profile avatar** (rounded-full, 1px ring in own name-color) → dropdown: Edit Profile (modal, UX-022) · Team Settings (leader/mod) / Team Info (member) · Leave team (ordinary-destructive style) · Language: English (inert stub, UX-027) · Sign out (inert Phase 1).

### 1.2 Stat ticker (40px, scrolls away, `bg-surface-0`, `overflow-x-auto` single line)
Mono `tabular-nums` chips split by vertical hairlines, pure readout, no click targets: `OPEN n` · `CLOSING SOONEST {countdown}` (jade, the strip's only live numeral) · `POOL (OPEN) n` · `YOUR RANK #n RICHEST` · `TEAM n/30`.

### 1.3 Body ≥1024px
2-col grid `minmax(0,1fr) 380px`, gap 24px, `max-w-[1600px] mx-auto`, padding 24px. Rail is `sticky top-[96px]` with own scroll. 1024–1279px: rail 320px, gap 16px.

## 2. Main column — Bet Feed

Header row: contextual eyebrow (`OPEN BETS` / per filter) + segmented control `All | Open | Closed | Resolved` (slash-notch active tick, §5.8; "All" default). Below: edge-to-edge §5.1 bet rows (rail / icon chip 44px / title + by-creator / odds preview (top-2 stacked vertically, jade `/` bullets, sans label + mono odds column, `…` + full-list tooltip for 3+ — §5.1) / POOL + countdown / avatar stack / WAGER CTA → wager modal UX-016; row body → bet-detail UX-015 — Phase 1: `href="#"` placeholder). A small ghost **share** icon sits with the CTA cluster (UX-024 home; Phase 1 copies a fake link).

Grouping (eyebrow + hairline break, never color-only): **OPEN** soonest-closing first (UX-008) → **CLOSED / AWAITING RESULT** most-recent first → **RESOLVED** most-recent first. Empty group = omitted.

**Pinning (Extra Phase 3, D4).** A duel awaiting *the viewer's* answer — or, as its mediator, *the viewer's* ruling — sorts to the top **of the group it is already in**: a pending challenge is an OPEN bet and an accepted one awaiting a ruling is a CLOSED bet, so the grouping contract above is untouched. No fourth group, no `FOR YOU` eyebrow, no cross-group section. It is a stable partition, not a re-sort: pinned rows keep their relative order and so does everything else. The pin is **per viewer** and pull-based — the same duel is an ordinary row for everybody else, and nothing is pushed at anyone (ARC-014: no bell, no badge, no tab title, no toast on arrival). It is also the whole reason the feed, and not the row, decides which row is featured (§3).

Resolved rows: winner option jade `/` + N8 600-weight, losers N6 400 + line-through odds; user's own outcome replaces CTA: `/ WON +n` jade mono or `\ LOST n` N6 mono; non-participant = neutral, no glyph.

## 3. Scarcity ruling (documented exception to §4.3/§5.3/§5.6 co-occurrence)

The dashboard's **one** diagonal cut = one feed row (icon chip + CTA `cut-sm` + 6% jade corner tint). Therefore, on this screen: top-bar Create Bet renders flat (`rounded-sm`), top-bar Start 1v1 renders flat, leaderboard teaser rank-1 renders flat. `cut-sm` on the primary CTA is legitimate only where no competing cut exists (empty-state CTA); rank-1 `cut-sm` lives in the full-leaderboard modal (own viewport budget). Deliberate, not silent divergence (AGENT_SPEC §0).

**Which row gets it — reassigned by Extra Phase 3, task 6** (this paragraph previously read "the single soonest-closing OPEN row … + pulsing rail when <1h"). The cut goes to **a duel awaiting the viewer's answer or ruling** when there is one, and to the soonest-closing open pool bet otherwise. The cut is the strongest "look here" the system owns and a decision only you can make outranks a clock everyone can see. The <1h treatment did NOT move with it: the pulsing rail, `CLOSING SOON` and the jade countdown still belong to the soonest-closing open bet whether or not it also carries the cut — see `design-visual-identity.md` §5.1/§5.2, where the two jobs are now two separate props. Allocation happens once, in `bet-feed.tsx`, so "exactly one" is a property of the feed rather than a hope about the rows.

## 4. Pulse Rail (4 modules, top→bottom by check-frequency)

1. **Wallet** — big mono balance numeral (N8) + coin glyph; "Daily login: +5 today ✓" line (auto-grant); "Your P/L" slash-glyph line (DOM-026); "View transaction history" → modal (DOM-025 dense rows: date · description · delta · balance-after); disabled **Donate Coins** button, tooltip "Coming soon" (DOM-023 future-stub; the long-term home is also a per-name user popover — post-MVP).
2. **Standings** — segmented tab **Richest** (default, DOM-027) / **Poorest** (DOM-028): same compact row shape (rank digit mono, avatar, name in own name-color + inline parallelogram rank badge DOM-029, amount right mono). Top 5 + "View full leaderboard" → modal. Poorest carries dry copy (rank-1 tagline "House's favorite donor"; all-zero P/L → "Everyone's still solvent. Suspicious.").
3. **Team** — "n / 30 members", avatar cluster (max 6 + `+N`), Invite button (redundant entry, expected here), **Manage Team** (leader/mod → Team Settings modal: access-mode toggle DOM-002, roster with kick/ban DOM-031 ember ordinary-destructive, leader-only per-row Inject Coins DOM-024, danger zone type-to-confirm delete DOM-033/034) / **View Team** (member, read-only variant).
4. **Team Chat (UX-019, Extra Phase 1)** — `TEAM CHAT` eyebrow + unread-count badge, header **expand** control. In-place scrollback over the most recent ~30 messages (§5.7 anatomy: dense rows, no bubbles, 24px avatar, name-color `UserName` + inline rank badge, mono trailing timestamp); working composer pinned to the panel bottom, the `/` send glyph live (jade on hover, §5.7). A "See earlier messages" control sits above the oldest loaded row — it and the header expand control both open the same full-scrollback chat modal (owner decision D4, Extra Phase 1): rail and modal read one store slice, never two independent copies of the same messages. Distinct from per-bet chat (UX-018, bet-detail only).

## 5. Grafts adopted from losing proposals
- Richest/Poorest as one tabbed module (retention proposal).
- Inline join-code input in switcher popover (retention).
- Reserved per-team notification pip slot in switcher rows (shell proposal).
- 3px jade rail as active-team indicator (shell).
- Access-mode gating of Create Bet/Invite computed in the shell, not implicit in the modal (shell).
- Judge-gap fixes: bet-row share affordance (UX-024), "Leave team" home, language stub (UX-027), all bespoke animations wrapped in `prefers-reduced-motion`.

## 6. Responsive tiers (one structural swap only)
- **≥1280px** full grid. **1024–1279px** rail 320px.
- **768–1023px** rail column removed → **module chip strip** (~56px, horizontal scroll) under the ticker: Wallet / Standings / Team / Chat chips, each opening its module as a bottom sheet (mirrored `cut-md`, §5.4). Feed full width. Below `lg`, that sheet **is** the whole chat experience (Extra Phase 1): "See earlier messages" pages further history in place inside the sheet, rather than stacking the full-scrollback modal on top of a sheet that already holds the same surface.
- **<768px** top bar keeps S-mark + switcher + balance + avatar (Invite & bell move into avatar sheet). Bet rows use §5.1 stacked mobile layout (~96px). Modals = bottom sheets. The Create-Bet swap is **not** in this tier — it has its own bound, below.
- **<640px** (Tailwind's `sm`; everything in the `<768px` tier still applies, so 640–767px keeps both compose buttons in the top bar) **Create Bet leaves the top bar and becomes a 56px circular jade FAB** bottom-right (circle sanctioned via §4.1 icon-button exception; it also frees the one-cut budget for the closing-soon row) (Extra Phase 4, task 6 — this clause previously sat inside the `<768px` bullet and read "**Create Bet becomes a 56px circular jade FAB** bottom-right"). `create-bet-fab.tsx` gates on `sm:hidden` and the top bar's button on `sm:inline-flex`; Tailwind's `sm` is 640px and this codebase declares no `--breakpoint-*` override, so the swap has been at 640px since Phase 1 — the doc moves to the code, because moving the code instead would re-lay-out every `sm:` in the app. A toast strip also clears this tier by `--fab-stack-height` (`design-visual-identity.md` §5.9).
  **Two FABs since Extra Phase 3** (this bullet previously described one): Start 1v1 joins it as a 44px (`size-11`) outline circle stacked `gap-3` above the 56px primary — §5.3 caps the screen at one jade fill, and the smaller secondary also puts the primary nearest the thumb. They are two independently gated elements inside one bottom-anchored column, never two children of one guard: the gates genuinely differ (`canCreateBet` vs plain membership + the `duel-bets` flag), so a one-button stack is ordinary — in a `restricted` team an ordinary member gets the duel FAB and no Create Bet FAB. `--fab-stack-height` was bumped to `8rem` (16px inset + 56 + 12 gap + 44) in `globals.css` **and nowhere else**; it describes the stack at its tallest, so a one-button stack simply leaves the toast strip more air than it needs, which is the safe direction.

## 7. Empty & loading
- Zero-bets team (t-02/t-03 exercise this live): ghost S-mark watermark 5% + "No bets yet. Someone has to make the first bad decision." + Create Bet CTA (`cut-sm` legitimate here).
- Zero transactions: "No transactions yet."; all-zero P/L: solvent line (§4.2 copy).
- Zero-message chat (Extra Phase 1): the same shared ghost pattern (`design-visual-identity.md` §5.10), not a bespoke chat treatment — S-mark watermark + one dry line, no CTA (there is nothing to click, only something to type).
- Skeletons: row-shaped, opacity-breathe 0.4↔0.6, no shimmer.

## 8. Implementation map (`apps/web/src`)

> Written for Phase 1 and amended per phase since; it is a map of the surfaces this document specifies, not an inventory of the tree. Rows added after Phase 1 name their phase.
- `lib/team-context.tsx` (current team/user/role state), `lib/modal-context.tsx` (single modal mount), `lib/format.ts` (coins, countdown, dates).
- `components/sl/`: `s-mark`, `coin-amount` (glyph + mono, delta variant `/ +n` · `\ −n`), `user-name` (name-color + rank badge), `rank-badge` (parallelogram), `avatar-cluster`, `modal-shell` (§5.4 chrome); Extra Phase 3: `versus` (§5.6, two opposed identity clusters), `player-search` (§5.8, the app's one combobox).
- `components/shell/`: `top-bar` (gained Start 1v1, Extra Phase 3), `team-switcher`, `ticker`, `profile-menu`, `create-bet-fab` (the mobile FAB stack — two buttons since Extra Phase 3, §6).
- `components/dashboard/`: `bet-feed`, `bet-row`, `empty-state`; `rail/`: `pulse-rail`, `wallet-module`, `standings-module`, `team-module`, `module-chip-strip`; Extra Phase 1 replaced `chat-stub-module` with `chat-module` + `chat-thread` (§4.4).
- `components/modals/`: `modal-root` (the single mount point) over `wager`, `create-bet`, `invite`, `standings-full`, `transactions`, `profile`, `team-settings`, `create-team`, `leave-team`, `chat` (Extra Phase 1); Extra Phase 3: `start-duel` (compose, D1/D5/D7/D9) and `duel-accept` (answer, D3/D5).
- `components/bet/`: `bet-detail-page` — the one full-page nav (UX-015), with the duel layout and the by-person resolve panel (§5.11, Extra Phase 3).
- Modals mutate nothing (Phase 1, ARC-010/013): client state only, resets on reload.

Known deferred surfaces (not dashboard scope): logged-out landing (UX-017), crowd-resolution placeholder (DOM-020, belongs to bet-detail). Bet detail shipped in a later phase and is listed above.
