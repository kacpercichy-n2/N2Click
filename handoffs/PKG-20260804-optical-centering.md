# Handoff: Optically centre text and icons (half-leading trim)

- Package ID: PKG-20260804-optical-centering
- Status: done (2026-08-07) — mechanizm INNY niż zakładała faza 1: `text-box`
  nie działa na kontenerach grid/flex (przycina wyłącznie blokowe), a metric
  overrides nie działają w Safari. Wysłane: alias 'Plus Jakarta Sans Trimmed'
  (fonts.css) + blokowy span `.avatar-glyphs` z `text-box` (Avatar.tsx),
  svg `display: block` na `.coin`/`.save-status` (faza 3), browser-check
  rozszerzony (login, sonda mechanizmu, nawigacja per sonda) — Chromium i
  WebKit zielone: goły sans 1–2 px za nisko (INFO), mechanizm 0,00 px.
  Pigułki Interowe nietknięte (symetryczne). Szczegóły:
  openwiki/n2hub/frontend-performance-and-primitives.md.
- Tier: developer
- Depends on: none
- Risk: medium — touches the app-wide sans token and ~40 centred surfaces
- Codex review: required — cross-cutting typography change

## Goal

Text and icons sit visibly low inside circular and pill-shaped containers.
Make the fix once, at the font/box level, and delete the ad-hoc compensations
instead of adding more. Ship a measurable check so the result cannot silently
regress when a font version is bumped.

## Wiki context

- `openwiki/n2hub/frontend-performance-and-primitives.md`
- `openwiki/n2hub/testing-and-automation.md`

## Why it happens — settled, do not re-derive

A flex/grid box centres the **content area** of the text — the font's `hhea`
ascent plus descent — not the glyphs. Those two are only symmetric if the
type designer made them so. When they are not, the cap-height block lands off
centre by `(ascent + descent − capHeight) / 2`, in em, at every font-size.
`line-height: 1` does not fix it: it shrinks the line box, not the content area.

`node scripts/font-metrics.mjs` measures this straight from the self-hosted
woff2 files in `node_modules/@fontsource/*`. Current numbers:

| Token | Family | cap% | offset | @14px | @24px | @36px | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `--n2-font-sans` | Plus Jakarta Sans 400–700 | 74.5 | **3.55%** | 0.50 px | 0.85 px | 1.28 px | asymmetric — fix |
| `--n2-font-data` | Inter 400–700 | 72.8 | **0.00%** | 0.00 px | 0.00 px | 0.00 px | symmetric — leave alone |
| `--n2-font-display` | Orbitron 700 | 72.0 | **2.40%** | 0.34 px | 0.58 px | 0.86 px | asymmetric — fix if centred |
| `--n2-font-mono` | Fragment Mono 400 | 69.9 | 0.05% | 0.01 px | 0.01 px | 0.02 px | symmetric — leave alone |

Three consequences that shape the whole package:

1. **The bug is Plus Jakarta Sans, not CSS.** Inter is metrically symmetric by
   design, so every `--n2-font-data` surface is already correct. Do not "fix"
   them — you would introduce the offset you are trying to remove.
2. The offset scales with font-size. `.avatar` sets `fontSize: size * 0.38`, so
   a 32 px avatar is 0.43 px low and a 96 px profile avatar is 1.30 px low.
   That is why the problem reads as "sometimes it's fine, sometimes it isn't".
3. Icons are a **separate** problem with a separate fix. Do not fold them into
   the font work.

## Expected touchpoints

- `src/fonts.css` — new trimmed `@font-face` aliases (phase 2 only)
- `src/styles.css` — `text-box` on the declared surfaces; the three `svg` rules
  at ~3448, ~4849, ~6875; the `--n2-font-sans` token block at ~18
- `src/components/Avatar.tsx` — read only; confirm initials stay uppercase
- `new: scripts/browser-check-optical-centering.mjs`
- `scripts/font-metrics.mjs`, `scripts/audit-optical-centering.mjs` — already in
  the tree, both run green; do not rewrite them, extend if needed
- `openwiki/n2hub/testing-and-automation.md` — register the new browser check

Run `node scripts/audit-optical-centering.mjs` for the current work list. As of
2026-08-04 it reports 55 centred boxes (41 circular/pill), 28 asymmetric
paddings, 0 stray nudges, 3 `svg` rules missing `display: block`, 0 asymmetric
lucide icons.

## Invariants

- No new runtime dependencies. Both helper scripts are pure Node on purpose —
  `font-metrics.mjs` parses woff2 with `zlib.brotliDecompressSync` rather than
  pulling in `fontkit`. Keep it that way.
- Polish user-facing strings; no visible copy changes in this package at all.
- Do NOT touch `src/store/`, reducers, selectors or storage.
- Do NOT apply `ascent-override` / `descent-override` to the `--n2-font-sans`
  token itself. Overriding metrics changes what `line-height: normal` resolves
  to, which reflows every multi-line paragraph in an 11 222-line stylesheet.
  Overrides go on a **separate family alias**, applied only where declared.
