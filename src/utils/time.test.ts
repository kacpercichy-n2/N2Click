// Unit tests for pure time-of-day math (src/utils/time.ts).
import { describe, expect, it } from 'vitest';
import {
  blockEndMinutes,
  dropStartFromAnchor,
  findFreeStart,
  formatDuration,
  formatMinutes,
  hasCollision,
  nextFreeStart,
  packDayBlocks,
  planRippleInsert,
  rangesOverlap,
  slotStartFromOffset,
  snapToStep,
  stackStartTimes,
} from './time';

// HOUR_PX geometry used by WeekView (84px/hour → 21px per 15-minute step).
const HOUR_PX = 84;

describe('slotStartFromOffset', () => {
  it('maps a pixel offset to the snapped 15-minute start under the cursor', () => {
    expect(slotStartFromOffset(0, HOUR_PX)).toBe(0);
    expect(slotStartFromOffset(8 * HOUR_PX, HOUR_PX)).toBe(480); // 08:00
    // 08:07 → snaps to the nearest quarter (08:00) rounding rule (.5+ rounds up).
    expect(slotStartFromOffset(8 * HOUR_PX + 9, HOUR_PX)).toBe(480);
    expect(slotStartFromOffset(8 * HOUR_PX + 12, HOUR_PX)).toBe(495); // 08:15
  });

  it('clamps within the day to a valid on-grid start', () => {
    expect(slotStartFromOffset(-50, HOUR_PX)).toBe(0);
    expect(slotStartFromOffset(24 * HOUR_PX, HOUR_PX)).toBe(1425); // 23:45, last slot
    expect(slotStartFromOffset(999 * HOUR_PX, HOUR_PX)).toBe(1425);
  });

  it('falls back to 0 for a non-finite or non-positive geometry', () => {
    expect(slotStartFromOffset(100, 0)).toBe(0);
    expect(slotStartFromOffset(100, -84)).toBe(0);
    expect(slotStartFromOffset(Number.NaN, HOUR_PX)).toBe(0);
    expect(slotStartFromOffset(100, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('dropStartFromAnchor', () => {
  const dur = (hours: number) => hours * 60;

  it('maps an on-grid card-top anchor exactly', () => {
    expect(dropStartFromAnchor(0, HOUR_PX, dur(1))).toBe(0);
    expect(dropStartFromAnchor(8 * HOUR_PX, HOUR_PX, dur(1))).toBe(480); // 08:00
  });

  it('rounds magnetically to the NEAREST 15-minute slot (21px = one quarter)', () => {
    // Just below the midpoint stays on the current slot, just above jumps to the next.
    expect(dropStartFromAnchor(8 * HOUR_PX + 9, HOUR_PX, dur(1))).toBe(480); // 08:00
    expect(dropStartFromAnchor(8 * HOUR_PX + 12, HOUR_PX, dur(1))).toBe(495); // 08:15
  });

  it('anchors on the card top, so a grab offset is already folded into the anchor', () => {
    // Cursor sits 30px below the card top; the caller passes anchor = cursorY - grabY.
    // A cursor at 08:00+30px with a 30px grab yields an 08:00 anchor → 08:00 start.
    expect(dropStartFromAnchor(8 * HOUR_PX, HOUR_PX, dur(2))).toBe(480);
  });

  it('clamps at day end so the whole duration still fits', () => {
    // Anchor at/past 24:00 with a 2h block clamps to 22:00 (1440 - 120).
    expect(dropStartFromAnchor(24 * HOUR_PX, HOUR_PX, dur(2))).toBe(1320);
    expect(dropStartFromAnchor(999 * HOUR_PX, HOUR_PX, dur(2))).toBe(1320);
  });

  it('clamps a negative anchor to 0', () => {
    expect(dropStartFromAnchor(-50, HOUR_PX, dur(1))).toBe(0);
  });

  it('falls back to 0 for non-finite or non-positive geometry/duration', () => {
    expect(dropStartFromAnchor(100, 0, dur(1))).toBe(0);
    expect(dropStartFromAnchor(100, -HOUR_PX, dur(1))).toBe(0);
    expect(dropStartFromAnchor(Number.NaN, HOUR_PX, dur(1))).toBe(0);
    expect(dropStartFromAnchor(100, Number.POSITIVE_INFINITY, dur(1))).toBe(0);
    expect(dropStartFromAnchor(100, HOUR_PX, Number.NaN)).toBe(0);
  });

  it('returns an on-grid start even for an off-grid duration', () => {
    const start = dropStartFromAnchor(8 * HOUR_PX + 4, HOUR_PX, 100); // 100 min is off the 15-grid
    expect(start % 15).toBe(0);
    expect(start).toBe(480);
  });
});

describe('snapToStep', () => {
  it('rounds to the nearest 15-minute step', () => {
    expect(snapToStep(487)).toBe(480);
    expect(snapToStep(488)).toBe(495); // implemented rounding rule: .5+ rounds up
  });

  it('leaves the 0 and 1440 edges untouched', () => {
    expect(snapToStep(0)).toBe(0);
    expect(snapToStep(1440)).toBe(1440);
  });
});

describe('formatMinutes', () => {
  it('formats minutes-from-midnight as H:MM', () => {
    expect(formatMinutes(0)).toBe('0:00');
    expect(formatMinutes(480)).toBe('8:00');
    expect(formatMinutes(825)).toBe('13:45');
    expect(formatMinutes(1439)).toBe('23:59');
  });
});

describe('formatDuration', () => {
  it('formats a whole-hour duration as Xh (including 0h)', () => {
    expect(formatDuration(8)).toBe('8h');
    expect(formatDuration(0)).toBe('0h');
  });

  it('formats hours + minutes as "Xh Ym"', () => {
    expect(formatDuration(2.75)).toBe('2h 45m');
    expect(formatDuration(10.25)).toBe('10h 15m');
  });

  it('formats a sub-hour duration as Ym', () => {
    expect(formatDuration(0.25)).toBe('15m');
    expect(formatDuration(0.5)).toBe('30m');
  });

  it('rounds to whole minutes', () => {
    expect(formatDuration(1 / 60)).toBe('1m'); // ~0.0167h -> 1m
  });
});

describe('rangesOverlap', () => {
  it('detects a true overlap', () => {
    expect(rangesOverlap(0, 60, 30, 90)).toBe(true);
  });

  it('treats disjoint ranges as non-overlapping', () => {
    expect(rangesOverlap(0, 60, 120, 180)).toBe(false);
  });

  it('treats touching edges as NOT a collision', () => {
    expect(rangesOverlap(0, 60, 60, 120)).toBe(false);
  });
});

describe('hasCollision', () => {
  const blocks = [
    { id: 'a', startMinutes: 480, plannedHours: 2 }, // 480-600
  ];

  it('flags an overlapping candidate', () => {
    expect(hasCollision(blocks, 500, 60)).toBe(true); // 500-560 inside 480-600
  });

  it('does not flag a disjoint candidate', () => {
    expect(hasCollision(blocks, 700, 60)).toBe(false);
  });

  it('does not flag a candidate that only touches an edge', () => {
    expect(hasCollision(blocks, 600, 60)).toBe(false); // starts exactly where 'a' ends
  });

  it('excludeId skips the block itself', () => {
    // Candidate is exactly block 'a's own range — would collide with itself
    // unless excluded.
    expect(hasCollision(blocks, 480, 120, 'a')).toBe(false);
  });
});

describe('findFreeStart input guards', () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, -15, 0, 1441, 30.5])(
    'returns null for invalid duration %s',
    (durationMin) => {
      expect(findFreeStart([], durationMin)).toBeNull();
    },
  );

  it('still returns the normal workday start for a valid full-day-grid duration', () => {
    expect(findFreeStart([], 60)).toBe(480);
  });
});

describe('stackStartTimes', () => {
  it('stacks sequential blocks from the workday start', () => {
    expect(stackStartTimes([{ plannedHours: 6 }, { plannedHours: 4 }])).toEqual([480, 840]);
  });

  it('clamps a block start when the stack would pass 24:00', () => {
    // First block: 10h from 480 -> ends at 1080.
    // Second block: 20h (1200min) would end at 2280, so its start is clamped
    // to DAY_MINUTES - durationMin = 1440 - 1200 = 240 (implemented rule).
    expect(stackStartTimes([{ plannedHours: 10 }, { plannedHours: 20 }])).toEqual([480, 240]);
  });
});

describe('nextFreeStart', () => {
  it('returns the workday start for an empty day', () => {
    expect(nextFreeStart([], 60)).toBe(480);
  });

  it('returns the max end (snapped up) after existing blocks', () => {
    // Existing block 480-606 (2.1h); next free start snaps 606 up to 615.
    expect(nextFreeStart([{ startMinutes: 480, plannedHours: 2.1 }], 60)).toBe(615);
  });

  it('clamps so the new block still ends by 24:00', () => {
    // Existing block ends at 1380 (on-grid); a 2h (120min) block starting
    // there would end at 1500, so the start is clamped to 1440 - 120 = 1320.
    // NOTE (PKG-20260713b-placement): this raw helper deliberately keeps its
    // clamp-into-occupied-time semantics (a hidden same-person overlap is
    // possible here) — collision-safe automatic placement lives in
    // `findFreeStart`, covered in its own describe below.
    expect(nextFreeStart([{ startMinutes: 1200, plannedHours: 3 }], 120)).toBe(1320);
  });
});

describe('findFreeStart', () => {
  it('returns WORKDAY_START_MIN for an empty day and rejects a duration longer than one day', () => {
    expect(findFreeStart([], 60)).toBe(480);
    expect(findFreeStart([], 2000)).toBeNull();
  });

  it('prefers appending after the last block, matching nextFreeStart, when no clamp is needed', () => {
    const blocks = [{ startMinutes: 480, plannedHours: 2 }]; // 480-600
    expect(findFreeStart(blocks, 60)).toBe(nextFreeStart(blocks, 60));
    expect(findFreeStart(blocks, 60)).toBe(600);
  });

  it('when append would clamp, scans for the earliest real gap instead of the clamped tail', () => {
    const blocks = [
      { startMinutes: 480, plannedHours: 2 }, // 480-600
      { startMinutes: 1350, plannedHours: 1.25 }, // 1350-1425, forces the append to clamp
    ];
    const start = findFreeStart(blocks, 60);
    expect(start).toBe(600); // the 600-1350 gap, not a clamped placement near the end
    expect(hasCollision(blocks.map((b, i) => ({ id: String(i), ...b })), start!, 60)).toBe(false);
  });

  it('falls back to a pre-08:00 gap when the whole working day is solid', () => {
    const blocks = [{ startMinutes: 480, plannedHours: 16 }]; // 08:00-24:00, solid
    expect(findFreeStart(blocks, 120)).toBe(0); // only the 00:00-08:00 gap is free
  });

  it('returns null when the day truly cannot fit the duration anywhere', () => {
    const blocks = [
      { startMinutes: 0, plannedHours: 12 },
      { startMinutes: 720, plannedHours: 12 },
    ]; // fully solid 0-1440
    expect(findFreeStart(blocks, 15)).toBeNull();
  });

  it('snaps an off-grid block end UP to the 15-minute grid before treating it as a gap candidate, and never returns a colliding start', () => {
    const blocks = [
      { startMinutes: 480, plannedHours: 2.1 }, // 480-606, off-grid end
      { startMinutes: 1400, plannedHours: 0.5 }, // 1400-1430, forces the append to clamp
    ];
    const start = findFreeStart(blocks, 60);
    expect(start).toBe(615); // 606 snapped UP to 615 (not 600 or 605)
    expect(hasCollision(blocks.map((b, i) => ({ id: String(i), ...b })), start!, 60)).toBe(false);
  });

  it('avoidTouch: when the append default would touch a same-task block edge, returns a valid non-touching collision-free start instead (2-arg call still appends)', () => {
    const sameTask = { startMinutes: 480, plannedHours: 2 }; // 480-600
    const blocks = [sameTask];
    // Plain 2-arg call still appends exactly at the block's end (touching) —
    // backward compatible, seed/SAVE_TASK/existing placements are unaffected.
    expect(findFreeStart(blocks, 60)).toBe(600);
    // With avoidTouch = that block, the default (600, touching 600) is rejected
    // in favor of the earliest non-touching WORKING-hours gap: one grid step past
    // the touched end (600 → 615), preferred over the 00:00 night gap. This is the
    // fix for the old "Zaplanuj część proposes 00:00" defect.
    const guarded = findFreeStart(blocks, 60, [sameTask]);
    expect(guarded).toBe(615); // 10:15, one 15-min step past the same-task end
    // The result is collision-free and does not touch the same-task block's edges.
    expect(hasCollision(blocks.map((b, i) => ({ id: String(i), ...b })), guarded!, 60)).toBe(false);
    expect(guarded! + 60).not.toBe(sameTask.startMinutes); // does not abut its start
    expect(guarded).not.toBe(blockEndMinutes(sameTask.startMinutes, sameTask.plannedHours)); // not its end
  });

  it('avoidTouch: lone 09:00–11:00 block proposes 11:15, not 00:00 (past-end grid-step candidate)', () => {
    const sameTask = { startMinutes: 540, plannedHours: 2 }; // 540-660 (09:00-11:00)
    const blocks = [sameTask];
    // Append default is 660 (11:00) — touches the same-task end. The guard now
    // offers 660 + MINUTE_STEP = 675 (11:15), a working-hours non-touching slot,
    // instead of falling all the way back to the 00:00 night gap (old defect).
    const guarded = findFreeStart(blocks, 60, [sameTask]);
    expect(guarded).toBe(675); // 11:15
    expect(hasCollision(blocks.map((b, i) => ({ id: String(i), ...b })), guarded!, 60)).toBe(false);
  });

  it('avoidTouch: rejects an earliest candidate that would touch the same-task block FROM BELOW and escapes to a non-touching slot', () => {
    const sameTask = { startMinutes: 540, plannedHours: 1 }; // 540-600 (09:00-10:00)
    const blocks = [sameTask];
    // Standard candidate 480 (08:00) fits before the block but 480+60 = 540 abuts
    // its START (touch-from-below → auto-merge), so it is rejected; the append
    // candidate 600 touches its end. The guard escapes to 600 + MINUTE_STEP = 615.
    const guarded = findFreeStart(blocks, 60, [sameTask]);
    expect(guarded).toBe(615); // 10:15
    expect(guarded! + 60).not.toBe(sameTask.startMinutes); // never abuts its start
    expect(guarded).not.toBe(blockEndMinutes(sameTask.startMinutes, sameTask.plannedHours)); // nor its end
    expect(hasCollision(blocks.map((b, i) => ({ id: String(i), ...b })), guarded!, 60)).toBe(false);
  });

  it('avoidTouch: when NO non-touching slot exists, keeps the touching primary (merge unavoidable is acceptable)', () => {
    // Whole day solid except the single append slot that touches the same-task block.
    const sameTask = { startMinutes: 0, plannedHours: 8 }; // 00:00-08:00 (ends at WORKDAY_START_MIN)
    const filler = { startMinutes: 540, plannedHours: 15 }; // 09:00-24:00 solid
    const blocks = [sameTask, filler];
    // Only the 480-540 gap fits a 60-min block, and 480 touches sameTask's end.
    const guarded = findFreeStart(blocks, 60, [sameTask]);
    expect(guarded).toBe(480); // no non-touching alternative → keep the touching primary
  });
});

describe('planRippleInsert', () => {
  it('inserting into a gap produces no moves — a block further away stays put', () => {
    const dayBlocks = [
      { id: 'a', startMinutes: 480, plannedHours: 2, sortIndex: 0 }, // 480-600
      { id: 'far', startMinutes: 900, plannedHours: 1, sortIndex: 1 }, // 900-960
    ];
    const moves = planRippleInsert(dayBlocks, 600, 60); // insert 600-660, gap absorbs it
    expect(moves).toEqual(new Map());
  });

  it('pushes an overlapping chain forward by exactly the insert duration, un-clamped', () => {
    const dayBlocks = [
      { id: 'a', startMinutes: 600, plannedHours: 1, sortIndex: 0 }, // 600-660
      { id: 'b', startMinutes: 660, plannedHours: 1, sortIndex: 1 }, // 660-720, touches a
    ];
    const moves = planRippleInsert(dayBlocks, 600, 30); // insert 600-630 at a's own start
    expect(moves?.get('a')).toBe(630); // pushed to the inserted block's end
    expect(moves?.get('b')).toBe(690); // pushed by the same 30 minutes, chained
  });

  it("an equal-start tie sorts the inserted block first, pushing the existing block that shared the start", () => {
    const dayBlocks = [{ id: 'a', startMinutes: 480, plannedHours: 2, sortIndex: 0 }]; // 480-600
    const moves = planRippleInsert(dayBlocks, 480, 30); // insert at a's exact start
    expect(moves?.get('a')).toBe(510); // pushed past the inserted 480-510 block
  });

  it('returns null when the inserted block itself, or any pushed block in the chain, would cross 24:00', () => {
    const soloTooLate = [{ id: 'a', startMinutes: 1410, plannedHours: 0.5, sortIndex: 0 }];
    expect(planRippleInsert(soloTooLate, 1410, 60)).toBeNull(); // insert itself: 1410+60 > 1440

    const chain = [{ id: 'a', startMinutes: 1380, plannedHours: 0.5, sortIndex: 0 }]; // 1380-1410
    // insert 1380-1440 pushes 'a' to 1440, where it can no longer fit.
    expect(planRippleInsert(chain, 1380, 60)).toBeNull();
  });

  it('a day that fits EXACTLY to 24:00 (touching, no overflow) succeeds', () => {
    const dayBlocks = [{ id: 'a', startMinutes: 1380, plannedHours: 0.5, sortIndex: 0 }]; // 1380-1410
    const moves = planRippleInsert(dayBlocks, 1410, 30); // insert 1410-1440, exact fit
    expect(moves).toEqual(new Map()); // nothing to push — 'a' stays entirely before the insert
  });
});

describe('packDayBlocks', () => {
  it('returns an empty array for empty input', () => {
    expect(packDayBlocks([])).toEqual([]);
  });

  it('gives every block cols === 1 when nothing overlaps', () => {
    const blocks = [
      { id: 'a', startMinutes: 0, plannedHours: 1 },
      { id: 'b', startMinutes: 120, plannedHours: 1 },
    ];
    const packed = packDayBlocks(blocks);
    expect(packed).toHaveLength(2);
    expect(packed.every((p) => p.cols === 1)).toBe(true);
  });

  it('assigns two overlapping blocks cols === 2 with distinct col indices', () => {
    const blocks = [
      { id: 'a', startMinutes: 0, plannedHours: 2 }, // 0-120
      { id: 'b', startMinutes: 60, plannedHours: 2 }, // 60-180, overlaps a
    ];
    const packed = packDayBlocks(blocks);
    expect(packed.every((p) => p.cols === 2)).toBe(true);
    const cols = packed.map((p) => p.col).sort();
    expect(cols).toEqual([0, 1]);
  });

  it('gives a transitive chain (A-B, B-C, A not-C) the same cluster width', () => {
    const a = { id: 'a', startMinutes: 0, plannedHours: 1 }; // 0-60
    const b = { id: 'b', startMinutes: 30, plannedHours: 1 }; // 30-90, overlaps a
    const c = { id: 'c', startMinutes: 80, plannedHours: 1 }; // 80-140, overlaps b, not a
    const packed = packDayBlocks([a, b, c]);
    const byId = new Map(packed.map((p) => [p.block.id, p]));
    expect(byId.get('a')!.cols).toBe(byId.get('b')!.cols);
    expect(byId.get('b')!.cols).toBe(byId.get('c')!.cols);
  });
});
