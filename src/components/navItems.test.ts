// Unit tests for the pure menu-order helper behind the Ustawienia editor
// (PKG-20260722-settings-nav-cleanup). No React/store — just array ordering.
import { describe, expect, it } from 'vitest';
import { NAV_ITEMS, orderNavPaths } from './navItems';

const DEFAULT = NAV_ITEMS.map(([to]) => to);

describe('orderNavPaths', () => {
  it('undefined saved order -> default order (fresh copy)', () => {
    const result = orderNavPaths(DEFAULT, undefined);
    expect(result).toEqual(DEFAULT);
    expect(result).not.toBe(DEFAULT);
  });

  it('empty saved order -> default order', () => {
    expect(orderNavPaths(DEFAULT, [])).toEqual(DEFAULT);
  });

  it('a full permutation is applied verbatim', () => {
    const reversed = [...DEFAULT].reverse();
    expect(orderNavPaths(DEFAULT, reversed)).toEqual(reversed);
  });

  it('saved paths come first, remaining defaults follow in default order', () => {
    const saved = ['/admin', '/tasks'];
    const rest = DEFAULT.filter((p) => !saved.includes(p));
    expect(orderNavPaths(DEFAULT, saved)).toEqual([...saved, ...rest]);
  });

  it('unknown saved paths are ignored', () => {
    const saved = ['/does-not-exist', '/tasks'];
    const rest = DEFAULT.filter((p) => p !== '/tasks');
    expect(orderNavPaths(DEFAULT, saved)).toEqual(['/tasks', ...rest]);
  });

  it('duplicate saved paths are deduped', () => {
    const saved = ['/tasks', '/tasks', '/admin'];
    const rest = DEFAULT.filter((p) => p !== '/tasks' && p !== '/admin');
    expect(orderNavPaths(DEFAULT, saved)).toEqual(['/tasks', '/admin', ...rest]);
  });

  it('only unknown saved paths -> plain default order', () => {
    expect(orderNavPaths(DEFAULT, ['/nope', '/nada'])).toEqual(DEFAULT);
  });
});
