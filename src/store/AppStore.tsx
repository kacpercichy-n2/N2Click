// Single AppStore provider: Context + useReducer, persisting on every action.
// Every mutation is one reducer action; activity-log rows are appended inside
// the same action so the log can never drift from the data.
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react';
import type {
  ActivityEvent,
  AppData,
  CommentEntityType,
  FilterPage,
  Milestone,
  Person,
  Project,
  Status,
  SavedFilterCriteria,
  Task,
  TaskAssignment,
  WorkloadEntry,
} from '../types';
import { DEFAULT_CAPACITY, loadData, saveData, slugify } from './storage';
import { registerPersonOrder } from '../utils/colors';
import { addDaysStr, eachDayInclusive } from '../utils/dates';

// ---- Payload shapes ----

export interface TaskDraft {
  projectId: string;
  statusId: string;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  estimatedHours: number | null;
}

export interface ProjectDraft {
  clientId: string;
  name: string;
  description: string;
  statusId: string;
  paid: boolean;
  startDate: string;
  endDate: string;
  departmentId: string;
  serviceTypeId: string;
}

export interface PersonDraft {
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  departmentId: string;
  avatar: string;
  capacity: number;
  isAdmin: boolean;
}

/** One planned-hours cell to persist: hours>0 keeps/creates, hours<=0 deletes. */
export interface AllocationCell {
  personId: string;
  date: string;
  plannedHours: number;
}

export interface SaveTaskPayload {
  taskId: string | null; // null => create
  draft: TaskDraft;
  assigneeIds: string[]; // final set of assigned people
  allocations: AllocationCell[]; // full desired allocation for this task
}

export interface InsertBlockPayload {
  refEntryId: string; // the right-clicked block
  position: 'before' | 'after';
  taskId: string; // task the new block belongs to
  hours: number;
}

export type Action =
  | { type: 'SAVE_TASK'; payload: SaveTaskPayload }
  | { type: 'DELETE_TASK'; taskId: string }
  | { type: 'MOVE_TASK'; taskId: string; dayDelta: number }
  | { type: 'SET_TASK_DATES'; taskId: string; startDate: string; endDate: string }
  | { type: 'SET_TASK_STATUS'; taskId: string; statusId: string }
  | { type: 'SAVE_PROJECT'; projectId: string | null; draft: ProjectDraft; newClientName?: string }
  | { type: 'DELETE_PROJECT'; projectId: string }
  | { type: 'SET_PROJECT_STATUS'; projectId: string; statusId: string }
  | { type: 'SET_PROJECT_PAID'; projectId: string; paid: boolean }
  | { type: 'SET_PROJECT_DATES'; projectId: string; startDate: string; endDate: string }
  | { type: 'SAVE_MILESTONE'; milestoneId: string | null; projectId: string; name: string; date: string }
  | { type: 'MOVE_MILESTONE'; milestoneId: string; date: string }
  | { type: 'DELETE_MILESTONE'; milestoneId: string }
  | { type: 'ADD_COMMENT'; entityType: CommentEntityType; entityId: string; body: string; mentionIds: string[] }
  | { type: 'ADD_PERSON'; person: PersonDraft }
  | { type: 'UPDATE_PERSON'; personId: string; person: PersonDraft }
  | { type: 'DELETE_PERSON'; personId: string }
  | { type: 'SET_CURRENT_USER'; personId: string }
  | { type: 'ADD_CLIENT'; name: string }
  | { type: 'RENAME_CLIENT'; clientId: string; name: string }
  | { type: 'DELETE_CLIENT'; clientId: string }
  | { type: 'ADD_DEPARTMENT'; name: string }
  | { type: 'RENAME_DEPARTMENT'; departmentId: string; name: string }
  | { type: 'DELETE_DEPARTMENT'; departmentId: string }
  | { type: 'ADD_SERVICE_TYPE'; name: string }
  | { type: 'RENAME_SERVICE_TYPE'; serviceTypeId: string; name: string }
  | { type: 'DELETE_SERVICE_TYPE'; serviceTypeId: string }
  | { type: 'SAVE_STATUS'; statusId: string | null; name: string; color: string }
  | { type: 'REORDER_STATUS'; statusId: string; direction: -1 | 1 }
  | { type: 'SET_STATUS_ARCHIVED'; statusId: string; archived: boolean }
  | { type: 'DELETE_STATUS'; statusId: string }
  | { type: 'INSERT_BLOCK'; payload: InsertBlockPayload }
  | { type: 'REASSIGN_ENTRY'; entryId: string; toPersonId: string }
  | { type: 'SAVE_FILTER_PRESET'; name: string; page: FilterPage; criteria: SavedFilterCriteria }
  | { type: 'DELETE_FILTER_PRESET'; filterId: string }
  | { type: 'LOAD_SAMPLE'; data: AppData }
  | { type: 'DISMISS_SAMPLE_BANNER' }
  | { type: 'RESET_ALL'; data: AppData };

