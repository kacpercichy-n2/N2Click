# Handoff: Browser regression for placement guards + containment decision note + doc updates

- **Package ID:** PKG-20260713b-placement-browser-docs
- **Status:** ready
- **Tier:** test-writer
- **Model:** sonnet
- **Depends on:** PKG-20260713b-placement-core, PKG-20260713b-placement-ui
- **Blast radius:** none — a new Playwright script, a decision note, surgical CLAUDE.md edits, RUN-STATE entry.

## Goal

Prove the new placement guards end-to-end in Chromium AND WebKit; deliver the parent/task date-containment DECISION NOTE (documentation of current behavior + test matrix for human approval — explicitly NOT an enforcement change); update CLAUDE.md only where behavior actually changed.

## Context the worker needs

- Pattern to mirror: `scripts/browser-check-status-semantics.mjs` and `scripts/browser-check-bin-split.mjs` (ok()/failures/notes, PASS/FAIL verdict, `[chromium|webkit]` CLI arg, screenshots, zero-`pageerror` assertion, localStorage seeding/injection under key `n2hub.data.v1`).
- ENVIRONMENT: unattended run. Bash allows `node`, `npm test`, `npx tsc --noEmit` ONLY. ALL git commands denied; `npm run dev`/vite CLI/curl denied. Port 5173 may already serve a dev server — VERIFY it serves THIS working tree (a prior run found a stale sibling checkout there; it freed the port via `process.kill(pid,'SIGTERM')` from a `node -e` script and started vite via `vite.createServer()` from the node API — copy that approach if needed). Playwright runs via plain `node script.mjs`; `npm install --no-save playwright` is permitted if the package is absent (browsers are cached).
- DOM hooks: read the UI package's worker report in `handoffs/RUN-STATE.md` AND the real code (`src/components/WeekView.tsx` insert form, `src/pages/WorkloadPage.tsx` BlockRow) before writing selectors. Expected strings: `⚠ Wstawka nie mieści się w dobie — bloki za nią musiałyby wyjść poza 24:00.`, `⚠ Termin zadania przekroczyłby limit 92 dni.`, option suffix ` — brak miejsca`, button title `Brak wolnego przedziału czasu w tym dniu u wybranej osoby.` — but VERIFY against shipped code.
- Containment context (for the decision note): parent-project containment of task dates is NOT a current product invariant and must not be invented unattended (explicit task constraint). Current behavior, verified by the architect: `SAVE_TASK`/`SET_TASK_DATES` validate the task period only against itself (92-day cap, validity, ordering) — never against the project's `startDate`/`endDate`; `SET_BLOCK_TIME`/`INSERT_BLOCK` extend the TASK period (cap-guarded) regardless of project dates; Timeline moving a PROJECT moves only project dates (tasks intentionally independent — CLAUDE.md Timeline bullet).

## Scope

### In scope

1. `scripts/browser-check-placement.mjs` (new) — one continuous flow per engine, seeded via `LOAD_SAMPLE` + a localStorage injection that builds a near-midnight fixture (e.g. one person with a block ending 23:00 and a nearly-full day, plus a far-dated second task for the cap case):
   - (a) Right-click a near-midnight block → `Dodaj po` → hours that cannot fit → the exact fit warning visible + `Wstaw` disabled; reduce hours to fit → warning clears, insert lands, and a localStorage scan proves NO same-person time overlap on that day.
   - (b) In the insert form pick the far-dated task so the extension would exceed 92 days → the exact cap warning + disabled `Wstaw`; switch back → enabled.
   - (c) `/workload` → open a day panel → target person whose day cannot fit the block shows ` — brak miejsca` and disabled `Przenieś` with the exact title; a fitting target reassigns successfully (block appears under the target, no overlap via localStorage scan).
   - (d) Bin card „Zaplanuj część” default start does not collide when a slot exists (open the form on a day with occupancy and assert no collision warning appears initially).
   - (e) Zero `pageerror` events; screenshots per step into `reviews/screenshots-20260713b-placement/`.
   - Run and PASS on BOTH chromium and webkit.
2. `docs/decisions/2026-07-13-parent-task-date-containment.md` (new) — decision note for HUMAN approval, no code change:
   - Current behavior statement (the verified facts above, with file/function references).
   - Options: A keep (status quo, document only), B soft-warn in TaskModal/ProjectDetail when task dates leave the project period, C hard-enforce containment (reducer guards + migration/repair question). List concrete costs/risks of B and C (e.g. C breaks INSERT_BLOCK/SET_BLOCK_TIME auto-extension semantics and needs a repair policy for existing out-of-range data).
   - A test matrix table: writer (SAVE_TASK, SET_TASK_DATES, MOVE_TASK, SET_BLOCK_TIME cross-day, INSERT_BLOCK, SCHEDULE_BIN_PART, timeline project move) × containment scenario → expected result under each option.
   - Explicit closing line: no option is enacted by this run; awaiting human decision.
3. `CLAUDE.md` — surgical edits ONLY where behavior changed: Calendar bullet (right-click insert now refuses inserts that cannot fit the day and respects the 92-day cap, with live Polish warnings); Workload bullet (reassign pre-validates target-day fit, `— brak miejsca`); Architecture/State bullet one clause: automatic placement (INSERT_BLOCK, REASSIGN_ENTRY, new SAVE_TASK rows) uses a free-slot search and never clamp-creates hidden overlaps (SAVE_TASK falls back non-blocking per invariant 3); manual checklist item 8 gets a clause for the near-midnight insert refusal + reassign guard. Do not rewrite unrelated sections.
4. `handoffs/RUN-STATE.md` — append your worker entry to the 2026-07-13b run section.

### Out of scope

- Any `src/` file, any unit-test file, any existing browser script (especially `browser-check-bin-drag.mjs` / `browser-check-bin-split.mjs` — do not touch).
- Enforcing/implementing ANY containment option — the note is the deliverable.
- New npm dependencies beyond the permitted no-save playwright install.

## Implementation notes

- Fixture math: a person with blocks 08:00-23:00 (or dense equivalent) leaves 1h; asking to insert 2h "po" must trip the fit guard. For the cap case give the second task `startDate`/`endDate` ~90 days away from the fixture day and enough `estimatedHours` headroom that the budget guard doesn't mask the cap warning (read the form's check order in shipped code).
- For localStorage overlap scans reuse the quarter/minute math inline (script-local helper) — scripts can't import TS modules.
- Keep the script deterministic: fixed dates relative to the seeded week, no reliance on today's weekday beyond what existing scripts already do.

## Tests

- Command: `npx tsc --noEmit`; `npm test`; production build `node -e "import('vite').then(v => v.build())"`; `node scripts/browser-check-placement.mjs` and `node scripts/browser-check-placement.mjs webkit`.
- Expected: tsc 0 errors; full suite green (count as left by the tests package); build success (pre-existing >500 kB chunk warning tolerated); browser script all-PASS on both engines with screenshots written.

## Report back

Synthesized summary only: script check list + PASS counts per engine, decision-note location + option summary, exact CLAUDE.md hunks touched, environment obstructions (port 5173 etc.) and how resolved, deviations.
