// Powody, dla których zapis zadania NIE przejdzie (IA-12).
//
// Czysta funkcja: te same bramki, które sprawdza `TaskEditor.formValid`, ale
// zamiast jednego boolean-a zwracają listę konkretnych przyczyn z kotwicą DOM.
// Dzięki temu „Zapisz i zamknij” nigdy nie jest martwy: nieudany zapis może
// przewinąć do pierwszego złego pola, wypisać powody przy przycisku i pozwolić
// odznace zapisu skoczyć do przyczyny.
//
// Kolejność listy = kolejność w formularzu i JEDNOCZEŚNIE priorytet fokusa
// (pierwszy element to pole, do którego skacze nieudany zapis).
import { MAX_TASK_PERIOD_DAYS, type PeriodError } from '../utils/dates';

export type SaveBlockerId = 'title' | 'project' | 'status' | 'period' | 'assignees' | 'other';

export interface SaveBlocker {
  /** Stabilny klucz (testy + React key). */
  id: SaveBlockerId;
  /** Polski, krótki powód pokazywany przy przycisku zapisu. */
  message: string;
  /** `id` pola, do którego skacze fokus; `null` = brak kotwicy w DOM. */
  focusId: string | null;
  /** Nazwa pola do JEDNEGO liczonego podsumowania („popraw 2 pola: Tytuł,
   *  Okres.”); `null` = przyczyna bez własnego pola. JEDYNE źródło etykiet. */
  fieldLabel: string | null;
}

/** Etykiety pól do podsumowania — po jednej na `SaveBlockerId`. */
const BLOCKER_FIELD_LABELS: Record<SaveBlockerId, string | null> = {
  title: 'Tytuł',
  project: 'Projekt',
  status: 'Status',
  period: 'Okres',
  assignees: 'Osoby',
  other: null,
};

/** Krótkie etykiety „przy przycisku” — celowo zwięźlejsze niż inline'owe
 *  PERIOD_ERROR_LABELS (te zostają pod polami okresu bez zmian). */
const PERIOD_BLOCKER_LABELS: Record<PeriodError, string> = {
  'missing-start': 'Okres: podaj datę startu.',
  'invalid-start': 'Okres: data startu jest nieprawidłowa.',
  'missing-end': 'Okres: podaj datę końca.',
  'invalid-end': 'Okres: data końca jest nieprawidłowa.',
  reversed: 'Okres: data końca nie może być wcześniejsza niż start.',
  'too-long': `Okres: maksymalnie ${MAX_TASK_PERIOD_DAYS} dni.`,
};

/** Które pole okresu jest winne — start tylko wtedy, gdy to on jest zły. */
function periodFocusId(error: PeriodError): string {
  return error === 'missing-start' || error === 'invalid-start' ? 't-start' : 't-end';
}

/**
 * Które pola okresu oznaczyć jako `aria-invalid`. Błąd POJEDYNCZEJ daty wskazuje
 * jedno pole, a błąd ZAKRESU (`reversed` / `too-long`) oba — żadna z dat nie jest
 * sama w sobie zła, złe jest ich zestawienie, więc czytnik musi wskazać obie
 * (jeden współdzielony opis: `t-period-error`).
 */
export function periodInvalidTargets(error: PeriodError): { start: boolean; end: boolean } {
  if (error === 'missing-start' || error === 'invalid-start') return { start: true, end: false };
  if (error === 'missing-end' || error === 'invalid-end') return { start: false, end: true };
  return { start: true, end: true };
}

export interface SaveBlockerInput {
  /** Surowa wartość pola tytułu (funkcja sama trimuje). */
  title: string;
  /** Czy wybrany projekt istnieje w stanie. */
  projectValid: boolean;
  /** Czy w ogóle są jakieś projekty (inna rada dla użytkownika). */
  hasProjects: boolean;
  /** Czy wybrany status istnieje w stanie. */
  statusValid: boolean;
  /** Wynik `periodError(startDate, endDate, { maxDays: 92 })`. */
  period: PeriodError | null;
  /** Czy wszystkie przypisane osoby nadal istnieją. */
  assigneesValid: boolean;
  /** Wynik `isValidTaskDraft` — łapie resztę bramek reduktora (np. szacunek). */
  draftValid: boolean;
}

/**
 * Lista blokad zapisu. Pusta lista === zapis przejdzie przez reduktor
 * (invariant 6: niepoprawny payload i tak zwróciłby ten sam stan, więc nigdy
 * go nie wysyłamy). `other` jest siatką bezpieczeństwa: gdy reduktor odrzuca
 * draft z powodu, którego nie umiemy nazwać, użytkownik i tak dostaje komunikat
 * zamiast martwego przycisku.
 */
export function collectTaskSaveBlockers(input: SaveBlockerInput): SaveBlocker[] {
  // Etykieta pola dokłada się na końcu z JEDNEJ mapy, żeby nie dało się jej
  // pominąć ani rozjechać z `id` przy dodaniu nowej przyczyny.
  const blockers: Array<Omit<SaveBlocker, 'fieldLabel'>> = [];

  if (input.title.trim() === '') {
    blockers.push({ id: 'title', message: 'Tytuł: wpisz nazwę zadania.', focusId: 't-title' });
  }
  if (!input.projectValid) {
    blockers.push(
      input.hasProjects
        ? { id: 'project', message: 'Projekt: wybierz projekt zadania.', focusId: 't-project' }
        : { id: 'project', message: 'Projekt: najpierw utwórz projekt.', focusId: null },
    );
  }
  if (!input.statusValid) {
    blockers.push({ id: 'status', message: 'Status: wybierz istniejący status.', focusId: 't-status' });
  }
  if (input.period !== null) {
    blockers.push({
      id: 'period',
      message: PERIOD_BLOCKER_LABELS[input.period],
      focusId: periodFocusId(input.period),
    });
  }
  if (!input.assigneesValid) {
    blockers.push({
      id: 'assignees',
      message: 'Osoby: jedna z przypisanych osób już nie istnieje — odepnij ją.',
      focusId: 't-assignees',
    });
  }
  if (!input.draftValid && blockers.length === 0) {
    blockers.push({
      id: 'other',
      message: 'Formularz zawiera nieprawidłowe dane — popraw zaznaczone pola.',
      focusId: null,
    });
  }

  return blockers.map((b) => ({ ...b, fieldLabel: BLOCKER_FIELD_LABELS[b.id] }));
}
