# Tests and automation

## Verification layers

1. Workers run focused unit tests for the changed store or utility area.
2. The operator runs `npm test` and `npm run build` once before commit,
   stopping on the first failure.
3. Run only the relevant browser check for the changed interaction. The release
   verification bundle owns the broad all-browser sweep.

## Automation status

The unattended prompt scheduler (`automation/claude-scheduler/`) was removed in
July 2026; a replacement will be built later. The tiered agent workflow
(architect → developer → reviewer, `docs/workflow/`) remains and is run
interactively. Agents still do not commit or push; the operator owns the final
gate, commit and push.

## Browser checks

- Calendar/bin: `browser-check-bin-drag.mjs`, `browser-check-bin-split.mjs`,
  `browser-check-placement.mjs`.
- Persistence: `browser-check-tab-sync.mjs`.
- Onboarding: `browser-check-onboarding.mjs` (including the live-plan disclosure
  and confirmation).

Run a check in Chromium and WebKit only when its covered behavior changes or a
release verification prompt explicitly requests the full matrix.

Rendering/GPU fixes require a local interaction check in addition to the normal
test suite. Record viewport, DPR and target hardware; use Paint Flashing and a
Performance/Layers trace to verify that the full viewport is not repainted.
Automation may confirm DOM/layer invariants, but the device that reported the
problem is authoritative. See
[frontend-performance-and-primitives.md](frontend-performance-and-primitives.md).

The release bundle is `npm run check:browser-release`
(`scripts/run-browser-regression.mjs`): it builds once, owns its own preview
server on port 5173, and runs all five checks in Chromium and WebKit.

### Targeted checks outside the release bundle

Five more real browser checks exist but are intentionally excluded from the
release matrix (`run-browser-regression.mjs`). Run each on demand (Chromium and
WebKit) only when its covered behavior changes:

- `browser-check-optical-centering.mjs` (PKG-20260804, on-demand typography
  check): measures INK position vs box centre (screenshot → canvas decode), not
  pixel diffs. Section A gates synthetic 96 px probes per font token; the sans
  gate replicates the SHIPPED `.avatar` mechanism — alias 'Plus Jakarta Sans
  Trimmed' (fonts.css metric overrides; Chrome/Firefox) + block glyph span with
  `text-box: trim-both cap alphabetic` (Chrome/Safari 18.2+) — because metric
  overrides don't work in Safari and text-box doesn't work in today's Firefox;
  the raw sans token is an INFO line (asymmetric by nature, never "fixed" at
  token level). Section B measures live surfaces (first VISIBLE match;
  per-probe `path` navigation; sample-data login click first). Companion
  audits: `scripts/font-metrics.mjs` (woff2 metrics; `--css` emits the alias),
  `scripts/audit-optical-centering.mjs` (static work list; svg `display:block`
  rules are all green as of 2026-08-07).

- `browser-check-date-hardening.mjs`: invalid/corrupt-date handling — inline
  Polish errors (the reversed-period assertion drives an explicit `.blur()` on
  the date input first, since inline field errors are blur/save-gated), no
  blank screen or uncaught `RangeError`, malformed JSON stays byte-identical
  and exportable until reset, repairable payloads load repaired, and the
  render-throw recovery screen resets cleanly.
- `browser-check-ui-keyboard.mjs`: wspólny home `/dashboard` dla każdej roli +
  legacy redirect `/my-work` (etykiety PRACOWNIK/ADMINISTRATOR nie istnieją w
  UI od 2026-07-22 — lista logowania pokazuje stanowiska), powłoka telefonu
  (pięć zakładek `.app-bottom-nav` z dokładnie jednym `aria-current`, JEDEN
  `GlobalSearch` = działający Ctrl+K, arkusz „Więcej” na `useOverlay`: brak
  kradzieży fokusa, roving tabindex, zawijanie strzałkami, Escape + powrót
  fokusa, tło CELOWO bez `inert`) i Space activation for week blocks and bin
  cards. Szuflada mobilna nie istnieje od PKG-20260728-mobile-nav-day-view.
- `browser-check-savetask-multiblock.mjs`: `SAVE_TASK` reconciles per-person/day
  allocation-grid cells by delta — an unchanged save leaves multi-block days
  byte-identical, and cell edits touch only the blocks their new total implies.
- `browser-check-status-semantics.mjs`: completion is the stored `Status.isDone`
  flag (not pipeline order or archival), and the admin UI pre-validates the
  only-active/only-done reducer guards.
