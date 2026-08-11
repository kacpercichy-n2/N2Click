// Czyste lustro diff-owe (id maps + diff + apply) dla danych planera. Mapuje
// mutacje AppStore na operacje zapisu do Supabase (upsert/update/remove)
// i wykonuje je przez wstrzyknięty `PlannerDb`. Testowalne w node — bez SDK, bez jsdom.
//
// GRANICE / INVARIANTS:
//   * Zapisy chmury liczone są ze STANU (diff prev -> next) PO reduktorze, nie
//     przez przechwytywanie akcji ani thunki — odrzucona komenda (ta sama
//     referencja stanu) nie daje różnicy, więc zero operacji (inwariant 6).
//   * Komentarze i dziennik aktywności są DOPISYWALNE: lustrujemy tylko NOWE
//     wiersze; lokalne przycięcia (kasacja encji) sprząta kaskada FK w chmurze.
//   * Godziny (workload) nigdy nie są lustrzane — nie ma tabeli.
//   * Wiersz wskazujący na niemapowalną osobę/status/słownik lub o nie-UUID id
//     => brak operacji + polska diagnostyka (praca zostaje lokalnie, nic nie
//     rzuca). Nadmiarowy upsert (dwie karty) jest idempotentny.
import type {
  AccessRole,
  ActivityEvent,
  AppData,
  CalendarEvent,
  Client,
  Comment,
  ContentPlanBrand,
  ContentPlanChannel,
  ContentPlanComment,
  ContentPlanHistoryEntry,
  ContentPlanPost,
  Milestone,
  Project,
  Status,
  Task,
  Ticket,
  WorkloadEntry,
} from '../types';
import { normalizeEmail } from '../auth/profile';
import { splitContentPlanTags } from '../contentplan/domain';
import type { OrgSnapshot } from './referenceData';
import { isMissingCloudTable, type PlannerDb } from './plannerData';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (id: string): boolean => UUID_RE.test(id);

// ---- Polskie stałe -----------------------------------------------------------

export const SYNC_ERROR_MSG =
  'Nie udało się zapisać zmian na serwerze. Dane pozostały w tej przeglądarce.';
export const SYNC_PERMISSION_MSG =
  'Serwer odrzucił zmianę (brak uprawnień) — pozostała tylko w tej przeglądarce.';
export const STALE_HINT_MSG = 'Dane mogą być nieaktualne — odśwież dane z serwera.';

/** Udokumentowane mapowanie ról frontend→cloud (patrz referenceData.ts). */
const ACCESS_ROLE_TO_CLOUD: Record<AccessRole, 'administrator' | 'manager' | 'worker'> = {
  pelne: 'administrator',
  ograniczone: 'worker',
};

const DIAG = {
  nonUuid: 'Identyfikator nie jest w formacie UUID — rekord pozostaje tylko lokalnie.',
  unmappableStatus: 'Status wiersza nie istnieje po stronie serwera — rekord pozostaje lokalnie.',
  unmappableDict: 'Słownik wiersza nie istnieje po stronie serwera — rekord pozostaje lokalnie.',
  unmappablePerson: 'Osoba wiersza nie ma konta serwera — rekord pozostaje lokalnie.',
} as const;

// ---- Mapy identyfikatorów (forward: local -> cloud) --------------------------

export interface CloudIdMaps {
  people: Map<string, string>; // localPersonId -> cloudProfileId (po e-mailu)
  statuses: Map<string, string>; // po id, fallback slug
  serviceTypes: Map<string, string>; // po id, fallback nazwa
  workCategories: Map<string, string>; // po id, fallback nazwa
  departments: Map<string, string>; // po id, fallback nazwa
  /** Id WSZYSTKICH profili widocznych w snapshocie organizacji (RLS). Wiersz
   *  planera wskazujący profil spoza tego zbioru nie ma i nie będzie miał
   *  lokalnego odpowiednika (MERGE_CLOUD_PEOPLE tworzy osoby wyłącznie ze
   *  snapshotu), więc hydracja musi go pominąć zamiast wywrócić scalenie. */
  cloudProfileIds: Set<string>;
}

function forwardMap<L extends { id: string }, C extends { id: string }>(
  localItems: L[],
  cloudItems: C[],
  keyOfLocal: (l: L) => string,
  keyOfCloud: (c: C) => string,
): Map<string, string> {
  const cloudIds = new Set(cloudItems.map((c) => c.id));
  const byKey = new Map<string, string>();
  for (const c of cloudItems) {
    const k = keyOfCloud(c);
    if (k && !byKey.has(k)) byKey.set(k, c.id);
  }
  const map = new Map<string, string>();
  for (const l of localItems) {
    if (cloudIds.has(l.id)) {
      map.set(l.id, l.id);
      continue;
    }
    const k = keyOfLocal(l);
    const hit = k ? byKey.get(k) : undefined;
    if (hit) map.set(l.id, hit);
  }
  return map;
}

/**
 * Buduje mapy id local -> cloud reużywając ustalonych decyzji importu (208):
 * osoby po znormalizowanym e-mailu; statusy po id, fallback slug; typy usług /
 * kategorie prac / działy po id, fallback nazwa; klienci/projekty/zadania/
 * komentarze/aktywność noszą id DOSŁOWNIE (lokalne id = klucz główny w chmurze).
 */
export function buildCloudIdMaps(local: AppData, org: OrgSnapshot): CloudIdMaps {
  return {
    cloudProfileIds: new Set(org.profiles.map((p) => p.id)),
    people: forwardMap(
      local.people,
      org.profiles,
      (p) => normalizeEmail(p.email),
      (c) => normalizeEmail(c.email),
    ),
    statuses: forwardMap(
      local.statuses,
      org.statuses,
      (s) => s.slug.trim(),
      (c) => c.slug.trim(),
    ),
    serviceTypes: forwardMap(
      local.serviceTypes,
      org.serviceTypes,
      (s) => s.name.trim(),
      (c) => c.name.trim(),
    ),
    workCategories: forwardMap(
      local.workCategories,
      org.workCategories,
      (c) => c.name.trim(),
      (c) => c.name.trim(),
    ),
    departments: forwardMap(
      local.departments,
      org.departments,
      (d) => d.name.trim(),
      (d) => d.name.trim(),
    ),
  };
}

// ---- Operacje ----------------------------------------------------------------

