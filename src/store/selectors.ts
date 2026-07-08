// Pure selector functions. Every page derives from these so views never disagree.
import type {
  ActivityEvent,
  AppData,
  Client,
  Comment,
  CommentEntityType,
  DateStr,
  Department,
  Milestone,
  Person,
  Project,
  ServiceType,
  Status,
  Task,
  WorkloadEntry,
} from '../types';
import { DEFAULT_CAPACITY } from './storage';
import { blockEndMinutes, hasCollision, hoursToMinutes, isBinEntry } from '../utils/time';
import { parseDate } from '../utils/dates';

// ---- Basic lookups ----

export function getTask(state: AppData, taskId: string): Task | undefined {
  return state.tasks.find((t) => t.id === taskId);
}

export function getPerson(state: AppData, personId: string): Person | undefined {
  return state.people.find((p) => p.id === personId);
}

export function getProject(state: AppData, projectId: string): Project | undefined {
  return state.projects.find((p) => p.id === projectId);
}

export function getClient(state: AppData, clientId: string): Client | undefined {
  return state.clients.find((c) => c.id === clientId);
}

export function getStatus(state: AppData, statusId: string): Status | undefined {
  return state.statuses.find((s) => s.id === statusId);
}

export function getDepartment(
  state: AppData,
  departmentId: string,
): Department | undefined {
  return state.departments.find((d) => d.id === departmentId);
}