function uid(): string {
  return crypto.randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

// ---- Activity log helper ----

function withActivity(
  state: AppData,
  entityType: CommentEntityType,
  entityId: string,
  message: string,
): ActivityEvent[] {
  return [
    ...state.activity,
    {
      id: uid(),
      entityType,
      entityId,
      actorId: state.currentUserId,
      message,
      createdAt: nowIso(),
    },
  ];
}

// ---- Workload ordering helpers ----

function dayKey(personId: string, date: string): string {
  return `${personId}|${date}`;
}

/** Next free sortIndex on a person's day, given the current entry list. */
function nextSortIndex(
  workload: WorkloadEntry[],
  personId: string,
  date: string,
): number {
  let max = -1;
  for (const w of workload) {
    if (w.personId === personId && w.date === date && w.sortIndex > max) {
      max = w.sortIndex;
    }
  }
  return max + 1;
}

/** Re-number sortIndex 0..n on each affected person-day, preserving order. */
function reindexDays(workload: WorkloadEntry[], keys: Set<string>): WorkloadEntry[] {
  if (keys.size === 0) return workload;
  const byDay = new Map<string, WorkloadEntry[]>();
  for (const w of workload) {
    const key = dayKey(w.personId, w.date);
    if (!keys.has(key)) continue;
    const list = byDay.get(key);
    if (list) list.push(w);
    else byDay.set(key, [w]);
  }
  const newIndex = new Map<string, number>(); // entryId -> sortIndex
  for (const list of byDay.values()) {
    list.sort((a, b) => a.sortIndex - b.sortIndex);
    list.forEach((w, i) => newIndex.set(w.id, i));
  }
  return workload.map((w) => {
    const idx = newIndex.get(w.id);
    return idx === undefined || idx === w.sortIndex ? w : { ...w, sortIndex: idx };
  });
}

// ---- Task handlers ----

function saveTask(state: AppData, payload: SaveTaskPayload): AppData {
  const { taskId, draft, assigneeIds, allocations } = payload;
  const ts = nowIso();

  let tasks = state.tasks;
  let realTaskId: string;
  let created = false;

  if (taskId === null) {
    const task: Task = {
      id: uid(),
      projectId: draft.projectId,
      statusId: draft.statusId,
      title: draft.title,
      description: draft.description,
      startDate: draft.startDate,
      endDate: draft.endDate,
      estimatedHours: draft.estimatedHours,
      createdAt: ts,
      updatedAt: ts,
    };
    tasks = [...tasks, task];
    realTaskId = task.id;
    created = true;
  } else {
    realTaskId = taskId;
    tasks = tasks.map((t) =>
      t.id === taskId
        ? {
            ...t,
            projectId: draft.projectId,
            statusId: draft.statusId,
            title: draft.title,
            description: draft.description,
            startDate: draft.startDate,
            endDate: draft.endDate,
            estimatedHours: draft.estimatedHours,
            updatedAt: ts,
          }
        : t,
    );
  }

  // Rebuild assignments for this task from the desired set.
  const assignmentsOther = state.assignments.filter(
    (a) => a.taskId !== realTaskId,
  );
  const assignmentsForTask: TaskAssignment[] = assigneeIds.map((personId) => ({
    id: uid(),
    taskId: realTaskId,
    personId,
  }));

  // Rebuild workload for this task from the desired allocation, keeping only
  // hours>0 and only for people who are still assigned. Existing cells keep
  // their position in the person's day; new cells go to the end of the day.
  const assignedSet = new Set(assigneeIds);
  const oldIndex = new Map<string, number>(); // person|date -> old sortIndex
  for (const w of state.workload) {
    if (w.taskId === realTaskId) oldIndex.set(dayKey(w.personId, w.date), w.sortIndex);
  }
  const workloadOther = state.workload.filter((w) => w.taskId !== realTaskId);
  const workloadForTask: WorkloadEntry[] = [];
  for (const c of allocations) {
    if (c.plannedHours <= 0 || !assignedSet.has(c.personId)) continue;
    const kept = oldIndex.get(dayKey(c.personId, c.date));
    workloadForTask.push({
      id: uid(),
      taskId: realTaskId,
      personId: c.personId,
      date: c.date,
      plannedHours: c.plannedHours,
      sortIndex:
        kept ?? nextSortIndex([...workloadOther, ...workloadForTask], c.personId, c.date),
    });
  }

  return {
    ...state,
    tasks,
    assignments: [...assignmentsOther, ...assignmentsForTask],
    workload: [...workloadOther, ...workloadForTask],
    activity: withActivity(
      state,
      'task',
      realTaskId,
      created ? 'utworzył(a) zadanie' : 'zaktualizował(a) zadanie',
    ),
  };
}

function deleteTask(state: AppData, taskId: string): AppData {
  return {
    ...state,
    tasks: state.tasks.filter((t) => t.id !== taskId),
    assignments: state.assignments.filter((a) => a.taskId !== taskId),
    workload: state.workload.filter((w) => w.taskId !== taskId),
    comments: state.comments.filter(
      (c) => !(c.entityType === 'task' && c.entityId === taskId),
    ),
    activity: state.activity.filter(
      (e) => !(e.entityType === 'task' && e.entityId === taskId),
    ),
  };
}

/** Shift a task and ALL its time blocks by whole days (timeline drag). */
function moveTask(state: AppData, taskId: string, dayDelta: number): AppData {
  if (dayDelta === 0) return state;
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return state;
  const touched = new Set<string>();
  const workload = state.workload.map((w) => {
    if (w.taskId !== taskId) return w;
    const newDate = addDaysStr(w.date, dayDelta);
    touched.add(dayKey(w.personId, w.date));
    touched.add(dayKey(w.personId, newDate));
    return { ...w, date: newDate };
  });
  return {
    ...state,
    tasks: state.tasks.map((t) =>
      t.id === taskId
        ? {
            ...t,
            startDate: addDaysStr(t.startDate, dayDelta),
            endDate: addDaysStr(t.endDate, dayDelta),
            updatedAt: nowIso(),
          }
        : t,
    ),
    workload: reindexDays(workload, touched),
    activity: withActivity(
      state,
      'task',
      taskId,
      `przesunął/przesunęła zadanie o ${dayDelta > 0 ? '+' : ''}${dayDelta} dni`,
    ),
  };
}

/** Resize a task period (timeline). Blocks outside the new period are dropped. */
function setTaskDates(
  state: AppData,
  taskId: string,
  startDate: string,
  endDate: string,
): AppData {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task || (task.startDate === startDate && task.endDate === endDate)) return state;
  const inPeriod = new Set(eachDayInclusive(startDate, endDate));
  return {
    ...state,
    tasks: state.tasks.map((t) =>
      t.id === taskId ? { ...t, startDate, endDate, updatedAt: nowIso() } : t,
    ),
    workload: state.workload.filter(
      (w) => w.taskId !== taskId || inPeriod.has(w.date),
    ),
    activity: withActivity(
      state,
      'task',
      taskId,
      `zmienił(a) okres zadania na ${startDate} – ${endDate}`,
    ),
  };
}

