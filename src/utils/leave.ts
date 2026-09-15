// Nieobecności w kalendarzu: URLOP (`kind: 'urlop'`, schodzi z limitu dni) i
// NIEOBECNOŚĆ (`kind: 'nieobecnosc'`, 2026-09-15, zgłoszenie „nieobecności":
// choroba, odbiór godzin, wyjazd — nie jest urlopem odebranym). Obie blokują
// czas osoby dokładnie tak samo (pełna doba albo okno godzinowe), więc każda
// ścieżka, która dotąd pytała `kind === 'urlop'` o ZAJĘTOŚĆ, pyta teraz
// `isLeaveKind`. Różnią się tylko etykietą, ikoną i tym, czy zjadają limit
// urlopu (`accountHr` liczy WYŁĄCZNIE 'urlop').
import type { LeaveKind } from '../types';

export const LEAVE_KINDS: readonly LeaveKind[] = ['urlop', 'nieobecnosc'];

/** Czy rodzaj wydarzenia to nieobecność (urlop albo nieobecność)? */
export function isLeaveKind(kind: unknown): kind is LeaveKind {
  return kind === 'urlop' || kind === 'nieobecnosc';
}

/** Czy wydarzenie jest nieobecnością (bez ustawionego `kind` = spotkanie). */
export function isLeaveEvent(event: { kind?: string }): boolean {
  return isLeaveKind(event.kind);
}

/** Polskie etykiety rodzaju: mianownik („Urlop"), przypadki i gotowe zdania UI. */
export function leaveLabel(kind: LeaveKind): {
  title: string; // „Urlop" / „Nieobecność" — także stały tytuł wydarzenia
  lower: string; // „urlop" / „nieobecność"
  genitive: string; // „urlopu" / „nieobecności"
  accusative: string; // „urlop" / „nieobecność"
  newTitle: string; // „Nowy urlop" / „Nowa nieobecność"
  editTitle: string; // „Edytuj urlop" / „Edytuj nieobecność"
  addLabel: string; // „Dodaj urlop" / „Dodaj nieobecność"
  deleteQuestion: string; // „Usunąć ten urlop?" / „Usunąć tę nieobecność?"
  deleteLabel: string; // „Usuń urlop" / „Usuń nieobecność"
  saveFail: string; // „Nie można zapisać urlopu" / „… nieobecności"
} {
  return kind === 'urlop'
    ? {
        title: 'Urlop',
        lower: 'urlop',
        genitive: 'urlopu',
        accusative: 'urlop',
        newTitle: 'Nowy urlop',
        editTitle: 'Edytuj urlop',
        addLabel: 'Dodaj urlop',
        deleteQuestion: 'Usunąć ten urlop?',
        deleteLabel: 'Usuń urlop',
        saveFail: 'Nie można zapisać urlopu',
      }
    : {
        title: 'Nieobecność',
        lower: 'nieobecność',
        genitive: 'nieobecności',
        accusative: 'nieobecność',
        newTitle: 'Nowa nieobecność',
        editTitle: 'Edytuj nieobecność',
        addLabel: 'Dodaj nieobecność',
        deleteQuestion: 'Usunąć tę nieobecność?',
        deleteLabel: 'Usuń nieobecność',
        saveFail: 'Nie można zapisać nieobecności',
      };
}
