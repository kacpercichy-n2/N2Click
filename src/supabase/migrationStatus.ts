// Czysta logika stanu migracji do chmury: raport pokrycia (per rodzina: ile
// lokalnie vs ile da się zsynchronizować) oraz handshake wycofania zapisów
// lokalnych. Cały dostęp do bazy idzie przez wstrzyknięty `PlannerDb` — bez SDK,
// bez żywego Supabase w vitest, bez jsdom. Komponent (MigrationStatusPanel) jest
// cienki; każda decyzja żyje tutaj i jest testowana w node.
import type { AppData } from '../types';
import type { CloudIdMaps } from './cloudMirror';
import {
  loadPlannerSnapshot,
  writeRetirementSetting,
  type PlannerDb,
} from './plannerData';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (id: string): boolean => UUID_RE.test(id);

const REASON = {
  nonUuid: 'Identyfikator nie jest w formacie UUID.',
  status: 'Status nie istnieje po stronie serwera.',
  dict: 'Słownik (typ usługi / kategoria prac) nie istnieje po stronie serwera.',
  person: 'Osoba nie ma konta serwera.',
} as const;

// ---- Raport pokrycia ---------------------------------------------------------

export interface CoverageFamily {
  key: string;
  label: string; // polska etykieta rodziny
  local: number; // liczba wierszy lokalnie
  syncable: number; // ile da się zsynchronizować
  unsyncable: number; // ile utknie lokalnie
  reasons: string[]; // wyróżnione polskie powody dla wierszy nie-do-synchronizacji
}

export interface CoverageReport {
  families: CoverageFamily[];
  clean: boolean; // brak jakichkolwiek wierszy poza synchronizacją
}

/** '' (brak referencji) jest OK; inaczej wymagane trafienie w mapie. */
function dictResolvable(value: string, map: Map<string, string>): boolean {
  return value === '' || map.has(value);
}

/**
 * Buduje raport pokrycia per rodzina planera. Wiersz jest „poza synchronizacją”,
 * gdy niesie nie-UUID id albo referencję niemapowalną po stronie serwera (osoba
 * bez konta, status/słownik spoza chmury). Wycofanie zapisów lokalnych z
 * jakimkolwiek takim wierszem osierociłoby pracę lokalną — handshake to blokuje.
 */
export function buildCoverageReport(state: AppData, maps: CloudIdMaps): CoverageReport {
  const families: CoverageFamily[] = [];

  const family = (
    key: string,
    label: string,
    items: unknown[],
    reasonsOf: (item: never) => string[],
  ): void => {
    const reasons = new Set<string>();
    let syncable = 0;
    for (const item of items) {
      const rs = reasonsOf(item as never);
      if (rs.length === 0) syncable++;
      else rs.forEach((r) => reasons.add(r));
    }
    families.push({
      key,
      label,
      local: items.length,
      syncable,
      unsyncable: items.length - syncable,
      reasons: [...reasons],
    });
  };

  family('clients', 'Klienci', state.clients, (c: { id: string }) =>
    isUuid(c.id) ? [] : [REASON.nonUuid],
  );
  family('projects', 'Projekty', state.projects, (p: {
    id: string;
    statusId: string;
    serviceTypeId: string;
  }) => {
    const rs: string[] = [];
    if (!isUuid(p.id)) rs.push(REASON.nonUuid);
    if (!dictResolvable(p.statusId, maps.statuses)) rs.push(REASON.status);
    if (!dictResolvable(p.serviceTypeId, maps.serviceTypes)) rs.push(REASON.dict);
    return rs;
  });
  family('milestones', 'Kamienie milowe', state.milestones, (m: {
    id: string;
    projectId: string;
  }) => (isUuid(m.id) && isUuid(m.projectId) ? [] : [REASON.nonUuid]));
  family('tasks', 'Zadania', state.tasks, (t: {
    id: string;
    projectId: string;
    statusId: string;
    workCategoryId: string;
  }) => {
    const rs: string[] = [];
    if (!isUuid(t.id) || !isUuid(t.projectId)) rs.push(REASON.nonUuid);
    if (!dictResolvable(t.statusId, maps.statuses)) rs.push(REASON.status);
    if (!dictResolvable(t.workCategoryId, maps.workCategories)) rs.push(REASON.dict);
    return rs;
  });
  family('assignments', 'Przypisania', state.assignments, (a: {
    taskId: string;
    personId: string;
  }) => {
    const rs: string[] = [];
    if (!isUuid(a.taskId)) rs.push(REASON.nonUuid);
    if (!maps.people.get(a.personId)) rs.push(REASON.person);
    return rs;
  });
  family('workload', 'Bloki godzin', state.workload, (w: {
    id: string;
    taskId: string;
    personId: string;
  }) => {
    const rs: string[] = [];
    if (!isUuid(w.id) || !isUuid(w.taskId)) rs.push(REASON.nonUuid);
    if (!maps.people.get(w.personId)) rs.push(REASON.person);
    return rs;
  });
  family('comments', 'Komentarze', state.comments, (c: {
    id: string;
    entityId: string;
    authorId: string;
  }) => {
    const rs: string[] = [];
    if (!isUuid(c.id) || !isUuid(c.entityId)) rs.push(REASON.nonUuid);
    if (c.authorId !== '' && !maps.people.get(c.authorId)) rs.push(REASON.person);
    return rs;
  });
  family('activity', 'Aktywność', state.activity, (e: { id: string; actorId: string }) => {
    const rs: string[] = [];
    if (!isUuid(e.id)) rs.push(REASON.nonUuid);
    if (e.actorId !== '' && !maps.people.get(e.actorId)) rs.push(REASON.person);
    return rs;
  });

  return { families, clean: families.every((f) => f.unsyncable === 0) };
}

