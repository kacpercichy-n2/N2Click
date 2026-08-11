// Pure selector functions. Every page derives from these so views never disagree.
import type {
  ActivityEvent,
  AppData,
  CalendarEvent,
  Client,
  Comment,
  CommentEntityType,
  Company,
  ContentPlanPost,
  ContentPlanStatus,
  DateStr,
  Department,
  Milestone,
  Notification,
  Person,
  Project,
  SavedFilterCriteria,
  ServiceType,
  Status,
  Task,
  TaskAssignment,
  TaskRecurrence,
  WorkCategory,
  WorkloadEntry,
} from '../types';
import { DEFAULT_CAPACITY, DEFAULT_FILTER_CRITERIA } from './storage';
import {
  blockEndMinutes,
  formatMinutes,
  hasCollision,
  hoursToMinutes,
  isBinEntry,
  rangesOverlap,
} from '../utils/time';
import { addDaysStr, isBirthdayOn, isValidDateStr, parseDate } from '../utils/dates';
import { expandOccurrences, type RecurrenceOccurrence } from '../utils/recurrence';
import { argsKey, createKeyedCache, createRefCache, filterKey } from './selectorCache';
import {
  canViewProjectContent,
  canViewTaskContent,
  projectDisplayName,
  taskDisplayTitle,
} from './confidentiality';
import { MAX_VACATION_DAYS } from './commandValidation';
import { CONTENT_PLAN_STATUSES, isMonthKey, isPostInMonth } from '../contentplan/domain';

// ---- Per-revision indexes (module-private) --------------------------------
//
// Each index is keyed by the NARROWEST collection array it derives from, so an
// action that only touches an unrelated collection keeps it warm. That is sound
// because the reducer and the cloud merge always REPLACE a changed array and
// PRESERVE an unchanged one (they never mutate in place) — see selectorCache.ts.
// Every index preserves the source array's ORDER, so the selectors below stay
// byte-identical to the `.filter(...)`/`.find(...)` implementations they replace.

/** Shared empty results, so a miss still returns a STABLE reference. */
const EMPTY_ENTRIES: WorkloadEntry[] = [];
const EMPTY_IDS: string[] = [];
const EMPTY_CP_POSTS: ContentPlanPost[] = [];

/** First occurrence wins — mirrors `.find(...)` exactly, even with a stray duplicate id. */
function byIdMap<T extends { id: string }>(rows: readonly T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) if (!map.has(row.id)) map.set(row.id, row);
  return map;
}

/** Append `row` to the bucket at `key`, keeping source array order. */
function bucket<T>(map: Map<string, T[]>, key: string, row: T): void {
  const list = map.get(key);
  if (list) list.push(row);
  else map.set(key, [row]);
}

const tasksById = createRefCache((rows: Task[]) => byIdMap(rows));
const peopleById = createRefCache((rows: Person[]) => byIdMap(rows));
const projectsById = createRefCache((rows: Project[]) => byIdMap(rows));
const clientsById = createRefCache((rows: Client[]) => byIdMap(rows));
const departmentsById = createRefCache((rows: Department[]) => byIdMap(rows));
const serviceTypesById = createRefCache((rows: ServiceType[]) => byIdMap(rows));
const workCategoriesById = createRefCache((rows: WorkCategory[]) => byIdMap(rows));

interface StatusIndex {
  byId: Map<string, Status>;
  /** Ids of every `isDone` status, ARCHIVED INCLUDED (invariant 5). */
  doneIds: Set<string>;
}

const statusIndex = createRefCache(
  (rows: Status[]): StatusIndex => ({
    byId: byIdMap(rows),
    doneIds: new Set(rows.filter((s) => s.isDone).map((s) => s.id)),
  }),
);

interface WorkloadIndex {
  /** Rows bucketed by `date` (bin rows land under `''`, exactly like a `.filter`). */
  byDate: Map<string, WorkloadEntry[]>;
  /** Rows bucketed by `argsKey(personId, date)` — dated AND bin (date `''`). */
  byPersonDate: Map<string, WorkloadEntry[]>;
  byTaskId: Map<string, WorkloadEntry[]>;
  /** Bin rows (`isBinEntry`) bucketed by `personId`. */
  binByPersonId: Map<string, WorkloadEntry[]>;
}

const workloadIndex = createRefCache((rows: WorkloadEntry[]): WorkloadIndex => {
  const byDate = new Map<string, WorkloadEntry[]>();
  const byPersonDate = new Map<string, WorkloadEntry[]>();
  const byTaskId = new Map<string, WorkloadEntry[]>();
  const binByPersonId = new Map<string, WorkloadEntry[]>();
  for (const w of rows) {
    bucket(byDate, w.date, w);
    bucket(byPersonDate, argsKey(w.personId, w.date), w);
    bucket(byTaskId, w.taskId, w);
    if (isBinEntry(w)) bucket(binByPersonId, w.personId, w);
  }
  return { byDate, byPersonDate, byTaskId, binByPersonId };
});

interface AssignmentIndex {
  personIdsByTaskId: Map<string, string[]>;
  taskIdsByPersonId: Map<string, string[]>;
}

const assignmentIndex = createRefCache((rows: TaskAssignment[]): AssignmentIndex => {
  const personIdsByTaskId = new Map<string, string[]>();
  const taskIdsByPersonId = new Map<string, string[]>();
  for (const a of rows) {
    bucket(personIdsByTaskId, a.taskId, a.personId);
    bucket(taskIdsByPersonId, a.personId, a.taskId);
  }
  return { personIdsByTaskId, taskIdsByPersonId };
});

// ---- Basic lookups ----

export function getTask(state: AppData, taskId: string): Task | undefined {
  return tasksById(state.tasks).get(taskId);
}

export function getPerson(state: AppData, personId: string): Person | undefined {
  return peopleById(state.people).get(personId);
}

export function getProject(state: AppData, projectId: string): Project | undefined {
  return projectsById(state.projects).get(projectId);
}

export function getClient(state: AppData, clientId: string): Client | undefined {
  return clientsById(state.clients).get(clientId);
}

export function getStatus(state: AppData, statusId: string): Status | undefined {
  return statusIndex(state.statuses).byId.get(statusId);
}

export function getDepartment(
  state: AppData,
  departmentId: string,
): Department | undefined {
  return departmentsById(state.departments).get(departmentId);
}

export function getServiceType(
  state: AppData,
  serviceTypeId: string,
): ServiceType | undefined {
  return serviceTypesById(state.serviceTypes).get(serviceTypeId);
}

export function getWorkCategory(
  state: AppData,
  workCategoryId: string,
): WorkCategory | undefined {
  return workCategoriesById(state.workCategories).get(workCategoryId);
}

export function getCompany(state: AppData, companyId: string): Company | undefined {
  return state.companies.find((c) => c.id === companyId);
}

// ---- Spółka wykonawcza (filtr widoków) ----

/**
 * Czy projekt pasuje do filtra spółki. Pusty filtr = wszystko. Aktywny filtr
 * dopasowuje projekty tej spółki ORAZ projekty „neutralne” (bez spółki) —
 * świeży/nieprzypisany projekt nie znika nikomu (analogia do dawnej reguły
 * chmurowej `project_in_company_scope`).
 */
export function projectMatchesCompanyFilter(
  project: Pick<Project, 'companyId'>,
  companyId: string,
): boolean {
  return companyId === '' || !project.companyId || project.companyId === companyId;
}

/**
 * Kryteria INICJALNE widoku dla bieżącego użytkownika (gdy brak zapamiętanego
 * filtra): „wszystko” + spółka zalogowanego jako domyślny filtr spółek
 * (decyzja 2026-07-22: bazowo widzisz projekty/taski swojej spółki, filtrem
 * dokładasz resztę). Osoba bez spółki startuje bez zawężenia.
 */
export function defaultCriteriaForUser(state: AppData): SavedFilterCriteria {
  const me = currentUser(state);
  const companyId = me?.companyId ?? '';
  // Spółka mogła zostać usunięta ze słownika — nie inicjalizuj danglingiem.
  if (companyId === '' || !state.companies.some((c) => c.id === companyId)) {
    return DEFAULT_FILTER_CRITERIA;
  }
  return { ...DEFAULT_FILTER_CRITERIA, companyId };
}

// ---- Statuses ----

/** Active (non-archived) statuses in pipeline order. */
export function activeStatuses(state: AppData): Status[] {
  return state.statuses
    .filter((s) => !s.archived)
    .sort((a, b) => a.order - b.order);
}

/** All statuses in pipeline order (admin panel). */
export function allStatusesOrdered(state: AppData): Status[] {
  return [...state.statuses].sort((a, b) => a.order - b.order);
}

/**
 * The set of ids of all "done" statuses — every status with `isDone === true`,
 * ARCHIVED INCLUDED. Completion is an explicit, stored flag, not a pipeline
 * position, so reordering or archiving statuses never changes which work counts
 * as done. Single source of the done-status rule reused by the agenda, the
 * "Moja praca" selectors, and the timeline overdue tint.
 *
 * Index-backed: the returned Set is CACHED per `state.statuses` revision and is
 * never mutated by any caller (every consumer only reads `.has`).
 */
export function doneStatusIds(state: AppData): Set<string> {
  return statusIndex(state.statuses).doneIds;
}

/** Whether a given status id is a done status (archived done statuses count). */
export function isDoneStatus(state: AppData, statusId: string): boolean {
  return statusIndex(state.statuses).doneIds.has(statusId);
}

// ---- Clients & projects ----

export function activeClients(state: AppData): Client[] {
  return state.clients.filter((c) => !c.archived);
}

export function projectsOfClient(state: AppData, clientId: string): Project[] {
  return state.projects.filter((p) => p.clientId === clientId);
}

export function tasksOfProject(state: AppData, projectId: string): Task[] {
  return state.tasks.filter((t) => t.projectId === projectId);
}

/**
 * Szkic zadania: utworzone w projekcie, jeszcze NIEopublikowane (`isDraft`).
 * Brak pola = opublikowane (legacy/chmura bez kolumny). Jedno miejsce prawdy dla
 * wszystkich wykluczeń w widokach planowania (Moja praca, pulpit, kanban, lista
 * zadań); godziny szkicu i tak nie istnieją, więc selektory oparte o `workload`
 * (sumy, kalendarz, zasobnik, przeciążenie) wykluczają szkice samoczynnie.
 */
export function isDraftTask(task: Task): boolean {
  return task.isDraft === true;
}

/** Odwrotność {@link isDraftTask}: zadanie opublikowane (lub legacy bez pola). */
export function isPublishedTask(task: Task): boolean {
  return task.isDraft !== true;
}

/**
 * Zadania projektu w RĘCZNEJ kolejności wyświetlania. Kanoniczny, całkowity i
 * deterministyczny klucz `(orderIndex asc, startDate asc, id asc)` — ten sam,
 * którego używa reducer `REORDER_PROJECT_TASK`. Rozstrzygnięcie po startDate/id
 * sprawia, że wiersze chmury z samymi zerami (przed pierwszą zmianą kolejności)
 * wyglądają dokładnie jak dotychczasowy sort po startDate.
 */
export function orderedTasksOfProject(state: AppData, projectId: string): Task[] {
  return state.tasks
    .filter((t) => t.projectId === projectId)
    .sort(
      (a, b) =>
        a.orderIndex - b.orderIndex ||
        a.startDate.localeCompare(b.startDate) ||
        a.id.localeCompare(b.id),
    );
}

/**
 * Działy PROJEKTU są POCHODNE: unikalny zbiór działów przypisanych do jego
 * zadań (dział wybiera się na zadaniu), w kolejności słownika działów. Projekt
 * może więc obejmować kilka działów naraz. Gdy żadne zadanie nie ma działu,
 * fallbackiem jest zaszłościowe `project.departmentId`.
 */
