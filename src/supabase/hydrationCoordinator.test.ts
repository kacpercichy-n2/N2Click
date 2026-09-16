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
});
