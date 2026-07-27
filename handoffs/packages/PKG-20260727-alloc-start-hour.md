# Handoff: Optional start hour per allocation cell (planowanie z zakładki Zadania)

- Package ID: PKG-20260727-alloc-start-hour
- Status: ready
- Tier: developer
- Depends on: none
- Risk: high — touches the SAVE_TASK workload reconciliation and the reducer payload guard
- Codex review: required — task-save reconciliation identity (invariant 4/6) is the highest-value regression surface in the repo

## Goal

When planning a task from the Zadania tab (TaskModal → „Dzienny przydział
godzin”), let the user OPTIONALLY pin the start hour of a day's block, mirroring
what the calendar scheduling popover already offers. When no hour is given,
placement stays exactly as today (`findFreeStart` → `nextFreeStart` fallback).

## Wiki context

- `openwiki/n2hub/state-and-persistence.md` (SAVE_TASK / reducer boundary)
- `openwiki/n2hub/scheduling-and-calendar.md` (block placement, `findFreeStart`)

## Expected touchpoints

- `src/store/AppStore.tsx`
  - `AllocationCell` (~line 224) — add optional `startMinutes?: number`.
  - `saveTask` payload guard (~line 565–583) — reject malformed `startMinutes`.
  - `saveTask` pair loop — NEW post-pass right after the loop closes (~line 859)
    and BEFORE the bin logic (~line 865).
- `src/components/AllocationGrid.tsx` — new `AllocStartMap` type + `startTimes`,
  `onChangeStart` props; per-cell `<input type="time">`.
- `src/components/TaskModal.tsx` — `startTimes` state (~near `allocations` at
  line 503), seed, `setCellStart` handler (next to `setCell` ~line 642),
  `serializeDraft` (~line 387/403), `plannedCells` (~line 741), grid props
  (~line 1338).
- `src/styles.css` — ONE additive rule block near `.alloc-input` (~line 1335).
- `src/store/saveTaskWorkload.test.ts` — extend.

## Invariants

1. Planned hours live only in `WorkloadEntry`; totals stay derived (invariant 1).
2. Time-of-day is on the 15-minute grid; hours on the 0.25h grid (invariant 2).
3. `SAVE_TASK` NEVER rejects on placement/collision — deliberate editor
   allocations may overlap (invariant 3). A pinned hour may create an overlap;
   that is allowed and renders side-by-side in the week view.
4. One bin row per `(taskId, personId)` — the bin path is untouched (invariant 4).
5. An invalid reducer payload returns the SAME state reference (invariant 6).
6. Existing task-save reconciliation must not regress: with NO `startMinutes` in
   the payload, `saveTask` output must be byte-identical to today for every
   branch (no change / new pair / grow / trim), including the
   "pair NOT touched, blocks byte-identical" short circuit.
7. No new runtime dependency. All new strings Polish.

## Scope

### 1. Model (`src/store/AppStore.tsx`)

```ts
export interface AllocationCell {
  personId: string;
  date: string;
  plannedHours: number;
  /** OPCJONALNA przypięta godzina startu (minuty od północy, siatka 15 min).
   *  Brak => automatyczne umiejscowienie jak dotąd (findFreeStart). Stosowana
   *  tylko, gdy para (osoba, dzień) ma po zapisie DOKŁADNIE jeden blok. */
  startMinutes?: number;
}
```

### 2. Payload guard (untrusted input, atomic reject)

Extend the existing `allocations.some(...)` predicate in `saveTask` with:

```ts
(cell.startMinutes !== undefined &&
  (!Number.isInteger(cell.startMinutes) ||
    cell.startMinutes < 0 ||
    cell.startMinutes >= DAY_MINUTES ||
    cell.startMinutes % MINUTE_STEP !== 0))
```

`DAY_MINUTES` and `MINUTE_STEP` are already exported from `src/utils/time.ts`;
import them if not already in the file's import list. Rejection returns `state`
(same reference), like every sibling guard.

### 3. Placement post-pass (the ONLY behavioral change)

While filling `cellByPair`, also collect
`wantStartByPair: Map<string, number>` for cells whose `startMinutes !== undefined`
(assigned people only, same filter as `cellByPair`).

