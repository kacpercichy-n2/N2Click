import { describe, expect, it } from 'vitest';
import { applyNavOrder, moveNavPath } from './navOrder';

const DEFAULTS = ['/dashboard', '/tasks', '/calendar', '/admin'];

describe('applyNavOrder', () => {
  it('falls back to the default order for non-array / garbage input', () => {
    expect(applyNavOrder(DEFAULTS, null)).toEqual(DEFAULTS);
    expect(applyNavOrder(DEFAULTS, undefined)).toEqual(DEFAULTS);
    expect(applyNavOrder(DEFAULTS, 'nope')).toEqual(DEFAULTS);
    expect(applyNavOrder(DEFAULTS, { 0: '/tasks' })).toEqual(DEFAULTS);
  });

  it('returns a fresh copy of the defaults (not the same reference)', () => {
    const result = applyNavOrder(DEFAULTS, null);
    expect(result).not.toBe(DEFAULTS);
  });

  it('drops entries that are not strings or not in the default set', () => {
    expect(applyNavOrder(DEFAULTS, ['/tasks', 42, '/unknown', null, '/admin'])).toEqual([
      '/tasks',
      '/admin',
      '/dashboard',
      '/calendar',
    ]);
  });

  it('deduplicates stored entries (first win)', () => {
    expect(applyNavOrder(DEFAULTS, ['/tasks', '/tasks', '/dashboard'])).toEqual([
      '/tasks',
      '/dashboard',
      '/calendar',
      '/admin',
    ]);
  });

  it('appends missing defaults in their default relative order', () => {
    expect(applyNavOrder(DEFAULTS, ['/admin'])).toEqual([
      '/admin',
      '/dashboard',
      '/tasks',
      '/calendar',
    ]);
  });

  it('honours a full valid permutation', () => {
    const stored = ['/admin', '/calendar', '/tasks', '/dashboard'];
    expect(applyNavOrder(DEFAULTS, stored)).toEqual(stored);
  });
});

describe('moveNavPath', () => {
  it('swaps a path up with its previous neighbour', () => {
    expect(moveNavPath(DEFAULTS, '/calendar', 'up')).toEqual([
      '/dashboard',
      '/calendar',
      '/tasks',
      '/admin',
    ]);
  });

  it('swaps a path down with its next neighbour', () => {
    expect(moveNavPath(DEFAULTS, '/tasks', 'down')).toEqual([
      '/dashboard',
      '/calendar',
      '/tasks',
      '/admin',
    ]);
  });

  it('is a no-op with the same reference at the top edge', () => {
    expect(moveNavPath(DEFAULTS, '/dashboard', 'up')).toBe(DEFAULTS);
  });

  it('is a no-op with the same reference at the bottom edge', () => {
    expect(moveNavPath(DEFAULTS, '/admin', 'down')).toBe(DEFAULTS);
  });

  it('is a no-op with the same reference for an unknown path', () => {
    expect(moveNavPath(DEFAULTS, '/unknown', 'up')).toBe(DEFAULTS);
  });
});
