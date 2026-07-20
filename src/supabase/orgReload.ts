// Czysta maszyna stanów przeładowania snapshotu organizacji (testowalna w node —
// wzorzec opQueue.ts / mirrorGate.ts / realtimeSync.ts). OrgDataProvider jest
// cienkim adapterem: decyzja „co zrobić ze stanem na starcie i po wyniku
// przeładowania” żyje TU.
//
// GRANICA: przeładowanie na PIERWSZYM planie (login, ręczny retry) migocze przez
// { status: 'loading' } — snapshot znika, co jest w porządku, gdy i tak nie ma
// czym renderować albo użytkownik świadomie ponawia. Ale przeładowanie w TLE
// (wyzwolone zdarzeniem realtime tabeli słownikowej) NIE może zniszczyć
// używalnego snapshotu: gdyby przeszło przez 'loading', snapshot chwilowo → null,
// `active` w CloudSyncProvider migałoby na false (czyszcząc kolejkę w pamięci,
// pokazując notice o niewysłanych zmianach i zrywając kanał), a martwy efekt
// zmiany-snapshotu nigdy by nie odpalił zaplanowanej cichej hydracji. Dlatego w
// tle trzymamy poprzedni 'ready' (stary snapshot), aż nowy się załaduje, i
// podmieniamy atomowo.
import type { OrgSnapshot, OrgState } from './referenceData';

/** Tryb przeładowania: 'foreground' (login/retry) miga 'loading'; 'background'
 * (realtime) zachowuje stary 'ready' do czasu wyniku. */
export type OrgReloadMode = 'foreground' | 'background';

/**
 * Stan na starcie przeładowania. W tle przy gotowym snapshocie — zachowaj go
 * (żadnego migotania na 'loading'). W każdym innym przypadku (pierwszy plan lub
 * brak używalnego snapshotu) — 'loading'.
 */
export function planReloadStart(prev: OrgState, mode: OrgReloadMode): OrgState {
  if (mode === 'background' && prev.status === 'ready') return prev;
  return { status: 'loading' };
}

/** Udane przeładowanie: podmień na nowy snapshot (atomowo, ta sama akcja). */
export function planReloadSuccess(snapshot: OrgSnapshot): OrgState {
  return { status: 'ready', snapshot };
}

/**
 * Błąd przeładowania. W tle przy gotowym snapshocie — zachowaj stary 'ready'
 * (nie niszcz używalnych danych z powodu przejściowej awarii sieci; kanał i tak
 * spadnie na `live=false`, a użytkownik ma ręczny retry/refresh). W pierwszym
 * planie (albo bez używalnego snapshotu) — 'error' (ekran odzyskiwania).
 */
export function planReloadError(
  prev: OrgState,
  mode: OrgReloadMode,
  message: string,
): OrgState {
  if (mode === 'background' && prev.status === 'ready') return prev;
  return { status: 'error', message };
}
