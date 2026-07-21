// Single AppStore provider: Context + useReducer, persisting on every action.
// Every mutation is one reducer action; activity-log rows are appended inside
// the same action so the log can never drift from the data.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  AccessRole,
  ActivityEntityType,
  ActivityEvent,
  AppData,
  ChecklistItem,
  CommentEntityType,
  Department,
  FilterPage,
  Milestone,
  Person,
  Project,
  ProjectDocument,
  ProjectDocumentKind,
  ServiceType,
  Status,
  SavedFilterCriteria,
  Task,
  TaskAssignment,
  TaskPriority,
  TicketKind,
  TicketPriority,
  TicketStatus,
  WorkCategory,
  WorkloadEntry,
} from '../types';
import type { CloudMergePayload } from '../supabase/plannerData';
import type { CloudPersonMergeRow } from '../supabase/referenceData';
import { normalizeEmail } from '../auth/profile';
import {
  DEFAULT_CAPACITY,
  loadDataResult,
  sanitizeWorkDays,
  saveData,
  slugify,
  subscribeExternalChanges,
  type SaveFailureReason,
} from './storage';
import { anyDirty } from '../utils/dirtyRegistry';
import { shouldSkipLocalPersist } from './persistGate';
import {
  hasEntity,
  isRequiredName,
  isValidClientDraft,
  isValidPersonDraft,
  isValidProjectDraft,
  isValidTaskDraft,
  isValidTicketDraft,
  isValidTicketStatus,
  normalizeProjectDocumentDraft,
} from './commandValidation';
import {
  DEFAULT_TICKET_STATUS,
  isTicketKind,
  isTicketPriority,
  isTicketStatus,
} from '../utils/tickets';
import { wouldCreateSupervisorCycle } from './selectors';
import { ROLE_LABELS } from './permissions';
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
  departmentId: string; // dział zadania; '' = brak (miękki fallback jak kategoria)
  checklist: ChecklistItem[];
  // Sygnał TWORZENIA szkicu (tylko przy taskId === null). Zadanie utworzone z
  // widoku projektu przychodzi z `isDraft: true` i NIE materializuje godzin.
  // Przy EDYCJI ignorowane — reduktor zachowuje `isDraft` istniejącego zadania,
  // więc formularz nie może przypadkiem opublikować ani cofnąć publikacji
  // (jedyna droga to akcje PUBLISH_*). Brak pola = zadanie opublikowane.
  isDraft?: boolean;
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

/** Draft odnośnika do dokumentu projektu (karta „Dokumenty”). `id` NIE jest
 *  częścią draftu — nadaje go reduktor przy dodaniu, edycja adresuje wiersz
 *  osobnym `documentId`. */
export interface ProjectDocumentDraft {
  kind: ProjectDocumentKind;
  label: string;
  url: string;
}

/** Draft zgłoszenia (modal „Zgłoszenia”). `status` NIE jest częścią draftu:
 *  nowe zgłoszenie startuje jako 'nowe', zmianę robi SET_TICKET_STATUS. */
