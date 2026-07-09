# Handoff: Docs refresh — rewrite stale CLAUDE.md, archive old packages, remove duplicate workflow clone

- **Package ID:** PKG-20260709b-docs-refresh
- **Status:** ready
- **Tier:** developer
- **Model:** opus
- **Depends on:** PKG-20260709b-bin-drag-freeze-2 (CLAUDE.md must document the REAL freeze root cause; read its worker-log entry in `handoffs/RUN-STATE.md` first)
- **Blast radius:** low — documentation + file moves only; ZERO source-code changes.

## Goal

Bring the repo's Markdown docs back in line with the shipped code (the repo
`CLAUDE.md` still describes the pre-login, pre-budget, `version: 4` app), and
tidy the doc tree per the architect's pinned decisions below. No behavior
changes anywhere.

## Context the worker needs

- The stale doc: `/Users/kacpercichyn2/Documents/N2click/CLAUDE.md` (current
  content describes payload v4, `Person.isAdmin`, "no auth", no Zasobnik/budget,
  no timeline people mode, no FilterPanel, old dashboard).
- Ground truth is THE CODE — verify every claim you write with Read/Grep, do
  not copy run narratives blindly. Key files: `src/types.ts`,
  `src/store/storage.ts` (version, migrations), `src/store/permissions.ts`,
  `src/pages/LoginPage.tsx`, `src/store/AppStore.tsx` (action list, budget rules
  in `setBlockTime`, `INSERT_BLOCK`, `MOVE_BLOCK_TO_BIN`, split action),
  `src/utils/time.ts` (`BIN_DATE`), `src/components/WeekView.tsx` (bin pane,
  ghost, capture rule), `src/components/FilterPanel.tsx`, `src/components/ChatMock.tsx`,
  `src/pages/TimelinePage.tsx` (Projekty|Osoby), `src/pages/DashboardPage.tsx`,
  `src/store/selectors.ts` (`todayAgendaForPerson`, `weekBlocksForPerson`),
  `src/store/seed.ts`, the four test files (`src/utils/time.test.ts`,
  `src/store/blockActions.test.ts`, `src/store/storage.test.ts`,
  `src/store/selectors.test.ts`).
- Run history for orientation only: `handoffs/RUN-STATE.md` (top archive note +
  current run section) and git log around ff4fd8a, 28b9dae, f61bb27.

## Environment constraints (unattended run)

- Use Read/Grep/Glob tools for reading; never `cat`/`ls`/`grep` in Bash (a hook
  rewrites them to blocked `rtk` commands). For shell work use `git …`, `npm …`,
  `npx …`, or the escape hatch `node -e '<script>'` (must start exactly with
  `node -e '`) — use it for `rm -rf` and any blocked command via `execSync`.
- Gates: `npx tsc --noEmit`, `npm test` (expect the post-freeze-fix count from
  package 1's report, ≥195), `npm run build` — they must stay green (trivially,
  since you change no code; run them anyway to prove the tree is sound).

## Scope

### In scope

1. **Rewrite `CLAUDE.md`** to the current state. Keep its existing section
   structure and overall length discipline (intro · what the app does · tech
   stack & commands · architecture · data model & invariants · file map ·
   Figma note · manual test checklist · scope guardrails), keep the "whole UI
   is Polish" rule, and keep it the single source of truth. Facts that MUST be
   corrected/added (verify each in code first):
   - Persistence payload is `version: 5`; migrations: v1→v2, v3→v4
     (`ensureStartMinutes`), v4→v5 (person accounts/roles), with the defensive
     every-load passes; storage key + legacy fallbacks unchanged.
   - `Person.isAdmin` is GONE → `accessRole` (administrator / pm / handlowiec /
     pracownik — verify exact literals), plus new person fields (phone,
     passwordHash, workDays, work start/end minutes, supervisorId — verify names
     in `types.ts`); central `can()` matrix + `useCan()` in
     `src/store/permissions.ts`; per-person availability feeds workload.
   - Local login screen gates the app when people exist and nobody is logged in;
     passwordless people = one-click; SHA-256 WebCrypto, cosmetic-only,
     API-swap-ready; session = persisted `currentUserId`. Impersonation
     ("Występuj jako") keeps a separate `impersonatorId`, is gated on the REAL
     user, and shows a return banner.
   - Hour budget + bin ("Zasobnik"): `BIN_DATE = ''` sentinel rows; week-view
     bin pane; grow draws bin-first-then-headroom and is REJECTED past the
     allowance (null estimate ⇒ bin-only, no minting); shrink returns hours to
     the single (task, person) bin row; exactly-adjacent same-task/person blocks
     auto-merge on drop (fuse animation); block split; `MOVE_BLOCK_TO_BIN`;
     unplaceable >24h bin rows; TaskModal stays the deliberate over-planning
     surface (non-blocking banner + estimate snap).
   - Week view: bin drag uses a body-portaled fixed ghost; document the
     pointer-capture/drag rule AND the freeze root cause exactly as package 1's
     report states it (read the RUN-STATE worker log; if package 1 reported
     "not reproduced", document the hardening + the open status honestly).
   - Timeline `Projekty | Osoby` mode (people bars read-only, click opens task).
   - `FilterPanel` (button + popover + chips + clear-all) on Projects / Tasks /
     Kanban / Workload; presets still compatible; `PaidFilterToggle` removed.
   - Dashboard is the worker's morning page (agenda, ChatMock demo-only team
     chat, SVG donuts, week strip; selectors `todayAgendaForPerson`,
     `weekBlocksForPerson`); sidebar is collapsible.
   - File map: add `LoginPage`, `permissions.ts`, `utils/password.ts`,
     `FilterPanel`, `ChatMock`, `scripts/browser-check-bin-drag.mjs`; remove
     claims that no longer hold (e.g. old dashboard cards, PaidFilterToggle
     export — verify what `ProjectsPage` exports now).
   - Tests: state the current green count from `npm test` and the four test
     files. Keep the "all four gates must pass" rule.
   - Manual test checklist: update items to current behavior (login step,
     roles/permissions gate instead of isAdmin, budget clamp + merge, bin drag
     incl. the freeze regression check via the browser script, timeline Osoby,
     FilterPanel, new dashboard). Keep it roughly the current length — replace,
     don't balloon.
   - Scope guardrails: keep "no real backend/multi-user sync" but reword now
     that local login exists; keep known-issue note on `SAVE_TASK` multi-block
     collapse ONLY after verifying it is still true in code.
