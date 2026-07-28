// Pure, React-free memoization primitives for `selectors.ts`.
//
// WHY THIS IS SOUND (invariant 6). Every reducer command that rejects its input
// returns the SAME state reference, and every accepted command builds a NEW
// object for each collection it changes (nothing is mutated in place). The
// reference-preserving cloud merge follows the same rule: a no-op merge returns
// the ORIGINAL state reference and a value-identical row/collection keeps its
// object/array. Therefore:
//   - the same `AppData` reference ⇒ identical contents, and
//   - the same collection array reference ⇒ identical rows in identical order.
// Both are exactly what a WeakMap needs as a key, so caching keyed on a state or
// collection reference can never hand out a stale result.
//
// Nothing here imports React or mutates anything; the cached values are handed
// out as SHARED references, so callers must never mutate a selector result
// (verified: no `.sort(`/`.push(`/`.splice(`/`.reverse(` on any cached selector
// result across the repo — `packDayBlocks` copies before sorting).
import type { AppData } from '../types';

/**
 * `WeakMap`-backed memoizer over an object key (a state or, more usefully, the
 * NARROWEST collection array a derived value depends on — so an unrelated action
 * keeps the index warm). `build` runs at most once per distinct key reference.
 */
export function createRefCache<K extends object, V>(build: (key: K) => V): (key: K) => V {
  const cache = new WeakMap<K, V>();
  return (key: K): V => {
    // `has` (not a truthiness check on `get`) so a legitimately `undefined`
    // result is still a cache hit and never recomputed.
    if (cache.has(key)) return cache.get(key) as V;
    const value = build(key);
    cache.set(key, value);
    return value;
  };
}

/**
 * Two-level cache for derived selectors that take arguments: the outer key is
 * the `AppData` reference (per-revision), the inner key a derived string built
 * with {@link argsKey} / {@link filterKey}. The same `(state, args)` pair always
 * yields the same result REFERENCE, which is what lets `React.memo` and
 * `useSelector` equality checks actually hold.
 */
export function createKeyedCache<V>(
  compute: (state: AppData, key: string) => V,
): (state: AppData, key: string) => V {
  const outer = new WeakMap<AppData, Map<string, V>>();
  return (state: AppData, key: string): V => {
    let inner = outer.get(state);
    if (inner === undefined) {
      inner = new Map<string, V>();
      outer.set(state, inner);
    }
    if (inner.has(key)) return inner.get(key) as V;
    const value = compute(state, key);
    inner.set(key, value);
    return value;
  };
}

/**
 * Composite cache key from string arguments (ids, `yyyy-MM-dd` dates, serialized
 * filters). Ids are UUIDs and dates are fixed-width, so a single space is an
 * unambiguous separator — the same cheap trick as `weekViewModel.personDateKey`.
 */
export function argsKey(...parts: string[]): string {
  return parts.join(' ');
}

/**
 * Serialize an optional person filter. `undefined` and an EMPTY set collapse to
 * the same key because the selectors treat them identically today
 * (`!personFilter || personFilter.size === 0` / `filterActive`); a non-empty set
 * serializes order-independently.
 */
export function filterKey(personFilter?: Set<string>): string {
  if (personFilter === undefined || personFilter.size === 0) return '';
  return Array.from(personFilter).sort().join(',');
}
