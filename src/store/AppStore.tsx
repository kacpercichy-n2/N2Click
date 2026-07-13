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
  AccessRole,
  ActivityEvent,
  AppData,
  ChecklistItem,
  CommentEntityType,
  FilterPage,
  Milestone,
  Person,
  Project,
  Status,
  SavedFilterCriteria,
  Task,
  TaskAssignment,
  TaskPriority,
  WorkloadEntry,
} from '../types';
import { DEFAULT_CAPACITY, loadData, sanitizeWorkDays, saveData, slugify } from './storage';
import { wouldCreateSupervisorCycle } from './selectors';
import { registerPersonOrder } from '../utils/colors';
import {
  MAX_TASK_PERIOD_DAYS,
  addDaysStr,
  eachDayInclusive,
  inclusiveDayCount,
  isValidDateStr,
  periodError,
} from '../utils/dates';
import {
  BIN_DATE,
  DAY_MINUTES,
  HOURS_STEP,
  MINUTE_STEP,
  blockEndMinutes,
  clampBlockStart,
  findFreeStart,
  formatDuration,
  formatMinutes,
  hasCollision,
  hoursToMinutes,
  isBinEntry,
  nextFreeStart,
  planRippleInsert,
  snapHours,
} from '../utils/time';

// ---- Payload shapes ----

export interface TaskDraft {
  projectId: string;
  statusId: string;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  estimatedHours: number | null;
  priority: TaskPriority;
  workCategoryId: string;
  checklist: ChecklistItem[];
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
  phone: string;
  role: string;
  departmentId: string;
  avatar: string;
  capacity: number;
  accessRole: AccessRole;
  workDays: number[];
  workStartMinutes: number;
  workEndMinutes: number;
  supervisorId: string;
  // NOTE: passwordHash is intentionally NOT part of the draft — it is set only
  // via SET_PASSWORD so a profile save can never clobber a stored hash.
}

/**
 * One allocation cell to persist. `plannedHours` is the DESIRED DAY TOTAL for
 * that person on that date across ALL of the task's blocks on that day — not a
 * single block. `saveTask` reconciles this target against the pair's existing
 * blocks by delta (grow the last block / trim from the end / create / delete),
 * so multi-block days survive with byte-identical identity when unchanged.
 */
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
  // Extra dateless hours to append to the bin (per person). Existing bin
  // entries pass through untouched; these are added on top.
  newUnassigned?: Array<{ personId: string; hours: number }>;
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
  | { type: 'IMPERSONATE'; personId: string }
  | { type: 'STOP_IMPERSONATION' }
  | { type: 'SET_PASSWORD'; personId: string; passwordHash: string }
  | { type: 'LOGOUT' }
  | { type: 'ADD_CLIENT'; name: string }
  | { type: 'RENAME_CLIENT'; clientId: string; name: string }
  | { type: 'DELETE_CLIENT'; clientId: string }
  | { type: 'ADD_DEPARTMENT'; name: string }
  | { type: 'RENAME_DEPARTMENT'; departmentId: string; name: string }
  | { type: 'DELETE_DEPARTMENT'; departmentId: string }
  | { type: 'ADD_SERVICE_TYPE'; name: string }
  | { type: 'RENAME_SERVICE_TYPE'; serviceTypeId: string; name: string }
  | { type: 'DELETE_SERVICE_TYPE'; serviceTypeId: string }
  | { type: 'ADD_WORK_CATEGORY'; name: string }
  | { type: 'RENAME_WORK_CATEGORY'; workCategoryId: string; name: string }
  | { type: 'DELETE_WORK_CATEGORY'; workCategoryId: string }
  | { type: 'SAVE_STATUS'; statusId: string | null; name: string; color: string }
  | { type: 'REORDER_STATUS'; statusId: string; direction: -1 | 1 }
  | { type: 'SET_STATUS_ARCHIVED'; statusId: string; archived: boolean }
  | { type: 'SET_STATUS_DONE'; statusId: string; isDone: boolean }
  | { type: 'DELETE_STATUS'; statusId: string }
  | { type: 'INSERT_BLOCK'; payload: InsertBlockPayload }
  | { type: 'REASSIGN_ENTRY'; entryId: string; toPersonId: string }
  | { type: 'SET_BLOCK_TIME'; entryId: string; date: string; startMinutes: number; plannedHours: number }
  | { type: 'MOVE_BLOCK_TO_BIN'; entryId: string }
  | { type: 'SPLIT_BLOCK'; entryId: string; parts: 2 | 4 }
  | { type: 'SCHEDULE_BIN_PART'; entryId: string; date: string; startMinutes: number; hours: number }
  | { type: 'DELETE_BLOCK'; entryId: string }
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
    // sortIndex is derived from time order: rank by startMinutes, ties by old index.
    list.sort((a, b) => a.startMinutes - b.startMinutes || a.sortIndex - b.sortIndex);
    list.forEach((w, i) => newIndex.set(w.id, i));
  }
  return workload.map((w) => {
    const idx = newIndex.get(w.id);
    return idx === undefined || idx === w.sortIndex ? w : { ...w, sortIndex: idx };
  });
}

// ---- Task handlers ----

/** Wholesale-replace the checklist from the draft: trim texts, drop empty ones. */
function cleanChecklist(items: ChecklistItem[]): ChecklistItem[] {
  return items
    .map((item) => ({ ...item, text: item.text.trim() }))
    .filter((item) => item.text !== '');
}

