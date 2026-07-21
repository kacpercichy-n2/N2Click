// Czysty pomocnik przebudowy kanału Realtime (bez Reacta, bez SDK — jak
// liveSyncGate/dirtyRegistry). CloudSyncProvider przebudowuje padnięty kanał
// z tym opóźnieniem; test trzyma krzywą backoffu w ryzach.

/** Górny pułap przerwy między próbami przebudowy kanału. */
export const RECONNECT_MAX_DELAY_MS = 30_000;

/**
 * Wykładniczy backoff przebudowy kanału Realtime: 1 s, 2 s, 4 s, … aż do
 * pułapu 30 s. Wejście spoza zakresu (ujemne / niecałkowite / NaN) traktujemy
 * jak pierwszą próbę — funkcja nigdy nie zwraca wartości spoza [1000, 30000].
 */
export function reconnectDelayMs(attempt: number): number {
  const n = Number.isInteger(attempt) && attempt > 0 ? Math.min(attempt, 30) : 0;
  return Math.min(RECONNECT_MAX_DELAY_MS, 1_000 * 2 ** n);
}
