// Czysta warstwa repozytorium dla danych planera w chmurze (DB boundary +
// snapshot + mappery). Cały dostęp do bazy idzie przez wstrzyknięty interfejs
// `PlannerDb` (rozszerza wzorzec `ImportDb`) — bez mockowania SDK, bez żywego
// Supabase w vitest, bez jsdom. Testowalne w node.
//
// GRANICE / INVARIANTS:
//   * Ten moduł NIGDY nie dotyka localStorage (src/store/storage.ts pozostaje
//     jedyną granicą localStorage) ani stanu aplikacji. Zapisy do chmury składa
//     lustro diff-owe (cloudMirror.ts) PO reduktorze; hydracja mapuje wiersze
//     chmury na LOKALNE kształty i zwraca ładunek MERGE_CLOUD_ENTITIES.
//   * `dataImport.ts` pozostaje insert-only; upsert/delete żyją wyłącznie tutaj.
//   * Godziny (workload) nigdy nie są czytane ani zapisywane — nie ma tabeli.
//   * Nigdy nie pokazujemy surowego komunikatu SDK poza diagnostyką techniczną.
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ActivityEntityType,
  ActivityEvent,
  AppData,
  Client,
  Comment,
  CommentEntityType,
  Milestone,
  Project,
  Task,
  TaskPriority,
  WorkloadEntry,
} from '../types';
import { isValidDateStr, periodError, MAX_TASK_PERIOD_DAYS } from '../utils/dates';
import { BIN_DATE, blockEndMinutes, DAY_MINUTES, HOURS_STEP, MINUTE_STEP } from '../utils/time';
import { createSupabaseImportDb, type ImportDb } from './dataImport';
import type { CloudIdMaps } from './cloudMirror';

// ---- Klasyfikacja błędów zapisu ---------------------------------------------

export interface CloudWriteError {
  kind: 'permission' | 'transient';
  message: string; // techniczny szczegół (diagnostyka), nigdy nie do UI wprost
}

const PERMISSION_RE = /row-level security|permission denied|violates row-level/i;

// Kody naruszeń ograniczeń Postgresa. Op sklasyfikowany jako `'permission'`
// (porzucany z notatką, praca zostaje lokalnie) — NIGDY `'transient'`: ponawianie
// naruszenia unikalności/klucza/CHECK-a w nieskończoność zatkałoby kolejkę (np.
// dwie karty tworzące różne id wiersza zasobnika dla tej samej pary trafiające w
// indeks częściowy `workload_entries_bin_pair`). 23502 not-null, 23503 FK,
// 23505 unique, 23514 check.
const CONSTRAINT_CODES = new Set(['23502', '23503', '23505', '23514']);

/**
 * Klasyfikuje błąd zapisu z PostgREST: kod `42501`, komunikat pasujący do wzorca
 * RLS lub kod naruszenia ograniczenia (23502/23503/23505/23514) => `'permission'`
 * (odrzucenie — op zostaje porzucony, dane zostają lokalnie); wszystko inne =>
 * `'transient'` (można ponowić).
 */
export function classifyWriteError(code: string | null, message: string): CloudWriteError {
  if (code === '42501' || (code !== null && CONSTRAINT_CODES.has(code)) || PERMISSION_RE.test(message)) {
    return { kind: 'permission', message };
  }
  return { kind: 'transient', message };
}

// ---- Granica bazy (wstrzykiwana) --------------------------------------------

export interface PlannerDb extends Pick<ImportDb, 'select'> {
  /** UPSERT jednego wiersza (idempotentny przy dublowaniu z dwóch kart). */
  upsert(
    table: string,
    row: Record<string, unknown>,
    onConflict?: string,
  ): Promise<{ error: CloudWriteError | null }>;
  /** DELETE wierszy pasujących do `match` (używamy `remove`, nie `delete`). */
  remove(
    table: string,
    match: Record<string, string>,
  ): Promise<{ error: CloudWriteError | null }>;
}

/**
 * Cienki adapter nad klientem Supabase. `select` reużywa adaptera importu
 * (jeden kod), a upsert/delete mapują błąd SDK na sklasyfikowany CloudWriteError.
 */
