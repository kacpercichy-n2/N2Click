// Pure, React-free week-view index. WeekView builds this ONCE per (state, days,
// filter) via useMemo, so the per-render selector scans (entriesForDate,
// overloadedPeopleOnDate, packDayBlocks, task/person/project lookups, bin
// filtering, per-person collision lists) run a single time instead of once per
// block render and once per drag frame. Every field is derived from the existing
// selectors so the rendered result stays byte-identical; nothing here mutates
// state or touches the DOM. Kept in a separate module so it is unit-testable
// without mounting React (vitest node environment, `*.test.ts`).
import type {
  AppData,
  DateStr,
  Person,
  Project,
  Task,
  WorkloadEntry,
} from '../types';
import {
  assigneeIdsOfTask,
  binEntriesForPerson,
  binTotalForPerson,
  calendarDayVolume,
  calendarEventsForDate,
  type CalendarEventOccurrence,
  entriesForDate,
  getPerson,
  getProject,
  getTask,
  overloadedPeopleOnDate,
  peopleWithBirthdayOnDate,
  personVacationOnDate,
  recurrenceOccurrencesForDate,
} from '../store/selectors';
import { vacationRenderWindow } from './weekViewLayout';
import { eventDisplayTitle, taskDisplayTitle } from '../store/confidentiality';
import { isBinEntry, packDayBlocks } from '../utils/time';
import { personColor } from '../utils/colors';
import type { RecurrenceOccurrence } from '../utils/recurrence';

/** A packed calendar block with its resolved task/person/project already looked up. */
export interface ResolvedBlock {
  block: WorkloadEntry;
  col: number;
  cols: number;
  task: Task;
  person: Person;
  project: Project | undefined;
}

/** Pozioma geometria kafelka: kolumna wewnątrz klastra nakładania (packDayBlocks). */
export interface LayoutLane {
  col: number;
  cols: number;
}

/** A recurring-task occurrence with its display hue resolved (presentational). */
export interface ResolvedRecurrence {
  task: Task;
  occurrence: RecurrenceOccurrence;
  hue: string;
  /** Kolumna w WSPÓLNYM pakowaniu warstwy dnia (bloki + spotkania + cykliczne). */
  col: number;
  cols: number;
}

/** Everything one day column needs, precomputed. */
export interface WeekDayModel {
  date: DateStr;
  /**
   * Objętość godzinowa dnia (zgłoszenie 77d10f85): bloki + spotkania i
   * wystąpienia cykliczne × osoby w filtrze, bez urlopów — patrz
   * `calendarDayVolume` w selectors.ts.
   */
  total: number;
  /** True when nothing volume-bearing falls on this day (`total === 0`). */
  empty: boolean;
  /**
   * Comma-joined names of overbooked people on this day (already filtered).
   * Osoby, których ten dzień kryje URLOP, są stąd WYŁĄCZONE — dla nich
   * wykrzyknik zastępuje palma (D8, patrz {@link WeekDayModel.vacationNames}).
   */
  overloadNames: string;
  /** Przeciążone osoby, które mają tego dnia URLOP (palma zamiast wykrzyknika). */
  vacationNames: string[];
  /** Names with a birthday on this day (whole team, filter-independent). */
  birthdayNames: string[];
  /** Presentational calendar-event occurrences on this day. */
  events: CalendarEventOccurrence[];
  /**
   * Kolumna spotkania we WSPÓLNYM pakowaniu warstwy dnia (klucz = id
   * wydarzenia). URLOP celowo nie ma tu wpisu — zostaje pełnoszerokim tłem
   * doby, nie kafelkiem dzielącym kolumnę.
   */
  eventLanes: Map<string, LayoutLane>;
  /**
   * Okno renderu bloku urlopu per WYSTĄPIENIE (klucz = id wydarzenia): godziny
   * pracy uczestnika z fallbackiem 9:00-17:00. Rozwiązane tutaj, bo `EventBlock`
   * jest memoizowany i nie powinien sięgać do `state` po osobę.
   */
  vacationWindows: Map<string, { start: number; end: number }>;
  /** Presentational recurring-task occurrences on this day, hue resolved. */
  recurrences: ResolvedRecurrence[];
  /** Real task blocks, packed into columns, task/person/project resolved. */
  blocks: ResolvedBlock[];
}

