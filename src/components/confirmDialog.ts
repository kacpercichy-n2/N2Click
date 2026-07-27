// Czysta logika okna potwierdzenia (zamiennik `window.confirm`). Zero DOM-u,
// zero Reacta — wejściem są liczniki i lekkie deskryptory żądań, więc całość
// testuje się w środowisku `node` (vitest.config.ts). Cienką warstwę React/DOM
// trzyma `ConfirmProvider.tsx`, dokładnie jak `modalShell.ts` ↔ `useModalShell.ts`.

import { polishAmount, polishCount } from '../utils/polishPlural';

/** Wydźwięk okna: `danger` maluje przycisk potwierdzenia na czerwono. */
export type ConfirmTone = 'default' | 'danger';

/** Opcje jednego pytania. Wszystkie teksty są polskie i widoczne dla użytkownika. */
export interface ConfirmOptions {
  /** Pytanie w nagłówku dialogu (`aria-labelledby`). */
  title: string;
  /** Doprecyzowanie pytania (opcjonalne). */
  description?: string;
  /** Zdanie o SKUTKACH operacji — cel `aria-describedby`. */
  consequences?: string;
  /** Etykieta przycisku potwierdzającego; domyślnie „Potwierdź”. */
  confirmLabel?: string;
  /** Etykieta przycisku anulującego; domyślnie „Anuluj”. */
  cancelLabel?: string;
  /** `danger` tylko dla operacji nieodwracalnych. */
  tone?: ConfirmTone;
  /**
   * Wymuszony świadomy checkbox przed potwierdzeniem. TYLKO tam, gdzie giną
   * prawdziwe dane (kaskadowe usunięcie klienta, usunięcie zadania z godzinami).
   * NIGDY przy „porzucić niezapisane zmiany”.
   */
  requireAck?: boolean;
  /** Etykieta checkboxa `requireAck`; domyślnie zdanie o nieodwracalności. */
  ackLabel?: string;
}

export const DEFAULT_CONFIRM_LABEL = 'Potwierdź';
export const DEFAULT_CANCEL_LABEL = 'Anuluj';
export const DEFAULT_ACK_LABEL = 'Rozumiem, że tej operacji nie można cofnąć.';

/** Przycisk potwierdzenia jest zablokowany, dopóki wymagany checkbox nie jest zaznaczony. */
export function confirmIsBlocked(options: ConfirmOptions, acknowledged: boolean): boolean {
  return options.requireAck === true && !acknowledged;
}

// ---------------------------------------------------------------------------
// Treść skutków
// ---------------------------------------------------------------------------

/**
 * Liczniki kaskady. Wszystkie POCHODZĄ z selektorów (`src/store/selectors.ts`);
 * ten moduł nigdy nie wylicza ich sam — godziny żyją wyłącznie w
 * `WorkloadEntry` (inwariant 1) i tu trafiają już zsumowane.
 */
export interface ConfirmConsequences {
  projects?: number;
  tasks?: number;
  assignments?: number;
  /** Suma `plannedHours` — może być ułamkiem (siatka 0,25 h). */
  plannedHours?: number;
}

