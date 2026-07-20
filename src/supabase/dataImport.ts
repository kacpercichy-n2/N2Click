// Guarded, idempotent, admin-only IMPORT of the peeked localStorage snapshot
// into Supabase. This is the first write path from the app into Supabase.
//
// GRANICE / INVARIANTS:
//   * This module NEVER touches localStorage (src/store/storage.ts stays the only
//     localStorage boundary): planner data arrives exclusively via the already
//     peeked AppData passed by the caller. Nothing local is ever written/deleted.
//   * Insert-only, select-before-insert. No upsert/update/delete exists here, so
//     an already-present row can never be overwritten — a rerun (after success or
//     partial failure) simply skips everything present and finishes the rest.
//   * People are MAPPED, never created: profiles.id FKs auth.users and the browser
//     client cannot create auth users (only the provision-account Edge Function
//     can). Unmatched people and their dependents become actionable diagnostics.
//   * Client-side gating (evaluateImportGate) is UX only; RLS is the real boundary.
// All DB access hides behind the injected ImportDb (fake in tests, thin Supabase
// adapter in the app) — no SDK mocking, no live Supabase in vitest.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppData, Person } from '../types';
import type { DryRunReport } from '../store/exportDryRun';
import { normalizeEmail } from '../auth/profile';

// ---- Injected DB boundary ---------------------------------------------------

export interface ImportDb {
  /** SELECT columns FROM table [WHERE inFilter.column IN (inFilter.values)]. */
  select(
    table: string,
    columns: string,
    inFilter?: { column: string; values: string[] },
  ): Promise<{ rows: Array<Record<string, unknown>>; error: string | null }>;
  /** INSERT one row; resolves { error: null } on success. Never throws. */
  insert(
    table: string,
    row: Record<string, unknown>,
  ): Promise<{ error: string | null }>;
}

/**
 * Trivially thin adapter over the Supabase client. Maps any thrown or returned
 * SDK error to `error: string`. Raw SDK messages may pass through to diagnostics
 * (technical, not secrets) — but tokens are never logged here.
 */
