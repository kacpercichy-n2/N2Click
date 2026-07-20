// Focused tests for the pure realtime-sync decisions (realtimeSync.ts). Pure —
// no React, no timers-in-provider, no live backend: only the watched-table sets,
// the channel-status -> live mapping, the stale-hint predicate and the
// debounce/coalesce/defer scheduler state machine. CloudSyncProvider is a thin
// adapter over these, so this is where the sync-timing invariants are pinned.
import { describe, expect, it } from 'vitest';
import {
  ALL_REALTIME_TABLES,
  DICTIONARY_REALTIME_TABLES,
  PLANNER_REALTIME_TABLES,
  REALTIME_DEBOUNCE_MS,
  REALTIME_MAX_WAIT_MS,
  afterFlush,
  emptyRefreshScheduler,
  isLiveChannelStatus,
  isRefreshPending,
  planRefresh,
  recordRealtimeEvent,
  refreshDueAt,
  showStaleHint,
  shouldMirrorProcessQueue,
  subscribePlannerChannel,
  type RealtimeChannelLike,
} from './realtimeSync';

// Minimalny mock kanału Realtime: zapamiętuje rejestracje `on` i callback
// subskrypcji, a każdy `on` zwraca ten sam kanał (łańcuchowanie jak w SDK).
function makeMockChannel() {
  const registrations: Array<{ table: string; fire: () => void }> = [];
  let statusCb: ((status: string) => void) | null = null;
  const channel: RealtimeChannelLike = {
    on(_type, filter, callback) {
      registrations.push({ table: filter.table, fire: () => callback({}) });
      return channel;
    },
    subscribe(callback) {
      statusCb = callback;
      return channel;
    },
  };
  return {
    channel,
    registrations,
    emitStatus: (status: string) => statusCb?.(status),
    hasSubscribed: () => statusCb !== null,
  };
}

describe('subscribePlannerChannel wiring', () => {
  const noopHandlers = {
    onPlannerChange: () => {},
    onDictionaryChange: () => {},
    onStatus: () => {},
  };

  it('creates exactly one channel and registers all 13 table listeners once', () => {
    const mock = makeMockChannel();
    let created = 0;
    subscribePlannerChannel(
      () => {
        created += 1;
        return mock.channel;
      },
      () => {},
      noopHandlers,
    );
    expect(created).toBe(1);
    expect(mock.registrations.map((r) => r.table)).toEqual([...ALL_REALTIME_TABLES]);
    expect(mock.hasSubscribed()).toBe(true);
  });

  it('routes planner-table events to onPlannerChange and dictionary events to onDictionaryChange', () => {
    const mock = makeMockChannel();
    const planner: string[] = [];
    const dictionary: string[] = [];
    subscribePlannerChannel(() => mock.channel, () => {}, {
      onPlannerChange: (t) => planner.push(t),
      onDictionaryChange: (t) => dictionary.push(t),
      onStatus: () => {},
    });
    for (const reg of mock.registrations) reg.fire();
    expect(planner).toEqual([...PLANNER_REALTIME_TABLES]);
    expect(dictionary).toEqual([...DICTIONARY_REALTIME_TABLES]);
  });

  it('forwards channel status to onStatus', () => {
    const mock = makeMockChannel();
    const statuses: string[] = [];
    subscribePlannerChannel(() => mock.channel, () => {}, {
      ...noopHandlers,
      onStatus: (s) => statuses.push(s),
    });
    mock.emitStatus('SUBSCRIBED');
    mock.emitStatus('CHANNEL_ERROR');
    expect(statuses).toEqual(['SUBSCRIBED', 'CHANNEL_ERROR']);
  });

  it('teardown removes exactly the created channel', () => {
    const mock = makeMockChannel();
    const removed: RealtimeChannelLike[] = [];
    const sub = subscribePlannerChannel(
      () => mock.channel,
      (ch) => removed.push(ch),
      noopHandlers,
    );
    expect(removed).toHaveLength(0);
    sub.teardown();
    expect(removed).toEqual([mock.channel]);
  });

  it('propagates a subscribe failure so the provider can catch it (live=false, no silent success)', () => {
    const failing: RealtimeChannelLike = {
      on() {
        return failing;
      },
      subscribe() {
        throw new Error('brak publikacji supabase_realtime');
      },
    };
    expect(() =>
      subscribePlannerChannel(() => failing, () => {}, noopHandlers),
    ).toThrow();
  });
});