/**
 * Jeden przedział zajętości PREZENTACYJNEJ jednej osoby w jednym dniu.
 * `kind` rozdziela dwóch konsumentów (patrz {@link buildEventBusyByPersonDate}),
 * `title` pozwala NAZWAĆ winowajcę w komunikacie zamiast mówić „inna praca".
 */
export interface BusyInterval {
  start: number;
  end: number;
  kind: 'event' | 'urlop' | 'recurrence';
  /** Tytuł wydarzenia / urlopu / zadania cyklicznego; '' gdy nieznany. */
  title: string;
  /**
   * Wydarzenie ogólnofirmowe (`attendeeIds` puste). Bramka upuszczania je
   * POMIJA — blokada dotyczy tylko osób imiennie przypisanych (lustro
   * `blockCollidesWithEvent`) — ale straż scalania czyta dalej WSZYSTKIE
   * przedziały, więc flaga zostaje obok `kind`, nie zamiast niego.
   */
  companyWide?: boolean;
}

/** One person's bin (zasobnik) group. */
export interface BinPersonModel {
  person: Person;
  total: number;
  entries: Array<{ entry: WorkloadEntry; task: Task; project: Project | undefined }>;
}

/** The full precomputed week index consumed by WeekView. */
export interface WeekModel {
  days: WeekDayModel[];
  bin: BinPersonModel[];
  binGrandTotal: number;
  /**
   * Per-(person, date) dated blocks for O(1) collision / merge-neighbor lookups
   * during a drag. Keyed by {@link personDateKey}; built from ALL workload rows
   * (collision is per-person and filter-independent, exactly like
   * `blockCollides`). Only the seven rendered days are indexed.
   */
  blocksByPersonDate: Map<string, WorkloadEntry[]>;
  /**
   * Per-(person, date) union of that person's calendar-event occurrences and
   * recurring-task occurrences (presentational occupancy), as `{start, end, kind}`
   * minute intervals. Filter-INDEPENDENT and person-scoped (built via a
   * single-person Set, exactly like a per-person occupancy). Keyed by
   * {@link personDateKey}. Two consumers, two subsets: the will-merge affordance
   * reads EVERY kind (mirroring the reducer's merge guard), the drop gate reads
   * only `kind: 'event'` (a block must not land on a meeting; recurring
   * occurrences stay presentational). See {@link buildEventBusyByPersonDate}.
   */
  eventBusyByPersonDate: Map<string, BusyInterval[]>;
}

/** Stable composite key for {@link WeekModel.blocksByPersonDate}. */
export function personDateKey(personId: string, date: DateStr): string {
  return `${personId}\u0000${date}`;
}

/**
 * Build the per-(person, date) collision index for the given days. Mirrors
 * `blockCollides`, which filters `state.workload` by personId + date over ALL
 * people regardless of the view filter, so the lookup result is identical to the
 * previous per-frame scan.
 */
export function buildBlocksByPersonDate(
  state: AppData,
  days: DateStr[],
): Map<string, WorkloadEntry[]> {
  const daySet = new Set(days);
  const map = new Map<string, WorkloadEntry[]>();
  for (const w of state.workload) {
    if (isBinEntry(w) || !daySet.has(w.date)) continue;
    const key = personDateKey(w.personId, w.date);
    const list = map.get(key);
    if (list) list.push(w);
    else map.set(key, [w]);
  }
  return map;
}

/**
 * Build the per-(person, date) presentational-occupancy index (calendar events +
 * recurring-task occurrences) for the given days. Person-scoped via a
 * single-person Set — each entry therefore also includes company-wide events and
 * recurring tasks the person is assigned to, exactly this person's occupancy.
 *
 * Each interval carries its `kind`, because the two consumers need DIFFERENT
 * subsets and must not be collapsed:
 *  - straż scalania (will-merge affordance) czyta WSZYSTKIE rodzaje — scalenie nie
 *    może po cichu połknąć ani spotkania, ani wystąpienia cyklicznego,
 *  - bramka „blok nie wchodzi na spotkanie" czyta WYŁĄCZNIE `kind: 'event'`,
 *    bo wystąpienia cykliczne zostają czysto prezentacyjne (inwariant 1) i nigdy
 *    nie blokują przeciągania.
 *
 * POKRYCIE: wcześniej indeks obejmował tylko pary z co najmniej jednym blokiem
 * (jedyne, gdzie może zajść scalenie). Bramka upuszczania potrzebuje TAKŻE par
 * bez bloku — dzień, w którym osoba ma samo spotkanie, jest legalnym celem
 * upuszczenia. Klucze budujemy więc z właścicieli wierszy `state.workload`
 * (dowolnych: dziennych i zasobnikowych) × `days`: cel upuszczenia to zawsze
 * właściciel przenoszonego wpisu, więc ten zbiór jest zupełny i nadal wąski —
 * nie jest to iloczyn wszystkich osób przez wszystkie dni.
 */
