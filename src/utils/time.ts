// Pure time-of-day math for timed work blocks. Minutes-from-local-midnight.
// No React / date-fns / store imports — must stay unit-testable and side-effect free.

/** Grid step for block start times, in minutes. */
export const MINUTE_STEP = 15;
/** Grid step for planned hours (15 min). */
export const HOURS_STEP = 0.25;
/** Default first slot of the workday: 08:00. */
export const WORKDAY_START_MIN = 480;
/** Minutes in a day. */
export const DAY_MINUTES = 1440;

/**
 * Sentinel `WorkloadEntry.date` for an unassigned block sitting in a person's
 * "bin" (zasobnik): no calendar day. Bin entries always have startMinutes: 0
 * and a contiguous sortIndex per (personId, '') group.
 */
export const BIN_DATE = '';

/** True when an entry lives in the bin (unassigned / no calendar day). */
export function isBinEntry(e: { date: string }): boolean {
  return e.date === BIN_DATE;
}

export function hoursToMinutes(h: number): number {
  return h * 60;
}

export function minutesToHours(m: number): number {
  return m / 60;
}

/** Round a minute value to the nearest 15-minute grid step. */
export function snapToStep(minutes: number): number {
  return Math.round(minutes / MINUTE_STEP) * MINUTE_STEP;
}

/** Round planned hours to the nearest 0.25 grid step (write-path normalization). */
export function snapHours(hours: number): number {
  return Math.round(hours / HOURS_STEP) * HOURS_STEP;
}

/** Fit a block of `durationMin` into the 0–1440 day, clamping the start. */
export function clampBlockStart(start: number, durationMin: number): number {
  return Math.max(0, Math.min(start, DAY_MINUTES - durationMin));
}

/**
 * Snapped 15-minute start-of-day (minutes) for a vertical pixel offset inside a
 * timed calendar column. `pxPerHour` is the column geometry (HOUR_PX). Clamps to
 * a valid on-grid start within the day ([0, DAY_MINUTES - MINUTE_STEP]); a
 * non-finite or non-positive geometry falls back to 0. Used by the empty-slot
 * right-click "Dodaj zadanie" affordance.
 */
export function slotStartFromOffset(offsetPx: number, pxPerHour: number): number {
  if (!Number.isFinite(offsetPx) || !Number.isFinite(pxPerHour) || pxPerHour <= 0) return 0;
  const raw = snapToStep((offsetPx / pxPerHour) * 60);
  return Math.max(0, Math.min(raw, DAY_MINUTES - MINUTE_STEP));
}

/**
 * Snapped, clamped startMinutes for a dragged card whose TOP edge sits at
 * `anchorOffsetPx` inside a timed column. Magnetic: rounds to the nearest
 * 15-minute slot, then clamps so `durationMin` fits in the day. Non-finite or
 * non-positive geometry falls back to 0. Unlike `slotStartFromOffset` (a bare
 * cursor→slot mapping), this anchors on the card top and reserves room for the
 * whole block so what the drop-preview shows is exactly where the drop lands.
 */
export function dropStartFromAnchor(
  anchorOffsetPx: number,
  pxPerHour: number,
  durationMin: number,
): number {
  if (
    !Number.isFinite(anchorOffsetPx) ||
    !Number.isFinite(pxPerHour) ||
    !Number.isFinite(durationMin) ||
    pxPerHour <= 0
  ) {
    return 0;
  }
  return clampBlockStart(snapToStep((anchorOffsetPx / pxPerHour) * 60), durationMin);
}

