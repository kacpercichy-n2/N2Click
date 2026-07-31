// Polskie komunikaty o kolizji terminu wydarzenia. Czysto: żadnego importu
// store'u, wszystkie dane wchodzą jawnie — tak jak w `blockLabel.ts` — więc
// testuje się bez Reacta i bez DOM-u (środowisko `node`).
//
// Dwa progi, dwa komunikaty (patrz `eventDraftConflicts` w selectors.ts):
//  - uczestnicy IMIENNI => komunikat BLOKUJĄCY, mówi kto i czym jest zajęty,
//  - wydarzenie OGÓLNOFIRMOWE => komunikat OSTRZEGAJĄCY, sam licznik osób.
//
// Zakresy godzin piszemy zwykłym łącznikiem („9:00-10:00"). Myślnik i półpauza
// są zabronione w tekstach widocznych dla użytkownika.

import { formatMinutes } from './time';

/**
 * Minimalny, STRUKTURALNY kształt kolizji. Celowo nie importujemy
 * `ScheduleConflict` z selectors.ts — `src/utils/*` nie zależy od store'u.
 * `ScheduleConflict` jest z tym zgodny.
 */
export interface ConflictLike {
  kind: 'block' | 'event' | 'recurrence';
  /** Nazwa osoby; '' = nieznana. */
  personName: string;
  /** Tytuł zadania/wydarzenia; '' = nieznany. */
  title: string;
  startMinutes: number;
  durationMinutes: number;
  /** Do policzenia RÓŻNYCH osób w ostrzeżeniu. */
  personId: string;
}

/** Ile kolizji wymieniamy z nazwy, zanim przejdziemy na „i N więcej". */
const MAX_LISTED = 2;

const KIND_NOUN: Record<ConflictLike['kind'], string> = {
  block: 'zadanie',
  event: 'wydarzenie',
  recurrence: 'zadanie cykliczne',
};

/**
 * Odmiana rzeczownika „osoba" przez liczebnik, wraz z formą czasownika:
 * 1 osoba ma / 2,3,4 osoby mają / 5+ osób ma.
 *
 * Liczba pojedyncza dotyczy WYŁĄCZNIE dokładnie jednego — 21 to „21 osób ma",
 * nie „21 osoba ma" (liczebniki kończące się na 1 poza samą jedynką biorą
 * dopełniacz mnogi). Forma „osoby mają" wraca dla końcówek 2-4 z wyjątkiem
 * nastek: 22 => „22 osoby mają", ale 12 => „12 osób ma".
 */
export function peopleCountPhrase(count: number): string {
  const abs = Math.abs(Math.trunc(count));
  const last = abs % 10;
  const lastTwo = abs % 100;
  if (abs === 1) return '1 osoba ma';
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return `${abs} osoby mają`;
  return `${abs} osób ma`;
}

/**
 * Odmiana „kolejna kolizja" przez liczebnik: 1 kolejna kolizja / 2,3,4 kolejne
 * kolizje / 5+ kolejnych kolizji. Ta sama reguła co w {@link peopleCountPhrase}:
 * pojedyncza tylko dla dokładnie 1, nastki na dopełniaczu.
 */
export function extraConflictsPhrase(count: number): string {
  const abs = Math.abs(Math.trunc(count));
  const last = abs % 10;
  const lastTwo = abs % 100;
  if (abs === 1) return '1 kolejna kolizja';
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return `${abs} kolejne kolizje`;
  return `${abs} kolejnych kolizji`;
}

/** „Ola Nowak ma już zadanie „Regresja QA" 10:30-12:00". */
function describeOne(c: ConflictLike): string {
  const who = c.personName.trim() === '' ? 'Ta osoba' : c.personName.trim();
  const noun = KIND_NOUN[c.kind];
  const from = formatMinutes(c.startMinutes);
  const to = formatMinutes(c.startMinutes + c.durationMinutes);
  const named = c.title.trim() === '' ? noun : `${noun} „${c.title.trim()}"`;
  return `${who} ma już ${named} ${from}-${to}`;
}

/**
 * Komunikat BLOKUJĄCY zapis wydarzenia. `''` dla pustej listy — wywołujący nie
 * pokazuje wtedy niczego. Wymienia z nazwy do {@link MAX_LISTED} kolizji, żeby
 * zdanie zostało czytelne przy zajętym zespole; resztę zbiera licznikiem.
 */
export function eventConflictBlockingMessage(conflicts: readonly ConflictLike[]): string {
  if (conflicts.length === 0) return '';
  const listed = conflicts.slice(0, MAX_LISTED).map(describeOne).join('; ');
  const rest = conflicts.length - Math.min(conflicts.length, MAX_LISTED);
  const tail = rest > 0 ? ` (i ${extraConflictsPhrase(rest)})` : '';
  return `Nie da się ustawić wydarzenia w tych godzinach. ${listed}${tail}.`;
}

/**
 * Komunikat OSTRZEGAJĄCY dla wydarzenia ogólnofirmowego — zapis przechodzi,
 * więc liczy się sam rozmiar problemu, nie jego szczegóły. Liczy RÓŻNE osoby:
 * jedna osoba z trzema kolizjami to nadal jedna zajęta osoba.
 */
export function eventConflictWarningMessage(conflicts: readonly ConflictLike[]): string {
  if (conflicts.length === 0) return '';
  const people = new Set(conflicts.map((c) => c.personId));
  return `Wydarzenie ogólnofirmowe: ${peopleCountPhrase(people.size)} już coś zaplanowane w tych godzinach.`;
}
