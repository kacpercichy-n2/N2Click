// Czysta decyzja suppresji lustra danych (testowalna w node — wzorzec
// opQueue.ts / hydrationOutcome.ts). CloudSyncProvider jest tylko cienkim
// adapterem: to TU decyduje się, czy przejście stanu ma być propagowane do
// chmury.
//
// GRANICA: lustro NIE propaguje przejść oznaczonych `origin: 'cloud'` — własnej
// hydracji (MERGE_CLOUD_ENTITIES), zapisów już zlustrzanych gdzie indziej
// (REPLACE_FROM_STORAGE) oraz lokalnych ładowań (LOAD_SAMPLE / RESET_ALL).
// Decyzję niesie METADANA `origin` na akcji, a NIE lista nazw akcji: dowolna
// przyszła akcja hurtowa oznaczona 'cloud' jest suppresowana bez rejestracji
// gdziekolwiek. Brak akcji (`null`) zachowuje dzisiejsze zachowanie: lustrujemy.
import type { ActionOrigin } from '../store/AppStore';

/**
 * Czy przejście stanu wywołane przez ostatnią akcję ma być lustrzane do chmury.
 * `false` wtedy i tylko wtedy, gdy `last?.origin === 'cloud'`. `null` (brak
 * akcji) => `true` (lustrujemy — jak dotąd).
 */
export function shouldMirrorTransition(
  last: { type: string; origin: ActionOrigin } | null,
): boolean {
  return last?.origin !== 'cloud';
}