describe('watched-table sets', () => {
  it('watches the eight planner families merged by MERGE_CLOUD_ENTITIES', () => {
    expect([...PLANNER_REALTIME_TABLES]).toEqual([
      'clients',
      'projects',
      'milestones',
      'tasks',
      'task_assignments',
      'workload_entries',
      'comments',
      'activity_events',
    ]);
  });

  it('watches the five dictionary/reference tables', () => {
    expect([...DICTIONARY_REALTIME_TABLES]).toEqual([
      'profiles',
      'departments',
      'statuses',
      'service_types',
      'work_categories',
    ]);
  });

  it('exposes all 13 tables with no overlap between the two sets', () => {
    expect(ALL_REALTIME_TABLES).toHaveLength(13);
    expect(new Set(ALL_REALTIME_TABLES).size).toBe(13);
    const planner = new Set<string>(PLANNER_REALTIME_TABLES);
    for (const t of DICTIONARY_REALTIME_TABLES) expect(planner.has(t)).toBe(false);
  });
});

describe('isLiveChannelStatus', () => {
  it('is live only for SUBSCRIBED', () => {
    expect(isLiveChannelStatus('SUBSCRIBED')).toBe(true);
  });

  it('is not live for error/timeout/closed (and anything else)', () => {
    for (const s of ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED', 'CONNECTING', '']) {
      expect(isLiveChannelStatus(s)).toBe(false);
    }
  });
});

describe('showStaleHint truth table', () => {
  it('is true only when ready, queue empty and channel not live', () => {
    expect(showStaleHint({ status: 'ready', pendingCount: 0, live: false })).toBe(true);
  });

  it('is false whenever the channel is live (edits arrive on their own)', () => {
    expect(showStaleHint({ status: 'ready', pendingCount: 0, live: true })).toBe(false);
  });

  it('is false while the queue is non-empty', () => {
    expect(showStaleHint({ status: 'ready', pendingCount: 1, live: false })).toBe(false);
    expect(showStaleHint({ status: 'ready', pendingCount: 1, live: true })).toBe(false);
  });

  it('is false for any non-ready status', () => {
    for (const status of ['idle', 'hydrating', 'error']) {
      expect(showStaleHint({ status, pendingCount: 0, live: false })).toBe(false);
      expect(showStaleHint({ status, pendingCount: 0, live: true })).toBe(false);
    }
  });
});

describe('shouldMirrorProcessQueue — quiet-hydration drain gate (B1)', () => {
  it('drains immediately only when ready and no hydration is in flight', () => {
    expect(shouldMirrorProcessQueue({ phase: 'ready', hydrationInFlight: false })).toBe(true);
  });

  it('does NOT drain while a (quiet) hydration is in flight — the hydration loop owns the drain-before-merge path', () => {
    // Quiet background refresh keeps status 'ready'; without this gate the mirror
    // effect would drain concurrently and the hydration loop could merge a stale
    // snapshot over the just-sent edit. So an edit during quiet hydration must be
    // queued (elsewhere) but NOT drained here.
    expect(shouldMirrorProcessQueue({ phase: 'ready', hydrationInFlight: true })).toBe(false);
  });

  it('never drains outside the ready phase (idle/hydrating status)', () => {
    for (const phase of ['idle', 'hydrating', 'error']) {
      expect(shouldMirrorProcessQueue({ phase, hydrationInFlight: false })).toBe(false);
      expect(shouldMirrorProcessQueue({ phase, hydrationInFlight: true })).toBe(false);
    }
  });
});