2. **Archive completed handoff packages.** Create
   `handoffs/packages/archive/` and `git mv` every package file from previous
   runs into it — everything except `README.md` and the two current-run
   packages (`PKG-20260709b-bin-drag-freeze-2.md`, `PKG-20260709b-docs-refresh.md`).
   Add one line to `handoffs/packages/README.md` noting that completed runs'
   packages live in `archive/`. (Architect decision: archive, not delete —
   traceability.)
3. **Delete the `fabletieredworkflow/` directory** from disk (use
   `node -e '…execSync("rm -rf fabletieredworkflow")…'` with an absolute path).
   Architect verified it is a gitignored duplicate clone of the workflow
   template already installed under `.claude/` + `docs/workflow/` +
   `handoffs/`; it is recoverable from its own git remote. It is NOT tracked,
   so git status stays clean. Do NOT touch `.gitignore` (the stale ignore line
   is harmless and cheap insurance if the clone ever returns).
4. **Verify `automation/claude-scheduler/README.md`** against
   `automation/claude-scheduler/run-queue.mjs`: default times, branch naming,
   env vars (`CLAUDE_AUTO_TIMES`, `CLAUDE_AUTO_DRY_RUN`,
   `CLAUDE_AUTO_SKIP_PERMISSIONS`), prompt/log/state paths, post-run
   test+build+commit behavior. Fix only actual inaccuracies; keep it Polish.
5. **Leave alone:** `reviews/` (kept as-is for traceability — architect
   decision), `docs/workflow/` templates, `.claude/` agent files,
   `handoffs/RUN-STATE.md` (the architect owns it; you only APPEND your worker
   log entry).

### Out of scope

- Any change under `src/` (zero code edits), `package.json`, configs.
- Rewriting `docs/workflow/TIERED-AGENTS.md` or the agent definitions.
- Deleting anything under `reviews/` or `handoffs/` (moves into `archive/` only).
- Creating new report/summary .md files beyond the edits listed above.

## Acceptance criteria

- [ ] Grep checks on the new `CLAUDE.md`: no `isAdmin`, no `version: 4` stated
      as current, no "no auth"/"No backend" claim left unqualified, no
      `PaidFilterToggle`, no `TaskEditorPage`; it DOES mention `accessRole`,
      `permissions.ts`, `LoginPage`, Zasobnik/`BIN_DATE`, budget/allowance,
      `FilterPanel`, timeline `Osoby`, the new dashboard, `version: 5`, and the
      freeze root cause (or its honest open status).
- [ ] Every factual claim in the rewritten CLAUDE.md was verified against code
      (list in your report any claim from this package you found to be wrong
      and corrected).
- [ ] `handoffs/packages/` contains only `README.md`, the two
      `PKG-20260709b-*` files, and `archive/` with all older packages moved
      via `git mv` (history preserved).
- [ ] `fabletieredworkflow/` no longer exists on disk; `git status` shows no
      new untracked noise from this package.
- [ ] `automation/claude-scheduler/README.md` matches `run-queue.mjs` behavior.
- [ ] `npx tsc --noEmit` clean · `npm test` green (count unchanged from
      package 1's report) · `npm run build` OK.

## Tests

- Command: `npx tsc --noEmit && npm test && npm run build`
- Expected: unchanged green (this package touches no code); the acceptance
  greps above pass.

## Report back

Synthesized summary only: sections of CLAUDE.md rewritten with the notable
corrections, files moved/deleted, scheduler-README inaccuracies found (if any),
gate results. Append to `handoffs/RUN-STATE.md` worker log. No raw logs.
