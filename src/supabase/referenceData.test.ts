// Focused, node-only tests for the RLS-scoped org snapshot reader
// (referenceData.ts). A fake ReferenceDb returns exactly the rows RLS would
// hand back for each role — no SDK mocking, no live Supabase, no jsdom. Covers:
// snapshot mapping + sorting, own-profile resolution by auth user id, cloud→local
// role mapping, atomic failure on any select error, empty-as-valid, missing own
// profile => null, and the effectiveAccessRole fallback matrix.
import { describe, expect, it } from 'vitest';
import type { Person } from '../types';
import {
  ORG_SNAPSHOT_ERROR,
  cloudRoleToAccessRole,
  effectiveAccessRole,
  loadOrgSnapshot,
  type OrgSnapshot,
  type OrgState,
  type ReferenceDb,
} from './referenceData';

// ---- Fake ReferenceDb (returns what RLS would) ------------------------------

class FakeReferenceDb implements ReferenceDb {
  private tables: Record<string, Array<Record<string, unknown>>> = {};
  private errors: Record<string, string> = {};

  seed(table: string, rows: Array<Record<string, unknown>>): this {
    this.tables[table] = rows;
    return this;
  }
  failOn(table: string, error: string): this {
    this.errors[table] = error;
    return this;
  }

  async select(table: string) {
    if (this.errors[table]) return { rows: [], error: this.errors[table] };
    return { rows: (this.tables[table] ?? []).map((r) => ({ ...r })), error: null };
  }
}

// ---- Fixtures ---------------------------------------------------------------

const U_ADMIN = '11111111-1111-4111-8111-111111111111';
const U_MGR = '22222222-2222-4222-8222-222222222222';
const U_WORKER = '33333333-3333-4333-8333-333333333333';
const D_KRE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const D_STR = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const profileRow = (o: Record<string, unknown>) => ({
  id: '',
  first_name: '',
  last_name: '',
  email: '',
  role_title: '',
  access_role: 'worker',
  department_id: null,
  ...o,
});

/** Seeds the DB with the rows an ADMIN would see (everything). */
function seedAdminDb(): FakeReferenceDb {
  return new FakeReferenceDb()
    .seed('profiles', [
      profileRow({ id: U_ADMIN, first_name: 'Ada', last_name: 'Admin', email: 'ada@x.pl', access_role: 'administrator', role_title: 'Szef', department_id: D_KRE }),
      profileRow({ id: U_MGR, first_name: 'Marek', last_name: 'Menedżer', email: 'm@x.pl', access_role: 'manager', department_id: D_KRE, supervisor_id: U_ADMIN }),
      profileRow({ id: U_WORKER, first_name: 'Wera', last_name: 'Worker', email: 'w@x.pl', access_role: 'worker', department_id: D_STR }),
    ])
    .seed('departments', [
      { id: D_STR, name: 'Strategia' },
      { id: D_KRE, name: 'Kreacja' },
    ])
    .seed('statuses', [
      { id: 's2', name: 'Zrobione', slug: 'done', color: '#0f0', sort_order: 2, archived: false, is_done: true },
      { id: 's1', name: 'Do zrobienia', slug: 'todo', color: '#f00', sort_order: 1, archived: false, is_done: false },
    ])
    .seed('service_types', [
      { id: 'st2', name: 'Wideo' },
      { id: 'st1', name: 'Grafika' },
    ])
    .seed('work_categories', [{ id: 'wc1', name: 'Projekt' }]);
}

// ---- 1. Snapshot mapping + sorting ------------------------------------------

describe('loadOrgSnapshot — mapping i sortowanie (admin)', () => {
  it('mapuje wiersze na kształty frontendu, sortuje statusy i słowniki, rozwiązuje własny profil po id', async () => {
    const res = await loadOrgSnapshot(seedAdminDb(), U_ADMIN);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const snap = res.snapshot;

    // Własny profil po AUTH USER ID (nie e-mailu).
    expect(snap.profile?.id).toBe(U_ADMIN);
    expect(snap.profile?.cloudRole).toBe('administrator');
    expect(snap.profile?.departmentId).toBe(D_KRE);
    // Przełożony: brak kolumny/wartości → null, uuid przechodzi dosłownie.
    expect(snap.profile?.supervisorId).toBeNull();
    expect(snap.profiles.find((p) => p.id === U_MGR)?.supervisorId).toBe(U_ADMIN);

    expect(snap.profiles).toHaveLength(3);

    // Działy posortowane po nazwie.
    expect(snap.departments.map((d) => d.name)).toEqual(['Kreacja', 'Strategia']);

    // Statusy posortowane po sort_order → order.
    expect(snap.statuses.map((s) => s.slug)).toEqual(['todo', 'done']);
    expect(snap.statuses[0]).toMatchObject({ name: 'Do zrobienia', order: 1, isDone: false });
    expect(snap.statuses[1]).toMatchObject({ order: 2, isDone: true });

    // Słowniki posortowane po nazwie.
    expect(snap.serviceTypes.map((s) => s.name)).toEqual(['Grafika', 'Wideo']);
    expect(snap.workCategories.map((c) => c.name)).toEqual(['Projekt']);
  });
});

// ---- 2. Role-scoped rows (manager / worker) ---------------------------------