function saveTask(state: AppData, payload: SaveTaskPayload): AppData {
  const { taskId, draft, assigneeIds, allocations } = payload;
  // Reject an invalid/empty/reversed/over-cap period so no bad date is ever
  // persisted (render-side format() would throw a blank-screen RangeError).
  if (periodError(draft.startDate, draft.endDate, { maxDays: MAX_TASK_PERIOD_DAYS }) !== null) {
    return state;
  }
  // Treat the command payload as untrusted. The editor normally emits valid
  // cells, but reducers are also reached by imports, stale tabs, and tests.
  // Reject atomically so malformed input cannot create invalid workload rows.
  if (
    allocations.some(
      (cell) =>
        !isValidDateStr(cell.date) ||
        cell.date < draft.startDate ||
        cell.date > draft.endDate ||
        !Number.isFinite(cell.plannedHours) ||
        cell.plannedHours < 0 ||
        cell.plannedHours > 24,
    ) ||
    (payload.newUnassigned ?? []).some(
      (item) => !Number.isFinite(item.hours) || item.hours < 0,
    )
  ) {
    return state;
  }
  const ts = nowIso();
  const checklist = cleanChecklist(draft.checklist);
  // A category can disappear while an edit modal is still open. Persist only a
  // live dictionary reference so state never needs a later reload to self-heal.
  const workCategoryId = state.workCategories.some((c) => c.id === draft.workCategoryId)
    ? draft.workCategoryId
    : '';

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
      priority: draft.priority,
      workCategoryId,
      checklist,
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
            priority: draft.priority,
            workCategoryId,
            checklist,
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

  // Reconcile this task's DATED workload against the desired per-(person,date)
  // day totals by DELTA — never a drop-and-recreate — so existing blocks keep
  // their identity (id, startMinutes, sortIndex) and multi-block days survive.
  // A cell's `plannedHours` is the person's desired total for that day.
  const assignedSet = new Set(assigneeIds);
  // Existing BIN entries of this task pass through untouched: kept when the
  // person is still assigned, dropped when they are unassigned. Only DATED
  // entries go through the reconciliation below.
  const taskBinKept = state.workload.filter(
    (w) => w.taskId === realTaskId && isBinEntry(w) && assignedSet.has(w.personId),
  );
  const workloadOther = state.workload.filter((w) => w.taskId !== realTaskId);

  // Group this task's existing dated entries by (person, date) pair.
  const datedByPair = new Map<string, WorkloadEntry[]>();
  for (const w of state.workload) {
    if (w.taskId !== realTaskId || isBinEntry(w)) continue;
    const key = dayKey(w.personId, w.date);
    const list = datedByPair.get(key);
    if (list) list.push(w);
    else datedByPair.set(key, [w]);
  }

  // Desired day total per pair (assigned people only; unassigned cells skipped).
  const cellByPair = new Map<string, { personId: string; date: string; totalQ: number }>();
  for (const c of allocations) {
    if (!assignedSet.has(c.personId)) continue;
    // Snap to the 0.25h grid before quarter conversion (input step is UI-only).
    cellByPair.set(dayKey(c.personId, c.date), {
      personId: c.personId,
      date: c.date,
      totalQ: toQuarters(snapHours(c.plannedHours)),
    });
  }

  // Union of pairs to process: existing dated pairs of STILL-ASSIGNED people
  // (unassigned people's dated entries are dropped, as before) + cell pairs.
  const pairKeys = new Set<string>();
  for (const [key, list] of datedByPair) {
    if (assignedSet.has(list[0].personId)) pairKeys.add(key);
  }
  for (const key of cellByPair.keys()) pairKeys.add(key);

  const touched = new Set<string>();
  const workloadForTask: WorkloadEntry[] = [];
  for (const key of pairKeys) {
    const blocks = (datedByPair.get(key) ?? [])
      .slice()
      .sort((a, b) => a.startMinutes - b.startMinutes || a.sortIndex - b.sortIndex);
    const cell = cellByPair.get(key);
    const personId = cell ? cell.personId : blocks[0].personId;
    const date = cell ? cell.date : blocks[0].date;
    const tNew = cell ? cell.totalQ : 0;
    const tOld = blocks.reduce((s, b) => s + toQuarters(b.plannedHours), 0);

    if (tNew === tOld) {
      // No change: keep every block byte-identical; pair NOT touched.
      for (const b of blocks) workloadForTask.push(b);
      continue;
    }
    if (tNew > 0 && tOld === 0) {
      // New pair: append exactly one entry to the end of that person's day
      // (across all tasks), matching the legacy new-cell behavior.
      const hours = tNew * HOURS_STEP;
      const around = [...workloadOther, ...taskBinKept, ...workloadForTask];
      const dayList = around.filter((w) => w.personId === personId && w.date === date);
      const durMin = hoursToMinutes(hours);
      workloadForTask.push({
        id: uid(),
        taskId: realTaskId,
        personId,
        date,
        plannedHours: hours,
        // Prefer a collision-free slot; fall back to nextFreeStart's clamp so
        // SAVE_TASK never rejects on placement (invariant 3 — editor edits may
        // create overlaps, which the week view renders side-by-side).
        startMinutes: findFreeStart(dayList, durMin) ?? nextFreeStart(dayList, durMin),
        sortIndex: nextSortIndex(around, personId, date),
      });
      touched.add(key);
      continue;
    }
    if (tNew === 0) {
      // Cell zeroed or absent (dropped by the period filter): user-explicit
      // deletion of all the pair's blocks.
      touched.add(key);
      continue;
    }
    if (tNew > tOld) {
      // Grow: add the whole delta to the LAST block (keep its id/sortIndex),
      // clamping so it still ends by 24:00.
      const deltaQ = tNew - tOld;
      const last = blocks[blocks.length - 1];
      for (const b of blocks) {
        if (b.id !== last.id) {
          workloadForTask.push(b);
          continue;
        }
        const newHours = (toQuarters(b.plannedHours) + deltaQ) * HOURS_STEP;
        const startMinutes = clampBlockStart(b.startMinutes, hoursToMinutes(newHours));
        if (startMinutes !== b.startMinutes) touched.add(key);
        workloadForTask.push({ ...b, plannedHours: newHours, startMinutes });
      }
      continue;
    }
    // 0 < tNew < tOld: trim from the end. Walk blocks descending, reducing each
    // by min(block, deficit); a block reaching 0 is deleted; survivors keep id
    // and startMinutes. Any deletion touches the pair (re-index for order).
    let deficit = tOld - tNew;
    const survivorById = new Map<string, WorkloadEntry>();
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i];
      if (deficit <= 0) {
        survivorById.set(b.id, b);
        continue;
      }
      const q = toQuarters(b.plannedHours);
      const cut = Math.min(q, deficit);
      deficit -= cut;
      const remainingQ = q - cut;
      if (remainingQ <= 0) {
        touched.add(key); // deletion changes the pair's row set
      } else {
        survivorById.set(b.id, { ...b, plannedHours: remainingQ * HOURS_STEP });
      }
    }
    // Emit survivors in original ascending order.
    for (const b of blocks) {
      const s = survivorById.get(b.id);
      if (s) workloadForTask.push(s);
    }
  }

  // Explicitly-requested bin hours (person must be assigned; snap hours, skip
  // <= 0). One-bin-row invariant: aggregate all items per person into a single
  // total, then merge into the person's passed-through bin row when present,
  // otherwise create one fresh bin row.
  const addByPersonQ = new Map<string, number>();
  for (const item of payload.newUnassigned ?? []) {
    if (!assignedSet.has(item.personId)) continue;
    const hours = snapHours(item.hours);
    if (hours <= 0) continue;
    addByPersonQ.set(
      item.personId,
      (addByPersonQ.get(item.personId) ?? 0) + Math.round(hours / HOURS_STEP),
    );
  }
  const mergedTaskBinKept = taskBinKept.map((w) => {
    const addQ = addByPersonQ.get(w.personId);
    if (addQ === undefined) return w;
    addByPersonQ.delete(w.personId); // consumed — the rest become fresh rows
    return { ...w, plannedHours: (Math.round(w.plannedHours / HOURS_STEP) + addQ) * HOURS_STEP };
  });
  const newBinEntries: WorkloadEntry[] = [];
  for (const [personId, addQ] of addByPersonQ) {
    const accumulated = [...workloadOther, ...mergedTaskBinKept, ...workloadForTask, ...newBinEntries];
    newBinEntries.push({
      id: uid(),
      taskId: realTaskId,
      personId,
      date: BIN_DATE,
      plannedHours: addQ * HOURS_STEP,
      startMinutes: 0,
      sortIndex: nextSortIndex(accumulated, personId, BIN_DATE),
    });
  }

  return {
    ...state,
    tasks,
    assignments: [...assignmentsOther, ...assignmentsForTask],
    // Reindex only the touched dated pairs; untouched pairs' rows (and all bin
    // rows) come out byte-identical.
    workload: reindexDays(
      [...workloadOther, ...mergedTaskBinKept, ...workloadForTask, ...newBinEntries],
      touched,
    ),
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
    if (w.taskId !== taskId || isBinEntry(w)) return w; // bin entries stay in the bin
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
  if (periodError(startDate, endDate, { maxDays: MAX_TASK_PERIOD_DAYS }) !== null) return state;
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task || (task.startDate === startDate && task.endDate === endDate)) return state;
  const inPeriod = new Set(eachDayInclusive(startDate, endDate));
  return {
    ...state,
    tasks: state.tasks.map((t) =>
      t.id === taskId ? { ...t, startDate, endDate, updatedAt: nowIso() } : t,
    ),
    workload: state.workload.filter(
      (w) => w.taskId !== taskId || isBinEntry(w) || inPeriod.has(w.date),
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
  // Reject an invalid/empty/reversed period (no max-days cap for projects).
  if (periodError(draft.startDate, draft.endDate) !== null) return state;
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
  if (!ref || payload.hours <= 0 || isBinEntry(ref)) return state; // no ripple insert around a bin block
  const task = state.tasks.find((t) => t.id === payload.taskId);
  if (!task) return state;

  // Snap to the 0.25h grid on write (input `step` is UI-only).
  const hours = snapHours(payload.hours);
  if (hours <= 0) return state;

  // Budget enforcement (PKG-20260708-b2): a right-click insert may never mint
  // hours past the task's plan. Draw from the inserted task's same-person bin
  // row (note: `payload.taskId` may differ from `ref.taskId` when the picker
  // chose another task), plus the task's headroom when it carries an estimate.
  const binRow = state.workload.find(
    (w) => w.taskId === payload.taskId && w.personId === ref.personId && isBinEntry(w),
  );
  const binQ = binRow ? toQuarters(binRow.plannedHours) : 0;
  const totalAllQ = state.workload
    .filter((w) => w.taskId === payload.taskId)
    .reduce((sum, w) => sum + toQuarters(w.plannedHours), 0);
  const headroomQ =
    task.estimatedHours === null ? 0 : Math.max(0, toQuarters(task.estimatedHours) - totalAllQ);
  const hoursQ = toQuarters(hours);
  // Safety net — the UI package adds the live warning/disable.
  if (hoursQ > binQ + headroomQ) return state;
  const takenFromBinQ = Math.min(hoursQ, binQ); // bin first, then headroom

  // Ripple insert. "Przed": take the ref's start; "Po": start at the ref's end.
  const dur = hoursToMinutes(hours);
  const rawStart =
    payload.position === 'before'
      ? ref.startMinutes
      : blockEndMinutes(ref.startMinutes, ref.plannedHours);

  // Plan the sweep without clamping: reject atomically (state unchanged) if the
  // inserted block or any pushed block would cross 24:00. No hidden overlaps.
  const dayBlocks = state.workload.filter(
    (w) => w.personId === ref.personId && w.date === ref.date,
  );
  const moves = planRippleInsert(dayBlocks, rawStart, dur);
  if (moves === null) return state;

  // Task period must cover ref.date; reject if the widening exceeds the 92-day
  // cap (mirrors setBlockTime). Validated BEFORE any mutation so the action is
  // atomic — the task picker can pick ANY task, so this cannot be skipped.
  const newStartDate = ref.date < task.startDate ? ref.date : task.startDate;
  const newEndDate = ref.date > task.endDate ? ref.date : task.endDate;
  const periodWidens = newStartDate !== task.startDate || newEndDate !== task.endDate;
  if (periodWidens && inclusiveDayCount(newStartDate, newEndDate) > MAX_TASK_PERIOD_DAYS) {
    return state;
  }

  const entry: WorkloadEntry = {
    id: uid(),
    taskId: payload.taskId,
    personId: ref.personId,
    date: ref.date,
    plannedHours: hours,
    startMinutes: rawStart, // un-clamped; planRippleInsert guaranteed it fits
    sortIndex: 0, // fixed by reindexDays below
  };
  let shifted = state.workload.map((w) => {
    const m = moves.get(w.id);
    return m === undefined ? w : { ...w, startMinutes: m };
  });

  // Draw the consumed hours from the same-task bin row (delete it at 0h). The
  // bin row is dateless (BIN_DATE) so it never collides with the ripple sweep.
  const touchedKeys = new Set([dayKey(ref.personId, ref.date)]);
  if (takenFromBinQ > 0 && binRow) {
    const remainingQ = binQ - takenFromBinQ;
    shifted =
      remainingQ <= 0
        ? shifted.filter((w) => w.id !== binRow.id)
        : shifted.map((w) =>
            w.id === binRow.id ? { ...w, plannedHours: remainingQ * HOURS_STEP } : w,
          );
    touchedKeys.add(dayKey(ref.personId, BIN_DATE));
  }

  // Keep invariants: the person must be assigned to the task, and the task
  // period must cover the block's date.
  const alreadyAssigned = state.assignments.some(
    (a) => a.taskId === payload.taskId && a.personId === ref.personId,
  );
  const assignments = alreadyAssigned
    ? state.assignments
    : [...state.assignments, { id: uid(), taskId: payload.taskId, personId: ref.personId }];
  const tasks = periodWidens
    ? state.tasks.map((t) =>
        t.id === payload.taskId
          ? { ...t, startDate: newStartDate, endDate: newEndDate, updatedAt: nowIso() }
          : t,
      )
    : state.tasks;

  const person = state.people.find((p) => p.id === ref.personId);
  let message = `wstawił(a) blok ${formatDuration(hours)} ${payload.position === 'before' ? 'przed' : 'po'} „${state.tasks.find((t) => t.id === ref.taskId)?.title ?? 'blok'}” dla ${person?.name ?? 'kogoś'} w dniu ${ref.date}`;
  if (takenFromBinQ > 0) {
    message += `; pobrano z zasobnika: ${formatDuration(takenFromBinQ * HOURS_STEP)}`;
  }
  return {
    ...state,
    tasks,
    assignments,
    workload: reindexDays([...shifted, entry], touchedKeys),
    activity: withActivity(state, 'task', payload.taskId, message),
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

  // Bin entry → another person: merge into the target's existing same-task bin
  // row when one exists (one-bin-row invariant) — the target row's id survives
  // and the moved entry is dropped.
  if (isBinEntry(entry)) {
    const targetBin = state.workload.find(
      (w) => w.taskId === taskId && w.personId === toPersonId && isBinEntry(w),
    );
    if (targetBin) {
      const sumQ = toQuarters(targetBin.plannedHours) + toQuarters(plannedHours);
      const workload = reindexDays(
        state.workload
          .filter((w) => w.id !== entryId)
          .map((w) =>
            w.id === targetBin.id ? { ...w, plannedHours: sumQ * HOURS_STEP } : w,
          ),
        new Set([dayKey(fromPersonId, BIN_DATE), dayKey(toPersonId, BIN_DATE)]),
      );
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
          `przeniósł/przeniosła blok ${formatDuration(plannedHours)} (${date}) z ${fromName} na ${target.name}`,
        ),
      };
    }
  }

  // Compute the target's next free sortIndex against the workload WITHOUT the
  // moved entry, then append the moved entry to the end of the target's day.
  const without = state.workload.filter((w) => w.id !== entryId);
  // Bin entries stay in the bin (date '', startMinutes 0) and append to the
  // target person's bin; dated entries land in a collision-free slot on the
  // target's day — reject atomically (state unchanged) if none fits.
  let startMinutes: number;
  if (isBinEntry(entry)) {
    startMinutes = 0;
  } else {
    const free = findFreeStart(
      without.filter((w) => w.personId === toPersonId && w.date === date),
      hoursToMinutes(plannedHours),
    );
    if (free === null) return state;
    startMinutes = free;
  }
  const moved: WorkloadEntry = {
    ...entry,
    personId: toPersonId,
    startMinutes,
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
      `przeniósł/przeniosła blok ${formatDuration(plannedHours)} (${date}) z ${fromName} na ${target.name}`,
    ),
  };
}

