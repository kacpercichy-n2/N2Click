// Rejestr wstrzymań ŻYWEJ synchronizacji (Realtime → pełna hydracja).
// Celowo maleńki i czysty, jak dirtyRegistry: bez Reacta, bez storage.
//
// Powód: autorytatywne scalenie w ŚRODKU przeciągania bloku kalendarza
// podmieniłoby wiersz `WorkloadEntry` pod kursorem — a gdyby chmura go nie
// znała, odmontowałoby komponent trzymający `setPointerCapture`, zostawiając
// przechwycenie wskaźnika bez zwolnienia (invariant 7: cykl życia wskaźnika
// kalendarza/zasobnika jest wrażliwy na stabilność). Odświeżenie W TLE jest
// więc ODRACZANE, nie porzucane: CloudSyncProvider przeplanowuje je tym samym
// debounce'em, aż ostatnia blokada zniknie.
//
// Zakres: wyłącznie odświeżenia w tle. Hydracja startowa, ręczne „Odśwież dane
// z serwera” i ponowienie po błędzie NIE pytają o blokady.
const holds = new Set<object>();

/** Ustawia (lub zdejmuje) blokadę dla interakcji o stabilnym kluczu. */
export function setLiveSyncHold(key: object, held: boolean): void {
  if (held) holds.add(key);
  else holds.delete(key);
}

/** Zapomina interakcję całkowicie (np. przy odmontowaniu komponentu). */
export function clearLiveSyncHold(key: object): void {
  holds.delete(key);
}

/** Czy jakakolwiek interakcja wstrzymuje teraz odświeżanie w tle. */
export function anyLiveSyncHold(): boolean {
  return holds.size > 0;
}

/**
 * Decyzja: czy autorytatywne scalenie W TLE trzeba ODROCZYĆ (przeplanować tym
 * samym debounce'em), bo świat zmienił się od chwili zaplanowania synca.
 *
 * Sprawdzana DWUKROTNIE: przed startem pobierania snapshotu ORAZ ponownie po
 * każdym `await`, tuż przed dispatchem scalenia. Blokada wstrzymań jest
 * migawką z momentu wywołania — szybkie przeciągnięcie karty (chwyć–puść w pół
 * sekundy) potrafi w całości zmieścić się w oknie fetcha, więc kontrola tylko
 * na starcie przepuszczała snapshot sprzed upuszczenia i karta wracała na
 * bazową pozycję.
 *
 * `mirrorPending` = stan wyprzedza lustro (prevRef !== state): lokalna edycja
 * jest już w reduktorze, ale jej diff nie trafił jeszcze do kolejki. Scalenie
 * w tym oknie nadpisałoby ją wizualnie, a przy zbiegu z tłumioną akcją
 * scalenia (reset bazy diffa) — trwale.
 *
 * `wroteSinceFetch` = lustro WYPCHNĘŁO do chmury jakąś lokalną zmianę PO
 * starcie pobierania snapshotu (epoka zapisów lustra z chwili fetcha różni się
 * od bieżącej). Snapshot liczono w bazie ZANIM ten zapis tam dotarł, więc mimo
 * pustej kolejki i czystego lustra jest STARSZY od stanu lokalnego: jego
 * scalenie cofałoby np. świeżo odhaczony blok („wykonane” z prawego kliku) do
 * stanu sprzed kliknięcia, a zdarzenie Realtime własnego zapisu przywracało go
 * dopiero w następnym przebiegu (migotanie zielony → niebieski → zielony,
 * 2026-09-16). Odraczamy: kolejny przebieg pobierze snapshot, który ten zapis
 * już zawiera. Kontrola PRZED fetchem pomija pole (nic nie mogło się jeszcze
 * zestarzeć).
 */
export function shouldDeferBackgroundMerge(world: {
  held: boolean;
  processing: boolean;
  queuedOps: number;
  mirrorPending: boolean;
  wroteSinceFetch?: boolean;
}): boolean {
  return (
    world.held ||
    world.processing ||
    world.queuedOps > 0 ||
    world.mirrorPending ||
    world.wroteSinceFetch === true
  );
}
