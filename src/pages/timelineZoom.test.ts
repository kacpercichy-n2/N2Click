// Unit tests for the pure Timeline zoom module: per-level range computation,
// zoom stepping/clamping in both directions, and the per-level nav step.
// Pure — no React, no localStorage.
import { describe, expect, it } from 'vitest';
import { addDaysStr } from '../utils/dates';
import {
  DEFAULT_ZOOM_LEVEL,
  MONTH_DAY_W,
  TWO_WEEKS_DAY_W,
  WEEK_DAY_W,
  canZoomIn,
  canZoomOut,
  shiftAnchor,
  zoomIn,
  zoomOut,
  zoomView,
} from './timelineZoom';

/** Expand a ZoomView into its concrete day-strings. */
function daysOf(rangeStart: string, totalDays: number): string[] {
  return Array.from({ length: totalDays }, (_, i) => addDaysStr(rangeStart, i));
}

describe('zoomView — week', () => {
  it('renders Mon–Fri (5 days) of a mid-week anchor', () => {
    // 2026-07-22 is a Wednesday; its Monday is 2026-07-20.
    const v = zoomView('week', '2026-07-22');
    expect(v.rangeStart).toBe('2026-07-20');
    expect(v.totalDays).toBe(5);
    expect(v.dayW).toBe(WEEK_DAY_W);
    expect(daysOf(v.rangeStart, v.totalDays)).toEqual([
      '2026-07-20', // Mon
      '2026-07-21', // Tue
      '2026-07-22', // Wed
      '2026-07-23', // Thu
      '2026-07-24', // Fri
    ]);
  });

  it('anchors to the same Monday when the anchor is Sunday', () => {
    // 2026-07-26 is a Sunday; its week Monday is still 2026-07-20.
    const v = zoomView('week', '2026-07-26');
    expect(v.rangeStart).toBe('2026-07-20');
    expect(v.totalDays).toBe(5);
  });
});

describe('zoomView — twoWeeks', () => {
  it('renders 14 days from the anchor Monday', () => {
    const v = zoomView('twoWeeks', '2026-07-22');
    expect(v.rangeStart).toBe('2026-07-20');
    expect(v.totalDays).toBe(14);
    expect(v.dayW).toBe(TWO_WEEKS_DAY_W);
    const days = daysOf(v.rangeStart, v.totalDays);
    expect(days[0]).toBe('2026-07-20');
    expect(days[13]).toBe('2026-08-02');
  });
});

describe('zoomView — month', () => {
  it('spans first→last day of a 31-day month', () => {
    const v = zoomView('month', '2026-07-22');
    expect(v.rangeStart).toBe('2026-07-01');
    expect(v.totalDays).toBe(31);
    expect(v.dayW).toBe(MONTH_DAY_W);
    const days = daysOf(v.rangeStart, v.totalDays);
    expect(days[days.length - 1]).toBe('2026-07-31');
  });

  it('spans a 30-day month', () => {
    const v = zoomView('month', '2026-06-15');
    expect(v.rangeStart).toBe('2026-06-01');
    expect(v.totalDays).toBe(30);
  });

  it('spans a 28-day February (non-leap year)', () => {
    const v = zoomView('month', '2026-02-10');
    expect(v.rangeStart).toBe('2026-02-01');
    expect(v.totalDays).toBe(28);
    const feb = daysOf(v.rangeStart, v.totalDays);
    expect(feb[feb.length - 1]).toBe('2026-02-28');
  });

  it('spans a 29-day February (leap year)', () => {
    const v = zoomView('month', '2024-02-10');
    expect(v.rangeStart).toBe('2024-02-01');
    expect(v.totalDays).toBe(29);
    const feb = daysOf(v.rangeStart, v.totalDays);
    expect(feb[feb.length - 1]).toBe('2024-02-29');
  });
});

describe('zoom stepping and clamping', () => {
  it('defaults to the most zoomed-in level', () => {
    expect(DEFAULT_ZOOM_LEVEL).toBe('week');
  });

  it('zooms out week → twoWeeks → month and clamps at month', () => {
    expect(zoomOut('week')).toBe('twoWeeks');
    expect(zoomOut('twoWeeks')).toBe('month');
    expect(zoomOut('month')).toBe('month'); // clamped
  });

  it('zooms in month → twoWeeks → week and clamps at week', () => {
    expect(zoomIn('month')).toBe('twoWeeks');
    expect(zoomIn('twoWeeks')).toBe('week');
    expect(zoomIn('week')).toBe('week'); // clamped
  });

  it('reports the zoom-in/zoom-out availability at each end', () => {
    expect(canZoomIn('week')).toBe(false);
    expect(canZoomOut('week')).toBe(true);
    expect(canZoomIn('month')).toBe(true);
    expect(canZoomOut('month')).toBe(false);
    expect(canZoomIn('twoWeeks')).toBe(true);
    expect(canZoomOut('twoWeeks')).toBe(true);
  });
});

describe('shiftAnchor — per-level nav step', () => {
  it('week steps by ±1 week', () => {
    expect(shiftAnchor('week', '2026-07-22', 1)).toBe('2026-07-29');
    expect(shiftAnchor('week', '2026-07-22', -1)).toBe('2026-07-15');
  });

  it('twoWeeks steps by ±2 weeks', () => {
    expect(shiftAnchor('twoWeeks', '2026-07-22', 1)).toBe('2026-08-05');
    expect(shiftAnchor('twoWeeks', '2026-07-22', -1)).toBe('2026-07-08');
  });

  it('month steps by ±1 month', () => {
    expect(shiftAnchor('month', '2026-07-22', 1)).toBe('2026-08-22');
    expect(shiftAnchor('month', '2026-07-22', -1)).toBe('2026-06-22');
  });
});