/** Hours -> integer quarter-units (0.25h grid) to keep hour math free of float drift. */
function toQuarters(hours: number): number {
  return Math.round(hours / HOURS_STEP);
}

/**
 * Move/resize one block in time (the timed Week view). Rejects (returns state
 * unchanged) on any invalid input or a same-person time overlap. Extends the
 * task period to cover a new date unless that would exceed the 92-day cap.
 *
 * This is the ONLY budget-enforcing path (mirroring how a same-person time
 * overlap is blocked only here — CLAUDE.md invariant 3). For a task with an
 * estimate, GROWING a block draws hours from the owner's same-task bin row
 * first, then from the task headroom, and is rejected past that budget; SHRINK
 * returns freed hours to (merges into) the same bin row. SAVE_TASK /
 * AllocationGrid edits stay unrestricted — the estimate is advisory there.
 */
function setBlockTime(
  state: AppData,
  entryId: string,
  date: string,
  startMinutes: number,
  plannedHours: number,
): AppData {
  const entry = state.workload.find((w) => w.id === entryId);
  if (!entry) return state;

  // A grid drop always targets a real calendar day. Use MOVE_BLOCK_TO_BIN to
  // send a block back to the bin — never the empty-date sentinel here.
  if (date === BIN_DATE || !isValidDateStr(date)) return state;

  // Grid + range validation.
  if (!Number.isFinite(startMinutes) || startMinutes < 0 || startMinutes % MINUTE_STEP !== 0) {
    return state;
  }
  if (!Number.isFinite(plannedHours) || plannedHours < HOURS_STEP || plannedHours > 24) {
    return state;
  }
  const hoursSteps = plannedHours / HOURS_STEP;
  if (Math.abs(hoursSteps - Math.round(hoursSteps)) > 1e-9) return state;
  const dur = hoursToMinutes(plannedHours);
  if (startMinutes + dur > DAY_MINUTES) return state;

  // No-op when nothing changed.
  if (entry.date === date && entry.startMinutes === startMinutes && entry.plannedHours === plannedHours) {
    return state;
  }

  // Collision: no overlap with any OTHER block of the same person on the date.
  const sameDayOthers = state.workload.filter(
    (w) => w.personId === entry.personId && w.date === date && w.id !== entryId,
  );
  if (hasCollision(sameDayOthers, startMinutes, dur)) return state;

  const task = state.tasks.find((t) => t.id === entry.taskId);
  if (!task) return state;

  // Extend the task period to cover a new date (unless it would exceed the cap).
  let tasks = state.tasks;
  if (date !== entry.date) {
    const startDate = date < task.startDate ? date : task.startDate;
    const endDate = date > task.endDate ? date : task.endDate;
    if (startDate !== task.startDate || endDate !== task.endDate) {
      if (inclusiveDayCount(startDate, endDate) > MAX_TASK_PERIOD_DAYS) return state;
      tasks = state.tasks.map((t) =>
        t.id === task.id ? { ...t, startDate, endDate, updatedAt: nowIso() } : t,
      );
    }
  }

  const oldDate = entry.date;
  const fromBin = isBinEntry(entry); // dropped in from the bin
  const grow = plannedHours > entry.plannedHours;
  const shrink = plannedHours < entry.plannedHours; // freed hours go back to the bin
  const shrinkDelta = shrink ? entry.plannedHours - plannedHours : 0; // grid-safe

  // The owner's single (task, person) bin row, excluding this entry (the entry
  // itself may be a bin block being dropped onto the grid — it is leaving the bin).
  const binRow = state.workload.find(
    (w) =>
      w.taskId === entry.taskId &&
      w.personId === entry.personId &&
      isBinEntry(w) &&
      w.id !== entryId,
  );

  // Budget enforcement + hour-conserving consumption on GROW (ALL tasks).
  // The allowance is the person's same-task bin hours plus — for tasks with an
  // estimate — the task's remaining headroom. Null-estimate tasks have 0
  // headroom, so they may only draw from the bin (no free minting).
  let takenFromBinQ = 0;
  if (grow) {
    const growDeltaQ = toQuarters(plannedHours) - toQuarters(entry.plannedHours);
    const binSameQ = binRow ? toQuarters(binRow.plannedHours) : 0;
    const totalAllQ = state.workload
      .filter((w) => w.taskId === entry.taskId)
      .reduce((sum, w) => sum + toQuarters(w.plannedHours), 0);
    const headroomQ =
      task.estimatedHours === null ? 0 : Math.max(0, toQuarters(task.estimatedHours) - totalAllQ);
    // Safety net — the UI clamps growth live (PKG-20260708-budget-week-ui).
    if (growDeltaQ > binSameQ + headroomQ) return state;
    takenFromBinQ = Math.min(growDeltaQ, binSameQ); // bin first, then headroom
  }

  const touchedKeys = new Set([
    dayKey(entry.personId, oldDate),
    dayKey(entry.personId, date),
  ]);

  // Apply the new geometry to the moved entry.
  let workloadArr = state.workload.map((w) =>
    w.id === entryId ? { ...w, date, startMinutes, plannedHours } : w,
  );

  // GROW: draw the consumed hours from the same-task bin row (delete it at 0h);
  // any remainder is minted from headroom (no row change, task total rises).
  if (takenFromBinQ > 0 && binRow) {
    const remainingQ = toQuarters(binRow.plannedHours) - takenFromBinQ;
    workloadArr =
      remainingQ <= 0
        ? workloadArr.filter((w) => w.id !== binRow.id)
        : workloadArr.map((w) =>
            w.id === binRow.id ? { ...w, plannedHours: remainingQ * HOURS_STEP } : w,
          );
    touchedKeys.add(dayKey(entry.personId, BIN_DATE));
  }

  // SHRINK: return freed hours to the bin, MERGING into the existing (task,
  // person) bin row when one exists (create a fresh row only when none does).
  if (shrink) {
    const freedQ = toQuarters(shrinkDelta);
    if (binRow) {
      workloadArr = workloadArr.map((w) =>
        w.id === binRow.id
          ? { ...w, plannedHours: (toQuarters(w.plannedHours) + freedQ) * HOURS_STEP }
          : w,
      );
    } else {
      workloadArr = [
        ...workloadArr,
        {
          id: uid(),
          taskId: entry.taskId,
          personId: entry.personId,
          date: BIN_DATE,
          plannedHours: freedQ * HOURS_STEP,
          startMinutes: 0,
          sortIndex: nextSortIndex(workloadArr, entry.personId, BIN_DATE),
        },
      ];
    }
    touchedKeys.add(dayKey(entry.personId, BIN_DATE));
  }

  // Adjacency merge: fuse exactly-touching same-task same-person blocks on the
  // drop day into one (the EARLIER block keeps its id; hours summed). Repeat
  // until stable — a merge can create a new adjacency. Merging happens here
  // only (not in INSERT_BLOCK — the ripple insert keeps its behavior).
  let survivorId: string | null = null;
  for (;;) {
    const group = workloadArr
      .filter(
        (w) => w.personId === entry.personId && w.date === date && w.taskId === entry.taskId,
      )
      .sort((a, b) => a.startMinutes - b.startMinutes);
    let merged = false;
    for (let i = 0; i < group.length - 1; i++) {
      const a = group[i];
      const b = group[i + 1];
      if (blockEndMinutes(a.startMinutes, a.plannedHours) === b.startMinutes) {
        const sumQ = toQuarters(a.plannedHours) + toQuarters(b.plannedHours);
        workloadArr = workloadArr
          .filter((w) => w.id !== b.id)
          .map((w) => (w.id === a.id ? { ...w, plannedHours: sumQ * HOURS_STEP } : w));
        survivorId = a.id;
        merged = true;
        break;
      }
    }
    if (!merged) break;
  }
  const mergedHours =
    survivorId !== null
      ? workloadArr.find((w) => w.id === survivorId)?.plannedHours ?? 0
      : 0;

  const workload = reindexDays(workloadArr, touchedKeys);

  let message: string;
  if (fromBin) {
    message = `zaplanował(a) blok ${formatDuration(plannedHours)} z zasobnika na ${date} ${formatMinutes(startMinutes)}`;
  } else if (date !== oldDate) {
    message = `przeniósł/przeniosła blok ${formatDuration(plannedHours)} na ${date} ${formatMinutes(startMinutes)}`;
  } else {
    message = `zmienił(a) blok na ${formatMinutes(startMinutes)}–${formatMinutes(startMinutes + dur)} (${formatDuration(plannedHours)})`;
  }
  if (takenFromBinQ > 0) {
    message += `; pobrano z zasobnika: ${formatDuration(takenFromBinQ * HOURS_STEP)}`;
  }
  if (shrink) message += `; ${formatDuration(shrinkDelta)} wróciło do zasobnika`;
  if (survivorId !== null) {
    message += `; połączono sąsiednie bloki (razem ${formatDuration(mergedHours)})`;
  }

  return {
    ...state,
    tasks,
    workload,
    activity: withActivity(state, 'task', entry.taskId, message),
  };
}

