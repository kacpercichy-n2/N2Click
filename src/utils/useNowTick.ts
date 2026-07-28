import { useEffect, useState } from 'react';

/** Domyślny takt zegara „teraz”: 30 s — wskazanie nigdy nie odstaje o więcej
 *  niż pół minuty. Ta sama wartość napędza linię bieżącej godziny w WeekView
 *  i plakietkę daty/zegara w pasku kalendarza. */
export const NOW_TICK_MS = 30_000;

/**
 * Czysto prezentacyjny zegar: zwraca `Date` odświeżaną co `intervalMs`.
 * Nie dotyka stanu aplikacji ani żadnej ścieżki wskaźnika (inwariant 7).
 */
export function useNowTick(intervalMs: number = NOW_TICK_MS): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