export interface TicketDraft {
  title: string;
  area: string;
  description: string;
  kind: TicketKind;
  priority: TicketPriority;
  reporterId: string;
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
  // Data urodzenia (yyyy-MM-dd); '' gdy nieustawiona. Opcjonalna, walidowana na
  // repair przy wczytaniu (patrz migratePerson w storage.ts).
  birthDate: string;
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
  // ABSOLUTNY cel zasobnika per osoba (godziny bez terminu po zapisie).
  // Wiersz zasobnika zachowuje tożsamość (invariant 4); cel 0 usuwa wiersz,
  // brak wiersza przy celu > 0 tworzy dokładnie jeden. Osoby spoza listy
  // przechodzą bez zmian. Stosowane PO newUnassigned (nadpisuje jego wynik).
  binTotals?: Array<{ personId: string; hours: number }>;
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
  | { type: 'REORDER_PROJECT_TASK'; taskId: string; direction: -1 | 1 }
  // Publikacja szkiców: całego projektu (atomowo) lub pojedynczego zadania.
  | { type: 'PUBLISH_PROJECT_DRAFTS'; projectId: string }
  | { type: 'PUBLISH_TASK'; taskId: string }
  | { type: 'SAVE_PROJECT'; projectId: string | null; draft: ProjectDraft }
  | { type: 'DELETE_PROJECT'; projectId: string }
  | { type: 'SET_PROJECT_STATUS'; projectId: string; statusId: string }
  | { type: 'SET_PROJECT_PAID'; projectId: string; paid: boolean }
  | { type: 'SET_PROJECT_DATES'; projectId: string; startDate: string; endDate: string }
  // Dokumenty handlowe projektu (karta „Dokumenty”) — same odnośniki, bez plików.
  | { type: 'ADD_PROJECT_DOCUMENT'; projectId: string; draft: ProjectDocumentDraft }
  | { type: 'SAVE_PROJECT_DOCUMENT'; projectId: string; documentId: string; draft: ProjectDocumentDraft }
  | { type: 'DELETE_PROJECT_DOCUMENT'; projectId: string; documentId: string }
  | { type: 'SAVE_MILESTONE'; milestoneId: string | null; projectId: string; name: string; date: string }
  | { type: 'MOVE_MILESTONE'; milestoneId: string; date: string }
  | { type: 'DELETE_MILESTONE'; milestoneId: string }
  | { type: 'ADD_COMMENT'; entityType: CommentEntityType; entityId: string; body: string; mentionIds: string[] }
  // Zgłoszenia zespołu („Zgłoszenia”). Kolekcja addytywna, bez powiązań kaskadowych.
  | { type: 'ADD_TICKET'; draft: TicketDraft }
  | { type: 'SAVE_TICKET'; ticketId: string; draft: TicketDraft }
  | { type: 'SET_TICKET_STATUS'; ticketId: string; status: TicketStatus }
  | { type: 'DELETE_TICKET'; ticketId: string }
  | { type: 'ADD_PERSON'; person: PersonDraft }
  | { type: 'UPDATE_PERSON'; personId: string; person: PersonDraft }
  | { type: 'DELETE_PERSON'; personId: string }
  | { type: 'SET_CURRENT_USER'; personId: string }
  | { type: 'IMPERSONATE'; personId: string }
  | { type: 'STOP_IMPERSONATION' }
  | { type: 'SET_PASSWORD'; personId: string; passwordHash: string }
  | { type: 'LOGOUT' }
  | { type: 'ADD_CLIENT'; name: string; contactName?: string; contactEmail?: string; contactPhone?: string; notes?: string }
  | { type: 'RENAME_CLIENT'; clientId: string; name: string }
  | { type: 'SAVE_CLIENT'; clientId: string; name: string; contactName: string; contactEmail: string; contactPhone: string; notes: string }
  | { type: 'SET_CLIENT_ARCHIVED'; clientId: string; archived: boolean }
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
  | { type: 'RESET_ALL'; data: AppData }
  // In-place replacement of the whole store with a fresh loadData() result,
  // triggered when another same-browser tab wrote and this tab is clean. Not a
  // user mutation — no activity row (mirrors RESET_ALL).
  | { type: 'REPLACE_FROM_STORAGE'; data: AppData }
  // Cloud hydration (supabase mode only): merge the seven mirrored planner
  // groups read from Supabase into local state. NEVER destroys local work —
  // same-id rows are replaced, cloud-only rows appended, local-only rows kept.
  // workload and every non-mirrored collection pass through untouched. An
  // invalid payload returns the ORIGINAL state reference (invariant 6).
  | { type: 'MERGE_CLOUD_ENTITIES'; payload: CloudMergePayload }
  // Pełna synchronizacja osób: AUTORYTATYWNA hydracja lokalnej listy z
  // RLS-owych profili chmury (upsert po e-mailu, nowe wiersze z id profilu
  // chmury, osoby bez konta chmury usuwane). Brak zmian => ta sama referencja.
  | { type: 'MERGE_CLOUD_PEOPLE'; payload: CloudPersonMergeRow[] }
  // AUTORYTATYWNA hydracja słowników organizacji (działy, statusy, typy usług,
  // kategorie prac) z chmury. Fail-closed na invariancie statusów.
  | { type: 'MERGE_CLOUD_DICTIONARIES'; payload: CloudDictionariesPayload };

function uid(): string {
  return crypto.randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

// ---- Activity log helper ----

// Local, user-editable activity log for attribution/UX. localStorage is
// client-mutable, so this is NOT a security audit trail. Every row carries the
// acting identity plus (when impersonating) the real administrator, so the log
// stays honest about who did what. `as` overrides the stamp for session events
// where the pre-transition `currentUserId` is not the honest author.
function withActivity(
  state: AppData,
  entityType: ActivityEntityType,
  entityId: string,
  message: string,
  as?: { actorId: string; impersonatorId: string },
  options?: { collapse?: boolean },
): ActivityEvent[] {
  const actorId = as ? as.actorId : state.currentUserId;
  const impersonatorId = as ? as.impersonatorId : state.impersonatorId;
  // collapse: identyczny wpis (encja+treść+aktor) bezpośrednio na końcu listy
  // dostaje świeży znacznik czasu zamiast duplikatu — auto-zapis nie zaśmieca
  // dziennika serią „zaktualizował(a)”.
  if (options?.collapse) {
    const last = state.activity[state.activity.length - 1];
    if (
      last &&
      last.entityType === entityType &&
      last.entityId === entityId &&
      last.message === message &&
      last.actorId === actorId &&
      last.impersonatorId === impersonatorId
    ) {
      return [...state.activity.slice(0, -1), { ...last, createdAt: nowIso() }];
    }
  }
  return [
    ...state.activity,
    {
      id: uid(),
      entityType,
      entityId,
      actorId,
      impersonatorId,
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
    ) ||
    (payload.binTotals ?? []).some(
      (item) => !Number.isFinite(item.hours) || item.hours < 0,
    )
  ) {
    return state;
  }
  // Reject a stale edit id: without this the task map skips the ghost id but
  // assignments/workload are STILL rebuilt for it and an activity row appended —
  // the worst live corruption path. Reject before any of that runs.
  if (taskId !== null && !hasEntity(state, 'task', taskId)) return state;
  // Title required; projectId/statusId must exist; estimate null or finite >= 0.
  if (!isValidTaskDraft(state, draft)) return state;
  // A dangling person reference covers every persistable person id: allocations
  // and newUnassigned are filtered by the assignee set below. Reject atomically.
  if (assigneeIds.some((id) => !hasEntity(state, 'person', id))) return state;
  const ts = nowIso();
  const checklist = cleanChecklist(draft.checklist);
  // A category can disappear while an edit modal is still open. Persist only a
  // live dictionary reference so state never needs a later reload to self-heal.
  const workCategoryId = state.workCategories.some((c) => c.id === draft.workCategoryId)
    ? draft.workCategoryId
    : '';
  const departmentId = state.departments.some((d) => d.id === draft.departmentId)
    ? draft.departmentId
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
      departmentId,
      checklist,
      // Nowe zadanie ląduje NA KOŃCU swojego projektu.
      orderIndex: maxOrderIndexOfProject(state, draft.projectId) + 1,
      // Szkic tylko przy tworzeniu z widoku projektu; wszędzie indziej publikacja
      // natychmiastowa (brak flagi). Szkic pomija materializację godzin poniżej.
      isDraft: draft.isDraft === true,
      createdAt: ts,
      updatedAt: ts,
    };
    tasks = [...tasks, task];
    realTaskId = task.id;
    created = true;
  } else {
    realTaskId = taskId;
    const prev = state.tasks.find((t) => t.id === taskId)!;
    // Zmiana projektu (edycja) => dopisz na końcu projektu docelowego; ten sam
    // projekt => zachowaj dotychczasową rangę (kolejność jest kosmetyczna).
    const orderIndex =
      prev.projectId === draft.projectId
        ? prev.orderIndex
        : maxOrderIndexOfProject(state, draft.projectId) + 1;
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
            departmentId,
            checklist,
            orderIndex,
            // Edycja NIGDY nie zmienia stanu publikacji: zachowaj `isDraft`
            // istniejącego zadania (publikację robią wyłącznie akcje PUBLISH_*).
            isDraft: t.isDraft,
            updatedAt: ts,
          }
        : t,
    );
  }

  // Czy WYNIK zapisu jest szkicem? Tworzenie bierze sygnał z draftu, edycja
  // zachowuje stan zadania. Szkic pomija CAŁĄ materializację godzin (zasobnik,
  // kalendarz), bo planowane godziny żyją wyłącznie w `WorkloadEntry` i powstają
  // dopiero po publikacji (inwariant 1 + 4). Przypisania powstają normalnie.
  const resultIsDraft =
    taskId === null
      ? draft.isDraft === true
      : state.tasks.find((t) => t.id === taskId)!.isDraft === true;

  // Rebuild assignments for this task from the desired set.
  const assignmentsOther = state.assignments.filter(
    (a) => a.taskId !== realTaskId,
  );
  const assignmentsForTask: TaskAssignment[] = assigneeIds.map((personId) => ({
    id: uid(),
    taskId: realTaskId,
    personId,
  }));

  if (resultIsDraft) {
    // Szkic: godziny NIE materializują się (inwariant 1 + 4). Workload zostaje
    // nietknięty — dla świeżego szkicu jest pusty, a przy edycji szkicu nadal
    // pusty. allocations / binTotals / newUnassigned z modalu są celowo
    // pomijane; plan powstaje dopiero po publikacji. Zadanie i przypisania
    // zapisują się normalnie, więc osoby można wybrać już na etapie szkicu.
    return {
      ...state,
      tasks,
      assignments: [...assignmentsOther, ...assignmentsForTask],
      workload: state.workload,
      activity: withActivity(
        state,
        'task',
        realTaskId,
        created ? 'utworzył(a) szkic zadania' : 'zaktualizował(a) szkic zadania',
        undefined,
        { collapse: !created },
      ),
    };
  }

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

  // Absolutne cele zasobnika (przepływ „godziny sprzedane per osoba”):
  // rekoncyliacja DO celu po ścieżce addytywnej. Pierwszy wiersz osoby
  // zachowuje tożsamość i przyjmuje cel; duplikaty pary (obrona invariantu 4)
  // i wiersze wyzerowanego celu odpadają; cel > 0 bez wiersza => jeden świeży.
  const targetByPersonQ = new Map<string, number>();
  for (const item of payload.binTotals ?? []) {
    if (!assignedSet.has(item.personId)) continue;
    targetByPersonQ.set(item.personId, Math.round(snapHours(item.hours) / HOURS_STEP));
  }
  let binAfterTargets = [...mergedTaskBinKept, ...newBinEntries];
  if (targetByPersonQ.size > 0) {
    const seenBinPerson = new Set<string>();
    const reconciled: WorkloadEntry[] = [];
    for (const w of binAfterTargets) {
      const targetQ = targetByPersonQ.get(w.personId);
      if (targetQ === undefined) {
        reconciled.push(w);
        continue;
      }
      if (seenBinPerson.has(w.personId)) continue; // duplikat pary — odpada
      seenBinPerson.add(w.personId);
      if (targetQ <= 0) continue; // cel 0 => wiersz usunięty
      const hours = targetQ * HOURS_STEP;
      reconciled.push(w.plannedHours === hours ? w : { ...w, plannedHours: hours });
    }
    for (const [personId, targetQ] of targetByPersonQ) {
      if (seenBinPerson.has(personId) || targetQ <= 0) continue;
      const accumulated = [...workloadOther, ...reconciled, ...workloadForTask];
      reconciled.push({
        id: uid(),
        taskId: realTaskId,
        personId,
        date: BIN_DATE,
        plannedHours: targetQ * HOURS_STEP,
        startMinutes: 0,
        sortIndex: nextSortIndex(accumulated, personId, BIN_DATE),
      });
    }
    binAfterTargets = reconciled;
  }

  return {
    ...state,
    tasks,
    assignments: [...assignmentsOther, ...assignmentsForTask],
    // Reindex only the touched dated pairs; untouched pairs' rows (and all bin
    // rows) come out byte-identical.
    workload: reindexDays(
      [...workloadOther, ...binAfterTargets, ...workloadForTask],
      touched,
    ),
    activity: withActivity(
      state,
      'task',
      realTaskId,
      created ? 'utworzył(a) zadanie' : 'zaktualizował(a) zadanie',
      undefined,
      // Auto-zapis zapisuje często: kolejne identyczne „zaktualizował(a)” tego
      // samego aktora scala się w jeden wpis (świeży znacznik czasu).
      { collapse: !created },
    ),
  };
}

/**
 * Publikacja WSZYSTKICH szkiców projektu jedną atomową akcją („Zapisz i
 * opublikuj”). Przełącza `isDraft` na `false` dla każdego szkicu tego projektu;
 * nic więcej się nie zmienia (przypisania już istnieją, godzin szkic nie miał).
 * Nieistniejący projekt albo brak szkiców => TA SAMA referencja stanu
 * (inwariant 6) — akcja bez efektu nie tworzy wpisu ani nowej referencji.
 */
function publishProjectDrafts(state: AppData, projectId: string): AppData {
  if (!hasEntity(state, 'project', projectId)) return state;
  const draftIds = new Set(
    state.tasks.filter((t) => t.projectId === projectId && t.isDraft === true).map((t) => t.id),
  );
  if (draftIds.size === 0) return state;
  const ts = nowIso();
  return {
    ...state,
    tasks: state.tasks.map((t) =>
      draftIds.has(t.id) ? { ...t, isDraft: false, updatedAt: ts } : t,
    ),
    activity: withActivity(
      state,
      'project',
      projectId,
      `opublikował(a) szkice zadań (${draftIds.size})`,
    ),
  };
}

/**
 * Publikacja pojedynczego szkicu (bonus: „opublikuj” per zadanie). Zadanie musi
 * istnieć i być szkicem — inaczej TA SAMA referencja stanu (inwariant 6).
 */