Immediately AFTER the `for (const key of pairKeys)` loop closes and BEFORE the
`newUnassigned` bin block, run one pass over `workloadForTask`:

- Group the emitted entries by `dayKey(personId, date)`.
- For each pair key that has a wanted start AND exactly ONE emitted entry:
  `const start = clampBlockStart(want, hoursToMinutes(entry.plannedHours))`;
  if `start !== entry.startMinutes`, replace that entry in `workloadForTask`
  with `{ ...entry, startMinutes: start }` and `touched.add(key)`.
- Pairs with 0 or ≥2 emitted entries are left untouched (a multi-block day keeps
  its existing packing; the UI does not offer the input there).

This single insertion point covers all four branches uniformly — including the
new-pair branch, whose `findFreeStart ?? nextFreeStart` value simply gets
overwritten. Do NOT edit the four branches individually.

`clampBlockStart` and `hoursToMinutes` come from `src/utils/time.ts` (already
imported by AppStore).

### 4. Grid UI (`src/components/AllocationGrid.tsx`)

```ts
/** allocKey -> pinned start (minutes from midnight). Absent = auto placement. */
export type AllocStartMap = Record<string, number>;
```

New props: `startTimes: AllocStartMap`, `onChangeStart: (personId: string, date: string, minutes: number | null) => void`.

Inside the cell `<td>`, BELOW the hours input, render a second control only when
`value > 0 && (blockCounts?.[key] ?? 0) < 2 && !readOnly`:

```tsx
<input
  type="time"
  step={900}
  className="alloc-time-input"
  value={minutes === undefined ? '' : hhmm(minutes)}
  aria-label={`Godzina startu — ${p.name}, ${formatRowLabel(d)}`}
  title="Opcjonalna godzina startu. Puste = pierwsze wolne okno."
  onChange={(e) => onChangeStart(p.id, d, e.target.value === '' ? null : toMinutes(e.target.value))}
/>
```

`hhmm` / `toMinutes` are local module helpers in `AllocationGrid.tsx` (same
2-line shape as `recurMinutesToTime` / `recurTimeToMinutes` in TaskModal.tsx
~line 67–75). Do not add them to `src/utils/time.ts` and do not refactor the
existing duplicates — out of scope.

When `readOnly` or the cell has ≥2 blocks, render nothing extra (the existing
`×N` badge and its tooltip already explain multi-block days).

The component stays `memo`-wrapped; `startTimes` and `onChangeStart` must be
stable (`useMemo`/`useCallback`) on the TaskModal side, like the existing props.

### 5. Editor wiring (`src/components/TaskModal.tsx`)

- `const [startTimes, setStartTimes] = useState<AllocStartMap>(...)` — seed from
  existing dated entries of `existing`, but ONLY for pairs that have exactly one
  block (group first, then take `blocks[0].startMinutes`). Multi-block pairs get
  no seed.
- `setCellStart = useCallback((personId, date, minutes) => ...)`: `null` deletes
  the key; a number is normalized with
  `Math.max(0, Math.min(snapToStep(minutes), DAY_MINUTES - MINUTE_STEP))`
  (`snapToStep` from `src/utils/time.ts`). Never store NaN.
- `setCell` (hours): when the new snapped value is `0`, ALSO delete the pair's
  start key, so a cleared cell does not resurrect a stale hour later. Same in
  `clearPerson` and in the unassign branch of `toggleAssignee`.
- `serializeDraft`: add a `startTimes` field to both the parameter object and
  the serialized payload — `Object.entries(v.startTimes).sort(...)` filtered to
  keys whose allocation hours are `> 0`. Without this, changing only the hour
  would not mark the editor dirty.
- `plannedCells`: `cells.push({ personId, date, plannedHours: hours, ...(startTimes[key] !== undefined ? { startMinutes: startTimes[key] } : {}) })`.
  The spread MUST be conditional — an explicit `startMinutes: undefined` key
  would change the serialized payload shape for no reason.
- Pass `startTimes` / `onChangeStart={setCellStart}` to `<AllocationGrid>`.
- Under the „Dzienny przydział godzin” heading (~line 1326), add one hint:
  `Godzina startu jest opcjonalna — puste pole planuje blok w pierwszym wolnym oknie dnia.`
  as a `<p className="field-hint">`.

No `taskSaveBlockers` change: an empty or unparsable time field means "auto", so
the hour can never block saving.

