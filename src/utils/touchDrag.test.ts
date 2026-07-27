// Unit tests for the long-press touch gate state machine (src/utils/touchDrag.ts).
import { describe, expect, it } from 'vitest';
import {
  IDLE_TOUCH_HOLD,
  TOUCH_HOLD_MS,
  TOUCH_HOLD_SLOP_PX,
  exceedsHoldSlop,
  needsTouchHold,
  touchHoldReducer,
  type TouchHoldState,
} from './touchDrag';

const pending = (x = 100, y = 200): TouchHoldState =>
  touchHoldReducer(IDLE_TOUCH_HOLD, { type: 'pointerdown', pointerType: 'touch', x, y });

const engaged = (x = 100, y = 200): TouchHoldState =>
  touchHoldReducer(pending(x, y), { type: 'holdElapsed' });

describe('constants', () => {
  it('keeps the hold under half a second and the slop within a fingertip', () => {
    expect(TOUCH_HOLD_MS).toBe(350);
    expect(TOUCH_HOLD_SLOP_PX).toBe(10);
  });
});

describe('needsTouchHold', () => {
  it('gates touch and pen', () => {
    expect(needsTouchHold('touch')).toBe(true);
    expect(needsTouchHold('pen')).toBe(true);
  });

  it('never gates a mouse or an unknown/absent pointer type', () => {
    expect(needsTouchHold('mouse')).toBe(false);
    expect(needsTouchHold(undefined)).toBe(false);
    expect(needsTouchHold('')).toBe(false);
    expect(needsTouchHold('Touch')).toBe(false); // pointerType is lowercase per spec
  });
});

describe('exceedsHoldSlop', () => {
  it('measures the euclidean drift, not a per-axis budget', () => {
    expect(exceedsHoldSlop(0, 0)).toBe(false);
    expect(exceedsHoldSlop(9, 0)).toBe(false);
    expect(exceedsHoldSlop(0, -9)).toBe(false);
    // 8²+8² = 128 → 11.3px, over the 10px threshold even though neither axis is.
    expect(exceedsHoldSlop(8, 8)).toBe(true);
    expect(exceedsHoldSlop(-11, 0)).toBe(true);
  });

  it('treats exactly the threshold as still inside the hold', () => {
    expect(exceedsHoldSlop(10, 0)).toBe(false);
    expect(exceedsHoldSlop(6, 8)).toBe(false); // hypot === 10
    expect(exceedsHoldSlop(10.01, 0)).toBe(true);
  });

  it('accepts a caller-supplied slop', () => {
    expect(exceedsHoldSlop(5, 0, 4)).toBe(true);
    expect(exceedsHoldSlop(5, 0, 20)).toBe(false);
  });
});

describe('touchHoldReducer — pointerdown', () => {
  it('arms a pending hold at the touch origin', () => {
    expect(pending(42, 84)).toEqual({ phase: 'pending', originX: 42, originY: 84 });
  });

  it('leaves the state reference untouched for a mouse (drag starts immediately)', () => {
    const next = touchHoldReducer(IDLE_TOUCH_HOLD, {
      type: 'pointerdown',
      pointerType: 'mouse',
      x: 10,
      y: 10,
    });
    expect(next).toBe(IDLE_TOUCH_HOLD);
  });

  it('re-arms at the new origin when a second touch starts', () => {
    const first = pending(10, 10);
    const second = touchHoldReducer(first, {
      type: 'pointerdown',
      pointerType: 'pen',
      x: 300,
      y: 400,
    });
    expect(second).toEqual({ phase: 'pending', originX: 300, originY: 400 });
  });
});