function publishTask(state: AppData, taskId: string): AppData {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task || task.isDraft !== true) return state;
  const ts = nowIso();
  return {
    ...state,
    tasks: state.tasks.map((t) =>
      t.id === taskId ? { ...t, isDraft: false, updatedAt: ts } : t,
    ),
    activity: withActivity(state, 'task', taskId, 'opublikował(a) zadanie'),
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
  if (!Number.isFinite(dayDelta) || !Number.isInteger(dayDelta) || dayDelta === 0) return state;
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
): AppData {
  // Reject an invalid/empty/reversed period (no max-days cap for projects).
  if (periodError(draft.startDate, draft.endDate) !== null) return state;
  // Reject a stale edit id (a ghost id would append a garbage activity row).
  if (projectId !== null && !hasEntity(state, 'project', projectId)) return state;
  const existing = projectId === null ? null : state.projects.find((p) => p.id === projectId) ?? null;
  // Name required; statusId must exist; client rule (strict on create, an
  // UNCHANGED dangling clientId stays editable on a legacy orphan project).
  if (!isValidProjectDraft(state, draft, existing)) return state;
  const ts = nowIso();

  if (projectId === null) {
    // `documents` nie jest częścią draftu — nowy projekt startuje bez odnośników,
    // a edycja projektu (niżej) przenosi istniejącą listę bez zmian.
    const project: Project = { id: uid(), ...draft, documents: [], createdAt: ts, updatedAt: ts };
    return {
      ...state,
      projects: [...state.projects, project],
      activity: withActivity(state, 'project', project.id, 'utworzył(a) projekt'),
    };
  }
  return {
    ...state,
    projects: state.projects.map((p) =>
      p.id === projectId ? { ...p, ...draft, updatedAt: ts } : p,
    ),
    activity: withActivity(state, 'project', projectId, 'zaktualizował(a) projekt', undefined, {
      collapse: true, // auto-zapis: seria edycji = jeden wpis
    }),
  };
}

/** Etykieta dokumentu w dzienniku aktywności: nazwa, a gdy jej brak — adres. */
function documentTitle(doc: Pick<ProjectDocument, 'label' | 'url'>): string {
  return doc.label.trim() || doc.url.trim();
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
  if (!ref || !Number.isFinite(payload.hours) || payload.hours <= 0 || isBinEntry(ref)) {
    return state; // no ripple insert around a bin block
  }
  const task = state.tasks.find((t) => t.id === payload.taskId);
  if (!task) return state;
  // Szkic nie materializuje godzin (inwariant 1 + 4): żadna ścieżka kalendarza
  // nie może wstawić bloku dla nieopublikowanego zadania. Ta sama referencja.
  if (task.isDraft === true) return state;

  // Snap to the 0.25h grid on write (input `step` is UI-only).
  const hours = snapHours(payload.hours);
  if (!Number.isFinite(hours) || hours <= 0) return state;

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

  // planRippleInsert only pushes blocks AT/AFTER the insert point. A same-person
  // block that STARTS BEFORE `rawStart` but ENDS AFTER it (reachable after a
  // SAVE_TASK grow-clamp overlap) is never inspected, so the inserted block would
  // land inside its span — a NEW collision the calendar must never create. Reject
  // atomically. Touching edges do not overlap, so the "po" ref (end === rawStart)
  // and any block ending exactly at rawStart are not flagged.
  const spansInsertPoint = dayBlocks.some(
    (w) => w.startMinutes < rawStart && blockEndMinutes(w.startMinutes, w.plannedHours) > rawStart,
  );
  if (spansInsertPoint) return state;

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
  // Clamp into the UI's declared [1, 24] hours/day range (defense-in-depth: the
  // number input declares min=1/max=24 but does not enforce the max on typed
  // input). A non-finite value falls back to the default BEFORE clamping so a
  // garbage payload can never persist NaN.
  const rawCapacity = Number.isFinite(draft.capacity) ? draft.capacity : DEFAULT_CAPACITY;
  const capacity = Math.min(24, Math.max(1, rawCapacity));
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
    // Data urodzenia: poprawna 'yyyy-MM-dd' albo '' (śmieci nie persystują).
    birthDate: isValidDateStr(draft.birthDate) ? draft.birthDate : '',
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
    return {
      ...state,
      statuses: [...state.statuses, status],
      activity: withActivity(state, 'status', status.id, `utworzył(a) status „${trimmed}”`),
    };
  }
  // Reject a stale rename id (previously returned a new identical state ref).
  if (!hasEntity(state, 'status', statusId)) return state;
  // Rename keeps the raw value so inline editing isn't fighting the reducer
  // (trailing spaces while typing); the slug derives from the trimmed name.
  // `isDone` is untouched — the spread preserves the existing flag.
  // The rename/recolor branch logs NOTHING: AdminPage dispatches SAVE_STATUS per
  // keystroke / per color-drag tick, so an edit row would flood the log.
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
  const status = state.statuses.find((s) => s.id === statusId)!;
  return {
    ...state,
    statuses: state.statuses.map((s) => (s.id === statusId ? { ...s, isDone } : s)),
    activity: withActivity(
      state,
      'status',
      statusId,
      isDone
        ? `oznaczył(a) status „${status.name}” jako ukończony`
        : `cofnął(a) oznaczenie ukończenia statusu „${status.name}”`,
    ),
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
  const status = state.statuses.find((s) => s.id === statusId)!;
  return {
    ...state,
    statuses: state.statuses.map((s) =>
      s.id === statusId ? { ...s, archived } : s,
    ),
    activity: withActivity(
      state,
      'status',
      statusId,
      archived ? `zarchiwizował(a) status „${status.name}”` : `przywrócił(a) status „${status.name}”`,
    ),
  };
}

/** Najwyższa `orderIndex` w danym projekcie, albo -1 gdy projekt jest pusty. */
function maxOrderIndexOfProject(state: AppData, projectId: string): number {
  let max = -1;
  for (const t of state.tasks) {
    if (t.projectId === projectId && Number.isFinite(t.orderIndex) && t.orderIndex > max) {
      max = t.orderIndex;
    }
  }
  return max;
}

// Ręczna zmiana kolejności zadań w projekcie. Kosmetyka (jak reorderStatus):
// ukończenie/kalendarz/godziny są od kolejności NIEZALEŻNE, a powtarzane
// kliknięcia zaśmiecałyby log — więc BEZ wiersza aktywności i BEZ zmiany
// `updatedAt`. Nieprawidłowe wejście (nieznane id, ruch poza krawędź) zwraca tę
// SAMĄ referencję stanu (invariant 6). Kanoniczny klucz kolejności:
// (orderIndex asc, startDate asc, id asc) — identyczny jak w selektorze, więc
// wiersze chmury same-0 zachowują się jak dzisiejszy sort po startDate.
function reorderProjectTask(state: AppData, taskId: string, direction: -1 | 1): AppData {
  // Wrong payload shape (kierunek spoza {-1, 1}) => ta sama referencja stanu.
  if (direction !== -1 && direction !== 1) return state;
  const target = state.tasks.find((t) => t.id === taskId);
  if (!target) return state;
  const ordered = state.tasks
    .filter((t) => t.projectId === target.projectId)
    .sort(
      (a, b) =>
        a.orderIndex - b.orderIndex ||
        a.startDate.localeCompare(b.startDate) ||
        a.id.localeCompare(b.id),
    );
  const idx = ordered.findIndex((t) => t.id === taskId);
  const swapWith = idx + direction;
  if (idx === -1 || swapWith < 0 || swapWith >= ordered.length) return state;
  [ordered[idx], ordered[swapWith]] = [ordered[swapWith], ordered[idx]];
  // Renumeruj 0..n-1 tylko w tym projekcie; zadania, których ranga się nie
  // zmieniła, zachowują tożsamość obiektu (minimalizuje upserty mirrora).
  const orderOf = new Map(ordered.map((t, i) => [t.id, i]));
  return {
    ...state,
    tasks: state.tasks.map((t) => {
      const next = orderOf.get(t.id);
      return next === undefined || next === t.orderIndex ? t : { ...t, orderIndex: next };
    }),
  };
}

// Cosmetic ordering only (invariant: completion never comes from order), and
// repeat-click reorders would spam — so NO activity row is logged here.
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
  if (!hasEntity(state, 'status', statusId)) return state;
  const used =
    state.projects.some((p) => p.statusId === statusId) ||
    state.tasks.some((t) => t.statusId === statusId);
  if (used) return state;
  if (isOnlyActiveStatus(state, statusId) || isOnlyDoneStatus(state, statusId)) return state;
  const status = state.statuses.find((s) => s.id === statusId)!;
  return {
    ...state,
    statuses: state.statuses.filter((s) => s.id !== statusId),
    activity: withActivity(state, 'status', statusId, `usunął(a) status „${status.name}”`),
  };
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
  // Project must exist; name required; on edit the milestone must exist and
  // belong to that project. Otherwise the activity row could be attributed to
  // a different project than the milestone being changed.
  if (!hasEntity(state, 'project', projectId)) return state;
  if (!isRequiredName(name)) return state;
  const existingMilestone = milestoneId === null
    ? null
    : state.milestones.find((milestone) => milestone.id === milestoneId) ?? null;
  if (milestoneId !== null && existingMilestone?.projectId !== projectId) return state;
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

// ---- Cloud people merge (pełna synchronizacja zespołu) ----

const MERGE_ACCESS_ROLES = new Set<AccessRole>(['administrator', 'pm', 'handlowiec', 'pracownik']);

/** Walidacja jednego wiersza payloadu osób — fail-closed dla całego scalenia. */
function isValidCloudPersonRow(r: CloudPersonMergeRow): boolean {
  if (typeof r !== 'object' || r === null) return false;
  if (typeof r.id !== 'string' || r.id === '') return false;
  if (typeof r.email !== 'string' || normalizeEmail(r.email) === '') return false;
  if (typeof r.firstName !== 'string' || r.firstName.trim() === '') return false;
  if (typeof r.lastName !== 'string' || typeof r.role !== 'string') return false;
  if (typeof r.departmentId !== 'string') return false;
  if (typeof r.phone !== 'string' || typeof r.avatar !== 'string') return false;
  if (typeof r.supervisorEmail !== 'string') return false;
  if (typeof r.birthDate !== 'string') return false;
  if (!Number.isFinite(r.capacity) || r.capacity < 0 || r.capacity > 24) return false;
  if (!Array.isArray(r.workDays)) return false;
  if (r.workDays.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) return false;
  if (!Number.isInteger(r.workStartMinutes) || r.workStartMinutes < 0 || r.workStartMinutes > 1440)
    return false;
  if (!Number.isInteger(r.workEndMinutes) || r.workEndMinutes < 0 || r.workEndMinutes > 1440)
    return false;
  if (!MERGE_ACCESS_ROLES.has(r.accessRole)) return false;
  return true;
}

