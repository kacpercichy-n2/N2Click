// Pure selector functions. Both the tasks page and the calendar derive from
// these so the views are always consistent.
import type { AppData, DateStr, Person, Task, WorkloadEntry } from '../types';

export function getTask(state: AppData, taskId: string): Task | undefined {
  return state.tasks.find((t) => t.id === taskId);
}

export function getPerson(state: AppData, personId: string): Person | undefined {
  return state.people.find((p) => p.id === personId);
}

/** Person ids assigned to a task. */
export function assigneeIdsOfTask(state: AppData, taskId: string): string[] {
  return state.assignments
    .filter((a) => a.taskId === taskId)
    .map((a) => a.personId);
}

/** Person objects assigned to a task (in people-list order). */
export function assigneesOfTask(state: AppData, taskId: string): Person[] {
  const ids = new Set(assigneeIdsOfTask(state, taskId));
  return state.people.filter((p) => ids.has(p.id));
}

/** All workload entries for a task. */
export function entriesForTask(state: AppData, taskId: string): WorkloadEntry[] {
  return state.workload.filter((w) => w.taskId === taskId);
}

/** Entries for a task belonging to one person. */
export function entriesForTaskPerson(
  state: AppData,
  taskId: string,
  personId: string,
): WorkloadEntry[] {
  return state.workload.filter(
    (w) => w.taskId === taskId && w.personId === personId,
  );
}

/** Task total planned hours (derived, never stored). */
export function taskPlannedTotal(state: AppData, taskId: string): number {
  return entriesForTask(state, taskId).reduce((sum, w) => sum + w.plannedHours, 0);
}

/** Task planned hours for a single person. */
export function taskPlannedTotalForPerson(
  state: AppData,
  taskId: string,
  personId: string,
): number {
  return entriesForTaskPerson(state, taskId, personId).reduce(
    (sum, w) => sum + w.plannedHours,
    0,
  );
}

/** A person's planned hours on a specific date for one task. */
export function hoursForTaskPersonOnDate(
  state: AppData,
  taskId: string,
  personId: string,
  date: DateStr,
): number {
  const entry = state.workload.find(
    (w) => w.taskId === taskId && w.personId === personId && w.date === date,
  );
  return entry ? entry.plannedHours : 0;
}

/** A person's TOTAL planned hours across ALL tasks on a date. */
export function hoursForPersonOnDate(
  state: AppData,
  personId: string,
  date: DateStr,
): number {
  return state.workload
    .filter((w) => w.personId === personId && w.date === date)
    .reduce((sum, w) => sum + w.plannedHours, 0);
}

/** A person's total planned hours across every task and date. */
export function personTotalHours(state: AppData, personId: string): number {
  return state.workload
    .filter((w) => w.personId === personId)
    .reduce((sum, w) => sum + w.plannedHours, 0);
}

/** All entries on a single date (optionally restricted to a set of people). */
export function entriesForDate(
  state: AppData,
  date: DateStr,
  personFilter?: Set<string>,
): WorkloadEntry[] {
  return state.workload.filter(
    (w) =>
      w.date === date &&
      (!personFilter || personFilter.size === 0 || personFilter.has(w.personId)),
  );
}

/** Total hours on a date for the filtered people. */
export function dayTotal(
  state: AppData,
  date: DateStr,
  personFilter?: Set<string>,
): number {
  return entriesForDate(state, date, personFilter).reduce(
    (sum, w) => sum + w.plannedHours,
    0,
  );
}

export const OVERLOAD_THRESHOLD = 8;

/** People (ids) whose TOTAL for the date exceeds 8h, within the filter set. */
export function overloadedPeopleOnDate(
  state: AppData,
  date: DateStr,
  personFilter?: Set<string>,
): string[] {
  const relevant =
    personFilter && personFilter.size > 0
      ? state.people.filter((p) => personFilter.has(p.id))
      : state.people;
  return relevant
    .filter((p) => hoursForPersonOnDate(state, p.id, date) > OVERLOAD_THRESHOLD)
    .map((p) => p.id);
}