// ---- Project handlers ----

function saveProject(
  state: AppData,
  projectId: string | null,
  draft: ProjectDraft,
  newClientName?: string,
): AppData {
  const ts = nowIso();

  // Optionally create (or reuse) a client in the same atomic action, so a
  // project can never point at a client id that doesn't exist.
  let clients = state.clients;
  let clientId = draft.clientId;
  if (!clientId && newClientName?.trim()) {
    const name = newClientName.trim();
    const existing = clients.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      clientId = existing.id;
    } else {
      const client = { id: uid(), name, archived: false };
      clients = [...clients, client];
      clientId = client.id;
    }
  }
  const resolved = { ...draft, clientId };

  if (projectId === null) {
    const project: Project = { id: uid(), ...resolved, createdAt: ts, updatedAt: ts };
    return {
      ...state,
      clients,
      projects: [...state.projects, project],
      activity: withActivity(state, 'project', project.id, 'utworzył(a) projekt'),
    };
  }
  return {
    ...state,
    clients,
    projects: state.projects.map((p) =>
      p.id === projectId ? { ...p, ...resolved, updatedAt: ts } : p,
    ),
    activity: withActivity(state, 'project', projectId, 'zaktualizował(a) projekt'),
  };
}

function deleteProject(state: AppData, projectId: string): AppData {
  const taskIds = new Set(
    state.tasks.filter((t) => t.projectId === projectId).map((t) => t.id),
  );
  return {
    ...state,
    projects: state.projects.filter((p) => p.id !== projectId),
    milestones: state.milestones.filter((m) => m.projectId !== projectId),
    tasks: state.tasks.filter((t) => !taskIds.has(t.id)),
    assignments: state.assignments.filter((a) => !taskIds.has(a.taskId)),
    workload: state.workload.filter((w) => !taskIds.has(w.taskId)),
    comments: state.comments.filter((c) =>
      c.entityType === 'project'
        ? c.entityId !== projectId
        : !taskIds.has(c.entityId),
    ),
    activity: state.activity.filter((e) =>
      e.entityType === 'project'
        ? e.entityId !== projectId
        : !taskIds.has(e.entityId),
    ),
  };
}