/** Pola osoby synchronizowane z profilu chmury (bez id/hasła/przełożonego). */
function cloudPersonFields(row: CloudPersonMergeRow): Omit<
  Person,
  'id' | 'passwordHash' | 'supervisorId'
> {
  const firstName = row.firstName.trim();
  const lastName = row.lastName.trim();
  const workDays = Array.from(new Set(row.workDays)).sort((a, b) => a - b);
  return {
    firstName,
    lastName,
    name: [firstName, lastName].filter(Boolean).join(' '),
    email: row.email.trim(),
    phone: row.phone.trim(),
    role: row.role.trim(),
    departmentId: row.departmentId,
    avatar: row.avatar.trim(),
    // Spójnie z personFromDraft: UI deklaruje zakres [1, 24].
    capacity: Math.min(24, Math.max(1, row.capacity)),
    accessRole: row.accessRole,
    workDays,
    workStartMinutes: row.workStartMinutes,
    workEndMinutes: row.workEndMinutes,
    // Poprawna 'yyyy-MM-dd' albo '' (spójnie z personFromDraft/migratePerson).
    birthDate: isValidDateStr(row.birthDate) ? row.birthDate : '',
  };
}

const sameWorkDays = (a: number[], b: number[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * AUTORYTATYWNE zastosowanie RLS-owych profili chmury do listy osób — chmura
 * jest jedynym źródłem prawdy o zespole:
 *   * dopasowanie po znormalizowanym e-mailu — aktualizacja pól (w tym działu
 *     chmury), lokalne id i hasło pozostają (referencje planera są stabilne);
 *   * profil bez lokalnego odpowiednika — nowa osoba z id profilu chmury
 *     (dzięki temu hydracja planera mapuje profile bez pary e-mailowej);
 *   * osoba lokalna BEZ konta chmury (np. dane demonstracyjne) jest USUWANA;
 *   * przełożony rozwiązywany po e-mailu PO upsercie (cykl => '');
 *   * brak faktycznych zmian => `changed: false` (wołający zwraca ten sam stan);
 *   * payload niepoprawny strukturalnie => `ok: false` (invariant 6).
 */
function applyCloudPeople(
  localPeople: Person[],
  payload: CloudPersonMergeRow[],
): { ok: boolean; people: Person[]; changed: boolean } {
  if (!Array.isArray(payload) || !payload.every(isValidCloudPersonRow)) {
    return { ok: false, people: localPeople, changed: false };
  }
  // FAIL-CLOSED na pusty zbiór: zalogowany użytkownik zawsze widzi (RLS) co
  // najmniej własny profil, więc pusta chmura to anomalia (regresja RLS, błąd
  // provisioning), nie prawda o zespole — bez tej bramki [] usuwałoby cały
  // lokalny zespół i (przez people.length === 0) otwierało bramkę admina.
  // Lustrzane z fail-close pustych słowników w mergeCloudDictionaries.
  if (payload.length === 0 && localPeople.length > 0) {
    return { ok: false, people: localPeople, changed: false };
  }

  // Duplikaty e-maili w payloadzie: ostatni wygrywa (deterministycznie).
  const rowByEmail = new Map<string, CloudPersonMergeRow>();
  for (const row of payload) rowByEmail.set(normalizeEmail(row.email), row);

  let changed = false;
  const matched = new Set<string>();

  // 1) Aktualizacja istniejących osób po e-mailu; osoby bez konta chmury odpadają.
  const updatedPeople: Person[] = [];
  for (const person of localPeople) {
    const key = normalizeEmail(person.email);
    const row = key === '' ? undefined : rowByEmail.get(key);
    if (!row) {
      changed = true; // osoba lokalna bez konta chmury — usunięta
      continue;
    }
    matched.add(key);
    const fields = cloudPersonFields(row);
    const same =
      person.firstName === fields.firstName &&
      person.lastName === fields.lastName &&
      person.name === fields.name &&
      person.email === fields.email &&
      person.phone === fields.phone &&
      person.role === fields.role &&
      person.departmentId === fields.departmentId &&
      person.avatar === fields.avatar &&
      person.capacity === fields.capacity &&
      person.accessRole === fields.accessRole &&
      person.workStartMinutes === fields.workStartMinutes &&
      person.workEndMinutes === fields.workEndMinutes &&
      person.birthDate === fields.birthDate &&
      sameWorkDays(person.workDays, fields.workDays);
    if (same) {
      updatedPeople.push(person);
    } else {
      changed = true;
      updatedPeople.push({ ...person, ...fields });
    }
  }

  // 2) Nowe osoby (profil bez lokalnego odpowiednika) — id profilu chmury.
  const existingIds = new Set(updatedPeople.map((p) => p.id));
  const appended: Person[] = [];
  for (const [key, row] of rowByEmail) {
    if (matched.has(key)) continue;
    if (existingIds.has(row.id)) continue; // kolizja id — fail-safe, pomiń
    appended.push({
      id: row.id,
      ...cloudPersonFields(row),
      passwordHash: '',
      supervisorId: '',
    });
    existingIds.add(row.id);
  }
  if (appended.length > 0) changed = true;

  // 3) Przełożeni po e-mailu (na finalnej liście; cykl lub brak => '').
  let people = appended.length > 0 ? [...updatedPeople, ...appended] : updatedPeople;
  const idByEmail = new Map(
    people.filter((p) => normalizeEmail(p.email) !== '').map((p) => [normalizeEmail(p.email), p.id]),
  );
  for (const [key, row] of rowByEmail) {
    const personId = idByEmail.get(key);
    if (!personId) continue;
    const target = row.supervisorEmail === '' ? '' : idByEmail.get(normalizeEmail(row.supervisorEmail)) ?? '';
    const supervisorId = wouldCreateSupervisorCycle(people, personId, target) ? '' : target;
    const person = people.find((p) => p.id === personId);
    if (person && person.supervisorId !== supervisorId) {
      changed = true;
      people = people.map((p) => (p.id === personId ? { ...p, supervisorId } : p));
    }
  }

  return { ok: true, people, changed };
}

/** Czyści tożsamości sesji wskazujące osoby usunięte przez scalenie. */
function reconcileIdentityAfterPeopleMerge(
  state: AppData,
  people: Person[],
): Pick<AppData, 'currentUserId' | 'impersonatorId'> {
  const ids = new Set(people.map((p) => p.id));
  return {
    currentUserId: ids.has(state.currentUserId) ? state.currentUserId : '',
    impersonatorId: ids.has(state.impersonatorId) ? state.impersonatorId : '',
  };
}

/** Akcja MERGE_CLOUD_PEOPLE — cicha, idempotentna hydracja zespołu z chmury. */
function mergeCloudPeople(state: AppData, payload: CloudPersonMergeRow[]): AppData {
  const result = applyCloudPeople(state.people, payload);
  if (!result.ok || !result.changed) return state;
  return { ...state, people: result.people, ...reconcileIdentityAfterPeopleMerge(state, result.people) };
}

// ---- Cloud dictionaries merge (statusy + słowniki, autorytatywnie) -----------

/** Wiersz słownikowy: niepusty string id + name. */
function isValidNamedRow(v: unknown): v is { id: string; name: string } {
  if (!isObjWithId(v)) return false;
  const name = (v as { name?: unknown }).name;
  return typeof name === 'string' && name.trim() !== '';
}

function isValidStatusRow(v: unknown): v is Status {
  if (!isValidNamedRow(v)) return false;
  const s = v as unknown as Status;
  return (
    typeof s.slug === 'string' &&
    typeof s.color === 'string' &&
    typeof s.order === 'number' &&
    Number.isFinite(s.order) &&
    typeof s.archived === 'boolean' &&
    typeof s.isDone === 'boolean'
  );
}

const sameNamedRows = (a: Array<{ id: string; name: string }>, b: Array<{ id: string; name: string }>): boolean =>
  a.length === b.length && a.every((r, i) => r.id === b[i].id && r.name === b[i].name);

const sameStatusRows = (a: Status[], b: Status[]): boolean =>
  a.length === b.length &&
  a.every(
    (s, i) =>
      s.id === b[i].id &&
      s.name === b[i].name &&
      s.slug === b[i].slug &&
      s.color === b[i].color &&
      s.order === b[i].order &&
      s.archived === b[i].archived &&
      s.isDone === b[i].isDone,
  );

export interface CloudDictionariesPayload {
  departments: Department[];
  statuses: Status[];
  serviceTypes: ServiceType[];
  workCategories: WorkCategory[];
}

/**
 * AUTORYTATYWNE scalenie słowników organizacji z chmury (działy, statusy, typy
 * usług, kategorie prac) — lokalne kopie są zastępowane w całości. Fail-closed
 * (invariant 6): niepoprawna struktura ALBO zestaw statusów łamiący twardy
 * invariant planera (co najmniej jeden aktywny nie-ukończony i jeden aktywny
 * ukończony status) zwraca ORYGINALNĄ referencję stanu — w szczególności pusta
 * chmura statusów (przed seedem) nie może zdemolować lokalnego lejka. Brak
 * faktycznych zmian => ta sama referencja (dispatch jest idempotentny).
 */
function mergeCloudDictionaries(state: AppData, payload: CloudDictionariesPayload): AppData {
  if (typeof payload !== 'object' || payload === null) return state;
  const { departments, statuses, serviceTypes, workCategories } = payload;
  if (
    !Array.isArray(departments) ||
    !Array.isArray(statuses) ||
    !Array.isArray(serviceTypes) ||
    !Array.isArray(workCategories)
  ) {
    return state;
  }
  if (!departments.every(isValidNamedRow)) return state;
  if (!serviceTypes.every(isValidNamedRow)) return state;
  if (!workCategories.every(isValidNamedRow)) return state;
  if (!statuses.every(isValidStatusRow)) return state;
  // Twardy invariant 5: przynajmniej jeden aktywny status w toku i jeden done.
  const hasActive = statuses.some((s) => !s.archived && !s.isDone);
  const hasDone = statuses.some((s) => !s.archived && s.isDone);
  if (!hasActive || !hasDone) return state;

  const sorted = [...statuses].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  if (
    sameNamedRows(state.departments, departments) &&
    sameNamedRows(state.serviceTypes, serviceTypes) &&
    sameNamedRows(state.workCategories, workCategories) &&
    sameStatusRows(state.statuses, sorted)
  ) {
    return state;
  }
  return {
    ...state,
    departments: [...departments],
    serviceTypes: [...serviceTypes],
    workCategories: [...workCategories],
    statuses: sorted,
  };
}

// ---- Cloud hydration merge ----

function isObjWithId(v: unknown): v is { id: string } {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { id?: unknown }).id === 'string' &&
    (v as { id: string }).id !== ''
  );
}