/** „a”, „a i b”, „a, b i c” — polskie wyliczenie bez przecinka przed „i”. */
export function joinPolishList(parts: string[]): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} i ${parts[parts.length - 1]}`;
}

/**
 * Zdanie o skutkach usunięcia, np. „To usunie 3 przypisania i 12 zaplanowanych
 * godzin.”. Pusty łańcuch, gdy nie ma czego wymienić — wtedy pytanie zostaje
 * jednoklikowe, bez wymyślania nieistniejących konsekwencji.
 *
 * Forma „To usunie …” (a nie „Usunięte zostaną …”) jest celowa: zdanie
 * podrzędne z liczebnikiem NIE wymaga uzgodnienia rodzaju ani liczby czasownika,
 * więc jest poprawne dla każdej kombinacji liczników („To usunie 1 przypisanie”,
 * „To usunie 2,5 zaplanowanej godziny”).
 */
export function buildDeleteConsequence(counts: ConfirmConsequences): string {
  const parts: string[] = [];
  const add = (n: number | undefined, one: string, few: string, many: string) => {
    if (n === undefined || !Number.isFinite(n) || n <= 0) return;
    parts.push(`${n} ${polishCount(n, one, few, many)}`);
  };

  add(counts.projects, 'projekt', 'projekty', 'projektów');
  add(counts.tasks, 'zadanie', 'zadania', 'zadań');
  add(counts.assignments, 'przypisanie', 'przypisania', 'przypisań');

  const hours = counts.plannedHours;
  if (hours !== undefined && Number.isFinite(hours) && hours > 0) {
    parts.push(
      polishAmount(hours, {
        one: 'zaplanowaną godzinę',
        few: 'zaplanowane godziny',
        many: 'zaplanowanych godzin',
        fraction: 'zaplanowanej godziny',
      }),
    );
  }

  if (parts.length === 0) return '';
  return `To usunie ${joinPolishList(parts)}.`;
}

// ---------------------------------------------------------------------------
// Kolejka żądań
// ---------------------------------------------------------------------------

/**
 * Jedno żądanie w kolejce. `resolve` to domknięcie obietnicy zwróconej przez
 * `useConfirm()` — trzymamy je W STANIE (a nie w mapie po stronie Reacta),
 * dzięki czemu „dwa potwierdzenia pod rząd rozstrzygają się niezależnie” daje
 * się przetestować bez renderowania.
 */
export interface ConfirmEntry {
  id: number;
  options: ConfirmOptions;
  resolve: (result: boolean) => void;
}

export interface ConfirmQueueState {
  /** Kolejka FIFO; element 0 jest AKTYWNY (widoczny w dialogu). */
  entries: readonly ConfirmEntry[];
  nextId: number;
}

export function emptyConfirmQueue(): ConfirmQueueState {
  return { entries: [], nextId: 1 };
}

/** Aktywne żądanie albo `null`, gdy nie ma o co pytać. */
export function activeConfirm(state: ConfirmQueueState): ConfirmEntry | null {
  return state.entries.length > 0 ? state.entries[0] : null;
}

/**
 * Dokłada żądanie na KONIEC kolejki. Drugie pytanie zadane w trakcie pierwszego
 * czeka — nigdy nie podmienia treści aktywnego dialogu.
 */
export function enqueueConfirm(
  state: ConfirmQueueState,
  options: ConfirmOptions,
  resolve: (result: boolean) => void,
): ConfirmQueueState {
  return {
    entries: [...state.entries, { id: state.nextId, options, resolve }],
    nextId: state.nextId + 1,
  };
}

/** Wynik rozstrzygnięcia: nowy stan i (jeśli było co zamknąć) zdjęty wpis. */
export interface ConfirmResolution {
  state: ConfirmQueueState;
  resolved: ConfirmEntry | null;
}

/**
 * Zdejmuje żądanie o danym `id`. Nieznane `id` (podwójne kliknięcie, spóźniony
 * handler) zwraca TĘ SAMĄ referencję stanu i `resolved: null`, więc obietnica
 * nie może zostać rozstrzygnięta dwa razy. Samo wywołanie `resolve` zostaje po
 * stronie wołającego — ten moduł jest czysty.
 */
export function resolveConfirm(state: ConfirmQueueState, id: number): ConfirmResolution {
  const index = state.entries.findIndex((entry) => entry.id === id);
  if (index === -1) return { state, resolved: null };
  const resolved = state.entries[index];
  const entries = state.entries.filter((_, i) => i !== index);
  return { state: { entries, nextId: state.nextId }, resolved };
}

/**
 * Awaryjne opróżnienie kolejki (odmontowanie dostawcy). Zwraca zdjęte wpisy,
 * żeby wołający rozstrzygnął KAŻDĄ wiszącą obietnicę na `false` — inaczej
 * `await confirm(...)` nigdy by nie wrócił. Pusta kolejka zwraca tę samą
 * referencję.
 */
export function drainConfirms(state: ConfirmQueueState): {
  state: ConfirmQueueState;
  drained: readonly ConfirmEntry[];
} {
  if (state.entries.length === 0) return { state, drained: [] };
  return { state: { entries: [], nextId: state.nextId }, drained: state.entries };
}