describe('refresh scheduler — timing constants', () => {
  it('uses the package-specified debounce and max-wait', () => {
    expect(REALTIME_DEBOUNCE_MS).toBe(1000);
    expect(REALTIME_MAX_WAIT_MS).toBe(5000);
  });
});

describe('recordRealtimeEvent / refreshDueAt / isRefreshPending', () => {
  it('an empty scheduler has nothing pending and no due time', () => {
    const s = emptyRefreshScheduler();
    expect(isRefreshPending(s)).toBe(false);
    expect(refreshDueAt(s)).toBeNull();
  });

  it('the first event anchors both first and last timestamps', () => {
    const s = recordRealtimeEvent(emptyRefreshScheduler(), 1000);
    expect(isRefreshPending(s)).toBe(true);
    // trailing debounce == max-wait cap for a single event => first+debounce.
    expect(refreshDueAt(s)).toBe(1000 + REALTIME_DEBOUNCE_MS);
  });

  it('later events slide the trailing window but keep the max-wait anchor', () => {
    let s = recordRealtimeEvent(emptyRefreshScheduler(), 1000);
    s = recordRealtimeEvent(s, 1400);
    s = recordRealtimeEvent(s, 1700);
    expect(s.firstEventAt).toBe(1000);
    expect(s.lastEventAt).toBe(1700);
    // due = min(last + debounce, first + max-wait) = min(2700, 6000) = 2700.
    expect(refreshDueAt(s)).toBe(1700 + REALTIME_DEBOUNCE_MS);
  });

  it('caps the due time at first + max-wait under a continuous storm', () => {
    // A steady stream every 200ms keeps sliding the trailing window; the cap
    // (first + max-wait) is the earlier one and wins.
    let s = recordRealtimeEvent(emptyRefreshScheduler(), 0);
    for (let now = 200; now <= 4800; now += 200) s = recordRealtimeEvent(s, now);
    expect(refreshDueAt(s)).toBe(0 + REALTIME_MAX_WAIT_MS);
  });

  it('afterFlush resets to an empty scheduler', () => {
    let s = recordRealtimeEvent(emptyRefreshScheduler(), 1000);
    s = afterFlush();
    expect(isRefreshPending(s)).toBe(false);
    expect(refreshDueAt(s)).toBeNull();
  });
});

describe('planRefresh decisions', () => {
  const burst = recordRealtimeEvent(emptyRefreshScheduler(), 1000); // due at 2000

  it('is idle when nothing is pending', () => {
    expect(planRefresh(emptyRefreshScheduler(), 5000, { busy: false })).toEqual({ kind: 'idle' });
  });

  it('defers while busy even past the due time (echo suppression / no race)', () => {
    expect(planRefresh(burst, 9999, { busy: true })).toEqual({ kind: 'defer' });
  });

  it('waits the remaining delay before the due time', () => {
    expect(planRefresh(burst, 1600, { busy: false })).toEqual({ kind: 'wait', delayMs: 400 });
  });

  it('flushes once the due time is reached (debounce coalesces a burst to one)', () => {
    let s = burst;
    s = recordRealtimeEvent(s, 1200);
    s = recordRealtimeEvent(s, 1400); // due now 2400
    expect(planRefresh(s, 2399, { busy: false })).toEqual({ kind: 'wait', delayMs: 1 });
    expect(planRefresh(s, 2400, { busy: false })).toEqual({ kind: 'flush' });
  });

  it('flushes at the max-wait cap under a continuous storm', () => {
    let s = recordRealtimeEvent(emptyRefreshScheduler(), 0);
    for (let now = 200; now <= 5000; now += 200) s = recordRealtimeEvent(s, now);
    // Even though events keep arriving, the cap (0 + max-wait) forces a flush.
    expect(planRefresh(s, REALTIME_MAX_WAIT_MS, { busy: false })).toEqual({ kind: 'flush' });
  });
});
