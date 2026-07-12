# Handoff: Browser regression for multi-block save + CLAUDE.md docs

- **Package ID:** PKG-20260712b-savetask-browser-docs
- **Status:** ready
- **Tier:** test-writer
- **Model:** sonnet
- **Depends on:** PKG-20260712b-savetask-core
- **Blast radius:** low — one new script, screenshots, scoped CLAUDE.md edits. No src/ changes.

## Environment constraints (unattended session — read first)

Direct `git`, `vite`, `npm run build`, `npm run dev`, and arbitrary shell are DENIED. Allowed: `npm install *`, `node -e '<js>'`, rtk-wrapped read/grep/wc/tsc. Precedent (see the end-of-run gate of the previous run in `handoffs/RUN-STATE.md`): the dev server is started through Vite's node JS API via `node -e`, and Playwright scripts run via `node -e` with the script imported/inlined if `node scripts/…` is denied. Mirror `scripts/browser-check-date-hardening.mjs` — it already solves server boot, browser launch (Chromium + WebKit), any login/acting-user setup, and screenshot output. Log your result to `handoffs/RUN-STATE.md` (Worker log).

## Goal

A rerunnable browser regression proving TaskModal saves no longer destroy same-day calendar blocks, plus CLAUDE.md updated to document the fix and the new invariant.

## Context the worker needs

- Precedent scripts: `scripts/browser-check-date-hardening.mjs`, `scripts/browser-check-bin-drag.mjs`. Screenshots convention: `reviews/screenshots-20260712-savetask/`.
- App facts: sample data loads via the SampleBanner button (read `src/components/SampleBanner.tsx` for the exact label/selector); storage key `n2hub.data.v1`; tasks open TaskModal via `?task=<id>`; the allocation grid inputs have class `alloc-input`; save button text `Zapisz zmiany`; multi-block cells show an `alloc-multi` badge (from the core package).
- The fixed semantics (assert, don't reinterpret): grid cell = day total across that person's blocks of the task; unchanged save preserves every WorkloadEntry row exactly (id, plannedHours, startMinutes, sortIndex); +1h on the cell grows only the LAST block; cell 0 deletes all that pair's blocks.

## Scope

### In scope

**1. New script `scripts/browser-check-savetask-multiblock.mjs`** (structure copied from the date-hardening script; runs Chromium AND WebKit; numbered PASS/FAIL checks; screenshots per step; exit code non-zero on any FAIL). Flow:
   a. Boot dev server (vite node API), fresh context, load app, load sample data (and whatever acting-user/login setup the precedent script does).
   b. Create the repro deterministically via `page.evaluate`: read `localStorage['n2hub.data.v1']`, pick one dated workload entry (task X, person P, day D), append a duplicate with a new id, `startMinutes` = original end snapped (original start + hours*60), `sortIndex` +1, write back, reload. Record both rows.
   c. Open task X's modal (`?task=<id>`); assert the P/D cell input value equals the summed hours and the `alloc-multi` badge is visible.
   d. Click `Zapisz zmiany` with no edits; re-read localStorage; assert both rows for (X, P, D) are present and identical to (b)'s records (ids included).
   e. Reopen the modal, set the P/D cell to +1h, save; assert the later-starting block gained exactly 1h and the earlier block is unchanged.
   f. Reopen, set the cell to 0 (clear it), save; assert both rows are gone and no other workload rows of task X changed.
   g. Sanity: navigate to the calendar week of day D after step (d) and screenshot the two stacked/side-by-side blocks.

**2. CLAUDE.md edits (verify each claim against merged code before writing):**
   - Replace the "Known issue (pre-existing…)" paragraph about SAVE_TASK collapsing multi-block days with a short "fixed 2026-07-12" description of the new model: allocation cells are day totals; SAVE_TASK preserves workload entries by identity (unchanged save is lossless), grows the last block, trims from the end, cell 0 = explicit deletion of that person/day's blocks.
   - Update the architecture bullet "`SAVE_TASK` atomically rebuilds a task's assignments and workload entries (preserving existing blocks' day positions and start times)" to match the identity-preserving delta semantics.
   - Add one sentence to the Tasks section noting multi-block cells show an ×N badge, and extend manual-checklist item 3 with: multi-block day round-trips losslessly through an unchanged TaskModal save.
   - Keep all edits surgical; do not reword unrelated sections (parts of CLAUDE.md are stale by design — out of scope).

### Out of scope
- Any change under `src/`; any change to the two existing browser-check scripts; fixing other stale CLAUDE.md sections; RUN-STATE archive edits (architect owns those).

## Acceptance criteria

- [ ] Script exists, is deterministic (localStorage seeding, no drag simulation needed), and reports PASS on all checks in BOTH Chromium and WebKit against the fixed code.
- [ ] Screenshots written to `reviews/screenshots-20260712-savetask/`.
- [ ] Step (d) asserts id-level equality of the two rows (the actual regression), not just totals.
- [ ] CLAUDE.md: known-issue paragraph replaced, architecture bullet corrected, checklist item extended — all claims verified against code.
- [ ] `npx tsc --noEmit` and `npm test` still green (script is plain .mjs, untyped, not in the vitest glob).

## Tests

- Command: run the new script (via `node -e` import fallback if needed); then `npx tsc --noEmit` && `npm test`.
- Expected: script prints all-PASS for both engines and exits 0; unit suite unchanged and green.

## Report back

Synthesized summary (PASS/FAIL counts per engine, screenshot dir, doc edits list) appended to `handoffs/RUN-STATE.md` Worker log. No raw logs.
