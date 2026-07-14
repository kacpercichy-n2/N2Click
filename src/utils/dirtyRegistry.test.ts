// Unit tests for the pure dirty-form registry (PKG-20260713c-persist-tests).
// src/utils/dirtyRegistry.ts is deliberately tiny: a module-level
// `Map<object, boolean>` with setDirtyFlag/clearDirtyFlag/anyDirty, consulted
// by the persistence provider to decide clean-refresh vs conflict on an
// external same-browser tab write. No React, no storage — pure map semantics.
//
// The registry is module-level mutable state shared across every test in this
// file (and, in principle, across the whole vitest run — but each test file
// gets a fresh module graph). Each test below uses fresh, unique object-literal
// keys (`{}`) so tests can never collide on identity, and cleans up any flag it
// sets via `afterEach` so no test leaks a dirty flag into the next.
import { afterEach, describe, expect, it } from 'vitest';
import {
  anyDirty,
  bypassNavGuardOnce,
  clearDirtyFlag,
  clearNavGuard,
  consumeNavGuardBypass,
  dirtyNavScopes,
  navGuardBlocks,
  setDirtyFlag,
  setNavGuard,
} from './dirtyRegistry';

describe('dirtyRegistry', () => {
  const keysToClean: object[] = [];

  afterEach(() => {
    for (const key of keysToClean.splice(0)) clearDirtyFlag(key);
  });

  it('anyDirty() is false on a clean registry (no keys registered dirty yet in this file)', () => {
    expect(anyDirty()).toBe(false);
  });

  it('anyDirty() becomes true after setDirtyFlag(key, true)', () => {
    const key = {};
    keysToClean.push(key);
    setDirtyFlag(key, true);
    expect(anyDirty()).toBe(true);
  });

  it('anyDirty() becomes false again after setDirtyFlag(key, false) on the same key', () => {
    const key = {};
    keysToClean.push(key);
    setDirtyFlag(key, true);
    expect(anyDirty()).toBe(true);
    setDirtyFlag(key, false);
    expect(anyDirty()).toBe(false);
  });

  it('clearDirtyFlag removes the entry entirely so it can never read as dirty again', () => {
    const key = {};
    setDirtyFlag(key, true);
    expect(anyDirty()).toBe(true);
    clearDirtyFlag(key);
    expect(anyDirty()).toBe(false);
    // Already cleared — nothing to add to keysToClean.
  });

  it('two independent keys: clearing one dirty key leaves the other key dirty untouched', () => {
    const keyA = {};
    const keyB = {};
    keysToClean.push(keyA, keyB);
    setDirtyFlag(keyA, true);
    setDirtyFlag(keyB, true);

    clearDirtyFlag(keyA);
    expect(anyDirty()).toBe(true); // keyB is still dirty

    setDirtyFlag(keyB, false);
    expect(anyDirty()).toBe(false);
  });
});

