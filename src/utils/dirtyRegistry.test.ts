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
import { anyDirty, clearDirtyFlag, setDirtyFlag } from './dirtyRegistry';

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