export function createSupabaseImportDb(client: SupabaseClient): ImportDb {
  return {
    async select(table, columns, inFilter) {
      try {
        const base = client.from(table).select(columns);
        const query = inFilter ? base.in(inFilter.column, inFilter.values) : base;
        const { data, error } = await query;
        if (error) return { rows: [], error: error.message ?? 'Błąd zapytania.' };
        return { rows: (data ?? []) as unknown as Array<Record<string, unknown>>, error: null };
      } catch (e) {
        return { rows: [], error: e instanceof Error ? e.message : String(e) };
      }
    },
    async insert(table, row) {
      try {
        const { error } = await client.from(table).insert(row);
        if (error) return { error: error.message ?? 'Błąd zapisu.' };
        return { error: null };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  };
}

// ---- Gate -------------------------------------------------------------------

export const IMPORT_CONFIRMATION_WORD = 'IMPORTUJ';

export interface ImportGateInput {
  isAdmin: boolean; // isAdminUser(state) from the page
  authMode: 'local' | 'supabase'; // useAuth().mode
  signedIn: boolean; // useAuth().state.status === 'signedIn'
  report: DryRunReport | null; // last dry-run rendered in the panel
  confirmationText: string; // raw input value
}

export type ImportGateResult =
  | { allowed: true }
  | { allowed: false; reason: string }; // Polish, user-visible

const GATE_REASONS = {
  admin: 'Import może uruchomić wyłącznie administrator.',
  mode: 'Import wymaga trybu Supabase.',
  session: 'Zaloguj się do Supabase, aby importować dane.',
  report: 'Najpierw uruchom symulację migracji.',
  blockers: 'Symulacja wykryła blokery — usuń je i uruchom symulację ponownie.',
  confirmation: 'Przepisz słowo IMPORTUJ, aby potwierdzić.',
} as const;

/**
 * Pure administrator gate — first failing check wins, in order:
 * admin → supabase mode → signed in → report exists → zero blockers →
 * confirmation equals IMPORTUJ (trimmed, case-sensitive).
 */
export function evaluateImportGate(input: ImportGateInput): ImportGateResult {
  if (!input.isAdmin) return { allowed: false, reason: GATE_REASONS.admin };
  if (input.authMode !== 'supabase') return { allowed: false, reason: GATE_REASONS.mode };
  if (!input.signedIn) return { allowed: false, reason: GATE_REASONS.session };
  if (!input.report) return { allowed: false, reason: GATE_REASONS.report };
  if (input.report.blockers.length > 0) return { allowed: false, reason: GATE_REASONS.blockers };
  if (input.confirmationText.trim() !== IMPORT_CONFIRMATION_WORD) {
    return { allowed: false, reason: GATE_REASONS.confirmation };
  }
  return { allowed: true };
}

// ---- Runner -----------------------------------------------------------------

export interface ImportCollectionSummary {
  collection: string; // target table or 'people' / unsupported collection key
  label: string; // Polish label
  imported: number;
  skipped: number; // already present / mapped / no target table
  failed: number;
}

export interface ImportDiagnostic {
  collection: string;
  entityId: string; // offending source id or pair key `${a}|${b}`
  message: string; // Polish, actionable
}

export interface ImportRunResult {
  completed: boolean; // false = refused before any write
  refusedReason?: string; // Polish, set only when completed === false
  summary: ImportCollectionSummary[];
  diagnostics: ImportDiagnostic[];
}

const REFUSAL_BLOCKERS = 'Import przerwany: raport symulacji zawiera blokery.';

const DIAG = {
  emptyEmail: 'Osoba nie ma adresu e-mail — uzupełnij go i załóż konto, aby powiązać dane.',
  duplicateEmail: 'Zduplikowany adres e-mail — dane tej osoby pomiń lub popraw adres.',
  projectNotImported:
    'Projekt zadania nie został zaimportowany — popraw błąd projektu i uruchom import ponownie.',
  nonUuid: 'Identyfikator nie jest w formacie UUID — rekord wymaga ręcznej migracji.',
  deptFallback: 'Dział projektu nie został zaimportowany — projekt zapisano bez działu.',
  parentNotImported:
    'Projekt/zadanie komentarza nie zostało zaimportowane — popraw błąd encji i uruchom import ponownie.',
  noTargetTable: 'Brak tabeli docelowej w Supabase — dane pozostają tylko w tej przeglądarce.',
} as const;

const missingAccount = (email: string): string =>
  `Brak konta Supabase dla adresu e-mail „${email}” — załóż konto w zakładce Zespół ` +
  '(Zakładanie konta) i uruchom import ponownie.';

const insertFailure = (error: string): string => `Zapis nie powiódł się: ${error}`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (id: string): boolean => UUID_RE.test(id);

function chunk<T>(items: T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function emptySummary(collection: string, label: string): ImportCollectionSummary {
  return { collection, label, imported: 0, skipped: 0, failed: 0 };
}

// Collections with no target table in the current schema: reported as skipped,
// never silently dropped. Reference dictionaries (statuses/service_types/
// work_categories) now HAVE target tables and are imported below.
const UNSUPPORTED: Array<[keyof AppData, string, string]> = [
  ['savedFilters', 'savedFilters', 'Zapisane filtry'],
];

/**
 * Insert the peeked AppData into Supabase in dependency-safe order
 * (departments → profiles-mapping → projects → tasks → project_members →
 * task_assignments). Never throws — every db error becomes a failed count plus a
 * diagnostic. Defense in depth: refuses immediately (no db call) if the report
 * still carries blockers. Performs NO role gating (that is evaluateImportGate +
 * RLS) and never creates/updates profiles or any existing row.
 */
export async function runSupabaseImport(
  data: AppData,
  report: DryRunReport,
  db: ImportDb,
): Promise<ImportRunResult> {
  if (report.blockers.length > 0) {
    return { completed: false, refusedReason: REFUSAL_BLOCKERS, summary: [], diagnostics: [] };
  }

  const summary: ImportCollectionSummary[] = [];
  const diagnostics: ImportDiagnostic[] = [];
  const personById = new Map<string, Person>(data.people.map((p) => [p.id, p]));

  // 0) REFERENCE DICTIONARIES (dependency-free — imported before departments) ---
  // Insert-only, select-before-insert; mirrors the departments strategy: skip by
  // id, skip by a semantic key (statuses: trimmed slug; the rest: trimmed name),
  // non-UUID local id => diagnostic, otherwise insert with the explicit local id.
  // Each returns a local-id -> cloud-id map so projects/tasks can resolve their
  // dictionary references (id-or-key), even when a name/slug match reused an
  // EXISTING cloud row with a different id.
  const statusesImport = await importReferenceCollection(db, {
    collection: 'statuses',
    label: 'Statusy',
    table: 'statuses',
    items: data.statuses,
    columns: 'id, slug',
    semanticKeyColumn: 'slug',
    semanticKeyOf: (s) => s.slug.trim(),
    rowOf: (s) => ({
      id: s.id,
      name: s.name,
      slug: s.slug,
      color: s.color,
      sort_order: s.order,
      archived: s.archived,
      is_done: s.isDone,
    }),
    diagnostics,
  });
  summary.push(statusesImport.summary);
  const statusMap = statusesImport.idMap;

  const serviceTypesImport = await importReferenceCollection(db, {
    collection: 'service_types',
    label: 'Typy usług',
    table: 'service_types',
    items: data.serviceTypes,
    columns: 'id, name',
    semanticKeyColumn: 'name',
    semanticKeyOf: (s) => s.name.trim(),
    rowOf: (s) => ({ id: s.id, name: s.name }),
    diagnostics,
  });
  summary.push(serviceTypesImport.summary);
  const serviceTypeMap = serviceTypesImport.idMap;

  const workCategoriesImport = await importReferenceCollection(db, {
    collection: 'work_categories',
    label: 'Kategorie prac',
    table: 'work_categories',
    items: data.workCategories,
    columns: 'id, name',
    semanticKeyColumn: 'name',
    semanticKeyOf: (c) => c.name.trim(),
    rowOf: (c) => ({ id: c.id, name: c.name }),
    diagnostics,
  });
  summary.push(workCategoriesImport.summary);
  const workCategoryMap = workCategoriesImport.idMap;

  // Clients (dependency for projects; skip-by-id only — a local client name is
  // not unique, so we never fold two distinct clients by name).
  const clientsImport = await importReferenceCollection(db, {
    collection: 'clients',
    label: 'Klienci',
    table: 'clients',
    items: data.clients,
    columns: 'id',
    semanticKeyColumn: 'id',
    semanticKeyOf: () => '',
    rowOf: (c) => ({ id: c.id, name: c.name, archived: c.archived }),
    diagnostics,
  });
  summary.push(clientsImport.summary);
  const clientMap = clientsImport.idMap;

  const dictRef = (map: Map<string, string>, localId: string): string | null =>
    localId === '' ? null : map.get(localId) ?? null;

  // Message for a person who could not be mapped to a Supabase profile.
  const personMessage = (personId: string): string => {
    const p = personById.get(personId);
    if (!p) return missingAccount('');
    return normalizeEmail(p.email) === '' ? DIAG.emptyEmail : missingAccount(p.email);
  };

  // 1) DEPARTMENTS ------------------------------------------------------------
  const deptSummary = emptySummary('departments', 'Działy');
  const deptIdMap = new Map<string, string>();
  const existingDepts = await db.select('departments', 'id, name');
  if (existingDepts.error) {
    for (const d of data.departments) {
      deptSummary.failed++;
      diagnostics.push({ collection: 'departments', entityId: d.id, message: insertFailure(existingDepts.error) });
    }
  } else {
    const byName = new Map<string, string>();
    const knownIds = new Set<string>();
    for (const row of existingDepts.rows) {
      const id = String(row.id);
      knownIds.add(id);
      const name = typeof row.name === 'string' ? row.name.trim() : '';
      if (name && !byName.has(name)) byName.set(name, id);
    }
    for (const d of data.departments) {
      if (knownIds.has(d.id)) {
        deptIdMap.set(d.id, d.id);
        deptSummary.skipped++;
        continue;
      }
      const trimmed = d.name.trim();
      const nameMatch = byName.get(trimmed);
      if (nameMatch) {
        deptIdMap.set(d.id, nameMatch);
        deptSummary.skipped++;
        continue;
      }
      if (!isUuid(d.id)) {
        deptSummary.failed++;
        diagnostics.push({ collection: 'departments', entityId: d.id, message: DIAG.nonUuid });
        continue;
      }
      const ins = await db.insert('departments', { id: d.id, name: d.name });
      if (ins.error) {
        deptSummary.failed++;
        diagnostics.push({ collection: 'departments', entityId: d.id, message: insertFailure(ins.error) });
        continue;
      }
      deptIdMap.set(d.id, d.id);
      knownIds.add(d.id);
      if (trimmed) byName.set(trimmed, d.id);
      deptSummary.imported++;
    }
  }
  summary.push(deptSummary);

  // 2) PEOPLE (mapping only — never insert) -----------------------------------
  const peopleSummary = emptySummary('people', 'Osoby');
  const personIdMap = new Map<string, string>();
  const existingProfiles = await db.select('profiles', 'id, email');
  if (existingProfiles.error) {
    for (const p of data.people) {
      peopleSummary.failed++;
      diagnostics.push({ collection: 'people', entityId: p.id, message: insertFailure(existingProfiles.error) });
    }
  } else {
    const profileByEmail = new Map<string, string>();
    for (const row of existingProfiles.rows) {
      const email = normalizeEmail(typeof row.email === 'string' ? row.email : '');
      if (email && !profileByEmail.has(email)) profileByEmail.set(email, String(row.id));
    }
    const seenLocalEmails = new Set<string>();
    for (const p of data.people) {
      const email = normalizeEmail(p.email);
      if (!email) {
        peopleSummary.failed++;
        diagnostics.push({ collection: 'people', entityId: p.id, message: DIAG.emptyEmail });
        continue;
      }
      if (seenLocalEmails.has(email)) {
        peopleSummary.failed++;
        diagnostics.push({ collection: 'people', entityId: p.id, message: DIAG.duplicateEmail });
        continue;
      }
      seenLocalEmails.add(email);
      const profileId = profileByEmail.get(email);
      if (!profileId) {
        peopleSummary.failed++;
        diagnostics.push({ collection: 'people', entityId: p.id, message: missingAccount(p.email) });
        continue;
      }
      personIdMap.set(p.id, profileId);
      peopleSummary.skipped++;
    }
  }
  summary.push(peopleSummary);

  // 3) PROJECTS ---------------------------------------------------------------
  const projectSummary = emptySummary('projects', 'Projekty');
  const availableProjectIds = new Set<string>();
  const existingProjectIds = new Set<string>();
  let projectSelectError: string | null = null;
  for (const c of chunk(data.projects.map((p) => p.id))) {
    const res = await db.select('projects', 'id', { column: 'id', values: c });
    if (res.error) {
      projectSelectError = res.error;
      break;
    }
    for (const row of res.rows) existingProjectIds.add(String(row.id));
  }
  if (projectSelectError) {
    for (const p of data.projects) {
      projectSummary.failed++;
      diagnostics.push({ collection: 'projects', entityId: p.id, message: insertFailure(projectSelectError) });
    }
  } else {
    for (const p of data.projects) {
      if (existingProjectIds.has(p.id)) {
        projectSummary.skipped++;
        availableProjectIds.add(p.id);
        continue;
      }
      if (!isUuid(p.id)) {
        projectSummary.failed++;
        diagnostics.push({ collection: 'projects', entityId: p.id, message: DIAG.nonUuid });
        continue;
      }
      let departmentId: string | null = null;
      if (p.departmentId !== '') {
        const mapped = deptIdMap.get(p.departmentId);
        if (mapped) {
          departmentId = mapped;
        } else {
          diagnostics.push({ collection: 'projects', entityId: p.id, message: DIAG.deptFallback });
        }
      }
      const ins = await db.insert('projects', {
        id: p.id,
        name: p.name,
        description: p.description,
        department_id: departmentId,
        client_id: dictRef(clientMap, p.clientId),
        status_id: dictRef(statusMap, p.statusId),
        paid: p.paid,
        start_date: p.startDate === '' ? null : p.startDate,
        end_date: p.endDate === '' ? null : p.endDate,
        service_type_id: dictRef(serviceTypeMap, p.serviceTypeId),
      });
      if (ins.error) {
        projectSummary.failed++;
        diagnostics.push({ collection: 'projects', entityId: p.id, message: insertFailure(ins.error) });
        continue;
      }
      availableProjectIds.add(p.id);
      projectSummary.imported++;
    }
  }
  summary.push(projectSummary);

  // 4) TASKS ------------------------------------------------------------------
  const taskSummary = emptySummary('tasks', 'Zadania');
  const availableTaskIds = new Set<string>();
  const existingTaskIds = new Set<string>();
  let taskSelectError: string | null = null;
  for (const c of chunk(data.tasks.map((t) => t.id))) {
    const res = await db.select('tasks', 'id', { column: 'id', values: c });
    if (res.error) {
      taskSelectError = res.error;
      break;
    }
    for (const row of res.rows) existingTaskIds.add(String(row.id));
  }
  if (taskSelectError) {
    for (const t of data.tasks) {
      taskSummary.failed++;
      diagnostics.push({ collection: 'tasks', entityId: t.id, message: insertFailure(taskSelectError) });
    }
  } else {
    for (const t of data.tasks) {
      if (existingTaskIds.has(t.id)) {
        taskSummary.skipped++;
        availableTaskIds.add(t.id);
        continue;
      }
      if (!availableProjectIds.has(t.projectId)) {
        taskSummary.failed++;
        diagnostics.push({ collection: 'tasks', entityId: t.id, message: DIAG.projectNotImported });
        continue;
      }
      if (!isUuid(t.id)) {
        taskSummary.failed++;
        diagnostics.push({ collection: 'tasks', entityId: t.id, message: DIAG.nonUuid });
        continue;
      }
      const ins = await db.insert('tasks', {
        id: t.id,
        project_id: t.projectId,
        title: t.title,
        description: t.description,
        status_id: dictRef(statusMap, t.statusId),
        start_date: t.startDate === '' ? null : t.startDate,
        end_date: t.endDate === '' ? null : t.endDate,
        estimated_hours: t.estimatedHours,
        priority: t.priority,
        work_category_id: dictRef(workCategoryMap, t.workCategoryId),
        // Dział zadania — mapowanie jak dział projektu (brak w mapie → null).
        department_id: t.departmentId !== '' ? deptIdMap.get(t.departmentId) ?? null : null,
        checklist: t.checklist,
      });
      if (ins.error) {
        taskSummary.failed++;
        diagnostics.push({ collection: 'tasks', entityId: t.id, message: insertFailure(ins.error) });
        continue;
      }
      availableTaskIds.add(t.id);
      taskSummary.imported++;
    }
  }
  summary.push(taskSummary);

  // 5) PROJECT_MEMBERS --------------------------------------------------------
  const memberPairs = distinctPairs(data, (task) => task.projectId);
  const membersSummary = await importJunction(db, {
    collection: 'project_members',
    label: 'Członkostwo w projektach',
    table: 'project_members',
    parentColumn: 'project_id',
    pairs: memberPairs,
    availableParentIds: availableProjectIds,
    personIdMap,
    personMessage,
    diagnostics,
  });
  summary.push(membersSummary);

  // 6) TASK_ASSIGNMENTS -------------------------------------------------------
  const assignmentPairs = distinctPairs(data, (task) => task.id);
  const assignmentsSummary = await importJunction(db, {
    collection: 'task_assignments',
    label: 'Przypisania',
    table: 'task_assignments',
    parentColumn: 'task_id',
    pairs: assignmentPairs,
    availableParentIds: availableTaskIds,
    personIdMap,
    personMessage,
    diagnostics,
  });
  summary.push(assignmentsSummary);

  // 7) COMMENTS + ACTIVITY (append-only planer data; after tasks) -------------
  summary.push(
    await importComments(db, data, {
      personIdMap,
      availableProjectIds,
      availableTaskIds,
      diagnostics,
    }),
  );
  summary.push(
    await importActivity(db, data, {
      personIdMap,
      availableProjectIds,
      availableTaskIds,
      diagnostics,
    }),
  );

  // 8) MILESTONES (after projects) + WORKLOAD (after tasks) -------------------
  summary.push(
    await importMilestones(db, data, { availableProjectIds, diagnostics }),
  );
  summary.push(
    await importWorkload(db, data, {
      availableTaskIds,
      personIdMap,
      personMessage,
      diagnostics,
    }),
  );

  // Unsupported collections — reported, never dropped silently.
  for (const [key, collection, label] of UNSUPPORTED) {
    const count = (data[key] as unknown[]).length;
    summary.push({ collection, label, imported: 0, skipped: count, failed: 0 });
    if (count > 0) diagnostics.push({ collection, entityId: '', message: DIAG.noTargetTable });
  }

  return { completed: true, summary, diagnostics };
}

/**
 * Insert-only import of a dependency-free reference dictionary, mirroring the
 * departments strategy: select existing (id + a semantic key column), skip when
 * the id is already present OR a trimmed semantic key matches, fail a non-UUID
 * local id with a diagnostic (never insert it), otherwise insert with the
 * explicit local id. Never throws — every db error becomes a failed count plus a
 * diagnostic. Idempotent: a rerun skips everything already present.
 */
async function importReferenceCollection<T extends { id: string }>(
  db: ImportDb,
  opts: {
    collection: string;
    label: string;
    table: string;
    items: T[];
    columns: string; // e.g. 'id, slug' or 'id, name'
    semanticKeyColumn: string; // column read back for skip-by-key (slug / name)
    semanticKeyOf: (item: T) => string; // trimmed semantic key of a local item
    rowOf: (item: T) => Record<string, unknown>; // insert payload
    diagnostics: ImportDiagnostic[];
  },
): Promise<{ summary: ImportCollectionSummary; idMap: Map<string, string> }> {
  const summary = emptySummary(opts.collection, opts.label);
  // local id -> resolved cloud id (== local id when inserted/id-present, or the
  // existing cloud id when a semantic key matched a differently-id'd cloud row).
  const idMap = new Map<string, string>();
  const existing = await db.select(opts.table, opts.columns);
  if (existing.error) {
    for (const item of opts.items) {
      summary.failed++;
      opts.diagnostics.push({
        collection: opts.collection,
        entityId: item.id,
        message: insertFailure(existing.error),
      });
    }
    return { summary, idMap };
  }

  const knownIds = new Set<string>();
  const byKey = new Map<string, string>();
  for (const row of existing.rows) {
    knownIds.add(String(row.id));
    const key = typeof row[opts.semanticKeyColumn] === 'string'
      ? (row[opts.semanticKeyColumn] as string).trim()
      : '';
    if (key && !byKey.has(key)) byKey.set(key, String(row.id));
  }

  for (const item of opts.items) {
    if (knownIds.has(item.id)) {
      idMap.set(item.id, item.id);
      summary.skipped++;
      continue;
    }
    const key = opts.semanticKeyOf(item);
    if (key && byKey.has(key)) {
      idMap.set(item.id, byKey.get(key)!);
      summary.skipped++;
      continue;
    }
    if (!isUuid(item.id)) {
      summary.failed++;
      opts.diagnostics.push({ collection: opts.collection, entityId: item.id, message: DIAG.nonUuid });
      continue;
    }
    const ins = await db.insert(opts.table, opts.rowOf(item));
    if (ins.error) {
      summary.failed++;
      opts.diagnostics.push({
        collection: opts.collection,
        entityId: item.id,
        message: insertFailure(ins.error),
      });
      continue;
    }
    knownIds.add(item.id);
    if (key) byKey.set(key, item.id);
    idMap.set(item.id, item.id);
    summary.imported++;
  }
  return { summary, idMap };
}

interface AppendOnlyOpts {
  personIdMap: Map<string, string>;
  availableProjectIds: Set<string>;
  availableTaskIds: Set<string>;
  diagnostics: ImportDiagnostic[];
}

/** Existing ids of `table` (chunked select on id). Never throws. */
async function selectExistingIds(
  db: ImportDb,
  table: string,
  ids: string[],
): Promise<{ present: Set<string>; error: string | null }> {
  const present = new Set<string>();
  for (const c of chunk(ids)) {
    const res = await db.select(table, 'id', { column: 'id', values: c });
    if (res.error) return { present, error: res.error };
    for (const row of res.rows) present.add(String(row.id));
  }
  return { present, error: null };
}

/**
 * Insert-only import of comments (append-only). Maps author + mentions through
 * personIdMap (unmappable author => null; unmappable mentions dropped). A comment
 * whose parent project/task was not imported fails with a diagnostic. Non-UUID
 * comment id => diagnostic. Idempotent: skip-by-id.
 */
async function importComments(
  db: ImportDb,
  data: AppData,
  opts: AppendOnlyOpts,
): Promise<ImportCollectionSummary> {
  const summary = emptySummary('comments', 'Komentarze');
  const existing = await selectExistingIds(db, 'comments', data.comments.map((c) => c.id));
  if (existing.error) {
    for (const c of data.comments) {
      summary.failed++;
      opts.diagnostics.push({ collection: 'comments', entityId: c.id, message: insertFailure(existing.error) });
    }
    return summary;
  }
  for (const c of data.comments) {
    if (existing.present.has(c.id)) {
      summary.skipped++;
      continue;
    }
    const parentOk =
      c.entityType === 'project'
        ? opts.availableProjectIds.has(c.entityId)
        : opts.availableTaskIds.has(c.entityId);
    if (!parentOk) {
      summary.failed++;
      opts.diagnostics.push({ collection: 'comments', entityId: c.id, message: DIAG.parentNotImported });
      continue;
    }
    if (!isUuid(c.id)) {
      summary.failed++;
      opts.diagnostics.push({ collection: 'comments', entityId: c.id, message: DIAG.nonUuid });
      continue;
    }
    const mentionIds = c.mentionIds
      .map((id) => opts.personIdMap.get(id))
      .filter((id): id is string => id !== undefined);
    const ins = await db.insert('comments', {
      id: c.id,
      project_id: c.entityType === 'project' ? c.entityId : null,
      task_id: c.entityType === 'task' ? c.entityId : null,
      author_id: c.authorId === '' ? null : opts.personIdMap.get(c.authorId) ?? null,
      body: c.body,
      mention_ids: mentionIds,
      created_at: c.createdAt,
    });
    if (ins.error) {
      summary.failed++;
      opts.diagnostics.push({ collection: 'comments', entityId: c.id, message: insertFailure(ins.error) });
      continue;
    }
    summary.imported++;
  }
  return summary;
}

/**
 * Insert-only import of the activity log (append-only). Maps actor/impersonator
 * through personIdMap (unmappable => null). Typed project_id/task_id FKs are set
 * only for project/task rows whose entity was imported; entity_id keeps the
 * verbatim local id regardless. `created_by` is left to the server default
 * (auth.uid() — the importing administrator). Non-UUID id => diagnostic.
 */
async function importActivity(
  db: ImportDb,
  data: AppData,
  opts: AppendOnlyOpts,
): Promise<ImportCollectionSummary> {
  const summary = emptySummary('activity', 'Dziennik aktywności');
  const existing = await selectExistingIds(db, 'activity_events', data.activity.map((e) => e.id));
  if (existing.error) {
    for (const e of data.activity) {
      summary.failed++;
      opts.diagnostics.push({ collection: 'activity', entityId: e.id, message: insertFailure(existing.error) });
    }
    return summary;
  }
  for (const e of data.activity) {
    if (existing.present.has(e.id)) {
      summary.skipped++;
      continue;
    }
    if (!isUuid(e.id)) {
      summary.failed++;
      opts.diagnostics.push({ collection: 'activity', entityId: e.id, message: DIAG.nonUuid });
      continue;
    }
    const isProject = e.entityType === 'project' && opts.availableProjectIds.has(e.entityId);
    const isTask = e.entityType === 'task' && opts.availableTaskIds.has(e.entityId);
    const impersonatorId = e.impersonatorId && e.impersonatorId !== ''
      ? opts.personIdMap.get(e.impersonatorId) ?? null
      : null;
    const ins = await db.insert('activity_events', {
      id: e.id,
      entity_type: e.entityType,
      entity_id: e.entityId,
      project_id: isProject ? e.entityId : null,
      task_id: isTask ? e.entityId : null,
      actor_id: e.actorId === '' ? null : opts.personIdMap.get(e.actorId) ?? null,
      impersonator_id: impersonatorId,
      message: e.message,
      created_at: e.createdAt,
    });
    if (ins.error) {
      summary.failed++;
      opts.diagnostics.push({ collection: 'activity', entityId: e.id, message: insertFailure(ins.error) });
      continue;
    }
    summary.imported++;
  }
  return summary;
}

/**
 * Insert-only import of milestones (after projects). Skip-by-id; non-UUID id =>
 * diagnostic; a milestone whose parent project was not imported fails with a
 * diagnostic. `date` maps to `milestone_date`.
 */
async function importMilestones(
  db: ImportDb,
  data: AppData,
  opts: { availableProjectIds: Set<string>; diagnostics: ImportDiagnostic[] },
): Promise<ImportCollectionSummary> {
  const summary = emptySummary('milestones', 'Kamienie milowe');
  const existing = await selectExistingIds(db, 'milestones', data.milestones.map((m) => m.id));
  if (existing.error) {
    for (const m of data.milestones) {
      summary.failed++;
      opts.diagnostics.push({ collection: 'milestones', entityId: m.id, message: insertFailure(existing.error) });
    }
    return summary;
  }
  for (const m of data.milestones) {
    if (existing.present.has(m.id)) {
      summary.skipped++;
      continue;
    }
    if (!opts.availableProjectIds.has(m.projectId)) {
      summary.failed++;
      opts.diagnostics.push({ collection: 'milestones', entityId: m.id, message: DIAG.parentNotImported });
      continue;
    }
    if (!isUuid(m.id)) {
      summary.failed++;
      opts.diagnostics.push({ collection: 'milestones', entityId: m.id, message: DIAG.nonUuid });
      continue;
    }
    const ins = await db.insert('milestones', {
      id: m.id,
      project_id: m.projectId,
      name: m.name,
      milestone_date: m.date,
    });
    if (ins.error) {
      summary.failed++;
      opts.diagnostics.push({ collection: 'milestones', entityId: m.id, message: insertFailure(ins.error) });
      continue;
    }
    summary.imported++;
  }
  return summary;
}

/**
 * Insert-only import of workload (after tasks). Skip-by-id; non-UUID id =>
 * diagnostic; task not imported => diagnostic; profile unmappable => failed +
 * diagnostic (personMessage). Bin sentinel `date === ''` maps to `work_date null`.
 */
async function importWorkload(
  db: ImportDb,
  data: AppData,
  opts: {
    availableTaskIds: Set<string>;
    personIdMap: Map<string, string>;
    personMessage: (personId: string) => string;
    diagnostics: ImportDiagnostic[];
  },
): Promise<ImportCollectionSummary> {
  const summary = emptySummary('workload', 'Zaplanowane godziny');
  const existing = await selectExistingIds(db, 'workload_entries', data.workload.map((w) => w.id));
  if (existing.error) {
    for (const w of data.workload) {
      summary.failed++;
      opts.diagnostics.push({ collection: 'workload', entityId: w.id, message: insertFailure(existing.error) });
    }
    return summary;
  }
  for (const w of data.workload) {
    if (existing.present.has(w.id)) {
      summary.skipped++;
      continue;
    }
    if (!opts.availableTaskIds.has(w.taskId)) {
      summary.failed++;
      opts.diagnostics.push({ collection: 'workload', entityId: w.id, message: DIAG.parentNotImported });
      continue;
    }
    if (!isUuid(w.id)) {
      summary.failed++;
      opts.diagnostics.push({ collection: 'workload', entityId: w.id, message: DIAG.nonUuid });
      continue;
    }
    const profileId = opts.personIdMap.get(w.personId);
    if (!profileId) {
      summary.failed++;
      opts.diagnostics.push({ collection: 'workload', entityId: w.id, message: opts.personMessage(w.personId) });
      continue;
    }
    const ins = await db.insert('workload_entries', {
      id: w.id,
      task_id: w.taskId,
      profile_id: profileId,
      work_date: w.date === '' ? null : w.date,
      planned_hours: w.plannedHours,
      start_minutes: w.startMinutes,
      sort_index: w.sortIndex,
    });
    if (ins.error) {
      summary.failed++;
      opts.diagnostics.push({ collection: 'workload', entityId: w.id, message: insertFailure(ins.error) });
      continue;
    }
    summary.imported++;
  }
  return summary;
}

interface JunctionPair {
  parentId: string; // local project id or task id (carried over as Supabase PK)
  personId: string; // local person id
}

/**
 * Distinct (parentId, personId) pairs derived from assignments joined through
 * tasks — exactly mirroring buildDryRunReport's membership derivation. `parentOf`
 * picks projectId (memberships) or task id (assignments).
 */
function distinctPairs(data: AppData, parentOf: (task: AppData['tasks'][number]) => string): JunctionPair[] {
  const taskById = new Map(data.tasks.map((t) => [t.id, t]));
  const personIds = new Set(data.people.map((p) => p.id));
  const seen = new Set<string>();
  const pairs: JunctionPair[] = [];
  for (const a of data.assignments) {
    const task = taskById.get(a.taskId);
    if (!task || !personIds.has(a.personId)) continue;
    const parentId = parentOf(task);
    const key = `${parentId}|${a.personId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ parentId, personId: a.personId });
  }
  return pairs;
}

async function importJunction(
  db: ImportDb,
  opts: {
    collection: string;
    label: string;
    table: string;
    parentColumn: string;
    pairs: JunctionPair[];
    availableParentIds: Set<string>;
    personIdMap: Map<string, string>;
    personMessage: (personId: string) => string;
    diagnostics: ImportDiagnostic[];
  },
): Promise<ImportCollectionSummary> {
  const summary = emptySummary(opts.collection, opts.label);

  // Resolve local pairs to Supabase (parentId, profileId), failing dangling ones.
  const resolved: Array<{ key: string; parentId: string; profileId: string }> = [];
  for (const pair of opts.pairs) {
    const key = `${pair.parentId}|${pair.personId}`;
    if (!opts.availableParentIds.has(pair.parentId)) {
      summary.failed++;
      opts.diagnostics.push({ collection: opts.collection, entityId: key, message: DIAG.projectNotImported });
      continue;
    }
    const profileId = opts.personIdMap.get(pair.personId);
    if (!profileId) {
      summary.failed++;
      opts.diagnostics.push({ collection: opts.collection, entityId: key, message: opts.personMessage(pair.personId) });
      continue;
    }
    resolved.push({ key, parentId: pair.parentId, profileId });
  }

  // Existing composite pairs via chunked select on the parent column.
  const parentIds = [...new Set(resolved.map((r) => r.parentId))];
  const existingPairs = new Set<string>();
  let selectError: string | null = null;
  for (const c of chunk(parentIds)) {
    const res = await db.select(opts.table, `${opts.parentColumn}, profile_id`, {
      column: opts.parentColumn,
      values: c,
    });
    if (res.error) {
      selectError = res.error;
      break;
    }
    for (const row of res.rows) {
      existingPairs.add(`${String(row[opts.parentColumn])}|${String(row.profile_id)}`);
    }
  }
  if (selectError) {
    for (const r of resolved) {
      summary.failed++;
      opts.diagnostics.push({ collection: opts.collection, entityId: r.key, message: insertFailure(selectError) });
    }
    return summary;
  }

  for (const r of resolved) {
    const supKey = `${r.parentId}|${r.profileId}`;
    if (existingPairs.has(supKey)) {
      summary.skipped++;
      continue;
    }
    const ins = await db.insert(opts.table, { [opts.parentColumn]: r.parentId, profile_id: r.profileId });
    if (ins.error) {
      summary.failed++;
      opts.diagnostics.push({ collection: opts.collection, entityId: r.key, message: insertFailure(ins.error) });
      continue;
    }
    existingPairs.add(supKey);
    summary.imported++;
  }
  return summary;
}
