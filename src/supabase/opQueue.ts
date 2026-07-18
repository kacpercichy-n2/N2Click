// Trwała kolejka operacji chmury (czysta, testowalna w node — wzorzec
// hydrationOutcome.ts). CloudSyncProvider jest tylko cienkim adapterem: cała
// logika decyzji (kodowanie/dekodowanie koperty, plan przywrócenia, plan
// dezaktywacji, krok pętli hydracji) żyje TU, aby vitest w trybie node nie
// wymagał Reacta ani jsdom.
//
// GRANICA TRWAŁOŚCI: dotąd niewysłane operacje chmury żyły tylko w pamięci
// (queueRef) i ginęły przy przeładowaniu karty oraz przy przejściu `active`
// -> false. Tu serializujemy je do dedykowanego klucza localStorage (przez
// helpery storage.ts), przywracamy i drenujemy PRZED scaleniem snapshotu, oraz
// kolejkujemy edycje z okna 'hydrating' zamiast je cicho pochłaniać.
//
// Wielozakładkowość (ustalone): last-writer-wins na kluczu jest akceptowalny —
// operacje to idempotentne upserty/remove kluczowane tożsamością wiersza,
// więc powtórna replikacja zbiega się. Brak blokad międzyzakładkowych.
import type { CloudOp } from './cloudMirror';

export const CLOUD_QUEUE_VERSION = 1;

/** Maks. liczba restartów hydracji przy edycjach w locie, zanim poddajemy się. */
export const MAX_HYDRATION_RESTARTS = 5;

export interface CloudQueueEnvelope {
  version: 1;
  userId: string;
  ops: CloudOp[];
}

// ---- Polskie komunikaty (dokładne stałe eksportowane) -----------------------

export const QUEUE_RESTORED_NOTICE =
  'Przywrócono niewysłane zmiany z poprzedniej sesji — wysyłamy je teraz.';
export const QUEUE_HELD_NOTICE =
  'Masz niewysłane zmiany — zachowano je w tej przeglądarce i zostaną wysłane po ponownym zalogowaniu.';
export const QUEUE_FOREIGN_DROPPED =
  'Odrzucono niewysłane zmiany innego użytkownika zapisane w tej przeglądarce.';
export const HYDRATION_RESTART_ERROR =
  'Nie udało się zsynchronizować zmian podczas wczytywania danych. Spróbuj ponownie.';

// ---- Serializacja / walidacja (fail-closed) ---------------------------------

function isValidOp(value: unknown): value is CloudOp {
  if (typeof value !== 'object' || value === null) return false;
  const op = value as Record<string, unknown>;
  if (op.kind !== 'upsert' && op.kind !== 'remove') return false;
  if (typeof op.table !== 'string' || op.table === '') return false;
  if (typeof op.sourceId !== 'string') return false;
  if (typeof op.label !== 'string') return false;
  // upsert niesie `row`, remove niesie `match`; wymagamy właściwego ładunku.
  if (op.kind === 'upsert') {
    if (typeof op.row !== 'object' || op.row === null) return false;
  } else {
    if (typeof op.match !== 'object' || op.match === null) return false;
  }
  return true;
}

/** Koduje kopertę kolejki do JSON-a (do zapisu na dedykowanym kluczu). */
export function encodeQueue(userId: string, ops: CloudOp[]): string {
  const envelope: CloudQueueEnvelope = { version: CLOUD_QUEUE_VERSION, userId, ops };
  return JSON.stringify(envelope);
}

/**
 * Dekoduje surowy JSON koperty. Fail-closed: zły JSON, brak/zła wersja, brak
 * `userId`, brak/niepoprawna tablica `ops` lub JAKAKOLWIEK zniekształcona
 * operacja => null (nie ryzykujemy replikacji śmieci do chmury).
 */
export function decodeQueue(raw: string | null): CloudQueueEnvelope | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const env = parsed as Record<string, unknown>;
  if (env.version !== CLOUD_QUEUE_VERSION) return null;
  if (typeof env.userId !== 'string' || env.userId === '') return null;
  if (!Array.isArray(env.ops)) return null;
  if (!env.ops.every(isValidOp)) return null;
  return { version: CLOUD_QUEUE_VERSION, userId: env.userId, ops: env.ops as CloudOp[] };
}

// ---- Plan przywrócenia przy hydracji -----------------------------------------

export type QueueRestorePlan =
  | { kind: 'restore'; ops: CloudOp[] }
  | { kind: 'discard-foreign-user' }
  | { kind: 'none' };

/**
 * Decyduje, co zrobić z zapisaną kopertą przy logowaniu `userId`:
 * - brak koperty / pusta lista => 'none';
 * - koperta innego użytkownika => 'discard-foreign-user' (odrzucamy — nie
 *   wysyłamy cudzej pracy pod naszym kontem);
 * - koperta tego samego użytkownika z operacjami => 'restore'.
 */
export function planQueueRestore(
  envelope: CloudQueueEnvelope | null,
  userId: string,
): QueueRestorePlan {
  if (!envelope) return { kind: 'none' };
  if (envelope.userId !== userId) return { kind: 'discard-foreign-user' };
  if (envelope.ops.length === 0) return { kind: 'none' };
  return { kind: 'restore', ops: envelope.ops };
}

// ---- Plan dezaktywacji (active -> false) ------------------------------------

export interface DeactivationPlan {
  keepDurable: true;
  notice: string | null;
}

/**
 * Przy dezaktywacji (wylogowanie / utrata snapshotu) NIGDY nie czyścimy kopii
 * trwałej — zostaje do ponownego zalogowania. Gdy były niewysłane operacje,
 * informujemy użytkownika komunikatem.
 */
export function planDeactivation(pendingCount: number): DeactivationPlan {
  return {
    keepDurable: true,
    notice: pendingCount > 0 ? QUEUE_HELD_NOTICE : null,
  };
}

// ---- Krok pętli hydracji -----------------------------------------------------

export type HydrationStep = 'drain' | 'restart' | 'merge' | 'give-up';

/**
 * Jeden krok pętli hydracji po odczycie snapshotu:
 * - są niewysłane operacje => 'drain' (wyślij, zanim scalisz);
 * - stan zmienił się w locie (edycja podczas hydracji) => 'restart'
 *   (przeczytaj snapshot ponownie na świeżym stanie), ale gdy wyczerpano
 *   budżet restartów => 'give-up' (jawny błąd, nie pętla w nieskończoność);
 * - inaczej (obie flagi czyste) => 'merge'.
 * Kolejność priorytetów: drain > (give-up | restart) > merge. 'merge' tylko gdy
 * i pendingOps == 0, i brak zmiany stanu; 'give-up' tylko gdy trwa potrzeba
 * restartu, a restarts >= maxRestarts.
 */
export function planHydrationStep(input: {
  pendingOps: number;
  stateChanged: boolean;
  restarts: number;
  maxRestarts: number;
}): HydrationStep {
  if (input.pendingOps > 0) return 'drain';
  if (input.stateChanged) {
    return input.restarts >= input.maxRestarts ? 'give-up' : 'restart';
  }
  return 'merge';
}