export function getServiceType(
  state: AppData,
  serviceTypeId: string,
): ServiceType | undefined {
  return state.serviceTypes.find((s) => s.id === serviceTypeId);
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

/** Task ids a person is assigned to. */
export function taskIdsOfPerson(state: AppData, personId: string): string[] {
  return state.assignments
    .filter((a) => a.personId === personId)
    .map((a) => a.taskId);
}

/** Distinct projects a person works on (via task assignments). */
export function projectsOfPerson(state: AppData, personId: string): Project[] {
  const taskIds = new Set(taskIdsOfPerson(state, personId));
  const projectIds = new Set(
    state.tasks.filter((t) => taskIds.has(t.id)).map((t) => t.projectId),
  );
  return state.projects.filter((p) => projectIds.has(p.id));
}

// ---- Workload ----

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

/** A person's ordered time blocks on one date (the per-day schedule). */
export function blocksForPersonDate(
  state: AppData,
  personId: string,
  date: DateStr,
): WorkloadEntry[] {
  return state.workload
    .filter((w) => w.personId === personId && w.date === date)
    .sort((a, b) => a.sortIndex - b.sortIndex);
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

// ---- Bin (zasobnik) — dateless unassigned entries ----

/** A person's bin entries (date === ''), ordered by their bin sortIndex. */
export function binEntriesForPerson(state: AppData, personId: string): WorkloadEntry[] {
  return state.workload
    .filter((w) => w.personId === personId && isBinEntry(w))
    .sort((a, b) => a.sortIndex - b.sortIndex);
}

/** A task's bin entries (any person). */
export function binEntriesForTask(state: AppData, taskId: string): WorkloadEntry[] {
  return state.workload.filter((w) => w.taskId === taskId && isBinEntry(w));
}

/** Summed hours a person has sitting in their bin. */
export function binTotalForPerson(state: AppData, personId: string): number {
  return binEntriesForPerson(state, personId).reduce((sum, w) => sum + w.plannedHours, 0);
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
 * How many hours a block may GROW BY (the grow DELTA, not the block's absolute
 * size) before it would mint hours past the task budget. `null` ⇒ unlimited
 * (the task has no estimate ⇒ free grow, today's behavior). Otherwise the
 * block's owner may draw from their same-task bin row first, then from the
 * task's headroom: `binHoursForTaskPerson + headroom`.
 */
export function growAllowanceHours(state: AppData, entryId: string): number | null {
  const entry = state.workload.find((w) => w.id === entryId);
  if (!entry) return 0;
  const task = getTask(state, entry.taskId);
  if (!task || task.estimatedHours === null) return null;
  return (
    binHoursForTaskPerson(state, entry.taskId, entry.personId) +
    taskBudget(state, entry.taskId).headroom
  );
}

// ---- Capacity & overload ----

export const OVERLOAD_THRESHOLD = DEFAULT_CAPACITY;

/** A person's daily capacity in hours (falls back to the 8h default). */
export function personCapacity(state: AppData, personId: string): number {
  const p = getPerson(state, personId);
  return p && p.capacity > 0 ? p.capacity : DEFAULT_CAPACITY;
}

/** People (ids) whose TOTAL for the date exceeds their capacity, within the filter. */
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
    .filter(
      (p) => hoursForPersonOnDate(state, p.id, date) > personCapacity(state, p.id),
    )
    .map((p) => p.id);
}

/** Dates inside the task period where an assignee working on THIS task that day exceeds their capacity. */
export function conflictDatesForTask(state: AppData, taskId: string): DateStr[] {
  const out = new Set<DateStr>();
  for (const w of state.workload) {
    if (w.taskId !== taskId || isBinEntry(w)) continue; // bin entries have no date -> never an overload date
    if (hoursForPersonOnDate(state, w.personId, w.date) > personCapacity(state, w.personId)) {
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

export interface SearchResults {
  projects: Project[];
  tasks: Task[];
  clients: Client[];
  people: Person[];
}

/** Lowercase + strip diacritics so `zolty` matches `Żółty` (ł/Ł are not decomposed by NFD). */
function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'l')
    .toLowerCase();
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
  limitPerGroup = 8,
): SearchResults {
  const empty: SearchResults = { projects: [], tasks: [], clients: [], people: [] };
  const raw = query.trim();
  if (raw === '') return empty;

  const q = normalize(raw);

  // Statuses whose (normalized) name contains the query.
  const matchedStatusIds = new Set(
    state.statuses.filter((s) => normalize(s.name).includes(q)).map((s) => s.id),
  );

  // Date coverage: only when the raw query parses as a calendar date.
  const dateQuery = DATE_RE.test(raw) ? raw : null;

  const inPeriod = (start: DateStr, end: DateStr): boolean =>
    dateQuery !== null && start <= dateQuery && dateQuery <= end;

  const projects = state.projects.filter(
    (p) =>
      normalize(p.name).includes(q) ||
      normalize(p.description).includes(q) ||
      matchedStatusIds.has(p.statusId) ||
      inPeriod(p.startDate, p.endDate),
  );

  const tasks = state.tasks.filter(
    (t) =>
      normalize(t.title).includes(q) ||
      normalize(t.description).includes(q) ||
      matchedStatusIds.has(t.statusId) ||
      inPeriod(t.startDate, t.endDate),
  );

  const clients = state.clients.filter((c) => normalize(c.name).includes(q));

  const people = state.people.filter(
    (p) =>
      normalize(p.name).includes(q) ||
      normalize(p.email).includes(q) ||
      normalize(p.role).includes(q),
  );

  return {
    projects: projects.slice(0, limitPerGroup),
    tasks: tasks.slice(0, limitPerGroup),
    clients: clients.slice(0, limitPerGroup),
    people: people.slice(0, limitPerGroup),
  };
}

// ---- Permissions ----

export function currentUser(state: AppData): Person | undefined {
  return state.currentUserId ? getPerson(state, state.currentUserId) : undefined;
}

/**
 * Admin gate for the admin panel and status management. With no people yet
 * there is nobody to be admin, so setup stays unlocked (prevents lockout).
 * Reimplemented on `accessRole` (v5); keeps its name/signature and the rule.
 */
export function isAdminUser(state: AppData): boolean {
  if (state.people.length === 0) return true;
  return currentUser(state)?.accessRole === 'administrator';
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

/** Available hours on a date: the person's daily capacity on a workday, else 0. */
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