export type CloudOp = {
  kind: 'upsert' | 'update' | 'remove';
  table: string;
  row?: Record<string, unknown>;
  match?: Record<string, string>; // cel dla 'update' i 'remove'
  onConflict?: string; // dla złożonego upsertu przypisań (task_id,profile_id)
  /**
   * Upsert w trybie `ON CONFLICT DO NOTHING` (PostgREST
   * `resolution=ignore-duplicates`) — dla tabel APPEND-ONLY (`contentplan`:
   * komentarze, historia), gdzie rola kliencka ma wyłącznie grant INSERT.
   * Zwykły upsert kompiluje się do `ON CONFLICT DO UPDATE` i odbija się od
   * braku grantu UPDATE, zanim jakikolwiek konflikt w ogóle wystąpi.
   */
  ignoreDuplicates?: true;
  sourceId: string; // lokalny id / klucz pary — do debugowania i suppresji
  label: string; // polska etykieta do bannera
  /**
   * Schemat inny niż domyślny (`n2click`) — dziś wyłącznie
   * {@link CONTENT_PLAN_SCHEMA}. Op z tym znacznikiem MUSI trafić do adaptera
   * przypiętego na `client.schema(...)` (patrz `applyCloudOps`); brak adaptera
   * = cichy drop, nigdy zapis do domyślnego schematu.
   */
  schema?: string;
};

/** Schemat modułu Content Plan (osobny od `n2click`, migracja 20260803160000). */
export const CONTENT_PLAN_SCHEMA = 'contentplan';

export interface DiffResult {
  ops: CloudOp[];
  diagnostics: string[];
}

const dateOrNull = (d: string): string | null => (d === '' ? null : d);

/** Rozwiązuje referencję słownikową (status/typ usługi/kategoria): '' -> null,
 *  trafienie w mapie -> cloud id, brak -> nierozwiązywalne (ok:false). */
function resolveDict(
  value: string,
  map: Map<string, string>,
): { ok: true; cloud: string | null } | { ok: false } {
  if (value === '') return { ok: true, cloud: null };
  const cloud = map.get(value);
  return cloud ? { ok: true, cloud } : { ok: false };
}

/** Dział: '' -> null, mapa -> cloud, brak -> null (fallback jak w imporcie). */
function resolveDept(value: string, map: Map<string, string>): string | null {
  if (value === '') return null;
  return map.get(value) ?? null;
}

function clientRow(c: Client): Record<string, unknown> {
  return {
    id: c.id,
    name: c.name,
    archived: c.archived,
    contact_name: c.contactName ?? '',
    contact_email: c.contactEmail ?? '',
    contact_phone: c.contactPhone ?? '',
    notes: c.notes ?? '',
    // Dodatkowe osoby kontaktowe: kolumna jsonb (default '[]'); klient bez
    // klucza mirroruje się jako pusta tablica.
    contacts: c.contacts ?? [],
  };
}

function projectRow(
  p: Project,
  maps: CloudIdMaps,
  clientIds: Set<string>,
  diagnostics: string[],
): Record<string, unknown> | null {
  if (!isUuid(p.id)) {
    diagnostics.push(DIAG.nonUuid);
    return null;
  }
  const status = resolveDict(p.statusId, maps.statuses);
  if (!status.ok) {
    diagnostics.push(DIAG.unmappableStatus);
    return null;
  }
  const service = resolveDict(p.serviceTypeId, maps.serviceTypes);
  if (!service.ok) {
    diagnostics.push(DIAG.unmappableDict);
    return null;
  }
  const clientId = p.clientId !== '' && clientIds.has(p.clientId) && isUuid(p.clientId)
    ? p.clientId
    : null;
  return {
    id: p.id,
    client_id: clientId,
    name: p.name,
    description: p.description,
    status_id: status.cloud,
    paid: p.paid,
    start_date: dateOrNull(p.startDate),
    end_date: dateOrNull(p.endDate),
    department_id: resolveDept(p.departmentId, maps.departments),
    service_type_id: service.cloud,
    // Spółka wykonawcza: companies mirroruje się po lokalnych id (jak
    // profiles.company_id), więc bez mapowania; '' => NULL.
    company_id: (p.companyId ?? '') === '' ? null : p.companyId,
    documents: p.documents,
    // Utajniona treść (kolumna 20260805120000): brak klucza => false.
    is_confidential: p.isConfidential === true,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
}

function taskRow(
  t: Task,
  maps: CloudIdMaps,
  diagnostics: string[],
): Record<string, unknown> | null {
  if (!isUuid(t.id) || !isUuid(t.projectId)) {
    diagnostics.push(DIAG.nonUuid);
    return null;
  }
  const status = resolveDict(t.statusId, maps.statuses);
  if (!status.ok) {
    diagnostics.push(DIAG.unmappableStatus);
    return null;
  }
  const category = resolveDict(t.workCategoryId, maps.workCategories);
  if (!category.ok) {
    diagnostics.push(DIAG.unmappableDict);
    return null;
  }
  return {
    id: t.id,
    project_id: t.projectId,
    status_id: status.cloud,
    title: t.title,
    description: t.description,
    start_date: dateOrNull(t.startDate),
    end_date: dateOrNull(t.endDate),
    estimated_hours: t.estimatedHours,
    priority: t.priority,
    work_category_id: category.cloud,
    department_id: resolveDept(t.departmentId, maps.departments),
    checklist: t.checklist,
    order_index: t.orderIndex,
    // Szkic (kolumna 20260721020000_task_is_draft): brak pola => opublikowane.
    is_draft: t.isDraft === true,
    // Godziny szkicu (kolumna 20260721130000_task_draft_hours, jsonb): kształt
    // `[{ profile_id, hours }]`. personId mapowany jak w `ticketRow`; wpis
    // niemapowalny ODPADA (nie zerujemy całego wiersza). Brak `draftHours` => null.
    draft_hours: draftHoursRow(t, maps),
    // Cykliczność (kolumna 20260721170000_task_recurrence, jsonb): obiekt
    // kanoniczny zapisywany dosłownie. Wyjątki niosą tylko daty/minuty — bez
    // profili, więc bez mapowania id. Brak `recurrence` => null.
    recurrence: t.recurrence ?? null,
    // Utajniona treść (kolumna 20260805120000): brak klucza => false.
    is_confidential: t.isConfidential === true,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
  };
}

/** Mapuje `Task.draftHours` na jsonb chmury `[{ profile_id, hours }]`; wpis o
 *  niemapowalnym personId odpada, brak godzin => null. */
function draftHoursRow(
  t: Task,
  maps: CloudIdMaps,
): Array<{ profile_id: string; hours: number }> | null {
  if (!t.draftHours || t.draftHours.length === 0) return null;
  const rows: Array<{ profile_id: string; hours: number }> = [];
  for (const entry of t.draftHours) {
    const profileId =
      maps.people.get(entry.personId) ??
      (maps.cloudProfileIds.has(entry.personId) ? entry.personId : undefined);
    if (profileId === undefined) continue;
    rows.push({ profile_id: profileId, hours: entry.hours });
  }
  return rows.length > 0 ? rows : null;
}

function milestoneRow(m: Milestone, diagnostics: string[]): Record<string, unknown> | null {
  if (!isUuid(m.id) || !isUuid(m.projectId)) {
    diagnostics.push(DIAG.nonUuid);
    return null;
  }
  return {
    id: m.id,
    project_id: m.projectId,
    name: m.name,
    milestone_date: m.date,
  };
}

function ticketRow(
  t: Ticket,
  maps: CloudIdMaps,
  diagnostics: string[],
): Record<string, unknown> | null {
  if (!isUuid(t.id)) {
    diagnostics.push(DIAG.nonUuid);
    return null;
  }
  const reporterId = maps.people.get(t.reporterId) ?? (maps.cloudProfileIds.has(t.reporterId) ? t.reporterId : null);
  if (reporterId === null) {
    diagnostics.push(DIAG.unmappablePerson);
    return null;
  }
  return {
    id: t.id,
    title: t.title,
    area: t.area,
    description: t.description,
    kind: t.kind,
    priority: t.priority,
    status: t.status,
    reporter_id: reporterId,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
  };
}

/**
 * Mapuje wydarzenie kalendarza na wiersz tabeli `events`. `id` musi być UUID;
 * `attendee_ids` mapowane per-id jak w `draftHoursRow` — wpis o niemapowalnym
 * personId ODPADA (bez zerowania całego wiersza). Kolumny snake_case; recurrence
 * zapisywane dosłownie (obiekt kanoniczny) albo null. `kind`/`end_date` piszemy
 * ZAWSZE (kolumna ma default 'meeting'), więc brak lokalnego klucza = spotkanie.
 */
function eventRow(
  e: CalendarEvent,
  maps: CloudIdMaps,
  diagnostics: string[],
): Record<string, unknown> | null {
  if (!isUuid(e.id)) {
    diagnostics.push(DIAG.nonUuid);
    return null;
  }
  const attendeeIds: string[] = [];
  for (const personId of e.attendeeIds) {
    const profileId =
      maps.people.get(personId) ?? (maps.cloudProfileIds.has(personId) ? personId : undefined);
    if (profileId === undefined) {
      diagnostics.push(DIAG.unmappablePerson);
      continue;
    }
    attendeeIds.push(profileId);
  }
  // Nieobecności per wystąpienie: personId mapowane na profil chmury jak
  // attendee_ids (wpis bez konta serwera zostaje lokalny — diagnostyka).
  const absences: Array<{ date: string; personId: string }> = [];
  for (const a of e.absences ?? []) {
    const profileId =
      maps.people.get(a.personId) ??
      (maps.cloudProfileIds.has(a.personId) ? a.personId : undefined);
    if (profileId === undefined) {
      diagnostics.push(DIAG.unmappablePerson);
      continue;
    }
    absences.push({ date: a.date, personId: profileId });
  }
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    location: e.location,
    meeting_url: e.meetingUrl,
    event_date: e.date,
    start_minutes: e.startMinutes,
    duration_minutes: e.durationMinutes,
    attendee_ids: attendeeIds,
    absences,
    recurrence: e.recurrence ?? null,
    kind: e.kind ?? 'meeting',
    end_date: e.endDate ?? null,
    // Utajniona treść (kolumna 20260805120000): brak klucza => false.
    is_confidential: e.isConfidential === true,
    created_at: e.createdAt,
    updated_at: e.updatedAt,
  };
}