// ---- Handshake wycofania -----------------------------------------------------

export interface HandshakeStep {
  label: string; // polska etykieta kroku
  ok: boolean;
  detail: string; // polski szczegół wyniku
}

export interface HandshakeResult {
  ok: boolean; // true tylko gdy WSZYSTKIE kroki się powiodły i flaga została ustawiona
  steps: HandshakeStep[];
}

export interface HandshakeProbe {
  rowId: string; // syntetyczny id wiersza zasobnika (caller-supplied)
  taskId: string; // istniejące zadanie w chmurze (FK workload_entries.task_id)
  profileId: string; // profil administratora (auth.uid())
}

const STEP = {
  coverage: 'Pokrycie danych',
  read: 'Odczyt z chmury',
  write: 'Zapis próbny do chmury',
  arm: 'Włączenie wycofania',
} as const;

/**
 * Wykonuje i raportuje kroki handshake'u wycofania (po polsku). Pierwszy nieudany
 * krok kończy sekwencję. Kroki:
 * 1. Pokrycie: żaden wiersz nie może być „poza synchronizacją”.
 * 2. Odczyt: świeży `loadPlannerSnapshot` musi się powieść (diagnostyki snapshotu
 *    to ostrzeżenia, nie blokery).
 * 3. Zapis próbny: upsert syntetycznego wiersza zasobnika (0,25h) → select →
 *    remove; usunięcie próbowane niezależnie od wyniku selectu.
 * 4. Dopiero wtedy ustawia flagę `local_writes_retired` na serwerze. Cache
 *    lokalny zapisuje wołający (komponent), po sukcesie.
 */
export async function runRetirementHandshake(
  db: PlannerDb,
  state: AppData,
  maps: CloudIdMaps,
  probe: HandshakeProbe,
): Promise<HandshakeResult> {
  const steps: HandshakeStep[] = [];

  // 1) Pokrycie ----
  const coverage = buildCoverageReport(state, maps);
  if (!coverage.clean) {
    const offenders = coverage.families.filter((f) => f.unsyncable > 0);
    steps.push({
      label: STEP.coverage,
      ok: false,
      detail:
        'Nie można wycofać — wiersze bez odpowiednika w chmurze: ' +
        offenders
          .map((f) => `${f.label} (${f.unsyncable}): ${f.reasons.join(' ')}`)
          .join('; '),
    });
    return { ok: false, steps };
  }
  steps.push({ label: STEP.coverage, ok: true, detail: 'Wszystkie dane da się zsynchronizować.' });

  // 2) Odczyt ----
  const snapshot = await loadPlannerSnapshot(db, maps, state);
  if (!snapshot.ok) {
    steps.push({ label: STEP.read, ok: false, detail: snapshot.error });
    return { ok: false, steps };
  }
  steps.push({
    label: STEP.read,
    ok: true,
    detail:
      snapshot.diagnostics.length === 0
        ? 'Odczyt danych z serwera powiódł się.'
        : `Odczyt powiódł się z ostrzeżeniami (${snapshot.diagnostics.length}): ${snapshot.diagnostics.join(' ')}`,
  });

  // 3) Zapis próbny (upsert → select → remove) ----
  if (!isUuid(probe.taskId) || !isUuid(probe.profileId) || !isUuid(probe.rowId)) {
    steps.push({
      label: STEP.write,
      ok: false,
      detail: 'Brak poprawnego zadania lub profilu do próbnego zapisu.',
    });
    return { ok: false, steps };
  }
  const probeRow = {
    id: probe.rowId,
    task_id: probe.taskId,
    profile_id: probe.profileId,
    work_date: null,
    planned_hours: 0.25,
    start_minutes: 0,
    sort_index: 0,
  };
  const upsertRes = await db.upsert('workload_entries', probeRow, 'id');
  if (upsertRes.error) {
    await db.remove('workload_entries', { id: probe.rowId });
    steps.push({ label: STEP.write, ok: false, detail: upsertRes.error.message });
    return { ok: false, steps };
  }
  const selectRes = await db.select('workload_entries', 'id', {
    column: 'id',
    values: [probe.rowId],
  });
  const removeRes = await db.remove('workload_entries', { id: probe.rowId });
  if (selectRes.error || selectRes.rows.length === 0) {
    steps.push({
      label: STEP.write,
      ok: false,
      detail: selectRes.error ?? 'Nie udało się odczytać wiersza próbnego z serwera.',
    });
    return { ok: false, steps };
  }
  if (removeRes.error) {
    steps.push({ label: STEP.write, ok: false, detail: removeRes.error.message });
    return { ok: false, steps };
  }
  steps.push({ label: STEP.write, ok: true, detail: 'Zapis, odczyt i usunięcie próbne powiodły się.' });

  // 4) Włączenie flagi ----
  const armRes = await writeRetirementSetting(db, true, probe.profileId);
  if (armRes.error) {
    steps.push({ label: STEP.arm, ok: false, detail: armRes.error.message });
    return { ok: false, steps };
  }
  steps.push({
    label: STEP.arm,
    ok: true,
    detail: 'Zapisy lokalne wyłączone — dane są w chmurze.',
  });
  return { ok: true, steps };
}
