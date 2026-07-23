// Histereza flagi `live` — czysta, z fałszywym zegarem. Odwzorowuje flap kanału
// Realtime i sprawdza, że baner stale-hint nie miga przy przejściowym dropie.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLiveTracker, type LiveTracker } from './liveChannelTracker';

const GRACE = 5_000;

// Minimalny fałszywy planer: kolejka timerów z ręcznym przesuwaniem czasu.
function makeClock() {
  let seq = 0;
  let now = 0;
  const timers = new Map<number, { fn: () => void; due: number }>();
  return {
    schedule(fn: () => void, ms: number): number {
      const id = ++seq;
      timers.set(id, { fn, due: now + ms });
      return id;
    },
    cancel(handle: unknown): void {
      timers.delete(handle as number);
    },
    advance(ms: number): void {
      now += ms;
      for (const [id, t] of [...timers]) {
        if (t.due <= now) {
          timers.delete(id);
          t.fn();
        }
      }
    },
    pending(): number {
      return timers.size;
    },
  };
}

describe('liveChannelTracker', () => {
  let clock: ReturnType<typeof makeClock>;
  let setLive: ReturnType<typeof vi.fn<(live: boolean) => void>>;
  let tracker: LiveTracker;

  beforeEach(() => {
    clock = makeClock();
    setLive = vi.fn<(live: boolean) => void>();
    tracker = createLiveTracker({
      graceMs: GRACE,
      setLive,
      schedule: clock.schedule,
      cancel: clock.cancel,
    });
  });

  it('SUBSCRIBED podnosi live natychmiast', () => {
    tracker.onStatus('SUBSCRIBED');
    expect(setLive).toHaveBeenCalledTimes(1);
    expect(setLive).toHaveBeenLastCalledWith(true);
  });

  it('flap (drop + szybki resubscribe < grace) NIE zbija live — baner się nie pokazuje', () => {
    tracker.onStatus('SUBSCRIBED');
    setLive.mockClear();

    tracker.onStatus('CHANNEL_ERROR');
    clock.advance(1_000); // przerwa krótsza niż grace
    tracker.onStatus('SUBSCRIBED');
    clock.advance(GRACE); // upewnij się, że zaplanowany drop już nie odpali

    // Zero dodatkowych raportów: live cały czas true, żaden false nie poszedł.
    expect(setLive).not.toHaveBeenCalled();
    expect(clock.pending()).toBe(0);
  });

  it('trwała utrata > grace zbija live (fallback banera)', () => {
    tracker.onStatus('SUBSCRIBED');
    setLive.mockClear();

    tracker.onStatus('TIMED_OUT');
    clock.advance(GRACE - 1);
    expect(setLive).not.toHaveBeenCalled(); // jeszcze w oknie grace
    clock.advance(1);
    expect(setLive).toHaveBeenCalledTimes(1);
    expect(setLive).toHaveBeenLastCalledWith(false);
  });

  it('powrót live po trwałej utracie chowa baner', () => {
    tracker.onStatus('SUBSCRIBED');
    tracker.onStatus('CHANNEL_ERROR');
    clock.advance(GRACE); // live -> false
    setLive.mockClear();

    tracker.onStatus('SUBSCRIBED'); // powrót
    expect(setLive).toHaveBeenCalledTimes(1);
    expect(setLive).toHaveBeenLastCalledWith(true);
  });

  it('seria dropów nie kumuluje timerów (jedno okno grace)', () => {
    tracker.onStatus('SUBSCRIBED');
    tracker.onStatus('CHANNEL_ERROR');
    tracker.onStatus('TIMED_OUT');
    tracker.onStatus('CHANNEL_ERROR');
    expect(clock.pending()).toBe(1);
  });

  it('utrata przy martwym kanale (nigdy nie SUBSCRIBED) nie planuje nic', () => {
    tracker.onStatus('CHANNEL_ERROR');
    tracker.onStatus('TIMED_OUT');
    expect(setLive).not.toHaveBeenCalled();
    expect(clock.pending()).toBe(0);
  });

  it('dispose kasuje oczekujący timer i zbija live', () => {
    tracker.onStatus('SUBSCRIBED');
    tracker.onStatus('CHANNEL_ERROR'); // zaplanowany drop
    setLive.mockClear();

    tracker.dispose();
    expect(setLive).toHaveBeenCalledTimes(1);
    expect(setLive).toHaveBeenLastCalledWith(false);
    expect(clock.pending()).toBe(0);

    // Po dispose zaległy timer nie może już odpalić drugiego false.
    clock.advance(GRACE);
    expect(setLive).toHaveBeenCalledTimes(1);
  });

  it('dispose przy live=false nie raportuje zmiany', () => {
    tracker.dispose();
    expect(setLive).not.toHaveBeenCalled();
  });
});