describe('touchHoldReducer — pointermove', () => {
  it('keeps the SAME state reference while the finger stays inside the slop', () => {
    const state = pending(100, 200);
    const next = touchHoldReducer(state, { type: 'pointermove', x: 104, y: 203 });
    expect(next).toBe(state);
  });

  it('aborts to idle when the finger drifts past the slop (that is a scroll)', () => {
    const state = pending(100, 200);
    const next = touchHoldReducer(state, { type: 'pointermove', x: 100, y: 230 });
    expect(next).toBe(IDLE_TOUCH_HOLD);
  });

  it('ignores moves in idle and in engaged (the drag layer owns them)', () => {
    expect(touchHoldReducer(IDLE_TOUCH_HOLD, { type: 'pointermove', x: 999, y: 999 })).toBe(
      IDLE_TOUCH_HOLD,
    );
    const live = engaged(100, 200);
    expect(touchHoldReducer(live, { type: 'pointermove', x: 999, y: 999 })).toBe(live);
  });
});

describe('touchHoldReducer — holdElapsed', () => {
  it('engages from pending and keeps the origin', () => {
    expect(engaged(42, 84)).toEqual({ phase: 'engaged', originX: 42, originY: 84 });
  });

  it('does NOT engage after an abort — a late timer must stay harmless', () => {
    const aborted = touchHoldReducer(pending(100, 200), { type: 'pointermove', x: 100, y: 260 });
    expect(aborted.phase).toBe('idle');
    expect(touchHoldReducer(aborted, { type: 'holdElapsed' })).toBe(aborted);
  });

  it('is idempotent once engaged', () => {
    const live = engaged();
    expect(touchHoldReducer(live, { type: 'holdElapsed' })).toBe(live);
  });
});

describe('touchHoldReducer — release', () => {
  it('resets a pending hold and an engaged drag', () => {
    expect(touchHoldReducer(pending(), { type: 'release' })).toBe(IDLE_TOUCH_HOLD);
    expect(touchHoldReducer(engaged(), { type: 'release' })).toBe(IDLE_TOUCH_HOLD);
  });

  it('is a no-op in idle (same reference)', () => {
    expect(touchHoldReducer(IDLE_TOUCH_HOLD, { type: 'release' })).toBe(IDLE_TOUCH_HOLD);
  });
});

describe('touchHoldReducer — full gestures', () => {
  it('scroll: touch down, finger travels, later timer never engages', () => {
    let s = touchHoldReducer(IDLE_TOUCH_HOLD, {
      type: 'pointerdown',
      pointerType: 'touch',
      x: 50,
      y: 50,
    });
    s = touchHoldReducer(s, { type: 'pointermove', x: 52, y: 55 }); // still inside slop
    expect(s.phase).toBe('pending');
    s = touchHoldReducer(s, { type: 'pointermove', x: 52, y: 120 }); // scroll
    s = touchHoldReducer(s, { type: 'holdElapsed' }); // stale timer
    s = touchHoldReducer(s, { type: 'release' });
    expect(s).toBe(IDLE_TOUCH_HOLD);
  });

  it('long press: touch down, stillness, engage, drag, release', () => {
    let s = touchHoldReducer(IDLE_TOUCH_HOLD, {
      type: 'pointerdown',
      pointerType: 'touch',
      x: 50,
      y: 50,
    });
    s = touchHoldReducer(s, { type: 'pointermove', x: 51, y: 51 });
    s = touchHoldReducer(s, { type: 'holdElapsed' });
    expect(s.phase).toBe('engaged');
    s = touchHoldReducer(s, { type: 'pointermove', x: 400, y: 400 }); // now the drag moves
    expect(s.phase).toBe('engaged');
    expect(touchHoldReducer(s, { type: 'release' })).toBe(IDLE_TOUCH_HOLD);
  });

  it('mouse: never leaves idle, so the drag layer runs unchanged', () => {
    let s = touchHoldReducer(IDLE_TOUCH_HOLD, {
      type: 'pointerdown',
      pointerType: 'mouse',
      x: 50,
      y: 50,
    });
    expect(s).toBe(IDLE_TOUCH_HOLD);
    s = touchHoldReducer(s, { type: 'pointermove', x: 400, y: 400 });
    s = touchHoldReducer(s, { type: 'holdElapsed' });
    expect(s).toBe(IDLE_TOUCH_HOLD);
  });
});