// ---- Bin (zasobnik) block handlers ----

/** Move one dated block into the person's bin (unassign its calendar day). */
function moveBlockToBin(state: AppData, entryId: string): AppData {
  const entry = state.workload.find((w) => w.id === entryId);
  if (!entry || isBinEntry(entry)) return state;
  const oldDate = entry.date;
  const touched = new Set([
    dayKey(entry.personId, oldDate),
    dayKey(entry.personId, BIN_DATE),
  ]);

  // One-bin-row invariant: when the (task, person) pair already has a bin row,
  // fold this block's hours into it and drop the moved entry (existing id survives).
  const existingBin = state.workload.find(
    (w) => w.taskId === entry.taskId && w.personId === entry.personId && isBinEntry(w),
  );
  let workload: WorkloadEntry[];
  if (existingBin) {
    const sumQ = toQuarters(existingBin.plannedHours) + toQuarters(entry.plannedHours);
    workload = state.workload
      .filter((w) => w.id !== entryId)
      .map((w) => (w.id === existingBin.id ? { ...w, plannedHours: sumQ * HOURS_STEP } : w));
  } else {
    const without = state.workload.filter((w) => w.id !== entryId);
    const moved: WorkloadEntry = {
      ...entry,
      date: BIN_DATE,
      startMinutes: 0,
      sortIndex: nextSortIndex(without, entry.personId, BIN_DATE),
    };
    workload = [...without, moved];
  }
  return {
    ...state,
    workload: reindexDays(workload, touched),
    activity: withActivity(
      state,
      'task',
      entry.taskId,
      `przeniósł/przeniosła blok ${formatDuration(entry.plannedHours)} (${oldDate}) do zasobnika`,
    ),
  };
}

