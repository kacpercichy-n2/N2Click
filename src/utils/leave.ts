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

/** Polskie etykiety rodzaju: mianownik („Urlop") i przypadki do zdań. */
export function leaveLabel(kind: LeaveKind): {
  title: string; // „Urlop" / „Nieobecność" — także stały tytuł wydarzenia
  lower: string; // „urlop" / „nieobecność"
  genitive: string; // „urlopu" / „nieobecności"
  accusative: string; // „urlop" / „nieobecność"
} {
  return kind === 'urlop'
    ? { title: 'Urlop', lower: 'urlop', genitive: 'urlopu', accusative: 'urlop' }
    : { title: 'Nieobecność', lower: 'nieobecność', genitive: 'nieobecności', accusative: 'nieobecność' };
}
