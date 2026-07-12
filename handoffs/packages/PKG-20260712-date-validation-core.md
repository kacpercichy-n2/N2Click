# Handoff: Shared date validation + reducer guards + storage date normalization

- **Package ID:** PKG-20260712-date-validation-core
- **Status:** ready
- **Tier:** developer
- **Model:** opus
- **Depends on:** none
- **Blast radius:** high — data layer (reducer write paths + localStorage load normalization). No schema/version bump.

## Goal

One shared date/period validation utility, used to (a) reject invalid dates in
every reducer write path so a bad command is never persisted, and (b) repair
invalid persisted dates on every load with an idempotent normalization pass —
so no `''`/garbage/impossible date can reach `parseDate` → `format` in render
(the current blank-screen RangeError).

## Context the worker needs

- Relevant files: `src/utils/dates.ts`, `src/store/AppStore.tsx`,
  `src/store/storage.ts`, `src/utils/time.ts` (read-only: `BIN_DATE`,
  `isBinEntry`), `src/types.ts` (read-only reference).
- Docs: `CLAUDE.md` ("Architecture" + "Data model & invariants" — note the doc
  is partially stale, v4-era; **trust the code**, current `DATA_VERSION = 6`).
- Root cause found by the architect: `parseDate('')` (and any garbage string)
  returns an Invalid Date; date-fns `format(Invalid Date)` throws RangeError.
  Nothing validates dates on write: `SAVE_PROJECT` persists `draft.startDate`
  verbatim (AppStore.tsx ~line 498), UI forms only compare `endDate < startDate`
  as strings (false for `''` start), and TaskModal's 92-day check compares
  `NaN > 92` = false, so empty dates pass as "valid".
- Prior decisions (settled — do not reopen):
  - Valid date = string matching `^\d{4}-\d{2}-\d{2}$` AND round-trips:
    `parse(d, DATE_FMT, ref)` is a valid Date AND `format(parsed, DATE_FMT) === d`.
    This rejects `'2026-02-31'`, `'2026-13-01'`, `'2026-2-3'`, `''`, garbage.
  - `BIN_DATE` (`''`) stays a VALID sentinel **only** for `WorkloadEntry.date`.
    It is invalid everywhere else (project/task/milestone dates).
  - Rejection pattern in the reducer = `return state` unchanged (same as
    `SET_BLOCK_TIME`), so tests can assert `toBe(state)`.
  - No `DATA_VERSION` bump. The repair pass runs on EVERY load, idempotent by
    value — same philosophy as `ensureStartMinutes` / `normalizeTaskMeta`.

## Scope

### In scope

1. **`src/utils/dates.ts` — add (keep everything existing):**
   - `export const MAX_TASK_PERIOD_DAYS = 92;` (canonical home for the cap).
   - `export function isValidDateStr(d: string): boolean` — rule above; must
     not throw on any string input.
   - `export type PeriodError = 'missing-start' | 'invalid-start' | 'missing-end' | 'invalid-end' | 'reversed' | 'too-long';`
   - `export function periodError(start: string, end: string, opts?: { maxDays?: number }): PeriodError | null`
     — check order: empty start → `missing-start`; non-empty invalid start →
     `invalid-start`; same for end; both valid and `end < start` (plain string
     compare is safe once both are valid) → `reversed`; `opts.maxDays` given and
     `inclusiveDayCount(start, end) > maxDays` → `too-long`; else `null`.
   - `export const PERIOD_ERROR_LABELS: Record<PeriodError, string>` — Polish:
     - `missing-start`: `Podaj datę startu.`
     - `invalid-start`: `Data startu jest nieprawidłowa.`
     - `missing-end`: `Podaj datę końca.`
     - `invalid-end`: `Data końca jest nieprawidłowa.`
     - `reversed`: `Data końca musi być taka sama jak data startu albo późniejsza.`
     - `too-long`: `` `Okres zadania nie może przekraczać ${MAX_TASK_PERIOD_DAYS} dni.` ``
2. **`src/store/AppStore.tsx` — reducer guards (return `state` unchanged on
   violation, no activity row):**
   - `SAVE_TASK` (`saveTask`): reject when
     `periodError(draft.startDate, draft.endDate, { maxDays: MAX_TASK_PERIOD_DAYS }) !== null`.
   - `SET_TASK_DATES`: same task-period guard.
   - `SAVE_PROJECT` (`saveProject`): reject when
     `periodError(draft.startDate, draft.endDate) !== null` (no max-days for projects).
   - `SET_PROJECT_DATES`: same project guard.
   - `SAVE_MILESTONE` and `MOVE_MILESTONE`: reject when `!isValidDateStr(action.date)`.
   - Replace the local `const MAX_PERIOD_DAYS = 92` (AppStore.tsx ~line 49) with
     the imported `MAX_TASK_PERIOD_DAYS` (keep the existing 92-day check in the
     block-time path working identically).