/**
 * Split a dated block into `parts` (halves/quarters) on the 0.25h grid. The
 * largest part stays scheduled on the original entry; the rest collapse into a
 * SINGLE bin row (summed), merged into the (task, person) bin row when one
 * already exists. Rejects when the block is too small to divide, and no-ops on
 * a bin entry — splitting a bin block would create a second same-pair bin row,
 * violating the one-bin-row invariant. To schedule PART of a bin row onto the
 * calendar (the bin-row path this deliberately omits), use `scheduleBinPart`
 * (`SCHEDULE_BIN_PART`), which conserves the one-bin-row invariant.
 */
function splitBlock(state: AppData, entryId: string, parts: 2 | 4): AppData {
  const entry = state.workload.find((w) => w.id === entryId);
  if (!entry || entry.plannedHours < parts * HOURS_STEP) return state;
  if (isBinEntry(entry)) return state;

  const q = Math.round(entry.plannedHours / HOURS_STEP);
  const base = Math.floor(q / parts);
  const r = q % parts;
  // First `r` parts (the largest) get base+1 quarters; part 1 stays scheduled.
  const quarters: number[] = [];
  for (let i = 0; i < parts; i++) quarters.push(base + (i < r ? 1 : 0));
  const binQ = quarters.slice(1).reduce((s, x) => s + x, 0); // all split-off parts

  let workload = state.workload.map((w) =>
    w.id === entryId ? { ...w, plannedHours: quarters[0] * HOURS_STEP } : w,
  );
  const existingBin = state.workload.find(
    (w) => w.taskId === entry.taskId && w.personId === entry.personId && isBinEntry(w),
  );
  if (existingBin) {
    workload = workload.map((w) =>
      w.id === existingBin.id
        ? { ...w, plannedHours: (toQuarters(w.plannedHours) + binQ) * HOURS_STEP }
        : w,
    );
  } else {
    workload = [
      ...workload,
      {
        id: uid(),
        taskId: entry.taskId,
        personId: entry.personId,
        date: BIN_DATE,
        plannedHours: binQ * HOURS_STEP,
        startMinutes: 0,
        sortIndex: nextSortIndex(workload, entry.personId, BIN_DATE),
      },
    ];
  }
  const touched = new Set([
    dayKey(entry.personId, entry.date),
    dayKey(entry.personId, BIN_DATE),
  ]);
  const binSum = binQ * HOURS_STEP;
  return {
    ...state,
    workload: reindexDays(workload, touched),
    activity: withActivity(
      state,
      'task',
      entry.taskId,
      `podzielił(a) blok ${formatDuration(entry.plannedHours)} na ${parts} części (do zasobnika: ${formatDuration(binSum)})`,
    ),
  };
}

