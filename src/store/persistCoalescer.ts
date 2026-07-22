// Trailing, non-restarting coalescer for the per-action localStorage persist.
//
// AppStoreProvider used to call saveData(state) synchronously after EVERY
// dispatch — a full multi-MB JSON.stringify + localStorage.setItem per action.
// Under a drag (continuous dispatch) that serialized the whole envelope on every
// pointer move. This module collapses a burst of dispatches into ONE write.
//
// See PERSIST_COALESCE_MS for why the window is safe.
import type { AppData } from '../types';
import type { SaveResult } from './storage';

/**
 * Coalescing window (ms) for the per-action localStorage persist. The first
 * schedule after an idle period arms ONE trailing timer for this long;
 * subsequent schedules within the window only REPLACE the pending state
 * (newest wins) and do NOT restart the timer — so rapid drag dispatch cannot
 * starve the save (latency is bounded to this value, not to "idle at last").
 *
 * The immediate-flush triggers (pagehide / visibilitychange→hidden, retry /
 * keepLocal, and the external-change callback) bound the worst-case data-loss
 * window: an unsaved coalesced state is force-written before the tab is hidden,
 * closed, or reconciled against another tab's write.
 */
export const PERSIST_COALESCE_MS = 1000;

export interface PersistCoalescerOptions {
  /** Injected saveData — performs the real serialize + localStorage write. */
  save: (data: AppData) => SaveResult;
  /** Surface the write outcome (saveError lifecycle / conflict collapse). */
  onResult: (result: SaveResult) => void;
  /** Coalescing window in ms. */
  delayMs: number;
  /** Injectable timer for tests; defaults to the global setTimeout. */
  setTimeoutFn?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  /** Injectable timer for tests; defaults to the global clearTimeout. */
  clearTimeoutFn?: (handle: ReturnType<typeof setTimeout>) => void;
}

export interface PersistCoalescer {
  /** Queue the newest state; arm the trailing timer if idle (non-restarting). */
  schedule(data: AppData): void;
  /** Write any pending state immediately (exactly once); no-op when idle. */
  flush(): void;
  /** Drop any pending state WITHOUT saving. */
  cancel(): void;
  /** True while a state is queued for the trailing write. */
  hasPending(): boolean;
}

export function createPersistCoalescer(opts: PersistCoalescerOptions): PersistCoalescer {
  const setTimeoutFn =
    opts.setTimeoutFn ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimeoutFn =
    opts.clearTimeoutFn ?? ((handle: ReturnType<typeof setTimeout>) => clearTimeout(handle));

  let timer: ReturnType<typeof setTimeout> | null = null;
  // A one-slot box holds the NEWEST scheduled state; a later schedule replaces
  // it without arming a second timer (newest wins, bounded latency).
  let pending: { data: AppData } | null = null;

  // Write the pending state exactly once. No-op when nothing is queued.
  function fire(): void {
    timer = null;
    if (pending === null) return;
    const data = pending.data;
    pending = null;
    const result = opts.save(data);
    opts.onResult(result);
  }

  return {
    schedule(data: AppData): void {
      pending = { data };
      // Non-restarting: a running timer already covers this (now-newer) state.
      if (timer === null) {
        timer = setTimeoutFn(fire, opts.delayMs);
      }
    },
    flush(): void {
      if (timer !== null) {
        clearTimeoutFn(timer);
        timer = null;
      }
      fire();
    },
    cancel(): void {
      if (timer !== null) {
        clearTimeoutFn(timer);
        timer = null;
      }
      pending = null;
    },
    hasPending(): boolean {
      return pending !== null;
    },
  };
}
