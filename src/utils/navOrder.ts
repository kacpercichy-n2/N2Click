/**
 * Pure helpers for the per-user sidebar nav order.
 *
 * The stored value is only a permutation of the shipped default order (route
 * paths). It never carries labels, icons or gates — `NAV` in
 * `src/components/navItems.ts` stays the single source of truth for those, and
 * gating is always applied AFTER ordering so a stored order can never resurrect
 * a gated entry. These functions are self-repairing by construction, so no
 * migration code is ever needed.
 */

/**
 * Resolve the effective nav order from a defensively-parsed stored value.
 *
 * Keeps only stored entries that are strings AND present in `defaultPaths`
 * (deduplicated, first win), then appends every missing default in its default
 * relative order. Non-array / garbage input falls back to the default order.
 */
export function applyNavOrder(defaultPaths: string[], stored: unknown): string[] {
  if (!Array.isArray(stored)) return [...defaultPaths];
  const allowed = new Set(defaultPaths);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of stored) {
    if (typeof entry !== 'string') continue;
    if (!allowed.has(entry) || seen.has(entry)) continue;
    seen.add(entry);
    result.push(entry);
  }
  for (const path of defaultPaths) {
    if (!seen.has(path)) result.push(path);
  }
  return result;
}

/**
 * Swap `path` with its neighbour in `paths`. Returns the SAME reference (no-op)
 * when the path is unknown or already at the relevant edge, so callers can skip
 * a persist/dispatch when nothing changed.
 */
export function moveNavPath(
  paths: string[],
  path: string,
  direction: 'up' | 'down',
): string[] {
  const index = paths.indexOf(path);
  if (index === -1) return paths;
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= paths.length) return paths;
  const next = [...paths];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