export function buildEventBusyByPersonDate(
  state: AppData,
  days: DateStr[],
): Map<string, BusyInterval[]> {
  const map = new Map<string, BusyInterval[]>();
  const owners = new Set<string>();
  for (const w of state.workload) owners.add(w.personId);

  for (const personId of owners) {
    const forPerson = new Set([personId]);
    for (const date of days) {
      const busy: BusyInterval[] = [];
      for (const occ of calendarEventsForDate(state, date, forPerson)) {
        busy.push({
          start: occ.startMinutes,
          end: occ.startMinutes + occ.durationMinutes,
          // Urlop niesie własny rodzaj: bramka upuszczania traktuje go tak samo
          // jak spotkanie (blok nie wchodzi), a przedział 0-1440 zabiera całą
          // dobę, więc żadna godzina nie jest legalnym celem.
          kind: occ.event.kind === 'urlop' ? 'urlop' : 'event',
          // Utajniona treść: winowajca kolizji nazywa się etykietą maskującą
          // („Wydarzenie #N"), nigdy prawdziwym tytułem, gdy widz nie ma wglądu.
          title: eventDisplayTitle(state, occ.event),
          companyWide: occ.event.attendeeIds.length === 0,
        });
      }
      for (const { task, occurrence } of recurrenceOccurrencesForDate(state, date, forPerson)) {
        busy.push({
          start: occurrence.startMinutes,
          end: occurrence.startMinutes + occurrence.durationMinutes,
          kind: 'recurrence',
          title: taskDisplayTitle(state, task),
        });
      }
      if (busy.length > 0) map.set(personDateKey(personId, date), busy);
    }
  }
  return map;
}

/**
 * Compute the entire week index once. Pure and deterministic: it only reads
 * `state` through existing selectors and never mutates. The result feeds every
 * day column, block, header and bin card so those never re-scan global
 * collections during render or drag.
 */
