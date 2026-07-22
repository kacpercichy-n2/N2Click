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
  calendarEventsForDate,
  type CalendarEventOccurrence,
  entriesForDate,
  getPerson,
  getProject,
  getTask,
  overloadedPeopleOnDate,
  peopleWithBirthdayOnDate,
  recurrenceOccurrencesForDate,
} from '../store/selectors';
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

/** A recurring-task occurrence with its display hue resolved (presentational). */
export interface ResolvedRecurrence {
  task: Task;
  occurrence: RecurrenceOccurrence;
  hue: string;
}

/** Everything one day column needs, precomputed. */
export interface WeekDayModel {
  date: DateStr;
  /** Σ planned hours of the filtered dated entries on this day (was `dayTotal`). */
  total: number;
  /** True when no filtered entries fall on this day. */
  empty: boolean;
  /** Comma-joined names of overbooked people on this day (already filtered). */
  overloadNames: string;
  /** Names with a birthday on this day (whole team, filter-independent). */
  birthdayNames: string[];
  /** Presentational calendar-event occurrences on this day. */
  events: CalendarEventOccurrence[];
  /** Presentational recurring-task occurrences on this day, hue resolved. */
  recurrences: ResolvedRecurrence[];
  /** Real task blocks, packed into columns, task/person/project resolved. */
  blocks: ResolvedBlock[];
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
    const total = entries.reduce((sum, w) => sum + w.plannedHours, 0);

    const overloadNames = overloadedPeopleOnDate(state, date, filter)
      .map((id) => getPerson(state, id)?.name)
      .filter((n): n is string => Boolean(n))
      .join(', ');

    const birthdayNames = peopleWithBirthdayOnDate(state, date)
      .map((p) => p.name)
      .filter((n): n is string => Boolean(n));

    const events = calendarEventsForDate(state, date, filter);

    // Presentational recurrence overlay: same selector/order as the JSX, hue
    // resolved once here (was `personColor(assigneeIdsOfTask(...)[0])` inline).
    const recurrences: ResolvedRecurrence[] = recurrenceOccurrencesForDate(
      state,
      date,
      filter,
    ).map(({ task, occurrence }) => ({
      task,
      occurrence,
      hue: personColor(assigneeIdsOfTask(state, task.id)[0] ?? ''),
    }));

    const blocks: ResolvedBlock[] = [];
    for (const { block, col, cols } of packDayBlocks(entries)) {
      const task = getTask(state, block.taskId);
      const person = getPerson(state, block.personId);
      if (!task || !person) continue; // matches the JSX null-skip exactly
      const project = getProject(state, task.projectId);
      blocks.push({ block, col, cols, task, person, project });
    }

    return {
      date,
      total,
      empty: entries.length === 0,
      overloadNames,
      birthdayNames,
      events,
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

  return {
    days: dayModels,
    bin,
    binGrandTotal,
    blocksByPersonDate: buildBlocksByPersonDate(state, days),
  };
}
