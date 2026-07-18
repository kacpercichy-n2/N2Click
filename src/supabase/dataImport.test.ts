// Focused tests for the guarded, idempotent Supabase import (dataImport.ts).
// A fake ImportDb backed by in-memory Maps records every call in order and
// accumulates inserted rows — no SDK mocking, no live Supabase. Covers: admin/
// mode/confirmation gating, blocker refusal, happy path + dependency order,
// idempotent rerun, partial failure + continuation, people mapping (never
// inserted), department name matching, and non-UUID ids.
import { describe, expect, it } from 'vitest';
import { emptyData } from '../store/storage';
import { buildDryRunReport } from '../store/exportDryRun';
import type {
  ActivityEvent,
  AppData,
  Comment,
  Person,
  Project,
  ServiceType,
  Status,
  Task,
  TaskAssignment,
  WorkCategory,
} from '../types';
import {
  createSupabaseImportDb,
  evaluateImportGate,
  runSupabaseImport,
  SELECT_PAGE_SIZE,
  type ImportDb,
  type ImportGateInput,
} from './dataImport';

// ---- Fake ImportDb ----------------------------------------------------------

interface Call {
  op: 'select' | 'insert' | 'insertMany';
  table: string;
  row?: Record<string, unknown>;
  count?: number; // batch size for insertMany
}

class FakeDb implements ImportDb {
  tables = new Map<string, Array<Record<string, unknown>>>();
  calls: Call[] = [];
  // Every landed row (via insert OR insertMany), in order, for row-shape and
  // ordering assertions — the batch pipeline no longer routes happy-path rows
  // through per-row `insert`.
  inserted: Array<{ table: string; row: Record<string, unknown> }> = [];
  insertTables: string[] = [];
  failInsert: (table: string, row: Record<string, unknown>) => string | null = () => null;
  failSelect: (table: string) => string | null = () => null;

  seed(table: string, rows: Array<Record<string, unknown>>) {
    this.tables.set(table, [...(this.tables.get(table) ?? []), ...rows.map((r) => ({ ...r }))]);
    return this;
  }

  rows(table: string): Array<Record<string, unknown>> {
    return this.tables.get(table) ?? [];
  }

  insertCalls(table: string): Array<Record<string, unknown>> {
    return this.inserted.filter((i) => i.table === table).map((i) => i.row);
  }

  private land(table: string, row: Record<string, unknown>) {
    this.tables.set(table, [...this.rows(table), { ...row }]);
    this.inserted.push({ table, row: { ...row } });
    this.insertTables.push(table);
  }

  async select(table: string, _columns: string, inFilter?: { column: string; values: string[] }) {
    this.calls.push({ op: 'select', table });
    const err = this.failSelect(table);
    if (err) return { rows: [], error: err };
    let rows = this.rows(table);
    if (inFilter) rows = rows.filter((r) => inFilter.values.includes(String(r[inFilter.column])));
    return { rows: rows.map((r) => ({ ...r })), error: null };
  }

  async insert(table: string, row: Record<string, unknown>) {
    this.calls.push({ op: 'insert', table, row: { ...row } });
    const err = this.failInsert(table, row);
    if (err) return { error: err };
    this.land(table, row);
    return { error: null };
  }

  async insertMany(table: string, rows: Array<Record<string, unknown>>) {
    this.calls.push({ op: 'insertMany', table, count: rows.length });
    // PostgREST is all-or-nothing: if any row would fail, the whole batch is
    // rejected and NOTHING lands.
    for (const row of rows) {
      const err = this.failInsert(table, row);
      if (err) return { error: err };
    }
    for (const row of rows) this.land(table, row);
    return { error: null };
  }
}

// ---- Fixture builders -------------------------------------------------------

