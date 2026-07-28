// Czysta warstwa PREZENTACJI siatki przydziału (AT-05) plus migawka kolumny
// osoby dla „Cofnij" po „Wyczyść kolumnę" (AT-13).
//
// Zero DOM-u, zero Reacta — testuje się w środowisku `node`, tak jak
// `taskModalSections.ts`. Logika EDYCJI siatki (clamp 0–24, snap 0,25 h, pola
// godziny startu, ostrzeżenia o przeciążeniu) NIE mieszka tutaj i nie zmienia
// się ani o bajt: ten moduł decyduje wyłącznie o tym, KTÓRE wiersze się
// renderują i jak nazywa się zwinięty pas dni.
import { polishCount } from '../utils/polishPlural';

/** Klucz komórki siatki: `${personId}|${date}`. JEDNO źródło formatu. */
export function allocKey(personId: string, date: string): string {
  return `${personId}|${date}`;
}

/** Wejście grupowania: jeden dzień okresu zadania. */
export interface AllocDayInfo {
  date: string;
  /** Sobota/niedziela — wpływa TYLKO na etykietę zwiniętego pasa. */
  weekend: boolean;
  /** Suma dnia po WSZYSTKICH osobach === 0. */
  empty: boolean;
}

/**
 * Wynik grupowania w KOLEJNOŚCI RENDEROWANIA. `day` = zwykły wiersz dnia,
 * `group` = pas ≥ 2 kolejnych pustych dni (nagłówek + opcjonalnie wiersze).
 */
export type AllocSegment =
  | { kind: 'day'; date: string }
  | {
      kind: 'group';
      dates: string[];
      workdays: number;
      weekends: number;
      expanded: boolean;
    };

/** Najkrótszy pas, który w ogóle warto zwijać (pojedynczy pusty dzień zostaje). */
const MIN_GROUP_LENGTH = 2;

/**
 * Puste dni w pas, reszta bez zmian. Reguły (ustalone w pakiecie):
 * - grupowalny jest dokładnie dzień `empty` — weekend z godzinami zostaje
 *   normalnym wierszem,
 * - pas powstaje z ≥ 2 KOLEJNYCH dni grupowalnych; pojedynczy pusty dzień
 *   zostaje wierszem,
 * - kolejność dni NIGDY się nie zmienia,
 * - pas jest rozwinięty, gdy KAŻDA jego data siedzi w `expandedDates` (dzięki
 *   temu wpisanie godziny w środku rozwiniętego pasa rozbija go na dwa pasy,
 *   które oba zostają rozwinięte).
 */
export function groupAllocationDays(
  days: AllocDayInfo[],
  expandedDates: ReadonlySet<string>,
): AllocSegment[] {
  const segments: AllocSegment[] = [];
  let run: AllocDayInfo[] = [];

  const flush = () => {
    if (run.length === 0) return;
    if (run.length < MIN_GROUP_LENGTH) {
      for (const day of run) segments.push({ kind: 'day', date: day.date });
    } else {
      segments.push({
        kind: 'group',
        dates: run.map((day) => day.date),
        workdays: run.filter((day) => !day.weekend).length,
        weekends: run.filter((day) => day.weekend).length,
        expanded: run.every((day) => expandedDates.has(day.date)),
      });
    }
    run = [];
  };

  for (const day of days) {
    if (day.empty) {
      run.push(day);
      continue;
    }
    flush();
    segments.push({ kind: 'day', date: day.date });
  }
  flush();
  return segments;
}

/** „1 pusty dzień roboczy" / „3 puste dni robocze" / „14 pustych dni roboczych". */
function workdayPhrase(n: number): string {
  return `${n} ${polishCount(n, 'pusty dzień roboczy', 'puste dni robocze', 'pustych dni roboczych')}`;
}

/** Samodzielny człon weekendowy: „2 dni weekendowe". */
function weekendPhrase(n: number): string {
  return `${n} ${polishCount(n, 'dzień weekendowy', 'dni weekendowe', 'dni weekendowych')}`;
}

/** Doklejka po „+": rzeczownik niesie już człon roboczy („+ 6 weekendowych"). */
function weekendSuffix(n: number): string {
  return `${n} ${polishCount(n, 'weekendowy', 'weekendowe', 'weekendowych')}`;
}

/**
 * Etykieta zwiniętego pasa. Przycisk dokleja do niej „ — pokaż" / „ — ukryj".
 * Odmiana idzie przez wspólny `polishCount`, więc nie ma tu drugiej reguły
 * mnogości.
 */
export function collapsedGroupLabel(workdays: number, weekends: number): string {
  if (workdays > 0 && weekends > 0) {
    return `${workdayPhrase(workdays)} + ${weekendSuffix(weekends)}`;
  }
  if (weekends > 0) return weekendPhrase(weekends);
  // Sam człon roboczy — także dla zdegenerowanego 0/0 (pas bez dni nie powstaje).
  return workdayPhrase(workdays);
}

/** Migawka kolumny jednej osoby: godziny + przypięte starty (klucze `allocKey`). */
export interface PersonColumnSnapshot {
  hours: Record<string, number>;
  starts: Record<string, number>;
}

/**
 * Stan kolumny osoby PRZED wyczyszczeniem. Bierze wyłącznie dni bieżącego
 * okresu — dokładnie te, które kasuje `clearPerson`.
 */
export function snapshotPersonColumn(
  allocations: Readonly<Record<string, number>>,
  startTimes: Readonly<Record<string, number>>,
  days: readonly string[],
  personId: string,
): PersonColumnSnapshot {
  const hours: Record<string, number> = {};
  const starts: Record<string, number> = {};
  for (const date of days) {
    const key = allocKey(personId, date);
    const value = allocations[key];
    if (value !== undefined) hours[key] = value;
    const start = startTimes[key];
    if (start !== undefined) starts[key] = start;
  }
  return { hours, starts };
}

/**
 * Odtworzenie migawki. Zwraca ZAWSZE nowe obiekty (React musi zobaczyć zmianę
 * referencji) i dokłada wyłącznie klucze z migawki — komórki innych osób oraz
 * to, co użytkownik wpisał po wyczyszczeniu w innych kolumnach, zostają.
 */
export function restorePersonColumn(
  allocations: Readonly<Record<string, number>>,
  startTimes: Readonly<Record<string, number>>,
  snapshot: PersonColumnSnapshot,
): { allocations: Record<string, number>; startTimes: Record<string, number> } {
  return {
    allocations: { ...allocations, ...snapshot.hours },
    startTimes: { ...startTimes, ...snapshot.starts },
  };
}
