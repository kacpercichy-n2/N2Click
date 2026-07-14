// Form-level dirtiness registry, consulted at storage-event time to decide
// whether an external same-browser tab write can be applied IN PLACE (clean
// tab) or must raise a CONFLICT (dirty tab). Deliberately tiny and pure: no
// React, no storage. The UI package wires `useSaveStatus` to register each open
// form's dirty flag here by a stable object key (one identity per form). A
// failed local write is treated as dirty by the provider (in-memory state has
// already diverged from storage) independently of this registry.
const dirtyFlags = new Map<object, boolean>();

/** Record whether the form identified by `key` currently has unsaved edits. */
export function setDirtyFlag(key: object, dirty: boolean): void {
  dirtyFlags.set(key, dirty);
}

/** Forget a form entirely (e.g. on unmount) so it can never read as dirty. */
export function clearDirtyFlag(key: object): void {
  dirtyFlags.delete(key);
}

/** True iff any registered form currently reports itself dirty. */
export function anyDirty(): boolean {
  for (const dirty of dirtyFlags.values()) {
    if (dirty) return true;
  }
  return false;
}

// ---- Router navigation guard ----------------------------------------------
//
// Separate, OPT-IN scope on top of the tab-conflict flags above: only the task
// modal and the project detail editor register here, so unrelated routes and
// forms never gain a global navigation blocker. The scope names WHICH edit
// surface is dirty, because each one is discarded by a different kind of
// navigation: the task modal lives on the `?task=` search param, while the
// project editor lives on the pathname.

export type NavGuardScope = 'task-modal' | 'project-detail';

const navGuards = new Map<object, NavGuardScope>();

/** Mark the form at `key` as a dirty navigation-guarded surface (or not). */
export function setNavGuard(key: object, scope: NavGuardScope, dirty: boolean): void {
  if (dirty) navGuards.set(key, scope);
  else navGuards.delete(key);
}

/** Forget a guarded form entirely (e.g. on unmount). */
export function clearNavGuard(key: object): void {
  navGuards.delete(key);
}

/** Scopes that currently hold unsaved edits. */
export function dirtyNavScopes(): ReadonlySet<NavGuardScope> {
  return new Set(navGuards.values());
}

/**
 * Pure decision: would navigating `current` → `next` discard the edits held by
 * `scopes`? A dirty task modal dies when the `task` search param changes; a
 * dirty project editor dies when the pathname changes (same-path search-param
 * changes, e.g. opening the task modal over it, keep it mounted).
 */
export function navGuardBlocks(
  scopes: ReadonlySet<NavGuardScope>,
  current: { pathname: string; search: string },
  next: { pathname: string; search: string },
): boolean {
  if (scopes.size === 0) return false;
  const pathChanged = current.pathname !== next.pathname;
  const taskChanged =
    new URLSearchParams(current.search).get('task') !==
    new URLSearchParams(next.search).get('task');
  return (
    (scopes.has('task-modal') && taskChanged) ||
    (scopes.has('project-detail') && pathChanged)
  );
}

// A form that already confirmed the discard with its own dialog (modal close,
// project "Wróć"/delete) arms this one-shot bypass right before it navigates,
// so the router guard does not prompt a second time. Consumed (and therefore
// cleared) by the very next navigation attempt.
let navGuardBypass = false;

export function bypassNavGuardOnce(): void {
  navGuardBypass = true;
}

export function consumeNavGuardBypass(): boolean {
  const bypass = navGuardBypass;
  navGuardBypass = false;
  return bypass;
}