/**
 * Schedule a user-chosen 0.25h-aligned PART of a bin (zasobnik) row onto a
 * calendar day. Atomically decrements the source bin row (SAME id, in quarter
 * units — deleted exactly when it reaches zero) and creates exactly ONE new
 * dated block, conserving total planned hours. This is the bin-row scheduling
 * path `splitBlock`/`SPLIT_BLOCK` deliberately omits; it is what makes an
 * oversized (>24h) bin row recoverable.
 *
 * Guard reuse by COMPOSITION, not duplication (decision 3): build an
 * intermediate workload (source row decremented, or filtered out at zero, plus
 * a TEMPORARY same-pair bin sibling carrying the part with a fresh uid) and
 * delegate to the existing `setBlockTime` for that temp entry — inheriting date
 * validity, 15-min grid, day fit, same-person collision, and the 92-day period
 * cap. `setBlockTime` returns its input unchanged on any violation, so
 * `next === intermediate` detects a rejection and we return the ORIGINAL
 * `state` (house convention: state unchanged, no activity row). The transient
 * second same-pair bin row exists ONLY inside this pure function on the success
 * path — by the time state escapes, `setBlockTime` has already dated it — so
 * nothing observable ever holds two bin rows for one (task, person) pair; on
 * rejection the intermediate is discarded entirely.
 *
 * Hour math is in quarter units (decision 4): a legacy off-grid row (e.g. 5.1h)
 * is thereby SNAPPED to the quarter grid on its first partial schedule.
 * Full-amount requests go through this SAME uniform path (decision 5): the
 * source row is filtered out because `remainingQ === 0`, and one new dated row
 * is created — never the source row itself. Budget is untouched (decision 7):
 * the delegated entry's hours equal `hours`, so `setBlockTime` sees neither
 * grow nor shrink; total planned hours and `estimatedHours` are conserved by
 * construction. Adjacency merge (decision 6) and the `fromBin` activity message
 * (decision 8) are inherited from `setBlockTime`; on success we append
 * `; w zasobniku pozostało {X}` (or `; zasobnik opróżniony`) to that last row.
 */
