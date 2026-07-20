// Pure grouping/filtering layer behind the Kanban TASK board (KanbanPage).
// No React, no store access beyond plain reads: it takes the whole AppData plus
// the page's filter state and returns the columns to render, so the page needs a
// single `useMemo` and every card only has to look values up in a Map.
//
// Rules encoded here:
// - One column per ACTIVE status, in pipeline order; tasks sitting in an
//   ARCHIVED status land in a separate `archived` bucket instead of vanishing.
// - A task with a dangling/unknown statusId belongs to no bucket (it is skipped,
//   never a crash).
// - Client and paid filters are resolved through the task's PROJECT; a task with
//   a dangling projectId cannot satisfy either of them.
// - The person filter is a multi-select over task assignees; an empty set means
//   "everybody" (no filtering).
// - Ordering is a pure read: `(orderIndex, startDate, id)` — the same total key
//   the project task list uses. Nothing here ever touches completion
//   (`Status.isDone`) or rewrites `orderIndex` (invariant 5).
import type { AppData, Status, Task } from '../types';
import type { PaidFilter } from './ProjectsPage';

export interface KanbanFilters {
  paid: PaidFilter;
  clientId: string; // '' == all clients
  personIds: ReadonlySet<string>; // empty == all people
}

export interface KanbanColumn {
  status: Status;
  tasks: Task[];
}

export interface KanbanBoard {
  columns: KanbanColumn[];
  archived: Task[];
}

/** taskId -> assigned person ids. Built once so cards never scan assignments. */
export function buildTaskAssigneeIds(state: AppData): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const a of state.assignments) {
    const current = map.get(a.taskId);
    if (current) current.push(a.personId);
    else map.set(a.taskId, [a.personId]);
  }
  return map;
}

/** Total, deterministic display order inside a column. */
function compareTasks(a: Task, b: Task): number {
  return (
    a.orderIndex - b.orderIndex ||
    a.startDate.localeCompare(b.startDate) ||
    a.id.localeCompare(b.id)
  );
}

function matchesFilters(
  task: Task,
  filters: KanbanFilters,
  projectPaid: Map<string, boolean>,
  projectClient: Map<string, string>,
  assignees: Map<string, string[]>,
): boolean {
  if (filters.paid !== 'all') {
    const paid = projectPaid.get(task.projectId);
    if (paid !== (filters.paid === 'paid')) return false;
  }
  if (filters.clientId && projectClient.get(task.projectId) !== filters.clientId) {
    return false;
  }
  if (filters.personIds.size > 0) {
    const ids = assignees.get(task.id);
    if (!ids || !ids.some((id) => filters.personIds.has(id))) return false;
  }
  return true;
}

/**
 * The whole board in one pass: filter, bucket by status, sort each bucket.
 * Columns are always returned for every active status (an empty column still
 * renders as a drop target); `archived` is empty unless some visible task sits
 * in an archived status.
 */
export function buildKanbanColumns(state: AppData, filters: KanbanFilters): KanbanBoard {
  const columns: KanbanColumn[] = state.statuses
    .filter((s) => !s.archived)
    .sort((a, b) => a.order - b.order)
    .map((status) => ({ status, tasks: [] as Task[] }));
  const byStatusId = new Map(columns.map((c) => [c.status.id, c]));
  const archivedStatusIds = new Set(
    state.statuses.filter((s) => s.archived).map((s) => s.id),
  );

  const projectPaid = new Map(state.projects.map((p) => [p.id, p.paid]));
  const projectClient = new Map(state.projects.map((p) => [p.id, p.clientId]));
  const assignees = buildTaskAssigneeIds(state);

  const archived: Task[] = [];
  for (const task of state.tasks) {
    if (!matchesFilters(task, filters, projectPaid, projectClient, assignees)) continue;
    const column = byStatusId.get(task.statusId);
    if (column) column.tasks.push(task);
    else if (archivedStatusIds.has(task.statusId)) archived.push(task);
    // else: dangling status id — the task simply has no place on the board.
  }

  for (const column of columns) column.tasks.sort(compareTasks);
  archived.sort(compareTasks);

  return { columns, archived };
}
