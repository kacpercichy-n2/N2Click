// Wspólne mappery domena→kolumny używane przez OBIE ścieżki zapisu do Supabase:
// lustro diff-owe (cloudMirror.ts) i jednorazowy import (dataImport.ts). Nazwy
// kolumn dla siedmiu wspólnych rodzin (klienci, projekty, zadania, kamienie
// milowe, godziny, komentarze, aktywność) żyją TUTAJ, więc przyszła zmiana
// schematu tabeli lustrowanej po obu stronach edytowana jest raz.
//
// GRANICE: polityki „braku mapowania” i diagnostyki zostają PO STRONIE WYWOŁUJĄCEGO.
// Każdy wywołujący rozwiązuje referencje (status, słownik, osoba, dział, klient)
// wg własnej polityki i przekazuje gotowe wartości — dzięki temu lustro może
// PORZUCIĆ wiersz, a import wstawić `null` z tego samego buildera. Poza modułem:
// wiersze profili (tylko lustro), wiersze słowników (tylko import) oraz wiersze
// tabel łączących (trywialne dwie kolumny — zostają inline).
import type {
  ActivityEvent,
  Client,
  Comment,
  Milestone,
  Project,
  Task,
  WorkloadEntry,
} from '../types';

/** '' -> null; każda inna data przechodzi bez zmian. */
export const dateOrNull = (d: string): string | null => (d === '' ? null : d);

export function buildClientRow(c: Client): Record<string, unknown> {
  return { id: c.id, name: c.name, archived: c.archived };
}

/** Referencje projektu rozwiązane po stronie wywołującego (miss policy własna). */
export interface ProjectColumns {
  clientId: string | null;
  statusId: string | null;
  serviceTypeId: string | null;
  departmentId: string | null;
}

export function buildProjectRow(p: Project, cols: ProjectColumns): Record<string, unknown> {
  return {
    id: p.id,
    client_id: cols.clientId,
    name: p.name,
    description: p.description,
    status_id: cols.statusId,
    paid: p.paid,
    start_date: dateOrNull(p.startDate),
    end_date: dateOrNull(p.endDate),
    department_id: cols.departmentId,
    service_type_id: cols.serviceTypeId,
  };
}

/** Referencje zadania rozwiązane po stronie wywołującego. */
export interface TaskColumns {
  statusId: string | null;
  workCategoryId: string | null;
}

export function buildTaskRow(t: Task, cols: TaskColumns): Record<string, unknown> {
  return {
    id: t.id,
    project_id: t.projectId,
    status_id: cols.statusId,
    title: t.title,
    description: t.description,
    start_date: dateOrNull(t.startDate),
    end_date: dateOrNull(t.endDate),
    estimated_hours: t.estimatedHours,
    priority: t.priority,
    work_category_id: cols.workCategoryId,
    checklist: t.checklist,
  };
}

export function buildMilestoneRow(m: Milestone): Record<string, unknown> {
  return { id: m.id, project_id: m.projectId, name: m.name, milestone_date: m.date };
}

export function buildWorkloadRow(w: WorkloadEntry, profileId: string): Record<string, unknown> {
  return {
    id: w.id,
    task_id: w.taskId,
    profile_id: profileId,
    work_date: dateOrNull(w.date),
    planned_hours: w.plannedHours,
    start_minutes: w.startMinutes,
    sort_index: w.sortIndex,
  };
}

/** `people` mapuje lokalny id osoby -> cloud profile id (wzmianki filtrowane).
 *  `authorId` (już rozwiązany: null lub cloud id) niesie politykę autora danego
 *  wywołującego — lustro porzuca niemapowalnego autora, import wstawia null. */
export function buildCommentRow(
  c: Comment,
  people: Map<string, string>,
  authorId: string | null,
): Record<string, unknown> {
  const mentionIds = c.mentionIds
    .map((id) => people.get(id))
    .filter((id): id is string => id !== undefined);
  return {
    id: c.id,
    project_id: c.entityType === 'project' ? c.entityId : null,
    task_id: c.entityType === 'task' ? c.entityId : null,
    author_id: authorId,
    body: c.body,
    mention_ids: mentionIds,
    created_at: c.createdAt,
  };
}

/** Aktora/impersonatora oraz predykaty typowanych FK rozwiązuje wywołujący:
 *  lustro używa isUuid(entityId), import — availableProjectIds/TaskIds.has(...). */
export interface ActivityColumns {
  actorId: string | null;
  impersonatorId: string | null;
  isProject: boolean;
  isTask: boolean;
}

export function buildActivityRow(e: ActivityEvent, cols: ActivityColumns): Record<string, unknown> {
  return {
    id: e.id,
    entity_type: e.entityType,
    entity_id: e.entityId,
    project_id: cols.isProject ? e.entityId : null,
    task_id: cols.isTask ? e.entityId : null,
    actor_id: cols.actorId,
    impersonator_id: cols.impersonatorId,
    message: e.message,
    created_at: e.createdAt,
  };
}