/** A payload workload row is on the 0.25h grid (finite, positive, quarter). */
function isQuarterHours(v: unknown): v is number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return false;
  const q = v / HOURS_STEP;
  return Math.abs(q - Math.round(q)) < 1e-9;
}

/**
 * Głęboka równość WARTOŚCI dla płaskich danych wiersza (prymitywy, tablice,
 * zwykłe obiekty). Wiersze planera są czystym JSON-em — mają zagnieżdżone
 * tablice (`Task.checklist`, `Comment.mentionIds`), więc porównanie płytkie
 * fałszywie raportowałoby zmianę przy każdym odświeżeniu.
 */
function sameRowValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => sameRowValue(v, b[i]));
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = Object.keys(ao);
  if (keys.length !== Object.keys(bo).length) return false;
  return keys.every(
    (k) => Object.prototype.hasOwnProperty.call(bo, k) && sameRowValue(ao[k], bo[k]),
  );
}

/**
 * BEZSZWOWE scalenie kolekcji: chmura pozostaje autorytatywna (zbiór i kolejność
 * wierszy pochodzą z `next`), ale wiersz identyczny wartościowo zachowuje SWOJĄ
 * DOTYCHCZASOWĄ REFERENCJĘ, a kolekcja bez żadnej zmiany zwraca dotychczasową
 * TABLICĘ. Bez tego każde odświeżenie z Realtime tworzyło komplet nowych
 * obiektów, unieważniało wszystkie `useMemo`/selektory i przerysowywało
 * kalendarz oraz mapę — źródło migotania.
 */
function reconcileRows<T extends { id: string }>(prev: T[], next: T[]): T[] {
  const byId = new Map(prev.map((row) => [row.id, row]));
  let identical = prev.length === next.length;
  const out = next.map((row, i) => {
    const local = byId.get(row.id);
    const kept = local !== undefined && sameRowValue(local, row) ? local : row;
    if (identical && prev[i] !== kept) identical = false;
    return kept;
  });
  return identical ? prev : out;
}

/** Ta sama tablica, gdy scalenie nie zmieniło żadnej pozycji ani długości. */
function keepArrayIfSame<T>(prev: T[], next: T[]): T[] {
  if (prev.length !== next.length) return next;
  return next.every((row, i) => prev[i] === row) ? prev : next;
}

/**
 * AUTHORITATIVE hydration of the eight mirrored cloud collections: the cloud is
 * the single source of truth, so the payload REPLACES each collection (local
 * rows the cloud does not know are dropped — this is what retires demo/sample
 * planner data on every browser). Runs once per sign-in with an empty push
 * queue, so no unsynced local edit can be lost here. When `payload.people` is
 * present, the RLS profile set is applied FIRST (same semantics as
 * MERGE_CLOUD_PEOPLE), so entity validation sees the final team.
 * Fail-closed (invariant 6): a structurally invalid payload — a non-array
 * collection, a row with no string id, a project/task with an invalid period, a
 * task referencing a missing project, an assignment referencing a missing
 * task/person, a milestone with an invalid date / missing project, or a
 * workload row with off-grid/day-overflowing values or a missing task/person —
 * returns the ORIGINAL state reference. Statuses/dictionaries/savedFilters pass
 * through by reference untouched (MERGE_CLOUD_DICTIONARIES owns dictionaries).
 */
function mergeCloudEntities(state: AppData, payload: CloudMergePayload): AppData {
  const collections = [
    payload.clients,
    payload.projects,
    payload.milestones,
    payload.tasks,
    payload.assignments,
    payload.workload,
    payload.comments,
    payload.activity,
  ];
  if (collections.some((c) => !Array.isArray(c))) return state;
  // Zgłoszenia są OPCJONALNE w ładunku (dopisane addytywnie): brak pola => bez
  // zmian w kolekcji, obecne => walidacja i autorytatywna podmiana niżej.
  if (payload.tickets !== undefined && !Array.isArray(payload.tickets)) return state;

  // Osoby najpierw (autorytatywnie), żeby walidacja encji widziała finalny
  // zespół. Niepoprawny blok osób psuje całą hydrację (atomowość).
  let mergedPeople = state.people;
  if (payload.people !== undefined) {
    const peopleResult = applyCloudPeople(state.people, payload.people);
    if (!peopleResult.ok) return state;
    mergedPeople = peopleResult.people;
  }

  // Every mirrored entity row (except assignment pairs) needs a string id.
  if (
    !payload.clients.every(isObjWithId) ||
    !payload.projects.every(isObjWithId) ||
    !payload.milestones.every(isObjWithId) ||
    !payload.tasks.every(isObjWithId) ||
    !payload.workload.every(isObjWithId) ||
    !payload.comments.every(isObjWithId) ||
    !payload.activity.every(isObjWithId) ||
    (payload.tickets !== undefined && !payload.tickets.every(isObjWithId))
  ) {
    return state;
  }

  // Autorytatywnie: referencje walidujemy wobec ZBIORU DOCELOWEGO (payload),
  // nie sumy z lokalnym — wiersz wskazujący encję spoza chmury jest błędem.
  const projectIds = new Set<string>(payload.projects.map((p) => p.id));
  const taskIds = new Set<string>(payload.tasks.map((t) => t.id));
  const personIds = new Set(mergedPeople.map((p) => p.id));

  // Project/task periods must satisfy the same guards the reducer applies.
  for (const p of payload.projects) {
    if (periodError(p.startDate, p.endDate) !== null) return state;
  }
  for (const t of payload.tasks) {
    if (periodError(t.startDate, t.endDate, { maxDays: MAX_TASK_PERIOD_DAYS }) !== null) {
      return state;
    }
    if (!projectIds.has(t.projectId)) return state;
  }
  for (const m of payload.milestones) {
    if (!isValidDateStr(m.date) || !projectIds.has(m.projectId)) return state;
  }
  for (const a of payload.assignments) {
    if (
      typeof a?.taskId !== 'string' ||
      typeof a?.personId !== 'string' ||
      !taskIds.has(a.taskId) ||
      !personIds.has(a.personId)
    ) {
      return state;
    }
  }
  // Workload rows: grid + reference validation (belt-and-braces with Scope 2).
  for (const w of payload.workload) {
    if (!taskIds.has(w.taskId) || !personIds.has(w.personId)) return state;
    if (!isQuarterHours(w.plannedHours)) return state;
    if (
      !Number.isFinite(w.startMinutes) ||
      w.startMinutes < 0 ||
      w.startMinutes % MINUTE_STEP !== 0
    ) {
      return state;
    }
    const isBin = w.date === BIN_DATE;
    if (!isBin) {
      if (!isValidDateStr(w.date)) return state;
      if (w.startMinutes + hoursToMinutes(w.plannedHours) > DAY_MINUTES) return state;
    }
  }

  // Zgłoszenia: zgłaszający MUSI istnieć w finalnym zespole, a rodzaj/priorytet/
  // status muszą należeć do swoich zbiorów — inaczej cała hydracja jest
  // odrzucana (fail-closed, jak pozostałe rodziny).
  if (payload.tickets !== undefined) {
    for (const t of payload.tickets) {
      if (!personIds.has(t.reporterId)) return state;
      if (!isTicketKind(t.kind) || !isTicketPriority(t.priority) || !isTicketStatus(t.status)) {
        return state;
      }
    }
  }

  // Assignments reconciled by (taskId, personId): a pair the local state
  // already knows keeps its local row id (stable references); a genuinely new
  // cloud pair gets a fresh uid. Pairs the cloud does not know are DROPPED.
  const localByPair = new Map(state.assignments.map((a) => [`${a.taskId}|${a.personId}`, a]));
  const seenPairs = new Set<string>();
  const assignments: TaskAssignment[] = [];
  for (const a of payload.assignments) {
    const key = `${a.taskId}|${a.personId}`;
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    const existing = localByPair.get(key);
    assignments.push(existing ?? { id: uid(), taskId: a.taskId, personId: a.personId });
  }

  // Scalenie zachowujące referencje: wiersz bajtowo identyczny zostaje TYM
  // SAMYM obiektem, kolekcja bez zmian zostaje TĄ SAMĄ tablicą, a hydracja,
  // która niczego nie zmieniła, zwraca ORYGINALNĄ referencję stanu. Dzięki temu
  // odświeżenie w tle nie unieważnia memoizacji widoków (brak migotania) i jest
  // idempotentne — spójne z fail-closed z invariantu 6 wyżej.
  const merged: AppData = {
    ...state,
    people: mergedPeople,
    ...reconcileIdentityAfterPeopleMerge(state, mergedPeople),
    clients: reconcileRows(state.clients, payload.clients),
    projects: reconcileRows(state.projects, payload.projects),
    milestones: reconcileRows(state.milestones, payload.milestones),
    tasks: reconcileRows(state.tasks, payload.tasks),
    comments: reconcileRows(state.comments, payload.comments),
    activity: reconcileRows(state.activity, payload.activity),
    workload: reconcileRows(state.workload, payload.workload),
    assignments: keepArrayIfSame(state.assignments, assignments),
    ...(payload.tickets !== undefined
      ? { tickets: reconcileRows(state.tickets, payload.tickets) }
      : {}),
  };
  const keys = Object.keys(merged) as Array<keyof AppData>;
  return keys.every((k) => Object.is(merged[k], state[k])) ? state : merged;
}