describe('loadOrgSnapshot — wiersze zscope\'owane przez RLS', () => {
  it('menedżer: wiersze własnego działu + własny profil, bez ponownego filtrowania', async () => {
    const db = new FakeReferenceDb()
      .seed('profiles', [
        profileRow({ id: U_MGR, first_name: 'Marek', access_role: 'manager', department_id: D_KRE }),
        profileRow({ id: U_WORKER, first_name: 'Wera', access_role: 'worker', department_id: D_KRE }),
      ])
      .seed('departments', [{ id: D_KRE, name: 'Kreacja' }]);
    const res = await loadOrgSnapshot(db, U_MGR);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.snapshot.profiles.map((p) => p.id).sort()).toEqual([U_MGR, U_WORKER].sort());
    expect(res.snapshot.profile?.cloudRole).toBe('manager');
    expect(res.snapshot.departments).toHaveLength(1);
  });

  it('pracownik: wyłącznie własny profil', async () => {
    const db = new FakeReferenceDb().seed('profiles', [
      profileRow({ id: U_WORKER, first_name: 'Wera', access_role: 'worker', department_id: D_STR }),
    ]);
    const res = await loadOrgSnapshot(db, U_WORKER);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.snapshot.profiles).toHaveLength(1);
    expect(res.snapshot.profile?.id).toBe(U_WORKER);
    expect(res.snapshot.profile?.cloudRole).toBe('worker');
  });
});

// ---- 3. Failure is atomic ---------------------------------------------------

describe('loadOrgSnapshot — atomowość i puste kolekcje', () => {
  it('dowolny błąd selectu psuje cały snapshot z jednym polskim komunikatem', async () => {
    for (const table of ['profiles', 'departments', 'statuses', 'service_types', 'work_categories']) {
      const db = seedAdminDb().failOn(table, 'boom-sdk-detail');
      const res = await loadOrgSnapshot(db, U_ADMIN);
      expect(res.ok).toBe(false);
      if (res.ok) continue;
      expect(res.error).toBe(ORG_SNAPSHOT_ERROR);
      // Surowy komunikat SDK nigdy nie wycieka.
      expect(res.error).not.toContain('boom');
    }
  });

  it('puste kolekcje są POPRAWNE (ok) z pustymi tablicami', async () => {
    const res = await loadOrgSnapshot(new FakeReferenceDb(), U_ADMIN);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.snapshot).toMatchObject<Partial<OrgSnapshot>>({
      profile: null,
      profiles: [],
      departments: [],
      statuses: [],
      serviceTypes: [],
      workCategories: [],
    });
  });

  it('brak własnego wiersza => profile: null (stan, nie błąd)', async () => {
    const db = new FakeReferenceDb().seed('profiles', [
      profileRow({ id: U_MGR, access_role: 'manager' }),
    ]);
    const res = await loadOrgSnapshot(db, U_WORKER);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.snapshot.profile).toBeNull();
    expect(res.snapshot.profiles).toHaveLength(1);
  });
});

// ---- 4. cloudRoleToAccessRole ----------------------------------------------

describe('cloudRoleToAccessRole', () => {
  it('mapuje odwrotnie do frontendu (handlowiec kolapsuje do worker semantyki)', () => {
    expect(cloudRoleToAccessRole('administrator')).toBe('administrator');
    expect(cloudRoleToAccessRole('manager')).toBe('pm');
    expect(cloudRoleToAccessRole('worker')).toBe('pracownik');
  });
});

// ---- 5. effectiveAccessRole matrix ------------------------------------------

describe('effectiveAccessRole — macierz fallbacków', () => {
  const localUser: Person = {
    id: 'local', firstName: 'L', lastName: '', name: 'L', email: '', phone: '', role: '',
    departmentId: '', avatar: '', capacity: 8, accessRole: 'handlowiec', passwordHash: '',
    workDays: [1, 2, 3, 4, 5], workStartMinutes: 480, workEndMinutes: 960, supervisorId: '',
  };
  const ready: OrgState = {
    status: 'ready',
    snapshot: {
      profile: { id: 'cloud', firstName: 'C', lastName: '', email: '', roleTitle: '', cloudRole: 'manager', departmentId: null, supervisorId: null },
      profiles: [], departments: [], statuses: [], serviceTypes: [], workCategories: [],
    },
  };
  const readyNoProfile: OrgState = { status: 'ready', snapshot: { ...ready.snapshot, profile: null } as OrgSnapshot };

  it('tryb supabase + ready + własny profil + nie personifikacja => rola chmury', () => {
    expect(effectiveAccessRole(localUser, ready, { mode: 'supabase', impersonating: false })).toBe('pm');
  });

  it('personifikacja => rola lokalna', () => {
    expect(effectiveAccessRole(localUser, ready, { mode: 'supabase', impersonating: true })).toBe('handlowiec');
  });

  it('tryb lokalny => rola lokalna', () => {
    expect(effectiveAccessRole(localUser, ready, { mode: 'local', impersonating: false })).toBe('handlowiec');
  });

  it('ładowanie / błąd / idle => rola lokalna', () => {
    for (const org of [{ status: 'idle' }, { status: 'loading' }, { status: 'error', message: 'x' }] as OrgState[]) {
      expect(effectiveAccessRole(localUser, org, { mode: 'supabase', impersonating: false })).toBe('handlowiec');
    }
  });

  it('brak profilu w chmurze => rola lokalna', () => {
    expect(effectiveAccessRole(localUser, readyNoProfile, { mode: 'supabase', impersonating: false })).toBe('handlowiec');
  });

  it('brak użytkownika => undefined', () => {
    expect(effectiveAccessRole(undefined, ready, { mode: 'supabase', impersonating: false })).toBeUndefined();
    expect(effectiveAccessRole(undefined, ready, { mode: 'local', impersonating: false })).toBeUndefined();
  });
});
