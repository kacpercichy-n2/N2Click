// Pure, read-only logic behind the admin export + Supabase migration DRY-RUN
// tool (see ExportDryRunPanel). NOTHING here writes to Supabase, localStorage or
// app state: buildExportPayload returns a sanitized JSON snapshot for download,
// buildDryRunReport maps the current localStorage model onto the Supabase core
// schema (supabase/migrations/20260715210000_core_schema.sql) and reports what
// would migrate, what is unsupported and what would block the migration. Both
// functions are deterministic — no Date.now/randomness inside buildDryRunReport.
import type { AccessRole, AppData } from '../types';
import { DATA_VERSION } from './storage';

export interface ExportPayload {
  format: 'n2hub-backup';
  appDataVersion: number;
  // Raw `version` field found in the stored JSON (peek's storedVersion).
  storedVersion: number;
  exportedAt: string; // ISO timestamp from the caller-supplied `now`
  data: AppData; // sanitized: no passwordHash / currentUserId / impersonatorId
}

/**
 * Build the downloadable backup payload from PEEKED data. Sanitizes every
 * credential/session field so the file never carries secrets: each
 * `person.passwordHash`, `currentUserId` and `impersonatorId` is blanked.
 * Nothing else is altered and no `revision` is added (peek data carries none).
 */
export function buildExportPayload(
  data: AppData,
  storedVersion: number,
  now: Date,
): ExportPayload {
  const sanitized: AppData = {
    ...data,
    people: data.people.map((p) => ({ ...p, passwordHash: '' })),
    currentUserId: '',
    impersonatorId: '',
  };
  return {
    format: 'n2hub-backup',
    appDataVersion: DATA_VERSION,
    storedVersion,
    exportedAt: now.toISOString(),
    data: sanitized,
  };
}

// ---- Dry-run report ---------------------------------------------------------

export interface DryRunCounts {
  // Source = localStorage collection sizes.
  source: {
    clients: number;
    departments: number;
    serviceTypes: number;
    workCategories: number;
    statuses: number;
    projects: number;
    milestones: number;
    tasks: number;
    people: number;
    assignments: number;
    workload: number;
    comments: number;
    activity: number;
    savedFilters: number;
  };
  // Target = Supabase row counts that WOULD be produced.
  target: {
    statuses: number;
    service_types: number;
    work_categories: number;
    clients: number;
    departments: number;
    profiles: number;
    projects: number;
    milestones: number;
    project_members: number;
    tasks: number;
    task_assignments: number;
    workload_entries: number;
    comments: number;
    activity_events: number;
  };
}

export interface IdMapping {
  entity: string; // human-readable Polish entity label
  description: string; // what remap is required (or that ids carry over)
  count: number;
}

export interface RoleMappingEntry {
  sourceRole: AccessRole;
  targetRole: 'administrator' | 'manager' | 'worker';
  count: number;
}

export interface UnsupportedCollection {
  name: string; // Polish collection label
  count: number; // number of rows that would be dropped
}

export interface UnsupportedFields {
  entity: string; // Polish entity label
  fields: string[]; // dropped field names
}

export interface DryRunIssue {
  table: string; // target Supabase table
  entityId: string; // offending source entity id
  message: string; // Polish diagnostic
}

export interface DryRunReport {
  counts: DryRunCounts;
  idMappings: IdMapping[];
  roleMapping: RoleMappingEntry[];
  unsupported: {
    collections: UnsupportedCollection[];
    fields: UnsupportedFields[];
  };
  blockers: DryRunIssue[];
  warnings: DryRunIssue[];
}

// Working role mapping onto the cloud enum (which keeps its 3 values):
// pelne -> administrator, ograniczone -> worker.
const ROLE_TARGET: Record<AccessRole, 'administrator' | 'manager' | 'worker'> = {
  pelne: 'administrator',
  ograniczone: 'worker',
};
const ROLE_ORDER: AccessRole[] = ['pelne', 'ograniczone'];

