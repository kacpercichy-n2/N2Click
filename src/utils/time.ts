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

/** Format minutes-from-midnight as '8:00' / '13:45'. */
export function formatMinutes(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${h}:${String(min).padStart(2, '0')}`;
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