function scheduleBinPart(
  state: AppData,
  entryId: string,
  date: string,
  startMinutes: number,
  hours: number,
): AppData {
  const entry = state.workload.find((w) => w.id === entryId);
  if (!entry || !isBinEntry(entry)) return state;

  // Same hours grid/range validation shape as setBlockTime (:938–942).
  if (!Number.isFinite(hours) || hours < HOURS_STEP || hours > 24) return state;
  const hoursSteps = hours / HOURS_STEP;
  if (Math.abs(hoursSteps - Math.round(hoursSteps)) > 1e-9) return state;

  // Conservation in quarter units; reject asking for more than the row holds.
  const hoursQ = toQuarters(hours);
  const remainingQ = toQuarters(entry.plannedHours) - hoursQ;
  if (remainingQ < 0) return state;

  const partId = uid();
  const partHours = hoursQ * HOURS_STEP; // pass the snapped value, not raw `hours`

  // Intermediate: decrement (or drop at zero) the source row, then append the
  // TEMPORARY part row that setBlockTime will date onto the grid.
  const decremented =
    remainingQ === 0
      ? state.workload.filter((w) => w.id !== entryId)
      : state.workload.map((w) =>
          w.id === entryId ? { ...w, plannedHours: remainingQ * HOURS_STEP } : w,
        );
  const intermediate: AppData = {
    ...state,
    workload: [
      ...decremented,
      {
        id: partId,
        taskId: entry.taskId,
        personId: entry.personId,
        date: BIN_DATE,
        plannedHours: partHours,
        startMinutes: 0,
        sortIndex: nextSortIndex(decremented, entry.personId, BIN_DATE),
      },
    ],
  };

  const next = setBlockTime(intermediate, partId, date, startMinutes, partHours);
  if (next === intermediate) return state; // any guard violation → original state

  // Append the remainder suffix to setBlockTime's fromBin activity row.
  const suffix =
    remainingQ > 0
      ? `; w zasobniku pozostało ${formatDuration(remainingQ * HOURS_STEP)}`
      : '; zasobnik opróżniony';
  const activity = next.activity.map((ev, i) =>
    i === next.activity.length - 1 ? { ...ev, message: ev.message + suffix } : ev,
  );
  return { ...next, activity };
}

/** Delete a single bin entry (dated entries are never deleted here). */
function deleteBlock(state: AppData, entryId: string): AppData {
  const entry = state.workload.find((w) => w.id === entryId);
  if (!entry || !isBinEntry(entry)) return state;
  return {
    ...state,
    workload: reindexDays(
      state.workload.filter((w) => w.id !== entryId),
      new Set([dayKey(entry.personId, BIN_DATE)]),
    ),
    activity: withActivity(
      state,
      'task',
      entry.taskId,
      `usunął/usunęła blok ${formatDuration(entry.plannedHours)} z zasobnika`,
    ),
  };
}

// ---- People ----

// Everything a draft owns EXCEPT the id and passwordHash — those are managed
// separately (id on create, passwordHash only via SET_PASSWORD) so a profile
// save never clobbers a stored password.
function personFromDraft(draft: PersonDraft): Omit<Person, 'id' | 'passwordHash'> {
  const firstName = draft.firstName.trim();
  const lastName = draft.lastName.trim();
  const capacity = draft.capacity > 0 ? draft.capacity : DEFAULT_CAPACITY;
  return {
    firstName,
    lastName,
    name: [firstName, lastName].filter(Boolean).join(' '),
    email: draft.email.trim(),
    phone: draft.phone.trim(),
    role: draft.role.trim(),
    departmentId: draft.departmentId,
    avatar: draft.avatar.trim(),
    capacity,
    accessRole: draft.accessRole,
    // Work hours are informational only — no coupling to capacity is enforced.
    workDays: sanitizeWorkDays(draft.workDays),
    workStartMinutes: draft.workStartMinutes,
    workEndMinutes: draft.workEndMinutes,
    supervisorId: draft.supervisorId,
  };
}

function deletePerson(state: AppData, personId: string): AppData {
  // Impersonation interplay: deleting the impersonated person (currentUserId)
  // while impersonating returns the session to the impersonator; deleting the
  // impersonator ends the bookkeeping but keeps the acted-as identity. Falls
  // back to the plain currentUserId reset when not impersonating.
  const impersonating = state.impersonatorId !== '';
  let currentUserId = state.currentUserId;
  let impersonatorId = state.impersonatorId;
  if (impersonating && personId === state.currentUserId) {
    currentUserId = state.impersonatorId;
    impersonatorId = '';
  } else if (personId === state.impersonatorId) {
    impersonatorId = '';
  } else if (personId === state.currentUserId) {
    currentUserId = '';
  }
  return {
    ...state,
    // Cascade (invariant 5): drop the person, their assignments/workload, and
    // clear any dangling supervisorId that pointed at them on remaining people.
    people: state.people
      .filter((p) => p.id !== personId)
      .map((p) => (p.supervisorId === personId ? { ...p, supervisorId: '' } : p)),
    assignments: state.assignments.filter((a) => a.personId !== personId),
    workload: state.workload.filter((w) => w.personId !== personId),
    currentUserId,
    impersonatorId,
  };
}

// ---- Statuses ----

/** True when archiving/deleting `statusId` would leave ZERO active statuses. */
function isOnlyActiveStatus(state: AppData, statusId: string): boolean {
  const active = state.statuses.filter((s) => !s.archived);
  return active.length === 1 && active[0].id === statusId;
}

/** True when no OTHER status (active or archived) is done — i.e. `statusId` is
 *  the only `isDone` status among all statuses. */
function isOnlyDoneStatus(state: AppData, statusId: string): boolean {
  const done = state.statuses.filter((s) => s.isDone);
  return done.length === 1 && done[0].id === statusId;
}

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
      isDone: false,
    };
    return { ...state, statuses: [...state.statuses, status] };
  }
  // Rename keeps the raw value so inline editing isn't fighting the reducer
  // (trailing spaces while typing); the slug derives from the trimmed name.
  // `isDone` is untouched — the spread preserves the existing flag.
  return {
    ...state,
    statuses: state.statuses.map((s) =>
      s.id === statusId ? { ...s, name, slug: slugify(trimmed), color } : s,
    ),
  };
}

/** Toggle a status's done flag. Turning ON is always allowed; turning OFF is
 *  refused (state unchanged) when it is the only `isDone` status. */
function setStatusDone(state: AppData, statusId: string, isDone: boolean): AppData {
  if (!state.statuses.some((s) => s.id === statusId)) return state;
  if (!isDone && isOnlyDoneStatus(state, statusId)) return state;
  return {
    ...state,
    statuses: state.statuses.map((s) => (s.id === statusId ? { ...s, isDone } : s)),
  };
}

/** Archive/restore a status. Restore (archived=false) is always allowed;
 *  archiving is refused when the status is the only ACTIVE status or the only
 *  `isDone` status. Returns state unchanged on refusal. */
