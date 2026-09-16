// Koordynator hydracji chmury. Czysty i testowalny w node (bez Reacta, bez
// klienta Supabase) — jak createLiveTracker. Trzyma trzy rzeczy, które
// CloudSyncProvider musi uzgadniać między asynchronicznymi przebiegami:
//
// 1. EPOKĘ ZAPISÓW LUSTRA — rośnie przy każdym wypchnięciu lokalnej zmiany do
//    kolejki chmury (`noteLocalWrite`). Hydracja w tle zapamiętuje ją tuż
//    przed fetchem snapshotu (`writeEpoch`) i pyta `wroteSince` przed
//    scaleniem: różnica znaczy, że snapshot liczono w bazie PRZED zapisem,
//    który od tego czasu wyszedł i zwykle zdążył się potwierdzić (kolejka
//    pusta, lustro czyste — starsze straże go nie widziały). Scalenie takiego
//    snapshotu cofało świeżo odhaczony blok / ukończone zadanie do stanu sprzed
//    kliknięcia, a własne zdarzenie Realtime przywracało je w następnym
//    przebiegu: migotanie zielony → niebieski → zielony, czasem „trzeba
//    kliknąć dwa razy” (2026-09-16).
// 2. NUMER PRZEBIEGU i flagę „w locie” — odświeżenie w tle nie zrzuca statusu
//    do 'hydrating', więc sam status nie rozdzielał DWÓCH równoległych
//    hydracji; starsza (fetch sprzed zapisu) potrafiła rozstrzygnąć się PO
//    nowszej i nadpisać jej wynik starym snapshotem aż do kolejnego zdarzenia.
//    `begin` czyni nowy przebieg bieżącym; porzucony pyta `isCurrent` po każdym
//    `await` i wycofuje się bez scalania. Flagę zwalnia WYŁĄCZNIE bieżący
//    przebieg (`release`), więc spóźniony `finally` starszego nie zdejmie jej
//    spod nowszego. Zwolnienie jest idempotentne — provider zwalnia zaraz po
//    scaleniu planera (sekcja krytyczna) i ponownie w `finally`.
// 3. ODŁOŻONE zdarzenie Realtime (`park` / `takeParked`) — gdy sync nie może
//    ruszyć (drenaż kolejki, hydracja w locie, status poza 'ready'), zdarzenie
//    czeka; ogon drenażu albo hydracji zdejmuje je i przeplanowuje. Jedno
//    miejsce na wszystkie odłożone zdarzenia (debounce i tak je zlewa).
// 4. REZERWACJE rodzin pomocniczych (`claim`) — powiadomienia i Content Plan
//    ładują się PO zwolnieniu flagi, więc nowszy przebieg może wyprzedzić
//    starszy w ich oknie. Gdyby wynik wyprzedzonego przebiegu był po prostu
//    odrzucany, seria odświeżeń w tle (co ~2 s przy powiadomieniach po ~3 s)
//    głodziłaby te rodziny bez końca. Zamiast tego każda rodzina pamięta numer
//    przebiegu, który ją ostatnio scalił: starszy wynik wciąż ląduje, jeśli
//    jest najświeższym znanym, a spóźniony (nowszy już scalił) odpada — bez
//    cofania nowszego i bez głodzenia.

export interface HydrationCoordinator {
  /** Lokalna zmiana wyszła do kolejki chmury. */
  noteLocalWrite(): void;
  /** Epoka zapisów do zapamiętania tuż przed fetchem snapshotu. */
  writeEpoch(): number;
  /** Czy od zapamiętanej epoki wyszedł jakiś zapis (snapshot starszy od stanu). */
  wroteSince(epoch: number): boolean;
  /** Start przebiegu hydracji: zwraca jego numer, poprzedni przestaje być bieżący. */
  begin(): number;
  /** Numer ostatniego rozpoczętego przebiegu (0 = żaden). */
  latestRun(): number;
  /** Czy przebieg o tym numerze wciąż jest bieżący. */
  isCurrent(run: number): boolean;
  /** Czy jakaś hydracja jest w locie (między `begin` a `release` bieżącego). */
  inFlight(): boolean;
  /** Zwalnia flagę „w locie” — tylko dla bieżącego przebiegu. Zwraca, czy zwolniono. */
  release(run: number): boolean;
  /** Odkłada zdarzenie Realtime, którego nie można teraz obsłużyć. */
  park(): void;
  /** Zdejmuje odłożone zdarzenie (jeśli było); wołający ma je przeplanować. */
  takeParked(): boolean;
  /**
   * Rezerwuje scalenie rodziny pomocniczej dla przebiegu `run`: true, gdy
   * żaden przebieg o numerze >= `run` jeszcze jej nie scalił (wynik ląduje),
   * false, gdy nowszy (albo ten sam) już ją scalił — spóźniony wynik cofnąłby
   * świeższy.
   */
  claim(family: string, run: number): boolean;
}

export function createHydrationCoordinator(): HydrationCoordinator {
  let epoch = 0;
  let run = 0;
  let flying = false;
  let parked = false;
  const claimed = new Map<string, number>();
  return {
    noteLocalWrite: () => {
      epoch += 1;
    },
    writeEpoch: () => epoch,
    wroteSince: (at) => at !== epoch,
    begin: () => {
      run += 1;
      flying = true;
      return run;
    },
    latestRun: () => run,
    isCurrent: (r) => r === run,
    inFlight: () => flying,
    release: (r) => {
      if (r !== run) return false;
      flying = false;
      return true;
    },
    park: () => {
      parked = true;
    },
    takeParked: () => {
      const had = parked;
      parked = false;
      return had;
    },
    claim: (family, r) => {
      if (r <= (claimed.get(family) ?? 0)) return false;
      claimed.set(family, r);
      return true;
    },
  };
}
