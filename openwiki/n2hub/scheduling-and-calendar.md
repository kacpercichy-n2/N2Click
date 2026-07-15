# Scheduling and calendar

## Boundaries

- `src/components/WeekView.tsx` owns timed-grid interaction and bin-card UI.
- `src/utils/time.ts` owns pure time calculations, collision checks, packing,
  free-slot search and quarter-hour math.
- `src/store/AppStore.tsx` applies scheduling mutations atomically.
- `src/pages/WorkloadPage.tsx` owns workload reassignment UI.

## Non-negotiable behavior

- Time uses 15-minute steps; hours use 0.25-hour steps; a block must fit in one
  day. A task period is at most 92 days.
- Same-person collisions block calendar drag/resize and automatic placement.
  Intentional TaskModal allocation edits may overlap and render side-by-side.
- Bin work uses exactly one row per `(taskId, personId)`. `SCHEDULE_BIN_PART`
  keeps that row identity, decrements it atomically and removes it only at zero.
- Bin drag is window-owned: preserve its pointer-up/cancel/blur/Escape/visibility
  cleanup, synchronous refs and rendered-column hit-testing.
- Automatic placement uses a real free-slot search and rejects when no slot fits;
  it must not clamp into an overlap near midnight.
- Free-slot search rejects non-finite, non-positive, off-grid and over-day
  durations. Keyboard-activatable week blocks and bin cards respond to both
  Enter and Space without changing their pointer lifecycle.

## Start here for

Calendar blocks, bin recovery, collisions, ripple insertion, reassignment,
availability/overload calculations, drag lifecycle and time utilities.

## Relevant tests and checks

`src/utils/time.test.ts`, `src/store/blockActions.test.ts`,
`scripts/browser-check-bin-drag.mjs`, `browser-check-bin-split.mjs`, and
`browser-check-placement.mjs`.
