// Trasowanie zdarzeń `postgres_changes` żywej synchronizacji (L1-DB-NOTES,
// ryzyko 5). Zmiana wiersza `n2click.notifications` (np. zbiorczy task_message
// podbijany przy każdej wiadomości w rozmowie zadania) nie potrzebuje pełnej
// rehydracji planera: wystarczy dociągnąć powiadomienia odbiorcy
// (`loadNotificationsSnapshot` + `MERGE_CLOUD_NOTIFICATIONS`). Każde inne
// zdarzenie, także nierozpoznany ładunek, idzie dotychczasową pełną ścieżką.
//
// Czyste, bez Reacta i SDK; testy: `liveSyncRoute.test.ts`.

export type LiveSyncRoute = 'notifications' | 'full';

function field(payload: unknown, key: string): string {
  if (payload === null || typeof payload !== 'object') return '';
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}

/** Dokąd skierować zdarzenie Realtime. Wątpliwość = pełna synchronizacja. */
export function liveSyncRouteFor(payload: unknown): LiveSyncRoute {
  return field(payload, 'schema') === 'n2click' && field(payload, 'table') === 'notifications'
    ? 'notifications'
    : 'full';
}

/**
 * Bramka „najnowsze pobranie wygrywa” dla migawek powiadomień. Wczytują je dwie
 * ścieżki: pełna hydracja i lekka synchronizacja powiadomień. Mogą się
 * przeplatać, a odpowiedź pobrania rozpoczętego WCZEŚNIEJ może dojść PÓŹNIEJ.
 * Scalamy wynik tylko wtedy, gdy żadne pobranie rozpoczęte później nie zostało
 * już naniesione; inaczej starsza migawka cofnęłaby świeższy stan.
 */
export interface LatestWins {
  /** Numer pobrania; wołać tuż przed startem fetchu. */
  begin(): number;
  /** true = wolno nanieść wynik (i zapamiętuje go jako naniesiony). */
  claim(ticket: number): boolean;
}

export function createLatestWins(): LatestWins {
  let issued = 0;
  let applied = 0;
  return {
    begin() {
      issued += 1;
      return issued;
    },
    claim(ticket) {
      if (ticket <= applied || ticket > issued) return false;
      applied = ticket;
      return true;
    },
  };
}
