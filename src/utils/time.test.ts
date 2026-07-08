// Unit tests for pure time-of-day math (src/utils/time.ts).
import { describe, expect, it } from 'vitest';
import {
  formatMinutes,
  hasCollision,
  nextFreeStart,
  packDayBlocks,
  rangesOverlap,
  snapToStep,
  stackStartTimes,
} from './time';

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
    expect(nextFreeStart([{ startMinutes: 1200, plannedHours: 3 }], 120)).toBe(1320);
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
