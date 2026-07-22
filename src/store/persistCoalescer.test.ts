// Unit tests for the trailing, non-restarting persist coalescer
// (src/store/persistCoalescer.ts). This is the data-loss-critical layer: it
// decides which state actually reaches localStorage and when. We test the pure
// module directly (node env, no jsdom) and simulate the provider's call
// sequence — including the StrictMode double-mount and pagehide flush shapes.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPersistCoalescer } from './persistCoalescer';
import type { PersistCoalescer, PersistCoalescerOptions } from './persistCoalescer';
import type { AppData } from '../types';
import type { SaveResult } from './storage';

// Minimal stand-ins: the coalescer never inspects the payload, only forwards it.
function makeData(tag: string): AppData {
  return { tag } as unknown as AppData;
}

const OK: SaveResult = { ok: true, revision: 1 };

/**
 * A deterministic timer harness so we can prove the NON-RESTARTING semantics:
 * scheduling again inside the window must NOT re-arm a new timer. Each armed
 * timer is a distinct entry; `advance` fires the single pending timer.
 */
function makeTimers() {
  let nextId = 1;
  const pending = new Map<number, () => void>();
  const opts: Pick<PersistCoalescerOptions, 'setTimeoutFn' | 'clearTimeoutFn'> = {
    setTimeoutFn: (fn: () => void) => {
      const id = nextId++;
      pending.set(id, fn);
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeoutFn: (handle: ReturnType<typeof setTimeout>) => {
      pending.delete(handle as unknown as number);
    },
  };
  return {
    opts,
    /** How many timers were ever armed (proves non-restarting). */
    armedCount: () => nextId - 1,
    /** How many timers are currently live (un-fired, un-cleared). */
    liveCount: () => pending.size,
    /** Fire all currently pending timers. */
    fireAll: () => {
      const fns = Array.from(pending.values());
      pending.clear();
      fns.forEach((fn) => fn());
    },
  };
}

function setup(
  overrides?: Partial<PersistCoalescerOptions>,
): {
  coalescer: PersistCoalescer;
  saves: AppData[];
  results: SaveResult[];
  timers: ReturnType<typeof makeTimers>;
  setSaveResult: (r: SaveResult) => void;
} {
  const timers = makeTimers();
  const saves: AppData[] = [];
  const results: SaveResult[] = [];
  let nextResult: SaveResult = OK;
  const coalescer = createPersistCoalescer({
    save: (data) => {
      saves.push(data);
      return nextResult;
    },
    onResult: (r) => results.push(r),
    delayMs: 1000,
    ...timers.opts,
    ...overrides,
  });
  return {
    coalescer,
    saves,
    results,
    timers,
    setSaveResult: (r: SaveResult) => {
      nextResult = r;
    },
  };
}

describe('createPersistCoalescer — coalescing window', () => {
  it('collapses N rapid schedules into ONE save of the NEWEST state', () => {
    const { coalescer, saves, results, timers } = setup();
    coalescer.schedule(makeData('a'));
    coalescer.schedule(makeData('b'));
    coalescer.schedule(makeData('c'));
    expect(saves).toHaveLength(0); // nothing written until the window elapses
    expect(coalescer.hasPending()).toBe(true);

    timers.fireAll();
    expect(saves).toHaveLength(1);
    expect((saves[0] as unknown as { tag: string }).tag).toBe('c');
    expect(results).toEqual([OK]);
    expect(coalescer.hasPending()).toBe(false);
  });

  it('does NOT restart the timer on later schedules within the window (bounded latency)', () => {
    const { coalescer, timers } = setup();
    coalescer.schedule(makeData('a'));
    coalescer.schedule(makeData('b'));
    coalescer.schedule(makeData('c'));
    // Exactly one timer was ever armed despite three schedules.
    expect(timers.armedCount()).toBe(1);
    expect(timers.liveCount()).toBe(1);
  });

  it('arms a fresh timer only after the previous window drained (idle re-arm)', () => {
    const { coalescer, saves, timers } = setup();
    coalescer.schedule(makeData('a'));
    timers.fireAll();
    expect(saves).toHaveLength(1);
    // Next idle-period schedule arms a second, distinct timer.
    coalescer.schedule(makeData('b'));
    expect(timers.armedCount()).toBe(2);
    timers.fireAll();
    expect(saves.map((s) => (s as unknown as { tag: string }).tag)).toEqual(['a', 'b']);
  });
});

describe('createPersistCoalescer — flush / cancel', () => {
  it('flush writes the pending state immediately, exactly once, and clears the timer', () => {
    const { coalescer, saves, timers } = setup();
    coalescer.schedule(makeData('a'));
    coalescer.flush();
    expect(saves).toHaveLength(1);
    expect(coalescer.hasPending()).toBe(false);
    expect(timers.liveCount()).toBe(0); // timer was cleared, not left dangling
    // Firing any leftover timer must NOT write a second time.
    timers.fireAll();
    expect(saves).toHaveLength(1);
  });

  it('flush with nothing pending is a no-op', () => {
    const { coalescer, saves, results } = setup();
    coalescer.flush();
    expect(saves).toHaveLength(0);
    expect(results).toHaveLength(0);
  });

  it('cancel drops the pending state without saving', () => {
    const { coalescer, saves, results, timers } = setup();
    coalescer.schedule(makeData('a'));
    coalescer.cancel();
    expect(coalescer.hasPending()).toBe(false);
    expect(timers.liveCount()).toBe(0);
    timers.fireAll();
    expect(saves).toHaveLength(0);
    expect(results).toHaveLength(0);
  });
});

describe('createPersistCoalescer — result surfacing (saveError lifecycle)', () => {
  it('forwards a save failure, then a later successful scheduled save', () => {
    const { coalescer, results, timers, setSaveResult } = setup();
    setSaveResult({ ok: false, reason: 'quota' });
    coalescer.schedule(makeData('a'));
    timers.fireAll();
    expect(results[0]).toEqual({ ok: false, reason: 'quota' });

    setSaveResult(OK);
    coalescer.schedule(makeData('b'));
    timers.fireAll();
    expect(results[1]).toEqual(OK);
  });
});

describe('createPersistCoalescer — provider-shaped sequences', () => {
  it('StrictMode double-mount: never scheduled state is never written', () => {
    // Mount 1 skips the first persist (skipPersistRef) → nothing scheduled.
    // Cleanup flush is a no-op. Mount 2 schedules a real transition once.
    const { coalescer, saves, timers } = setup();
    // mount 1 cleanup flush — no pending
    coalescer.flush();
    expect(saves).toHaveLength(0);
    // mount 2: a genuine dispatch schedules, timer resolves once
    coalescer.schedule(makeData('real'));
    timers.fireAll();
    expect(saves).toHaveLength(1);
    expect((saves[0] as unknown as { tag: string }).tag).toBe('real');
  });

  it('cleanup flush does not double-write a state already flushed', () => {
    const { coalescer, saves } = setup();
    coalescer.schedule(makeData('x'));
    coalescer.flush(); // explicit flush (e.g. pagehide)
    coalescer.flush(); // unmount cleanup flush — nothing pending
    expect(saves).toHaveLength(1);
  });

  it('pagehide shape: schedule then immediate flush writes once and clears the timer', () => {
    const { coalescer, saves, timers } = setup();
    coalescer.schedule(makeData('a'));
    coalescer.flush(); // pagehide before the window elapses
    expect(saves).toHaveLength(1);
    // Advancing time must not trigger a second save.
    timers.fireAll();
    expect(saves).toHaveLength(1);
  });
});

describe('createPersistCoalescer — default global timers', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the real setTimeout when no timer fns are injected', () => {
    vi.useFakeTimers();
    const saves: AppData[] = [];
    const coalescer = createPersistCoalescer({
      save: (data) => {
        saves.push(data);
        return OK;
      },
      onResult: () => {},
      delayMs: 1000,
    });
    coalescer.schedule(makeData('a'));
    coalescer.schedule(makeData('b'));
    expect(saves).toHaveLength(0);
    vi.advanceTimersByTime(999);
    expect(saves).toHaveLength(0); // window not elapsed
    vi.advanceTimersByTime(1);
    expect(saves).toHaveLength(1);
    expect((saves[0] as unknown as { tag: string }).tag).toBe('b');
  });
});