// ---- Insert block (calendar right-click) ----

function insertBlock(state: AppData, payload: InsertBlockPayload): AppData {
  const ref = state.workload.find((w) => w.id === payload.refEntryId);
  if (!ref || payload.hours <= 0) return state;
  const task = state.tasks.find((t) => t.id === payload.taskId);
  if (!task) return state;

  // The new block sits before/after the reference block in that person's day.
  const targetIndex = payload.position === 'before' ? ref.sortIndex : ref.sortIndex + 1;
  const shifted = state.workload.map((w) =>
    w.personId === ref.personId && w.date === ref.date && w.sortIndex >= targetIndex
      ? { ...w, sortIndex: w.sortIndex + 1 }
      : w,
  );
  const entry: WorkloadEntry = {
    id: uid(),
    taskId: payload.taskId,
    personId: ref.personId,
    date: ref.date,
    plannedHours: payload.hours,
    sortIndex: targetIndex,
  };

  // Keep invariants: the person must be assigned to the task, and the task
  // period must cover the block's date.
  const alreadyAssigned = state.assignments.some(
    (a) => a.taskId === payload.taskId && a.personId === ref.personId,
  );
  const assignments = alreadyAssigned
    ? state.assignments
    : [...state.assignments, { id: uid(), taskId: payload.taskId, personId: ref.personId }];
  const tasks = state.tasks.map((t) => {
    if (t.id !== payload.taskId) return t;
    const startDate = ref.date < t.startDate ? ref.date : t.startDate;
    const endDate = ref.date > t.endDate ? ref.date : t.endDate;
    return startDate === t.startDate && endDate === t.endDate
      ? t
      : { ...t, startDate, endDate, updatedAt: nowIso() };
  });

  const person = state.people.find((p) => p.id === ref.personId);
  return {
    ...state,
    tasks,
    assignments,
    workload: [...shifted, entry],
    activity: withActivity(
      state,
      'task',
      payload.taskId,
      `wstawił(a) blok ${payload.hours}h ${payload.position === 'before' ? 'przed' : 'po'} „${state.tasks.find((t) => t.id === ref.taskId)?.title ?? 'blok'}” dla ${person?.name ?? 'kogoś'} w dniu ${ref.date}`,
    ),
  };
}