export function createSupabasePlannerDb(client: SupabaseClient): PlannerDb {
  const importDb = createSupabaseImportDb(client);
  return {
    select: importDb.select,
    async upsert(table, row, onConflict) {
      try {
        const query = client.from(table).upsert(row, onConflict ? { onConflict } : undefined);
        const { error } = await query;
        if (error) {
          const code = (error as { code?: string }).code ?? null;
          return { error: classifyWriteError(code, error.message ?? 'Błąd zapisu.') };
        }
        return { error: null };
      } catch (e) {
        return { error: classifyWriteError(null, e instanceof Error ? e.message : String(e)) };
      }
    },
    async remove(table, match) {
      try {
        let query = client.from(table).delete();
        for (const [column, value] of Object.entries(match)) {
          query = query.eq(column, value);
        }
        const { error } = await query;
        if (error) {
          const code = (error as { code?: string }).code ?? null;
          return { error: classifyWriteError(code, error.message ?? 'Błąd usuwania.') };
        }
        return { error: null };
      } catch (e) {
        return { error: classifyWriteError(null, e instanceof Error ? e.message : String(e)) };
      }
    },
  };
}

// ---- Snapshot planera (hydracja) --------------------------------------------

export const PLANNER_SNAPSHOT_ERROR = 'Nie udało się wczytać danych planera z serwera.';

/** Ładunek scalający dla reduktora (MERGE_CLOUD_ENTITIES). */
export interface CloudMergePayload {
  clients: Client[];
  projects: Project[];
  milestones: Milestone[];
  tasks: Task[];
  assignments: Array<{ taskId: string; personId: string }>;
  workload: WorkloadEntry[];
  comments: Comment[];
  activity: ActivityEvent[];
}

export type LoadPlannerResult =
  | { ok: true; payload: CloudMergePayload; diagnostics: string[] }
  | { ok: false; error: string };

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const boolVal = (v: unknown): boolean => v === true;
/** Non-null non-empty string -> trimmed value; otherwise undefined (canonical
 *  key-absent-when-empty shape), so post-merge diffs stay stable. */
const strOrUndef = (v: unknown): string | undefined => {
  const t = typeof v === 'string' ? v.trim() : '';
  return t ? t : undefined;
};

/** SQL `date`/null -> lokalny 'yyyy-MM-dd' albo ''. */
function sqlDateToLocal(v: unknown): string {
  return typeof v === 'string' && v !== '' ? v : '';
}

/** Odwraca mapę forward (local -> cloud) na reverse (cloud -> local). */
function invert(map: Map<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [local, cloud] of map) if (!out.has(cloud)) out.set(cloud, local);
  return out;
}

/** Liczba jest na siatce 0.25h (dodatnia, skończona, wielokrotność ćwiartki). */
function isQuarterHours(v: unknown): v is number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return false;
  const q = v / HOURS_STEP;
  return Math.abs(q - Math.round(q)) < 1e-9;
}

/** Minuty startu na siatce 15-min (całkowite, >= 0, wielokrotność 15). */
function isValidStartMinutes(v: unknown): v is number {
  return (
    typeof v === 'number' &&
    Number.isInteger(v) &&
    v >= 0 &&
    v % MINUTE_STEP === 0
  );
}

const PRIORITIES: TaskPriority[] = ['low', 'normal', 'high', 'urgent'];
function toPriority(v: unknown): TaskPriority {
  return PRIORITIES.includes(v as TaskPriority) ? (v as TaskPriority) : 'normal';
}

const ACTIVITY_TYPES: ActivityEntityType[] = [
  'project',
  'task',
  'person',
  'status',
  'client',
  'system',
];
function toActivityType(v: unknown): ActivityEntityType {
  return ACTIVITY_TYPES.includes(v as ActivityEntityType)
    ? (v as ActivityEntityType)
    : 'system';
}

/**
 * Reverse-resolver dla identyfikatorów słownikowych: najpierw odwrócona mapa
 * forward (cloud -> local, obejmuje dopasowanie po id i po kluczu semantycznym),
 * potem lokalny fallback po dosłownie równym id (encja obecna lokalnie, ale
 * nieobecna w snapshocie organizacji). Zwraca '' gdy nie da się zmapować.
 */
function makeReverse(forward: Map<string, string>, localIds: Set<string>) {
  const reverse = invert(forward);
  return (cloudId: unknown): string => {
    const id = str(cloudId);
    if (id === '') return '';
    return reverse.get(id) ?? (localIds.has(id) ? id : '');
  };
}

/**
 * Wczytuje atomowo snapshot planera dla zalogowanego użytkownika i mapuje wiersze
 * chmury na LOKALNE kształty przez odwrócone mapy id. Wszystkie selecty biegną
 * równolegle; JAKIKOLWIEK błąd selectu psuje cały snapshot z jednym polskim
 * komunikatem (PLANNER_SNAPSHOT_ERROR). Puste kolekcje są POPRAWNE.
 *
 * Wiersz projektu/zadania niepoprawny lokalnie (złe daty, odwrócony okres,
 * okres zadania > 92 dni) jest WYKLUCZANY z ładunku z diagnostyką — nigdy nie
 * scalany. Przypisanie z niemapowalnym profilem jest pomijane i liczone w
 * diagnostyce. Nieodwzorowany autor/aktor => '' (bez blokowania wiersza).
 */