/** Format minutes-from-midnight as '8:00' / '13:45'. */
export function formatMinutes(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${h}:${String(min).padStart(2, '0')}`;
}

/**
 * Human-readable DURATION from a decimal-hours quantity (>= 0):
 * '8h', '2h 45m', '45m', '0h'. Rounds to whole minutes. Not for clock
 * time-of-day (use formatMinutes) — this is a length, not a moment.
 */
export function formatDuration(hours: number): string {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (m === 0) return `${h}h`;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

/** End minute of a block starting at `startMinutes` lasting `plannedHours`. */
export function blockEndMinutes(startMinutes: number, plannedHours: number): number {
  return startMinutes + hoursToMinutes(plannedHours);
}

/** Strict overlap test — touching edges (aEnd === bStart) do NOT overlap. */
export function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** True if [start, start+durationMin) overlaps any block except `excludeId`. */
export function hasCollision(
  blocks: Array<{ id: string; startMinutes: number; plannedHours: number }>,
  start: number,
  durationMin: number,
  excludeId?: string,
): boolean {
  const end = start + durationMin;
  return blocks.some((b) => {
    if (excludeId !== undefined && b.id === excludeId) return false;
    return rangesOverlap(start, end, b.startMinutes, blockEndMinutes(b.startMinutes, b.plannedHours));
  });
}

/**
 * Migration stacking rule: place blocks sequentially from WORKDAY_START_MIN,
 * each starting where the previous ended, clamping so no block ends past 24:00.
 * Returns one start minute per input block, in the given order.
 */
export function stackStartTimes(blocksInOrder: Array<{ plannedHours: number }>): number[] {
  let cursor = WORKDAY_START_MIN;
  return blocksInOrder.map((b) => {
    const dur = hoursToMinutes(b.plannedHours);
    const start = clampBlockStart(cursor, dur);
    cursor = start + dur;
    return start;
  });
}

/**
 * Append-to-end rule for a new block: start at the max end across existing
 * blocks (snapped UP to the grid), or WORKDAY_START_MIN for an empty day,
 * clamped so the new block ends by 24:00.
 *
 * NOTE: this CLAMPS back over occupied time when the day can't fit an append,
 * which hides a same-person overlap. For collision-safe automatic placement
 * (reducer write paths) use `findFreeStart`, which returns an earlier real gap
 * or `null` instead of clamping. `nextFreeStart` remains for seed/migration and
 * as a never-reject fallback where overlaps are allowed to render side-by-side.
 */
export function nextFreeStart(
  blocks: Array<{ startMinutes: number; plannedHours: number }>,
  durationMin: number,
): number {
  let start = WORKDAY_START_MIN;
  if (blocks.length > 0) {
    const maxEnd = blocks.reduce(
      (m, b) => Math.max(m, blockEndMinutes(b.startMinutes, b.plannedHours)),
      0,
    );
    start = Math.ceil(maxEnd / MINUTE_STEP) * MINUTE_STEP;
  }
  return clampBlockStart(start, durationMin);
}

/**
 * Collision-safe automatic placement for a new block of `durationMin` in a
 * person's day. Prefers appending after the last block (identical to
 * `nextFreeStart` whenever that would not clamp), otherwise scans for the
 * earliest real free gap. Never clamps into occupied time.
 *
 * - Empty day → `clampBlockStart(WORKDAY_START_MIN, durationMin)` (== nextFreeStart).
 * - Append preferred: max end snapped UP to the grid; used when it still fits.
 * - Else earliest-fit gap: candidate starts are 0, WORKDAY_START_MIN and each
 *   block's snapped-up end; working-hours candidates (>= WORKDAY_START_MIN) are
 *   tried ascending first, then night candidates (< WORKDAY_START_MIN) ascending.
 * - No candidate fits → `null`.
 */
export function findFreeStart(
  blocks: Array<{ startMinutes: number; plannedHours: number }>,
  durationMin: number,
  /** Same-task blocks whose edges the result should avoid touching, when a
   *  non-touching collision-free slot is available (prevents an unintended
   *  auto-merge; a deliberate on-edge drag still merges). */
  avoidTouch?: Array<{ startMinutes: number; plannedHours: number }>,
): number | null {
  if (
    !Number.isFinite(durationMin) ||
    durationMin <= 0 ||
    durationMin > DAY_MINUTES ||
    !Number.isInteger(durationMin) ||
    durationMin % MINUTE_STEP !== 0
  ) {
    return null;
  }

  // True when candidate `c` sits exactly on an avoidTouch block's edge (its end,
  // or `c`'s end abutting that block's start) — the case that would auto-merge.
  const touchesAvoid = (c: number): boolean => {
    if (!avoidTouch) return false;
    return avoidTouch.some(
      (t) =>
        c === blockEndMinutes(t.startMinutes, t.plannedHours) ||
        c + durationMin === t.startMinutes,
    );
  };

  // Earliest in-day, collision-free candidate from the standard set
  // ({0, WORKDAY_START_MIN} ∪ each block's snapped-up end), working-hours first
  // then night, ascending. `requireNoTouch` also rejects avoidTouch edges.
  const scanGap = (requireNoTouch: boolean): number | null => {
    const candidateSet = new Set<number>([0, WORKDAY_START_MIN]);
    for (const b of blocks) {
      const end = blockEndMinutes(b.startMinutes, b.plannedHours);
      candidateSet.add(Math.ceil(end / MINUTE_STEP) * MINUTE_STEP);
    }
    const candidates = [...candidateSet];
    const working = candidates.filter((c) => c >= WORKDAY_START_MIN).sort((a, b) => a - b);
    const night = candidates.filter((c) => c < WORKDAY_START_MIN).sort((a, b) => a - b);
    for (const candidate of [...working, ...night]) {
      if (candidate + durationMin > DAY_MINUTES) continue;
      const end = candidate + durationMin;
      const collides = blocks.some((b) =>
        rangesOverlap(candidate, end, b.startMinutes, blockEndMinutes(b.startMinutes, b.plannedHours)),
      );
      if (collides) continue;
      if (requireNoTouch && touchesAvoid(candidate)) continue;
      return candidate;
    }
    return null;
  };

  // Current answer, unchanged: append-preferred, else earliest-fit gap.
  let primary: number | null;
  if (blocks.length === 0) {
    primary = clampBlockStart(WORKDAY_START_MIN, durationMin);
  } else {
    // Prefer appending after the last block (identical to nextFreeStart's answer
    // whenever no clamp would be needed — preserves every current placement).
    const maxEnd = blocks.reduce(
      (m, b) => Math.max(m, blockEndMinutes(b.startMinutes, b.plannedHours)),
      0,
    );
    const snapped = Math.ceil(maxEnd / MINUTE_STEP) * MINUTE_STEP;
    primary = snapped + durationMin <= DAY_MINUTES ? snapped : scanGap(false);
  }

  // Backward compatible: no avoidTouch (or nothing found) ⇒ byte-identical result.
  if (primary === null || !avoidTouch || avoidTouch.length === 0) return primary;
  if (!touchesAvoid(primary)) return primary;

  // primary would touch a same-task edge → prefer a non-touching gap if one exists.
  const nonTouching = scanGap(true);
  return nonTouching !== null ? nonTouching : primary;
}

/**
 * Plan a ripple insert of a virtual block at `insertStart` for `durationMin`
 * into a person's already-scheduled day, WITHOUT clamping. Reproduces the
 * calendar right-click sweep: blocks are ordered by ascending startMinutes with
 * the inserted block sorting BEFORE existing blocks that share its start and
 * existing ties broken by sortIndex; each later block whose start falls before
 * the running cursor is pushed forward to the cursor.
 *
 * Returns a `Map<entryId, newStartMinutes>` of only the blocks that move, or
 * `null` when the inserted block or ANY pushed block would end past 24:00
 * (the whole insert is impossible and the caller must reject atomically).
 */
export function planRippleInsert(
  dayBlocks: Array<{ id: string; startMinutes: number; plannedHours: number; sortIndex: number }>,
  insertStart: number,
  durationMin: number,
): Map<string, number> | null {
  if (insertStart + durationMin > DAY_MINUTES) return null;

  const ordered = [
    ...dayBlocks.map((b) => ({ ...b, inserted: false })),
    { id: '', startMinutes: insertStart, plannedHours: minutesToHours(durationMin), sortIndex: 0, inserted: true },
  ].sort((a, b) => {
    if (a.startMinutes !== b.startMinutes) return a.startMinutes - b.startMinutes;
    if (a.inserted) return -1;
    if (b.inserted) return 1;
    return a.sortIndex - b.sortIndex;
  });

  const startIdx = ordered.findIndex((b) => b.inserted);
  const moves = new Map<string, number>();
  let cursor = insertStart + durationMin;
  for (let i = startIdx + 1; i < ordered.length; i++) {
    const b = ordered[i];
    const durB = hoursToMinutes(b.plannedHours);
    if (b.startMinutes < cursor) {
      const pushed = cursor; // un-clamped
      if (pushed + durB > DAY_MINUTES) return null;
      if (pushed !== b.startMinutes) moves.set(b.id, pushed);
      cursor = pushed + durB;
    } else {
      cursor = blockEndMinutes(b.startMinutes, b.plannedHours);
    }
  }
  return moves;
}

/**
 * Classic calendar column packing for side-by-side rendering of overlapping
 * blocks. Greedy column assignment within each overlap cluster; `cols` is the
 * width (max simultaneous overlap) of the cluster a block belongs to.
 */
export function packDayBlocks<T extends { startMinutes: number; plannedHours: number }>(
  blocks: T[],
): Array<{ block: T; col: number; cols: number }> {
  const sorted = [...blocks].sort(
    (a, b) =>
      a.startMinutes - b.startMinutes ||
      blockEndMinutes(a.startMinutes, a.plannedHours) -
        blockEndMinutes(b.startMinutes, b.plannedHours),
  );

  const result: Array<{ block: T; col: number; cols: number }> = [];
  let cluster: Array<{ block: T; col: number }> = [];
  let columnEnds: number[] = []; // end minute of the last block placed in each column
  let clusterMaxEnd = -Infinity;

  const flush = () => {
    const cols = columnEnds.length;
    for (const item of cluster) result.push({ block: item.block, col: item.col, cols });
    cluster = [];
    columnEnds = [];
    clusterMaxEnd = -Infinity;
  };

  for (const b of sorted) {
    const start = b.startMinutes;
    const end = blockEndMinutes(b.startMinutes, b.plannedHours);
    if (cluster.length > 0 && start >= clusterMaxEnd) flush();

    let col = columnEnds.findIndex((colEnd) => colEnd <= start);
    if (col === -1) {
      col = columnEnds.length;
      columnEnds.push(end);
    } else {
      columnEnds[col] = end;
    }
    cluster.push({ block: b, col });
    clusterMaxEnd = Math.max(clusterMaxEnd, end);
  }
  flush();
  return result;
}