### 6. CSS (`src/styles.css`)

One additive block near `.alloc-input` (~1335): `.alloc-time-input` — full-cell
width, smaller font than the hours input, muted border, `margin-top: 2px`.
Do not modify any existing rule.

### 7. Tests (`src/store/saveTaskWorkload.test.ts`, extend)

New describe `AllocationCell.startMinutes`:

- new pair + `startMinutes: 600` → the created block has `startMinutes === 600`
  (and NOT the `findFreeStart` value for a day where 600 is occupied — assert
  the pinned value wins over the free-slot search);
- new pair with NO `startMinutes` → unchanged existing behavior (keep/extend the
  existing `findFreeStart` assertions at ~line 433–481 green, untouched);
- unchanged hours + changed `startMinutes` on a single-block pair → that block
  keeps its `id`, gets the new start, and the workload array is a NEW reference;
- unchanged hours + unchanged `startMinutes` → block is byte-identical (`toBe`
  on the entry reference) — the byte-identity short circuit must survive;
- grow and trim on a single-block pair with a pinned start → surviving block ends
  at the pinned start, clamped so `start + duration <= 1440` (pin 23:00 with 4h);
- pair with TWO existing blocks + a pinned start → both blocks keep their
  original `startMinutes` (post-pass skips multi-block pairs);
- reject: `startMinutes: 607` (off-grid), `-15`, `1440`, `12.5` → reducer returns
  the SAME state reference (`toBe(state)`), one case each.

Regression suites that must stay green: `src/store/saveTaskWorkload.test.ts`,
`src/store/blockActions.test.ts`, `src/utils/time.test.ts`,
`src/components/taskSaveBlockers.test.ts`.

## Out of scope

- Changing `findFreeStart` / `nextFreeStart` / `packDayBlocks` themselves.
- Any collision REJECTION on save (invariant 3 — overlaps stay allowed here).
- Multi-block days: no per-block editing in the grid.
- The bin (zasobnik) section, `binTotals`, `newUnassigned`, draft hours.
- Calendar drag/resize, WeekView scheduling popover, recurrence editor.
- Migrations, DATA_VERSION (stays 7 — `WorkloadEntry.startMinutes` already exists).
- Moving the local `HH:MM` helpers into `src/utils/time.ts`.

## Acceptance

- [ ] A cell with hours and an empty time field produces exactly today's
      placement (unit-proven byte-identity for the no-`startMinutes` payload).
- [ ] A pinned hour on a fresh cell creates the block at that minute, even when
      the slot is already occupied by another task.
- [ ] Changing only the hour of an existing single-block day moves that block,
      preserves its `id`, and marks the editor dirty (save button enabled).
- [ ] A day backed by ≥2 blocks shows no time input and is never repositioned.
- [ ] Off-grid / out-of-range `startMinutes` returns the same state reference.
- [ ] Time input is hidden in `readOnly` mode.
- [ ] All new strings Polish; no new dependency.

## Verification

- Worker: `npx vitest run src/store/saveTaskWorkload.test.ts src/store/blockActions.test.ts src/utils/time.test.ts src/components/taskSaveBlockers.test.ts`
- Browser: none — no pointer/drag lifecycle, rendered-column targeting or
  calendar interaction changes; the new control is a native `<input type="time">`.
- Scheduler owns final `npm run test:scheduler && npm test && npm run build`.

## Prior decisions

- "Time range" = pinned START only. The DURATION is already the cell's hours
  value (0.25h grid); no second duration control is added.
- The pin applies only when the (person, day) pair resolves to exactly ONE
  block. Multi-block days keep their current packing — the grid already warns
  that editing their total reshapes several blocks.
- Implemented as ONE post-pass instead of four per-branch edits, so the
  reconciliation branches stay diff-clean and byte-identity is provable.
- Out-of-day pins are clamped by `clampBlockStart` (never rejected), matching
  every other write path.
- The reducer rejects off-grid values (defense in depth); the editor snaps
  before dispatch so a user can never hit that path.
- Wiki: if the SAVE_TASK section of `state-and-persistence.md` enumerates
  `AllocationCell` fields or states that editor cells never carry a time, it
  becomes stale — the final reviewer/orchestrator owns that decision.