function workloadRow(
  w: WorkloadEntry,
  maps: CloudIdMaps,
  diagnostics: string[],
): Record<string, unknown> | null {
  if (!isUuid(w.id) || !isUuid(w.taskId)) {
    diagnostics.push(DIAG.nonUuid);
    return null;
  }
  const profileId = maps.people.get(w.personId);
  if (!profileId) {
    diagnostics.push(DIAG.unmappablePerson);
    return null;
  }
  return {
    id: w.id,
    task_id: w.taskId,
    profile_id: profileId,
    work_date: dateOrNull(w.date),
    planned_hours: w.plannedHours,
    start_minutes: w.startMinutes,
    sort_index: w.sortIndex,
    // Per-block completion (PKG-per-block-done): additive column, default false.
    done: w.done === true,
  };
}

function commentRow(
  c: Comment,
  maps: CloudIdMaps,
  diagnostics: string[],
): Record<string, unknown> | null {
  if (!isUuid(c.id) || !isUuid(c.entityId)) {
    diagnostics.push(DIAG.nonUuid);
    return null;
  }
  let authorId: string | null = null;
  if (c.authorId !== '') {
    const mapped = maps.people.get(c.authorId);
    if (!mapped) {
      diagnostics.push(DIAG.unmappablePerson);
      return null;
    }
    authorId = mapped;
  }
  const mentionIds = c.mentionIds
    .map((id) => maps.people.get(id))
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

function activityRow(
  e: ActivityEvent,
  maps: CloudIdMaps,
  diagnostics: string[],
): Record<string, unknown> | null {
  if (!isUuid(e.id)) {
    diagnostics.push(DIAG.nonUuid);
    return null;
  }
  const mapPerson = (value: string): string | null | undefined => {
    if (value === '') return null;
    const mapped = maps.people.get(value);
    return mapped ?? undefined; // undefined => nierozwiązywalne
  };
  const actorId = mapPerson(e.actorId);
  if (actorId === undefined) {
    diagnostics.push(DIAG.unmappablePerson);
    return null;
  }
  const impersonatorId = mapPerson(e.impersonatorId ?? '');
  if (impersonatorId === undefined) {
    diagnostics.push(DIAG.unmappablePerson);
    return null;
  }
  const isProject = e.entityType === 'project' && isUuid(e.entityId);
  const isTask = e.entityType === 'task' && isUuid(e.entityId);
  // created_by celowo pominięty — domyślne auth.uid() po stronie serwera spełnia
  // politykę INSERT (created_by = auth.uid()).
  return {
    id: e.id,
    entity_type: e.entityType,
    entity_id: e.entityId,
    project_id: isProject ? e.entityId : null,
    task_id: isTask ? e.entityId : null,
    actor_id: actorId,
    impersonator_id: impersonatorId,
    message: e.message,
    created_at: e.createdAt,
  };
}

const byId = <T extends { id: string }>(items: T[]): Map<string, T> =>
  new Map(items.map((i) => [i.id, i]));

/**
 * Diff dwóch stanów na operacje zapisu chmury w kolejności zależności:
 * klienci -> projekty -> kamienie milowe -> zadania -> przypisania ->
 * zaplanowane godziny -> komentarze -> aktywność. Klienci/projekty/kamienie/
 * zadania/godziny: upsert dodanych i zmienionych (last-write-wins), remove
 * usuniętych (kaskada FK sprząta zależne). Zmiany statusu zadania/projektu to
 * zwykłe upserty (ta sama ścieżka). Przypisania: złożony upsert / remove po parze
 * (task_id, profile_id). SCHEDULE_BIN_PART emituje naturalnie swoją atomową parę
 * (upsert zdekrementowanego wiersza zasobnika lub remove przy zerze + upsert
 * wiersza datowanego). Komentarze i aktywność: DOPISYWALNE — tylko nowe wiersze.
 */
export function diffToCloudOps(prev: AppData, next: AppData, maps: CloudIdMaps): DiffResult {
  const ops: CloudOp[] = [];
  const diagnostics: string[] = [];
  const nextClientIds = new Set(next.clients.map((c) => c.id));

  // 1) Klienci ----
  {
    const prevMap = byId(prev.clients);
    const nextMap = byId(next.clients);
    for (const id of prevMap.keys()) {
      if (!nextMap.has(id)) {
        if (isUuid(id)) {
          ops.push({ kind: 'remove', table: 'clients', match: { id }, sourceId: id, label: 'Klient (usunięcie)' });
        }
      }
    }
    for (const c of next.clients) {
      const before = prevMap.get(c.id);
      if (before && JSON.stringify(before) === JSON.stringify(c)) continue;
      if (!isUuid(c.id)) {
        diagnostics.push(DIAG.nonUuid);
        continue;
      }
      ops.push({ kind: 'upsert', table: 'clients', row: clientRow(c), sourceId: c.id, label: `Klient „${c.name}”` });
    }
  }

  // 2) Projekty ----
  {
    const prevMap = byId(prev.projects);
    const nextMap = byId(next.projects);
    for (const id of prevMap.keys()) {
      if (!nextMap.has(id) && isUuid(id)) {
        ops.push({ kind: 'remove', table: 'projects', match: { id }, sourceId: id, label: 'Projekt (usunięcie)' });
      }
    }
    for (const p of next.projects) {
      const before = prevMap.get(p.id);
      if (before && JSON.stringify(before) === JSON.stringify(p)) continue;
      const row = projectRow(p, maps, nextClientIds, diagnostics);
      if (row) ops.push({ kind: 'upsert', table: 'projects', row, sourceId: p.id, label: `Projekt „${p.name}”` });
    }
  }

  // 3) Kamienie milowe ---- (diff po id: upsert dodanych/zmienionych, remove usuniętych)
  {
    const prevMap = byId(prev.milestones);
    const nextMap = byId(next.milestones);
    for (const id of prevMap.keys()) {
      if (!nextMap.has(id) && isUuid(id)) {
        ops.push({ kind: 'remove', table: 'milestones', match: { id }, sourceId: id, label: 'Kamień milowy (usunięcie)' });
      }
    }
    for (const m of next.milestones) {
      const before = prevMap.get(m.id);
      if (before && JSON.stringify(before) === JSON.stringify(m)) continue;
      const row = milestoneRow(m, diagnostics);
      if (row) ops.push({ kind: 'upsert', table: 'milestones', row, sourceId: m.id, label: `Kamień milowy „${m.name}”` });
    }
  }

  // 4) Zadania ----
  {
    const prevMap = byId(prev.tasks);
    const nextMap = byId(next.tasks);
    for (const id of prevMap.keys()) {
      if (!nextMap.has(id) && isUuid(id)) {
        ops.push({ kind: 'remove', table: 'tasks', match: { id }, sourceId: id, label: 'Zadanie (usunięcie)' });
      }
    }
    for (const t of next.tasks) {
      const before = prevMap.get(t.id);
      if (before && JSON.stringify(before) === JSON.stringify(t)) continue;
      const row = taskRow(t, maps, diagnostics);
      if (row) ops.push({ kind: 'upsert', table: 'tasks', row, sourceId: t.id, label: `Zadanie „${t.title}”` });
    }
  }

  // 5) Przypisania ---- (po parze task_id|personId)
  {
    const prevPairs = new Map(prev.assignments.map((a) => [`${a.taskId}|${a.personId}`, a]));
    const nextPairs = new Map(next.assignments.map((a) => [`${a.taskId}|${a.personId}`, a]));
    for (const [key, a] of prevPairs) {
      if (nextPairs.has(key)) continue;
      const profileId = maps.people.get(a.personId);
      if (!profileId || !isUuid(a.taskId)) continue; // nigdy nie zsynchronizowane
      ops.push({
        kind: 'remove',
        table: 'task_assignments',
        match: { task_id: a.taskId, profile_id: profileId },
        sourceId: key,
        label: 'Przypisanie (usunięcie)',
      });
    }
    for (const [key, a] of nextPairs) {
      if (prevPairs.has(key)) continue;
      if (!isUuid(a.taskId)) {
        diagnostics.push(DIAG.nonUuid);
        continue;
      }
      const profileId = maps.people.get(a.personId);
      if (!profileId) {
        diagnostics.push(DIAG.unmappablePerson);
        continue;
      }
      ops.push({
        kind: 'upsert',
        table: 'task_assignments',
        row: { task_id: a.taskId, profile_id: profileId },
        onConflict: 'task_id,profile_id',
        sourceId: key,
        label: 'Przypisanie',
      });
    }
  }

  // 6) Zaplanowane godziny ---- (diff po id: upsert dodanych/zmienionych, remove usuniętych)
  {
    const prevMap = byId(prev.workload);
    const nextMap = byId(next.workload);
    for (const [id, w] of prevMap) {
      if (nextMap.has(id)) continue;
      if (!isUuid(id) || !isUuid(w.taskId) || !maps.people.get(w.personId)) continue; // nigdy nie zsynchronizowane
      ops.push({ kind: 'remove', table: 'workload_entries', match: { id }, sourceId: id, label: 'Blok godzin (usunięcie)' });
    }
    for (const w of next.workload) {
      const before = prevMap.get(w.id);
      if (before && JSON.stringify(before) === JSON.stringify(w)) continue;
      const row = workloadRow(w, maps, diagnostics);
      if (row) ops.push({ kind: 'upsert', table: 'workload_entries', row, sourceId: w.id, label: 'Blok godzin' });
    }
  }

  // 7) Komentarze ---- (append-only: tylko nowe id)
  {
    const prevIds = new Set(prev.comments.map((c) => c.id));
    for (const c of next.comments) {
      if (prevIds.has(c.id)) continue;
      const row = commentRow(c, maps, diagnostics);
      if (row) ops.push({ kind: 'upsert', table: 'comments', row, sourceId: c.id, label: 'Komentarz' });
    }
  }

  // 8) Dziennik aktywności ---- (append-only: tylko nowe id)
  {
    const prevIds = new Set(prev.activity.map((e) => e.id));
    for (const e of next.activity) {
      if (prevIds.has(e.id)) continue;
      const row = activityRow(e, maps, diagnostics);
      if (row) ops.push({ kind: 'upsert', table: 'activity_events', row, sourceId: e.id, label: 'Wpis dziennika' });
    }
  }

  // 8b) Zgłoszenia ---- (diff po id: NOWE => upsert, ISTNIEJĄCE => update,
  // remove usuniętych). Kolekcja addytywna i niezależna od reszty planera; RLS
  // przepuszcza wstawienie wyłącznie z własnym `reporter_id`, a zmianę
  // statusu/usunięcie — administratora. UPDATE (nie upsert) dla istniejących:
  // `INSERT ... ON CONFLICT` wymaga przejścia polityki INSERT (reporter_id =
  // auth.uid()) nawet gdy kończy się aktualizacją, więc upsert odrzucał każdą
  // zmianę statusu CUDZEGO zgłoszenia przez administratora.
  {
    const prevMap = byId(prev.tickets);
    const nextMap = byId(next.tickets);
    for (const id of prevMap.keys()) {
      if (!nextMap.has(id) && isUuid(id)) {
        ops.push({ kind: 'remove', table: 'tickets', match: { id }, sourceId: id, label: 'Zgłoszenie (usunięcie)' });
      }
    }
    for (const t of next.tickets) {
      const before = prevMap.get(t.id);
      if (before && JSON.stringify(before) === JSON.stringify(t)) continue;
      const row = ticketRow(t, maps, diagnostics);
      if (!row) continue;
      if (before) {
        const { id: _id, ...rest } = row;
        ops.push({ kind: 'update', table: 'tickets', match: { id: t.id }, row: rest, sourceId: t.id, label: `Zgłoszenie „${t.title}”` });
      } else {
        ops.push({ kind: 'upsert', table: 'tickets', row, sourceId: t.id, label: `Zgłoszenie „${t.title}”` });
      }
    }
  }

  // 8c) Wydarzenia kalendarza ---- (diff po id: upsert dodanych/zmienionych,
  // remove usuniętych). Kolekcja addytywna i czysto prezentacyjna; kalendarz
  // spotkań jest ogólnofirmowy (RLS `to authenticated`, using true).
  {
    const prevMap = byId(prev.events);
    const nextMap = byId(next.events);
    for (const id of prevMap.keys()) {
      if (!nextMap.has(id) && isUuid(id)) {
        ops.push({ kind: 'remove', table: 'events', match: { id }, sourceId: id, label: 'Wydarzenie (usunięcie)' });
      }
    }
    for (const e of next.events) {
      const before = prevMap.get(e.id);
      if (before && JSON.stringify(before) === JSON.stringify(e)) continue;
      const row = eventRow(e, maps, diagnostics);
      if (row) ops.push({ kind: 'upsert', table: 'events', row, sourceId: e.id, label: `Wydarzenie „${e.title}”` });
    }
  }

  // 8d) Powiadomienia in-app ---- WYŁĄCZNIE aktualizacja `read_at` (oznaczenie
  // jako przeczytane). Wstawienia generuje warstwa zdarzeń (notificationEvents)
  // w imieniu działającego użytkownika DLA innych odbiorców — nigdy nie
  // pojawiają się w tym diffie; własne powiadomienia przychodzą przez
  // MERGE_CLOUD_NOTIFICATIONS (stłumione w mirrorze). Usunięć klient nie robi.
  {
    const prevMap = byId(prev.notifications);
    for (const n of next.notifications) {
      const before = prevMap.get(n.id);
      if (!before || before.readAt === n.readAt) continue;
      if (!isUuid(n.id)) {
        diagnostics.push(DIAG.nonUuid);
        continue;
      }
      ops.push({
        kind: 'update',
        table: 'notifications',
        match: { id: n.id },
        row: { read_at: n.readAt === '' ? null : n.readAt },
        sourceId: n.id,
        label: 'Powiadomienie (odczyt)',
      });
    }
  }

  // 9) Słowniki organizacji ---- (statusy + działy + typy usług + kategorie
  // prac + stanowiska + spółki). Po autorytatywnej hydracji lokalne wiersze noszą id chmury, a nowe
  // dostają crypto.randomUUID — mutacje paneli admina płyną wprost do tabel
  // (RLS: zapis wyłącznie administrator; odrzut ląduje w `dropped` z polską
  // etykietą). Usunięcie propagujemy tylko dla id w formacie UUID.
  {
    const dicts: Array<{
      table: string;
      label: string;
      prevRows: Array<{ id: string; name: string }>;
      nextRows: Array<{ id: string; name: string }>;
      toRow: (r: never) => Record<string, unknown>;
    }> = [
      {
        table: 'statuses',
        label: 'Status',
        prevRows: prev.statuses,
        nextRows: next.statuses,
        toRow: ((s: Status) => ({
          id: s.id,
          name: s.name,
          slug: s.slug,
          color: s.color,
          sort_order: s.order,
          archived: s.archived,
          is_done: s.isDone,
        })) as (r: never) => Record<string, unknown>,
      },
      {
        table: 'departments',
        label: 'Dział',
        prevRows: prev.departments,
        nextRows: next.departments,
        toRow: ((d: { id: string; name: string }) => ({ id: d.id, name: d.name })) as (
          r: never,
        ) => Record<string, unknown>,
      },
      {
        table: 'service_types',
        label: 'Typ usługi',
        prevRows: prev.serviceTypes,
        nextRows: next.serviceTypes,
        toRow: ((d: { id: string; name: string }) => ({ id: d.id, name: d.name })) as (
          r: never,
        ) => Record<string, unknown>,
      },
      {
        table: 'work_categories',
        label: 'Kategoria prac',
        prevRows: prev.workCategories,
        nextRows: next.workCategories,
        toRow: ((d: { id: string; name: string }) => ({ id: d.id, name: d.name })) as (
          r: never,
        ) => Record<string, unknown>,
      },
      {
        table: 'job_titles',
        label: 'Stanowisko',
        prevRows: prev.jobTitles,
        nextRows: next.jobTitles,
        toRow: ((d: { id: string; name: string }) => ({ id: d.id, name: d.name })) as (
          r: never,
        ) => Record<string, unknown>,
      },
      {
        table: 'companies',
        label: 'Spółka',
        prevRows: prev.companies,
        nextRows: next.companies,
        toRow: ((d: { id: string; name: string }) => ({ id: d.id, name: d.name })) as (
          r: never,
        ) => Record<string, unknown>,
      },
    ];
    for (const dict of dicts) {
      const prevMap = byId(dict.prevRows);
      const nextMap = byId(dict.nextRows);
      for (const id of prevMap.keys()) {
        if (!nextMap.has(id) && isUuid(id)) {
          ops.push({
            kind: 'remove',
            table: dict.table,
            match: { id },
            sourceId: id,
            label: `${dict.label} (usunięcie)`,
          });
        }
      }
      for (const r of dict.nextRows) {
        const before = prevMap.get(r.id);
        if (before && JSON.stringify(before) === JSON.stringify(r)) continue;
        if (!isUuid(r.id)) {
          diagnostics.push(DIAG.nonUuid);
          continue;
        }
        ops.push({
          kind: 'upsert',
          table: dict.table,
          row: dict.toRow(r as never),
          sourceId: r.id,
          label: `${dict.label} „${r.name}”`,
        });
      }
    }
  }

  // 10) Osoby ---- (WYŁĄCZNIE aktualizacje istniejących profili chmury).
  // Konta tworzy provisioning (Zespół → Utwórz konto), a usuwa operator w
  // panelu Supabase — mirror nigdy nie robi insert/delete na profiles (FK do
  // auth.users). Edycja osoby bez konta chmury zostaje lokalna z diagnostyką;
  // RLS przepuszcza zapis własnego profilu i zapisy administratora.
  {
    const prevMap = byId(prev.people);
    for (const p of next.people) {
      const before = prevMap.get(p.id);
      if (before && JSON.stringify(before) === JSON.stringify(p)) continue;
      const profileId = maps.people.get(p.id) ?? (maps.cloudProfileIds.has(p.id) ? p.id : null);
      if (profileId === null) {
        // Osoba bez konta chmury (w tym świeżo dodana lokalnie): mirror nie
        // tworzy kont — provisioning jest jedyną drogą. Diagnoza, nie zapis.
        diagnostics.push(DIAG.unmappablePerson);
        continue;
      }
      const supervisorProfileId = p.supervisorId
        ? maps.people.get(p.supervisorId) ??
          (maps.cloudProfileIds.has(p.supervisorId) ? p.supervisorId : null)
        : null;
      // UPDATE, nie upsert: `INSERT ... ON CONFLICT` wymaga przejścia polityki
      // INSERT (profiles_insert_admin) nawet gdy kończy się aktualizacją, więc
      // upsert odrzucał każdą edycję własnego profilu przez nie-administratora.
      ops.push({
        kind: 'update',
        table: 'profiles',
        match: { id: profileId },
        row: {
          first_name: p.firstName,
          last_name: p.lastName,
          role_title: p.role,
          phone: p.phone,
          avatar: p.avatar,
          capacity: p.capacity,
          work_days: p.workDays,
          work_start_minutes: p.workStartMinutes,
          work_end_minutes: p.workEndMinutes,
          department_id: p.departmentId === '' ? null : p.departmentId,
          company_id: (p.companyId ?? '') === '' ? null : p.companyId,
          supervisor_id: supervisorProfileId,
          access_role: ACCESS_ROLE_TO_CLOUD[p.accessRole],
          birth_date: p.birthDate === '' ? null : p.birthDate,
          // Watermark „przeczytane": ISO albo NULL (brak = wszystko nieprzeczytane).
          notifications_seen_at: p.notificationsSeenAt ? p.notificationsSeenAt : null,
          // Przeczytane per wpis: kolumna jest `not null default '{}'`, więc brak
          // klucza lustruje się jako pusta tablica (nigdy NULL).
          notifications_read_ids: p.notificationsReadIds ?? [],
          email_notifications: p.emailNotifications ?? false,
        },
        sourceId: p.id,
        label: `Profil „${p.name}”`,
      });
    }
  }

  return { ops, diagnostics };
}

// ---- Content Plan (schemat `contentplan`) ------------------------------------
//
// Rodzina diff MODUŁU, świadomie ODDZIELNA od `diffToCloudOps`: tabele żyją w
// innym schemacie (migracja 20260803160000), więc ich operacje muszą pójść przez
// adapter `client.schema('contentplan')`. Każdy op niesie `schema`, dzięki czemu
// jedna kolejka lustra obsługuje obie rodziny bez mieszania schematów.
//
// GRANICE:
//   * Marka i publikacja o id spoza formatu UUID (marka utworzona lokalnie nosi
//     SLUG z `uniqueBrandId`) zostaje TYLKO w tej przeglądarce — kolumny `id` są
//     `uuid`. Publikacja wskazująca taką markę też odpada (FK), z diagnostyką.
//   * `comments`/`post_history` są DOPISYWALNE (brak grantu UPDATE/DELETE):
//     lustrujemy wyłącznie NOWE wiersze, kasowanie zostawiamy kaskadzie FK.
//   * Kanały, komentarze i historia usuniętej publikacji (oraz publikacje
//     usuniętej marki) NIE dostają własnych `remove` — sprząta je kaskada.
//   * Tagi: lokalny string <-> `text[]` przez `splitContentPlanTags`.

const CP_DIAG = {
  nonUuid: 'Wiersz Content Planu ma identyfikator spoza formatu UUID — zostaje tylko w tej przeglądarce.',
  unknownBrand: 'Publikacja wskazuje markę bez odpowiednika w chmurze — zostaje tylko w tej przeglądarce.',
} as const;

/** Znacznik czasu ISO do kolumny `timestamptz`: '' => klucz pomijany (kolumna ma
 *  default `now()`, a pusty string wywróciłby wstawienie na typie). */
function timestampColumn(column: string, value: string): Record<string, string> {
  return value === '' ? {} : { [column]: value };
}

function cpBrandRow(b: ContentPlanBrand): Record<string, unknown> {
  return {
    id: b.id,
    name: b.name,
    industry: b.industry,
    contact: b.contact,
    accent: b.accent,
    platforms: b.platforms,
    topics: b.topics,
    formats: b.formats,
    // `n2click_client_id` CELOWO pominięte: model lokalny go nie zna, a upsert
    // aktualizuje wyłącznie kolumny z ładunku — powiązanie ustawione w bazie
    // przeżywa każdy zapis marki. `updated_at` należy do triggera.
    ...timestampColumn('created_at', b.createdAt),
  };
}

function cpPostRow(p: ContentPlanPost): Record<string, unknown> {
  return {
    id: p.id,
    brand_id: p.brandId,
    date: p.date,
    title: p.title,
    topic: p.topic,
    format: p.format,
    status: p.status,
    visibility: p.visibility,
    base_tags: splitContentPlanTags(p.baseTags),
    design_brief: p.designBrief,
    ...timestampColumn('created_at', p.createdAt),
  };
}

function cpChannelRow(c: ContentPlanChannel, postId: string): Record<string, unknown> {
  const media = c.media;
  return {
    id: c.id,
    post_id: postId,
    platform_id: c.platformId,
    copy: c.copy,
    tags: splitContentPlanTags(c.tags),
    override_tags: c.overrideTags,
    // Forma kanoniczna kanału: brak klucza ≡ grupa główna => kolumna NULL.
    description_group_id: c.descriptionGroupId ?? null,
    // Media to WYŁĄCZNIE referencja do pliku Drive (nigdy base64): brak pliku =>
    // wszystkie kolumny NULL (CHECK wymaga źródła przy `media_file_id`).
    media_source: media ? media.source : null,
    media_file_id: media ? media.fileId : null,
    media_width: media?.width ?? null,
    media_height: media?.height ?? null,
    media_type: media ? media.type : null,
  };
}

function cpCommentRow(
  c: ContentPlanComment,
  postId: string,
  commentIds: Set<string>,
): Record<string, unknown> {
  // Rodzic spoza tej publikacji (albo o id spoza UUID) traci powiązanie zamiast
  // wywracać wstawienie na FK — komentarz wraca do wątku głównego, jak w repair.
  const parentId = c.parentId !== undefined && commentIds.has(c.parentId) ? c.parentId : null;
  return {
    id: c.id,
    post_id: postId,
    author: c.author,
    body: c.body,
    parent_id: parentId,
    ...timestampColumn('at', c.at),
  };
}

function cpHistoryRow(h: ContentPlanHistoryEntry, postId: string): Record<string, unknown> {
  return {
    id: h.id,
    post_id: postId,
    label: h.label,
    ...timestampColumn('at', h.at),
  };
}

interface CpRowEntry {
  row: Record<string, unknown>;
  label: string;
  /** Id rodzica (marka dla publikacji, publikacja dla wierszy zależnych) — do
   *  pominięcia `remove`, który i tak załatwia kaskada FK. */
  parentId: string;
}

interface CpRowSets {
  brands: Map<string, CpRowEntry>;
  posts: Map<string, CpRowEntry>;
  channels: Map<string, CpRowEntry>;
  comments: Map<string, CpRowEntry>;
  history: Map<string, CpRowEntry>;
}

/** Wiersze chmury dla stanu modułu. `diagnostics === null` dla stanu POPRZEDNIEGO
 *  (ten sam odrzut jest już opisany dla stanu następnego — bez dublowania not). */
function contentPlanRowSets(data: AppData, diagnostics: string[] | null): CpRowSets {
  const sets: CpRowSets = {
    brands: new Map(),
    posts: new Map(),
    channels: new Map(),
    comments: new Map(),
    history: new Map(),
  };
  for (const brand of data.contentPlanBrands) {
    if (!isUuid(brand.id)) {
      diagnostics?.push(CP_DIAG.nonUuid);
      continue;
    }
    sets.brands.set(brand.id, {
      row: cpBrandRow(brand),
      label: `Marka „${brand.name}”`,
      parentId: '',
    });
  }
  for (const post of data.contentPlanPosts) {
    if (!isUuid(post.id)) {
      diagnostics?.push(CP_DIAG.nonUuid);
      continue;
    }
    if (!sets.brands.has(post.brandId)) {
      diagnostics?.push(CP_DIAG.unknownBrand);
      continue;
    }
    sets.posts.set(post.id, {
      row: cpPostRow(post),
      label: `Publikacja „${post.title}”`,
      parentId: post.brandId,
    });
    for (const channel of post.channels) {
      if (!isUuid(channel.id)) {
        diagnostics?.push(CP_DIAG.nonUuid);
        continue;
      }
      sets.channels.set(channel.id, {
        row: cpChannelRow(channel, post.id),
        label: 'Kanał publikacji',
        parentId: post.id,
      });
    }
    const commentIds = new Set(post.comments.filter((c) => isUuid(c.id)).map((c) => c.id));
    for (const comment of post.comments) {
      if (!isUuid(comment.id)) {
        diagnostics?.push(CP_DIAG.nonUuid);
        continue;
      }
      sets.comments.set(comment.id, {
        row: cpCommentRow(comment, post.id, commentIds),
        label: 'Komentarz publikacji',
        parentId: post.id,
      });
    }
    for (const entry of post.history) {
      if (!isUuid(entry.id)) {
        diagnostics?.push(CP_DIAG.nonUuid);
        continue;
      }
      sets.history.set(entry.id, {
        row: cpHistoryRow(entry, post.id),
        label: 'Wpis historii publikacji',
        parentId: post.id,
      });
    }
  }
  return sets;
}

const sameCpRow = (a: Record<string, unknown>, b: Record<string, unknown>): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * Diff modułu Content Plan na operacje zapisu w kolejności zależności: marki ->
 * publikacje -> kanały -> komentarze -> historia. Marki/publikacje/kanały:
 * upsert dodanych i zmienionych, remove usuniętych (z pominięciem wierszy, które
 * sprząta kaskada FK). Komentarze i historia: DOPISYWALNE (tylko nowe id).
 * Odrzucona komenda (ta sama referencja stanu) nie daje różnicy, więc zero
 * operacji — inwariant 6 jak w `diffToCloudOps`.
 */
export function diffContentPlanToCloudOps(prev: AppData, next: AppData): DiffResult {
  const diagnostics: string[] = [];
  const before = contentPlanRowSets(prev, null);
  const after = contentPlanRowSets(next, diagnostics);
  const ops: CloudOp[] = [];

  const push = (op: Omit<CloudOp, 'schema'>): void => {
    ops.push({ ...op, schema: CONTENT_PLAN_SCHEMA });
  };

  // 1) Marki ----
  for (const id of before.brands.keys()) {
    if (after.brands.has(id)) continue;
    push({ kind: 'remove', table: 'brands', match: { id }, sourceId: id, label: 'Marka (usunięcie)' });
  }
  for (const [id, entry] of after.brands) {
    const previous = before.brands.get(id);
    if (previous && sameCpRow(previous.row, entry.row)) continue;
    push({ kind: 'upsert', table: 'brands', row: entry.row, sourceId: id, label: entry.label });
  }

  // 2) Publikacje ---- (remove pomijamy, gdy zniknęła cała marka — kaskada)
  for (const [id, entry] of before.posts) {
    if (after.posts.has(id) || !after.brands.has(entry.parentId)) continue;
    push({ kind: 'remove', table: 'posts', match: { id }, sourceId: id, label: 'Publikacja (usunięcie)' });
  }
  for (const [id, entry] of after.posts) {
    const previous = before.posts.get(id);
    if (previous && sameCpRow(previous.row, entry.row)) continue;
    push({ kind: 'upsert', table: 'posts', row: entry.row, sourceId: id, label: entry.label });
  }

  // 3) Kanały ---- (remove tylko dla ŻYJĄCEJ publikacji — reszta idzie kaskadą)
  for (const [id, entry] of before.channels) {
    if (after.channels.has(id) || !after.posts.has(entry.parentId)) continue;
    push({
      kind: 'remove',
      table: 'post_channels',
      match: { id },
      sourceId: id,
      label: 'Kanał publikacji (usunięcie)',
    });
  }
  for (const [id, entry] of after.channels) {
    const previous = before.channels.get(id);
    if (previous && sameCpRow(previous.row, entry.row)) continue;
    push({ kind: 'upsert', table: 'post_channels', row: entry.row, sourceId: id, label: entry.label });
  }

  // 4) Komentarze i 5) historia ---- (append-only: wyłącznie nowe id;
  // `ignoreDuplicates`, bo rola kliencka ma na tych tabelach TYLKO INSERT)
  for (const [id, entry] of after.comments) {
    if (before.comments.has(id)) continue;
    push({
      kind: 'upsert',
      table: 'comments',
      row: entry.row,
      ignoreDuplicates: true,
      sourceId: id,
      label: entry.label,
    });
  }
  for (const [id, entry] of after.history) {
    if (before.history.has(id)) continue;
    push({
      kind: 'upsert',
      table: 'post_history',
      row: entry.row,
      ignoreDuplicates: true,
      sourceId: id,
      label: entry.label,
    });
  }

  return { ops, diagnostics };
}

// ---- Wykonanie operacji ------------------------------------------------------

export interface ApplyOpsResult {
  done: number;
  dropped: Array<{ label: string; message: string }>;
  remaining: CloudOp[];
  error: string | null;
  /**
   * Przerwane przez `shouldAbort` (tranzycja sesji W TRAKCIE wsadu): pozostałe
   * operacje NIE zostały wysłane i nie wolno ich requeue'ować — należały do
   * poprzedniej sesji. Konsument kończy bez zapisu i bez błędu.
   */
  aborted?: true;
}

/**
 * Wykonuje operacje sekwencyjnie. Na błędzie 'transient' ZATRZYMUJE się i zwraca
 * pozostałą kolejkę (do ponowienia) z komunikatem SYNC_ERROR_MSG; na błędzie
 * 'permission' PORZUCA operację (notatka), zapisuje i kontynuuje. Nigdy nie rzuca.
 *
 * WYJĄTEK — zapisy powiadomień (`table === 'notifications'`) są BEST-EFFORT:
 * powiadomienia dublują sygnał, który już żyje w in-app, a tabela bywa jeszcze
 * niezaaplikowana (migracja) → brak tabeli/kolumny (42P01/PGRST205/PGRST204)
 * albo dowolny inny błąd PORZUCA op po cichu (log tylko w DEV) i KONTYNUUJE.
 * Taki drop NIGDY nie zatrzymuje syncu innych encji (transient by zamroził całą
 * kolejkę na czele) ani nie trafia do `dropped` (żadnego banera dla użytkownika).
 *
 * SCHEMATY: op z `schema` (Content Plan) idzie do adaptera z `schemaDbs`. Brak
 * adaptera => cichy drop (NIGDY zapis do domyślnego schematu). Brak schematu lub
 * tabeli po stronie serwera (migracja niezaaplikowana, schemat niewystawiony w
 * Data API) też jest cichym dropem: jako 'transient' JEDEN taki op zamroziłby
 * całą kolejkę planera na czele.
 */
export async function applyCloudOps(
  db: PlannerDb,
  ops: CloudOp[],
  schemaDbs?: Record<string, PlannerDb>,
  opts?: {
    /**
     * Sprawdzane PRZED KAŻDĄ operacją (nie tylko po całym wsadzie): operacje
     * idą sekwencyjnie po singletonie klienta, którego sesja auth może się
     * zmienić pod spodem — po tranzycji konta dalsza wysyłka wykonywałaby
     * operacje poprzedniej sesji tokenem nowej. `true` => natychmiastowy stop
     * z `aborted`.
     */
    shouldAbort?: () => boolean;
  },
): Promise<ApplyOpsResult> {
  let done = 0;
  const dropped: Array<{ label: string; message: string }> = [];
  for (let i = 0; i < ops.length; i++) {
    if (opts?.shouldAbort?.() === true) {
      return { done, dropped, remaining: ops.slice(i), error: null, aborted: true };
    }
    const op = ops[i];
    // TWARDA STRAŻ: update/remove bez filtra to operacja na CAŁEJ tabeli w
    // zasięgu RLS wywołującego (dla admina — wszystko). Żaden legalny diff
    // lustra nie produkuje pustego `match`; taki op może przyjść wyłącznie z
    // błędu albo ze zmanipulowanego trwałego outboxu (localStorage jest
    // modyfikowalny) — odrzucamy zamiast wykonywać, nigdy nie wysyłamy.
    if (op.kind !== 'upsert' && Object.keys(op.match ?? {}).length === 0) {
      dropped.push({
        label: op.label,
        message: 'Operacja bez filtra odrzucona (ochrona przed masową zmianą danych).',
      });
      continue;
    }
    const target = op.schema === undefined ? db : schemaDbs?.[op.schema];
    if (target === undefined) {
      if (import.meta.env.DEV) {
        console.debug('[cloud] Pominięto zapis bez adaptera schematu:', op.schema, op.label);
      }
      continue;
    }
    const res =
      op.kind === 'upsert'
        ? await target.upsert(op.table, op.row ?? {}, op.onConflict, op.ignoreDuplicates)
        : op.kind === 'update'
          ? await target.update(op.table, op.row ?? {}, op.match ?? {})
          : await target.remove(op.table, op.match ?? {});
    if (res.error) {
      if (op.table === 'notifications') {
        // Best-effort: cichy drop (dowolny błąd), bez zatrzymania i bez banera.
        if (import.meta.env.DEV) {
          console.debug('[cloud] Pominięto zapis powiadomienia (best-effort):', op.label, res.error.message);
        }
        continue;
      }
      if (op.schema !== undefined && isMissingCloudTable(res.error.message)) {
        if (import.meta.env.DEV) {
          console.debug('[cloud] Pominięto zapis — brak schematu/tabeli:', op.schema, op.table);
        }
        continue;
      }
      if (res.error.kind === 'transient') {
        return { done, dropped, remaining: ops.slice(i), error: SYNC_ERROR_MSG };
      }
      dropped.push({ label: op.label, message: res.error.message });
      continue;
    }
    done++;
  }
  return { done, dropped, remaining: [], error: null };
}
