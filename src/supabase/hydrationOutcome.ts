// Czysta decyzja o wyniku hydracji planera (bez Reacta, testowalna w node).
//
// GRANICA: dawniej CloudSyncProvider ustawiał status 'ready' BEZWARUNKOWO po
// dispatchu MERGE_CLOUD_ENTITIES. Gdy reduktor odrzucił ładunek (fail-closed,
// inwariant 6 — zwraca TĘ SAMĄ referencję stanu), organizacja widziała cichy
// „zdrowy” brak zmian zamiast błędu. Ta funkcja liczy wynik hydracji z czystego
// reduktora: odrzucenie wykrywamy po niezmienionej referencji stanu.
import type { AppData } from '../types';
import { reducer } from '../store/AppStore';
import type { CloudMergePayload, LoadPlannerResult } from './plannerData';

/** Polski komunikat, gdy scalenie zostało odrzucone (dane lokalne bez zmian). */
export const HYDRATION_MERGE_REJECTED =
  'Nie udało się scalić danych z serwera — dane lokalne pozostały bez zmian. Odśwież, aby spróbować ponownie.';

export type HydrationOutcome =
  | { status: 'error'; error: string }
  | { status: 'ready'; payload: CloudMergePayload };

/**
 * Decyduje o wyniku hydracji z rezultatu snapshotu. Błąd wczytania => 'error' z
 * jego komunikatem. W przeciwnym razie liczy scalenie czystym reduktorem: jeśli
 * MERGE_CLOUD_ENTITIES odrzucił ładunek (wynik === stan wejściowy — ta sama
 * referencja), zwraca 'error' z HYDRATION_MERGE_REJECTED; inaczej 'ready' z
 * ładunkiem do zadispatchowania. Poprawny (nawet pusty) ładunek zawsze daje nową
 * referencję stanu, więc odrzucenie jest wykrywalne jednoznacznie.
 */
export function planHydrationOutcome(
  before: AppData,
  result: LoadPlannerResult,
): HydrationOutcome {
  if (!result.ok) return { status: 'error', error: result.error };
  const merged = reducer(before, { type: 'MERGE_CLOUD_ENTITIES', payload: result.payload });
  if (merged === before) return { status: 'error', error: HYDRATION_MERGE_REJECTED };
  return { status: 'ready', payload: result.payload };
}