export function buildWeekModel(
  state: AppData,
  days: DateStr[],
  filter: Set<string>,
): WeekModel {
  const dayModels: WeekDayModel[] = days.map((date) => {
    const entries = entriesForDate(state, date, filter);
    const total = calendarDayVolume(state, date, filter);

    // Podział przeciążonych na urlopowych i pozostałych (D8): w dzień urlopu
    // wykrzyknik zastępuje palma, więc te same imiona nie mogą stać w obu
    // plakietkach. Decyzja siedzi w selektorze, żeby dało się ją przetestować
    // bez DOM-u.
    const overloaded: string[] = [];
    const vacationNames: string[] = [];
    for (const id of overloadedPeopleOnDate(state, date, filter)) {
      const name = getPerson(state, id)?.name;
      if (!name) continue;
      if (personVacationOnDate(state, id, date) !== null) vacationNames.push(name);
      else overloaded.push(name);
    }
    const overloadNames = overloaded.join(', ');

    const birthdayNames = peopleWithBirthdayOnDate(state, date)
      .map((p) => p.name)
      .filter((n): n is string => Boolean(n));

    const events = calendarEventsForDate(state, date, filter);

    // Okno renderu urlopu: godziny pracy JEGO uczestnika (urlop ma kanonicznie
    // dokładnie jednego), fallback 9:00-17:00 dla zdegenerowanego profilu.
    const vacationWindows = new Map<string, { start: number; end: number }>();
    for (const occ of events) {
      if (occ.event.kind !== 'urlop') continue;
      const owner = getPerson(state, occ.event.attendeeIds[0] ?? '');
      vacationWindows.set(occ.event.id, vacationRenderWindow(owner));
    }

    const rawRecurrences = recurrenceOccurrencesForDate(state, date, filter);

    // JEDNO pakowanie WARSTWY PREZENTACJI (2026-08-06, decyzja usera): bloki,
    // spotkania (bez urlopu) i wystąpienia cykliczne wchodzą RAZEM do
    // `packDayBlocks`, więc dwie rzeczy w tym samym czasie dzielą kolumnę
    // (kafelki obok siebie) zamiast malować się jedna na drugiej. To WYŁĄCZNIE
    // geometria (`col`/`cols`): kolizje, sumy, `dayTotal` i przeciążenie nadal
    // nie widzą nakładek (inwariant 1), a żadna ścieżka wskaźnika się nie
    // zmienia (inwariant 7). Urlop zostaje pełnoszerokim tłem doby.
    type LayoutItem = { startMinutes: number; plannedHours: number } & (
      | { kind: 'block'; entry: WorkloadEntry }
      | { kind: 'event'; eventId: string }
      | { kind: 'recurrence'; taskId: string }
    );
    const layoutItems: LayoutItem[] = [
      ...entries.map((entry) => ({
        kind: 'block' as const,
        entry,
        startMinutes: entry.startMinutes,
        plannedHours: entry.plannedHours,
      })),
      ...events
        .filter((occ) => occ.event.kind !== 'urlop')
        .map((occ) => ({
          kind: 'event' as const,
          eventId: occ.event.id,
          startMinutes: occ.startMinutes,
          plannedHours: occ.durationMinutes / 60,
        })),
      ...rawRecurrences.map(({ task, occurrence }) => ({
        kind: 'recurrence' as const,
        taskId: task.id,
        startMinutes: occurrence.startMinutes,
        plannedHours: occurrence.durationMinutes / 60,
      })),
    ];
    const eventLanes = new Map<string, LayoutLane>();
    const recurLanes = new Map<string, LayoutLane>();
    const blocks: ResolvedBlock[] = [];
    for (const { block: item, col, cols } of packDayBlocks(layoutItems)) {
      if (item.kind === 'event') {
        eventLanes.set(item.eventId, { col, cols });
        continue;
      }
      if (item.kind === 'recurrence') {
        recurLanes.set(item.taskId, { col, cols });
        continue;
      }
      const task = getTask(state, item.entry.taskId);
      const person = getPerson(state, item.entry.personId);
      if (!task || !person) continue; // matches the JSX null-skip exactly
      const project = getProject(state, task.projectId);
      blocks.push({ block: item.entry, col, cols, task, person, project });
    }

    // Presentational recurrence overlay: same selector/order as the JSX, hue
    // resolved once here (was `personColor(assigneeIdsOfTask(...)[0])` inline).
    const recurrences: ResolvedRecurrence[] = rawRecurrences.map(({ task, occurrence }) => ({
      task,
      occurrence,
      hue: personColor(assigneeIdsOfTask(state, task.id)[0] ?? ''),
      col: recurLanes.get(task.id)?.col ?? 0,
      cols: recurLanes.get(task.id)?.cols ?? 1,
    }));

    return {
      date,
      total,
      empty: total === 0,
      overloadNames,
      vacationNames,
      birthdayNames,
      events,
      eventLanes,
      vacationWindows,
      recurrences,
      blocks,
    };
  });

  const binPeople = state.people.filter(
    (p) =>
      (filter.size === 0 || filter.has(p.id)) &&
      binEntriesForPerson(state, p.id).length > 0,
  );
  const bin: BinPersonModel[] = binPeople.map((person) => {
    const entries = binEntriesForPerson(state, person.id)
      .map((entry) => {
        const task = getTask(state, entry.taskId);
        if (!task) return null; // matches the JSX null-skip exactly
        const project = getProject(state, task.projectId);
        return { entry, task, project };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);
    return { person, total: binTotalForPerson(state, person.id), entries };
  });
  const binGrandTotal = binPeople.reduce((s, p) => s + binTotalForPerson(state, p.id), 0);

  const blocksByPersonDate = buildBlocksByPersonDate(state, days);

  return {
    days: dayModels,
    bin,
    binGrandTotal,
    blocksByPersonDate,
    eventBusyByPersonDate: buildEventBusyByPersonDate(state, days),
  };
}