// ---- Reducer ----

export function reducer(state: AppData, action: Action): AppData {
  switch (action.type) {
    case 'SAVE_TASK':
      return saveTask(state, action.payload);
    case 'DELETE_TASK': {
      // Only log when the task exists. The row lives on the PARENT PROJECT
      // (entityType 'project') so it stays visible in the project's activity
      // panel and survives deleteTask's own 'task'-row pruning.
      const task = state.tasks.find((t) => t.id === action.taskId);
      const next = deleteTask(state, action.taskId);
      if (!task) return next;
      return {
        ...next,
        activity: withActivity(next, 'project', task.projectId, `usunął(a) zadanie „${task.title}”`),
      };
    }
    case 'PUBLISH_PROJECT_DRAFTS':
      return publishProjectDrafts(state, action.projectId);
    case 'PUBLISH_TASK':
      return publishTask(state, action.taskId);
    case 'MOVE_TASK':
      return moveTask(state, action.taskId, action.dayDelta);
    case 'SET_TASK_DATES':
      return setTaskDates(state, action.taskId, action.startDate, action.endDate);
    case 'SET_TASK_STATUS': {
      // Reject a stale taskId (would append activity) or a dangling statusId
      // (would persist onto the task) before any write.
      if (!hasEntity(state, 'task', action.taskId) || !hasEntity(state, 'status', action.statusId)) {
        return state;
      }
      // Re-applying the current status is a no-op (mirrors SET_PROJECT_STATUS):
      // no activity row, no updatedAt churn, same state reference.
      const current = state.tasks.find((t) => t.id === action.taskId);
      if (current && current.statusId === action.statusId) return state;
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
      return saveProject(state, action.projectId, action.draft);
    case 'DELETE_PROJECT': {
      // Only log when the project exists. A 'project'-typed row would be pruned
      // by deleteProject itself, so the deletion record lives on 'system' with
      // no entityId. Append onto the post-cascade state (identities unchanged).
      const project = state.projects.find((p) => p.id === action.projectId);
      const next = deleteProject(state, action.projectId);
      if (!project) return next;
      return {
        ...next,
        activity: withActivity(next, 'system', '', `usunął(a) projekt „${project.name}”`),
      };
    }
    case 'SET_PROJECT_STATUS': {
      // Existing stale-project guard, plus a dangling-statusId reject.
      if (!hasEntity(state, 'status', action.statusId)) return state;
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
      if (!hasEntity(state, 'project', action.projectId)) return state;
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
      // A stale id would otherwise append a garbage activity row.
      if (!hasEntity(state, 'project', action.projectId)) return state;
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
    // ---- Dokumenty projektu ----
    // Wyłącznie ODNOŚNIKI (żadnych plików). Walidacja i normalizacja żyją w
    // commandValidation (normalizeProjectDocumentDraft): pusty adres, adres o
    // schemacie innym niż http(s), nieznany rodzaj albo nieistniejący
    // projekt/dokument => TA SAMA referencja stanu (inwariant 6). Zapisujemy
    // ZNORMALIZOWANY adres, więc w stanie nie ląduje nic, czego nie wolno potem
    // wstawić w `href`. Lista jest osadzona w projekcie, więc DELETE_PROJECT
    // sprząta ją bez osobnej kaskady.
    case 'ADD_PROJECT_DOCUMENT': {
      if (!hasEntity(state, 'project', action.projectId)) return state;
      const normalized = normalizeProjectDocumentDraft(action.draft);
      if (!normalized) return state;
      const doc: ProjectDocument = { id: uid(), ...normalized };
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === action.projectId
            ? { ...p, documents: [...p.documents, doc], updatedAt: nowIso() }
            : p,
        ),
        activity: withActivity(
          state,
          'project',
          action.projectId,
          `dodał(a) dokument „${documentTitle(doc)}”`,
        ),
      };
    }
    case 'SAVE_PROJECT_DOCUMENT': {
      const project = state.projects.find((p) => p.id === action.projectId);
      const current = project?.documents.find((d) => d.id === action.documentId);
      if (!project || !current) return state;
      const normalized = normalizeProjectDocumentDraft(action.draft);
      if (!normalized) return state;
      const next: ProjectDocument = { ...current, ...normalized };
      // Zapis bez żadnej zmiany to no-op (jak SET_TICKET_STATUS): bez wpisu do
      // dziennika i bez ruszania `updatedAt`.
      if (
        next.kind === current.kind &&
        next.label === current.label &&
        next.url === current.url
      ) {
        return state;
      }
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === action.projectId
            ? {
                ...p,
                documents: p.documents.map((d) => (d.id === action.documentId ? next : d)),
                updatedAt: nowIso(),
              }
            : p,
        ),
        activity: withActivity(
          state,
          'project',
          action.projectId,
          `zaktualizował(a) dokument „${documentTitle(next)}”`,
        ),
      };
    }
    case 'DELETE_PROJECT_DOCUMENT': {
      const project = state.projects.find((p) => p.id === action.projectId);
      const doc = project?.documents.find((d) => d.id === action.documentId);
      if (!project || !doc) return state;
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === action.projectId
            ? {
                ...p,
                documents: p.documents.filter((d) => d.id !== action.documentId),
                updatedAt: nowIso(),
              }
            : p,
        ),
        activity: withActivity(
          state,
          'project',
          action.projectId,
          `usunął/usunęła dokument „${documentTitle(doc)}”`,
        ),
      };
    }
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
      // Reject a stale id by same-reference (previously returned a new copy).
      const m = state.milestones.find((x) => x.id === action.milestoneId);
      if (!m) return state;
      return {
        ...state,
        milestones: state.milestones.filter((x) => x.id !== action.milestoneId),
        activity: withActivity(state, 'project', m.projectId, `usunął/usunęła kamień milowy „${m.name}”`),
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
      if (!isValidPersonDraft(action.person)) return state;
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
        // Fresh-setup case (empty people, currentUserId === '') still logs; the
        // actor renders via the UI fallback.
        activity: withActivity(state, 'person', id, `dodał(a) osobę „${base.name}”`),
      };
    }
    case 'UPDATE_PERSON': {
      const base = personFromDraft(action.person);
      // Guard the last administrator: refuse a save that would demote the only
      // remaining admin (returns state unchanged — reject-by-same-ref).
      const target = state.people.find((p) => p.id === action.personId);
      if (!target) return state;
      if (!isValidPersonDraft(action.person)) return state;
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
      // Note a role change in the message; otherwise a plain update row. One row
      // either way, stamped from the pre-update state.
      const message =
        target.accessRole !== base.accessRole
          ? `zaktualizował(a) dane osoby „${base.name}” (rola: ${ROLE_LABELS[target.accessRole]} → ${ROLE_LABELS[base.accessRole]})`
          : `zaktualizował(a) dane osoby „${base.name}”`;
      return {
        ...state,
        people: state.people.map((p) =>
          p.id === action.personId ? { ...p, ...base, supervisorId } : p,
        ),
        activity: withActivity(state, 'person', action.personId, message),
      };
    }
    case 'DELETE_PERSON': {
      // Reject a stale id first (no cascade, no state churn on a missing person).
      if (!hasEntity(state, 'person', action.personId)) return state;
      // Guard the last administrator: refuse to delete the only remaining admin
      // (returns state unchanged). Applied BEFORE the deletePerson cascade so the
      // supervisorId cleanup only runs on an allowed delete.
      const target = state.people.find((p) => p.id === action.personId);
      const adminCount = state.people.filter((p) => p.accessRole === 'administrator').length;
      if (target?.accessRole === 'administrator' && adminCount === 1) {
        return state;
      }
      const next = deletePerson(state, action.personId);
      // Stamp from the PRE-delete state deliberately: deletePerson may rewrite
      // currentUserId/impersonatorId (impersonation interplay) and the row must
      // reflect who acted. The 'person' row survives — it is never pruned.
      return {
        ...next,
        activity: withActivity(state, 'person', action.personId, `usunął(a) osobę „${target!.name}”`),
      };
    }
    case 'SET_CURRENT_USER': {
      // '' is a programmatic identity clear; any other id must exist so a
      // dangling personId can never be persisted as the acting user.
      if (action.personId !== '' && !hasEntity(state, 'person', action.personId)) return state;
      // Login / direct identity set: always ends any impersonation.
      const nextUser = { ...state, currentUserId: action.personId, impersonatorId: '' };
      // '' clears identity programmatically — only LOGOUT records a logout, so no
      // row here. A same-id re-select (not impersonating) is a no-op — no row.
      if (
        action.personId === '' ||
        (action.personId === state.currentUserId && state.impersonatorId === '')
      ) {
        return nextUser;
      }
      // Login row: the pre-state currentUserId may be '', so attribute to the id
      // that just logged in via the `as` override.
      return {
        ...nextUser,
        activity: withActivity(state, 'system', '', 'zalogował(a) się', {
          actorId: action.personId,
          impersonatorId: '',
        }),
      };
    }
    case 'IMPERSONATE': {
      // No-op when the target doesn't exist or is already the acted-as identity.
      const exists = state.people.some((p) => p.id === action.personId);
      if (!exists || action.personId === state.currentUserId) return state;
      // Picking the current impersonator's own row means "return" — an END event.
      if (action.personId === state.impersonatorId) {
        const acted = state.people.find((p) => p.id === state.currentUserId);
        return {
          ...state,
          currentUserId: state.impersonatorId,
          impersonatorId: '',
          activity: withActivity(
            state,
            'system',
            '',
            `zakończył(a) podgląd jako „${acted?.name ?? '?'}”`,
            { actorId: state.impersonatorId, impersonatorId: '' },
          ),
        };
      }
      // Chained switches keep the ORIGINAL real user as the impersonator. The
      // impersonation act itself is the real administrator's own action.
      const target = state.people.find((p) => p.id === action.personId);
      return {
        ...state,
        currentUserId: action.personId,
        impersonatorId: state.impersonatorId || state.currentUserId,
        activity: withActivity(
          state,
          'system',
          '',
          `rozpoczął(a) podgląd jako „${target?.name ?? '?'}”`,
          { actorId: state.impersonatorId || state.currentUserId, impersonatorId: '' },
        ),
      };
    }
    case 'STOP_IMPERSONATION': {
      if (state.impersonatorId === '') return state;
      const acted = state.people.find((p) => p.id === state.currentUserId);
      return {
        ...state,
        currentUserId: state.impersonatorId,
        impersonatorId: '',
        activity: withActivity(
          state,
          'system',
          '',
          `zakończył(a) podgląd jako „${acted?.name ?? '?'}”`,
          { actorId: state.impersonatorId, impersonatorId: '' },
        ),
      };
    }
    case 'SET_PASSWORD': {
      // Stores the given hash verbatim ('' clears the password). Log only when
      // the person exists. The message must never leak set-vs-clear nor the hash.
      const person = state.people.find((p) => p.id === action.personId);
      const nextPw = {
        ...state,
        people: state.people.map((p) =>
          p.id === action.personId ? { ...p, passwordHash: action.passwordHash } : p,
        ),
      };
      if (!person) return nextPw;
      return {
        ...nextPw,
        activity: withActivity(state, 'person', action.personId, `zmienił(a) ustawienia hasła osoby „${person.name}”`),
      };
    }
    case 'LOGOUT': {
      // Full logout (not "return"): clears both the acted-as and real identity.
      // Nobody to log out -> no row, state result unchanged from before.
      if (state.currentUserId === '' && state.impersonatorId === '') {
        return { ...state, currentUserId: '', impersonatorId: '' };
      }
      // Default pre-transition stamping records dual identity when logging out
      // mid-impersonation.
      return {
        ...state,
        currentUserId: '',
        impersonatorId: '',
        activity: withActivity(state, 'system', '', 'wylogował(a) się'),
      };
    }
    case 'ADD_CLIENT': {
      // Wymagane: nazwa, osoba kontaktowa i e-mail LUB telefon
      // (isValidClientDraft). Niepełny draft => TA SAMA referencja stanu.
      if (!isValidClientDraft(action)) return state;
      const name = action.name.trim();
      return {
        ...state,
        clients: [
          ...state.clients,
          {
            id: uid(),
            name,
            archived: false,
            contactName: action.contactName?.trim() ?? '',
            contactEmail: action.contactEmail?.trim() ?? '',
            contactPhone: action.contactPhone?.trim() ?? '',
            notes: action.notes?.trim() ?? '',
          },
        ],
      };
    }
    case 'SAVE_CLIENT': {
      // Jak RENAME_CLIENT: nieznane id odrzucone; do tego pełen komplet pól
      // wymaganych (isValidClientDraft) — brak nazwy, osoby kontaktowej albo
      // obu kanałów kontaktu zwraca TĘ SAMĄ referencję stanu (invariant 6).
      if (!isValidClientDraft(action)) return state;
      const name = action.name.trim();
      if (!state.clients.some((c) => c.id === action.clientId)) return state;
      return {
        ...state,
        clients: state.clients.map((c) =>
          c.id === action.clientId
            ? {
                ...c,
                name,
                contactName: action.contactName.trim(),
                contactEmail: action.contactEmail.trim(),
                contactPhone: action.contactPhone.trim(),
                notes: action.notes.trim(),
              }
            : c,
        ),
      };
    }
    case 'SET_CLIENT_ARCHIVED': {
      const client = state.clients.find((c) => c.id === action.clientId);
      if (!client || client.archived === action.archived) return state;
      return {
        ...state,
        clients: state.clients.map((c) =>
          c.id === action.clientId ? { ...c, archived: action.archived } : c,
        ),
      };
    }
    case 'RENAME_CLIENT': {
      // Mirror ADD_CLIENT: trim and reject an empty name. Reject an unknown id
      // too, so a stale rename returns the SAME state reference (invariant 6).
      const name = action.name.trim();
      if (!name || !state.clients.some((c) => c.id === action.clientId)) return state;
      return {
        ...state,
        clients: state.clients.map((c) =>
          c.id === action.clientId ? { ...c, name } : c,
        ),
      };
    }
    case 'DELETE_CLIENT': {
      // Cascade: client -> its projects -> their tasks/blocks.
      const client = state.clients.find((c) => c.id === action.clientId);
      let next: AppData = state;
      for (const p of state.projects.filter((p) => p.clientId === action.clientId)) {
        next = deleteProject(next, p.id);
      }
      const cleaned = { ...next, clients: next.clients.filter((c) => c.id !== action.clientId) };
      if (!client) return cleaned;
      // One 'client' row built on the post-cascade state so the cascade's pruning
      // is not resurrected (identities are unchanged, so stamping stays honest).
      return {
        ...cleaned,
        activity: withActivity(cleaned, 'client', action.clientId, `usunął(a) klienta „${client.name}”`),
      };
    }
    case 'ADD_DEPARTMENT': {
      const name = action.name.trim();
      if (!name) return state;
      return {
        ...state,
        departments: [...state.departments, { id: uid(), name }],
      };
    }
    case 'RENAME_DEPARTMENT': {
      const name = action.name.trim();
      if (!name || !state.departments.some((d) => d.id === action.departmentId)) return state;
      return {
        ...state,
        departments: state.departments.map((d) =>
          d.id === action.departmentId ? { ...d, name } : d,
        ),
      };
    }
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
        tasks: state.tasks.map((t) =>
          t.departmentId === action.departmentId ? { ...t, departmentId: '' } : t,
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
    case 'RENAME_SERVICE_TYPE': {
      const name = action.name.trim();
      if (!name || !state.serviceTypes.some((s) => s.id === action.serviceTypeId)) return state;
      return {
        ...state,
        serviceTypes: state.serviceTypes.map((s) =>
          s.id === action.serviceTypeId ? { ...s, name } : s,
        ),
      };
    }
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
    case 'RENAME_WORK_CATEGORY': {
      const name = action.name.trim();
      if (!name || !state.workCategories.some((c) => c.id === action.workCategoryId)) return state;
      return {
        ...state,
        workCategories: state.workCategories.map((c) =>
          c.id === action.workCategoryId ? { ...c, name } : c,
        ),
      };
    }
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
    case 'REORDER_PROJECT_TASK':
      return reorderProjectTask(state, action.taskId, action.direction);
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
    // ---- Zgłoszenia ----
    // Walidacja żyje w commandValidation (isValidTicketDraft): pusty tytuł/opis,
    // nieznany reporterId albo wartość spoza enuma => TA SAMA referencja stanu
    // (inwariant 6). Kolekcja jest samodzielna — brak kaskad i wpisów dziennika.
    case 'ADD_TICKET': {
      if (!isValidTicketDraft(state, action.draft)) return state;
      const stamp = nowIso();
      return {
        ...state,
        tickets: [
          ...state.tickets,
          {
            id: uid(),
            title: action.draft.title.trim(),
            area: action.draft.area.trim(),
            description: action.draft.description.trim(),
            kind: action.draft.kind,
            priority: action.draft.priority,
            status: DEFAULT_TICKET_STATUS,
            reporterId: action.draft.reporterId,
            createdAt: stamp,
            updatedAt: stamp,
          },
        ],
      };
    }
    case 'SAVE_TICKET': {
      if (!state.tickets.some((t) => t.id === action.ticketId)) return state;
      if (!isValidTicketDraft(state, action.draft)) return state;
      return {
        ...state,
        tickets: state.tickets.map((t) =>
          t.id === action.ticketId
            ? {
                ...t,
                title: action.draft.title.trim(),
                area: action.draft.area.trim(),
                description: action.draft.description.trim(),
                kind: action.draft.kind,
                priority: action.draft.priority,
                reporterId: action.draft.reporterId,
                updatedAt: nowIso(),
              }
            : t,
        ),
      };
    }
    case 'SET_TICKET_STATUS': {
      const ticket = state.tickets.find((t) => t.id === action.ticketId);
      if (!ticket || !isValidTicketStatus(action.status)) return state;
      // Ponowne ustawienie tego samego statusu to no-op (jak SET_TASK_STATUS).
      if (ticket.status === action.status) return state;
      return {
        ...state,
        tickets: state.tickets.map((t) =>
          t.id === action.ticketId ? { ...t, status: action.status, updatedAt: nowIso() } : t,
        ),
      };
    }
    case 'DELETE_TICKET': {
      if (!state.tickets.some((t) => t.id === action.ticketId)) return state;
      return { ...state, tickets: state.tickets.filter((t) => t.id !== action.ticketId) };
    }
    case 'LOAD_SAMPLE':
      return { ...action.data, sampleBannerDismissed: true };
    case 'DISMISS_SAMPLE_BANNER':
      return { ...state, sampleBannerDismissed: true };
    case 'RESET_ALL':
      return action.data;
    case 'REPLACE_FROM_STORAGE':
      return action.data;
    case 'MERGE_CLOUD_ENTITIES':
      return mergeCloudEntities(state, action.payload);
    case 'MERGE_CLOUD_PEOPLE':
      return mergeCloudPeople(state, action.payload);
    case 'MERGE_CLOUD_DICTIONARIES':
      return mergeCloudDictionaries(state, action.payload);
    default:
      return state;
  }
}