function setStatusArchived(state: AppData, statusId: string, archived: boolean): AppData {
  if (!state.statuses.some((s) => s.id === statusId)) return state;
  if (archived && (isOnlyActiveStatus(state, statusId) || isOnlyDoneStatus(state, statusId))) {
    return state;
  }
  return {
    ...state,
    statuses: state.statuses.map((s) =>
      s.id === statusId ? { ...s, archived } : s,
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

/** Delete is refused (state unchanged) when the status is referenced (else
 *  archive), OR it is the only active status, OR the only `isDone` status. */
function deleteStatus(state: AppData, statusId: string): AppData {
  const used =
    state.projects.some((p) => p.statusId === statusId) ||
    state.tasks.some((t) => t.statusId === statusId);
  if (used) return state;
  if (isOnlyActiveStatus(state, statusId) || isOnlyDoneStatus(state, statusId)) return state;
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
  if (!isValidDateStr(date)) return state;
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
      if (periodError(action.startDate, action.endDate) !== null) return state;
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
      if (!isValidDateStr(action.date)) return state;
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
    case 'ADD_PERSON': {
      const id = uid();
      const base = personFromDraft(action.person);
      // Defensive cycle guard (a fresh id is unreferenced, so this only trips on
      // a self-pointing supervisorId). passwordHash starts empty (passwordless).
      const supervisorId = wouldCreateSupervisorCycle(state.people, id, base.supervisorId)
        ? ''
        : base.supervisorId;
      // Fresh-setup lockout guard: the FIRST person created into an empty people
      // list is forced to administrator. Otherwise the login gate would activate
      // (people.length > 0) with zero admins and no in-app recovery path.
      const accessRole = state.people.length === 0 ? 'administrator' : base.accessRole;
      return {
        ...state,
        people: [...state.people, { id, ...base, accessRole, supervisorId, passwordHash: '' }],
      };
    }
    case 'UPDATE_PERSON': {
      const base = personFromDraft(action.person);
      // Guard the last administrator: refuse a save that would demote the only
      // remaining admin (returns state unchanged — reject-by-same-ref).
      const target = state.people.find((p) => p.id === action.personId);
      const adminCount = state.people.filter((p) => p.accessRole === 'administrator').length;
      if (
        target?.accessRole === 'administrator' &&
        base.accessRole !== 'administrator' &&
        adminCount === 1
      ) {
        return state;
      }
      // Never let a save form a supervisor cycle; drop the value if it would.
      const supervisorId = wouldCreateSupervisorCycle(
        state.people,
        action.personId,
        base.supervisorId,
      )
        ? ''
        : base.supervisorId;
      return {
        ...state,
        people: state.people.map((p) =>
          p.id === action.personId ? { ...p, ...base, supervisorId } : p,
        ),
      };
    }
    case 'DELETE_PERSON': {
      // Guard the last administrator: refuse to delete the only remaining admin
      // (returns state unchanged). Applied BEFORE the deletePerson cascade so the
      // supervisorId cleanup only runs on an allowed delete.
      const target = state.people.find((p) => p.id === action.personId);
      const adminCount = state.people.filter((p) => p.accessRole === 'administrator').length;
      if (target?.accessRole === 'administrator' && adminCount === 1) {
        return state;
      }
      return deletePerson(state, action.personId);
    }
    case 'SET_CURRENT_USER':
      // Login / direct identity set: always ends any impersonation.
      return { ...state, currentUserId: action.personId, impersonatorId: '' };
    case 'IMPERSONATE': {
      // No-op when the target doesn't exist or is already the acted-as identity.
      const exists = state.people.some((p) => p.id === action.personId);
      if (!exists || action.personId === state.currentUserId) return state;
      // Picking the current impersonator's own row means "return".
      if (action.personId === state.impersonatorId) {
        return { ...state, currentUserId: state.impersonatorId, impersonatorId: '' };
      }
      // Chained switches keep the ORIGINAL real user as the impersonator.
      return {
        ...state,
        currentUserId: action.personId,
        impersonatorId: state.impersonatorId || state.currentUserId,
      };
    }
    case 'STOP_IMPERSONATION':
      if (state.impersonatorId === '') return state;
      return { ...state, currentUserId: state.impersonatorId, impersonatorId: '' };
    case 'SET_PASSWORD':
      // Stores the given hash verbatim ('' clears the password). No activity row.
      return {
        ...state,
        people: state.people.map((p) =>
          p.id === action.personId ? { ...p, passwordHash: action.passwordHash } : p,
        ),
      };
    case 'LOGOUT':
      // Full logout (not "return"): clears both the acted-as and real identity.
      return { ...state, currentUserId: '', impersonatorId: '' };
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
    case 'ADD_WORK_CATEGORY': {
      const name = action.name.trim();
      if (!name) return state;
      return {
        ...state,
        workCategories: [...state.workCategories, { id: uid(), name }],
      };
    }
    case 'RENAME_WORK_CATEGORY':
      return {
        ...state,
        workCategories: state.workCategories.map((c) =>
          c.id === action.workCategoryId ? { ...c, name: action.name } : c,
        ),
      };
    case 'DELETE_WORK_CATEGORY':
      return {
        ...state,
        workCategories: state.workCategories.filter((c) => c.id !== action.workCategoryId),
        tasks: state.tasks.map((t) =>
          t.workCategoryId === action.workCategoryId ? { ...t, workCategoryId: '' } : t,
        ),
        savedFilters: state.savedFilters.map((filter) =>
          filter.criteria.workCategoryId === action.workCategoryId
            ? { ...filter, criteria: { ...filter.criteria, workCategoryId: '' } }
            : filter,
        ),
      };
    case 'SAVE_STATUS':
      return saveStatus(state, action.statusId, action.name, action.color);
    case 'REORDER_STATUS':
      return reorderStatus(state, action.statusId, action.direction);
    case 'SET_STATUS_ARCHIVED':
      return setStatusArchived(state, action.statusId, action.archived);
    case 'SET_STATUS_DONE':
      return setStatusDone(state, action.statusId, action.isDone);
    case 'DELETE_STATUS':
      return deleteStatus(state, action.statusId);
    case 'INSERT_BLOCK':
      return insertBlock(state, action.payload);
    case 'REASSIGN_ENTRY':
      return reassignEntry(state, action.entryId, action.toPersonId);
    case 'SET_BLOCK_TIME':
      return setBlockTime(
        state,
        action.entryId,
        action.date,
        action.startMinutes,
        action.plannedHours,
      );
    case 'MOVE_BLOCK_TO_BIN':
      return moveBlockToBin(state, action.entryId);
    case 'SPLIT_BLOCK':
      return splitBlock(state, action.entryId, action.parts);
    case 'SCHEDULE_BIN_PART':
      return scheduleBinPart(
        state,
        action.entryId,
        action.date,
        action.startMinutes,
        action.hours,
      );
    case 'DELETE_BLOCK':
      return deleteBlock(state, action.entryId);
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
