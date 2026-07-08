# Handoff: Workload overload resolution workflow

- **Package ID:** PKG-20260708-workload-resolution
- **Status:** ready
- **Tier:** developer
- **Model:** opus
- **Depends on:** none
- **Blast radius:** medium — adds one reducer action to `src/store/AppStore.tsx` (data mutations); must respect sortIndex/assignment invariants.

## Goal
Make overload actionable: clicking an overloaded (or any non-empty) day cell on the Workload page opens a resolution panel listing that person's blocks for that day, with actions to reassign a block to another person, shift the whole task by ±1 day, or open the task editor.

## Context the worker needs
- Relevant files: `src/pages/WorkloadPage.tsx`, `src/store/AppStore.tsx` (see `insertBlock`, `nextSortIndex`, `reindexDays`, `dayKey`, `withActivity` — follow these patterns), `src/store/selectors.ts` (`blocksForPersonDate`, `hoursForPersonOnDate`, `personCapacity`, `getTask`, `getProject`, `getClient`), `src/components/TaskModal.tsx` (`useOpenTask` hook — call `openTask(taskId)` to open the editor overlay without leaving the page), `src/styles.css` (append).
- Conventions: `/Users/kacpercichyn2/Documents/N2click/CLAUDE.md`. Hard invariants: a workload entry's person must be assigned to its task; `sortIndex` contiguous per (person, date) — go through `reindexDays`; activity rows appended inside the same action; overload never blocks input. UI text **Polish**.

## Scope
### In scope
1. **New reducer action** in `src/store/AppStore.tsx`:
   ```ts
   { type: 'REASSIGN_ENTRY'; entryId: string; toPersonId: string }
   ```
   Handler `reassignEntry(state, entryId, toPersonId)`:
   - No-op (return state) if the entry doesn't exist, the target person doesn't exist, or `toPersonId === entry.personId`.
   - Move the single `WorkloadEntry` to `toPersonId`, same `date` and `plannedHours`; its new `sortIndex` = end of the target person's day (`nextSortIndex` computed against the workload WITHOUT the moved entry); then `reindexDays` over both affected day keys (source person|date and target person|date).
   - Ensure a `TaskAssignment` exists for (task, toPersonId); create if missing. Do NOT remove the source person's assignment even if they have no entries left on the task.
   - Activity on the task: `` `przeniósł/przeniosła blok ${hours}h (${date}) z ${fromName} na ${toName}` `` via `withActivity`.
2. **Resolution panel** in `src/pages/WorkloadPage.tsx`:
   - Page state `selected: { personId: string; date: string } | null`. Each non-empty `workload-cell` becomes clickable (button semantics or `role="button"` + keyboard Enter; `cursor: pointer`); clicking toggles selection. Overloaded cells keep their current tint + ⚠.
   - When selected, render a detail row (`<tr>` spanning all columns, class `workload-detail-row`) directly under that person's row: header `„{person.name} — {formatRowLabel(date)}: {X}h / {capacity}h”` (danger-colored when over), then one line per block from `blocksForPersonDate` in sortIndex order: task title, project name + client, `{h}h`, and actions:
     - person `<select>` (all people except the current one, option label shows `{name} — {hoursForPersonOnDate(state, p.id, date)}h/{capacity}h tego dnia`, with a `⚠` suffix when adding this block would exceed their capacity) + button `Przenieś` → dispatch `REASSIGN_ENTRY`.
     - button `Otwórz zadanie` → `openTask(taskId)`.
     - buttons `−1 dzień` / `+1 dzień` → `dispatch({ type: 'MOVE_TASK', taskId, dayDelta: ∓1 })` (existing action; moves the whole task and all its blocks — label the group `Przesuń całe zadanie:`).
   - Panel reflects state immediately after any dispatch (it derives from store state). If the day becomes empty, close the selection.
   - Filters interplay: the panel lists ALL blocks of that person/day (ignore client/service filters inside the panel — add hint `Wszystkie bloki tego dnia, niezależnie od filtrów.` when clientFilter/serviceFilter active).
3. CSS appended to `src/styles.css` under `/* ---------- Workload resolution ---------- */` (detail row surface = `--n2-surface-muted`, danger accents via `--n2-danger` / `--n2-danger-soft`).
### Out of scope
- No drag & drop; no bulk/auto-rebalancing; no changes to `SAVE_TASK`, `INSERT_BLOCK`, CalendarPage, TimelinePage.
- No splitting a block's hours (move is all-or-nothing; the task editor already handles fine-grained hour edits).
- No new npm dependencies.

## Implementation notes
- Reuse `fmtHours` (already local in WorkloadPage).
- After `REASSIGN_ENTRY`, the moved block must land at the END of the target's day order and the source day's sortIndexes must be contiguous again — mirror the `insertBlock` + `reindexDays` approach.
- Keyboard/a11y: cells get `aria-expanded` on the selected one.

## Acceptance criteria
- [ ] Clicking a non-empty day cell opens the panel with the correct blocks (order = sortIndex); clicking again or on the ✕ closes it.
- [ ] Reassigning a block moves the hours to the chosen person: source cell decreases, target cell increases, overload flags/percentages recompute, target person is assigned to the task (verify by opening the task editor), sortIndex stays contiguous on both days (right-click ordering in Calendar week view still coherent).
- [ ] `+1/−1 dzień` shifts the task and its blocks (visible on Timeline and Calendar too); the panel updates.
- [ ] Warning suffix shown in the person select when the move would overload the target; the move is still allowed (warning, never a block).
- [ ] Activity entry appears on the task (check the task's Dyskusja → Aktywność tab).
- [ ] Manual checklist item 9 (workload sums, filters) still passes; console clean; browser reload persists the change.

## Tests
- Command: `npx tsc --noEmit && npm run build`
- Expected: both green. Manual: seed sample data (contains an over-capacity day), resolve it by reassigning a block, confirm the ⚠ disappears.

## Report back
Append a worker entry to `handoffs/RUN-STATE.md`. Synthesized summary only — no raw logs.