interface StoreValue {
  state: AppData;
  dispatch: React.Dispatch<Action>;
  // Type of the LAST dispatched action. The cloud mirror (CloudSyncProvider)
  // reads it to suppress its own hydration and local-only transitions
  // (MERGE_CLOUD_ENTITIES / REPLACE_FROM_STORAGE / LOAD_SAMPLE / RESET_ALL).
  // No consumer signature changes — existing useStore() callers ignore it.
  lastActionRef: React.MutableRefObject<Action['type'] | null>;
}

const StoreContext = createContext<StoreValue | null>(null);

// ---- Persistence meta-state (honest save outcome + same-browser tab safety) --
// This lives OUTSIDE the reducer: it is meta-state about the persist layer, and
// dispatching from the persist effect would risk loops. A separate context
// keeps useStore's signature and every existing consumer untouched.

export type ExternalDataStatus = 'none' | 'refreshed' | 'conflict';

export interface PersistenceValue {
  saveError: SaveFailureReason | null;
  external: ExternalDataStatus;
  /** Re-attempt saveData(current state). */
  retryPersist: () => void;
  /** Replace local state with loadData() (UI confirms first). */
  acceptExternal: () => void;
  /** Write current state NOW, overwriting the external version. */
  keepLocal: () => void;
  /** 'refreshed' -> 'none'. */
  dismissExternalNotice: () => void;
}

