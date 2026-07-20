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
  Client,
  Comment,
  Milestone,
  Project,
  Status,
  Task,
  WorkloadEntry,
} from '../types';
import { normalizeEmail } from '../auth/profile';
import type { OrgSnapshot } from './referenceData';
import type { PlannerDb } from './plannerData';

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
  administrator: 'administrator',
  pm: 'manager',
  handlowiec: 'worker',
  pracownik: 'worker',
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
  sourceId: string; // lokalny id / klucz pary — do debugowania i suppresji
  label: string; // polska etykieta do bannera
};

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
    created_at: t.createdAt,
    updated_at: t.updatedAt,
  };
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

  // 9) Słowniki organizacji ---- (statusy + działy + typy usług + kategorie
  // prac). Po autorytatywnej hydracji lokalne wiersze noszą id chmury, a nowe
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
          supervisor_id: supervisorProfileId,
          access_role: ACCESS_ROLE_TO_CLOUD[p.accessRole],
        },
        sourceId: p.id,
        label: `Profil „${p.name}”`,
      });
    }
  }

  return { ops, diagnostics };
}

// ---- Wykonanie operacji ------------------------------------------------------

export interface ApplyOpsResult {
  done: number;
  dropped: Array<{ label: string; message: string }>;
  remaining: CloudOp[];
  error: string | null;
}

/**
 * Wykonuje operacje sekwencyjnie. Na błędzie 'transient' ZATRZYMUJE się i zwraca
 * pozostałą kolejkę (do ponowienia) z komunikatem SYNC_ERROR_MSG; na błędzie
 * 'permission' PORZUCA operację (notatka), zapisuje i kontynuuje. Nigdy nie rzuca.
 */
export async function applyCloudOps(db: PlannerDb, ops: CloudOp[]): Promise<ApplyOpsResult> {
  let done = 0;
  const dropped: Array<{ label: string; message: string }> = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    const res =
      op.kind === 'upsert'
        ? await db.upsert(op.table, op.row ?? {}, op.onConflict)
        : op.kind === 'update'
          ? await db.update(op.table, op.row ?? {}, op.match ?? {})
          : await db.remove(op.table, op.match ?? {});
    if (res.error) {
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