export function departmentsOfProject(state: AppData, projectId: string): Department[] {
  const fromTasks = new Set(
    state.tasks
      .filter((t) => t.projectId === projectId && t.departmentId !== '')
      .map((t) => t.departmentId),
  );
  if (fromTasks.size === 0) {
    const legacy = getProject(state, projectId)?.departmentId ?? '';
    if (legacy !== '') {
      const dept = state.departments.find((d) => d.id === legacy);
      return dept ? [dept] : [];
    }
    return [];
  }
  return state.departments.filter((d) => fromTasks.has(d.id));
}

export function milestonesOfProject(state: AppData, projectId: string): Milestone[] {
  return state.milestones
    .filter((m) => m.projectId === projectId)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Total planned hours across all tasks of a project (derived, never stored). */
export function projectPlannedTotal(state: AppData, projectId: string): number {
  const taskIds = new Set(tasksOfProject(state, projectId).map((t) => t.id));
  return state.workload
    .filter((w) => taskIds.has(w.taskId))
    .reduce((sum, w) => sum + w.plannedHours, 0);
}

/** Distinct person ids working on (assigned to any task of) a project. */
export function peopleIdsOfProject(state: AppData, projectId: string): string[] {
  const taskIds = new Set(tasksOfProject(state, projectId).map((t) => t.id));
  return Array.from(
    new Set(
      state.assignments.filter((a) => taskIds.has(a.taskId)).map((a) => a.personId),
    ),
  );
}

// ---- Assignments ----

/**
 * Person ids assigned to a task. Index-backed (bucket order = `state.assignments`
 * order, exactly like the previous `.filter().map()`); the returned array is a
 * SHARED cached bucket — never mutate it.
 */
export function assigneeIdsOfTask(state: AppData, taskId: string): string[] {
  return assignmentIndex(state.assignments).personIdsByTaskId.get(taskId) ?? EMPTY_IDS;
}

/** Person objects assigned to a task (in people-list order). */
export function assigneesOfTask(state: AppData, taskId: string): Person[] {
  const ids = new Set(assigneeIdsOfTask(state, taskId));
  return state.people.filter((p) => ids.has(p.id));
}

/** Task ids a person is assigned to. Index-backed; shared cached bucket (see above). */
export function taskIdsOfPerson(state: AppData, personId: string): string[] {
  return assignmentIndex(state.assignments).taskIdsByPersonId.get(personId) ?? EMPTY_IDS;
}

/** Distinct projects a person works on (via task assignments). */
export function projectsOfPerson(state: AppData, personId: string): Project[] {
  const taskIds = new Set(taskIdsOfPerson(state, personId));
  const projectIds = new Set(
    state.tasks
      .filter((t) => taskIds.has(t.id) && isPublishedTask(t))
      .map((t) => t.projectId),
  );
  return state.projects.filter((p) => projectIds.has(p.id));
}

// ---- Workload ----

/** All workload entries for a task. Index-backed; shared cached bucket. */
export function entriesForTask(state: AppData, taskId: string): WorkloadEntry[] {
  return workloadIndex(state.workload).byTaskId.get(taskId) ?? EMPTY_ENTRIES;
}

// Keyed caches parse their arguments back OUT of the cache key, so the key
// provably determines the result (ids are UUIDs and dates are `yyyy-MM-dd`, so
// the `' '` separator of `argsKey` is unambiguous).
const EMPTY_FILTER: Set<string> = new Set<string>();

/**
 * Rebuild a person filter from a {@link filterKey} string. Only `.has` is ever
 * called on a filter, so a rebuilt Set behaves identically to the caller's one;
 * `''` (undefined ≡ empty) rebuilds to the shared empty Set.
 */
function personFilterFromKey(key: string): Set<string> {
  return key === '' ? EMPTY_FILTER : new Set(key.split(','));
}

const entriesForTaskPersonCache = createKeyedCache<WorkloadEntry[]>((state, key) => {
  const [taskId, personId] = key.split(' ');
  return entriesForTask(state, taskId).filter((w) => w.personId === personId);
});

/** Entries for a task belonging to one person. */
export function entriesForTaskPerson(
  state: AppData,
  taskId: string,
  personId: string,
): WorkloadEntry[] {
  return entriesForTaskPersonCache(state, argsKey(taskId, personId));
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
  return state.workload
    .filter((w) => w.taskId === taskId && w.personId === personId && w.date === date)
    .reduce((sum, w) => sum + w.plannedHours, 0);
}

/** Rows of one `(person, date)` pair in `state.workload` order (shared bucket). */
function personDateEntries(state: AppData, key: string): WorkloadEntry[] {
  return workloadIndex(state.workload).byPersonDate.get(key) ?? EMPTY_ENTRIES;
}

const hoursForPersonOnDateCache = createKeyedCache<number>((state, key) =>
  personDateEntries(state, key).reduce((sum, w) => sum + w.plannedHours, 0),
);

/** A person's TOTAL planned hours across ALL tasks on a date. */
export function hoursForPersonOnDate(
  state: AppData,
  personId: string,
  date: DateStr,
): number {
  return hoursForPersonOnDateCache(state, argsKey(personId, date));
}

/** A person's total planned hours across every task and date. */
export function personTotalHours(state: AppData, personId: string): number {
  return state.workload
    .filter((w) => w.personId === personId)
    .reduce((sum, w) => sum + w.plannedHours, 0);
}

const blocksForPersonDateCache = createKeyedCache<WorkloadEntry[]>((state, key) =>
  // Sort a COPY: the index bucket is shared and must keep source array order.
  [...personDateEntries(state, key)].sort((a, b) => a.sortIndex - b.sortIndex),
);

/** A person's ordered time blocks on one date (the per-day schedule). */
export function blocksForPersonDate(
  state: AppData,
  personId: string,
  date: DateStr,
): WorkloadEntry[] {
  return blocksForPersonDateCache(state, argsKey(personId, date));
}

/** End minute (from midnight) of a block. */
export function blockEnd(entry: WorkloadEntry): number {
  return blockEndMinutes(entry.startMinutes, entry.plannedHours);
}

/**
 * Would a block of `plannedHours` starting at `startMinutes` overlap any OTHER
 * block of this person on this date? Touching edges do not collide.
 */
export function blockCollides(
  state: AppData,
  personId: string,
  date: DateStr,
  startMinutes: number,
  plannedHours: number,
  excludeEntryId?: string,
): boolean {
  const blocks = state.workload.filter(
    (w) => w.personId === personId && w.date === date,
  );
  return hasCollision(blocks, startMinutes, hoursToMinutes(plannedHours), excludeEntryId);
}

const entriesForDateCache = createKeyedCache<WorkloadEntry[]>((state, key) => {
  const [date, fk] = key.split(' ');
  // Bucket order IS `state.workload` order, so the result matches the old
  // `.filter(...)` element for element.
  const onDate = workloadIndex(state.workload).byDate.get(date) ?? EMPTY_ENTRIES;
  if (fk === '') return onDate;
  const filter = personFilterFromKey(fk);
  return onDate.filter((w) => filter.has(w.personId));
});

/** All entries on a single date (optionally restricted to a set of people). */
export function entriesForDate(
  state: AppData,
  date: DateStr,
  personFilter?: Set<string>,
): WorkloadEntry[] {
  return entriesForDateCache(state, argsKey(date, filterKey(personFilter)));
}

const dayTotalCache = createKeyedCache<number>((state, key) =>
  entriesForDateCache(state, key).reduce((sum, w) => sum + w.plannedHours, 0),
);

/** Total hours on a date for the filtered people. */
export function dayTotal(
  state: AppData,
  date: DateStr,
  personFilter?: Set<string>,
): number {
  return dayTotalCache(state, argsKey(date, filterKey(personFilter)));
}

const recurrenceOccurrencesForDateCache = createKeyedCache<
  Array<{ task: Task; occurrence: RecurrenceOccurrence }>
>((state, key) => {
  const [date, fk] = key.split(' ');
  const out: Array<{ task: Task; occurrence: RecurrenceOccurrence }> = [];
  const personFilter = personFilterFromKey(fk);
  const filterActive = personFilter.size > 0;
  for (const task of state.tasks) {
    if (task.recurrence === undefined || !isPublishedTask(task)) continue;
    if (filterActive) {
      const assignees = assigneeIdsOfTask(state, task.id);
      if (!assignees.some((id) => personFilter.has(id))) continue;
    }
    const occurrences = expandOccurrences(task.recurrence, task.startDate, date, date);
    for (const occurrence of occurrences) out.push({ task, occurrence });
  }
  return out;
});

/**
 * Wystąpienia cyklicznych OPUBLIKOWANYCH zadań na dany dzień — WYŁĄCZNIE
 * prezentacyjne (inwariant 1: nigdy nie zasilają sum/przeciążenia/kolizji ani
 * `dayTotal`). Semantyka filtra jak w {@link entriesForDate}: pusty/brak zbioru =
 * wszyscy; inaczej zadanie pokazane, gdy KTÓRYKOLWIEK z przypisanych jest w
 * filtrze. Szkice wykluczone (kanonicznie nigdy nie mają reguły, plus jawny
 * strażnik `isPublishedTask`).
 */
export function recurrenceOccurrencesForDate(
  state: AppData,
  date: DateStr,
  personFilter?: Set<string>,
): Array<{ task: Task; occurrence: RecurrenceOccurrence }> {
  return recurrenceOccurrencesForDateCache(state, argsKey(date, filterKey(personFilter)));
}

/**
 * Czy osoba zgłosiła nieobecność w wystąpieniu wydarzenia tego dnia?
 * Czysta funkcja na encji — wspólna dla kolizji, objętości dnia, occupancy
 * widoku tygodnia i renderu (kafel-duch). Urlop i jednorazowe spotkania nie
 * niosą `absences` (forma kanoniczna), więc zwracają false z definicji.
 */
export function personAbsentFromEventOccurrence(
  event: CalendarEvent,
  date: DateStr,
  personId: string,
): boolean {
  if (event.absences === undefined || personId === '') return false;
  return event.absences.some((a) => a.date === date && a.personId === personId);
}

/** Jedno wystąpienie wydarzenia na konkretny dzień (czysto prezentacyjne). */
export interface CalendarEventOccurrence {
  event: CalendarEvent;
  startMinutes: number;
  durationMinutes: number;
}

const calendarEventsForDateCache = createKeyedCache<CalendarEventOccurrence[]>((state, key) => {
  const [date, fk] = key.split(' ');
  const out: CalendarEventOccurrence[] = [];
  const personFilter = personFilterFromKey(fk);
  const filterActive = personFilter.size > 0;
  for (const event of state.events) {
    if (filterActive) {
      const companyWide = event.attendeeIds.length === 0;
      if (!companyWide && !event.attendeeIds.some((id) => personFilter.has(id))) continue;
    }
    // Urlop rozwija się na CAŁY zakres dat (porównanie stringów yyyy-MM-dd jest
    // porządkiem chronologicznym). Bez filtrowania po `workDays` — pokazujemy
    // każdy dzień zakresu, także wolny. Wystąpienie niesie zapisane czasy
    // 0/1440, więc pełnodniowa kolizja wychodzi z istniejących ścieżek.
    if (event.kind === 'urlop') {
      if (event.date <= date && date <= (event.endDate ?? event.date)) {
        out.push({
          event,
          startMinutes: event.startMinutes,
          durationMinutes: event.durationMinutes,
        });
      }
      continue;
    }
    if (event.recurrence === undefined) {
      if (event.date === date) {
        out.push({
          event,
          startMinutes: event.startMinutes,
          durationMinutes: event.durationMinutes,
        });
      }
      continue;
    }
    const occurrences = expandOccurrences(event.recurrence, event.date, date, date);
    for (const occ of occurrences) {
      out.push({ event, startMinutes: occ.startMinutes, durationMinutes: occ.durationMinutes });
    }
  }
  return out;
});

/**
 * Wydarzenia kalendarza na dany dzień — WYŁĄCZNIE prezentacyjne (inwariant 1:
 * nigdy nie zasilają sum/przeciążenia/kolizji ani `dayTotal`). Jednorazowe gdy
 * `event.date === date`; cykliczne rozwijane przez `expandOccurrences` (honoruje
 * overrides). Semantyka filtra osób: pusty/brak = wszystko; niepusty = przecięcie
 * z `attendeeIds` LUB wydarzenie ogólnofirmowe (`attendeeIds.length === 0` widać
 * zawsze).
 */
export function calendarEventsForDate(
  state: AppData,
  date: DateStr,
  personFilter?: Set<string>,
): CalendarEventOccurrence[] {
  return calendarEventsForDateCache(state, argsKey(date, filterKey(personFilter)));
}

const calendarDayVolumeCache = createKeyedCache<number>((state, key) => {
  const [date, fk = ''] = key.split(' ');
  const personFilter = personFilterFromKey(fk);
  const filterActive = personFilter.size > 0;
  let volume = dayTotalCache(state, key);
  for (const occ of calendarEventsForDateCache(state, key)) {
    if (occ.event.kind === 'urlop') continue;
    const attendees = occ.event.attendeeIds;
    const heads =
      attendees.length === 0
        ? filterActive
          ? personFilter.size
          : state.people.length
        : filterActive
          ? attendees.filter((id) => personFilter.has(id)).length
          : attendees.length;
    // Nieobecni w TYM wystąpieniu nie wnoszą godzin — liczymy tylko osoby,
    // które weszły do `heads` (uczestnik/zespół ∩ filtr, gdy aktywny).
    let absent = 0;
    for (const a of occ.event.absences ?? []) {
      if (a.date !== date) continue;
      const inScope =
        attendees.length === 0
          ? filterActive
            ? personFilter.has(a.personId)
            : state.people.some((p) => p.id === a.personId)
          : attendees.includes(a.personId) && (!filterActive || personFilter.has(a.personId));
      if (inScope) absent += 1;
    }
    volume += (occ.durationMinutes / 60) * Math.max(0, heads - absent);
  }
  for (const { task, occurrence } of recurrenceOccurrencesForDateCache(state, key)) {
    const assignees = assigneeIdsOfTask(state, task.id);
    const heads = filterActive
      ? assignees.filter((id) => personFilter.has(id)).length
      : assignees.length;
    volume += (occurrence.durationMinutes / 60) * heads;
  }
  return volume;
});

/**
 * OBJĘTOŚĆ GODZINOWA DNIA W KALENDARZU (zgłoszenie 77d10f85, decyzja usera
 * 2026-08-07): suma godzin WYŚWIETLANA w nagłówkach dni widoku tygodnia/dnia
 * i w komórkach miesiąca. Liczy roboczogodziny: bloki (`dayTotal`) + spotkania
 * i wystąpienia zadań cyklicznych × liczba OSÓB w zakresie. URLOP celowo NIE
 * wchodzi (nieobecność to nie praca).
 *
 * Wagi osobowe: spotkanie imienne = uczestnicy (∩ filtr, gdy aktywny);
 * spotkanie OGÓLNOFIRMOWE (`attendeeIds` puste) = wszyscy w zakresie (rozmiar
 * filtra, bez filtra cały zespół); wystąpienie cykliczne = przypisani do
 * zadania (∩ filtr) — zadanie cykliczne bez przypisanych nie wnosi godzin.
 *
 * To WYŁĄCZNIE pochodna suma prezentacyjna: `dayTotal`, przeciążenie, kolizje
 * i wszystkie ścieżki planowania nadal czytają wyłącznie `WorkloadEntry`
 * (inwariant 1 dla logiki planowania zostaje nietknięty).
 */
export function calendarDayVolume(
  state: AppData,
  date: DateStr,
  personFilter?: Set<string>,
): number {
  return calendarDayVolumeCache(state, argsKey(date, filterKey(personFilter)));
}

/**
 * Urlop TEJ osoby w TYM dniu (albo `null`). Czyta dokładnie ten sam indeks, co
 * kolizja — dzięki temu jawne straże reduktora (`INSERT_BLOCK`,
 * `REASSIGN_ENTRY`) i bramki UI nie mogą rozjechać się z
 * {@link blockCollidesWithEvent}, który łapie urlop automatycznie jako
 * wystąpienie 0-1440. Zwraca ENCJĘ, żeby komunikat mógł nazwać zakres dat.
 */
export function personVacationOnDate(
  state: AppData,
  personId: string,
  date: DateStr,
): CalendarEvent | null {
  if (personId === '' || !isValidDateStr(date)) return null;
  for (const occ of calendarEventsForDate(state, date, new Set([personId]))) {
    if (occ.event.kind === 'urlop') return occ.event;
  }
  return null;
}

/**
 * Dzieli dni PRZECIĄŻONE osoby na urlopowe i nieurlopowe (D8). Czysty helper,
 * bo tę samą decyzję podejmują trzy powierzchnie wskaźnika (tabela obciążenia,
 * flaga przy nazwisku, pasek tygodnia w profilu): w dzień urlopu wykrzyknik
 * zastępuje palma, w pozostałe dni nic się nie zmienia.
 */
export function splitOverloadedDaysByVacation(
  state: AppData,
  personId: string,
  overloadedDays: readonly DateStr[],
): { vacation: DateStr[]; overload: DateStr[] } {
  const vacation: DateStr[] = [];
  const overload: DateStr[] = [];
  for (const date of overloadedDays) {
    if (personVacationOnDate(state, personId, date) !== null) vacation.push(date);
    else overload.push(date);
  }
  return { vacation, overload };
}

/**
 * Czy scalenie bloków w przedział [mergedStart, mergedEnd) przykryłoby
 * wydarzenie lub wystąpienie zadania cyklicznego zajmujące TĘ osobę tego dnia?
 * Wydarzenia/wystąpienia są czysto prezentacyjne (inwariant 1) i nigdy nie
 * kolidują z blokami — ale scalenie (funkcja intencjonalna) NIE MOŻE po cichu
 * połknąć spotkania, wokół którego użytkownik rozdzielił dwa bloki. Stykająca
 * się krawędź nie jest przykryciem (rangesOverlap traktuje styk jako brak kolizji).
 *
 * UWAGA po wprowadzeniu kolizji zadanie↔wydarzenie: połowa WYDARZENIOWA tej
 * straży jest przez `SET_BLOCK_TIME` praktycznie nieosiągalna — dwa stykające się
 * bloki szczelnie wypełniają scalony przedział, więc wydarzenie leżące w środku
 * nachodzi na jeden z nich i `blockCollidesWithEvent` odrzuca upuszczenie
 * wcześniej. Zostaje tu celowo jako obrona w głąb i dla ewentualnych przyszłych
 * ścieżek scalania. Połowa CYKLICZNA jest nadal w pełni żywa: wystąpienia zadań
 * cyklicznych nie blokują upuszczania.
 */
export function mergeCoversEventOrRecurrence(
  state: AppData,
  personId: string,
  date: DateStr,
  mergedStart: number,
  mergedEnd: number,
): boolean {
  const forPerson = new Set([personId]);
  for (const occ of calendarEventsForDate(state, date, forPerson)) {
    // Nieobecność zwalnia slot — scalenie nad takim wystąpieniem jest legalne.
    if (personAbsentFromEventOccurrence(occ.event, date, personId)) continue;
    if (rangesOverlap(mergedStart, mergedEnd, occ.startMinutes, occ.startMinutes + occ.durationMinutes)) {
      return true;
    }
  }
  for (const { occurrence } of recurrenceOccurrencesForDate(state, date, forPerson)) {
    if (rangesOverlap(mergedStart, mergedEnd, occurrence.startMinutes, occurrence.startMinutes + occurrence.durationMinutes)) {
      return true;
    }
  }
  return false;
}

/** Co dokładnie zajmuje czas osoby w kolidującym zakresie. */
export type ScheduleConflictKind = 'block' | 'event' | 'urlop' | 'recurrence';

/**
 * Jedna kolidująca pozycja. Nośnik KOMUNIKATU (kto, co, kiedy), nie decyzji —
 * o blokowaniu rozstrzyga wywołujący, bo próg jest różny dla wydarzenia
 * imiennego i ogólnofirmowego (patrz {@link eventDraftConflicts}).
 */
export interface ScheduleConflict {
  kind: ScheduleConflictKind;
  personId: string;
  /** Nazwa osoby; '' gdy osoba zniknęła ze stanu (łagodna degradacja). */
  personName: string;
  /** Tytuł zadania albo wydarzenia; '' gdy źródło zniknęło. */
  title: string;
  startMinutes: number;
  durationMinutes: number;
  /** Dzień kolizji — obecny TYLKO w ścieżce symulacji serii cyklicznej
   *  ({@link eventDraftConflicts}), gdzie kolizje z różnych wystąpień muszą
   *  dać się wymienić z datą. Jednodniowe ścieżki go nie ustawiają. */
  date?: DateStr;
}

/**
 * Wszystko, co zajmuje czas WSKAZANYCH osób w [startMinutes, +durationMinutes)
 * danego dnia: realne bloki kalendarza (`WorkloadEntry`), wydarzenia oraz
 * wystąpienia zadań cyklicznych. Czysta funkcja odczytu — nie liczy godzin ani
 * przeciążenia, więc inwariant 1 zostaje nietknięty (godziny nadal żyją tylko
 * w `WorkloadEntry`).
 *
 * Stykająca się krawędź NIE jest kolizją (`rangesOverlap`), więc blok 9:00–10:00
 * i spotkanie 10:00–11:00 przechodzą — dokładnie jak w modelu przeciągania.
 *
 * `personIds` jest deduplikowane; nieznane id po prostu nie wnosi konfliktów.
 */
export function scheduleConflictsForRange(
  state: AppData,
  personIds: readonly string[],
  date: DateStr,
  startMinutes: number,
  durationMinutes: number,
  opts?: {
    /** Wydarzenie edytowane — nie może kolidować samo ze sobą. */
    excludeEventId?: string;
    /** Blok przenoszony — nie może kolidować sam ze sobą. */
    excludeEntryId?: string;
  },
): ScheduleConflict[] {
  const end = startMinutes + durationMinutes;
  const out: ScheduleConflict[] = [];
  const seenPeople = new Set<string>();

  for (const personId of personIds) {
    if (seenPeople.has(personId)) continue;
    seenPeople.add(personId);
    const personName = getPerson(state, personId)?.name ?? '';
    const forPerson = new Set([personId]);

    for (const block of blocksForPersonDate(state, personId, date)) {
      if (opts?.excludeEntryId !== undefined && block.id === opts.excludeEntryId) continue;
      const blockEndMin = blockEndMinutes(block.startMinutes, block.plannedHours);
      if (!rangesOverlap(startMinutes, end, block.startMinutes, blockEndMin)) continue;
      out.push({
        kind: 'block',
        personId,
        personName,
        title: getTask(state, block.taskId)?.title ?? '',
        startMinutes: block.startMinutes,
        durationMinutes: blockEndMin - block.startMinutes,
      });
    }

    for (const occ of calendarEventsForDate(state, date, forPerson)) {
      if (opts?.excludeEventId !== undefined && occ.event.id === opts.excludeEventId) continue;
      // Osoba nieobecna w tym wystąpieniu nie jest przez nie zajęta.
      if (personAbsentFromEventOccurrence(occ.event, date, personId)) continue;
      if (!rangesOverlap(startMinutes, end, occ.startMinutes, occ.startMinutes + occ.durationMinutes)) {
        continue;
      }
      out.push({
        kind: occ.event.kind === 'urlop' ? 'urlop' : 'event',
        personId,
        personName,
        title: occ.event.title,
        startMinutes: occ.startMinutes,
        durationMinutes: occ.durationMinutes,
      });
    }

    for (const { task, occurrence } of recurrenceOccurrencesForDate(state, date, forPerson)) {
      if (!rangesOverlap(startMinutes, end, occurrence.startMinutes, occurrence.startMinutes + occurrence.durationMinutes)) {
        continue;
      }
      out.push({
        kind: 'recurrence',
        personId,
        personName,
        title: task.title,
        startMinutes: occurrence.startMinutes,
        durationMinutes: occurrence.durationMinutes,
      });
    }
  }

  return out;
}

/** Wynik kontroli draftu wydarzenia: co blokuje zapis, a co tylko informuje. */
export interface EventConflictReport {
  /** Niepuste => zapis MUSI zostać odrzucony (reduktor + bramka UI). */
  blocking: ScheduleConflict[];
  /** Wyłącznie informacyjne — zapis przechodzi. */
  warning: ScheduleConflict[];
}

/**
 * Kolizje draftu wydarzenia, z PROGIEM zależnym od listy uczestników:
 *
 * - Uczestnicy IMIENNI (`attendeeIds` niepuste; ZMIANA 2026-08-06): kolizja
 *   z zadaniem/wydarzeniem/wystąpieniem cyklicznym => OSTRZEŻENIE, którego
 *   zapis wymaga POTWIERDZENIA w EventModal (dialog „Dodaj mimo kolizji");
 *   twardo BLOKUJE wyłącznie urlop uczestnika. Poprzednio (2026-07-30) każda
 *   kolizja imienna blokowała — realny zespół świadomie nakłada spotkania.
 * - Wydarzenie OGÓLNOFIRMOWE (`attendeeIds` puste) => kolizja tylko OSTRZEGA.
 *   Twarda blokada liczona po wszystkich osobach czyniłaby spotkanie całofirmowe
 *   praktycznie niemożliwym do wstawienia w godzinach pracy: wystarczyłaby jedna
 *   zajęta osoba z kilkunastu.
 *
 * ZAKRES DATY: sprawdzana jest WYŁĄCZNIE data kotwicy draftu. Dla wydarzenia
 * cyklicznego pozostałe wystąpienia nie są kontrolowane — kontrola wszystkich
 * przyszłych wystąpień blokowałaby niemal każdą regułę i wymagałaby horyzontu,
 * którego model nie ma.
 *
 * URLOP jest TRZECIM progiem (D4): liczy kolizje KAŻDEGO dnia zakresu
 * `date..endDate`, ale zawsze jako `warning`. Twarda blokada po wszystkich
 * dniach czyniłaby dłuższy urlop niewstawialnym — najpierw rejestruje się
 * urlop, potem przeplanowuje pracę. Kierunek odwrotny (spotkanie w czyjś dzień
 * urlopu) zostaje twardy i wychodzi sam z pełnodniowego wystąpienia.
 */
/**
 * Horyzont symulacji kolizji serii cyklicznej: pół roku od kotwicy draftu.
 * `until` reguły krótszy niż horyzont przycina go naturalnie
 * (expandOccurrences); dłuższe serie ostrzegają o pierwszym półroczu.
 */
export const RECURRING_CONFLICT_HORIZON_DAYS = 183;

export function eventDraftConflicts(
  state: AppData,
  draft: {
    date: DateStr;
    startMinutes: number;
    durationMinutes: number;
    attendeeIds: readonly string[];
    kind?: 'urlop';
    /** `null` (kształt draftu z modala) czyta się jak brak zakresu. */
    endDate?: DateStr | null;
    /** Reguła cykliczności draftu; `null`/brak = wydarzenie jednorazowe. */
    recurrence?: TaskRecurrence | null;
  },
  excludeEventId?: string,
): EventConflictReport {
  const opts = excludeEventId !== undefined ? { excludeEventId } : undefined;

  // WYDARZENIE CYKLICZNE (2026-08-04, decyzja usera): kolizje NIE blokują
  // zapisu — pojedynczy zajęty tydzień (np. czyjś urlop) nie może
  // uniemożliwić serii planowanej na pół roku. Zamiast tego SYMULUJEMY
  // wystąpienia w horyzoncie {@link RECURRING_CONFLICT_HORIZON_DAYS}
  // (`until` reguły przycina go naturalnie w expandOccurrences) i zwracamy
  // wszystkie kolizje jako OSTRZEŻENIA z datą wystąpienia, żeby modal mógł
  // wymienić: „koliduje w tym i tym terminie z zadaniem tej osoby".
  // Ogólnofirmowe cykliczne liczy się po wszystkich osobach — jak dotąd próg
  // był i pozostaje wyłącznie ostrzegawczy.
  if (draft.kind !== 'urlop' && draft.recurrence != null) {
    const companyWide = draft.attendeeIds.length === 0;
    const personIds = companyWide ? state.people.map((p) => p.id) : draft.attendeeIds;
    const horizonEnd = addDaysStr(draft.date, RECURRING_CONFLICT_HORIZON_DAYS);
    const warning: ScheduleConflict[] = [];
    for (const occ of expandOccurrences(draft.recurrence, draft.date, draft.date, horizonEnd)) {
      for (const c of scheduleConflictsForRange(
        state,
        personIds,
        occ.date,
        occ.startMinutes,
        occ.durationMinutes,
        opts,
      )) {
        warning.push({ ...c, date: occ.date });
      }
    }
    return { blocking: [], warning };
  }

  if (draft.kind === 'urlop') {
    const warning: ScheduleConflict[] = [];
    const last = draft.endDate ?? draft.date;
    // Cap 92 dni (forma kanoniczna) ogranicza tę pętlę; strażnik `guard` chroni
    // przed niekanonicznym draftem z UI, zanim normalizacja go odrzuci.
    for (let date = draft.date, guard = 0; date <= last && guard <= MAX_VACATION_DAYS; date = addDaysStr(date, 1), guard++) {
      warning.push(
        ...scheduleConflictsForRange(
          state,
          draft.attendeeIds,
          date,
          draft.startMinutes,
          draft.durationMinutes,
          opts,
        ),
      );
    }
    return { blocking: [], warning };
  }

  const companyWide = draft.attendeeIds.length === 0;
  const personIds = companyWide ? state.people.map((p) => p.id) : draft.attendeeIds;
  const conflicts = scheduleConflictsForRange(
    state,
    personIds,
    draft.date,
    draft.startMinutes,
    draft.durationMinutes,
    opts,
  );
  if (companyWide) return { blocking: [], warning: conflicts };
  // IMIENNI (ZMIANA 2026-08-06, decyzja usera — poprzednio każda kolizja
  // blokowała): kolizja z zadaniem, wydarzeniem lub wystąpieniem cyklicznym
  // uczestnika schodzi do OSTRZEŻENIA — zapis przechodzi, ale EventModal
  // wymaga świadomego POTWIERDZENIA w dialogu (bramka UX; reduktor przepuszcza).
  // Twardo blokuje wyłącznie URLOP uczestnika: dzień nieobecności nie podlega
  // negocjacji z poziomu kalendarza (symetria z progiem zapisu urlopu, gdzie
  // kierunek „spotkanie w czyjś dzień urlopu" był i pozostaje blokujący).
  return {
    blocking: conflicts.filter((c) => c.kind === 'urlop'),
    warning: conflicts.filter((c) => c.kind !== 'urlop'),
  };
}

/**
 * Czy blok [startMinutes, +plannedHours) tej osoby wchodziłby na jej WYDARZENIE
 * tego dnia? Strażnik kierunku „zadanie → wydarzenie" w kalendarzu.
 *
 * Świadomie NIE obejmuje wystąpień zadań cyklicznych: te zostają czysto
 * prezentacyjne (inwariant 1) i nigdy nie wchodzą do modelu przeciągania.
 * Wchodzą natomiast do {@link scheduleConflictsForRange}, bo tam służą tylko do
 * OPISANIA konfliktu przy zapisie wydarzenia, a nie do blokowania przeciągania.
 *
 * Wydarzenie OGÓLNOFIRMOWE (`attendeeIds` puste) NIE blokuje NIKOGO
 * (2026-08-03): blokada dotyczy wyłącznie osób imiennie przypisanych do
 * wydarzenia — symetrycznie do progu przy zapisie takiego wydarzenia
 * ({@link eventDraftConflicts}: ogólnofirmowe tylko ostrzega). Urlop ma zawsze
 * dokładnie jednego uczestnika, więc ten filtr nigdy go nie pomija.
 */
export function blockCollidesWithEvent(
  state: AppData,
  personId: string,
  date: DateStr,
  startMinutes: number,
  plannedHours: number,
): boolean {
  const end = blockEndMinutes(startMinutes, plannedHours);
  for (const occ of calendarEventsForDate(state, date, new Set([personId]))) {
    if (occ.event.attendeeIds.length === 0) continue;
    // Nieobecność w TYM wystąpieniu zwalnia slot tej osoby (sedno funkcji).
    if (personAbsentFromEventOccurrence(occ.event, date, personId)) continue;
    if (rangesOverlap(startMinutes, end, occ.startMinutes, occ.startMinutes + occ.durationMinutes)) {
      return true;
    }
  }
  return false;
}

/**
 * A person's day agenda for the dashboard "Zadania na dziś" section. Pure.
 * - `timed`: that person's dated (non-bin) workload entries on `date`, ascending
 *   `startMinutes` (ties by `sortIndex`) — the calendar order IS the priority.
 * - `dateless`: tasks the person is assigned to whose deadline (`endDate`) IS
 *   `date` but which have NO entry for that person that day, excluding
 *   done-status tasks (any status with `isDone`, via `doneStatusIds`), sorted
 *   by title. Tasks merely *spanning* `date` stay out — otherwise a multi-day
 *   task without calendar blocks would show up in the agenda every single day.
 * There is intentionally no priority field — ordering is derived here only.
 * Cached per `(state, personId, date)` — the returned object and both of its
 * lists keep a STABLE reference for one state revision.
 */
const todayAgendaForPersonCache = createKeyedCache<{
  timed: WorkloadEntry[];
  dateless: Task[];
}>((state, key) => {
  const [personId, date] = key.split(' ');
  // Sort a COPY of the (person, date) index bucket — it is shared.
  const timed = [...personDateEntries(state, key)].sort(
    (a, b) => a.startMinutes - b.startMinutes || a.sortIndex - b.sortIndex,
  );

  const doneIds = doneStatusIds(state);
  const timedTaskIds = new Set(timed.map((w) => w.taskId));
  const assignedTaskIds = new Set(taskIdsOfPerson(state, personId));

  const dateless = state.tasks
    .filter(
      (t) =>
        assignedTaskIds.has(t.id) &&
        isPublishedTask(t) && // szkic nie trafia do agendy „na dziś”
        t.endDate === date &&
        !doneIds.has(t.statusId) &&
        !timedTaskIds.has(t.id),
    )
    .sort((a, b) => a.title.localeCompare(b.title)); // endDate === date dla wszystkich

  return { timed, dateless };
});

export function todayAgendaForPerson(
  state: AppData,
  personId: string,
  date: DateStr,
): { timed: WorkloadEntry[]; dateless: Task[] } {
  return todayAgendaForPersonCache(state, argsKey(personId, date));
}

/**
 * A person's dated blocks for each of `dates`, keyed by date string, each day's
 * entries sorted ascending by `startMinutes` (ties by `sortIndex`). Days with no
 * blocks map to an empty array. Pure — keeps the dashboard week strip
 * selector-only.
 */
export function weekBlocksForPerson(
  state: AppData,
  personId: string,
  dates: DateStr[],
): Map<DateStr, WorkloadEntry[]> {
  const map = new Map<DateStr, WorkloadEntry[]>();
  for (const d of dates) {
    const blocks = state.workload
      .filter((w) => w.personId === personId && w.date === d)
      .sort((a, b) => a.startMinutes - b.startMinutes || a.sortIndex - b.sortIndex);
    map.set(d, blocks);
  }
  return map;
}

// ---- Bin (zasobnik) — dateless unassigned entries ----

const binEntriesForPersonCache = createKeyedCache<WorkloadEntry[]>((state, personId) =>
  // Sort a COPY: `binByPersonId` buckets are shared, source-ordered indexes.
  [...(workloadIndex(state.workload).binByPersonId.get(personId) ?? EMPTY_ENTRIES)].sort(
    (a, b) => a.sortIndex - b.sortIndex,
  ),
);

/** A person's bin entries (date === ''), ordered by their bin sortIndex. */
export function binEntriesForPerson(state: AppData, personId: string): WorkloadEntry[] {
  return binEntriesForPersonCache(state, personId);
}

/** A task's bin entries (any person). */
export function binEntriesForTask(state: AppData, taskId: string): WorkloadEntry[] {
  return state.workload.filter((w) => w.taskId === taskId && isBinEntry(w));
}

const binTotalForPersonCache = createKeyedCache<number>((state, personId) =>
  binEntriesForPerson(state, personId).reduce((sum, w) => sum + w.plannedHours, 0),
);

/** Summed hours a person has sitting in their bin. */
export function binTotalForPerson(state: AppData, personId: string): number {
  return binTotalForPersonCache(state, personId);
}

/**
 * The single bin (zasobnik) entry for a (task, person) pair, if any. Invariant
 * (PKG-20260708-budget-store): at most one bin row per (taskId, personId) — this
 * returns the first by sortIndex to stay deterministic even if a stray duplicate
 * slips in before the next normalize pass.
 */
export function binEntryForTaskPerson(
  state: AppData,
  taskId: string,
  personId: string,
): WorkloadEntry | undefined {
  return state.workload
    .filter((w) => w.taskId === taskId && w.personId === personId && isBinEntry(w))
    .sort((a, b) => a.sortIndex - b.sortIndex)[0];
}

/** Summed bin hours for a (task, person) pair (post-invariant: a single row). */
export function binHoursForTaskPerson(
  state: AppData,
  taskId: string,
  personId: string,
): number {
  return state.workload
    .filter((w) => w.taskId === taskId && w.personId === personId && isBinEntry(w))
    .reduce((sum, w) => sum + w.plannedHours, 0);
}

/**
 * A task's hour budget derived from its optional estimate.
 * - `estimate`: the task's `estimatedHours` (null ⇒ no budget).
 * - `totalAll`: sum of ALL the task's workload entries (dated + bin, all people).
 * - `headroom`: `max(0, estimate − totalAll)`, or 0 when there is no estimate.
 */
export function taskBudget(
  state: AppData,
  taskId: string,
): { estimate: number | null; totalAll: number; headroom: number } {
  const estimate = getTask(state, taskId)?.estimatedHours ?? null;
  const totalAll = taskPlannedTotal(state, taskId);
  const headroom = estimate === null ? 0 : Math.max(0, estimate - totalAll);
  return { estimate, totalAll, headroom };
}

/**
 * The calendar-side hour allowance for a `(task, person)` pair — the ceiling on
 * how many hours calendar actions (drag-grow, right-click insert) may add for
 * that person without minting hours past the task's plan.
 *
 * Budget model (PKG-20260708-b2-budget-store): the task's plan IS the budget.
 * Calendar paths never create hours out of thin air; they may only draw from
 * this person's same-task bin row, plus — for tasks that carry an estimate —
 * the task's remaining headroom:
 *
 *   `binHoursForTaskPerson + (estimate === null ? 0 : headroom)`
 *
 * A number is ALWAYS returned. Tasks with `estimatedHours === null` no longer
 * grow freely: their allowance is bin hours only (0 when the bin row is empty).
 */
export function taskGrowAllowance(state: AppData, taskId: string, personId: string): number {
  const budget = taskBudget(state, taskId);
  return (
    binHoursForTaskPerson(state, taskId, personId) +
    (budget.estimate === null ? 0 : budget.headroom)
  );
}

/**
 * How many hours a block may GROW BY (the grow DELTA, not the block's absolute
 * size) before it would mint hours past the task budget. Delegates to
 * {@link taskGrowAllowance} for the entry's `(task, person)` pair; a missing
 * entry ⇒ 0. Always a number (never null — the old "no estimate ⇒ unlimited"
 * rule is gone).
 */
export function growAllowanceHours(state: AppData, entryId: string): number {
  const entry = state.workload.find((w) => w.id === entryId);
  if (!entry) return 0;
  return taskGrowAllowance(state, entry.taskId, entry.personId);
}

// ---- Planning status (derived, never stored) ----

/**
 * A task's derived "planning status" — is its work scheduled onto calendar days?
 * The four values ARE the exact Polish display labels (lowercase, by design).
 * This is a derived concept and deliberately lives here, not in `types.ts`
 * (which holds only stored shapes) — nothing here is ever persisted.
 */
export type PlanningStatus =
  | 'nie rozplanowano'
  | 'częściowo'
  | 'rozplanowano'
  | 'przekroczono';

/** The planning statuses in canonical order (empty → over-budget spectrum). */
export const PLANNING_STATUSES: PlanningStatus[] = [
  'nie rozplanowano',
  'częściowo',
  'rozplanowano',
  'przekroczono',
];

/** Float-drift epsilon — matches TaskModal's `overBudget` guard. Hours already
 * snap to 0.25 on write paths, so this only absorbs binary rounding noise. */
const PLANNING_EPS = 1e-9;

/**
 * Pure core of the planning-status rule: plain numbers in, label out. This is
 * what TaskModal calls with DRAFT totals and what unit tests hammer directly.
 *
 * Inputs (over ALL people for a task):
 * - `estimate` — the task's `estimatedHours` (`null` ⇒ no target to hit).
 * - `datedHours` — Σ planned hours of entries with a real date (`!isBinEntry`).
 * - `binHours` — Σ planned hours of the task's zasobnik (bin) entries.
 *
 * With `total = datedHours + binHours` and `EPS = 1e-9`, the rules are
 * evaluated in this precedence order (first match wins):
 *
 * 1. `total <= EPS` → **nie rozplanowano** — nothing planned at all (regardless
 *    of estimate). Matches the "Bez planu" alert rule where bin rows count as
 *    planned.
 * 2. `estimate != null && total > estimate + EPS` → **przekroczono** — the plan
 *    (dated + bin) exceeds the estimate. Same condition as TaskModal's
 *    over-budget banner, whether the excess sits in the grid or the bin.
 * 3. `binHours > EPS` → **częściowo** — hours are allocated but some still sit
 *    in the zasobnik ("nierozplanowane"); a task with bin hours is never
 *    "rozplanowano".
 * 4. `estimate == null` → **rozplanowano** — no target to fall short of, and
 *    everything that exists is on calendar days.
 * 5. `datedHours >= estimate - EPS` → **rozplanowano** — the estimate is fully
 *    placed on calendar days (bin is 0 here by rule 3; dated can't exceed
 *    estimate + EPS by rule 2).
 * 6. otherwise → **częściowo** — some dated hours, under the estimate, empty bin.
 *
 * Worked edge cases:
 * - null estimate + 0 hours → nie rozplanowano; null estimate + bin-only →
 *   częściowo; null estimate + dated-only → rozplanowano.
 * - est 8, dated 0, bin 3 → częściowo. est 8, dated 5, bin 3 (total == est) →
 *   częściowo (bin still unscheduled). est 8, dated 8, bin 0 → rozplanowano.
 *   est 8, dated 8, bin 1 → przekroczono. est 8, dated 9, bin 0 → przekroczono.
 */
export function planningStatusForTotals(
  estimate: number | null,
  datedHours: number,
  binHours: number,
): PlanningStatus {
  const dated = Math.max(0, datedHours);
  const bin = Math.max(0, binHours);
  const total = dated + bin;

  if (total <= PLANNING_EPS) return 'nie rozplanowano';
  if (estimate != null && total > estimate + PLANNING_EPS) return 'przekroczono';
  if (bin > PLANNING_EPS) return 'częściowo';
  if (estimate == null) return 'rozplanowano';
  if (dated >= estimate - PLANNING_EPS) return 'rozplanowano';
  return 'częściowo';
}

/**
 * A task's planning status derived from its stored workload entries. Splits the
 * task's entries into dated vs bin (`isBinEntry`) and delegates to
 * {@link planningStatusForTotals}. A missing task ⇒ estimate treated as null.
 * Pure — no `Date` usage.
 */
export function taskPlanningStatus(state: AppData, taskId: string): PlanningStatus {
  const estimate = getTask(state, taskId)?.estimatedHours ?? null;
  let dated = 0;
  let bin = 0;
  for (const w of entriesForTask(state, taskId)) {
    if (isBinEntry(w)) bin += w.plannedHours;
    else dated += w.plannedHours;
  }
  return planningStatusForTotals(estimate, dated, bin);
}

/**
 * Presentational status of a single task, shared by the calendar blocks and bin
 * cards: `done` when its status carries `isDone` (invariant 5 — completion is
 * NEVER derived from pipeline order), `overdue` when `endDate` is strictly
 * before `today` and the status is not done, otherwise `open`. Pure — pass
 * `today` (no `Date.now`).
 */
export function taskDisplayStatus(
  state: AppData,
  task: Task,
  today: DateStr,
): 'done' | 'overdue' | 'open' {
  if (isDoneStatus(state, task.statusId)) return 'done';
  return task.endDate < today ? 'overdue' : 'open';
}

/**
 * Whether a SINGLE calendar/bin block is done (PKG-20260721-per-block-done).
 * A block is done when it carries its OWN `done` flag OR when the parent task's
 * status is a done status (a done task lights ALL its blocks — invariant 5 stays
 * status-driven at the task level). The per-block flag is INDEPENDENT: two blocks
 * on the same day render independent done state, and marking one done never
 * changes `task.statusId`. Pure — no `Date.now`, no task-status mutation.
 */
export function blockIsDone(state: AppData, task: Task, entry: WorkloadEntry): boolean {
  return entry.done === true || isDoneStatus(state, task.statusId);
}

/**
 * Wystąpienie cyklicznego zadania jest zrobione, gdy jego wyjątek tak mówi LUB
 * status zadania jest „zrobiony" (lustro {@link blockIsDone}): done-status
 * podświetla CAŁĄ serię, a per-wystąpieniowa flaga jest niezależna i NIGDY nie
 * zmienia `task.statusId`. Czysto prezentacyjne (inwariant 1).
 */
export function occurrenceIsDone(
  state: AppData,
  task: Task,
  occurrence: RecurrenceOccurrence,
): boolean {
  return occurrence.done === true || isDoneStatus(state, task.statusId);
}

// ---- Moja praca (my-work page) ----

/**
 * Tasks the person is assigned to that are past due: `endDate < today` and not
 * in a done status. Sorted by `endDate` ascending, then title. Pure — pass
 * `today` (no `Date.now`).
 */
const overdueTasksForPersonCache = createKeyedCache<Task[]>((state, key) => {
  const [personId, today] = key.split(' ');
  const doneIds = doneStatusIds(state);
  const assignedTaskIds = new Set(taskIdsOfPerson(state, personId));
  return state.tasks
    .filter(
      (t) =>
        assignedTaskIds.has(t.id) &&
        isPublishedTask(t) && // szkic nie jest „po terminie” w Mojej pracy
        t.endDate < today &&
        !doneIds.has(t.statusId),
    )
    .sort((a, b) => a.endDate.localeCompare(b.endDate) || a.title.localeCompare(b.title));
});

export function overdueTasksForPerson(
  state: AppData,
  personId: string,
  today: DateStr,
): Task[] {
  return overdueTasksForPersonCache(state, argsKey(personId, today));
}

/**
 * The subset of `dates` where the person is overbooked — booked hours strictly
 * exceed that day's AVAILABILITY (capacity on a workday, 0 otherwise), per
 * {@link dayAvailabilityForPerson}. Bin rows (date === '') can never match a
 * real date, so they are naturally excluded. Pure.
 */
export function overloadedDatesForPersonInRange(
  state: AppData,
  personId: string,
  dates: DateStr[],
): DateStr[] {
  return dates.filter((d) => dayAvailabilityForPerson(state, personId, d).overbooked);
}

/**
 * Tasks the person is assigned to, not done, for which the person has ZERO
 * workload rows (neither dated nor bin) — i.e. nothing planned yet. Sorted by
 * `endDate` ascending, then title. Pure.
 */
const unplannedTasksForPersonCache = createKeyedCache<Task[]>((state, personId) => {
  const doneIds = doneStatusIds(state);
  const assignedTaskIds = new Set(taskIdsOfPerson(state, personId));
  const plannedTaskIds = new Set(
    state.workload.filter((w) => w.personId === personId).map((w) => w.taskId),
  );
  return state.tasks
    .filter(
      (t) =>
        assignedTaskIds.has(t.id) &&
        isPublishedTask(t) && // szkic nie jest „bez planu” — planuje się po publikacji
        !doneIds.has(t.statusId) &&
        !plannedTaskIds.has(t.id),
    )
    .sort((a, b) => a.endDate.localeCompare(b.endDate) || a.title.localeCompare(b.title));
});

export function unplannedTasksForPerson(state: AppData, personId: string): Task[] {
  return unplannedTasksForPersonCache(state, personId);
}

/**
 * A person's bin (zasobnik) contents grouped as task-level rows: one row per
 * task with the summed bin hours (defensive sum even though the invariant is one
 * bin row per task+person). Rows keep the bin `sortIndex` order of each task's
 * first entry. Entries whose task no longer resolves are silently skipped. Pure.
 */
const binTaskRowsForPersonCache = createKeyedCache<Array<{ task: Task; hours: number }>>(
  (state, personId) => {
    const rows: Array<{ task: Task; hours: number }> = [];
    const indexByTask = new Map<string, number>();
    for (const entry of binEntriesForPerson(state, personId)) {
      const existing = indexByTask.get(entry.taskId);
      if (existing !== undefined) {
        rows[existing].hours += entry.plannedHours;
        continue;
      }
      const task = getTask(state, entry.taskId);
      if (!task) continue; // stale bin row — skip
      indexByTask.set(entry.taskId, rows.length);
      rows.push({ task, hours: entry.plannedHours });
    }
    return rows;
  },
);

export function binTaskRowsForPerson(
  state: AppData,
  personId: string,
): Array<{ task: Task; hours: number }> {
  return binTaskRowsForPersonCache(state, personId);
}

// ---- Capacity & overload ----

export const OVERLOAD_THRESHOLD = DEFAULT_CAPACITY;

/** A person's daily capacity in hours (falls back to the 8h default). */
export function personCapacity(state: AppData, personId: string): number {
  const p = getPerson(state, personId);
  return p && p.capacity > 0 ? p.capacity : DEFAULT_CAPACITY;
}

const overloadedPeopleOnDateCache = createKeyedCache<string[]>((state, key) => {
  const [date, fk] = key.split(' ');
  const personFilter = personFilterFromKey(fk);
  const relevant =
    personFilter.size > 0
      ? state.people.filter((p) => personFilter.has(p.id))
      : state.people;
  return relevant
    .filter((p) => dayAvailabilityForPerson(state, p.id, date).overbooked)
    .map((p) => p.id);
});

/** People (ids) overbooked on the date (booked > that day's availability), within the filter. */
export function overloadedPeopleOnDate(
  state: AppData,
  date: DateStr,
  personFilter?: Set<string>,
): string[] {
  return overloadedPeopleOnDateCache(state, argsKey(date, filterKey(personFilter)));
}

/**
 * Osoby, których urodziny (miesiąc + dzień) wypadają na `date`. Czysto
 * prezentacyjne — kalendarz pokazuje znacznik 🎂. Bierze pod uwagę cały zespół
 * (urodziny nie zależą od filtra pracy). Kolejność jak w `state.people`
 * (stabilna). Rok urodzenia bez znaczenia; patrz {@link isBirthdayOn}.
 */
const peopleWithBirthdayOnDateCache = createKeyedCache<Person[]>((state, date) =>
  state.people.filter((p) => isBirthdayOn(p.birthDate, date)),
);

export function peopleWithBirthdayOnDate(state: AppData, date: DateStr): Person[] {
  return peopleWithBirthdayOnDateCache(state, date);
}

/**
 * Dates where someone working on THIS task that day is overbooked (booked >
 * that day's availability per {@link dayAvailabilityForPerson}). Any-assignee
 * view — use {@link conflictDatesForTaskPerson} for a single person's row.
 */
export function conflictDatesForTask(state: AppData, taskId: string): DateStr[] {
  const out = new Set<DateStr>();
  for (const w of state.workload) {
    if (w.taskId !== taskId || isBinEntry(w)) continue; // bin entries have no date -> never an overload date
    if (out.has(w.date)) continue;
    if (dayAvailabilityForPerson(state, w.personId, w.date).overbooked) {
      out.add(w.date);
    }
  }
  return [...out].sort();
}

/**
 * Person-scoped conflict dates for a task: dates where THIS person works on the
 * task and is overbooked that day (their whole-day total, all tasks, against
 * their availability). Another assignee's overload never appears here — the
 * timeline people-mode rows use this so one person's conflict does not bleed
 * onto a co-assignee's row.
 */
export function conflictDatesForTaskPerson(
  state: AppData,
  taskId: string,
  personId: string,
): DateStr[] {
  const out = new Set<DateStr>();
  for (const w of state.workload) {
    if (w.taskId !== taskId || w.personId !== personId || isBinEntry(w)) continue;
    if (out.has(w.date)) continue;
    if (dayAvailabilityForPerson(state, personId, w.date).overbooked) {
      out.add(w.date);
    }
  }
  return [...out].sort();
}

// ---- Comments & activity ----

export function commentsFor(
  state: AppData,
  entityType: CommentEntityType,
  entityId: string,
): Comment[] {
  return state.comments
    .filter((c) => c.entityType === entityType && c.entityId === entityId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function activityFor(
  state: AppData,
  entityType: CommentEntityType,
  entityId: string,
): ActivityEvent[] {
  return state.activity
    .filter((e) => e.entityType === entityType && e.entityId === entityId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// ---- Global search ----

export type SearchGroupKey = 'projects' | 'tasks' | 'clients' | 'people';

/** Czy grupa została UCIĘTA przez limit (jest co najmniej jeden wynik więcej). */
export type SearchHasMore = Record<SearchGroupKey, boolean>;

export interface SearchResults {
  projects: Project[];
  tasks: Task[];
  clients: Client[];
  people: Person[];
  hasMore: SearchHasMore;
}

/** Limit wspólny dla wszystkich grup albo per-grupa (paleta rozwija jedną grupę). */
export type SearchLimits = number | Partial<Record<SearchGroupKey, number>>;

/** Ile wierszy per grupa pokazuje paleta, zanim zaproponuje „Pokaż więcej”. */
export const DEFAULT_SEARCH_LIMIT = 8;

/** Lowercase + strip diacritics so `zolty` matches `Żółty` (ł/Ł are not decomposed by NFD). */
export function normalizeSearchText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'l')
    .toLowerCase();
}

const normalize = normalizeSearchText;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Efektywny limit jednej grupy. Brak wartości => `DEFAULT_SEARCH_LIMIT`,
 * `Infinity` => bez limitu, wartość ujemna => 0 (grupa schowana, ale `hasMore`
 * nadal mówi prawdę), NaN/nieskończoność ujemna => domyślny limit (zły wsad nie
 * zmienia zachowania).
 */
function groupLimit(limits: SearchLimits | undefined, key: SearchGroupKey): number {
  const raw = typeof limits === 'number' ? limits : limits?.[key];
  if (raw === undefined) return DEFAULT_SEARCH_LIMIT;
  if (raw === Number.POSITIVE_INFINITY) return raw;
  if (!Number.isFinite(raw)) return DEFAULT_SEARCH_LIMIT;
  return raw < 0 ? 0 : Math.floor(raw);
}

/**
 * Zbiera co najwyżej `limit` dopasowań i PRZERYWA skan na pierwszym nadmiarowym
 * trafieniu — dzięki temu wciśnięcie jednej litery nie przemiata całej kolekcji
 * (dawniej: `filter(...).slice(0, limit)`). Kolejność i zawartość wyniku są
 * identyczne jak przy filtrze z odcięciem; `hasMore` mówi, czy coś odpadło.
 */
function collectLimited<T>(
  rows: readonly T[],
  match: (row: T) => boolean,
  limit: number,
): { rows: T[]; hasMore: boolean } {
  const out: T[] = [];
  for (const row of rows) {
    if (!match(row)) continue;
    if (out.length >= limit) return { rows: out, hasMore: true };
    out.push(row);
  }
  return { rows: out, hasMore: false };
}

/**
 * Search projects, tasks, clients and people by a free-text query. Matches
 * normalized substrings across name/description/email/role, plus two extra
 * dimensions: a matching status name pulls in entities in that status, and a
 * `yyyy-MM-dd` query pulls in projects/tasks whose period contains that date.
 * Pure and unit-testable — no Date.now, no locale APIs beyond string normalize.
 */
export function searchAll(
  state: AppData,
  query: string,
  limits: SearchLimits = DEFAULT_SEARCH_LIMIT,
): SearchResults {
  const empty: SearchResults = {
    projects: [],
    tasks: [],
    clients: [],
    people: [],
    hasMore: { projects: false, tasks: false, clients: false, people: false },
  };
  const raw = query.trim();
  if (raw === '') return empty;

  const q = normalize(raw);

  // Statuses whose (normalized) name contains the query.
  const matchedStatusIds = new Set(
    state.statuses.filter((s) => normalize(s.name).includes(q)).map((s) => s.id),
  );

  // Date coverage: only when the raw query parses as a calendar date.
  const dateQuery = DATE_RE.test(raw) && isValidDateStr(raw) ? raw : null;

  const inPeriod = (start: DateStr, end: DateStr): boolean =>
    dateQuery !== null && start <= dateQuery && dateQuery <= end;

  const projects = collectLimited(
    state.projects,
    (p) =>
      // Utajniony projekt bez wglądu widza NIGDY nie matchuje po prawdziwej
      // nazwie/opisie (przeciek treści przez podpowiedź wyszukiwarki); zamiast
      // tego matchuje po etykiecie maskującej („projekt #2"). Status i daty to
      // jawne fakty planistyczne — zostają.
      (canViewProjectContent(state, p)
        ? normalize(p.name).includes(q) || normalize(p.description).includes(q)
        : normalize(projectDisplayName(state, p)).includes(q)) ||
      matchedStatusIds.has(p.statusId) ||
      inPeriod(p.startDate, p.endDate),
    groupLimit(limits, 'projects'),
  );

  const tasks = collectLimited(
    state.tasks,
    (t) =>
      // Szkic jest widoczny wyłącznie w widoku projektu — nie w wynikach
      // wyszukiwania (ta sama lista wykluczeń, co TasksPage/kanban/agenda).
      isPublishedTask(t) &&
      // Utajnione zadanie bez wglądu: match wyłącznie po etykiecie maskującej,
      // statusie i dacie — nigdy po prawdziwym tytule/opisie (jak projekty).
      ((canViewTaskContent(state, t)
        ? normalize(t.title).includes(q) || normalize(t.description).includes(q)
        : normalize(taskDisplayTitle(state, t)).includes(q)) ||
        matchedStatusIds.has(t.statusId) ||
        inPeriod(t.startDate, t.endDate)),
    groupLimit(limits, 'tasks'),
  );

  const clients = collectLimited(
    state.clients,
    (c) => normalize(c.name).includes(q),
    groupLimit(limits, 'clients'),
  );

  const people = collectLimited(
    state.people,
    (p) =>
      normalize(p.name).includes(q) ||
      normalize(p.email).includes(q) ||
      normalize(p.role).includes(q),
    groupLimit(limits, 'people'),
  );

  return {
    projects: projects.rows,
    tasks: tasks.rows,
    clients: clients.rows,
    people: people.rows,
    hasMore: {
      projects: projects.hasMore,
      tasks: tasks.hasMore,
      clients: clients.hasMore,
      people: people.hasMore,
    },
  };
}

/**
 * Per-render metadata the search palette needs to label its rows, precomputed in
 * a single pass so the overlay never runs per-result `getClient`/`getProject`/
 * `getStatus`/`projectsOfClient` lookups on every render (incl. arrow-key/hover
 * active-row changes). Byte-identical to the naive per-result calls: the lookup
 * maps mirror the `.find(...)` selectors (ids are unique) and
 * `clientProjectCounts` mirrors `projectsOfClient(...).length` (absent client =>
 * 0, matching `?? 0`).
 */
export interface SearchResultMeta {
  clientsById: Map<string, Client>;
  projectsById: Map<string, Project>;
  statusesById: Map<string, Status>;
  clientProjectCounts: Map<string, number>;
}

export function buildSearchResultMeta(state: AppData): SearchResultMeta {
  const clientsById = new Map(state.clients.map((c) => [c.id, c]));
  const projectsById = new Map(state.projects.map((p) => [p.id, p]));
  const statusesById = new Map(state.statuses.map((s) => [s.id, s]));
  const clientProjectCounts = new Map<string, number>();
  for (const p of state.projects) {
    clientProjectCounts.set(p.clientId, (clientProjectCounts.get(p.clientId) ?? 0) + 1);
  }
  return { clientsById, projectsById, statusesById, clientProjectCounts };
}

// ---- Permissions ----

export function currentUser(state: AppData): Person | undefined {
  return state.currentUserId ? getPerson(state, state.currentUserId) : undefined;
}

/**
 * Nieprzeczytane powiadomienia odbiorcy, NAJNOWSZE najpierw (`createdAt` malejąco,
 * tie-break po `id` dla stabilnej kolejności). Panel pokazuje pierwsze
 * `MAX_NOTIFICATIONS` (patrz `visibleNotifications`).
 */
const unreadNotificationsForPersonCache = createKeyedCache<Notification[]>((state, personId) =>
  state.notifications
    .filter((n) => n.recipientId === personId && n.readAt === '')
    .sort((a, b) =>
      a.createdAt < b.createdAt
        ? 1
        : a.createdAt > b.createdAt
          ? -1
          : a.id < b.id
            ? 1
            : a.id > b.id
              ? -1
              : 0,
    ),
);

export function unreadNotificationsForPerson(state: AppData, personId: string): Notification[] {
  return unreadNotificationsForPersonCache(state, personId);
}

/**
 * Admin gate for the admin panel and status management. With no people yet
 * there is nobody to be admin, so setup stays unlocked (prevents lockout).
 * Reimplemented on `accessRole` (v5); keeps its name/signature and the rule.
 */
export function isAdminUser(state: AppData): boolean {
  if (state.people.length === 0) return true;
  return currentUser(state)?.accessRole === 'pelne';
}

/**
 * Would setting `personId`'s supervisor to `supervisorId` create a cycle? True
 * when the supervisor is the person themselves, or when walking the supervisor
 * chain UP from `supervisorId` reaches `personId`. Pure and deterministic; a
 * pre-existing cycle that does NOT involve `personId` terminates safely (false).
 * Package 7's inline validation reuses this; the reducer uses it as a guard.
 */
export function wouldCreateSupervisorCycle(
  people: Person[],
  personId: string,
  supervisorId: string,
): boolean {
  if (!supervisorId) return false;
  if (supervisorId === personId) return true;
  const byId = new Map(people.map((p) => [p.id, p]));
  const seen = new Set<string>();
  let current: string = supervisorId;
  while (current) {
    if (current === personId) return true;
    if (seen.has(current)) return false; // pre-existing cycle, not through personId
    seen.add(current);
    current = byId.get(current)?.supervisorId ?? '';
  }
  return false;
}

// ---- Availability (workday-aware) ----

/** Is `date` one of the person's work days? (JS getDay 0=Sun mapped to ISO 7.) */
export function isPersonWorkday(state: AppData, personId: string, date: DateStr): boolean {
  const person = getPerson(state, personId);
  if (!person) return false;
  const jsDay = parseDate(date).getDay(); // 0 = Sun … 6 = Sat
  const isoDay = jsDay === 0 ? 7 : jsDay;
  return person.workDays.includes(isoDay);
}

/**
 * Available hours on a date: the person's daily capacity on a workday, else 0.
 * THE availability quantum — every availability/overbooking read derives from
 * this one rule (via {@link dayAvailabilityForPerson}); future absence data
 * plugs in here and every consumer follows.
 */
export function availableHoursOnDate(state: AppData, personId: string, date: DateStr): number {
  return isPersonWorkday(state, personId, date) ? personCapacity(state, personId) : 0;
}

/** Summed available hours across a list of dates. */
export function availableHoursInRange(
  state: AppData,
  personId: string,
  dates: DateStr[],
): number {
  return dates.reduce((sum, d) => sum + availableHoursOnDate(state, personId, d), 0);
}

/**
 * The authoritative per-day availability record for a person. A person with no
 * availability on a date (non-workday, or no workdays at all) who still has
 * booked hours is OVERBOOKED — a dangerous state, never a safe "0%" one.
 */
export interface PersonDayAvailability {
  date: DateStr;
  /** Workday per the person's `workDays`; future absence data will turn this off. */
  isWorkday: boolean;
  /** Hours the person can take on this date (0 on non-workdays). */
  availableHours: number;
  /** Σ dated planned hours across ALL tasks (bin rows never match a real date). */
  bookedHours: number;
  /** Booked strictly beyond availability — including ANY booking on a 0h day. */
  overbooked: boolean;
}

/** Build the {@link PersonDayAvailability} record for one person and date. Pure. */
export function dayAvailabilityForPerson(
  state: AppData,
  personId: string,
  date: DateStr,
): PersonDayAvailability {
  const availableHours = availableHoursOnDate(state, personId, date);
  const bookedHours = hoursForPersonOnDate(state, personId, date);
  return {
    date,
    isWorkday: isPersonWorkday(state, personId, date),
    availableHours,
    bookedHours,
    overbooked: bookedHours > availableHours,
  };
}

/** Aggregate of {@link dayAvailabilityForPerson} across a list of dates. */
export interface PersonRangeAvailability {
  availableHours: number;
  bookedHours: number;
  /** The dates whose day record is overbooked, in the order given. */
  overbookedDates: DateStr[];
}

/** Sum availability and booked hours over `dates`, collecting overbooked days. Pure. */
export function rangeAvailabilityForPerson(
  state: AppData,
  personId: string,
  dates: DateStr[],
): PersonRangeAvailability {
  let availableHours = 0;
  let bookedHours = 0;
  const overbookedDates: DateStr[] = [];
  for (const d of dates) {
    const day = dayAvailabilityForPerson(state, personId, d);
    availableHours += day.availableHours;
    bookedHours += day.bookedHours;
    if (day.overbooked) overbookedDates.push(d);
  }
  return { availableHours, bookedHours, overbookedDates };
}

/**
 * Percentage of available hours already booked, for load bars and donuts.
 * Returns `null` when hours are booked against ZERO availability — the UI must
 * render that as a danger state, never as a calm 0%. `0` booked on `0`
 * available is a genuine, safe 0.
 */
export function loadPercent(bookedHours: number, availableHours: number): number | null {
  if (availableHours > 0) return Math.round((bookedHours / availableHours) * 100);
  return bookedHours > 0 ? null : 0;
}

/** Progi JEDNEJ skali wykorzystania (procent zabukowanych godzin). */
export const LOAD_TONE_MID_PCT = 50;
export const LOAD_TONE_HIGH_PCT = 85;

/**
 * Stopień na skali WYKORZYSTANIA — jedyne wejście paska obciążenia.
 *
 * Kolor paska zależy WYŁĄCZNIE od `pct`, więc skala jest monotoniczna: 84%
 * nigdy nie wygląda spokojniej niż 75%. Sygnał „któryś dzień ponad
 * dostępnością” to OSOBNA informacja (ikona przy nazwisku, patrz
 * {@link overloadedDatesForPersonInRange}) i nie może wracać tutaj — mieszanie
 * ich było źródłem czerwonego 75% obok fioletowego 84%.
 * `null` (godziny przy zerowej dostępności) to szczyt skali, nie spokojne 0%.
 */
export type LoadTone = 'low' | 'mid' | 'high' | 'over';

export function loadTone(pct: number | null): LoadTone {
  if (pct === null || pct > 100) return 'over';
  if (pct >= LOAD_TONE_HIGH_PCT) return 'high';
  if (pct >= LOAD_TONE_MID_PCT) return 'mid';
  return 'low';
}

// ---- Komórka „osoba × dzień” w widoku Obciążenia ---------------------------

/** Jeden blok dnia gotowy do wyrenderowania: co, ile, w jakich godzinach. */
export interface WorkloadCellBlock {
  /** Źródłowy wpis — akcje (`REASSIGN_ENTRY`) potrzebują jego `id`. */
  entry: WorkloadEntry;
  taskId: string;
  taskTitle: string;
  /** Pusty łańcuch, gdy projektu/klienta nie da się rozwiązać. */
  projectName: string;
  clientName: string;
  plannedHours: number;
  startMinutes: number;
  endMinutes: number;
  /** „9:00–11:00”. */
  timeRange: string;
}

/** Pełna treść popovera komórki: nagłówek (bilans dnia) + lista bloków. */
export interface WorkloadCellDetail {
  personId: string;
  date: DateStr;
  availableHours: number;
  bookedHours: number;
  overbooked: boolean;
  blocks: WorkloadCellBlock[];
}

/**
 * Bloki jednej pary `(osoba, dzień)` w kolejności ZEGARA (potem `sortIndex`),
 * bo popover czyta się jak plan dnia. Nadbudowa nad {@link blocksForPersonDate}
 * — ta zostaje przy swojej kolejności `sortIndex` (używa jej reduktor i
 * wyszukiwanie wolnego slotu). Wpisy zasobnika (`date === ''`) nie należą do
 * żadnego dnia i wypadają z listy.
 */
export function workloadCellBlocks(
  state: AppData,
  personId: string,
  date: DateStr,
): WorkloadCellBlock[] {
  return blocksForPersonDate(state, personId, date)
    .filter((entry) => !isBinEntry(entry))
    .slice()
    .sort((a, b) => a.startMinutes - b.startMinutes || a.sortIndex - b.sortIndex)
    .map((entry) => {
      const task = getTask(state, entry.taskId);
      const project = task === undefined ? undefined : getProject(state, task.projectId);
      const client = project === undefined ? undefined : getClient(state, project.clientId);
      const endMinutes = blockEnd(entry);
      return {
        entry,
        taskId: entry.taskId,
        // Utajniona treść: tytuł/nazwy przez display-helpery — popover komórki
        // obciążenia pokazuje nie-widzowi etykietę „Zadanie #N", nie treść.
        taskTitle: task === undefined ? 'Zadanie' : taskDisplayTitle(state, task),
        projectName: project === undefined ? '' : projectDisplayName(state, project),
        clientName: client?.name ?? '',
        plannedHours: entry.plannedHours,
        startMinutes: entry.startMinutes,
        endMinutes,
        timeRange: `${formatMinutes(entry.startMinutes)}–${formatMinutes(endMinutes)}`,
      };
    });
}

/**
 * {@link workloadCellBlocks} razem z bilansem dnia z
 * {@link dayAvailabilityForPerson} — jedno źródło prawdy dla popovera komórki.
 * Lista bloków jest PEŁNA (filtry klienta/typu usługi zawężają tylko sumy w
 * tabeli), więc „6h / 8h” w nagłówku zawsze zgadza się z listą pod nim.
 */
export function workloadCellDetail(
  state: AppData,
  personId: string,
  date: DateStr,
): WorkloadCellDetail {
  const day = dayAvailabilityForPerson(state, personId, date);
  return {
    personId,
    date,
    availableHours: day.availableHours,
    bookedHours: day.bookedHours,
    overbooked: day.overbooked,
    blocks: workloadCellBlocks(state, personId, date),
  };
}

// ---- Powiadomienia (derived, non-persisted) ----
//
// There is no notification TABLE — a notification is a DERIVED read over data we
// already keep (inwariant 1: pochodne, nie osobny stan). Two structured sources
// feed the Panel „Powiadomienia" tile, each scoped to one recipient and to
// events caused by SOMEONE ELSE within a recent window:
//   1. @-wzmianki — `Comment.mentionIds` zawiera odbiorcę, autor ≠ odbiorca.
//   2. Przypisania — `TaskAssignment` na odbiorcę dla zadania, które utworzył
//      ktoś inny (aktor z wpisu „utworzył(a) …" w dzienniku aktywności).
// Bez tabeli nie ma trwałego stanu „przeczytane"; zamiast tego pokazujemy
// najświeższe trafne zdarzenia z ostatnich `NOTIFICATION_WINDOW_DAYS` dni.

/** How far back the derived feed looks. Older events fall off the tile. */
export const NOTIFICATION_WINDOW_DAYS = 14;

export type NotificationKind = 'mention' | 'assignment';

/** One derived notification row for a person. Not persisted; rebuilt per render. */
export interface PersonNotification {
  id: string; // stable per source event: `${kind}:${sourceId}`
  kind: NotificationKind;
  actorId: string; // who caused it (never the recipient, never '')
  actorName: string;
  entityType: CommentEntityType; // 'task' | 'project' — what to open
  entityId: string;
  taskId: string; // task to open in the modal; '' for a project-scoped mention
  title: string; // ready-to-render Polish sentence
  createdAt: string; // ISO timestamp of the source event (for sort + display)
  // Przeczytane: createdAt <= watermark `notificationsSeenAt` LUB id wpisu jest
  // w zbiorze `notificationsReadIds` odbiorcy (oznaczenie per wpis).
  read: boolean;
}

/** How many of a derived feed are still unread. Pure over the returned list. */
export function unreadNotificationCount(notifications: readonly PersonNotification[]): number {
  return notifications.reduce((n, x) => (x.read ? n : n + 1), 0);
}

/** The task's creation event, whose actor is the person who assigned the task.
 *  Covers both a direct create and a draft that was created then published. */
function taskCreationEvent(state: AppData, taskId: string): ActivityEvent | undefined {
  return state.activity.find(
    (e) => e.entityType === 'task' && e.entityId === taskId && e.message.startsWith('utworzył'),
  );
}

/** Human label + openable task id for a comment's target entity. Empty label
 *  when the entity no longer exists (skip the row). */
function commentTargetLabel(
  state: AppData,
  entityType: CommentEntityType,
  entityId: string,
): { label: string; taskId: string } {
  if (entityType === 'task') {
    const task = getTask(state, entityId);
    // Utajniona treść: etykieta feedu przez display-helper (maska dla nie-widza).
    return { label: task ? taskDisplayTitle(state, task) : '', taskId: task ? task.id : '' };
  }
  const project = getProject(state, entityId);
  if (!project) return { label: '', taskId: '' };
  return {
    label: canViewProjectContent(state, project)
      ? `projekt „${project.name}”`
      : projectDisplayName(state, project),
    taskId: '',
  };
}

/**
 * Derived notification feed for one person, newest first. `nowIso` is injected
 * (never read from the clock here) so the selector stays pure and testable; the
 * caller passes `new Date().toISOString()`. Returns every match within the
 * window — the display cap (max 3) lives in `visibleNotifications`.
 */
export function notificationsForPerson(
  state: AppData,
  personId: string,
  nowIso: string,
): PersonNotification[] {
  if (!personId) return [];
  // Porównania po czasie NUMERYCZNIE (getTime), nie po stringu: znaczniki mogą
  // przychodzić w różnych formatach (lokalny ISO 'Z' vs chmurowy timestamptz),
  // więc porównanie leksykalne byłoby zawodne.
  const cutoffMs = new Date(nowIso).getTime() - NOTIFICATION_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const withinWindow = (createdAt: string): boolean => {
    const ms = new Date(createdAt).getTime();
    return !Number.isNaN(ms) && ms >= cutoffMs;
  };
  // Przeczytane z DWÓCH źródeł, w sumie (OR):
  //   * watermark `notificationsSeenAt` — zdarzenie z createdAt <= seenAt
  //     (oznaczenie ZBIORCZE, kompatybilność wsteczna dla starszych zapisów),
  //   * zbiór `notificationsReadIds` — pojedyncze wpisy oznaczone tickiem.
  const recipient = getPerson(state, personId);
  const seenMs = new Date(recipient?.notificationsSeenAt ?? '').getTime();
  const readIds = new Set(recipient?.notificationsReadIds ?? []);
  const isRead = (createdAt: string, id: string): boolean =>
    (!Number.isNaN(seenMs) && new Date(createdAt).getTime() <= seenMs) || readIds.has(id);
  const out: PersonNotification[] = [];

  // 1. @-wzmianki: ktoś inny wspomniał tę osobę w komentarzu.
  for (const c of state.comments) {
    if (c.authorId === personId || c.authorId === '') continue;
    if (!c.mentionIds.includes(personId)) continue;
    if (!withinWindow(c.createdAt)) continue;
    const author = getPerson(state, c.authorId);
    if (!author) continue;
    const { label, taskId } = commentTargetLabel(state, c.entityType, c.entityId);
    if (!label) continue;
    out.push({
      id: `mention:${c.id}`,
      kind: 'mention',
      actorId: c.authorId,
      actorName: author.name,
      entityType: c.entityType,
      entityId: c.entityId,
      taskId,
      title: `${author.name} wspomniał(a) Cię w komentarzu — ${label}`,
      createdAt: c.createdAt,
      read: isRead(c.createdAt, `mention:${c.id}`),
    });
  }

  // 2. Przypisania: ktoś inny utworzył zadanie przypisane tej osobie. Autor to
  //    STRUKTURALNE `task.createdBy` (kolumna chmury z DEFAULT auth.uid());
  //    fallback dla starszych zadań bez tego pola — najstarsze zdarzenie
  //    „utworzył(a) …" z dziennika aktywności. Czas = utworzenie zadania.
  for (const a of state.assignments) {
    if (a.personId !== personId) continue;
    const task = getTask(state, a.taskId);
    if (!task || isDraftTask(task)) continue;
    let assignerId = task.createdBy ?? '';
    let assignedAt = task.createdAt;
    if (assignerId === '') {
      const creation = taskCreationEvent(state, task.id);
      if (creation) {
        assignerId = creation.actorId;
        assignedAt = creation.createdAt;
      }
    }
    if (assignerId === '' || assignerId === personId) continue;
    if (!withinWindow(assignedAt)) continue;
    const actor = getPerson(state, assignerId);
    if (!actor) continue;
    out.push({
      id: `assignment:${a.id}`,
      kind: 'assignment',
      actorId: assignerId,
      actorName: actor.name,
      entityType: 'task',
      entityId: task.id,
      taskId: task.id,
      // Odbiorca jest wykonawcą (wyjątek wglądu), więc helper i tak zwróci
      // prawdziwy tytuł — maska zostaje dla spójności i obrony w głąb.
      title: `${actor.name} przypisał(a) Ci zadanie — ${taskDisplayTitle(state, task)}`,
      createdAt: assignedAt,
      read: isRead(assignedAt, `assignment:${a.id}`),
    });
  }

  return out.sort((x, y) => new Date(y.createdAt).getTime() - new Date(x.createdAt).getTime());
}

/**
 * Ile wpisów feedu jednej osoby jest nieprzeczytanych. JEDNO źródło licznika dla
 * kafelka Panelu i badge'a karty przeglądarki (App.tsx) — obie liczby muszą
 * pochodzić z tego samego, pochodnego feedu. Brak osoby (wylogowanie) => 0.
 */
export function unreadNotificationCountForPerson(
  state: AppData,
  personId: string,
  nowIso: string,
): number {
  if (!personId) return 0;
  return unreadNotificationCount(notificationsForPerson(state, personId, nowIso));
}

// ---- Content Plan ----------------------------------------------------------
//
// Dwa odczyty pochodne modułu, oba PAMIĘTANE po referencji stanu (jak reszta
// selektorów z argumentami — patrz selectorCache.ts). Wynik jest WSPÓŁDZIELONĄ
// referencją: konsument nie może go mutować (żadnego `.sort(`/`.push(`).

const contentPlanPostsForMonthCache = createKeyedCache<ContentPlanPost[]>((state, key) => {
  const [brandId, monthKey] = key.split(' ');
  if (brandId === '' || !isMonthKey(monthKey)) return EMPTY_CP_POSTS;
  const rows = state.contentPlanPosts.filter(
    (post) => post.brandId === brandId && isPostInMonth(post, monthKey),
  );
  if (rows.length === 0) return EMPTY_CP_POSTS;
  // Sortowanie po dacie jest STABILNE, więc publikacje z tego samego dnia
  // zachowują kolejność kolekcji (kalendarz i lista pokazują ten sam porządek).
  return rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
});

/** Publikacje jednej marki w jednym miesiącu ('yyyy-MM'), rosnąco po dacie.
 *  Nieznana marka / niepoprawny klucz miesiąca => stabilna pusta lista. */
export function contentPlanPostsForMonth(
  state: AppData,
  brandId: string,
  monthKey: string,
): ContentPlanPost[] {
  return contentPlanPostsForMonthCache(state, argsKey(brandId, monthKey));
}

/** Liczniki miesiąca dla nagłówka kalendarza modułu. */
export interface ContentPlanMonthStats {
  total: number;
  published: number; // widoczne dla klienta
  drafts: number; // total - published
  /** Licznik per status — KAŻDY z siedmiu statusów ma tu klucz (także zerowy). */
  byStatus: Record<ContentPlanStatus, number>;
}

const contentPlanMonthStatsCache = createKeyedCache<ContentPlanMonthStats>((state, key) => {
  const [brandId, monthKey] = key.split(' ');
  const byStatus = Object.fromEntries(
    CONTENT_PLAN_STATUSES.map((status) => [status, 0]),
  ) as Record<ContentPlanStatus, number>;
  const posts = contentPlanPostsForMonth(state, brandId, monthKey);
  let published = 0;
  for (const post of posts) {
    byStatus[post.status] += 1;
    if (post.visibility === 'published') published += 1;
  }
  return { total: posts.length, published, drafts: posts.length - published, byStatus };
});

/** Statystyki miesiąca marki: sumy widoczności + licznik każdego z 7 statusów. */
export function contentPlanMonthStats(
  state: AppData,
  brandId: string,
  monthKey: string,
): ContentPlanMonthStats {
  return contentPlanMonthStatsCache(state, argsKey(brandId, monthKey));
}
