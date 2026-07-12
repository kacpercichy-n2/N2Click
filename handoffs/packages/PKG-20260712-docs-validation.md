# Handoff: Document the date-validation invariant, error boundary, and security limitation

- **Package ID:** PKG-20260712-docs-validation
- **Status:** ready
- **Tier:** test-writer
- **Model:** sonnet
- **Depends on:** PKG-20260712-date-validation-core, PKG-20260712-date-ui-error-boundary
- **Blast radius:** none — documentation only (`CLAUDE.md`).

## Goal

Make `CLAUDE.md` (the single source of truth for agents) reflect the new
validation layer, the error boundary, and the explicit limitation that
client-side validation is not a security boundary.

## Context the worker needs

- File: `CLAUDE.md` (repo root). Read the sections named below before editing.
- What shipped in this run (verify against the actual merged code, not this
  summary, if they disagree): shared validators in `src/utils/dates.ts`
  (`isValidDateStr`, `periodError`, `PERIOD_ERROR_LABELS`,
  `MAX_TASK_PERIOD_DAYS = 92`); reducer write-path guards (SAVE_PROJECT,
  SAVE_TASK, SET_TASK_DATES, SET_PROJECT_DATES, SAVE_MILESTONE, MOVE_MILESTONE
  return state unchanged on invalid dates); every-load idempotent
  `normalizeDates` pass in `src/store/storage.ts` (+ `exportRawData`); root
  `src/components/ErrorBoundary.tsx` mounted in `src/main.tsx` with Polish
  recovery screen (export JSON / reload / confirmed reset — never automatic).
- Known: CLAUDE.md is partially stale (says payload `version: 4`; code is
  `DATA_VERSION = 6`). A full doc refresh is a separate backlog item — do NOT
  attempt it here; make only the edits listed below.

## Scope

### In scope

1. **"Data model & invariants" — append a new hard invariant (number 8):**
   dates are validated at every write path: a persisted calendar date is always
   a real `yyyy-MM-dd` date (`isValidDateStr` / `periodError` in
   `src/utils/dates.ts`, Polish messages in `PERIOD_ERROR_LABELS`); reducer
   date/period commands that fail validation return state unchanged; the only
   legitimate exception is `WorkloadEntry.date === ''` (`BIN_DATE` bin
   sentinel); `normalizeDates` in storage.ts repairs invalid persisted dates on
   every load (idempotent, like `ensureStartMinutes`) so render code may assume
   valid dates.
2. **"Architecture" storage bullet:** change the stale "currently `version: 4`"
   claim to "currently `version: 6`" and add `normalizeDates` to the list of
   every-load normalization passes (one sentence; do not document the v5/v6
   feature history here).
3. **File map:** add `ErrorBoundary` to the components list (one line: root
   Polish recovery screen — export raw JSON via storage's `exportRawData`,
   reload, confirmed reset; mounted in `main.tsx` above the router/provider;
   recovery is always user-triggered).
4. **"Manual test checklist" — add one item:** saving a project or task with an
   empty/invalid/reversed date shows a Polish inline error and persists
   nothing; a corrupted stored payload (e.g. project `startDate: ''`) loads
   repaired instead of blank-screening; a render crash shows the recovery
   screen with working export/reset.
5. **"Scope guardrails" — add the security note:** all validation is
   client-side UX/data-integrity protection only; with no backend there is no
   trust boundary — anyone with the browser can write arbitrary localStorage.
   Real enforcement belongs to the future API (the already-planned storage.ts
   swap).

### Out of scope

- Any code or test change.
- Rewriting other stale CLAUDE.md sections (v5/v6 features, roles/login,
  bin/budget system) — separate backlog package.
- Other docs (`docs/workflow/*`, memory files, README).

## Implementation notes

- Match the existing voice: terse, imperative, one bullet per fact, Polish UI
  strings quoted as-is.
- Verify symbol names against the merged code before writing them down.

## Acceptance criteria

- [ ] All five edits present, each in the named section, consistent with the
      merged implementation (symbol names correct).
- [ ] No other CLAUDE.md content reworded or removed.
- [ ] `npx tsc --noEmit && npm test` still green (nothing else touched).

## Tests

- Command: `npm test`
- Expected: unchanged, fully green (docs-only change).

## Report back

One-paragraph summary of the edits (section → change). Log to
`handoffs/RUN-STATE.md`. No raw logs.