3. **`src/store/storage.ts` — `export function normalizeDates(data: AppData): AppData`**,
   an every-load idempotent pass wired into `loadData()` in BOTH branches,
   inserted **before `ensureStartMinutes`** (so entries it moves to the bin get
   merged/renumbered by the existing bin machinery). Deterministic repair rules:
   - Project + Task `startDate`/`endDate`: both invalid → both `todayStr()`;
     exactly one invalid → copy the valid one; both valid but `endDate < startDate`
     → swap them. (Do NOT retro-clamp task periods to 92 days — write-path only.)
   - Milestone `date` invalid → its project's (post-repair) `startDate`; if the
     project doesn't exist, `todayStr()`.
   - `WorkloadEntry.date`: `BIN_DATE` (`''`) is valid as-is; otherwise invalid →
     convert the entry to a bin entry (`date: BIN_DATE`, `startMinutes: 0`) and
     let the downstream `ensureStartMinutes` bin merge enforce the one-bin-row
     invariant. Hours are preserved, never dropped.
   - `SavedFilter.criteria.from` / `.to`: non-empty and invalid → `''`.
   - `Comment.createdAt` / `ActivityEvent.createdAt`: if `Number.isNaN(Date.parse(v))`
     → `'1970-01-01T00:00:00.000Z'` (fixed sentinel keeps the pass idempotent;
     these are rendered through `formatTimestamp`, which also throws on garbage).
   - When nothing needs repair, return the SAME object (`data`) — follow the
     no-op short-circuit style of `ensureStartMinutes`.
4. **`src/store/storage.ts` — `export function exportRawData(): string | null`**
   returning the raw persisted string from `STORAGE_KEY` (falling back to
   `LEGACY_STORAGE_KEYS`), `null` if absent or storage throws. This is the
   pre-normalization payload for the error boundary's export button
   (PKG-20260712-date-ui-error-boundary consumes it — keep the exact name).

### Out of scope

- Any UI/component change (forms, error boundary — separate package).
- Tests beyond keeping the existing suite green (separate test package).
- Retro-clamping >92-day persisted task periods; enforcing "entry date inside
  task period" for validly-dated entries; dangling-reference cleanup beyond
  what already exists.
- `DATA_VERSION` bump, seed changes, docs.
- Backend/API of any kind.

## Implementation notes

- Follow the module's existing conventions: JSDoc-style comments explaining the
  invariant, pure functions, no direct localStorage outside storage.ts.
- `periodError` must never throw — guard `inclusiveDayCount` behind the
  validity checks (it NaNs/throws on invalid input).
- In `loadData()` the chain currently is
  `sanitizeImpersonator(normalizeTaskMeta(ensureStartMinutes(migrateV4toV5(...))))`
  (both the `version < 2` branch and the main branch) — insert `normalizeDates`
  directly after `migrateV4toV5(...)`.
- Watch idempotence: a repaired payload run through `normalizeDates` again must
  change nothing.

## Acceptance criteria

- [ ] `isValidDateStr`: true for `'2026-07-12'`, `'2028-02-29'`; false for `''`,
      `'2026-02-31'`, `'2026-13-01'`, `'2026-2-3'`, `'abc'`, `'2026-07-12T00:00'`.
- [ ] Dispatching `SAVE_PROJECT` with `startDate: ''` (or garbage, or reversed
      dates) returns the previous state object unchanged — nothing persisted,
      no activity row.
- [ ] Same for `SAVE_TASK` (plus a 93-day period rejected, a 92-day period
      accepted), `SET_TASK_DATES`, `SET_PROJECT_DATES`, `SAVE_MILESTONE`,
      `MOVE_MILESTONE`.
- [ ] Valid commands behave byte-for-byte as before (existing tests green).
- [ ] `loadData()` on a stored payload containing a project with
      `startDate: ''`, a task with `endDate: '2026-02-31'`, a reversed project
      period, a milestone with a garbage date, and a workload entry with
      `date: 'not-a-date'` returns fully valid data per the repair rules; the
      bad workload entry's hours end up in that person's single bin row.
- [ ] `normalizeDates` is idempotent (second pass returns the same-value data;
      untouched valid payloads come back as the same object).
- [ ] `exportRawData()` returns the raw stored string; `null` when empty.
- [ ] `npx tsc --noEmit`, `npm test`, `npm run build` all pass.

## Tests

- Command: `npm test` and `npx tsc --noEmit`
- Expected: entire existing suite stays green (currently ~232+ tests across 6
  files). New unit tests for this package arrive separately in
  PKG-20260712-date-hardening-tests — you only need to keep existing tests
  green, but export `normalizeDates`, `isValidDateStr`, `periodError`,
  `PERIOD_ERROR_LABELS`, `MAX_TASK_PERIOD_DAYS`, `exportRawData` so that
  package can import them.

## Report back

Synthesized summary only: files changed one-line each, guard list actually
added, test results, any deviation from the repair rules. Log to
`handoffs/RUN-STATE.md`. No raw logs.