const uuid = (seed: string): string => {
  const hex = Array.from(seed).reduce((acc, ch) => acc + ch.charCodeAt(0).toString(16), '').padEnd(32, '0').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

function makePerson(o: Partial<Person> & { id: string }): Person {
  return {
    firstName: 'Ann', lastName: 'Nowak', name: 'Ann Nowak', email: '', phone: '', role: '',
    departmentId: '', avatar: '', capacity: 8, accessRole: 'pracownik', passwordHash: '',
    workDays: [1, 2, 3, 4, 5], workStartMinutes: 480, workEndMinutes: 960, supervisorId: '', ...o,
  };
}

function makeProject(o: Partial<Project> & { id: string }): Project {
  return {
    clientId: '', name: 'Projekt', description: '', statusId: '', paid: false,
    startDate: '2026-07-06', endDate: '2026-07-12', departmentId: '', serviceTypeId: '',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...o,
  };
}

function makeTask(o: Partial<Task> & { id: string }): Task {
  return {
    projectId: '', statusId: '', title: 'Zadanie', description: '', startDate: '2026-07-06',
    endDate: '2026-07-08', estimatedHours: null, priority: 'normal', workCategoryId: '',
    checklist: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...o,
  };
}

const asg = (o: TaskAssignment): TaskAssignment => o;

// A clean fixture: 2 departments, 2 people (both with emails), 2 projects,
// 3 tasks, 3 assignments.
const D1 = uuid('dept-kreacja');
const D2 = uuid('dept-strategia');
const PR1 = uuid('proj-alpha');
const PR2 = uuid('proj-beta');
const T1 = uuid('task-one');
const T2 = uuid('task-two');
const T3 = uuid('task-three');
const PROFILE_A = uuid('profile-anna');
const PROFILE_B = uuid('profile-bart');

function fixture(): AppData {
  return {
    ...emptyData(),
    statuses: [],
    departments: [
      { id: D1, name: 'Kreacja' },
      { id: D2, name: 'Strategia' },
    ],
    people: [
      makePerson({ id: 'localA', email: 'anna@example.com', departmentId: D1 }),
      makePerson({ id: 'localB', email: 'bart@example.com', departmentId: D2 }),
    ],
    projects: [
      makeProject({ id: PR1, name: 'Alpha', departmentId: D1 }),
      makeProject({ id: PR2, name: 'Beta', departmentId: D2 }),
    ],
    tasks: [
      makeTask({ id: T1, projectId: PR1 }),
      makeTask({ id: T2, projectId: PR1 }),
      makeTask({ id: T3, projectId: PR2 }),
    ],
    assignments: [
      asg({ id: 'a1', taskId: T1, personId: 'localA' }),
      asg({ id: 'a2', taskId: T2, personId: 'localB' }),
      asg({ id: 'a3', taskId: T3, personId: 'localA' }),
    ],
  };
}

// DB pre-seeded only with the two profiles (people are mapped, never created).
function seedProfiles(db: FakeDb): FakeDb {
  return db
    .seed('profiles', [
      { id: PROFILE_A, email: 'anna@example.com' },
      { id: PROFILE_B, email: 'bart@example.com' },
    ]);
}

const sumFor = (result: Awaited<ReturnType<typeof runSupabaseImport>>, collection: string) =>
  result.summary.find((s) => s.collection === collection)!;

// ---- 1. Gate ----------------------------------------------------------------

describe('evaluateImportGate', () => {
  const base: ImportGateInput = {
    isAdmin: true,
    authMode: 'supabase',
    signedIn: true,
    report: buildDryRunReport(fixture()),
    confirmationText: 'IMPORTUJ',
  };

  it('allows a fully satisfied input', () => {
    expect(evaluateImportGate(base)).toEqual({ allowed: true });
  });

  it('rejects non-admin first', () => {
    expect(evaluateImportGate({ ...base, isAdmin: false })).toEqual({
      allowed: false,
      reason: 'Import może uruchomić wyłącznie administrator.',
    });
  });

  it('rejects local mode', () => {
    expect(evaluateImportGate({ ...base, authMode: 'local' })).toEqual({
      allowed: false,
      reason: 'Import wymaga trybu Supabase.',
    });
  });

  it('rejects signed-out', () => {
    expect(evaluateImportGate({ ...base, signedIn: false })).toEqual({
      allowed: false,
      reason: 'Zaloguj się do Supabase, aby importować dane.',
    });
  });

  it('rejects a missing report', () => {
    expect(evaluateImportGate({ ...base, report: null })).toEqual({
      allowed: false,
      reason: 'Najpierw uruchom symulację migracji.',
    });
  });

  it('rejects a report with blockers', () => {
    const withBlocker = buildDryRunReport({
      ...fixture(),
      projects: [makeProject({ id: PR1, name: '' })], // empty name -> blocker
    });
    expect(evaluateImportGate({ ...base, report: withBlocker })).toEqual({
      allowed: false,
      reason: 'Symulacja wykryła blokery — usuń je i uruchom symulację ponownie.',
    });
  });

  it('rejects wrong / empty / lowercase confirmation', () => {
    const reason = 'Przepisz słowo IMPORTUJ, aby potwierdzić.';
    expect(evaluateImportGate({ ...base, confirmationText: '' })).toEqual({ allowed: false, reason });
    expect(evaluateImportGate({ ...base, confirmationText: 'importuj' })).toEqual({ allowed: false, reason });
    expect(evaluateImportGate({ ...base, confirmationText: 'IMPORT' })).toEqual({ allowed: false, reason });
  });

  it('trims the confirmation text', () => {
    expect(evaluateImportGate({ ...base, confirmationText: '  IMPORTUJ  ' })).toEqual({ allowed: true });
  });
});

// ---- 2. Blocker refusal -----------------------------------------------------

describe('runSupabaseImport — blocker refusal', () => {
  it('refuses without any db call when the report has blockers', async () => {
    const data = fixture();
    const report = buildDryRunReport({ ...data, tasks: [makeTask({ id: T1, projectId: 'ghost' })] });
    expect(report.blockers.length).toBeGreaterThan(0);
    const db = seedProfiles(new FakeDb());
    const result = await runSupabaseImport(data, report, db);
    expect(result.completed).toBe(false);
    expect(result.refusedReason).toBe('Import przerwany: raport symulacji zawiera blokery.');
    expect(db.calls).toHaveLength(0);
  });
});

// ---- 3. Happy path + dependency order --------------------------------------

describe('runSupabaseImport — happy path', () => {
  it('inserts in dependency order and maps people to profiles (0 imported)', async () => {
    const data = fixture();
    const report = buildDryRunReport(data);
    expect(report.blockers).toHaveLength(0);
    const db = seedProfiles(new FakeDb());
    const result = await runSupabaseImport(data, report, db);

    expect(result.completed).toBe(true);
    expect(result.diagnostics).toHaveLength(0);

    expect(sumFor(result, 'departments')).toMatchObject({ imported: 2, skipped: 0, failed: 0 });
    expect(sumFor(result, 'people')).toMatchObject({ imported: 0, skipped: 2, failed: 0 });
    expect(sumFor(result, 'projects')).toMatchObject({ imported: 2, skipped: 0, failed: 0 });
    expect(sumFor(result, 'tasks')).toMatchObject({ imported: 3, skipped: 0, failed: 0 });
    expect(sumFor(result, 'project_members')).toMatchObject({ imported: 3, skipped: 0, failed: 0 });
    expect(sumFor(result, 'task_assignments')).toMatchObject({ imported: 3, skipped: 0, failed: 0 });

    // No profile inserts ever.
    expect(db.insertCalls('profiles')).toHaveLength(0);

    // Insert grouping order: departments → projects → tasks → project_members → task_assignments.
    const order = db.insertTables;
    const firstIndex = (t: string) => order.indexOf(t);
    expect(firstIndex('departments')).toBeGreaterThanOrEqual(0);
    expect(firstIndex('departments')).toBeLessThan(firstIndex('projects'));
    expect(firstIndex('projects')).toBeLessThan(firstIndex('tasks'));
    expect(firstIndex('tasks')).toBeLessThan(firstIndex('project_members'));
    expect(firstIndex('project_members')).toBeLessThan(firstIndex('task_assignments'));

    // Task assignment rows carry PROFILE ids, not local person ids.
    const asgRows = db.insertCalls('task_assignments');
    expect(asgRows.every((r) => r.profile_id === PROFILE_A || r.profile_id === PROFILE_B)).toBe(true);
    expect(asgRows.some((r) => r.profile_id === 'localA')).toBe(false);

    // Unsupported collections reported as skipped, never inserted.
    expect(sumFor(result, 'clients')).toBeDefined();
  });
});

// ---- 4. Idempotent rerun ----------------------------------------------------

describe('runSupabaseImport — idempotent rerun', () => {
  it('imports nothing on the second run and creates no duplicates', async () => {
    const data = fixture();
    const report = buildDryRunReport(data);
    const db = seedProfiles(new FakeDb());

    await runSupabaseImport(data, report, db);
    const deptRowsAfterFirst = db.rows('departments').length;
    const insertsBeforeSecond = db.calls.filter((c) => c.op === 'insert').length;

    const second = await runSupabaseImport(data, report, db);

    for (const s of second.summary) {
      expect(s.imported).toBe(0);
    }
    expect(sumFor(second, 'departments').skipped).toBe(2);
    expect(sumFor(second, 'projects').skipped).toBe(2);
    expect(sumFor(second, 'tasks').skipped).toBe(3);
    expect(sumFor(second, 'project_members').skipped).toBe(3);
    expect(sumFor(second, 'task_assignments').skipped).toBe(3);

    // No new insert calls at all on the rerun.
    const insertsTotal = db.calls.filter((c) => c.op === 'insert').length;
    expect(insertsTotal).toBe(insertsBeforeSecond);

    // No duplicate rows.
    expect(db.rows('departments')).toHaveLength(deptRowsAfterFirst);
    expect(db.rows('projects')).toHaveLength(2);
    expect(db.rows('tasks')).toHaveLength(3);
    expect(db.rows('task_assignments')).toHaveLength(3);
  });
});

// ---- 5. Partial failure + continuation -------------------------------------

describe('runSupabaseImport — partial failure', () => {
  it('fails one project alone, fails its tasks without inserts, then completes on rerun', async () => {
    const data = fixture();
    const report = buildDryRunReport(data);
    const db = seedProfiles(new FakeDb());
    db.failInsert = (table, row) => (table === 'projects' && row.id === PR1 ? 'boom' : null);

    const first = await runSupabaseImport(data, report, db);
    expect(sumFor(first, 'projects')).toMatchObject({ imported: 1, failed: 1 });

    // Project PR1 failed with an insert diagnostic.
    expect(first.diagnostics.some((d) => d.entityId === PR1 && d.message.startsWith('Zapis nie powiódł się'))).toBe(true);

    // Its two tasks (T1, T2 in PR1) failed with "project not imported", no insert attempted.
    const t1Diag = first.diagnostics.find((d) => d.collection === 'tasks' && d.entityId === T1);
    expect(t1Diag?.message).toBe(
      'Projekt zadania nie został zaimportowany — popraw błąd projektu i uruchom import ponownie.',
    );
    expect(db.insertCalls('tasks').some((r) => r.id === T1 || r.id === T2)).toBe(false);
    // PR2's task T3 imported.
    expect(db.insertCalls('tasks').some((r) => r.id === T3)).toBe(true);
    expect(sumFor(first, 'tasks')).toMatchObject({ imported: 1, failed: 2 });

    // Rerun with the fault cleared → only the remainder is inserted, nothing duplicated.
    db.failInsert = () => null;
    const second = await runSupabaseImport(data, report, db);
    expect(sumFor(second, 'projects')).toMatchObject({ imported: 1, skipped: 1, failed: 0 });
    expect(sumFor(second, 'tasks')).toMatchObject({ imported: 2, skipped: 1, failed: 0 });
    expect(db.rows('projects')).toHaveLength(2);
    expect(db.rows('tasks')).toHaveLength(3);
    expect(db.rows('task_assignments')).toHaveLength(3);
  });
});

// ---- 6. People mapping ------------------------------------------------------

describe('runSupabaseImport — people mapping', () => {
  it('maps by normalized email; missing account and dependents fail; duplicates fail', async () => {
    const data: AppData = {
      ...fixture(),
      people: [
        makePerson({ id: 'localA', email: '  ANNA@Example.com ' }), // case/whitespace -> maps
        makePerson({ id: 'noAcct', email: 'ghost@example.com' }), // no profile
        makePerson({ id: 'dup', email: 'anna@example.com' }), // duplicate normalized email
      ],
      assignments: [
        asg({ id: 'a1', taskId: T1, personId: 'localA' }),
        asg({ id: 'a2', taskId: T2, personId: 'noAcct' }),
      ],
    };
    const report = buildDryRunReport(data);
    const db = seedProfiles(new FakeDb());
    const result = await runSupabaseImport(data, report, db);

    const people = sumFor(result, 'people');
    expect(people).toMatchObject({ imported: 0, skipped: 1, failed: 2 });
    expect(db.insertCalls('profiles')).toHaveLength(0);

    // localA assignment uses the PROFILE id.
    const t1Asg = db.insertCalls('task_assignments').find((r) => r.task_id === T1);
    expect(t1Asg?.profile_id).toBe(PROFILE_A);

    // Missing-account person: provisioning diagnostic + its assignment failed actionably.
    expect(result.diagnostics.some((d) => d.collection === 'people' && d.message.includes('ghost@example.com'))).toBe(true);
    const a2Fail = result.diagnostics.find((d) => d.collection === 'task_assignments' && d.entityId === `${T2}|noAcct`);
    expect(a2Fail?.message).toContain('ghost@example.com');
    expect(sumFor(result, 'task_assignments')).toMatchObject({ imported: 1, failed: 1 });

    // Duplicate email person failed with the duplicate diagnostic.
    expect(
      result.diagnostics.some((d) => d.collection === 'people' && d.message.startsWith('Zduplikowany adres e-mail')),
    ).toBe(true);
  });

  it('reports the empty-email diagnostic', async () => {
    const data: AppData = {
      ...fixture(),
      people: [makePerson({ id: 'localA', email: '' })],
      assignments: [],
    };
    const result = await runSupabaseImport(data, buildDryRunReport(data), seedProfiles(new FakeDb()));
    expect(
      result.diagnostics.some((d) => d.collection === 'people' && d.message.startsWith('Osoba nie ma adresu e-mail')),
    ).toBe(true);
  });
});

// ---- 7. Department name matching -------------------------------------------

describe('runSupabaseImport — department name matching', () => {
  it('matches an existing department by exact name and reuses its Supabase id', async () => {
    const data = fixture();
    const existingDeptId = uuid('server-kreacja');
    const db = seedProfiles(new FakeDb()).seed('departments', [{ id: existingDeptId, name: 'Kreacja' }]);
    const result = await runSupabaseImport(data, buildDryRunReport(data), db);

    // No insert for Kreacja (matched by name), only Strategia inserted.
    expect(db.insertCalls('departments').some((r) => r.name === 'Kreacja')).toBe(false);
    expect(sumFor(result, 'departments')).toMatchObject({ imported: 1, skipped: 1 });

    // Project Alpha (departmentId D1 -> Kreacja) carries the EXISTING server id.
    const alpha = db.insertCalls('projects').find((r) => r.id === PR1);
    expect(alpha?.department_id).toBe(existingDeptId);
  });
});

// ---- 8. Non-UUID id ---------------------------------------------------------

describe('runSupabaseImport — non-UUID id', () => {
  it('fails a legacy non-UUID department, continues, attempts no insert for it', async () => {
    const data: AppData = {
      ...fixture(),
      departments: [
        { id: 'dep-1', name: 'Legacy' },
        { id: D2, name: 'Strategia' },
      ],
      // Point Alpha's dept at the legacy dept so its fallback is exercised too.
      projects: [makeProject({ id: PR1, name: 'Alpha', departmentId: 'dep-1' }), makeProject({ id: PR2, name: 'Beta', departmentId: D2 })],
    };
    const db = seedProfiles(new FakeDb());
    const result = await runSupabaseImport(data, buildDryRunReport(data), db);

    expect(db.insertCalls('departments').some((r) => r.id === 'dep-1')).toBe(false);
    const depDiag = result.diagnostics.find((d) => d.collection === 'departments' && d.entityId === 'dep-1');
    expect(depDiag?.message).toBe('Identyfikator nie jest w formacie UUID — rekord wymaga ręcznej migracji.');
    expect(sumFor(result, 'departments')).toMatchObject({ imported: 1, failed: 1 });

    // Alpha still imports, without a department, with the fallback warning.
    const alpha = db.insertCalls('projects').find((r) => r.id === PR1);
    expect(alpha?.department_id).toBeNull();
    expect(result.diagnostics.some((d) => d.collection === 'projects' && d.entityId === PR1 && d.message.startsWith('Dział projektu'))).toBe(true);
  });
});

// ---- 9. Reference dictionaries (statuses / service_types / work_categories) --

const makeStatus = (o: Partial<Status> & { id: string }): Status => ({
  name: 'Status', slug: 'status', color: '#c496ff', order: 0, archived: false, isDone: false, ...o,
});
const makeService = (o: Partial<ServiceType> & { id: string }): ServiceType => ({ name: 'Usługa', ...o });
const makeCategory = (o: Partial<WorkCategory> & { id: string }): WorkCategory => ({ name: 'Kategoria', ...o });

const ST1 = uuid('status-todo');
const ST2 = uuid('status-done');
const SV1 = uuid('service-video');
const WC1 = uuid('category-design');

function refFixture(): AppData {
  return {
    ...emptyData(),
    statuses: [
      makeStatus({ id: ST1, name: 'Do zrobienia', slug: 'todo', order: 1, isDone: false }),
      makeStatus({ id: ST2, name: 'Zrobione', slug: 'done', order: 2, isDone: true, archived: true }),
    ],
    serviceTypes: [makeService({ id: SV1, name: 'Wideo' })],
    workCategories: [makeCategory({ id: WC1, name: 'Design' })],
    // No people/projects/tasks needed for dictionary-only assertions.
    people: [],
    projects: [],
    tasks: [],
    assignments: [],
  };
}

describe('runSupabaseImport — słowniki referencyjne', () => {
  it('wstawia statusy/typy usług/kategorie z mapowaniem kolumn i przed działami', async () => {
    const data = refFixture();
    const db = new FakeDb();
    const result = await runSupabaseImport(data, buildDryRunReport(data), db);

    expect(sumFor(result, 'statuses')).toMatchObject({ imported: 2, skipped: 0, failed: 0 });
    expect(sumFor(result, 'service_types')).toMatchObject({ imported: 1, skipped: 0, failed: 0 });
    expect(sumFor(result, 'work_categories')).toMatchObject({ imported: 1, skipped: 0, failed: 0 });

    // order → sort_order, isDone → is_done, archived carried.
    const done = db.insertCalls('statuses').find((r) => r.id === ST2);
    expect(done).toMatchObject({ name: 'Zrobione', slug: 'done', sort_order: 2, is_done: true, archived: true });
    // Reference inserts precede departments (dependency-free step 0).
    expect(db.insertTables.indexOf('statuses')).toBeLessThan(
      db.insertTables.indexOf('service_types'),
    );
  });

  it('pomija po id oraz po kluczu semantycznym (slug / nazwa); rerun nic nie wstawia', async () => {
    const data = refFixture();
    const db = new FakeDb()
      // Same id as ST1 -> skip by id.
      .seed('statuses', [{ id: ST1, slug: 'inny-slug' }])
      // Different id, same trimmed name -> skip by name.
      .seed('service_types', [{ id: uuid('server-video'), name: 'Wideo' }]);
    const result = await runSupabaseImport(data, buildDryRunReport(data), db);

    expect(sumFor(result, 'statuses')).toMatchObject({ imported: 1, skipped: 1, failed: 0 });
    expect(db.insertCalls('statuses').some((r) => r.id === ST1)).toBe(false);
    expect(sumFor(result, 'service_types')).toMatchObject({ imported: 0, skipped: 1, failed: 0 });
    expect(db.insertCalls('service_types')).toHaveLength(0);

    // Idempotent rerun: nothing new imported.
    const second = await runSupabaseImport(data, buildDryRunReport(data), db);
    expect(sumFor(second, 'statuses').imported).toBe(0);
    expect(sumFor(second, 'work_categories').imported).toBe(0);
  });

  it('skip po slug dla statusów (różne id, ten sam slug)', async () => {
    const data = refFixture();
    const db = new FakeDb().seed('statuses', [{ id: uuid('server-todo'), slug: 'todo' }]);
    const result = await runSupabaseImport(data, buildDryRunReport(data), db);
    expect(db.insertCalls('statuses').some((r) => r.slug === 'todo')).toBe(false);
    expect(sumFor(result, 'statuses')).toMatchObject({ imported: 1, skipped: 1 });
  });

  it('nie-UUID id => diagnostyka, bez insertu, kontynuacja', async () => {
    const data: AppData = {
      ...refFixture(),
      statuses: [makeStatus({ id: 'legacy-1', slug: 'legacy' }), makeStatus({ id: ST2, slug: 'done' })],
    };
    const db = new FakeDb();
    const result = await runSupabaseImport(data, buildDryRunReport(data), db);

    expect(db.insertCalls('statuses').some((r) => r.id === 'legacy-1')).toBe(false);
    const diag = result.diagnostics.find((d) => d.collection === 'statuses' && d.entityId === 'legacy-1');
    expect(diag?.message).toBe('Identyfikator nie jest w formacie UUID — rekord wymaga ręcznej migracji.');
    expect(sumFor(result, 'statuses')).toMatchObject({ imported: 1, failed: 1 });
  });

  it('błąd selectu => wszystkie wiersze kolekcji policzone jako błąd, bez insertów', async () => {
    const data = refFixture();
    const db = new FakeDb();
    db.failSelect = (table) => (table === 'work_categories' ? 'select-boom' : null);
    const result = await runSupabaseImport(data, buildDryRunReport(data), db);

    expect(sumFor(result, 'work_categories')).toMatchObject({ imported: 0, failed: 1 });
    expect(db.insertCalls('work_categories')).toHaveLength(0);
    expect(
      result.diagnostics.some((d) => d.collection === 'work_categories' && d.message.startsWith('Zapis nie powiódł się')),
    ).toBe(true);
    // Other dictionaries still import.
    expect(sumFor(result, 'statuses').imported).toBe(2);
  });
});

// ---- 10. Clients + comments + activity (planer migration) -------------------

const CLIENT1 = uuid('client-alpha');
const CM1 = uuid('comment-one');
const CM_ORPHAN = uuid('comment-orphan');
const AC1 = uuid('activity-one');

describe('runSupabaseImport — klienci / komentarze / dziennik', () => {
  function plannerFixture(): AppData {
    const base = fixture();
    return {
      ...base,
      clients: [{ id: CLIENT1, name: 'Alfa', archived: false }],
      projects: [
        makeProject({ id: PR1, name: 'Alpha', departmentId: D1, clientId: CLIENT1 }),
        makeProject({ id: PR2, name: 'Beta', departmentId: D2 }),
      ],
      comments: [
        {
          id: CM1, entityType: 'task', entityId: T1, authorId: 'localA',
          body: 'Komentarz', mentionIds: ['localB', 'ghost'], createdAt: '2026-07-16T00:00:00.000Z',
        } as Comment,
        {
          id: CM_ORPHAN, entityType: 'task', entityId: 'ghost-task', authorId: 'localA',
          body: 'Sierota', mentionIds: [], createdAt: '2026-07-16T00:00:00.000Z',
        } as Comment,
      ],
      activity: [
        {
          id: AC1, entityType: 'task', entityId: T1, actorId: 'localA',
          message: 'utworzył(a) zadanie', createdAt: '2026-07-16T00:00:00.000Z',
        } as ActivityEvent,
      ],
    };
  }

  it('imports clients before projects and wires project client_id', async () => {
    const data = plannerFixture();
    const db = seedProfiles(new FakeDb());
    const result = await runSupabaseImport(data, buildDryRunReport(data), db);

    expect(sumFor(result, 'clients')).toMatchObject({ imported: 1, failed: 0 });
    expect(db.insertTables.indexOf('clients')).toBeLessThan(db.insertTables.indexOf('projects'));
    // Alpha carries the client_id; Beta has none.
    const alpha = db.insertCalls('projects').find((r) => r.id === PR1);
    expect(alpha?.client_id).toBe(CLIENT1);
    const beta = db.insertCalls('projects').find((r) => r.id === PR2);
    expect(beta?.client_id).toBeNull();
  });

  it('imports comments (mapping author + mentions) and skips orphan parents', async () => {
    const data = plannerFixture();
    const db = seedProfiles(new FakeDb());
    const result = await runSupabaseImport(data, buildDryRunReport(data), db);

    expect(sumFor(result, 'comments')).toMatchObject({ imported: 1, failed: 1 });
    const inserted = db.insertCalls('comments').find((r) => r.id === CM1);
    expect(inserted).toMatchObject({ task_id: T1, author_id: PROFILE_A });
    // Unmappable mention 'ghost' dropped; localB mapped.
    expect(inserted?.mention_ids).toEqual([PROFILE_B]);
    // Orphan comment failed with a diagnostic, never inserted.
    expect(db.insertCalls('comments').some((r) => r.id === CM_ORPHAN)).toBe(false);
    expect(result.diagnostics.some((d) => d.collection === 'comments' && d.entityId === CM_ORPHAN)).toBe(true);
  });

  it('imports activity with actor mapping and a typed task FK; rerun is idempotent', async () => {
    const data = plannerFixture();
    const db = seedProfiles(new FakeDb());
    const first = await runSupabaseImport(data, buildDryRunReport(data), db);
    expect(sumFor(first, 'activity')).toMatchObject({ imported: 1, failed: 0 });
    const row = db.insertCalls('activity_events').find((r) => r.id === AC1);
    expect(row).toMatchObject({ entity_type: 'task', entity_id: T1, task_id: T1, actor_id: PROFILE_A });
    // created_by is left to the server default (auth.uid()).
    expect('created_by' in (row ?? {})).toBe(false);

    const second = await runSupabaseImport(data, buildDryRunReport(data), db);
    expect(sumFor(second, 'clients').imported).toBe(0);
    expect(sumFor(second, 'comments').imported).toBe(0);
    expect(sumFor(second, 'activity').imported).toBe(0);
    expect(db.rows('activity_events')).toHaveLength(1);
  });
});

// ---- Adapter smoke ----------------------------------------------------------

describe('createSupabaseImportDb', () => {
  it('maps a thrown SDK error into { error } without throwing', async () => {
    const throwingClient = {
      from() {
        throw new Error('offline');
      },
    } as unknown as Parameters<typeof createSupabaseImportDb>[0];
    const db = createSupabaseImportDb(throwingClient);
    await expect(db.select('projects', 'id')).resolves.toEqual({ rows: [], error: 'offline' });
    await expect(db.insert('projects', { id: 'x' })).resolves.toEqual({ error: 'offline' });
  });

  // ---- Pagination -----------------------------------------------------------
  // Structural client stub: from(table).select(columns) returns a chainable,
  // thenable query builder that records in/order/range and resolves a slice.
  type RangeCall = [number, number];
  function makeSelectClient(opts: {
    rows: Array<Record<string, unknown>>;
    errorOnRangeFrom?: number; // resolve { data:null, error } once range.from >= this
  }) {
    const calls = {
      in: [] as Array<{ column: string; values: unknown[] }>,
      order: [] as string[],
      range: [] as RangeCall[],
    };
    const client = {
      from() {
        return {
          select() {
            let currentRange: RangeCall = [0, opts.rows.length];
            const builder: Record<string, unknown> = {
              in(column: string, values: unknown[]) {
                calls.in.push({ column, values });
                return builder;
              },
              order(col: string) {
                calls.order.push(col);
                return builder;
              },
              range(from: number, to: number) {
                calls.range.push([from, to]);
                currentRange = [from, to];
                return builder;
              },
              then(resolve: (v: unknown) => void) {
                const [from, to] = currentRange;
                if (opts.errorOnRangeFrom !== undefined && from >= opts.errorOnRangeFrom) {
                  resolve({ data: null, error: { message: 'boom' } });
                  return;
                }
                resolve({ data: opts.rows.slice(from, to + 1), error: null });
              },
            };
            return builder;
          },
        };
      },
    };
    return { client: client as unknown as Parameters<typeof createSupabaseImportDb>[0], calls };
  }

  const seedRows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: String(i) }));

  it('pages past the 1000-row cap and returns every row (2500)', async () => {
    const { client, calls } = makeSelectClient({ rows: seedRows(2500) });
    const db = createSupabaseImportDb(client);
    const res = await db.select('projects', 'id');
    expect(res.error).toBeNull();
    expect(res.rows).toHaveLength(2500);
    expect(calls.range).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it('terminates on a count exactly divisible by the page size (1000)', async () => {
    const { client, calls } = makeSelectClient({ rows: seedRows(SELECT_PAGE_SIZE) });
    const db = createSupabaseImportDb(client);
    const res = await db.select('projects', 'id');
    expect(res.error).toBeNull();
    expect(res.rows).toHaveLength(1000);
    // First full page, then an empty page proves exhaustion.
    expect(calls.range).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it('returns an empty result for an empty table (single page)', async () => {
    const { client, calls } = makeSelectClient({ rows: [] });
    const db = createSupabaseImportDb(client);
    const res = await db.select('projects', 'id');
    expect(res).toEqual({ rows: [], error: null });
    expect(calls.range).toEqual([[0, 999]]);
  });

  it('discards accumulated rows when an error hits on page >= 2', async () => {
    const { client } = makeSelectClient({ rows: seedRows(1500), errorOnRangeFrom: SELECT_PAGE_SIZE });
    const db = createSupabaseImportDb(client);
    const res = await db.select('projects', 'id');
    expect(res).toEqual({ rows: [], error: 'boom' });
  });

  it('orders by every selected column and applies inFilter on every page', async () => {
    const { client, calls } = makeSelectClient({ rows: seedRows(2500) });
    const db = createSupabaseImportDb(client);
    const res = await db.select('projects', 'id, name', { column: 'id', values: ['a', 'b'] });
    expect(res.rows).toHaveLength(2500);
    // .order once per column per page (3 pages * 2 columns).
    expect(calls.order).toEqual(['id', 'name', 'id', 'name', 'id', 'name']);
    // .in re-applied on the fresh query built for each page.
    expect(calls.in).toEqual([
      { column: 'id', values: ['a', 'b'] },
      { column: 'id', values: ['a', 'b'] },
      { column: 'id', values: ['a', 'b'] },
    ]);
  });
});

// ---- Milestones + workload (retirement migration) ---------------------------

describe('runSupabaseImport — milestones + workload', () => {
  it('imports milestones and workload after their parents, idempotently', async () => {
    const data: AppData = {
      ...fixture(),
      milestones: [{ id: uuid('ms1'), projectId: PR1, name: 'Publikacja', date: '2026-07-10' }],
      workload: [
        { id: uuid('wl1'), taskId: T1, personId: 'localA', date: '2026-07-06', plannedHours: 2, startMinutes: 480, sortIndex: 0 },
        { id: uuid('wl-bin'), taskId: T1, personId: 'localA', date: '', plannedHours: 1, startMinutes: 0, sortIndex: 1 },
      ],
    };
    const report = buildDryRunReport(data);
    expect(report.blockers).toHaveLength(0);
    const db = seedProfiles(new FakeDb());
    const result = await runSupabaseImport(data, report, db);
    expect(result.completed).toBe(true);
    expect(sumFor(result, 'milestones').imported).toBe(1);
    expect(sumFor(result, 'workload').imported).toBe(2);
    expect(db.insertCalls('milestones')[0]).toMatchObject({ project_id: PR1, milestone_date: '2026-07-10' });
    const wlRows = db.insertCalls('workload_entries');
    expect(wlRows).toHaveLength(2);
    expect(wlRows.find((r) => r.work_date === null)).toBeDefined(); // bin -> null
    expect(wlRows.find((r) => r.profile_id === PROFILE_A)).toBeDefined();

    // Idempotent rerun: everything present -> skipped, nothing re-imported.
    const rerun = await runSupabaseImport(data, report, db);
    expect(sumFor(rerun, 'milestones').imported).toBe(0);
    expect(sumFor(rerun, 'workload').imported).toBe(0);
    expect(sumFor(rerun, 'workload').skipped).toBe(2);
  });

  it('fails a workload row whose person cannot be mapped to a profile', async () => {
    const data: AppData = {
      ...fixture(),
      workload: [{ id: uuid('wl-x'), taskId: T1, personId: 'ghost', date: '', plannedHours: 1, startMinutes: 0, sortIndex: 0 }],
    };
    const report = buildDryRunReport(data);
    const db = seedProfiles(new FakeDb());
    const result = await runSupabaseImport(data, report, db);
    expect(sumFor(result, 'workload').failed).toBe(1);
    expect(sumFor(result, 'workload').imported).toBe(0);
  });
});

// ---- Batching + per-row fallback -------------------------------------------

describe('runSupabaseImport — batching + per-row fallback', () => {
  it('happy path flushes via insertMany with zero per-row insert calls', async () => {
    const data = fixture();
    const db = seedProfiles(new FakeDb());
    await runSupabaseImport(data, buildDryRunReport(data), db);

    // No per-row `insert` anywhere on the happy path — batch-only economy.
    expect(db.calls.filter((c) => c.op === 'insert')).toHaveLength(0);
    // One batch per non-empty collection (≤100-row chunk).
    for (const table of ['departments', 'projects', 'tasks', 'project_members', 'task_assignments']) {
      expect(db.calls.some((c) => c.op === 'insertMany' && c.table === table)).toBe(true);
    }
  });

  it('a mid-batch failing row falls back per-row, attributing only that row', async () => {
    const P1 = uuid('proj-1');
    const P2 = uuid('proj-2');
    const P3 = uuid('proj-3');
    const data: AppData = {
      ...fixture(),
      projects: [
        makeProject({ id: P1, name: 'P1', departmentId: D1 }),
        makeProject({ id: P2, name: 'P2', departmentId: D1 }),
        makeProject({ id: P3, name: 'P3', departmentId: D1 }),
      ],
      tasks: [],
      assignments: [],
    };
    const db = seedProfiles(new FakeDb());
    db.failInsert = (table, row) => (table === 'projects' && row.id === P2 ? 'boom' : null);
    const result = await runSupabaseImport(data, buildDryRunReport(data), db);

    // The batch is tried first, then per-row fallback engages for that chunk.
    const projectCalls = db.calls.filter((c) => c.table === 'projects' && c.op !== 'select');
    expect(projectCalls[0].op).toBe('insertMany');
    expect(projectCalls.some((c) => c.op === 'insert')).toBe(true);

    // Only P2 is attributed as failed; P1 and P3 land; siblings still imported.
    expect(sumFor(result, 'projects')).toMatchObject({ imported: 2, failed: 1 });
    const diags = result.diagnostics.filter((d) => d.collection === 'projects');
    expect(diags).toHaveLength(1);
    expect(diags[0].entityId).toBe(P2);
    expect(diags[0].message.startsWith('Zapis nie powiódł się')).toBe(true);
    expect(db.insertCalls('projects').map((r) => r.id as string).sort()).toEqual([P1, P3].sort());
  });
});

// ---- Flush-on-dependency (dictionaries + departments) -----------------------

describe('runSupabaseImport — flush-on-dependency', () => {
  const A = uuid('st-a');
  const B = uuid('st-b');

  function twoSharedSlug(): AppData {
    return {
      ...refFixture(),
      statuses: [
        makeStatus({ id: A, slug: 'todo', isDone: false }),
        makeStatus({ id: B, slug: 'todo', isDone: true }), // same trimmed slug
      ],
      serviceTypes: [],
      workCategories: [],
    };
  }

  it('second item maps to the first (skip-by-key) when the first insert succeeds', async () => {
    const data = twoSharedSlug();
    const db = new FakeDb();
    const result = await runSupabaseImport(data, buildDryRunReport(data), db);

    expect(sumFor(result, 'statuses')).toMatchObject({ imported: 1, skipped: 1, failed: 0 });
    // Exactly one row with that slug landed (no duplicate insert of B).
    expect(db.rows('statuses').filter((r) => r.slug === 'todo')).toHaveLength(1);
    expect(db.insertCalls('statuses').map((r) => r.id)).toEqual([A]);
  });

  it('second item inserts itself when the first (shared-key) insert fails', async () => {
    const data = twoSharedSlug();
    const db = new FakeDb();
    db.failInsert = (table, row) => (table === 'statuses' && row.id === A ? 'boom' : null);
    const result = await runSupabaseImport(data, buildDryRunReport(data), db);

    // A fails; B becomes the key owner and lands — exactly the sequential outcome.
    expect(sumFor(result, 'statuses')).toMatchObject({ imported: 1, skipped: 0, failed: 1 });
    expect(db.rows('statuses').map((r) => r.id)).toEqual([B]);
    const diag = result.diagnostics.find((d) => d.collection === 'statuses' && d.entityId === A);
    expect(diag?.message.startsWith('Zapis nie powiódł się')).toBe(true);
  });
});
