# SL — Visual Identity Guide

Dark-mode-only design system for SL Fake Bets. Synthesizes color science, typography/motif, component specs, and interaction rules into one system. Every value below is implementable directly as Tailwind v4 `@theme` tokens / shadcn CSS vars in `apps/web/src/app/globals.css`.

> Brand is **"SL"** — never spell out the old name. The stencil-cut "S" mark and its two-parallel-diagonal-cut construction (source: `old-soulless-bg.jpeg`) is the one reusable asset — reuse 1:1, never redraw the mark itself. That 1:1 trace now exists as `sl/s-mark.tsx`; use it, and see §4.3 for what the mark's geometry actually is. The faceted dark background in that lockup is **not** part of the in-product system (see Banned List #10-adjacent).

### 0.1 Spec deviation from AGENT_SPEC

**Owner ruling 2026-09-05 — the rust hue.** Principle 2 below ("no traffic lights, ever") is relaxed for *outcome polarity only*: a low-chroma reddish brown, `--rust-*` (H=25°), now carries loss, bad odds and the bottom of the leaderboard. It is deliberately **not** a stoplight red — it sits at the same lightness as N6, so it reads as a muted terracotta rather than an alarm, and every glyph/weight/shape signal it accompanies (`\` prefix, line-through, `cut-mirror`) stays in place: rust is a *second* channel, never the only one. Rust is distinct in role from ember: **ember = the action you are about to take is destructive; rust = the outcome already went badly.** See §2.3b. Proposed-and-applied per AGENT_SPEC §0.

Supersedes AGENT_SPEC **UX-020** ("visual identity strictly black and white") per owner-approved jade accent + the ember/name-color exceptions in §2.2–2.4. `AGENT_SPEC.md` UX-020 has been updated in lockstep to read: "Visual identity is black/white with jade as the sole brand accent, plus the ember destructive hue and 10 curated name colors as sanctioned exceptions (see `design-visual-identity.md`); no other decorative brand colors; traffic-light red/green/yellow banned for state." Proposed-and-applied, not a silent divergence, per AGENT_SPEC §0.

---

## 0. Quick knobs

The ~10 values you'd actually reach for. Each links to its section/token.

| Want to change... | Token(s) | Section |
|---|---|---|
| **The jade itself** (brand hue) | `--jade-base` (UI color, `#0CD083`) vs `--jade-raw` (logo-only, `#00FF98`) | §2.2 |
| **How "loud" jade feels overall** | `--jade-wash` / `--jade-border` / `--jade-muted` / `--jade-glow` steps | §2.2 |
| **Background depth (how black is black)** | `--surface-0/1/2/3` (N0–N3) | §2.1 |
| **Jade glow frequency** | Glow Ration rule — max 1 glowing element per screen | §6 |
| **Diagonal motif angle** | the offset ratio in each `@utility cut-*` rule (vertical px ÷ horizontal px, ~2.48 everywhere) — `--brand-slash-angle`/`--brand-slash-rad` are reference constants only, not wired to any utility | §4.3 |
| **Corner radius (roundedness)** | `--radius` — the one lever; `--radius-sm/md/lg` are `calc()`-derived from it | §2.5 |
| **The one supporting/destructive hue** | `--ember-*` ramp (H=45, copper) | §2.3 |
| **The loss/"bad outcome" hue** | `--rust-*` ramp (H=25, reddish brown) | §2.3b |
| **Name-color palette (usernames)** | `--name-color-1..10` | §2.4 |
| **Win/loss visual language** | Slash-glyph system (`/` jade vs `\` muted), §5.2 | §2.3, §5.2 |
| **Motion speed budget** | Duration table | §6 |

---

## 1. Identity, in one paragraph (UX-021)

SL is a black-and-white app with exactly one loud color: jade. It borrows the stencil/slash cut from its own wordmark as its single geometric signature — used sparingly, never as wallpaper. Every "is this good or bad" moment (won a bet, lost a bet, void, closing soon, destructive action) is solved without red, green, or yellow, because color is reserved for one job: jade means "alive / brand / gain." Everything else is monochrome, told apart by weight, direction, and the two diagonal cuts that already exist in the logo (`/` and `\`). Density beats whitespace — this is a Twitch-adjacent data app, not a airy productivity tool. Nothing here should look like it was scaffolded from a component-library template.

### Design principles (memorize these seven)
1. **One accent, one job.** Jade means gain / brand / open / alive. It is never a decoration, never a random highlight, never a second "info" color.
2. **No traffic lights — one exception.** Open/closed/void/error are told apart by shape, glyph, weight, motion, or jade-vs-neutral; nothing in the system is ever stoplight red, green, or yellow. The single sanctioned exception is `--rust` on *bad outcomes* (loss, bad odds, bottom of the board) — a muted reddish brown, always stacked on top of the glyph/weight/shape signal rather than replacing it (§2.3b, owner ruling 2026-09-05).
3. **Scarcity is the brand.** Max one diagonal cut visible per viewport, max one jade glow per screen, max one drop-shadow (the modal overlay) in the whole app. Repetition of a "signature" element turns it into wallpaper — the fastest way to look generic.
4. **Weight over color for hierarchy.** Two text colors handle 90% of the UI (white full-emphasis, muted-gray secondary). A third tier of emphasis is jade, never a third gray.
5. **Numbers are mono, prose is sans.** Any figure the user compares or scans (odds, coins, timers, ranks) is Geist Mono + `tabular-nums`. Numbers embedded in a sentence stay Geist Sans.
6. **Cheap by construction.** No blur walls, no stacked shadows, no shimmer sweeps. Elevation is a lightness step + a hairline border. This is a performance requirement (UX-006), not a style preference.
7. **Dry, deadpan voice, never corporate.** Empty states and the "podium of the poor" carry their meaning through copy/humor, not iconography color. See §7.

---

## 2. Color

All values computed OKLCH → sRGB with real WCAG contrast math (not eyeballed). Hue anchor is the WoW-Monk jade `#00FF98` (`oklch(0.879 0.214 155.7)`) rounded to a working hue of **158°**, used for every neutral and jade step so the whole palette reads as "mixed from one paint," not brand-color-pasted-on-generic-gray.

### 2.1 Neutral ramp (N0–N8)

Slightly jade-tinted (chroma 0.002–0.008 — below the point of looking colored, but enough that neutrals and the jade accent feel related). Three depth tiers, each one lightness stop up — elevation reads via brightness, never shadow weight.

| Token | Alias | Role | OKLCH | Hex | Contrast vs N0 |
|---|---|---|---|---|---|
| N0 | `--surface-0` / `--background` | Page canvas | `oklch(0.145 0.006 158)` | `#080B09` | — |
| N1 | `--surface-1` / `--card` / `--sidebar` | Docked panels, cards, rows | `oklch(0.185 0.006 158)` | `#111412` | 1.07:1 |
| N2 | `--surface-2` / `--popover` | Floating: modal, dropdown, popover | `oklch(0.225 0.007 158)` | `#191D1A` | 1.16:1 |
| N3a | `--surface-3` | Hover/pressed fill, topmost menu row | `oklch(0.265 0.007 158)` | `#232624` | 1.30:1 |
| N3b | `--border` | Hairline border (decorative wash) | `oklch(0.300 0.008 158)` | `#2B2F2C` | 1.46:1 |
| N4 | `--input` | Border strong / input outline | `oklch(0.365 0.008 158)` | `#3B403D` | 1.87:1 |
| N5 | `--void` | Muted/disabled text, tertiary icons | `oklch(0.520 0.008 158)` | `#656A67` | **3.59:1** (large text/icons only) |
| N6 | `--muted-foreground` / `--negative` | Secondary text, loss numerals | `oklch(0.665 0.007 158)` | `#909592` | **6.50:1** ✅ |
| N7 | `--foreground` | Primary text (default body) | `oklch(0.895 0.004 158)` | `#DADDDB` | **14.45:1** ✅ |
| N8 | `--text-strong` | Headings, hero numerals only | `oklch(0.985 0.002 158)` | `#F9FAF9` | **18.90:1** ✅ |

**N3a and N3b are two different lightness steps, not aliases** — N3a (hover/pressed fill) and N3b (hairline border) never share one value; don't read them as the same token.

**Reading the "Contrast vs N0" column**: for N1–N4 (surfaces) these ratios measure adjacent-surface *elevation* separation and are intentionally low/ungraded. Only N5–N8 (text/icon roles) are checked against the 4.5:1 small-text bar — don't read N1–N4's low numbers as "failing" anything. And **never use N5 for uppercase labels, table columns, or badge text regardless of apparent size** — N5 clears only large-text/icon thresholds; any of those contexts needs N6 or brighter.

**Rule**: default body text is **N7**, not N8. Reserve true white (N8) for headings and hero numerals (odds, coin totals) — an entire UI in pure white on near-black causes visible eye fatigue on OLED/weak panels.

### 2.2 Jade ramp (hue 158)

Raw Monk jade (`#00FF98`) is a **glow reference**, not a UI fill — its luminance (0.74) is too hot to hold small text or sit under white text. The UI-base sits one step down, at `oklch(0.755 0.175 158)`.

| Step | Token | Use | OKLCH | Hex |
|---|---|---|---|---|
| jade-wash | `--jade-wash` / `--accent` | Subtle bg tint: hover rows, positive chip bg | `oklch(0.240 0.050 158)` | `#052616` |
| jade-border | `--jade-border` | Focus-adjacent border, active-row top line | `oklch(0.340 0.075 158)` | `#074328` |
| jade-muted | `--jade-muted` | Icons / large text only (fails small-text contrast) | `oklch(0.520 0.115 158)` | `#157C4F` |
| **jade-base** | `--jade-base` / `--primary` / `--ring` | **UI base**: buttons, links, focus ring, live/open indicator | `oklch(0.755 0.175 158)` | `#0CD083` |
| jade-glow | `--jade-glow` | Glow/live-pulse only (see Glow Ration, §6) | `oklch(0.860 0.195 158)` | `#25F69E` |
| jade-raw | `--jade-raw` | **Reference only** — logo, marketing, never product UI | `oklch(0.879 0.214 155.7)` | `#00FF98` |

**Contrast** — the load-bearing rule: **jade-base is the floor for anything holding small text**, either as text-on-dark or as a button fill with black text. Everything darker (wash/border/muted) is decorative/iconography only.

| Pair | Ratio | Verdict |
|---|---|---|
| jade-base text on N0 | 9.76:1 | ✅ safe as link/text color |
| **black text on jade-base fill** | **10.37:1** | ✅ the only safe button combo |
| white text on jade-base fill | 2.03:1 | ❌ fails hard — never white-on-jade |
| jade-muted text on N0 | 3.79:1 | fails 4.5:1 — icons/large-UI only |

`--primary-foreground` **must be black**, not the shadcn-default white.

### 2.3 Semantic states — no traffic lights

Two different concerns, two different treatments:

| Concern | Frequency | Treatment |
|---|---|---|
| **Outcome polarity** (won/lost a bet) | Constant, routine | Never looks like an error. Asymmetric emphasis: wins pop in jade, losses recede into rust — same lightness as the muted gray it replaced, so it dims rather than shouts. |
| **Destructive/irreversible action** (delete team, remove member) | Rare | Gets a real warning language — the one sanctioned supporting hue, ember. |

| State | Color | Mechanism |
|---|---|---|
| Win / profit | `--positive` = jade-base `#0CD083` | `/` glyph prefix (mirrors logo's forward cut), e.g. `/ +240` |
| Loss / negative | `--negative` = rust-base `#CC7770` | `\` glyph prefix (mirrors logo's second cut), e.g. `\ −180`. The glyph still carries it alone; rust is the second channel (§2.3b) |
| Void / draw / refunded | `--void` = N5 `#656A67` | No pill badge (pills are reserved for team tags, see Banned List #2). Label `VOID · REFUNDED` in N6 + a single thin diagonal hairline drawn across the row |
| Open | jade-base solid dot | "Open" = alive = brand |
| Closing soon | Same jade dot, animated pulse (opacity 100→60→100, 1.6s) + countdown promoted to N8 | Urgency = motion + weight, not a new hue |
| Closed / awaiting result | N5 dot, no animation, row `opacity-90` | No accent at all — closed = quiet |
| Destructive (ordinary trigger) | Neutral surface + ember icon/border only | Text stays N7, only icon/border tinted |
| Destructive (final confirm button) | ember-solid fill + **black** text | Escalating weight matches escalating irreversibility |
| Warning / validation error | ember-icon (icon only) + ember-border (banner edge) | Body copy stays neutral; only icon/border tinted |

**The ember ramp** (H=45°, warm copper — chosen specifically to avoid reading as stoplight-red or caution-yellow):

| Step | Token | Use | OKLCH | Hex |
|---|---|---|---|---|
| ember-wash | `--ember-wash` | Destructive row hover bg | `oklch(0.240 0.045 45)` | `#31180C` |
| ember-border | `--ember-border` | Destructive/warning card border | `oklch(0.340 0.065 45)` | `#532C1A` |
| ember-icon | `--ember-icon` | Icons, warning glyphs | `oklch(0.600 0.110 45)` | `#B66946` |
| **ember-solid** | `--destructive` | Final destructive button fill only | `oklch(0.600 0.154 45)` | `#C85C22` |

Contrast on ember-solid: black text 5.01:1 ✅ / white text 4.19:1 ❌. `--destructive-foreground` **must be black** — inverts the shadcn default, flag this in implementation.

**Hard rule**: ember never colors a state *word*. Never `−R$50` in ember, never "LOST" in ember. It only fills icons, thin borders, and the one final confirm-button background.

### 2.3b The rust ramp — bad outcomes (owner ruling 2026-09-05)

H=25°, reddish brown. Chosen to sit **below** ember in chroma and **above** it in lightness, so the two never compete: ember is a saturated copper you only meet on destructive controls, rust is a desaturated terracotta you meet constantly on numbers. `--rust-base` is pinned to N6's lightness on purpose — swapping N6 for it changes hue, not perceived weight, so no layout re-reads as louder than before.

| Step | Token | Use | OKLCH | Hex |
|---|---|---|---|---|
| rust-wash | `--rust-wash` | Losing-option fill, poor-podium row bg | `oklch(0.240 0.044 25)` | `#311614` |
| rust-border | `--rust-border` | Losing-option card border, `BOTTOM 5` badge edge | `oklch(0.345 0.065 25)` | `#562B28` |
| rust-muted | `--rust-muted` | Fills and hairlines only (3.16:1 vs N0 — never text) | `oklch(0.500 0.088 25)` | `#8F4E49` |
| **rust-base** | `--rust-base` / `--negative` | Loss numerals, losing labels/odds, poor-podium digits | `oklch(0.660 0.108 25)` | `#CC7770` |

Contrast of rust-base: **6.06:1** on N0, 5.70 on N1, 5.23 on N2, 4.67 on N3, and **5.09:1 on rust-wash** — clears 4.5:1 small-text on every surface it is used over.

**Where rust is allowed**: loss/negative deltas (`CoinDelta`), the losing options of a resolved bet (label, pool figures, line-through odds, row fill and border), the Poorest leaderboard tab and its podium (digits, tab tick, row wash, mirrored bottom hairline, "House's favorite donor" line), the `BOTTOM 5` rank badge, a bottom-five "Your rank" ticker chip, and an overdrawn wallet balance.

**Where rust is banned**: any *action* (that's ember), open/closed/void state (void is a refund, not a loss — it stays N5/N6), category or identity color, and as the sole signal for anything. If you delete the `\` prefix, the line-through or the `cut-mirror` and the meaning survives only because of the hue, the treatment is wrong.

### 2.4 Name colors (Twitch-style, 10 curated) (UX-022)

The **one deliberate exception** to black/white/jade — user display names need individual color. Excludes 130–190° (jade collision), 25–65° (ember/rust collision), and 65–130° (yellow-green, reads as caution) entirely. What's left: one coherent cool-to-magenta "electric jewel-tone" family, same lightness recipe (L≈0.60–0.65). All 10 verified ≥4.5:1 against N2 (the strictest surface — modal/popover), meaning they clear N0/N1 by a wider margin. Minimum safe usage: **≥14px, weight ≥500** — these margins assume non-subpixel-thin glyph strokes.

| Name | OKLCH | Hex | vs N0 | vs N1 | vs N2 |
|---|---|---|---|---|---|
| Harbor Teal | `oklch(0.605 0.091 200)` | `#2C9297` | 5.33 | 5.00 | 4.60 |
| Signal Cyan | `oklch(0.610 0.097 218)` | `#2C91AA` | 5.40 | 5.07 | 4.66 |
| Skyline Blue | `oklch(0.610 0.116 236)` | `#2B8DBF` | 5.33 | 5.00 | 4.60 |
| Voltage Blue | `oklch(0.625 0.172 254)` | `#2D88EC` | 5.50 | 5.17 | 4.74 |
| Indigo Pulse | `oklch(0.625 0.178 272)` | `#647BF1` | 5.31 | 4.98 | 4.58 |
| Ultraviolet | `oklch(0.635 0.186 290)` | `#8C70F2` | 5.38 | 5.05 | 4.64 |
| Neon Orchid | `oklch(0.648 0.224 308)` | `#B45CF5` | 5.46 | 5.14 | 4.71 |
| Magenta Static | `oklch(0.650 0.266 326)` | `#DB36E3` | 5.32 | 4.99 | 4.59 |
| Flare Pink | `oklch(0.650 0.244 344)` | `#EC35B3` | 5.39 | 5.06 | 4.65 |
| Coral Flare | `oklch(0.645 0.229 2)` | `#F33483` | 5.30 | 4.97 | 4.57 |

Voltage Blue and Neon Orchid had the thinnest N2 margins (4.56:1 / 4.58:1 — too close to the 4.5:1 cliff to survive subpixel AA / monitor variance); both got a small L bump, now ≥4.71:1.

**"Same lightness recipe" is not full perceptual-weight parity.** Chroma ranges 0.091 (Harbor Teal) to 0.266 (Magenta Static) at matched L — the high-chroma magenta/pink stops read visibly louder than the low-chroma teal/cyan stops. This isn't an oversight: teal/cyan at L≈0.60 has a narrower sRGB gamut, so pushing those hues to a shared higher chroma (e.g. ≈0.15) clips out of gamut before reaching it (verified: Harbor Teal at C=0.15 computes a negative red channel). Equalizing chroma across this full hue range at this lightness isn't achievable in sRGB — so the parity claim here is scoped to lightness and legibility only, not loudness; if a name reading "louder" than another matters for a specific surface, don't rely on this palette alone for that.

Chart series (option A/B/C… in odds displays, §5.5) reuse this same 5-hue subset (`--chart-1..5`) rather than a rainbow palette — see §4.4 for how 2–6 options are told apart without extra hues.

### 2.5 Full `globals.css` `:root` block

Dark-only — collapse the shadcn light/`.dark` split into a single `:root`.

```css
:root {
  /* ---- shadcn/tailwind v4 core tokens ---- */
  --background: oklch(0.145 0.006 158);            /* #080B09  N0 */
  --foreground: oklch(0.895 0.004 158);            /* #DADDDB  N7 */

  --card: oklch(0.185 0.006 158);                  /* #111412  N1 */
  --card-foreground: oklch(0.895 0.004 158);       /* #DADDDB  N7 */

  --popover: oklch(0.225 0.007 158);               /* #191D1A  N2 */
  --popover-foreground: oklch(0.895 0.004 158);    /* #DADDDB  N7 */

  --primary: oklch(0.755 0.175 158);               /* #0CD083  jade-base */
  --primary-foreground: oklch(0 0 0);              /* #000000  black — NOT white, see §2.2 */

  --secondary: oklch(0.300 0.008 158);             /* #2B2F2C  N3 */
  --secondary-foreground: oklch(0.895 0.004 158);  /* #DADDDB  N7 */

  --muted: oklch(0.225 0.007 158);                 /* #191D1A  N2 */
  --muted-foreground: oklch(0.665 0.007 158);      /* #909592  N6 */

  --accent: oklch(0.240 0.050 158);                /* #052616  jade-wash */
  --accent-foreground: oklch(0.755 0.175 158);     /* #0CD083  jade-base */

  --destructive: oklch(0.600 0.154 45);            /* #C85C22  ember-solid */
  --destructive-foreground: oklch(0 0 0);          /* #000000  black — white fails 4.19:1 */

  --border: oklch(0.300 0.008 158);                /* #2B2F2C  N3 */
  --input: oklch(0.365 0.008 158);                 /* #3B403D  N4 */
  --ring: oklch(0.755 0.175 158);                  /* #0CD083  jade-base — only focus color in the app */

  --chart-1: oklch(0.605 0.091 200);   /* #2C9297 Harbor Teal */
  --chart-2: oklch(0.610 0.116 236);   /* #2B8DBF Skyline Blue */
  --chart-3: oklch(0.625 0.178 272);   /* #647BF1 Indigo Pulse */
  --chart-4: oklch(0.648 0.224 308);   /* #B45CF5 Neon Orchid */
  --chart-5: oklch(0.650 0.244 344);   /* #EC35B3 Flare Pink */
  /* Note: chart-N = name-color-(2N−1) — every other curated hue for max
     separation, not the first five in sequence; don't assume chart-2 ==
     name-color-2 (it's name-color-3, Skyline Blue). */

  --sidebar: oklch(0.185 0.006 158);               /* #111412  N1 */
  --sidebar-foreground: oklch(0.895 0.004 158);    /* #DADDDB  N7 */
  --sidebar-primary: oklch(0.755 0.175 158);       /* #0CD083 */
  --sidebar-primary-foreground: oklch(0 0 0);      /* #000000 */
  --sidebar-accent: oklch(0.240 0.050 158);        /* #052616 */
  --sidebar-accent-foreground: oklch(0.755 0.175 158);
  --sidebar-border: oklch(0.300 0.008 158);        /* #2B2F2C */
  --sidebar-ring: oklch(0.755 0.175 158);

  /* ---- depth / elevation (lightness steps, not shadows) ---- */
  --surface-0: oklch(0.145 0.006 158);  /* #080B09 = --background, canvas */
  --surface-1: oklch(0.185 0.006 158);  /* #111412 = --card/--sidebar */
  --surface-2: oklch(0.225 0.007 158);  /* #191D1A = --popover, floating layer */
  --surface-3: oklch(0.265 0.007 158);  /* hover/pressed fill, topmost menu row */
  --text-strong: oklch(0.985 0.002 158); /* #F9FAF9  N8, headings/hero numerals only */

  /* ---- jade ramp ---- */
  --jade-wash: oklch(0.240 0.050 158);   /* #052616 */
  --jade-border: oklch(0.340 0.075 158); /* #074328 */
  --jade-muted: oklch(0.520 0.115 158);  /* #157C4F  icons/large-UI only */
  --jade-base: oklch(0.755 0.175 158);   /* #0CD083  == --primary */
  --jade-glow: oklch(0.860 0.195 158);   /* #25F69E  live/pulse effects only */
  --jade-raw: oklch(0.879 0.214 155.7);  /* #00FF98  logo/marketing reference only */

  /* ---- rust (outcome: loss / bad odds / bottom of the board) ---- */
  --rust-wash: oklch(0.240 0.044 25);    /* #311614 */
  --rust-border: oklch(0.345 0.065 25);  /* #562B28 */
  --rust-muted: oklch(0.500 0.088 25);   /* #8F4E49  fills/hairlines only */
  --rust-base: oklch(0.660 0.108 25);    /* #CC7770  == --negative */

  /* ---- ember (destructive/warning) ---- */
  --ember-wash: oklch(0.240 0.045 45);   /* #31180C */
  --ember-border: oklch(0.340 0.065 45); /* #532C1A */
  --ember-icon: oklch(0.600 0.110 45);   /* #B66946 */

  /* ---- semantic aliases ---- */
  --positive: oklch(0.755 0.175 158);    /* == jade-base, "+" / "/" prefix */
  --negative: oklch(0.660 0.108 25);     /* == rust-base, "−" / "\" prefix */
  --void: oklch(0.520 0.008 158);        /* N5, pairs with diagonal hairline */

  /* ---- name colors (curated 10) ---- */
  --name-color-1: oklch(0.605 0.091 200);  /* #2C9297 Harbor Teal */
  --name-color-2: oklch(0.610 0.097 218);  /* #2C91AA Signal Cyan */
  --name-color-3: oklch(0.610 0.116 236);  /* #2B8DBF Skyline Blue */
  --name-color-4: oklch(0.625 0.172 254);  /* #2D88EC Voltage Blue */
  --name-color-5: oklch(0.625 0.178 272);  /* #647BF1 Indigo Pulse */
  --name-color-6: oklch(0.635 0.186 290);  /* #8C70F2 Ultraviolet */
  --name-color-7: oklch(0.648 0.224 308);  /* #B45CF5 Neon Orchid */
  --name-color-8: oklch(0.650 0.266 326);  /* #DB36E3 Magenta Static */
  --name-color-9: oklch(0.650 0.244 344);  /* #EC35B3 Flare Pink */
  --name-color-10: oklch(0.645 0.229 2);   /* #F33483 Coral Flare */

  /* ---- brand motif ---- */
  --brand-slash-angle: 68deg;    /* reference constant for canvas/SVG math only — NOT consumed by any cut-* utility, see §4.3 */
  --brand-slash-rad: 1.187rad;   /* 68deg, same reference-only status */

  /* ---- radius — --radius is the ONE lever, sm/md/lg/full derive from it ---- */
  --radius: 0.25rem;                      /* 4px — bump this, everything else follows */
  --radius-sm: calc(var(--radius) * 0.5);  /* 2px  inputs, small chips */
  --radius-md: calc(var(--radius) * 1.5);  /* 6px  rare structural fallback */
  --radius-lg: calc(var(--radius) * 2);    /* 8px  large panels only, rare */
  --radius-full: 9999px;                   /* avatars, icon buttons only */

  /* ---- border weight variant ---- */
  --border-strong: oklch(0.520 0.008 158); /* #656A67, same value as N5/--void — edges that must read as a boundary (≥3:1 vs adjacent surface), see §4.2 */
}
```

`@theme inline` registration — every token above that any component spec uses as a bare Tailwind utility class (`bg-surface-2`, `border-border-strong`, etc.) must be registered here or Tailwind v4 generates no CSS for it. Place this immediately after the `:root` block:

```css
@theme inline {
  --color-surface-0: var(--surface-0);
  --color-surface-1: var(--surface-1);
  --color-surface-2: var(--surface-2);
  --color-surface-3: var(--surface-3);
  --color-border-strong: var(--border-strong);

  --color-jade: var(--jade-base);
  --color-jade-wash: var(--jade-wash);
  --color-jade-border: var(--jade-border);
  --color-jade-muted: var(--jade-muted);
  --color-jade-glow: var(--jade-glow);
  --color-jade-raw: var(--jade-raw);

  --color-ember: var(--ember-icon);
  --color-ember-wash: var(--ember-wash);
  --color-ember-border: var(--ember-border);

  --color-rust: var(--rust-base);
  --color-rust-wash: var(--rust-wash);
  --color-rust-border: var(--rust-border);
  --color-rust-muted: var(--rust-muted);

  --color-void: var(--void);
  --color-positive: var(--positive);
  --color-negative: var(--negative);
  --color-text-strong: var(--text-strong);

  --color-name-color-1: var(--name-color-1);
  --color-name-color-2: var(--name-color-2);
  --color-name-color-3: var(--name-color-3);
  --color-name-color-4: var(--name-color-4);
  --color-name-color-5: var(--name-color-5);
  --color-name-color-6: var(--name-color-6);
  --color-name-color-7: var(--name-color-7);
  --color-name-color-8: var(--name-color-8);
  --color-name-color-9: var(--name-color-9);
  --color-name-color-10: var(--name-color-10);
}
```

This supersedes the small `--color-jade`/`--color-ember`-only block previously shown in §4.3 — that block is now just a pointer to this one, don't declare either name twice.

Implementation flags:
1. `--destructive-foreground` doesn't exist in the current stock file — add it, set **black**.
2. `--primary-foreground` must be **black** (jade-base fails at 2.03:1 with white text).
3. `jade-muted` never carries small body text (3.79:1) — icons/large-text/non-text UI only.
4. Delete the `.dark` block/media toggle entirely — this app is dark-only, everything lives in bare `:root`.
5. The repo's existing `@theme inline` block already derives `--radius-sm/md/lg` via `calc()` off `--radius` (good — same pattern as above) but also defines unused `--radius-xl/2xl/3xl/4xl`; delete those four, they're banned (§4.1, §8 #1). Don't add a second `--radius-sm/md/lg` anywhere — one definition, one place.
6. `--coin` (previously a fixed always-jade token) is removed — superseded by the `currentColor` glyph behavior in §5.5, which is conditional (white default, jade only on positive delta), not a fixed color. Don't reintroduce it.
7. Fix the pre-existing repo bug in `globals.css` where `--font-sans: var(--font-sans)` is self-referential — see §3.

---

## 3. Typography — Geist only, no third font

No display font added. Geist Sans already reads geometric/technical; Geist Mono is the "display" solution for numerals — its ticker-like grid does the branding work numerals need without a second font file (perf: UX-006). Distinctiveness comes from weight contrast + tight numeral tracking + uppercase tracked labels standing in for a stencil display voice.

```css
@theme {
  --font-sans: var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif;
  --font-mono: var(--font-geist-mono), ui-monospace, "SF Mono", monospace;
}
```

`layout.tsx` loads both faces via `next/font/google` as CSS variables (`--font-geist-sans`, `--font-geist-mono`) on `<html>` — there is no system font literally named "Geist Sans"/"Geist Mono", so the tokens must reference those variables, not string literals. This also fixes the pre-existing repo bug where `globals.css` has `--font-sans: var(--font-sans)` (self-referential, never resolves).

| Role | Font | Weight | Size | Tracking | Leading | Notes |
|---|---|---|---|---|---|---|
| Hero numeral (bet-detail odds/pot, big coin total) | mono | 700 | `text-4xl`/`text-5xl` | tight | none | always `tabular-nums` |
| Card numeral (odds on bet card, leaderboard amount) | mono | 600 | `text-2xl`/`text-3xl` | tight | tight | `tabular-nums` |
| Inline numeral (odds chip in a row, chat wager mention) | mono | 500 | `text-sm`/`text-base` | normal | tight | `tabular-nums` |
| Page title | sans | 600 | `text-2xl` | tight | tight | e.g. dashboard title |
| Section title | sans | 600 | `text-lg` | tight | tight | "Open Bets", "Leaderboard" |
| Body | sans | 400 | `text-sm` (default) / `text-base` (long-form) | normal | normal / relaxed | 14px default = density-first |
| Label / overline | sans | 600 | `text-[11px]`/`text-xs`, uppercase | wide/widest | none | the stencil-feel substitute for a display face — see uppercase rule below |
| Caption / meta | sans | 400 | `text-xs` | normal | snug | timestamps, helper text, `text-muted-foreground` |
| Button text | sans | 500 | `text-sm` | normal | none | uppercase only for the primary CTA style, not all buttons |

### Rules
- **Mono + `tabular-nums` is mandatory** for any value that is data the user scans/compares: coin balances, odds multipliers, countdown timers, percentages, rank digits, pool sizes, dates in tables. Any numeral that updates live **must** be `tabular-nums` to prevent layout jitter.
- **Sans stays for narrated numbers** in prose ("3 friends joined") — mono is reserved for figures being compared, not narrated.
- **Weight discipline**: only 400/500/600/700 used anywhere. 700 is reserved for hero numerals alone — spend it nowhere else, or it stops meaning "most important number on screen."
- **Uppercase discipline** (ties to Banned List #14): uppercase+tracked type appears in exactly one place — short status labels (`OPEN`, `CLOSED`, `VOID`, `CLOSING SOON`) and section eyebrows. Headings, buttons, nav stay sentence/title case at normal tracking.

---

## 4. Shape & space

### 4.1 Radius — sharp by default, circles reserved

Rounded-2xl-everywhere is exactly the generic look this system avoids. Default posture: **flat rectangles (radius 0) separated by hairlines**, not rounded soft cards. The radius scale (§2.5) exists only as a fallback for small standard controls; the actual "signature" silhouette on hero surfaces is the 68° corner cut (§4.3), not a bigger radius.

| Element | Treatment |
|---|---|
| Bet rows, list containers | `radius: 0`, hairline `border-b` separators only |
| Cards / panels / modals / buttons (default) | `rounded-sm`–`rounded-md` (2–6px) — never `rounded-xl`/`2xl` |
| One hero surface per screen (bet-detail header, primary CTA, empty-state panel) | one **68° corner cut** instead of extra radius |
| Avatars, icon buttons | `rounded-full` — the **only** fully-circular elements in the system (rank badges are the slanted-parallelogram shape defined in §5.6, never a pill) |
| Team-affiliation tags | pill (`rounded-full`) — the **one** other sanctioned pill use (see Banned List #2) |

### 4.2 Borders & elevation (no shadows except one)

1px hairlines everywhere; borders are a lightness step (N3/N4), not a saturated color. N3 (`--border`, 1.3–1.46:1 vs its typical neighbor) is intentionally low-contrast — it's a soft, decorative separator, not a boundary anyone needs to *perceive*. Where an edge must actually read as a boundary (a floating panel's outline, on weak/uncalibrated screens per UX-006), use `--border-strong` instead (~3:1 vs its adjacent surface, see §2.5).

| Layer | Background | Edge |
|---|---|---|
| Canvas | N0 | — |
| Card / row / docked panel (informal separator) | N1 | `border-b`/`border` N3 — decorative only, no legibility burden |
| Floating: modal, dropdown, popover | N2 | `--border-strong` (~3:1, a real boundary) + **the one exception**: a single soft `box-shadow` (`0 8px 24px -4px oklch(0 0 0 / 45%)`) reserved exclusively for the modal/dialog overlay — only one open at a time |
| Hover/pressed/topmost menu row | N3 | — |
| Focus / active-brand edge | any | `--jade-border` or `--ring` (jade) |

Never stack shadows on cards or list rows — that stacking is the clearest "vibe-coded" tell and a real perf cost on weak GPUs (UX-006).

### 4.3 The slash motif — 68°, used with scarcity

**Standardized angle: 68° from horizontal** (steeper than a generic 45° slash, steeper than shallow "esports" cuts at 8–15°). Every diagonal element in the app uses this one angle; never mix slash angles.

> **Correction, 2026-09-08.** This paragraph used to justify 68° as matching "the logo mark's near-vertical urgency". Tracing the mark disproved that: its cuts run at **≈28.5° from horizontal** — the shallow esports cut this rule claims to be steeper than. So 68° is a house angle that *contrasts* with the mark rather than echoing it. Left standing as the standard, because every `cut-*` utility, the divider, the void-strike and the numeral framing are already built on it and re-cutting the app to 28.5° is a much bigger decision than this correction. Just don't repeat the derivation — if the angle is ever revisited, it is a taste call, not a fact about the logo. (`--brand-slash-angle`/`--brand-slash-rad` in §2.5 are reference constants for canvas/SVG math elsewhere — they aren't consumed by any utility below. The real lever for this angle is the offset ratio in each `cut-*` rule; change all of them together, never just one.)

Corner-cut clip-paths approximate 68° via unequal horizontal/vertical offsets (`vertical ≈ 2.48 × horizontal`, since `tan(68°) ≈ 2.475`):

```css
/* --color-jade / --color-ember and every other bare-utility token are
   registered once in the @theme inline block in §2.5 — don't redeclare
   them here. */

/* corner-cut utilities, ratio tuned to ~68° (v ≈ 2.48h). cut-danger uses
   the same ratio on both top corners — no exception to the single-angle
   rule above. */
@utility cut-sm     { clip-path: polygon(0 0, calc(100% - 6px) 0, 100% 15px, 100% 100%, 0 100%); }
@utility cut-md      { clip-path: polygon(0 0, calc(100% - 8px) 0, 100% 20px, 100% 100%, 0 100%); }
@utility cut-lg      { clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 25px, 100% 100%, 0 100%); }
@utility cut-mirror  { clip-path: polygon(0 0, 100% 0, 100% 100%, 20px 100%, 0 calc(100% - 8px)); }
@utility cut-danger  { clip-path: polygon(6px 0, calc(100% - 6px) 0, 100% 15px, 100% 100%, 0 100%, 0 15px); }

/* The S-mark is NOT here. It is not expressible as a clip-path: the real
   mark is two disjoint arms, and a single polygon can only join them with
   a degenerate sliver. It lives as a traced inline SVG — see below. */
```

**The S-mark — `sl/s-mark.tsx`, traced not approximated (2026-09-08).** The `s-mark` clip-path utility that used to sit in this block was a placeholder, and a poor one: 40% pixel-IoU against the wordmark in `old-soulless-bg.jpeg`. It is replaced by `<SMark />`, an inline SVG whose every vertex is a least-squares fit of that source raster's edges — 96.5% IoU, stable across binarisation thresholds. Treat those coordinates as **measured data, not design**: don't round them to a grid, and don't "regularise" the near-symmetries (the upper arm's top and bottom splay are mirror-equal to within 0.2px, but its notch edges are genuinely not, and its left edge sits 0.9px right of the lower arm's).

What the mark actually is, since the old approximation taught the wrong shape:

| | |
|---|---|
| Construction | **Two disjoint arms**, not one zig-zag block. Upper: a left-pointing arrow — vertical left edge with top and bottom edges splaying off it at ±2.585 (dx/dy), with a wedge bitten out of its right side. Lower: a slanted bar that tapers, vertical at both ends. |
| The cut | The wide diagonal void between the two arms **is** the mark. Never merge the paths or close the gap. |
| Bbox / aspect | 149.2 × 279.6 in the source, normalised to a `0 0 160 300` viewBox — **aspect 0.533**, i.e. roughly half as wide as tall. The old utility was square, which is most of why it read wrong. |
| Cut angles | The two arm-facing edges of the void run at **≈28.5° from horizontal** (dx/dy ≈ 1.84); the arm splays at ≈21.1°. Note these are *shallow* — see the discrepancy note under §4.3's 68° below. |
| Sizing | `<SMark />` defaults to `h-5 w-auto`. Beside text (top-bar lockup, coin glyph, the four jade eyebrow lockups) use `h-* w-auto`. Centred decorative uses (watermark, loading indicator) pass `size-*` and get a square box with the glyph centred in it. |

**Rule of scarcity: max one diagonal brand element visible per viewport.** The slash is a signature, never a pattern, and never carries semantic meaning by itself (state lives in color/glyph/weight, not in whether a corner is cut).

**Temporary exception (owner ruling 2026-09-08): the `ALPHA` sticker.** `<AlphaTag />` (`sl/alpha-tag.tsx`) tilts −12° on the wordmark lockup — the auth hero and the top bar — because the tilt is what makes it read as "test build" rather than a product tier; the 68°-derived 22° is too steep for a five-letter tag beside a 24px wordmark. It is the one element allowed off the house angle, it spends the viewport's diagonal budget while it exists, and it leaves with the alpha. Don't derive anything else from its angle.

| Motif | Appears on | Must NOT appear on |
|---|---|---|
| Corner cut (`cut-sm`/`cut-md`) | One hero surface per screen: bet-detail header, primary CTA button, empty-state panel, rank-1 leaderboard row, and the single closing-soonest bet row's icon/CTA (§5.1) | Every card, list row, form input, modal, nav item |
| Diagonal hairline divider (68°) | Bet-detail hero section break, void-row strike, landing section breaks | List separators, chat separators, table rows (stay horizontal — scan speed wins there) |
| S-slash loading indicator (`<SMark />`, above) | Full-page loads, modal-submit pending | Never inside small buttons (use 3-dot mono sequence there instead) |
| Watermark (`<SMark />`, 4–6% opacity, 96–200px) | Empty states only | Behind active content; never more than one on screen |
| Numeral framing | 68° cut on the *container chip* around a hero numeral (odds badge), or as a divider between value/unit (`2.4 ⟨cut⟩ x`) | Never cut into digit strokes themselves — money/odds legibility is non-negotiable |

### 4.4 Multi-option odds — no rainbow palette

With 2–6+ bet options, a default charting palette would break the black/white/jade rule. Resolve by **position + fill-state first, hue only as a last differentiator**:
- Option ranked/leading: full white text + fill.
- Other options: progressively dimmer (`N7 → N6 → N5`) by pool share, not by hue.
- If a chart/bar visualization needs simultaneous colors (bet-detail odds bars, §5.5), reuse the 5-hue name-color subset (`--chart-1..5`) — never invent a 6th hue, and never assign hue meaningfully (i.e., color there is decorative-differentiator only, not "option A is good, option B is bad").

### 4.5 Spacing & density

Standard 4px scale, two tiers:

| Tier | Use | Spec |
|---|---|---|
| **Dense** (default) | Bet lists, leaderboard rows, chat messages | row height 40–44px, `py-2`/`py-2.5`, `gap-2` |
| **Comfortable** | Modals, bet-detail hero, empty states | `p-6`/`p-8` — reserve for the "trophy moment" (big odds numeral + CTA) |

---

## 5. Components

### 5.1 Bet row (replaces the generic "card")

No `bg-card`/`rounded-xl`/shadow. Bets render **edge-to-edge**, separated by `border-b border-border`.

```
[rail 3px][icon 44px chip][title + meta][odds preview][pool/countdown][avatar stack][CTA]
```

| Cell | Spec |
|---|---|
| Rail | `absolute inset-y-0 left-0 w-[3px]` — jade-base solid (open) / N4 (closed-awaiting) / none (resolved/void, flat hairline only) |
| Icon | `size-11 bg-surface-2 rounded-sm`, emoji/icon centered — never a circle (DOM-009). Fallback glyph is 🎲 for a pool bet and ⚔️ for a duel (Extra Phase 3): two people arguing about one outcome is not a dice roll, and the pool default on a duel row contradicts the next three cells. `cut-sm` is reserved for the single **featured** row only (see below) — never on every row at once (§4.3 scarcity cap) |
| Title | sans 500–600, `text-base`/`text-lg`, truncate; `by {creator}` at `text-xs` N6 + 16px avatar |
| Odds preview | top 2 options by pool share stacked vertically (fits the 64px row), one per line: jade `/` bullet + sans label, and the odd inside its own **chip** — `bg-surface-3 rounded-sm px-1.5 py-0.5 min-w-14`, mono 500 `tabular-nums` right-aligned in a shared trailing column (the chip's fill edge, not typography, marks where a numeric label ends and the odd begins — the containment pattern every major sportsbook uses); §4.4 rank dimming on text (leader N8, runner-up N7, rest N6 — never N5 at text-sm, §2 contrast note); 3+ options append a `…` indicator (N6) and the block reveals the full option list in a tooltip (hover/focus, tap-to-toggle on touch), same columns + dimming; resolved rows follow §5.2 (winner jade `/` + N8 600 on a `bg-jade-wash` chip per §2.2 "positive chip bg"; losers chipless N6 400 + line-through odds, no prefix) |
| Pool | stacked: `POOL` label (11px, uppercase, N6) over mono value + coin glyph |
| Countdown | mono, color per state table §5.3 — the only urgency signal, no separate badge |
| Participants | overlapping 20px circles, `-space-x-2`, max 3 + `+N` mono circle |
| CTA | `WAGER` — jade-base fill, black text, `rounded-sm`, `h-8 px-3 text-xs uppercase`. `cut-sm` reserved for the featured row (below) and the one true Primary button on bet-detail (§5.3) — never on every row's CTA at once. On a resolved bet the user played, this cell is replaced by the outcome glyph (§5.2), not left as a dead button |

**Duel rows (Extra Phase 3) substitute three cells, drop one, and leave the rest alone.** A duel is a `kind` of bet, not a second row component, so the rail, the icon, the title and the share affordance are unchanged; what changes is everything that speaks pari-mutuel, plus the participants cell (dropped — see below the table).

| Cell | Pool bet | Duel |
|---|---|---|
| Odds preview | as above | the **versus composition** (§5.6) at its dense size. `getPoolStats` on two symmetric stakes returns a truthful and useless flat 2.00x/2.00x, and pari-mutuel vocabulary on a two-person bet reads as a bug rather than as information — so this cell is REPLACED, never reused |
| Pool | `POOL` + total | flat `STAKE n · WINNER TAKES 2n` — sans 600 11px uppercase labels (§3's Label role), mono `tabular-nums` figures with the coin glyph (§5.5). `· WINNER TAKES 2n` hides below `xl`; the POOL cell it replaces was gated at `lg`, and one step stricter is measured rather than taste — the versus needs real width and at 1024–1279px the two together squeeze it to nothing. `STAKE n` survives at every width, because the payout is 2× the stake and nothing else, so the half that stays is the half you cannot derive |
| CTA | `WAGER` / outcome glyph | **per viewer, and never a dead button**: *Accept* + *Decline* for the challengee while the challenge is open (both open the answer modal, §5.4), *Resolve* for an eligible resolver once accepted (an outline link to the bet page — a resolution is two participant buttons plus Void, a panel and not a row control), the outcome delta once settled, and nothing at all for everyone else. `WAGER` never appears on a duel for anyone, at any breakpoint, in any state: `place_wager` refuses one outright, so the button would be a lie even where it fits |

The countdown keeps its own cell and gains an explicit `Accept by` prefix while a challenge is pending — sans prefix, mono numerals. This cell has carried exactly one meaning app-wide ("betting closes in") and a second, unlabelled one on the same channel is a guaranteed misread; the prefix is words on the existing cell, never a second badge.

The participants cell is **omitted** on a duel: the versus already names both people in full, and repeating them as an overlapping stack (§5.6's avatar cluster is same-side by construction) says they are on the same side, which is the one thing the row exists to deny.

**Featured row** (was "Closing-soon row" until Extra Phase 3 — see the reassignment below): background layer (not the row bg itself) gets a diagonal cut at the far edge with a 6% jade tint — **one row per viewport**, never every open row. This is also the one row whose icon chip and CTA use `cut-sm` instead of the default `rounded-sm`, per §4.3's scarcity cap. Never a permanent `bg-jade-wash` fill: that is the hover background (§2.2), the row already ships `hover:bg-surface-1`, and a permanently-hovered-looking row is a bug report waiting to happen.

**Which row is featured — reassigned by Extra Phase 3, task 6.** The dashboard's single diagonal used to belong unconditionally to the soonest-closing OPEN row. It now goes to **a duel awaiting the viewer's answer or ruling** whenever there is one, and falls back to the soonest-closing open pool bet when there is not. A decision only you can make outranks a clock everyone can see, and the cut is the strongest "look here" the system owns. Consequences, both deliberate:

- **Featuring and the <1h state are now two different things**, carried by two props (`featured`, `soonest`). §5.2's Closing-soon row keeps its pulsing rail, its `CLOSING SOON` label and its jade countdown when a challenge takes the cut — that is state language about a betting window, and a challenge arriving in someone's feed is no reason to extinguish it. What it loses is the corner tint and the two `cut-sm` chips. Before this phase both jobs were one prop, because both always landed on the same row.
- **The budget is still one.** Exactly one `cut-mirror` tint and one `cut-sm` icon chip render per feed, allocated once in `bet-feed.tsx` rather than decided per row.

**Mobile (<640px)**: same rail+hairline, 2–3 stacked lines (icon+title / odds·pool·countdown / avatars+CTA), row min-height ~96px, full-width tap target. A duel adds a fourth: the versus takes its own line rather than squeezing the stake and the deadline off the row.

### 5.2 State language (rail + label + countdown color + motion — never a colored chip)

| State | Rail | Label | Countdown | Extra |
|---|---|---|---|---|
| Open | jade solid | none (rail is enough) | N6 mono | static |
| Closing soon (<1h) | jade + pulse (opacity 100→60→100, 1.6s) | `CLOSING SOON` jade/80 | jade, semibold | takes the featured slash-corner tint (§5.1) **when no challenge is waiting on the viewer** — Extra Phase 3 reassigned that budget; the pulse, the label and the jade countdown are unaffected either way. This row never gets the literal `box-shadow` glow; that's reserved for bet-detail's hero countdown under 5 minutes (§6) |
| Awaiting you (duel, Extra Phase 3) | unchanged for the underlying state — jade if the challenge is still open, N4 once accepted | `AWAITING YOU` jade/80, replacing `AWAITING RESULT` where both would apply | unchanged, with the `Accept by` prefix while pending | the featured tint + `cut-sm` icon chip (§5.1). **Per viewer**: the same row is ordinary for everybody else. This is D4's entire notification story — a pull, computed from `duelFor` and the shared predicates, never a push (ARC-014) |
| Closed / awaiting result | N4, static | `AWAITING RESULT` N6 | replaced by static "closed 2h ago" | row `opacity-90`, no CTA |
| Resolved | rail removed, flat hairline only | none | none | winner/loser split below |
| Void / refunded | rail removed | `VOID · REFUNDED` N6, with a reason suffix on a duel (below) | — | one thin diagonal hairline across the row (not a pill, not strikethrough font) |

**Void reasons (Extra Phase 3, D3).** A duel's void carries a reason, and it is a **suffix on the existing label**, never a second state: the treatment underneath is unchanged (rail removed, one thin 68° hairline, N6 letters).

| Stored reason | Label |
|---|---|
| `expired` | `VOID · NOT ACCEPTED IN TIME` |
| `declined` | `VOID · DECLINED` |
| `insufficient-funds` | `VOID · COULDN'T COVER IT` |
| `participant-left` | `VOID · PLAYER LEFT` |
| `mediator`, or none recorded | `VOID · REFUNDED` |

**Rust is banned on every one of them**, and this is where someone will reach for it: they all read like failures and not one of them is. §2.3b puts "open/closed/void state (void is a refund, not a loss — it stays N5/N6)" in its where-rust-is-banned list, and nobody lost a coin in any of these — the money went home. N5 remains the void concept's token and the hairline's weight; the letters stay N6, because §2.1 bans N5 for uppercase label text at any apparent size.

An **unaccepted challenge past its deadline shows `VOID · NOT ACCEPTED IN TIME` before anything has persisted it** (D8 half (a)). The rail goes, the hairline appears and the Accept/Decline controls leave, all on the clock alone. The sweep that makes the refund real is opportunistic, and on a deployment that pauses after 7 idle days "nothing has swept for a week" is the expected case, not an outage — so the screen is written to be right without it.

**Winners vs losers on a resolved bet — position + weight + slash glyph, never color:**
- Winning option: full-opacity N8 text, jade `/` prefix, sorts to top.
- Losing options: solid rust-base (full alpha — no opacity dilution, which drops below 3:1 and becomes unreadable) + font-weight 400 (vs the winner's 600/700) + odds column `line-through`, no prefix, sorts below; on the detail page the row also takes a `rust-border` edge and a `rust-wash` pool-share fill. Weight and line-through carry the "quietly recedes" effect, not transparency.
- Your own outcome (CTA cell / bet-detail header): `/ WON +240` in jade mono, or `\ LOST 180` in rust mono — the backslash literally mirrors the logo's second diagonal cut, doing the job a red minus sign does elsewhere, without red.
- Did-not-participate (4th de-facto state): neutral, no glyph, no emphasis — must not read as a loss.

### 5.3 Buttons

| Variant | Spec |
|---|---|
| Primary | jade-base fill, **black** text, `font-semibold`, `cut-sm`, `hover:brightness-110`, `active:brightness-95`. One per screen (Wager, Create Bet, Confirm) |
| Outline / secondary | `border-border text-foreground bg-transparent`, `hover:border-jade/50 hover:text-jade`, `cut-sm` |
| Ghost / tertiary | `text-muted-foreground hover:bg-surface-3 hover:text-foreground`, no border, no clip |
| Disabled | `opacity-40 pointer-events-none` on any variant — no separate gray palette |
| Loading | label swaps to 3-dot mono opacity-stagger sequence — no spinner icon, no button shimmer |
| Destructive (ordinary trigger) | dark/neutral fill + border, ember icon only; `hover:` reveals a 2px ember top hairline. Text stays neutral N7, never ember, never "Delete" in ember |
| Destructive (final confirm) | ember-solid fill + **black** text, `cut-danger`. Starts `opacity-40 pointer-events-none`, unlocks only once type-to-confirm input matches |

**Note on `border-*` classes throughout §5**: bare `[--border]` bracket arbitrary values (a Tailwind v3.4 shorthand) are invalid CSS in v4 and silently fail to render. Since `--border` is already registered as a shadcn/Tailwind v4 color, use the plain utility `border-border` everywhere (not `border-[var(--border)]`, not `border-[--border]`).

### 5.4 Modals (UX-014/015/016)

- Backdrop: flat `bg-black/75`, **no** `backdrop-blur` (perf).
- Shape: `cut-md` on one corner only (desktop: top-right) — never all four rounded.
- Header: no colored banner. Small uppercase eyebrow (`NEW BET`), title beneath. One 1px jade line across the very top edge of the modal ("the cut line"). Optional: S-mark clip-shape at 5% opacity in the empty header corner, decorative, `pointer-events-none`.
- Mobile: bottom sheet, translateY+fade only (220ms), top corners mirrored `cut-md` (12px), drag handle = plain bar, not a rounded pill.
- Inputs: `bg-surface-1 border-border text-foreground placeholder:text-muted-foreground/60`, `rounded-none`/2px max, `focus:border-jade focus:ring-1 focus:ring-jade/40` — jade is the **only** focus color anywhere in the app.
- Type-to-confirm destructive input (DOM-034): neutral border by default → jade border on live match (not green) → helper text fades once matched. Mismatch on submit = one ember 1px flash for 400ms, then reverts; button stays disabled. No shake, no red error text.

### 5.5 Coin display & P/L

- Glyph: `<SMark />` at 0.75em tall (≈12px), `h-* w-auto` so the 0.533 aspect stands and no dead air opens up before the numeral, `currentColor` (white by default, jade only on a live/positive delta). Placed before every amount.
- All amounts: `font-mono tabular-nums`, comma-grouped.
- Gain: `/ +240` jade. Loss: `\ −180` rust. Same pairing reused identically across leaderboard deltas, chat mentions, toasts, and the per-user aggregated P/L view (one row per team the user is in, lifetime net delta only, same glyph+mono treatment as a transaction row, sorted by magnitude) — **one glyph vocabulary everywhere**, established once here.
- Transaction history rows: dense, `py-2.5 border-b`, columns date (mono, N6) · description (N7) · delta (glyph-prefixed mono, right) · balance-after (mono, N6, smaller, right).
- Wager input "cap reached" state: disabled/greyed at the balance/max-bet ceiling, never a red-bordered invalid state.

### 5.6 Leaderboard, poor podium, rank badges, versus (DOM-027/028/029)

- **No 3D podium graphic.** Both boards are lists using the bet-row anatomy: oversized mono rank digit (rank 1 largest, stepping down by rank 5+), avatar, name (in the user's own name-color, §2.4), balance right-aligned mono.
- **Richest list**: rank-1 row gets `cut-sm` on its right edge + a 1px jade top line + jade rank digit. Ranks 2–3 full-opacity white digit, 4+ muted (N6).
- **Poor podium**: mirrored motif *and* the rust hue (owner ruling 2026-09-05 — this bullet previously read "never ember/red, zero color difference"). `cut-mirror` (opposite corner) + a 1px rust **bottom** hairline mirroring the richest board's jade top line + `rust-wash` row fill; rank digit rust at 1, `rust/80` at 2–3, muted from 4 down — the exact emphasis ramp of the richest board, in the other hue. Copy still does the heavy lifting (dry/ironic tag line under rank 1, e.g. "House's favorite donor", itself in rust). The Poorest tab's active tick is rust, the Richest tab's is jade.
- **Inline rank badges** (chat, participant lists): small **slanted parallelogram tag** (not a pill) — `#1` jade fill/black text; `#2`/`#3` jade border/jade text on transparent; `TOP 5` neutral border/N6 text; `BOTTOM 5` same shape mirrored horizontally, `\` prefix instead of a down-arrow icon, rust border + rust text.
- **Role badges** (moderator/member) are visually distinct from rank badges: rank badges are the slanted parallelogram; role badges are a plain square-cornered label with an icon (shield/star glyph), never the parallelogram shape — the two "badge" concepts must not be visually confusable in the same name-adjacent slot.
- **Versus composition** (duel bet row, bet-detail hero — Extra Phase 3, 2026-09-07): two identity clusters opposed across a `vs` mark. Each side is the same atomic cluster as chat and the participant list (§5.7/§5.11) — `UserAvatar` + the name in its own `--name-color-N` + the inline rank badge — composed, never re-drawn. The challenger reads left-aligned, the challengee `flex-row-reverse` and right-aligned, so opposition is carried by layout. Two sizes, differing only in avatar px and type scale and never in *what* is shown: **dense** (20px avatar, `text-xs`) for the 64px feed row, **comfortable** (32px, `text-sm`) for the detail hero — §4.5's two tiers, so a duel neither gains nor loses a badge by being looked at more closely. Names truncate from a `min-w-0` wrapper (a `truncate` on `UserName` itself lands on its outer `inline-flex` and clips nothing); a participant this client cannot resolve renders a neutral `—` placeholder rather than collapsing its side, which is reachable on a duel that settled before someone left. **The separator is the word mark, not a diagonal**: §4.3's motif table bans the 68° hairline on list separators and table rows, and the one viewport that would sanction it — the bet-detail hero — has already spent its single cut on §5.11's `cut-md`. Not to be confused with the avatar cluster two bullets up, which is overlapping and same-side by construction and means the opposite thing.

### 5.7 Chat / comments

- Dense rows, no bubbles: `flex gap-2 py-1.5`, 24px avatar, name in `--name-color-N`, inline rank badge immediately after name if applicable, message N7, timestamp mono N6 trailing (matches §3's caption/meta rule — N5 was inconsistent here).
- No hover cards, no message-bubble background. Whitespace (`py-1.5`) carries separation; hairline every few messages at most.
- Input: fixed to panel bottom, `bg-surface-1 border-t`, plain `rounded-none` field. Send affordance is the **diagonal slash itself** as icon — a single `/` glyph styled as a send arrow, jade on hover — doubling as brand mark and function.
- Realtime arrival: lightweight insertion animation only (§6), never a layout-shifting entrance.
- **Unread divider (Extra Phase 1, D2):** a 1px hairline across the row gutter + small uppercase `NEW` label, N6 — no red, no count badge on the line itself. The count lives on the header/chip, not here (§5.2's no-colored-chip rule extends to this label).
- **Catch-up pill:** a member reading scrollback who isn't already at the bottom gets a small `N new ↓` pill (jade text on `surface-2`) instead of being auto-scrolled out from under their read position; clicking it scrolls to bottom and dismisses it. Never yank scroll position without one.
- **End-of-history marker:** a centered hairline + one dry line naming the 30-day cutoff, replacing the loading row once keyset paging has nothing further to return.
- **Two message flows, two failure treatments (Extra Phase 4, task 14):** both composers keep what was typed — only a *successful* write clears the field, in the per-bet comment form (UX-018) and in team chat's composer (UX-019) alike — so a failed post never silently eats someone's text. Nothing "restores" anything; the field is simply never emptied until the write lands. What differs is **where the failure is reported**. A failed per-bet comment reports **inline**, next to the input that produced it, per §5.8's rule that a field owns its own error. A failed team-chat send reports in a **toast** (§5.9), because that send is *optimistic*: by the time the rejection arrives its row has already been removed from the thread, so there is no longer anything on screen to hang an inline message on. Two post-a-message flows, one composer rule, two reporting surfaces — this is intent, not drift.

### 5.8 Forms & inputs (general)

| Control | Spec |
|---|---|
| Text field / textarea | `bg-surface-1 border-border`, `rounded-sm` max, jade focus ring |
| Number/amount stepper | mono value, disabled state at cap (§5.5), no red border on invalid |
| Select / team switcher / sort | **segmented tab control** for short frequent choices (open/closed filter, sort order), with a slash-notch active-state tick — not a dropdown. Reserve real `<Select>` dropdowns for long/rare lists (avatar icon grid, 30+ items) |
| Date-time picker | custom close-time control, 3 presets + custom picker, same input chrome as text fields |
| Toggle/switch | access-mode (free-for-all vs restricted) — jade = on, N4 track = off, no red "off" state |
| Color swatch picker | name color (§2.4), 10 curated swatches, `rounded-full` swatches |
| Icon-set grid picker | avatar / bet emoji, `cut-sm` chip per option, selected state = jade border, not a filled background |
| File upload | custom avatar — same `cut-sm` frame as generated avatars, no circle crop for uploads on non-avatar contexts |
| Typeahead / player search | The app's **one** combobox (roster picker, Extra Phase 3): roster on focus, substring filter on type, arrow/enter/escape, `role="combobox"` + `aria-activedescendant` roving VIRTUAL focus (DOM focus never leaves the input), a removable selection chip once picked, and an explicit no-match line that is **not** a validation error — one dry N6 sentence, no ember, no `role="alert"`. Panel is §4.2's floating row — `bg-surface-2` + `border-border-strong`, **no shadow** (that belongs to the modal alone) and no `cut-*`. Renders **in flow**, not as an absolute popup: inside `ModalShell` the body is `overflow-y-auto` inside an `overflow-hidden` panel, and absolutely-positioned content is clipped there AND contributes no scroll height, so it cannot be scrolled to. Options are Dense tier (§4.5) with `bg-surface-3` as the active row, applied from state — pointer hover MOVES the active index rather than painting a second highlight. Moderators sort first and carry the **role** badge (§5.6's square-cornered label), never `RankBadge`. Banned-list #13 reserves dropdowns for "genuinely long/rare lists" and a ~30-person roster picked once per challenge is exactly that carve-out — a segmented control would be 30 tabs. It queries nothing: a client-side filter over `team.members`, zero egress, no new vendor (`design-stack.md` §4 rule 5) |
| Validation error | Ember icon + ember border on the *field*; the error **message** reads `--negative` (rust) — it shares the token with losses because both mean "this went badly", and gray-on-gray error copy was the previous rule's real cost. Surrounding body copy still stays N7, and saturated red is still banned |
| Focus ring | jade, 1–2px, on every interactive element — the **only** focus color in the app |

**A field's error and a toast are different jobs (Extra Phase 4):** a field owns its own validation error — the ember icon, the ember border and the message beside the field, per the Validation-error row above — while a toast (§5.9) reports the outcome of an action the person took. A toast never reports a bad form field while the field itself sits unmarked.

**A toggle stands in for the checkbox nobody specified (Extra Phase 3, task 2):** the owner's wording for the duel's *any moderator* control was "checkbox", and this document has never specified one — the word appears nowhere in it and no `<input type="checkbox">` exists anywhere in the app. Rather than ship an unspecified control silently, the control is the Toggle/switch row above, and this paragraph is the record of the substitution. It is the second toggle in the system, after the access-mode switch that row names; nothing in that row ever forbade a second, it simply had never had one. One deliberate divergence from it: when the toggle is **forced** (a `restricted` team stores `any_moderator = true` whatever the challenger ticked, D9) it renders on and disabled at §5.3's `opacity-40`, not the access-mode switch's `opacity-60`, with the reason in N6 beneath it — "you may not change this" and "this is settled for you" are different states, and the stronger dim is what stops a forced-on switch reading as something still worth pressing. Never a silent lock, and never an error: the coercion is silent server-side precisely so nobody is told off for a control they were not allowed to touch.

### 5.9 Toasts

`bg-surface-2 border-border`, left rail 2px by type: jade (success) / `--border-strong` (info/neutral) / ember (destructive-confirmation only) — never red/green. Icon slot reuses the glyph system: `/` jade for success, `\` N6 for failure — no check/x icon-library glyphs. Position bottom-right desktop / bottom-center mobile. Motion: slide+fade, 3.5s auto-dismiss, transform+opacity only, no blur.

First shipped use: Extra Phase 1's chat send-failure toast (`\` glyph — flood/duplicate rejection, a failed send). It stays in-app UI feedback only — client-rendered, gone on reload, no persistence, no OS-level surface — and must stay that way. This is not, and must never become, a notification: ARC-014 bans push/email/sound/badge outright, and a toast is the line it must not cross. The boundary written as a rule, so no later session has to re-derive it (Extra Phase 4, D5): **a toast may only ever be raised synchronously, in the handler of an action the person themselves took** — a toast fired from a realtime handler or from `onResubscribe`, any persistence of a toast across a reload, any list, log or history of past toasts, any count or badge derived from them, and any live reader on the inert notifications bell or on the ARC-015 pip slot (`design-dashboard.md` §1.1) are each the notification system ARC-014 excludes, whatever they are called.

- **Neutral rail token (Extra Phase 4, D8):** the info/neutral rail is `--border-strong` — a separate token declared at N5's value (`#656A67`) and glossed *"edges that must read as a boundary (≥3:1)"* — not N4 (Extra Phase 4 corrected the paragraph above in place; it previously read "N4 (info/neutral)"). N4 is `--input` (`#3B403D`, 1.87:1), one of the N1–N4 surface-elevation steps §2.1 calls intentionally low/ungraded and says not to read as a graded boundary; §2.1's N4 row does still carry the stale role string "Border strong / input outline", which is the likeliest reason this line ever said N4. Extra Phase 1 shipped `--border-strong`; the doc moves to the code.
- **The third glyph (Extra Phase 4, D9):** the ember/destructive rail's glyph is `/` tinted ember. The paragraph above names three rails and glyphs for only two — a gap in this doc, not a rule to guess at. The app's glyph vocabulary is exactly two marks (§5.5, "one glyph vocabulary everywhere"), and a destructive action that *succeeded* is a completion, so it takes the completion mark; the ember **rail** is what says the completion was destructive. §2.3 sanctions precisely this — ember *"only fills icons, thin borders, and the one final confirm-button background"* — and a 2px rail is a thin border while a glyph is an icon. Ramp steps as shipped: rail `--ember-border` (`#532C1A`), glyph `--ember-icon` (`#B66946`) — the same dim-rail/bright-glyph pairing `auth-page.tsx` uses — and **not** `--destructive` (`#C85C22`), which §2.3 rations to the one final confirm button.
- **Duration is a caller override (Extra Phase 4, D4):** 3.5s above is the default a caller inherits by saying nothing, not a floor. `show()` takes an optional per-call duration, because the call site is the only thing that knows whether its sentence is four words or twenty.
- **Concurrency (Extra Phase 4, D6):** toasts **stack**, capped at **3**, deduped by an optional key — a repeat of a live key replaces that toast's text and restarts its timer *in place* rather than adding a second card (the realistic burst is the same failure N times, not three different ones), and the cap is also what keeps the feed shape D5 forbids structurally awkward. **No action affordance in a toast, ever:** §5.3 caps the screen at one jade primary, and an auto-dismissing control can vanish under a keyboard user's hand mid-Tab. Recovery belongs back at the control that failed.
- **Position offset below `sm` (Extra Phase 4, task 5):** the bottom-centre strip clears the mobile FAB tier by `--fab-stack-height`, the single declaration in `globals.css` of how much bottom-right space the FAB stack claims (`design-dashboard.md` §6). At `sm` and up there is no FAB to dodge and the strip returns to the bottom-right corner.
- **The live region is persistent and split by politeness (Extra Phase 4, D10):** the toast layer renders two permanently-mounted `sr-only` regions — `role="status"`/`aria-live="polite"` for success and destructive, `role="alert"`/`aria-live="assertive"` for failure — and the visible cards carry no live-region role at all, so nothing is announced twice. Both are mounted *empty* from app start rather than appearing with the first toast: a live region inserted already carrying text is the classic dropped-announcement case (WCAG SC 4.1.3). Two nodes rather than one whose `role` flips, because a screen reader latches a region's politeness at insertion. Both take `aria-atomic="false"` — `status` and `alert` are implicitly atomic, which would re-read every message in the region each time one is added.
- **No shadow and no glow (Extra Phase 4):** the toast card takes neither. §4.2 and §6 reserve the single soft `box-shadow` for the modal/dialog overlay, and the Jade Glow Ration's one anchor is bet-detail's countdown (§5.11); a toast's elevation is `bg-surface-2` plus a border, per §2.1's "elevation reads via brightness, never shadow weight".

### 5.10 Empty & loading states

- Empty: oversized ghost S-mark watermark (5% opacity, pure CSS clip-path, no image asset), one dry/irreverent line (N6), one primary CTA. Shared pattern across dashboard, poor podium, transaction history, chat, participant list — not bespoke per surface (perf + consistency).
- Loading/skeleton: shaped exactly like the real row (rail, icon tile, text bars) at `surface-1`/5% white, slow opacity breathe (0.4↔0.6, 1.2s ease-in-out) — **no gradient shimmer sweep**, no rounded-full placeholder blobs where real content is rectangular. Alternative for full-page/modal-submit loads: the S-slash mark itself, static or single opacity pulse, respecting `prefers-reduced-motion`.

### 5.11 Bet-detail page (the one full-page nav)

- Header reuses bet-row state language at larger scale; this is the one surface allowed its `cut-md` hero treatment (§4.1/4.3). Its countdown digits are also the sole `box-shadow` Jade Glow Ration anchor (§6) — glow activates only under 5 minutes remaining, nowhere else on this page.
- Rich odds display: per-option pool share + implied multiplier as jade/neutral bars, distinguished by position/fill-state first (§4.4), chart-hue subset only as a last resort for 4+ simultaneous series.
- Participant list: avatar + name (own color) + badge + amount, same atomic identity cluster as chat (§5.7/§5.6).
- Resolution banner: same non-traffic-light treatment as bet-row §5.2, scaled up, comfortable spacing tier.
- **Duel layout (Extra Phase 3, task 9):** the rich odds display is REPLACED, not re-skinned — a duel's two options are its two people and a pool-share bar that is always 50/50 is decoration pretending to be data. In its place: the versus composition at comfortable size (§5.6), then a four-cell strip of `STAKE EACH` / `WINNER TAKES` / `ACCEPT BY`-or-`CHALLENGED` / `RESOLVED BY`. The mediator is read off the stored row and never re-derived from the team's current access mode (D9 applies at creation, never retroactively); a named mediator who has left the roster reads `gone`, because D7 hands the duel to the moderator pool at read time rather than rewriting who was chosen. The challengee gets the accept/decline pair here as well as on the row, and an eligible resolver gets a panel of two participant buttons plus Void — labelled from `bet_options` by **position** (0 = challenger, 1 = challengee) and never by matching a label against a current display name, since those labels are snapshots taken at creation and have no UPDATE path. Early close is absent rather than disabled: a duel has no betting window to close. Comments are untouched and identical to a pool bet's.

### 5.12 Social/OG previews

Static renders (invite link, bet-share link) can't use live CSS/motion — bake a static equivalent: brand lockup (S-mark) + jade accent + a static odds-bar snapshot at share-time, matching the same fill/position rules as §4.4 (no rainbow, no live pulse — just a frozen jade/neutral bar).

---

## 6. Motion — cheap on weak devices

Transform/opacity only. No blur, no shadow bloom, no shimmer sweeps. **Every animation in this table is wrapped in `@media (prefers-reduced-motion: no-preference)`** — under reduced-motion, every one of them (not just the full-page loader) is replaced by an instant opacity/state swap: no transform, no repeating pulse.

| Interaction | Duration | Easing | Notes |
|---|---|---|---|
| Hover / press / focus | 120–150ms | ease-out | micro-feedback only |
| Row / modal enter | 200–240ms | `cubic-bezier(0.16,1,0.3,1)` | opacity 0→1 + translateY(-4px→0) (rows) / translateY(100%→0) (mobile sheet) / opacity+scale(0.98→1) (desktop dialog) |
| New bet row inserted | enter transition, then rail brightness-pulses **once**, 2 cycles, 900ms, then stops | — | must not compete with a genuinely "closing soon" pulse elsewhere on screen |
| Odds digit changed | 250ms | — | only the affected mono digits flash opacity 0.4→1 + scale(1.04→1), color transitions through jade and settles back, 300ms |
| Skeleton breathe | 1.2s ease-in-out infinite | — | opacity 0.4↔0.6 only, no gradient sweep |
| Toast | slide+fade, 3.5s auto-dismiss | — | transform+opacity only |

**Jade Glow Ration** (the one hard cap on the whole system):
1. **Max one glow per screen**, tied to a genuinely real-time state. The one wired anchor: bet-detail's hero countdown digits, once under 5 minutes remain — nowhere else uses the literal `box-shadow` glow (the closing-soon dashboard *row*, §5.1/§5.2, uses the opacity-pulsing rail + 6% jade tint instead — that's a different, cheaper mechanism, not this one).
2. **Never** on static icons, nav items, section headers, avatars, chips, or hover states on non-critical elements.
3. Ordinary hover/focus = a 1px jade border or underline, **not** a glow — glow means "this is live," border means "this is interactive." Different jobs, never conflated.
4. Cap: `box-shadow: 0 0 12px oklch(0.860 0.195 158 / 35%)` (== `--jade-glow` at 35% — never `--jade-raw`, which is logo-only) max, single layer, never stacked. A one-time pulse on state-change is fine; a continuous breathing glow is not.
5. If two elements "deserve" the glow simultaneously, only the more time-sensitive one gets it.

Shadows generally: the **only** soft `box-shadow` in the entire app is the modal/dialog overlay (§4.2) — never on cards, rows, or lists.

---

## 7. Voice & microcopy tone

Dry, deadpan, irreverent — never corporate, never hype-startup. Copy does semantic work that color isn't allowed to do (especially the poor podium and empty states).

| Surface | Example line |
|---|---|
| Empty dashboard | "No bets yet. Someone has to make the first bad decision." |
| Empty bet list (alt) | "Nobody's lost anything here. Yet." |
| Poor podium, empty | "Everyone's still solvent. Suspicious." |
| Poor podium, rank 1 tagline | "House's favorite donor" |
| Onboarding skip affordance | plain, low-pressure — never "Complete your profile to unlock features!" |
| Error toast | plain statement of what failed, no exclamation points, no "Oops!" |
| Destructive confirm helper | `Type "{team}" to confirm` — factual, not alarmist |

Rule: humor replaces color as the "this is the losing board" signal (§5.6) — never let copy go flat/corporate on the one surface (poor podium) that most needs personality to avoid feeling punitive.

### 7.1 Writing the Portuguese (UX-027)

pt-BR shipped in `apps/web/messages/pt-BR.json` (plan-i18n-ptbr.md D10). Everything above applies to it unchanged — the voice is the product's, not English's — plus four rulings that make it tractable. **Read this section before writing a Portuguese sentence.**

**The nouns are fixed, once.** `bet` = **aposta** (feminine), `duel` = **duelo** (masculine), `team` = **time** (masculine), `coin` = **moeda** (feminine), `wager` = **aposta** / the verb **apostar**. Fixing the two head nouns fixes every adjective downstream, which is what makes §5.2's state vocabulary fall out in one piece:

| en | pt-BR | Note |
|---|---|---|
| `OPEN` | `ABERTA` | agrees with *aposta* |
| `CLOSED` | `FECHADA` | |
| `VOID` | `ANULADA` | |
| `RESOLVED` | `RESOLVIDA` | |
| `CLOSING SOON` | `FECHANDO` | 8 characters against 12 — §5's compression rule working in our favour |
| `AWAITING RESULT` | `AGUARDANDO` | likewise: 10 against 15 |
| `VOID · COULDN'T COVER IT` | `ANULADA · SEM SALDO` | |

A **plural** heading is not the same word as a singular label: the bet feed's group heading reads `ABERTAS` where a row's state label reads `ABERTA`. English hides that; Portuguese does not, and they are separate keys because of it.

**Never inflect for the player's gender.** The app has no gender field and must not acquire one. Prefer verb phrases and non-inflecting nouns over agent nouns — §7's *"House's favorite donor"* is **"Quem mais financia a casa"**, not *"Doador oficial da casa"*. Where ICU `select` is genuinely needed it is for the *bet kind*, never for the person.

**Register: Brazilian informal `você`.** Never `tu`, never `vós`, never the corporate-formal imperative.

**Accents survive uppercase.** `ANULADA · NÃO ACEITA A TEMPO`, `SUA POSIÇÃO`, `É COM VOCÊ`. Standard pt-BR keeps diacritics in caps, and `tracking-wider` at 11px renders them fine. §3's uppercase discipline is otherwise unchanged: still only short status labels and eyebrows.

**Portuguese runs 15–25% longer than English.** When a translation breaks a tight layout the fix is to compress the COPY first, layout second, and §3's type scale never. Calibration lines, for matching register:

| en | pt-BR |
|---|---|
| No bets yet. Someone has to make the first bad decision. | Nenhuma aposta ainda. Alguém tem que tomar a primeira decisão ruim. |
| Everyone's still solvent. Suspicious. | Todo mundo ainda tá no azul. Suspeito. |
| Not enough coins. | Saldo insuficiente. |
| That didn't go through. Try again. | Não rolou. Tente de novo. |

---

## 8. Banned list (cliché → replacement)

| # | Banned | Replacement |
|---|---|---|
| 1 | Uniform `rounded-2xl` cards + soft shadows everywhere | Flat rectangles, hairline borders, one `cut-*` corner reserved per screen (§4.1, §4.3) |
| 2 | Pill/chip for every metadata type (status, category, count) | Pills reserved for **team tags only**; status/category use uppercase label + bracket/rail language (§5.2), never a colored blob |
| 3 | Purple→blue gradients on buttons/hero/avatar rings | No gradients on interactive elements at all; the one allowed gradient is monochrome black→jade-at-1%, once, on the single largest hero backdrop |
| 4 | Glassmorphism / `backdrop-blur` walls | Solid surfaces + 1px hairline edge; depth via `--surface-0..3` lightness steps only |
| 5 | Emoji-in-colored-circle placeholder avatars | Stencil-style avatar icon set in a `cut-sm` square frame, never a circle for the icon-set itself (uploaded photos get `rounded-full`, §4.1) |
| 6 | Gray-on-gray text soup (3+ indistinguishable grays) | Two tiers only — N7 (primary) / N6 (secondary) — third emphasis tier is jade, not a third gray |
| 7 | Default shadcn zinc palette left untouched | Full token replacement (§2.5) — no stock oklch zinc survives |
| 8 | Green-for-win / **stoplight**-red-for-loss text | Slash-glyph system first: `/` jade for gain, `\` rust for loss (§5.2, §5.5) — direction + glyph, with rust as a second channel on top. Saturated `#F00`-family red stays banned; rust (H=25, C=0.108) is the only red-side hue in the system |
| 9 | Rainbow per-category hue assignment | All categories render identically (white label + icon glyph); color is never a category-differentiation channel |
| 10 | Centered hero + blurred gradient blob landing (UX-021) | Left-aligned wordmark lockup, hard black bg, the slash used as an actual compositional divider — no blob |
| 11 | Neon glow on every icon/button/hover | Glow Ration: max 1 per screen, tied to real urgency only (§6) |
| 12 | Generic shimmer-sweep skeletons | Row-shaped skeletons with a slow opacity breathe, no moving gradient (§5.10) |
| 13 | Dropdown-for-everything (status filter, sort, team switch all as `<Select>`) | Segmented tab controls with a slash-notch active tick for short/frequent choices; dropdowns reserved for genuinely long/rare lists (§5.8) |
| 14 | Uppercase-everything crypto-bro treatment | Uppercase confined to short status labels/eyebrows only (§3) |
| 15 | **"Ops!"** (pt-BR) | Banned exactly as "Oops!" is (§7's error-toast row) — a plain statement of what failed |
| 16 | **Exclamation marks in pt-BR error copy** | Same rule as the English: no exclamation points anywhere an error is reported. Portuguese error copy is where the temptation is strongest, so it gets its own row |

---

## 9. Per-surface checklists

**Dashboard**
- [ ] Open bets before closed, soonest-closing first within open (visual break ≠ just a color change — use a section label + hairline)
- [ ] At most one row carries the featured jade tint (§5.1) — a challenge awaiting the viewer if there is one, otherwise the closing-soonest open bet; and at most one carries the closing-soon pulse (not a `box-shadow` glow — that's bet-detail-only, §6)
- [ ] A duel row shows versus + flat stake, never odds or POOL, and never a `WAGER` control
- [ ] Empty state uses the shared ghost-S-mark pattern, dry copy, one CTA
- [ ] Skeleton rows shaped like real rows, opacity-breathe only

**Bet detail**
- [ ] Header is the one hero surface allowed `cut-md`
- [ ] Odds bars distinguished by fill/position first, chart-hue subset only if 4+ options
- [ ] Resolution banner reuses bet-row win/loss glyph language, scaled up, never introduces new color logic
- [ ] A duel replaces the odds display with the versus composition and resolves by person, not by option
- [ ] Chat section stays dense, no bubbles, hairline-sparse

**Modals** (UX-014/015/016)
- [ ] Backdrop is flat `black/75`, no blur
- [ ] Exactly one corner cut (`cut-md`), never all four rounded
- [ ] Jade is the only focus-ring color; destructive confirm gates on type-match, no red error state
- [ ] Mobile variant is a bottom sheet with mirrored `cut-md`, not a full route change

**Landing / invite / share (logged-out)**
- [ ] No centered-hero-blob template; left-aligned lockup, slash as compositional divider
- [ ] OG/social preview cards use the static jade/neutral bar equivalent, not a live-only component
- [ ] Auth screens stay minimal-field, no security-theater copy, errors avoid red

---

**Source files**: `apps/web/src/app/globals.css` (target for §2.5's `:root` block + `@utility cut-*`), `agent-docs/AGENT_SPEC.md` (requirement IDs referenced throughout), `old-soulless-bg.jpeg` (source of the S-mark/slash motif — trace at small scale, never regenerate).