const PersistenceContext = createContext<PersistenceValue | null>(null);

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const initialLoadRef = useRef<Extract<ReturnType<typeof loadDataResult>, { ok: true }> | null>(
    null,
  );
  if (initialLoadRef.current === null) {
    const result = loadDataResult();
    if (!result.ok) throw result.error;
    initialLoadRef.current = result;
  }
  const initialLoad = initialLoadRef.current;
  const [state, rawDispatch] = useReducer(reducer, initialLoad.data);

  // Track the last dispatched action type so the cloud mirror can suppress its
  // own hydration and local-only transitions. A thin wrapper keeps useStore()'s
  // signature and every existing consumer untouched.
  const lastActionRef = useRef<Action['type'] | null>(null);
  const dispatch = useCallback<React.Dispatch<Action>>((action) => {
    lastActionRef.current = action.type;
    rawDispatch(action);
  }, []);

  const [saveError, setSaveError] = useState<SaveFailureReason | null>(null);
  const [external, setExternal] = useState<ExternalDataStatus>('none');
  const [loadError, setLoadError] = useState<Error | null>(null);

  // Live refs synced each render so the mount-once storage listener and the
  // stable callbacks read current values without stale closures.
  const stateRef = useRef(state);
  stateRef.current = state;
  const saveErrorRef = useRef(saveError);
  saveErrorRef.current = saveError;
  const externalRef = useRef(external);
  externalRef.current = external;

  // Skip the pointless first persist of freshly-loaded state (a mount echo that
  // would bump the revision and spam other tabs), and skip the write-back right
  // after any REPLACE_FROM_STORAGE (that state was just loaded from storage).
  const skipPersistRef = useRef(!initialLoad.needsWriteback);
  // React StrictMode replays mount effects in development. Remember the state
  // object whose persistence was already attempted so an initial repair is
  // written exactly once (and a clean load is never echo-written on replay).
  const lastPersistAttemptRef = useRef<AppData | null>(null);

  // Assign person colours by stable list order. Done during render (idempotent)
  // so colours are correct on the first paint of any consumer.
  registerPersonOrder(state.people.map((p) => p.id));

  // Persist on every state change and RECORD the real outcome. A failed write
  // surfaces via `saveError` (usePersistence); a subsequent successful write
  // clears it and — per the conflict lifecycle — collapses an outstanding
  // external conflict to resolved (continuing to work here is an implicit
  // keep-mine). The first run (and the run right after an in-place
  // REPLACE_FROM_STORAGE) is skipped: that state already matches storage.
  useEffect(() => {
    if (skipPersistRef.current) {
      skipPersistRef.current = false;
      lastPersistAttemptRef.current = state;
      return;
    }
    if (lastPersistAttemptRef.current === state) return;
    const prevAttempted = lastPersistAttemptRef.current;
    lastPersistAttemptRef.current = state;
    // Retirement gate (supabase mode only): while retired + mirror-healthy and the
    // transition touched ONLY cloud-mirrored collections, skip the per-action
    // localStorage write — the recovery copy is refreshed by CloudSyncProvider on
    // hydration/queue-drain/error/pagehide instead. Leave `saveError` unchanged
    // (no false `Zapisano`, no false error). Any degradation resumes local writes.
    if (prevAttempted !== null && shouldSkipLocalPersist(prevAttempted, state)) {
      return;
    }
    const result = saveData(state);
    setSaveError(result.ok ? null : result.reason);
    if (result.ok) setExternal((prev) => (prev === 'conflict' ? 'none' : prev));
  }, [state]);

  // Mount-once: subscribe to same-browser external tab writes. A clean tab
  // refreshes in place; a dirty tab (unsaved form edits, a failed local write,
  // or an already-open conflict) raises an explicit conflict choice instead of
  // being silently overwritten.
  useEffect(() => {
    return subscribeExternalChanges(() => {
      const loaded = loadDataResult();
      if (!loaded.ok) {
        setLoadError(loaded.error);
        return;
      }
      const incoming = loaded.data;
      // Silent short-circuit when storage already matches our state (our own
      // echo bounced back, or an identical write): no dispatch, no banner.
      if (JSON.stringify(incoming) === JSON.stringify(stateRef.current)) return;
      const dirty =
        anyDirty() || saveErrorRef.current !== null || externalRef.current === 'conflict';
      if (dirty) {
        setExternal('conflict');
        return;
      }
      skipPersistRef.current = !loaded.needsWriteback;
      dispatch({ type: 'REPLACE_FROM_STORAGE', data: incoming });
      setExternal('refreshed');
    });
  }, []);

  const retryPersist = useCallback(() => {
    const result = saveData(stateRef.current);
    setSaveError(result.ok ? null : result.reason);
    if (result.ok) setExternal((prev) => (prev === 'conflict' ? 'none' : prev));
  }, []);

  const acceptExternal = useCallback(() => {
    const loaded = loadDataResult();
    if (!loaded.ok) {
      setLoadError(loaded.error);
      return;
    }
    skipPersistRef.current = !loaded.needsWriteback;
    dispatch({ type: 'REPLACE_FROM_STORAGE', data: loaded.data });
    setExternal('none');
  }, []);

  const keepLocal = useCallback(() => {
    const result = saveData(stateRef.current);
    setSaveError(result.ok ? null : result.reason);
    if (result.ok) setExternal('none');
  }, []);

  const dismissExternalNotice = useCallback(() => {
    setExternal((prev) => (prev === 'refreshed' ? 'none' : prev));
  }, []);

  const value = useMemo(() => ({ state, dispatch, lastActionRef }), [state, dispatch]);

  const persistence = useMemo<PersistenceValue>(
    () => ({
      saveError,
      external,
      retryPersist,
      acceptExternal,
      keepLocal,
      dismissExternalNotice,
    }),
    [saveError, external, retryPersist, acceptExternal, keepLocal, dismissExternalNotice],
  );

  // Storage-event callbacks and explicit conflict acceptance run outside
  // render, so route their load failures back through the root ErrorBoundary on
  // the next render. The raw storage key remains untouched for export/reset.
  if (loadError) throw loadError;

  return (
    <StoreContext.Provider value={value}>
      <PersistenceContext.Provider value={persistence}>{children}</PersistenceContext.Provider>
    </StoreContext.Provider>
  );
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within AppStoreProvider');
  return ctx;
}

export function usePersistence(): PersistenceValue {
  const ctx = useContext(PersistenceContext);
  if (!ctx) throw new Error('usePersistence must be used within AppStoreProvider');
  return ctx;
}
