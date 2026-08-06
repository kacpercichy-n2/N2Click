// Polskie komunikaty o kolizji terminu wydarzenia. Czysto: żadnego importu
// store'u, wszystkie dane wchodzą jawnie — tak jak w `blockLabel.ts` — więc
// testuje się bez Reacta i bez DOM-u (środowisko `node`).
//
// Progi i komunikaty (patrz `eventDraftConflicts` w selectors.ts):
//  - uczestnicy IMIENNI (od 2026-08-06): kolizja z urlopem => komunikat
//    BLOKUJĄCY; pozostałe kolizje => żywa linia ostrzeżenia + treść DIALOGU
//    potwierdzenia („Dodaj mimo kolizji"), oba mówią kto i czym jest zajęty,
//  - wydarzenie OGÓLNOFIRMOWE => komunikat OSTRZEGAJĄCY, sam licznik osób.
//
// Zakresy godzin piszemy zwykłym łącznikiem („9:00-10:00"). Myślnik i półpauza
// są zabronione w tekstach widocznych dla użytkownika.

import { formatMinutes } from './time';
import { formatShortWithWeekday } from './dates';

/**
 * Minimalny, STRUKTURALNY kształt kolizji. Celowo nie importujemy
 * `ScheduleConflict` z selectors.ts — `src/utils/*` nie zależy od store'u.
 * `ScheduleConflict` jest z tym zgodny.
 */
export interface ConflictLike {
  kind: 'block' | 'event' | 'urlop' | 'recurrence';
  /** Nazwa osoby; '' = nieznana. */
  personName: string;
  /** Tytuł zadania/wydarzenia; '' = nieznany. */
  title: string;
  startMinutes: number;
  durationMinutes: number;
  /** Do policzenia RÓŻNYCH osób w ostrzeżeniu. */
  personId: string;
  /** Dzień kolizji (yyyy-MM-dd) — obecny w symulacji serii cyklicznej, gdzie
   *  kolizje z różnych wystąpień trzeba wymienić z datą. */
  date?: string;
}

/** Ile kolizji wymieniamy z nazwy, zanim przejdziemy na „i N więcej". */
const MAX_LISTED = 2;

const KIND_NOUN: Record<ConflictLike['kind'], string> = {
  block: 'zadanie',
  event: 'wydarzenie',
  urlop: 'urlop',
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

/**
 * „Ola Nowak ma już zadanie „Regresja QA" 10:30-12:00".
 *
 * URLOP jest wyjątkiem BEZ zakresu godzin: jest pełnodniowy, więc „0:00-24:00"
 * niosłoby zero informacji i wyglądało jak błąd danych.
 */
function describeOne(c: ConflictLike): string {
  const who = c.personName.trim() === '' ? 'Ta osoba' : c.personName.trim();
  if (c.kind === 'urlop') return `${who} ma w tym dniu urlop`;
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
 * Kolizje imienne po ZMIANIE 2026-08-06 (zapis możliwy po potwierdzeniu):
 *
 * ŻYWA linia ostrzeżenia pod formularzem — wymienia kto i czym jest zajęty
 * (jak komunikat blokujący) i zapowiada dialog potwierdzenia, żeby przycisk
 * zapisu nie zaskakiwał.
 */
export function namedConflictWarningMessage(conflicts: readonly ConflictLike[]): string {
  if (conflicts.length === 0) return '';
  const listed = conflicts.slice(0, MAX_LISTED).map(describeOne).join('; ');
  const rest = conflicts.length - Math.min(conflicts.length, MAX_LISTED);
  const tail = rest > 0 ? ` (i ${extraConflictsPhrase(rest)})` : '';
  return `Termin koliduje: ${listed}${tail}. Zapis poprosi o potwierdzenie.`;
}

/**
 * Treść DIALOGU potwierdzenia kolizji imiennej — sama lista zajęć (tytuł
 * dialogu niesie pytanie), bez zdania „nie da się": zapis JEST możliwy.
 */
export function eventConflictConfirmMessage(conflicts: readonly ConflictLike[]): string {
  if (conflicts.length === 0) return '';
  const listed = conflicts.slice(0, MAX_LISTED).map(describeOne).join('; ');
  const rest = conflicts.length - Math.min(conflicts.length, MAX_LISTED);
  const tail = rest > 0 ? ` (i ${extraConflictsPhrase(rest)})` : '';
  return `${listed}${tail}.`;
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

/** Ile kolizji serii wymieniamy z datą — seria bywa dłuższa niż jednorazowe,
 *  więcej niż {@link MAX_LISTED}, żeby dwa pierwsze terminy nie zjadły całej
 *  informacji przy urlopie rozciągniętym na kilka wystąpień. */
const MAX_LISTED_RECURRING = 3;

/**
 * Komunikat OSTRZEGAJĄCY dla serii CYKLICZNEJ (zapis zawsze przechodzi —
 * decyzja 2026-08-04: zajęty pojedynczy tydzień nie może blokować serii na pół
 * roku). Wymienia terminy kolizji z datą: „pon 10 sie: Jarek ma w tym dniu
 * urlop"; resztę zbiera licznikiem.
 */
export function recurringConflictWarningMessage(conflicts: readonly ConflictLike[]): string {
  if (conflicts.length === 0) return '';
  const listed = conflicts
    .slice(0, MAX_LISTED_RECURRING)
    .map((c) => (c.date ? `${formatShortWithWeekday(c.date)}: ${describeOne(c)}` : describeOne(c)))
    .join('; ');
  const rest = conflicts.length - Math.min(conflicts.length, MAX_LISTED_RECURRING);
  const tail = rest > 0 ? ` (i ${extraConflictsPhrase(rest)})` : '';
  return `Seria koliduje w pojedynczych terminach: ${listed}${tail}. Wydarzenie zapisze się mimo to.`;
}

/**
 * Odmiana „zaplanowana pozycja" przez liczebnik — ta sama reguła co wyżej:
 * 1 zaplanowana pozycja / 2,3,4 zaplanowane pozycje / 5+ zaplanowanych pozycji.
 */
export function plannedItemsPhrase(count: number): string {
  const abs = Math.abs(Math.trunc(count));
  const last = abs % 10;
  const lastTwo = abs % 100;
  if (abs === 1) return '1 zaplanowana pozycja';
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) {
    return `${abs} zaplanowane pozycje`;
  }
  return `${abs} zaplanowanych pozycji`;
}

/**
 * Komunikat OSTRZEGAJĄCY przy zapisie URLOPU (próg D4 — zapis zawsze
 * przechodzi). Urlop dotyczy jednej osoby, więc liczy się rozmiar pracy do
 * przeplanowania, a nie liczba osób: najpierw rejestrujesz urlop, potem
 * porządkujesz kalendarz.
 */
export function vacationDraftWarningMessage(conflicts: readonly ConflictLike[]): string {
  if (conflicts.length === 0) return '';
  return `W tym okresie masz już ${plannedItemsPhrase(conflicts.length)}. Urlop zapisze się mimo to, pamiętaj o przeplanowaniu.`;
}
