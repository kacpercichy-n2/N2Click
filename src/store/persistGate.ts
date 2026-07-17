// Czysta bramka zapisu lokalnego dla trybu wycofanego (retirement). Decyduje, czy
// dana zmiana stanu MOŻE pominąć per-akcyjny `saveData`, bo została (albo zostanie)
// odzwierciedlona w chmurze. Bezpieczny kierunek to zawsze DODATKOWY zapis —
// nigdy zgubiony: każda wątpliwość => zapisz lokalnie.
//
// GRANICE / INVARIANTS:
//   * `storage.ts` pozostaje jedyną granicą localStorage — znacznik czytamy przez
//     `readCloudRetirementMarker`, nie bezpośrednio.
//   * W trybie lokalnym (`isSupabaseConfigured() === false`) bramka NIGDY nie
//     pomija — stary zbuforowany znacznik jest ignorowany.
//   * Flaga zdrowia lustra jest ustawiana WYŁĄCZNIE przez CloudSyncProvider;
//     każda degradacja (błąd przejściowy, błąd hydracji, wylogowanie, bezczynność)
//     ustawia ją na false, więc zapisy lokalne WZNAWIAJĄ się automatycznie.
import type { AppData } from '../types';
import { isSupabaseConfigured } from '../supabase/config';
import { readCloudRetirementMarker } from './storage';

// Kolekcje mające dom w chmurze (lustro diff-owe + hydracja). Zmiana wyłącznie
// tych kolekcji może pominąć zapis lokalny w trybie wycofanym i zdrowym.
const MIRRORED_KEYS = [
  'clients',
  'projects',
  'milestones',
  'tasks',
  'assignments',
  'workload',
  'comments',
  'activity',
] as const;

// Kolekcje/pola BEZ domu w chmurze — zmiana którejkolwiek MUSI trafić lokalnie
// (wycofanie nie może ich osierocić). Reszta kluczy AppData to właśnie te.
const NON_MIRRORED_KEYS: Array<keyof AppData> = [
  'version',
  'departments',
  'serviceTypes',
  'workCategories',
  'statuses',
  'people',
  'currentUserId',
  'impersonatorId',
  'sampleBannerDismissed',
  'savedFilters',
];

// Runtime flaga zdrowia lustra chmury — prawdziwa TYLKO gdy status === 'ready',
// bez błędu przejściowego, a hydracja bieżącego użytkownika się powiodła.
let cloudMirrorHealthy = false;

export function setCloudMirrorHealthy(healthy: boolean): void {
  cloudMirrorHealthy = healthy;
}

export function isCloudMirrorHealthy(): boolean {
  return cloudMirrorHealthy;
}

/**
 * Czy przejście stanu dotyka WYŁĄCZNIE kolekcji lustrzanych (porównanie po
 * referencji na kolekcję). Zmiana jakiejkolwiek kolekcji/pola bez domu w chmurze
 * => false (trzeba zapisać lokalnie). Referencja przebudowana-ale-równa liczy się
 * jako zmiana — bezpieczny kierunek (dodatkowy zapis, nigdy zgubiony).
 */
export function touchesOnlyMirrored(prev: AppData, next: AppData): boolean {
  for (const key of NON_MIRRORED_KEYS) {
    if (prev[key] !== next[key]) return false;
  }
  return true;
}

/**
 * Zwraca true (pomiń per-akcyjny `saveData`) TYLKO gdy WSZYSTKO zachodzi:
 * 1) zbuforowany znacznik wycofania włączony ORAZ środowisko Supabase
 *    skonfigurowane (tryb lokalny nigdy nie pomija);
 * 2) lustro chmury jest zweryfikowane-zdrowe TERAZ (flaga runtime);
 * 3) przejście dotyka wyłącznie kolekcji lustrzanych.
 * W każdym innym przypadku => false (zapisz lokalnie).
 */
export function shouldSkipLocalPersist(prev: AppData, next: AppData): boolean {
  if (!cloudMirrorHealthy) return false;
  if (!isSupabaseConfigured()) return false;
  if (!readCloudRetirementMarker().enabled) return false;
  return touchesOnlyMirrored(prev, next);
}

// Eksport dla testów/dokumentacji: pełny zbiór kluczy lustrzanych.
export const MIRRORED_COLLECTION_KEYS: ReadonlyArray<keyof AppData> = MIRRORED_KEYS;
