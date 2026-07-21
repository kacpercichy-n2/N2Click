// Testy krzywej backoffu przebudowy kanału Realtime (CloudSyncProvider).
// Czyste — bez Reacta, bez SDK.
import { describe, expect, it } from 'vitest';
import { RECONNECT_MAX_DELAY_MS, reconnectDelayMs } from './liveChannel';

describe('reconnectDelayMs', () => {
  it('rośnie wykładniczo od 1 s: 1, 2, 4, 8, 16 s', () => {
    expect(reconnectDelayMs(0)).toBe(1_000);
    expect(reconnectDelayMs(1)).toBe(2_000);
    expect(reconnectDelayMs(2)).toBe(4_000);
    expect(reconnectDelayMs(3)).toBe(8_000);
    expect(reconnectDelayMs(4)).toBe(16_000);
  });

  it('zatrzymuje się na pułapie 30 s i nigdy go nie przekracza', () => {
    expect(reconnectDelayMs(5)).toBe(RECONNECT_MAX_DELAY_MS);
    expect(reconnectDelayMs(6)).toBe(RECONNECT_MAX_DELAY_MS);
    expect(reconnectDelayMs(100)).toBe(RECONNECT_MAX_DELAY_MS);
    expect(reconnectDelayMs(Number.MAX_SAFE_INTEGER)).toBe(RECONNECT_MAX_DELAY_MS);
  });

  it('wejście spoza zakresu traktuje jak pierwszą próbę (nigdy poniżej 1 s)', () => {
    expect(reconnectDelayMs(-1)).toBe(1_000);
    expect(reconnectDelayMs(Number.NaN)).toBe(1_000);
    expect(reconnectDelayMs(1.5)).toBe(1_000);
    expect(reconnectDelayMs(Number.POSITIVE_INFINITY)).toBe(1_000);
  });
});
