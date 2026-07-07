// Single AppStore provider: Context + useReducer, persisting on every action.
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react';
import type {
  AppData,
  Person,
  Task,
  TaskAssignment,
  WorkloadEntry,
} from '../types';
import { loadData, saveData } from './storage';
import { registerPersonOrder } from '../utils/colors';

// ---- Payload shapes ----

export interface TaskDraft {
  title: string;
  description: string;
  project: string;
  startDate: string;
  endDate: string;
  estimatedHours: number | null;
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

export type Action =
  | { type: 'SAVE_TASK'; payload: SaveTaskPayload }
  | { type: 'DELETE_TASK'; taskId: string }
  | { type: 'ADD_PERSON'; person: Omit<Person, 'id'> }
  | { type: 'DELETE_PERSON'; personId: string }
  | { type: 'LOAD_SAMPLE'; data: AppData }
  | { type: 'DISMISS_SAMPLE_BANNER' }
  | { type: 'RESET_ALL'; data: AppData };

function uid(): string {
  return crypto.randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

function saveTask(state: AppData, payload: SaveTaskPayload): AppData {
  const { taskId, draft, assigneeIds, allocations } = payload;
  const ts = nowIso();

  let tasks = state.tasks;
  let realTaskId: string;

  if (taskId === null) {
    const task: Task = {
      id: uid(),
      title: draft.title,
      description: draft.description,
      project: draft.project,
      startDate: draft.startDate,
      endDate: draft.endDate,
      estimatedHours: draft.estimatedHours,
      createdAt: ts,
      updatedAt: ts,
    };
    tasks = [...tasks, task];
    realTaskId = task.id;
  } else {
    realTaskId = taskId;
    tasks = tasks.map((t) =>
      t.id === taskId
        ? {
            ...t,
            title: draft.title,
            description: draft.description,
            project: draft.project,
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
  // hours>0 and only for people who are still assigned.
  const assignedSet = new Set(assigneeIds);
  const workloadOther = state.workload.filter((w) => w.taskId !== realTaskId);
  const workloadForTask: WorkloadEntry[] = allocations
    .filter((c) => c.plannedHours > 0 && assignedSet.has(c.personId))
    .map((c) => ({
      id: uid(),
      taskId: realTaskId,
      personId: c.personId,
      date: c.date,
      plannedHours: c.plannedHours,
    }));

  return {
    ...state,
    tasks,
    assignments: [...assignmentsOther, ...assignmentsForTask],
    workload: [...workloadOther, ...workloadForTask],
  };
}

function deleteTask(state: AppData, taskId: string): AppData {
  return {
    ...state,
    tasks: state.tasks.filter((t) => t.id !== taskId),
    assignments: state.assignments.filter((a) => a.taskId !== taskId),
    workload: state.workload.filter((w) => w.taskId !== taskId),
  };
}

function deletePerson(state: AppData, personId: string): AppData {
  return {
    ...state,
    people: state.people.filter((p) => p.id !== personId),
    assignments: state.assignments.filter((a) => a.personId !== personId),
    workload: state.workload.filter((w) => w.personId !== personId),
  };
}

export function reducer(state: AppData, action: Action): AppData {
  switch (action.type) {
    case 'SAVE_TASK':
      return saveTask(state, action.payload);
    case 'DELETE_TASK':
      return deleteTask(state, action.taskId);
    case 'ADD_PERSON':
      return {
        ...state,
        people: [...state.people, { id: uid(), ...action.person }],
      };
    case 'DELETE_PERSON':
      return deletePerson(state, action.personId);
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