// Router navigation guard: opt-in scoped registry + one-shot bypass + the pure
// "would this navigation discard the edit?" decision the App-level blocker
// uses. Same module-level-state hygiene as above: unique object keys per test,
// afterEach cleanup, and the bypass is drained so no test leaks an armed one.
describe('navigation guard registry', () => {
  const keysToClean: object[] = [];

  afterEach(() => {
    for (const key of keysToClean.splice(0)) clearNavGuard(key);
    consumeNavGuardBypass();
  });

  it('starts with no dirty scopes', () => {
    expect(dirtyNavScopes().size).toBe(0);
  });

  it('setNavGuard(dirty=true) exposes the scope; dirty=false removes it', () => {
    const key = {};
    keysToClean.push(key);
    setNavGuard(key, 'task-modal', true);
    expect(dirtyNavScopes().has('task-modal')).toBe(true);
    setNavGuard(key, 'task-modal', false);
    expect(dirtyNavScopes().size).toBe(0);
  });

  it('clearNavGuard forgets a dirty form entirely (unmount path)', () => {
    const key = {};
    setNavGuard(key, 'project-detail', true);
    expect(dirtyNavScopes().has('project-detail')).toBe(true);
    clearNavGuard(key);
    expect(dirtyNavScopes().size).toBe(0);
  });

  it('independent forms contribute independent scopes', () => {
    const modal = {};
    const page = {};
    keysToClean.push(modal, page);
    setNavGuard(modal, 'task-modal', true);
    setNavGuard(page, 'project-detail', true);
    expect(dirtyNavScopes()).toEqual(new Set(['task-modal', 'project-detail']));
    clearNavGuard(modal);
    expect(dirtyNavScopes()).toEqual(new Set(['project-detail']));
  });

  it('bypass is one-shot: armed once, consumed once, then gone', () => {
    expect(consumeNavGuardBypass()).toBe(false);
    bypassNavGuardOnce();
    expect(consumeNavGuardBypass()).toBe(true);
    // The very next navigation attempt no longer bypasses.
    expect(consumeNavGuardBypass()).toBe(false);
  });
});

describe('navGuardBlocks', () => {
  const at = (pathname: string, search = '') => ({ pathname, search });
  const scopes = (...s: Array<'task-modal' | 'project-detail'>) => new Set(s);

  it('never blocks when nothing is dirty (clean navigation stays immediate)', () => {
    expect(
      navGuardBlocks(scopes(), at('/projects/p1'), at('/dashboard')),
    ).toBe(false);
    expect(
      navGuardBlocks(scopes(), at('/tasks', '?task=t1'), at('/tasks')),
    ).toBe(false);
  });

  it('dirty task modal blocks any navigation that changes the ?task= param', () => {
    // Closing the modal (param removed) on the same page.
    expect(
      navGuardBlocks(scopes('task-modal'), at('/tasks', '?task=t1'), at('/tasks')),
    ).toBe(true);
    // Route change that drops the param (sidebar link, in-app link).
    expect(
      navGuardBlocks(
        scopes('task-modal'),
        at('/tasks', '?task=t1'),
        at('/projects'),
      ),
    ).toBe(true);
    // Back/Forward landing on a different task.
    expect(
      navGuardBlocks(
        scopes('task-modal'),
        at('/tasks', '?task=t1'),
        at('/tasks', '?task=t2'),
      ),
    ).toBe(true);
  });

  it('dirty task modal does NOT block navigation that keeps the same ?task=', () => {
    expect(
      navGuardBlocks(
        scopes('task-modal'),
        at('/tasks', '?task=t1&filter=a'),
        at('/tasks', '?task=t1'),
      ),
    ).toBe(false);
  });

  it('dirty project editor blocks pathname changes only', () => {
    expect(
      navGuardBlocks(
        scopes('project-detail'),
        at('/projects/p1'),
        at('/projects'),
      ),
    ).toBe(true);
    expect(
      navGuardBlocks(
        scopes('project-detail'),
        at('/projects/p1'),
        at('/projects/p2'),
      ),
    ).toBe(true);
    // Opening the task modal OVER the dirty project page keeps it mounted —
    // must not prompt.
    expect(
      navGuardBlocks(
        scopes('project-detail'),
        at('/projects/p1'),
        at('/projects/p1', '?task=new&project=p1'),
      ),
    ).toBe(false);
  });

  it('a scope only blocks its own kind of navigation', () => {
    // Project dirty, task param changes on the same path: allowed.
    expect(
      navGuardBlocks(
        scopes('project-detail'),
        at('/projects/p1', '?task=t1'),
        at('/projects/p1'),
      ),
    ).toBe(false);
    // Both dirty: either trigger blocks.
    expect(
      navGuardBlocks(
        scopes('task-modal', 'project-detail'),
        at('/projects/p1', '?task=t1'),
        at('/projects/p1'),
      ),
    ).toBe(true);
  });
});