/** Move one time block to another person, keeping ordering invariants. */
function reassignEntry(state: AppData, entryId: string, toPersonId: string): AppData {
  const entry = state.workload.find((w) => w.id === entryId);
  if (!entry) return state;
  const target = state.people.find((p) => p.id === toPersonId);
  if (!target || toPersonId === entry.personId) return state;

  const fromPersonId = entry.personId;
  const { date, plannedHours, taskId } = entry;

  // Compute the target's next free sortIndex against the workload WITHOUT the
  // moved entry, then append the moved entry to the end of the target's day.
  const without = state.workload.filter((w) => w.id !== entryId);
  const moved: WorkloadEntry = {
    ...entry,
    personId: toPersonId,
    sortIndex: nextSortIndex(without, toPersonId, date),
  };
  const touched = new Set<string>([
    dayKey(fromPersonId, date),
    dayKey(toPersonId, date),
  ]);
  const workload = reindexDays([...without, moved], touched);

  // Keep the invariant: the target person must be assigned to the task. Do NOT
  // remove the source person's assignment (they may have other blocks, and the
  // task editor owns assignment cleanup).
  const alreadyAssigned = state.assignments.some(
    (a) => a.taskId === taskId && a.personId === toPersonId,
  );
  const assignments = alreadyAssigned
    ? state.assignments
    : [...state.assignments, { id: uid(), taskId, personId: toPersonId }];

  const fromName = state.people.find((p) => p.id === fromPersonId)?.name ?? 'kogoś';

  return {
    ...state,
    assignments,
    workload,
    activity: withActivity(
      state,
      'task',
      taskId,
      `przeniósł/przeniosła blok ${plannedHours}h (${date}) z ${fromName} na ${target.name}`,
    ),
  };
}

// ---- People ----

function personFromDraft(draft: PersonDraft): Omit<Person, 'id'> {
  const firstName = draft.firstName.trim();
  const lastName = draft.lastName.trim();
  return {
    firstName,
    lastName,
    name: [firstName, lastName].filter(Boolean).join(' '),
    email: draft.email.trim(),
    role: draft.role.trim(),
    departmentId: draft.departmentId,
    avatar: draft.avatar.trim(),
    capacity: draft.capacity > 0 ? draft.capacity : DEFAULT_CAPACITY,
    isAdmin: draft.isAdmin,
  };
}

function deletePerson(state: AppData, personId: string): AppData {
  return {
    ...state,
    people: state.people.filter((p) => p.id !== personId),
    assignments: state.assignments.filter((a) => a.personId !== personId),
    workload: state.workload.filter((w) => w.personId !== personId),
    currentUserId: state.currentUserId === personId ? '' : state.currentUserId,
  };
}

// ---- Statuses ----

