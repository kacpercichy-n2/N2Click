// Koordynator hydracji — czysty. Odwzorowuje dwie gonitwy z 2026-09-16
// (migotanie „wykonane” po prawym kliku) i cykl życia odłożonego zdarzenia.
import { beforeEach, describe, expect, it } from 'vitest';
import { createHydrationCoordinator, type HydrationCoordinator } from './hydrationCoordinator';

let coord: HydrationCoordinator;

beforeEach(() => {
  coord = createHydrationCoordinator();
});

describe('epoka zapisów lustra', () => {
  it('zapis wypchnięty PO zapamiętaniu epoki znaczy snapshot starszy od stanu', () => {
    // Gonitwa 1: fetch snapshotu rusza, w jego oknie prawy klik „wykonane”
    // wychodzi do chmury i zdąża się potwierdzić (kolejka pusta), a snapshot
    // liczono przed nim.
    const atFetch = coord.writeEpoch();
    coord.noteLocalWrite();
    expect(coord.wroteSince(atFetch)).toBe(true);
  });

  it('bez zapisu od zapamiętania snapshot jest aktualny', () => {
    const atFetch = coord.writeEpoch();
    expect(coord.wroteSince(atFetch)).toBe(false);
  });

  it('zapis sprzed zapamiętania nie unieważnia snapshotu (jest już w bazie)', () => {
    coord.noteLocalWrite();
    const atFetch = coord.writeEpoch();
    expect(coord.wroteSince(atFetch)).toBe(false);
  });

  it('kolejny przebieg zapamiętuje bieżącą epokę — brak lepkiego odroczenia', () => {
    const first = coord.writeEpoch();
    coord.noteLocalWrite();
    expect(coord.wroteSince(first)).toBe(true);
    const second = coord.writeEpoch();
    expect(coord.wroteSince(second)).toBe(false);
  });
});

describe('przebiegi hydracji', () => {
  it('begin czyni przebieg bieżącym i podnosi flagę w locie', () => {
    expect(coord.inFlight()).toBe(false);
    expect(coord.latestRun()).toBe(0);
    const run = coord.begin();
    expect(coord.isCurrent(run)).toBe(true);
    expect(coord.latestRun()).toBe(run);
    expect(coord.inFlight()).toBe(true);
  });

  it('nowszy przebieg wypiera starszy: starszy nie jest bieżący i nie zwalnia flagi', () => {
    // Gonitwa 2: dwie hydracje w tle; starsza rozstrzyga się PO nowszej.
    const older = coord.begin();
    const newer = coord.begin();
    expect(coord.isCurrent(older)).toBe(false);
    expect(coord.isCurrent(newer)).toBe(true);
    // Spóźniony `finally` starszego nie ma prawa zdjąć flagi spod nowszego.
    expect(coord.release(older)).toBe(false);
    expect(coord.inFlight()).toBe(true);
    expect(coord.release(newer)).toBe(true);
    expect(coord.inFlight()).toBe(false);
  });

  it('zwolnienie bieżącego jest idempotentne (po scaleniu planera i w finally)', () => {
    const run = coord.begin();
    expect(coord.release(run)).toBe(true);
    expect(coord.inFlight()).toBe(false);
    expect(coord.release(run)).toBe(true);
    expect(coord.inFlight()).toBe(false);
  });

  it('po zwolnieniu przebieg zostaje bieżącym, dopóki nie ruszy następny', () => {
    const run = coord.begin();
    coord.release(run);
    expect(coord.isCurrent(run)).toBe(true);
    coord.begin();
    expect(coord.isCurrent(run)).toBe(false);
  });
});

describe('odłożone zdarzenie Realtime', () => {
  it('park + takeParked zdejmuje zdarzenie dokładnie raz', () => {
    coord.park();
    coord.park();
    expect(coord.takeParked()).toBe(true);
    expect(coord.takeParked()).toBe(false);
  });

  it('bez park nic nie czeka', () => {
    expect(coord.takeParked()).toBe(false);
  });

  it('zwolnienie po scaleniu planera, ponowne odłożenie, zwolnienie w finally: jedno zdjęcie', () => {
    // Odświeżenie ręczne: pierwsze zwolnienie przeplanowuje odłożone zdarzenie,
    // performLiveSync odkłada je ponownie (status jeszcze 'hydrating'),
    // `finally` zwalnia raz jeszcze i zdejmuje je dokładnie raz.
    const run = coord.begin();
    coord.park();
    expect(coord.release(run)).toBe(true);
    expect(coord.takeParked()).toBe(true);
    coord.park();
    expect(coord.release(run)).toBe(true);
    expect(coord.takeParked()).toBe(true);
    expect(coord.takeParked()).toBe(false);
  });

  it('spóźniony finally wyprzedzonego przebiegu nie zdejmuje zdarzenia odłożonego pod nowszy', () => {
    // A zwalnia po scaleniu planera, B rusza w oknie loaderów pomocniczych A,
    // zdarzenie zostaje odłożone pod B; `finally` A nie ma prawa go zdjąć.
    const a = coord.begin();
    expect(coord.release(a)).toBe(true);
    const b = coord.begin();
    coord.park();
    expect(coord.release(a)).toBe(false);
    expect(coord.release(b)).toBe(true);
    expect(coord.takeParked()).toBe(true);
    expect(coord.takeParked()).toBe(false);
  });
});

describe('rezerwacje rodzin pomocniczych', () => {
  it('starszy wynik ląduje, gdy jest najświeższym znanym; spóźniony po nowszym odpada', () => {
    const a = coord.begin();
    const b = coord.begin();
    // Wynik A (wyprzedzonego) przychodzi pierwszy — wciąż najświeższy znany.
    expect(coord.claim('notifications', a)).toBe(true);
    expect(coord.claim('notifications', b)).toBe(true);
    // Gdyby A dosłał raz jeszcze (albo przyszedł po B) — cofnąłby B: odpada.
    expect(coord.claim('notifications', a)).toBe(false);
  });

  it('seria odświeżeń nie głodzi rodziny: każdy pierwszy wynik po ostatnim scaleniu ląduje', () => {
    const runs = [coord.begin(), coord.begin(), coord.begin()];
    // Powiadomienia z pierwszego przebiegu docierają, gdy trzeci już ruszył.
    expect(coord.claim('contentPlan', runs[0]!)).toBe(true);
    expect(coord.claim('contentPlan', runs[2]!)).toBe(true);
    expect(coord.claim('contentPlan', runs[1]!)).toBe(false);
  });

  it('rodziny są niezależne', () => {
    const a = coord.begin();
    const b = coord.begin();
    expect(coord.claim('notifications', b)).toBe(true);
    expect(coord.claim('contentPlan', a)).toBe(true);
    expect(coord.claim('notifications', a)).toBe(false);
  });
});
