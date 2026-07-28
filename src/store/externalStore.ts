// Pure, React-free reducer store behind `useSyncExternalStore`.
//
// It is deliberately tiny and owns exactly one rule the React `useReducer` it
// replaces could not express: a dispatch whose reducer result is REFERENCE-EQUAL
// to the previous state notifies NOBODY. Invariant 6 (every rejected reducer
// command returns the same state reference) therefore makes an invalid command
// literally free — no notify, no render, no persist transition.
//
// One instance lives per provider instance (never a module singleton), so
// StrictMode remounts and unit tests can never leak state into each other.

export interface ExternalStore<S, A> {
  getState(): S;
  dispatch(action: A): void;
  subscribe(listener: () => void): () => void;
}

export function createExternalStore<S, A>(
  reducer: (state: S, action: A) => S,
  initial: S,
): ExternalStore<S, A> {
  let state = initial;
  const listeners = new Set<() => void>();

  const getState = (): S => state;

  const dispatch = (action: A): void => {
    const next = reducer(state, action);
    if (next === state) return; // invariant 6 — a rejected command is a no-op
    state = next;
    // Copy before iterating: a listener may unsubscribe (or subscribe) while
    // being notified, and mutating the live Set mid-iteration is a foot-gun.
    for (const listener of [...listeners]) listener();
  };

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return { getState, dispatch, subscribe };
}

/**
 * One-level-deep equality for `useSelector` selections.
 * - `Object.is` first (covers primitives and identical references);
 * - arrays: same length + `Object.is` per element;
 * - plain objects: same key set + `Object.is` per value;
 * - anything else: false.
 *
 * This is what makes a list selection cheap across revisions: the cached
 * selectors hand out per-revision stable references, and the reference-preserving
 * merge keeps unchanged ROW objects stable, so a recomputed list of unchanged
 * rows is shallow-equal and skips the re-render.
 */
export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;

  const aIsArray = Array.isArray(a);
  if (aIsArray !== Array.isArray(b)) return false;

  if (aIsArray) {
    const arrA = a as unknown[];
    const arrB = b as unknown[];
    if (arrA.length !== arrB.length) return false;
    for (let i = 0; i < arrA.length; i += 1) {
      if (!Object.is(arrA[i], arrB[i])) return false;
    }
    return true;
  }

  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keysA = Object.keys(objA);
  if (keysA.length !== Object.keys(objB).length) return false;
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(objB, key)) return false;
    if (!Object.is(objA[key], objB[key])) return false;
  }
  return true;
}