- `descent-override: 0%` clips descenders. It is safe only on surfaces whose
  content is guaranteed uppercase — `.avatar` initials
  (`initials.toUpperCase()`, `Avatar.tsx:47`) qualify; anything that can render
  Polish lowercase (`ą`, `ę`, `g`, `j`, `p`, `y`) does not, and `.filter-chip`
  has `overflow: hidden` (`styles.css:7359`) which would crop it visibly.
- Retirement mode stays disabled. No git state changes; do not commit.
- `.icon-btn svg { display: block }` at `styles.css:3482` is already correct —
  it is the reference pattern, not something to change.

## Scope

### Phase 1 — `text-box` on centred surfaces (zero-risk, do this first)

```css
.avatar,
.dash-badge,
.filter-badge,
.dash-changelog-badge,
.cp-week-count,
.task-modal-close,
.week-block-done-btn {
  text-box: trim-both cap alphabetic;
}
```

Support is Chrome 133+, Edge 132+, Safari 18.2+, Firefox 154+ — roughly 80% of
traffic today. Firefox below 154 ignores the declaration and renders exactly
what it renders now, so there is no regression path and no fallback to write.

Work the list from `audit-optical-centering.mjs --only centred`, but apply this
only to boxes that hold **a single line** and are actually centred. Skip rows
(`.dash-row`, `.gs-row`, `.alloc-daylist-row`) — they centre a flex line, not a
text block, and trimming there changes nothing while adding noise to the diff.

### Phase 2 — trimmed alias for cross-browser parity (optional, decide after phase 1)

Only if the Firefox split is judged unacceptable before 154 lands. Generate the
block with `node scripts/font-metrics.mjs --css` and paste it after the existing
declarations in `src/fonts.css`:

```css
@font-face {
  font-family: 'Plus Jakarta Sans Trimmed';
  font-weight: 700;
  src: url(../node_modules/@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-700-normal.woff2) format('woff2');
  ascent-override: 74.50%;
  descent-override: 0%;
  line-gap-override: 0%;
}
```

Apply to `.avatar` only, with an explicit `line-height` (it already has
`line-height: 1` at `styles.css:3614`). Composing this with phase 1 is safe and
idempotent: once the content box already runs cap→baseline, `text-box-edge: cap
alphabetic` has nothing left to trim.

### Phase 3 — icons

1. Add `display: block` to the three `svg` rules the audit flags:
   `styles.css:3448` (`.coin svg, .coin-btn svg`), `:4849`
   (`.dash-changelog-btn svg`), `:6875` (`.save-status svg`). Inline SVG
   inherits the parent baseline, which is its own independent offset.
2. Nothing else. The audit finds **zero** asymmetric lucide glyphs in use — no
   `<Play>`, `<Send>` or `<Navigation>` anywhere in `src/`. Do not add
   speculative `translateX` corrections; if one is ever needed, the offset is
   `w/6` of the shape's width **minus whatever the icon already bakes in**, and
   it belongs in the `viewBox`, not in a transform.

### Phase 4 — clean up, do not mass-edit

The audit lists 28 asymmetric vertical paddings. Most are deliberate card and
panel layout (`.cp-card-body`, `.cp-rg-expand td`) and must stay. Only revisit a
padding if it sits on a surface you touched in phase 1 **and** removing the
asymmetry now leaves it centred. Every such change goes in the final report with
its before/after `dy` from the browser check.

## Verification

```bash
npm test
npm run build
node scripts/font-metrics.mjs                       # metrics unchanged
node scripts/audit-optical-centering.mjs            # work list shrinks as expected
npm run dev                                         # then, in another shell:
node scripts/browser-check-optical-centering.mjs chromium
node scripts/browser-check-optical-centering.mjs webkit
```

The browser check measures rather than diffs: it neutralises each probe's own
paint, screenshots the border box, decodes it on a canvas inside the page and
compares the ink bounding box centre to the box centre. Synthetic 96 px probes
at 48 px type are the gate (tolerance 0.60 px — an uncorrected Plus Jakarta Sans
lands 1.70 px low, so the two states separate cleanly); live components are
reported at 1.00 px because their 11–14 px type puts the true offset close to
rasteriser noise.

Playwright is deliberately not a `package.json` dependency, same as the existing
checks:

```bash
npm install --no-save playwright@1.61.1 && npx playwright install chromium webkit
```

Do **not** add this script to the five release-critical checks in
`scripts/run-browser-regression.mjs` in this package. Register it in
`testing-and-automation.md` as an on-demand typography check; promoting it to
the release matrix is a separate decision.

## Explicit non-goals

- No change to `--n2-font-data` / Inter surfaces. They are already correct.
- No global metric override, no change to the `--n2-font-sans` token value.
- No new icon set, no icon-set migration, no `optical-center` build step.
- No horizontal optical corrections anywhere — every measured `dx` is currently
  within tolerance and the codebase uses no asymmetric glyphs.

## Report back

State, per phase: which selectors were touched, the `dy` before and after from
the browser check, and whether the Firefox-below-154 split was accepted or
closed with phase 2. If phase 1 alone brings every live probe inside 1.00 px,
say so and stop — phase 2 is then dead weight.