function saveStatus(
  state: AppData,
  statusId: string | null,
  name: string,
  color: string,
): AppData {
  const trimmed = name.trim();
  if (!trimmed) return state;
  if (statusId === null) {
    const status: Status = {
      id: uid(),
      name: trimmed,
      slug: slugify(trimmed),
      color,
      order: state.statuses.reduce((m, s) => Math.max(m, s.order), -1) + 1,
      archived: false,
    };
    return { ...state, statuses: [...state.statuses, status] };
  }
  // Rename keeps the raw value so inline editing isn't fighting the reducer
  // (trailing spaces while typing); the slug derives from the trimmed name.
  return {
    ...state,
    statuses: state.statuses.map((s) =>
      s.id === statusId ? { ...s, name, slug: slugify(trimmed), color } : s,
    ),
  };
}

function reorderStatus(state: AppData, statusId: string, direction: -1 | 1): AppData {
  const ordered = [...state.statuses].sort((a, b) => a.order - b.order);
  const idx = ordered.findIndex((s) => s.id === statusId);
  const swapWith = idx + direction;
  if (idx === -1 || swapWith < 0 || swapWith >= ordered.length) return state;
  [ordered[idx], ordered[swapWith]] = [ordered[swapWith], ordered[idx]];
  const orderOf = new Map(ordered.map((s, i) => [s.id, i]));
  return {
    ...state,
    statuses: state.statuses.map((s) => ({ ...s, order: orderOf.get(s.id) ?? s.order })),
  };
}

/** Delete is only allowed when nothing references the status (else archive). */
function deleteStatus(state: AppData, statusId: string): AppData {
  const used =
    state.projects.some((p) => p.statusId === statusId) ||
    state.tasks.some((t) => t.statusId === statusId);
  if (used) return state;
  return { ...state, statuses: state.statuses.filter((s) => s.id !== statusId) };
}

// ---- Milestones ----

function saveMilestone(
  state: AppData,
  milestoneId: string | null,
  projectId: string,
  name: string,
  date: string,
): AppData {
  if (milestoneId === null) {
    const m: Milestone = { id: uid(), projectId, name: name.trim(), date };
    return {
      ...state,
      milestones: [...state.milestones, m],
      activity: withActivity(state, 'project', projectId, `dodał(a) kamień milowy „${m.name}” na ${date}`),
    };
  }
  return {
    ...state,
    milestones: state.milestones.map((m) =>
      m.id === milestoneId ? { ...m, name: name.trim(), date } : m,
    ),
    activity: withActivity(state, 'project', projectId, `zaktualizował(a) kamień milowy „${name.trim()}”`),
  };
}

// ---- Reducer ----