// Fields present in the localStorage model but with NO column in the Supabase
// schema — they would be dropped by a migration. Static per the architect's
// decision (kept aligned with the tests). Project/task planner columns now EXIST
// (20260716190000_planner_entities), so only the profile-only fields remain
// unmapped.
const DROPPED_FIELDS: UnsupportedFields[] = [
  {
    entity: 'Osoba',
    fields: [
      'phone',
      'passwordHash',
      'avatar',
      'capacity',
      'workDays',
      'workStartMinutes',
      'workEndMinutes',
      'supervisorId',
    ],
  },
];

/**
 * Map the current AppData onto the Supabase core schema and report counts, id
 * remaps, role mapping, unsupported data and migration blockers. Pure and
 * deterministic: identical input yields identical output, with no clock or
 * randomness read. Never mutates `data`.
 */
export function buildDryRunReport(data: AppData): DryRunReport {
  const taskIds = new Set(data.tasks.map((t) => t.id));
  const projectIds = new Set(data.projects.map((p) => p.id));
  const personIds = new Set(data.people.map((p) => p.id));
  const departmentIds = new Set(data.departments.map((d) => d.id));

  // project_members: distinct (projectId, personId) pairs derived from
  // assignments joined through tasks — count only, no invented rows.
  const memberPairs = new Set<string>();
  for (const a of data.assignments) {
    const task = data.tasks.find((t) => t.id === a.taskId);
    if (!task || !personIds.has(a.personId)) continue;
    memberPairs.add(`${task.projectId}|${a.personId}`);
  }

  const counts: DryRunCounts = {
    source: {
      clients: data.clients.length,
      departments: data.departments.length,
      serviceTypes: data.serviceTypes.length,
      workCategories: data.workCategories.length,
      statuses: data.statuses.length,
      projects: data.projects.length,
      milestones: data.milestones.length,
      tasks: data.tasks.length,
      people: data.people.length,
      assignments: data.assignments.length,
      workload: data.workload.length,
      comments: data.comments.length,
      activity: data.activity.length,
      savedFilters: data.savedFilters.length,
    },
    target: {
      statuses: data.statuses.length,
      service_types: data.serviceTypes.length,
      work_categories: data.workCategories.length,
      clients: data.clients.length,
      departments: data.departments.length,
      profiles: data.people.length,
      projects: data.projects.length,
      milestones: data.milestones.length,
      project_members: memberPairs.size,
      tasks: data.tasks.length,
      task_assignments: data.assignments.length,
      workload_entries: data.workload.length,
      comments: data.comments.length,
      activity_events: data.activity.length,
    },
  };

  const idMappings: IdMapping[] = [
    {
      entity: 'Osoby → profiles',
      description:
        'Każda osoba potrzebuje nowego identyfikatora auth.users (profiles.id ' +
        'wskazuje na auth.users — lokalnych identyfikatorów osób nie można użyć ponownie).',
      count: data.people.length,
    },
    {
      entity: 'Pozostałe identyfikatory',
      description:
        'Identyfikatory działów, projektów i zadań są już wartościami UUID i mogą ' +
        'zostać przeniesione bez zmian.',
      count: data.departments.length + data.projects.length + data.tasks.length,
    },
  ];

  const roleCounts = new Map<AccessRole, number>();
  for (const p of data.people) {
    roleCounts.set(p.accessRole, (roleCounts.get(p.accessRole) ?? 0) + 1);
  }
  const roleMapping: RoleMappingEntry[] = ROLE_ORDER.map((role) => ({
    sourceRole: role,
    targetRole: ROLE_TARGET[role],
    count: roleCounts.get(role) ?? 0,
  }));

  // Whole collections with no target table. Listed only when non-empty (nothing
  // to drop = nothing to report). After the workload retirement migration
  // (20260717000000) milestones and workload gain target tables too, so only
  // SAVED FILTERS (per-user UI preference, never org planner data) remain
  // local-only.
  const collectionCandidates: Array<[string, number]> = [
    ['Zapisane filtry', data.savedFilters.length],
  ];
  const unsupportedCollections: UnsupportedCollection[] = collectionCandidates
    .filter(([, count]) => count > 0)
    .map(([name, count]) => ({ name, count }));

  const blockers: DryRunIssue[] = [];
  const warnings: DryRunIssue[] = [];

  for (const d of data.departments) {
    const len = d.name.length;
    if (len < 1 || len > 200) {
      blockers.push({
        table: 'departments',
        entityId: d.id,
        message: `Nazwa działu musi mieć od 1 do 200 znaków (obecnie ${len}).`,
      });
    }
  }

  for (const p of data.people) {
    const len = p.firstName.length;
    if (len < 1 || len > 100) {
      blockers.push({
        table: 'profiles',
        entityId: p.id,
        message: `Imię osoby musi mieć od 1 do 100 znaków (obecnie ${len}).`,
      });
    }
    if (p.departmentId !== '' && !departmentIds.has(p.departmentId)) {
      warnings.push({
        table: 'profiles',
        entityId: p.id,
        message:
          'Osoba wskazuje na nieistniejący dział — powiązanie zostanie wyczyszczone ' +
          '(kolumna department_id jest opcjonalna).',
      });
    }
  }

  for (const project of data.projects) {
    const len = project.name.length;
    if (len < 1 || len > 300) {
      blockers.push({
        table: 'projects',
        entityId: project.id,
        message: `Nazwa projektu musi mieć od 1 do 300 znaków (obecnie ${len}).`,
      });
    }
  }

  for (const t of data.tasks) {
    const len = t.title.length;
    if (len < 1 || len > 300) {
      blockers.push({
        table: 'tasks',
        entityId: t.id,
        message: `Tytuł zadania musi mieć od 1 do 300 znaków (obecnie ${len}).`,
      });
    }
    if (!projectIds.has(t.projectId)) {
      blockers.push({
        table: 'tasks',
        entityId: t.id,
        message: 'Zadanie wskazuje na nieistniejący projekt (project_id).',
      });
    }
  }

  const seenAssignmentPairs = new Set<string>();
  for (const a of data.assignments) {
    if (!taskIds.has(a.taskId)) {
      blockers.push({
        table: 'task_assignments',
        entityId: a.id,
        message: 'Przypisanie wskazuje na nieistniejące zadanie (task_id).',
      });
    }
    if (!personIds.has(a.personId)) {
      blockers.push({
        table: 'task_assignments',
        entityId: a.id,
        message: 'Przypisanie wskazuje na nieistniejącą osobę (profile_id).',
      });
    }
    const pairKey = `${a.taskId}|${a.personId}`;
    if (seenAssignmentPairs.has(pairKey)) {
      blockers.push({
        table: 'task_assignments',
        entityId: a.id,
        message:
          'Zduplikowane przypisanie (task_id, profile_id) — naruszenie klucza głównego.',
      });
    } else {
      seenAssignmentPairs.add(pairKey);
    }
  }

  // Workload blockers mirroring the SQL CHECKs / partial unique index of
  // 20260717000000_workload_planner_retirement: hours on the 0.25h grid and one
  // bin row per (task, person) pair.
  const seenBinPairs = new Set<string>();
  for (const w of data.workload) {
    const q = w.plannedHours * 4;
    if (
      !Number.isFinite(w.plannedHours) ||
      w.plannedHours <= 0 ||
      Math.abs(q - Math.round(q)) > 1e-9
    ) {
      blockers.push({
        table: 'workload_entries',
        entityId: w.id,
        message: `Zaplanowane godziny muszą być dodatnią wielokrotnością 0,25h (obecnie ${w.plannedHours}).`,
      });
    }
    if (w.date === '') {
      const key = `${w.taskId}|${w.personId}`;
      if (seenBinPairs.has(key)) {
        blockers.push({
          table: 'workload_entries',
          entityId: w.id,
          message: 'Zduplikowany wiersz zasobnika (task_id, profile_id) — narusza jeden wiersz na parę.',
        });
      } else {
        seenBinPairs.add(key);
      }
    }
  }

  return {
    counts,
    idMappings,
    roleMapping,
    unsupported: { collections: unsupportedCollections, fields: DROPPED_FIELDS },
    blockers,
    warnings,
  };
}