export async function loadPlannerSnapshot(
  db: Pick<PlannerDb, 'select'>,
  maps: CloudIdMaps,
  local: AppData,
): Promise<LoadPlannerResult> {
  const [
    clientsRes,
    projectsRes,
    milestonesRes,
    tasksRes,
    assignmentsRes,
    workloadRes,
    commentsRes,
    activityRes,
  ] = await Promise.all([
    db.select('clients', 'id, name, archived, contact_person, email, phone'),
    db.select(
      'projects',
      'id, client_id, name, description, status_id, paid, start_date, end_date, department_id, service_type_id, created_at, updated_at',
    ),
    db.select('milestones', 'id, project_id, name, milestone_date'),
    db.select(
      'tasks',
      'id, project_id, status_id, title, description, start_date, end_date, estimated_hours, priority, work_category_id, checklist, created_at, updated_at',
    ),
    db.select('task_assignments', 'task_id, profile_id'),
    db.select(
      'workload_entries',
      'id, task_id, profile_id, work_date, planned_hours, start_minutes, sort_index',
    ),
    db.select('comments', 'id, project_id, task_id, author_id, body, mention_ids, created_at'),
    db.select(
      'activity_events',
      'id, entity_type, entity_id, actor_id, impersonator_id, message, created_at',
    ),
  ]);

  if (
    clientsRes.error ||
    projectsRes.error ||
    milestonesRes.error ||
    tasksRes.error ||
    assignmentsRes.error ||
    workloadRes.error ||
    commentsRes.error ||
    activityRes.error
  ) {
    return { ok: false, error: PLANNER_SNAPSHOT_ERROR };
  }

  const diagnostics: string[] = [];

  // Odwrotne resolvery (cloud -> local) z lokalnym fallbackiem po dosłownym id.
  const statusOf = makeReverse(maps.statuses, new Set(local.statuses.map((s) => s.id)));
  const serviceTypeOf = makeReverse(
    maps.serviceTypes,
    new Set(local.serviceTypes.map((s) => s.id)),
  );
  const workCategoryOf = makeReverse(
    maps.workCategories,
    new Set(local.workCategories.map((c) => c.id)),
  );
  const personOf = makeReverse(maps.people, new Set(local.people.map((p) => p.id)));

  // Fallback statusu: gdy status_id jest null/niemapowalny (statusOf => ''),
  // przypisujemy pierwszy AKTYWNY status lokalny (po kolejności). Bez tego wiersz
  // trafiłby do stanu z statusId '' (isDone=false), łamiąc „ukończenie z
  // Status.isDone”. Jedna spójna strategia dla projektów I zadań. Inwariant
  // gwarantuje co najmniej jeden aktywny status; degeneracja => '' (pusto).
  const activeStatuses = local.statuses
    .filter((s) => !s.archived)
    .sort((a, b) => a.order - b.order);
  const fallbackStatusId = activeStatuses[0]?.id ?? local.statuses[0]?.id ?? '';
  const resolveStatus = (v: unknown): string => statusOf(v) || fallbackStatusId;

  // Zbiory wykluczonych rodziców — kaskadowe wykluczanie potomków (patrz niżej):
  // wiersz z niepoprawnym okresem/datą jest wykluczany, a jego potomkowie muszą
  // zniknąć RAZEM z nim, inaczej reduktor (MERGE_CLOUD_ENTITIES) odrzuci CAŁY
  // ładunek przez wiszący FK i organizacja nie zhydratuje niczego.
  const excludedProjectIds = new Set<string>();
  const excludedTaskIds = new Set<string>();

  // Klienci ---- (pola kontaktowe ustawiane TYLKO gdy niepuste; null/'' => klucz
  // nieobecny, aby zachować kanoniczny kształt i stabilne diffy po scaleniu).
  const clients: Client[] = clientsRes.rows.map((row) => {
    const client: Client = {
      id: str(row.id),
      name: str(row.name),
      archived: boolVal(row.archived),
    };
    const contactPerson = strOrUndef(row.contact_person);
    const email = strOrUndef(row.email);
    const phone = strOrUndef(row.phone);
    if (contactPerson) client.contactPerson = contactPerson;
    if (email) client.email = email;
    if (phone) client.phone = phone;
    return client;
  });

  // Projekty ---- (id/departmentId/clientId dosłownie; słowniki przez reverse).
  const projects: Project[] = [];
  for (const row of projectsRes.rows) {
    const startDate = sqlDateToLocal(row.start_date);
    const endDate = sqlDateToLocal(row.end_date);
    if (periodError(startDate, endDate) !== null) {
      excludedProjectIds.add(str(row.id));
      diagnostics.push(`Projekt „${str(row.name)}” pominięto — nieprawidłowy okres.`);
      continue;
    }
    projects.push({
      id: str(row.id),
      clientId: str(row.client_id),
      name: str(row.name),
      description: str(row.description),
      statusId: resolveStatus(row.status_id),
      paid: boolVal(row.paid),
      startDate,
      endDate,
      departmentId: str(row.department_id),
      serviceTypeId: serviceTypeOf(row.service_type_id),
      createdAt: str(row.created_at),
      updatedAt: str(row.updated_at) || str(row.created_at),
    });
  }

  // Kamienie milowe ---- (`milestone_date` -> lokalne `date`; zła data => wyklucz).
  const milestones: Milestone[] = [];
  for (const row of milestonesRes.rows) {
    const date = sqlDateToLocal(row.milestone_date);
    if (!isValidDateStr(date)) {
      diagnostics.push(`Kamień milowy „${str(row.name)}” pominięto — nieprawidłowa data.`);
      continue;
    }
    if (excludedProjectIds.has(str(row.project_id))) {
      diagnostics.push(`Kamień milowy „${str(row.name)}” pominięto — projekt wykluczony.`);
      continue;
    }
    milestones.push({
      id: str(row.id),
      projectId: str(row.project_id),
      name: str(row.name),
      date,
    });
  }

  // Zadania ----
  const tasks: Task[] = [];
  for (const row of tasksRes.rows) {
    const startDate = sqlDateToLocal(row.start_date);
    const endDate = sqlDateToLocal(row.end_date);
    if (periodError(startDate, endDate, { maxDays: MAX_TASK_PERIOD_DAYS }) !== null) {
      excludedTaskIds.add(str(row.id));
      diagnostics.push(`Zadanie „${str(row.title)}” pominięto — nieprawidłowy okres.`);
      continue;
    }
    if (excludedProjectIds.has(str(row.project_id))) {
      excludedTaskIds.add(str(row.id));
      diagnostics.push(`Zadanie „${str(row.title)}” pominięto — projekt wykluczony.`);
      continue;
    }
    const estimated = row.estimated_hours;
    const checklist = Array.isArray(row.checklist)
      ? (row.checklist as Task['checklist'])
      : [];
    tasks.push({
      id: str(row.id),
      projectId: str(row.project_id),
      statusId: resolveStatus(row.status_id),
      title: str(row.title),
      description: str(row.description),
      startDate,
      endDate,
      estimatedHours:
        typeof estimated === 'number' && Number.isFinite(estimated) ? estimated : null,
      priority: toPriority(row.priority),
      workCategoryId: workCategoryOf(row.work_category_id),
      checklist,
      createdAt: str(row.created_at),
      updatedAt: str(row.updated_at) || str(row.created_at),
    });
  }

  // Przypisania ---- (para {taskId, personId}; niemapowalny profil => pomiń).
  const assignments: Array<{ taskId: string; personId: string }> = [];
  for (const row of assignmentsRes.rows) {
    const taskId = str(row.task_id);
    if (excludedTaskIds.has(taskId)) {
      diagnostics.push(`Przypisanie zadania ${taskId} pominięto — zadanie wykluczone.`);
      continue;
    }
    const personId = personOf(row.profile_id);
    if (personId === '') {
      diagnostics.push(
        `Przypisanie zadania ${taskId} pominięto — brak lokalnej osoby dla profilu.`,
      );
      continue;
    }
    assignments.push({ taskId, personId });
  }

  // Zaplanowane godziny ---- (work_date null <-> ''; profil przez reverse;
  // rewalidacja siatki; para zasobnika trzymana raz — pierwszy wiersz wygrywa).
  const workload: WorkloadEntry[] = [];
  const seenBinPairs = new Set<string>();
  for (const row of workloadRes.rows) {
    const taskId = str(row.task_id);
    if (excludedTaskIds.has(taskId)) {
      diagnostics.push('Blok godzin pominięto — zadanie wykluczone.');
      continue;
    }
    const personId = personOf(row.profile_id);
    if (personId === '') {
      diagnostics.push('Blok godzin pominięto — brak lokalnej osoby dla profilu.');
      continue;
    }
    const isBin = row.work_date === null || row.work_date === undefined || row.work_date === '';
    const date = isBin ? BIN_DATE : sqlDateToLocal(row.work_date);
    if (!isBin && !isValidDateStr(date)) {
      diagnostics.push('Blok godzin pominięto — nieprawidłowa data.');
      continue;
    }
    const plannedHours = row.planned_hours;
    if (!isQuarterHours(plannedHours)) {
      diagnostics.push('Blok godzin pominięto — godziny poza siatką 0,25h.');
      continue;
    }
    const startMinutes = isBin ? 0 : row.start_minutes;
    if (!isBin) {
      if (!isValidStartMinutes(startMinutes)) {
        diagnostics.push('Blok godzin pominięto — start poza siatką 15 minut.');
        continue;
      }
      if (blockEndMinutes(startMinutes as number, plannedHours) > DAY_MINUTES) {
        diagnostics.push('Blok godzin pominięto — blok nie mieści się w dobie.');
        continue;
      }
    } else {
      const pairKey = `${taskId}|${personId}`;
      if (seenBinPairs.has(pairKey)) {
        diagnostics.push('Zduplikowany wiersz zasobnika pominięto — jeden na parę (zadanie, osoba).');
        continue;
      }
      seenBinPairs.add(pairKey);
    }
    const sortIndex =
      typeof row.sort_index === 'number' && Number.isFinite(row.sort_index) ? row.sort_index : 0;
    workload.push({
      id: str(row.id),
      taskId,
      personId,
      date,
      plannedHours,
      startMinutes: startMinutes as number,
      sortIndex,
    });
  }

  // Komentarze ----
  const comments: Comment[] = commentsRes.rows.map((row) => {
    const projectId = str(row.project_id);
    const entityType: CommentEntityType = projectId !== '' ? 'project' : 'task';
    const entityId = projectId !== '' ? projectId : str(row.task_id);
    const rawMentions = Array.isArray(row.mention_ids) ? row.mention_ids : [];
    const mentionIds = rawMentions.map((m) => personOf(m)).filter((id) => id !== '');
    return {
      id: str(row.id),
      entityType,
      entityId,
      authorId: personOf(row.author_id),
      body: str(row.body),
      mentionIds,
      createdAt: str(row.created_at),
    };
  });

  // Dziennik aktywności ----
  const activity: ActivityEvent[] = activityRes.rows.map((row) => ({
    id: str(row.id),
    entityType: toActivityType(row.entity_type),
    entityId: str(row.entity_id),
    actorId: personOf(row.actor_id),
    impersonatorId: personOf(row.impersonator_id),
    message: str(row.message),
    createdAt: str(row.created_at),
  }));

  return {
    ok: true,
    payload: { clients, projects, milestones, tasks, assignments, workload, comments, activity },
    diagnostics,
  };
}