export function reducer(state: AppData, action: Action): AppData {
  switch (action.type) {
    case 'SAVE_TASK':
      return saveTask(state, action.payload);
    case 'DELETE_TASK':
      return deleteTask(state, action.taskId);
    case 'MOVE_TASK':
      return moveTask(state, action.taskId, action.dayDelta);
    case 'SET_TASK_DATES':
      return setTaskDates(state, action.taskId, action.startDate, action.endDate);
    case 'SET_TASK_STATUS': {
      const status = state.statuses.find((s) => s.id === action.statusId);
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.taskId
            ? { ...t, statusId: action.statusId, updatedAt: nowIso() }
            : t,
        ),
        activity: withActivity(
          state,
          'task',
          action.taskId,
          `przeniósł/przeniosła zadanie do statusu „${status?.name ?? '?'}”`,
        ),
      };
    }
    case 'SAVE_PROJECT':
      return saveProject(state, action.projectId, action.draft, action.newClientName);
    case 'DELETE_PROJECT':
      return deleteProject(state, action.projectId);
    case 'SET_PROJECT_STATUS': {
      const status = state.statuses.find((s) => s.id === action.statusId);
      const project = state.projects.find((p) => p.id === action.projectId);
      if (!project || project.statusId === action.statusId) return state;
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === action.projectId
            ? { ...p, statusId: action.statusId, updatedAt: nowIso() }
            : p,
        ),
        activity: withActivity(
          state,
          'project',
          action.projectId,
          `przeniósł/przeniosła projekt do statusu „${status?.name ?? '?'}”`,
        ),
      };
    }
    case 'SET_PROJECT_PAID':
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === action.projectId
            ? { ...p, paid: action.paid, updatedAt: nowIso() }
            : p,
        ),
        activity: withActivity(
          state,
          'project',
          action.projectId,
          action.paid ? 'oznaczył(a) projekt jako opłacony' : 'oznaczył(a) projekt jako nieopłacony',
        ),
      };
    case 'SET_PROJECT_DATES':
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === action.projectId
            ? { ...p, startDate: action.startDate, endDate: action.endDate, updatedAt: nowIso() }
            : p,
        ),
        activity: withActivity(
          state,
          'project',
          action.projectId,
          `zmienił(a) termin projektu na ${action.startDate} – ${action.endDate}`,
        ),
      };
    case 'SAVE_MILESTONE':
      return saveMilestone(state, action.milestoneId, action.projectId, action.name, action.date);
    case 'MOVE_MILESTONE': {
      const m = state.milestones.find((x) => x.id === action.milestoneId);
      if (!m || m.date === action.date) return state;
      return {
        ...state,
        milestones: state.milestones.map((x) =>
          x.id === action.milestoneId ? { ...x, date: action.date } : x,
        ),
        activity: withActivity(
          state,
          'project',
          m.projectId,
          `przeniósł/przeniosła kamień milowy „${m.name}” na ${action.date}`,
        ),
      };
    }
    case 'DELETE_MILESTONE': {
      const m = state.milestones.find((x) => x.id === action.milestoneId);
      return {
        ...state,
        milestones: state.milestones.filter((x) => x.id !== action.milestoneId),
        activity: m
          ? withActivity(state, 'project', m.projectId, `usunął/usunęła kamień milowy „${m.name}”`)
          : state.activity,
      };
    }
    case 'ADD_COMMENT': {
      const body = action.body.trim();
      if (!body) return state;
      return {
        ...state,
        comments: [
          ...state.comments,
          {
            id: uid(),
            entityType: action.entityType,
            entityId: action.entityId,
            authorId: state.currentUserId,
            body,
            mentionIds: action.mentionIds,
            createdAt: nowIso(),
          },
        ],
        activity: withActivity(state, action.entityType, action.entityId, 'dodał(a) komentarz'),
      };
    }
    case 'ADD_PERSON':
      return {
        ...state,
        people: [...state.people, { id: uid(), ...personFromDraft(action.person) }],
      };
    case 'UPDATE_PERSON':
      return {
        ...state,
        people: state.people.map((p) =>
          p.id === action.personId ? { ...p, ...personFromDraft(action.person) } : p,
        ),
      };
    case 'DELETE_PERSON':
      return deletePerson(state, action.personId);
    case 'SET_CURRENT_USER':
      return { ...state, currentUserId: action.personId };
    case 'ADD_CLIENT': {
      const name = action.name.trim();
      if (!name) return state;
      return {
        ...state,
        clients: [...state.clients, { id: uid(), name, archived: false }],
      };
    }
    case 'RENAME_CLIENT':
      return {
        ...state,
        clients: state.clients.map((c) =>
          c.id === action.clientId ? { ...c, name: action.name } : c,
        ),
      };
    case 'DELETE_CLIENT': {
      // Cascade: client -> its projects -> their tasks/blocks.
      let next: AppData = state;
      for (const p of state.projects.filter((p) => p.clientId === action.clientId)) {
        next = deleteProject(next, p.id);
      }
      return { ...next, clients: next.clients.filter((c) => c.id !== action.clientId) };
    }
    case 'ADD_DEPARTMENT': {
      const name = action.name.trim();
      if (!name) return state;
      return {
        ...state,
        departments: [...state.departments, { id: uid(), name }],
      };
    }
    case 'RENAME_DEPARTMENT':
      return {
        ...state,
        departments: state.departments.map((d) =>
          d.id === action.departmentId ? { ...d, name: action.name } : d,
        ),
      };
    case 'DELETE_DEPARTMENT':
      // Clear references; nothing else cascades from a department.
      return {
        ...state,
        departments: state.departments.filter((d) => d.id !== action.departmentId),
        people: state.people.map((p) =>
          p.departmentId === action.departmentId ? { ...p, departmentId: '' } : p,
        ),
        projects: state.projects.map((p) =>
          p.departmentId === action.departmentId ? { ...p, departmentId: '' } : p,
        ),
      };
    case 'ADD_SERVICE_TYPE': {
      const name = action.name.trim();
      if (!name) return state;
      return {
        ...state,
        serviceTypes: [...state.serviceTypes, { id: uid(), name }],
      };
    }
    case 'RENAME_SERVICE_TYPE':
      return {
        ...state,
        serviceTypes: state.serviceTypes.map((s) =>
          s.id === action.serviceTypeId ? { ...s, name: action.name } : s,
        ),
      };
    case 'DELETE_SERVICE_TYPE':
      return {
        ...state,
        serviceTypes: state.serviceTypes.filter((s) => s.id !== action.serviceTypeId),
        projects: state.projects.map((p) =>
          p.serviceTypeId === action.serviceTypeId ? { ...p, serviceTypeId: '' } : p,
        ),
      };
    case 'SAVE_STATUS':
      return saveStatus(state, action.statusId, action.name, action.color);
    case 'REORDER_STATUS':
      return reorderStatus(state, action.statusId, action.direction);
    case 'SET_STATUS_ARCHIVED':
      return {
        ...state,
        statuses: state.statuses.map((s) =>
          s.id === action.statusId ? { ...s, archived: action.archived } : s,
        ),
      };
    case 'DELETE_STATUS':
      return deleteStatus(state, action.statusId);
    case 'INSERT_BLOCK':
      return insertBlock(state, action.payload);
    case 'REASSIGN_ENTRY':
      return reassignEntry(state, action.entryId, action.toPersonId);
    case 'SAVE_FILTER_PRESET': {
      const name = action.name.trim();
      if (!name) return state;
      const existing = state.savedFilters.find(
        (f) => f.page === action.page && f.name === name,
      );
      if (existing) {
        return {
          ...state,
          savedFilters: state.savedFilters.map((f) =>
            f.id === existing.id ? { ...f, criteria: action.criteria } : f,
          ),
        };
      }
      return {
        ...state,
        savedFilters: [
          ...state.savedFilters,
          { id: uid(), name, page: action.page, criteria: action.criteria },
        ],
      };
    }
    case 'DELETE_FILTER_PRESET':
      return {
        ...state,
        savedFilters: state.savedFilters.filter((f) => f.id !== action.filterId),
      };
    case 'LOAD_SAMPLE':
      return { ...action.data, sampleBannerDismissed: true };
    case 'DISMISS_SAMPLE_BANNER':
      return { ...state, sampleBannerDismissed: true };
    case 'RESET_ALL':
      return action.data;
    default:
      return state;
  }
}

interface StoreValue {
  state: AppData;
  dispatch: React.Dispatch<Action>;
}

const StoreContext = createContext<StoreValue | null>(null);

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadData);

  // Assign person colours by stable list order. Done during render (idempotent)
  // so colours are correct on the first paint of any consumer.
  registerPersonOrder(state.people.map((p) => p.id));

  // Persist on every state change.
  useEffect(() => {
    saveData(state);
  }, [state]);

  const value = useMemo(() => ({ state, dispatch }), [state]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within AppStoreProvider');
  return ctx;
}
