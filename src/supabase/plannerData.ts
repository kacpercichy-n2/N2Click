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
  CalendarEvent,
  Client,
  Comment,
  CommentEntityType,
  Milestone,
  Notification,
  Project,
  Task,
  TaskPriority,
  Ticket,
  WorkloadEntry,
} from '../types';
import { isNotificationType, sanitizeNotificationPayload } from '../utils/notifications';
import { isValidDateStr, periodError, MAX_TASK_PERIOD_DAYS } from '../utils/dates';
import { normalizeRecurrence } from '../utils/recurrence';
import { normalizeProjectDocumentUrl } from '../utils/projectDocuments';
import { canonicalEventRecurrence, sanitizeClientContacts } from '../store/commandValidation';
import {
  DEFAULT_TICKET_KIND,
  DEFAULT_TICKET_PRIORITY,
  DEFAULT_TICKET_STATUS,
  isTicketKind,
  isTicketPriority,
  isTicketStatus,
} from '../utils/tickets';
import { BIN_DATE, DAY_MINUTES, HOURS_STEP, MINUTE_STEP, snapHours } from '../utils/time';
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
 * RLS, kod naruszenia ograniczenia (23502/23503/23505/23514) lub wyjątek
 * zgłoszony przez trigger (`raise exception`, klasa P0…) => `'permission'`
 * (odrzucenie — op zostaje porzucony z notatką, dane zostają lokalnie);
 * wszystko inne => `'transient'` (można ponowić). Wyjątki triggerów (np.
 * protect_profile_privileges: „Tylko administrator może zmieniać rolę…") są
 * deterministyczne — ponawianie nigdy nie pomoże, a jako 'transient' JEDEN taki
 * op blokował całą kolejkę lustra tej przeglądarki w nieskończoność (żadna
 * późniejsza edycja nie docierała do chmury).
 */
export function classifyWriteError(code: string | null, message: string): CloudWriteError {
  if (
    code === '42501' ||
    (code !== null && (CONSTRAINT_CODES.has(code) || code.startsWith('P0'))) ||
    PERMISSION_RE.test(message)
  ) {
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
  /** UPDATE istniejącego wiersza pasującego do `match`. RLS wycisza UPDATE do
   *  0 wierszy zamiast rzucić błędem — 0 trafień klasyfikujemy jako
   *  'permission', żeby pominięty zapis nigdy nie raportował „Zapisano”. */
  update(
    table: string,
    row: Record<string, unknown>,
    match: Record<string, string>,
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
    async update(table, row, match) {
      try {
        let query = client.from(table).update(row);
        for (const [column, value] of Object.entries(match)) {
          query = query.eq(column, value);
        }
        const { data, error } = await query.select('id');
        if (error) {
          const code = (error as { code?: string }).code ?? null;
          return { error: classifyWriteError(code, error.message ?? 'Błąd zapisu.') };
        }
        if (!Array.isArray(data) || data.length === 0) {
          return {
            error: {
              kind: 'permission',
              message: 'UPDATE nie objął żadnego wiersza (RLS odfiltrował cel).',
            },
          };
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
  /**
   * Zgłoszenia zespołu. OPCJONALNE (kolekcja dopisana addytywnie): brak pola =>
   * reduktor nie rusza kolekcji, obecne => podmienia ją autorytatywnie.
   * `loadPlannerSnapshot` zawsze je podaje.
   */
  tickets?: Ticket[];
  /**
   * Wydarzenia kalendarza. OPCJONALNE (kolekcja dopisana addytywnie): brak pola
   * => reduktor nie rusza kolekcji, obecne => podmienia ją autorytatywnie.
   * `loadPlannerSnapshot` zawsze je podaje.
   */
  events?: CalendarEvent[];
  /**
   * Profile chmury scalane PRZED walidacją encji (CloudSyncProvider dokleja je
   * ze snapshotu organizacji), żeby wiersze osób bez lokalnej pary e-mailowej
   * miały już swój lokalny odpowiednik. Brak pola => osoby bez zmian.
   */
  people?: import('./referenceData').CloudPersonMergeRow[];
}

export type LoadPlannerResult =
  | { ok: true; payload: CloudMergePayload; diagnostics: string[] }
  | { ok: false; error: string };

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const boolVal = (v: unknown): boolean => v === true;

/** SQL `date`/null -> lokalny 'yyyy-MM-dd' albo ''. */
function sqlDateToLocal(v: unknown): string {
  return typeof v === 'string' && v !== '' ? v : '';
}

/**
 * Hydracja `draft_hours` (jsonb chmury `[{ profile_id, hours }]`) na kanoniczne
 * `Task.draftHours`: profil przez `personOf`, `''` odpada, `hours > 0` snapowane,
 * dedup po osobie (pierwszy wygrywa); pusto => `undefined` (klucz nieobecny).
 */
function hydrateDraftHours(
  raw: unknown[],
  personOf: (v: unknown) => string,
): Array<{ personId: string; hours: number }> | undefined {
  const byPerson = new Map<string, number>();
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as Record<string, unknown>;
    const personId = personOf(rec.profile_id);
    if (personId === '' || byPerson.has(personId)) continue;
    const hoursRaw = rec.hours;
    if (typeof hoursRaw !== 'number' || !Number.isFinite(hoursRaw) || hoursRaw <= 0) continue;
    const hours = snapHours(hoursRaw);
    if (hours <= 0) continue;
    byPerson.set(personId, hours);
  }
  if (byPerson.size === 0) return undefined;
  return [...byPerson].map(([personId, hours]) => ({ personId, hours }));
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
 * Reverse-resolver dla identyfikatorów słownikowych i osobowych: najpierw
 * odwrócona mapa forward (cloud -> local, obejmuje dopasowanie po id i po
 * kluczu semantycznym), a bez pary — SAM id chmury. W architekturze
 * cloud-authoritative lokalne wiersze słowników/osób istnieją (lub zaraz
 * powstaną przez MERGE_CLOUD_DICTIONARIES / MERGE_CLOUD_PEOPLE) pod id chmury,
 * więc identyfikator chmury JEST poprawnym lokalnym odniesieniem.
 *
 * `restrictTo` (osoby): fallback dozwolony wyłącznie dla id ze snapshotu
 * organizacji — profil niewidoczny przez RLS nie dostanie lokalnego wiersza,
 * więc jego odniesienia muszą wrócić jako '' (wiersz jest pomijany), a nie
 * wywracać całej hydracji na walidacji reduktora.
 */
function makeReverse(forward: Map<string, string>, restrictTo?: Set<string>) {
  const reverse = invert(forward);
  return (cloudId: unknown): string => {
    const id = str(cloudId);
    if (id === '') return '';
    const mapped = reverse.get(id);
    if (mapped !== undefined) return mapped;
    if (restrictTo !== undefined && !restrictTo.has(id)) return '';
    return id;
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
  // Zachowany w sygnaturze dla zgodności wołających; reverse-resolvery nie
  // potrzebują już lokalnych id (fallback = id chmury, świat autorytatywny).
  _local: AppData,
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
    ticketsRes,
    eventsRes,
  ] = await Promise.all([
    db.select('clients', 'id, name, archived, contact_name, contact_email, contact_phone, notes, contacts'),
    db.select(
      'projects',
      'id, client_id, name, description, status_id, paid, start_date, end_date, department_id, service_type_id, company_id, documents, created_at, updated_at',
    ),
    db.select('milestones', 'id, project_id, name, milestone_date'),
    db.select(
      'tasks',
      'id, project_id, status_id, title, description, start_date, end_date, estimated_hours, priority, work_category_id, department_id, checklist, order_index, is_draft, draft_hours, recurrence, created_by, created_at, updated_at',
    ),
    db.select('task_assignments', 'task_id, profile_id'),
    db.select(
      'workload_entries',
      'id, task_id, profile_id, work_date, planned_hours, start_minutes, sort_index, done',
    ),
    db.select('comments', 'id, project_id, task_id, author_id, body, mention_ids, created_at'),
    db.select(
      'activity_events',
      'id, entity_type, entity_id, actor_id, impersonator_id, message, created_at',
    ),
    db.select(
      'tickets',
      'id, title, area, description, kind, priority, status, reporter_id, created_at, updated_at',
    ),
    db.select(
      'events',
      'id, title, description, location, meeting_url, event_date, start_minutes, duration_minutes, attendee_ids, recurrence, created_at, updated_at',
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
    activityRes.error ||
    ticketsRes.error ||
    eventsRes.error
  ) {
    return { ok: false, error: PLANNER_SNAPSHOT_ERROR };
  }

  const diagnostics: string[] = [];

  // Odwrotne resolvery (cloud -> local); bez pary zwracają id chmury wprost.
  const statusOf = makeReverse(maps.statuses);
  const serviceTypeOf = makeReverse(maps.serviceTypes);
  const workCategoryOf = makeReverse(maps.workCategories);
  const personOf = makeReverse(maps.people, maps.cloudProfileIds);

  // Klienci ---- (`contacts` sanityzowane do formy kanonicznej: klucz obecny
  // wyłącznie gdy jest ≥1 poprawna dodatkowa osoba; []/null/zniekształcone => brak).
  const clients: Client[] = clientsRes.rows.map((row) => {
    const contacts = sanitizeClientContacts(row.contacts);
    return {
      id: str(row.id),
      name: str(row.name),
      archived: boolVal(row.archived),
      contactName: str(row.contact_name),
      contactEmail: str(row.contact_email),
      contactPhone: str(row.contact_phone),
      notes: str(row.notes),
      ...(contacts ? { contacts } : {}),
    };
  });

  // Projekty ---- (id/departmentId/clientId dosłownie; słowniki przez reverse).
  const projects: Project[] = [];
  for (const row of projectsRes.rows) {
    const startDate = sqlDateToLocal(row.start_date);
    const endDate = sqlDateToLocal(row.end_date);
    if (periodError(startDate, endDate) !== null) {
      diagnostics.push(`Projekt „${str(row.name)}” pominięto — nieprawidłowy okres.`);
      continue;
    }
    projects.push({
      id: str(row.id),
      clientId: str(row.client_id),
      name: str(row.name),
      description: str(row.description),
      statusId: statusOf(row.status_id),
      paid: boolVal(row.paid),
      startDate,
      endDate,
      departmentId: str(row.department_id),
      serviceTypeId: serviceTypeOf(row.service_type_id),
      // Spółka wykonawcza (20260722): id słownika dosłownie (companies mirroruje
      // się po lokalnych id, jak profiles.company_id); NULL/brak kolumny => ''.
      companyId: str(row.company_id),
      // jsonb (20260721010000_project_documents): wartość spoza tablicy (starszy
      // wiersz, brak kolumny) czytamy jako pustą listę — jak `checklist` zadania.
      documents: Array.isArray(row.documents) ? (row.documents as Project['documents']) : [],
      createdAt: str(row.created_at),
      updatedAt: str(row.updated_at) || str(row.created_at),
    });
  }

  // Zbiór projektów, które PRZETRWAŁY walidację — wiersze zależne (kamienie,
  // zadania) wskazujące pominięty projekt też muszą odpaść, inaczej fail-closed
  // MERGE_CLOUD_ENTITIES odrzuci CAŁĄ hydrację przez jedną sierotę.
  const survivingProjectIds = new Set(projects.map((p) => p.id));

  // Kamienie milowe ---- (`milestone_date` -> lokalne `date`; zła data => wyklucz).
  const milestones: Milestone[] = [];
  for (const row of milestonesRes.rows) {
    const date = sqlDateToLocal(row.milestone_date);
    if (!isValidDateStr(date)) {
      diagnostics.push(`Kamień milowy „${str(row.name)}” pominięto — nieprawidłowa data.`);
      continue;
    }
    if (!survivingProjectIds.has(str(row.project_id))) {
      diagnostics.push(`Kamień milowy „${str(row.name)}” pominięto — projekt niedostępny.`);
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
      diagnostics.push(`Zadanie „${str(row.title)}” pominięto — nieprawidłowy okres.`);
      continue;
    }
    if (!survivingProjectIds.has(str(row.project_id))) {
      diagnostics.push(`Zadanie „${str(row.title)}” pominięto — projekt niedostępny.`);
      continue;
    }
    const estimated = row.estimated_hours;
    const checklist = Array.isArray(row.checklist)
      ? (row.checklist as Task['checklist'])
      : [];
    // Ranga wyświetlania: skończona liczba → wartość, w innym wypadku 0 (jak
    // estimated_hours). Wiersze same-0 (przed pierwszą zmianą kolejności) i tak
    // wyglądają jak sort po startDate dzięki tie-breakowi w selektorze.
    const orderIndexRaw = row.order_index;
    const orderIndex =
      typeof orderIndexRaw === 'number' && Number.isFinite(orderIndexRaw) ? orderIndexRaw : 0;
    // Godziny szkicu (forma kanoniczna — utrzymuje no-op merge `sameRowValue`
    // no-opem): budujemy klucz WYŁĄCZNIE dla `is_draft` i tablicy; per wpis
    // profil przez `personOf`, `''` odpada, `hours > 0` snapowane, dedup po
    // osobie; klucz obecny tylko gdy przetrwa ≥1 wpis.
    const draftHours =
      row.is_draft === true && Array.isArray(row.draft_hours)
        ? hydrateDraftHours(row.draft_hours as unknown[], personOf)
        : undefined;
    // Cykliczność (kolumna 20260721170000_task_recurrence): tylko wiersze
    // OPUBLIKOWANE (`is_draft !== true`) mogą nieść regułę (forma kanoniczna —
    // szkic nigdy). `normalizeRecurrence` kanonikalizuje względem daty startu;
    // NULL/legacy/śmieci => brak klucza. Autorytatywne: podmienia wartość lokalną
    // przez ścieżkę `MERGE_CLOUD_ENTITIES` (bez zmian w reduktorze scalania).
    const recurrence =
      row.is_draft === true ? undefined : normalizeRecurrence(row.recurrence, startDate);
    tasks.push({
      id: str(row.id),
      projectId: str(row.project_id),
      statusId: statusOf(row.status_id),
      title: str(row.title),
      description: str(row.description),
      startDate,
      endDate,
      estimatedHours:
        typeof estimated === 'number' && Number.isFinite(estimated) ? estimated : null,
      priority: toPriority(row.priority),
      workCategoryId: workCategoryOf(row.work_category_id),
      // Dosłownie jak w projektach — działy niosą id chmury (patrz wyżej).
      departmentId: str(row.department_id),
      checklist,
      orderIndex,
      // Szkic (20260721020000_task_is_draft): kolumna spoza `true` (starszy
      // wiersz, brak kolumny, null) czytamy jako opublikowane.
      isDraft: row.is_draft === true,
      ...(draftHours ? { draftHours } : {}),
      ...(recurrence ? { recurrence } : {}),
      // Autor zadania (kolumna 20260723130000_tasks_created_by): profil chmury
      // przez `personOf` -> lokalne id; niemapowalny/NULL => brak klucza (forma
      // kanoniczna, jak w normalizeTaskMeta). Zasila feed powiadomień.
      ...(personOf(row.created_by) ? { createdBy: personOf(row.created_by) } : {}),
      createdAt: str(row.created_at),
      updatedAt: str(row.updated_at) || str(row.created_at),
    });
  }

  // Przypisania ---- (para {taskId, personId}; niemapowalny profil lub
  // pominięte zadanie => pomiń wiersz, nie całą hydrację).
  const survivingTaskIds = new Set(tasks.map((t) => t.id));
  const assignments: Array<{ taskId: string; personId: string }> = [];
  for (const row of assignmentsRes.rows) {
    const taskId = str(row.task_id);
    const personId = personOf(row.profile_id);
    if (personId === '') {
      diagnostics.push(
        `Przypisanie zadania ${taskId} pominięto — brak lokalnej osoby dla profilu.`,
      );
      continue;
    }
    if (!survivingTaskIds.has(taskId)) {
      diagnostics.push(`Przypisanie pominięto — zadanie ${taskId} niedostępne.`);
      continue;
    }
    assignments.push({ taskId, personId });
  }

  // Zaplanowane godziny ---- (work_date null <-> ''; profil przez reverse;
  // rewalidacja siatki; para zasobnika trzymana raz — pierwszy wiersz wygrywa).
  const workload: WorkloadEntry[] = [];
  const seenBinPairs = new Set<string>();
  for (const row of workloadRes.rows) {
    const personId = personOf(row.profile_id);
    if (personId === '') {
      diagnostics.push('Blok godzin pominięto — brak lokalnej osoby dla profilu.');
      continue;
    }
    const taskId = str(row.task_id);
    if (!survivingTaskIds.has(taskId)) {
      diagnostics.push(`Blok godzin pominięto — zadanie ${taskId} niedostępne.`);
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
      if ((startMinutes as number) + plannedHours * 60 > DAY_MINUTES) {
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
      // Per-block completion (PKG-per-block-done): cloud-authoritative, anything
      // other than the literal true (NULL/legacy/false) hydrates as not done.
      done: row.done === true,
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

  // Zgłoszenia ---- (`reporter_id` przez reverse osób; brak tytułu albo
  // niemapowalny zgłaszający => wiersz WYKLUCZONY z diagnostyką, bo reduktor
  // waliduje zgłaszającego fail-closed. Nieznane enumy normalizujemy do
  // wartości domyślnych, tak samo jak repair lokalny.)
  const tickets: Ticket[] = [];
  for (const row of ticketsRes.rows) {
    const title = str(row.title);
    if (title === '') {
      diagnostics.push('Zgłoszenie pominięto — brak nazwy.');
      continue;
    }
    const reporterId = personOf(row.reporter_id);
    if (reporterId === '') {
      diagnostics.push(`Zgłoszenie „${title}” pominięto — zgłaszający niedostępny.`);
      continue;
    }
    tickets.push({
      id: str(row.id),
      title,
      area: str(row.area),
      description: str(row.description),
      kind: isTicketKind(row.kind) ? row.kind : DEFAULT_TICKET_KIND,
      priority: isTicketPriority(row.priority) ? row.priority : DEFAULT_TICKET_PRIORITY,
      status: isTicketStatus(row.status) ? row.status : DEFAULT_TICKET_STATUS,
      reporterId,
      createdAt: str(row.created_at),
      updatedAt: str(row.updated_at),
    });
  }

  // Wydarzenia kalendarza ---- (`attendee_ids` przez reverse osób, '' odpada,
  // dedupe; `meeting_url` przez schemat http(s); `recurrence` w formie
  // kanonicznej wydarzenia — czasy reguły = czasy wydarzenia, dzień kotwicy w
  // `daysOfWeek`; brak/śmieci => brak klucza. Wiersz bez tytułu albo z niepoprawną
  // datą jest WYKLUCZANY — mergeCloudEntities i tak fail-closuje na złej dacie.)
  const events: CalendarEvent[] = [];
  for (const row of eventsRes.rows) {
    const title = str(row.title);
    const date = sqlDateToLocal(row.event_date);
    if (title === '') {
      diagnostics.push('Wydarzenie pominięto — brak nazwy.');
      continue;
    }
    if (!isValidDateStr(date)) {
      diagnostics.push(`Wydarzenie „${title}” pominięto — nieprawidłowa data.`);
      continue;
    }
    const startRaw = row.start_minutes;
    const durRaw = row.duration_minutes;
    const startMinutes =
      typeof startRaw === 'number' && Number.isFinite(startRaw) ? startRaw : 0;
    const durationMinutes =
      typeof durRaw === 'number' && Number.isFinite(durRaw) ? durRaw : MINUTE_STEP;
    const attendeeSource = Array.isArray(row.attendee_ids) ? (row.attendee_ids as unknown[]) : [];
    const attendeeIds: string[] = [];
    const seenAttendees = new Set<string>();
    for (const raw of attendeeSource) {
      const personId = personOf(raw);
      if (personId === '' || seenAttendees.has(personId)) continue;
      seenAttendees.add(personId);
      attendeeIds.push(personId);
    }
    const recurrence = canonicalEventRecurrence(
      row.recurrence,
      date,
      startMinutes,
      durationMinutes,
    );
    events.push({
      id: str(row.id),
      title,
      description: str(row.description),
      location: str(row.location),
      meetingUrl: normalizeProjectDocumentUrl(str(row.meeting_url)) ?? '',
      date,
      startMinutes,
      durationMinutes,
      attendeeIds,
      ...(recurrence ? { recurrence } : {}),
      createdAt: str(row.created_at),
      updatedAt: str(row.updated_at) || str(row.created_at),
    });
  }

  // DETERMINISTYCZNA kolejność ładunku: selecty nie mają ORDER BY, więc
  // Postgres zwraca wiersze w kolejności sterty (każdy UPDATE przenosi wiersz
  // fizycznie na koniec) — dwa kolejne snapshoty tego samego zbioru potrafiły
  // się różnić samą permutacją. Sortujemy po stabilnych kluczach, żeby pierwsza
  // hydracja i dokładanie NOWYCH wierszy (reconcileRows appenduje w kolejności
  // ładunku) były identyczne między odświeżeniami i przeglądarkami.
  return {
    ok: true,
    payload: {
      clients: sortStable(clients, (c) => c.name),
      projects: sortStable(projects, (p) => p.createdAt),
      milestones: sortStable(milestones, (m) => m.date),
      tasks: sortStable(tasks, (t) => t.createdAt),
      assignments: [...assignments].sort((a, b) =>
        cmp(`${a.taskId}|${a.personId}`, `${b.taskId}|${b.personId}`),
      ),
      workload: sortStable(workload, () => ''),
      comments: sortStable(comments, (c) => c.createdAt),
      activity: sortStable(activity, (e) => e.createdAt),
      tickets: sortStable(tickets, (t) => t.createdAt),
      events: sortStable(events, (e) => e.createdAt),
    },
    diagnostics,
  };
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Sort po (klucz, id) — całkowity porządek niezależny od kolejności z serwera. */
function sortStable<T extends { id: string }>(rows: T[], key: (row: T) => string): T[] {
  return [...rows].sort((a, b) => cmp(key(a), key(b)) || cmp(a.id, b.id));
}

// ---- Powiadomienia in-app (osobny, degradujący się bezpiecznie loader) -------

/**
 * Wynik hydracji powiadomień. `available: true` => wołający PODMIENIA kolekcję
 * autorytatywnie (dane albo PUSTO, gdy tabela nie istnieje). `available: false`
 * => błąd PRZEJŚCIOWY (sieć/backend): wołający NIE dispatchuje scalenia i
 * ZOSTAWIA poprzedni stan (panel nie miga pustką na chwilowym błędzie).
 */
export type NotificationsSnapshotResult =
  | { available: true; notifications: Notification[] }
  | { available: false };

// Komunikaty PostgREST/PG dla braku tabeli/relacji (migracja niezaaplikowana):
// PG 42P01 „relation does not exist", PostgREST PGRST205 „Could not find the
// table ... in the schema cache". Traktujemy je jako trwałą degradację do [].
const MISSING_TABLE_RE = /does not exist|PGRST205|could not find the table|schema cache|42P01/i;

/**
 * Wczytuje własne powiadomienia zalogowanego odbiorcy (RLS zawęża SELECT do
 * `recipient_id = auth.uid()`). ŚWIADOMIE ODDZIELNIE od `loadPlannerSnapshot`:
 * `read_at`/tabela `notifications` jest rozszerzeniem addytywnym, a migracja może
 * być jeszcze niezaaplikowana w środowisku.
 *
 * ROZRÓŻNIENIE BŁĘDÓW: brak tabeli (42P01/PGRST205) degraduje się do PUSTEJ
 * listy z `available: true` (podmiana autorytatywna — środowisko bez migracji
 * po prostu nie ma powiadomień). Błąd PRZEJŚCIOWY (sieć/wyjątek) zwraca
 * `available: false` — wołający zostawia poprzedni stan, żeby panel nie migał
 * pustką na chwilowym błędzie. Wiersz bez id / niemapowalnego odbiorcy / z
 * nieznanym `type` jest pomijany. `read_at` null => '' (nieprzeczytane).
 */
export async function loadNotificationsSnapshot(
  db: Pick<PlannerDb, 'select'>,
  maps: CloudIdMaps,
): Promise<NotificationsSnapshotResult> {
  let res: Awaited<ReturnType<PlannerDb['select']>>;
  try {
    res = await db.select(
      'notifications',
      'id, recipient_id, type, payload, read_at, created_at',
    );
  } catch {
    // Wyjątek (np. sieć) => przejściowe: nie ruszaj panelu.
    return { available: false };
  }
  if (res.error) {
    // Brak tabeli => degradacja do [] (podmiana). Inny błąd => przejściowe.
    return MISSING_TABLE_RE.test(res.error)
      ? { available: true, notifications: [] }
      : { available: false };
  }
  const personOf = makeReverse(maps.people, maps.cloudProfileIds);
  const notifications: Notification[] = [];
  for (const row of res.rows) {
    const id = str(row.id);
    const recipientId = personOf(row.recipient_id);
    if (id === '' || recipientId === '' || !isNotificationType(row.type)) continue;
    // `payload.actorId` przechowywany jako id PROFILU chmury (kanonicznie). Osoby
    // dopasowane po e-mailu zachowują LOKALNE id (może różnić się od chmurowego),
    // więc rozwiązujemy aktora przez reverse — niemapowalny => klucz pominięty
    // („Ktoś" w UI). `taskId`/`projectId` noszą id encji dosłownie (== chmura),
    // więc nie wymagają mapowania.
    const payload = sanitizeNotificationPayload(row.payload);
    if (payload.actorId !== undefined) {
      const localActor = personOf(payload.actorId);
      if (localActor !== '') payload.actorId = localActor;
      else delete payload.actorId;
    }
    notifications.push({
      id,
      recipientId,
      type: row.type,
      payload,
      // timestamptz null => '' (nieprzeczytane); string ISO przechodzi wprost.
      readAt: str(row.read_at),
      createdAt: str(row.created_at),
    });
  }
  return { available: true, notifications };
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