// ---- Flaga wycofania zapisów lokalnych (app_settings) ------------------------

export const RETIREMENT_SETTING_KEY = 'local_writes_retired';

/**
 * Odczytuje flagę wycofania z `app_settings`. Brak wiersza => `enabled: false`.
 * Błąd selectu => `ok: false` (wołający zachowuje poprzednią zbuforowaną wartość,
 * nie zmienia stanu bramki na podstawie nieudanego odczytu).
 */
export async function readRetirementSetting(
  db: Pick<PlannerDb, 'select'>,
): Promise<{ ok: boolean; enabled: boolean }> {
  const res = await db.select('app_settings', 'key, value');
  if (res.error) return { ok: false, enabled: false };
  const row = res.rows.find((r) => r.key === RETIREMENT_SETTING_KEY);
  if (!row) return { ok: true, enabled: false };
  const value = row.value as { enabled?: unknown } | null;
  return { ok: true, enabled: value?.enabled === true };
}

/**
 * Ustawia flagę wycofania (upsert wiersza `local_writes_retired`). Wartość niesie
 * stan handshake'u: `{ enabled, completed_at, by_profile }`. Zwraca sklasyfikowany
 * błąd zapisu (lub null). Tylko administrator ma prawo INSERT/UPDATE (RLS).
 */
export async function writeRetirementSetting(
  db: PlannerDb,
  enabled: boolean,
  profileId: string,
): Promise<{ error: CloudWriteError | null }> {
  return db.upsert(
    'app_settings',
    {
      key: RETIREMENT_SETTING_KEY,
      value: { enabled, completed_at: new Date().toISOString(), by_profile: profileId },
    },
    'key',
  );
}
