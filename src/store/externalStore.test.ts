// Unit tests for the React-free reducer store behind `useSyncExternalStore`
// (PKG-20260728-store-performance) and for the `shallowEqual` used by
// `useSelector`. Pure: no React, no localStorage.
import { describe, expect, it } from 'vitest';
import { createExternalStore, shallowEqual } from './externalStore';
import { reducer } from './AppStore';
import { emptyData } from './storage';
import type { AppData } from '../types';

type CounterAction = { type: 'inc' } | { type: 'noop' } | { type: 'set'; value: number };

interface CounterState {
  count: number;
}

function counterReducer(state: CounterState, action: CounterAction): CounterState {
  switch (action.type) {
    case 'inc':
      return { count: state.count + 1 };
    case 'set':
      // Value-equal ⇒ SAME reference (the invariant-6 shape in miniature).
      return action.value === state.count ? state : { count: action.value };
    default:
      return state;
  }
}

describe('createExternalStore', () => {
  it('exposes the initial state and the state produced by a dispatch', () => {
    const initial = { count: 0 };
    const store = createExternalStore(counterReducer, initial);
    expect(store.getState()).toBe(initial);
    store.dispatch({ type: 'inc' });
    expect(store.getState()).toEqual({ count: 1 });
    expect(store.getState()).not.toBe(initial);
  });

  it('notifies subscribers exactly ONCE per changing dispatch', () => {
    const store = createExternalStore(counterReducer, { count: 0 });
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });
    store.dispatch({ type: 'inc' });
    store.dispatch({ type: 'inc' });
    expect(calls).toBe(2);
    expect(store.getState()).toEqual({ count: 2 });
  });

  it('does NOT notify when the reducer returns the SAME state reference', () => {
    const store = createExternalStore(counterReducer, { count: 3 });
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });
    store.dispatch({ type: 'noop' }); // default branch → same reference
    store.dispatch({ type: 'set', value: 3 }); // value-equal → same reference
    expect(calls).toBe(0);
    expect(store.getState()).toEqual({ count: 3 });
  });

  it('listeners see the NEW state (the store is written before notifying)', () => {
    const store = createExternalStore(counterReducer, { count: 0 });
    const seen: number[] = [];
    store.subscribe(() => seen.push(store.getState().count));
    store.dispatch({ type: 'inc' });
    store.dispatch({ type: 'inc' });
    expect(seen).toEqual([1, 2]);
  });

  it('unsubscribe stops further notifications', () => {
    const store = createExternalStore(counterReducer, { count: 0 });
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });
    store.dispatch({ type: 'inc' });
    unsubscribe();
    store.dispatch({ type: 'inc' });
    expect(calls).toBe(1);
  });

  it('unsubscribing DURING a notify is safe and does not skip a sibling', () => {
    const store = createExternalStore(counterReducer, { count: 0 });
    const seen: string[] = [];
    const unsubscribeSecond = store.subscribe(() => {
      seen.push('b');
    });
    // `a` is registered AFTER `b` but tears both down while the set is iterated.
    const unsubscribeFirst = store.subscribe(() => {
      seen.push('a');
      unsubscribeFirst();
      unsubscribeSecond();
    });
    expect(() => store.dispatch({ type: 'inc' })).not.toThrow();
    expect(seen).toEqual(['b', 'a']);
    store.dispatch({ type: 'inc' });
    expect(seen).toEqual(['b', 'a']); // both really are gone
  });

  it('two stores over the same reducer are INDEPENDENT (per provider instance)', () => {
    const a = createExternalStore(counterReducer, { count: 0 });
    const b = createExternalStore(counterReducer, { count: 0 });
    a.dispatch({ type: 'inc' });
    expect(a.getState()).toEqual({ count: 1 });
    expect(b.getState()).toEqual({ count: 0 });
  });

  it('drives the REAL app reducer: a rejected command notifies nobody (invariant 6)', () => {
    const initial: AppData = emptyData();
    const store = createExternalStore(reducer, initial);
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });

    store.dispatch({ type: 'SET_BLOCK_DONE', entryId: 'nope', done: true });
    expect(calls).toBe(0);
    expect(store.getState()).toBe(initial);

    store.dispatch({ type: 'ADD_DEPARTMENT', name: 'Produkcja' });
    expect(calls).toBe(1);
    expect(store.getState()).not.toBe(initial);
    expect(store.getState().departments).toHaveLength(1);

    store.dispatch({ type: 'ADD_DEPARTMENT', name: '   ' }); // empty name → rejected
    expect(calls).toBe(1);
  });
});

describe('shallowEqual', () => {
  it('is true for identical references and primitives', () => {
    const obj = { a: 1 };
    expect(shallowEqual(obj, obj)).toBe(true);
    expect(shallowEqual(1, 1)).toBe(true);
    expect(shallowEqual('x', 'x')).toBe(true);
    expect(shallowEqual(null, null)).toBe(true);
    expect(shallowEqual(undefined, undefined)).toBe(true);
    expect(shallowEqual(NaN, NaN)).toBe(true); // Object.is semantics
  });

  it('is false for mismatched primitives / null vs object', () => {
    expect(shallowEqual(1, 2)).toBe(false);
    expect(shallowEqual(null, {})).toBe(false);
    expect(shallowEqual({}, null)).toBe(false);
    expect(shallowEqual(0, '0')).toBe(false);
  });

  it('compares arrays by length + per-element reference', () => {
    const row = { id: 'r' };
    expect(shallowEqual([row], [row])).toBe(true);
    expect(shallowEqual([], [])).toBe(true);
    expect(shallowEqual([row], [row, row])).toBe(false);
    expect(shallowEqual([{ id: 'r' }], [{ id: 'r' }])).toBe(false); // different refs
  });

  it('compares plain objects by key set + per-value reference', () => {
    const list = [1, 2];
    expect(shallowEqual({ a: 1, list }, { a: 1, list })).toBe(true);
    expect(shallowEqual({ a: 1, list }, { a: 2, list })).toBe(false);
    expect(shallowEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(shallowEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false);
    expect(shallowEqual({ a: 1 }, { b: 1 })).toBe(false);
    expect(shallowEqual({ list: [1, 2] }, { list: [1, 2] })).toBe(false); // one level only
  });

  it('does not treat an array and an object as equal', () => {
    expect(shallowEqual([], {})).toBe(false);
    expect(shallowEqual({ 0: 'a', length: 1 }, ['a'])).toBe(false);
  });
});
