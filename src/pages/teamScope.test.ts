// Testy czystej logiki obszaru „Zespół": widoczność ról, hierarchia oraz
// walidacja formularza (reużycie kontraktu). Środowisko node, bez jsdom.
import { describe, expect, it } from 'vitest';
import {
  NO_DEPARTMENT_LABEL,
  PROVISION_ROLE_OPTIONS,
  buildCloudTeamHierarchy,
  buildOrgChart,
  buildProvisionRequest,
  buildTeamHierarchy,
  canViewTeam,
  emptyProvisionForm,
  teamAccessForUser,
  type OrgChartInput,
  type OrgChartNode,
  type ProvisionFormState,
} from './teamScope';
import type { CloudProfile } from '../supabase/referenceData';
import type { AccessRole, Department, Person } from '../types';
import {
  DEFAULT_INITIAL_PASSWORD,
  PROVISIONING_MESSAGES,
} from '../../supabase/functions/provision-account/contract';

const UUID_DEP = '123e4567-e89b-12d3-a456-426614174000';
const UUID_MGR = '223e4567-e89b-12d3-a456-426614174999';

function person(overrides: Partial<Person> = {}): Person {
  return {
    id: overrides.id ?? 'p1',
    firstName: 'Ala',
    lastName: 'Kowalska',
    name: 'Ala Kowalska',
    email: '',
    phone: '',
    role: '',
    departmentId: '',
    companyId: '',
    avatar: '',
    capacity: 8,
    accessRole: 'pelne',
    passwordHash: '',
    workDays: [1, 2, 3, 4, 5],
    workStartMinutes: 480,
    workEndMinutes: 960,
    supervisorId: '',
    birthDate: '',
    ...overrides,
  };
}

describe('teamAccessForUser / canViewTeam — po kolapsie ról', () => {
  it('daje każdemu zalogowanemu (rola „pełne") zakres wszystkich działów', () => {
    const user = person({ accessRole: 'pelne' });
    expect(teamAccessForUser(user)).toEqual({ visible: true, scope: 'all' });
    expect(canViewTeam(user)).toBe(true);
  });

  it('daje każdemu zalogowanemu (rola „ograniczone") zakres wszystkich działów', () => {
    const user = person({ accessRole: 'ograniczone', departmentId: 'dep-marketing' });
    expect(teamAccessForUser(user)).toEqual({ visible: true, scope: 'all' });
    expect(canViewTeam(user)).toBe(true);
  });

  it('ukrywa obszar dla braku użytkownika', () => {
    expect(teamAccessForUser(undefined)).toEqual({ visible: false });
    expect(canViewTeam(undefined)).toBe(false);
  });
});

describe('buildTeamHierarchy', () => {
  const departments: Department[] = [
    { id: 'd-design', name: 'Design i IT' },
    { id: 'd-mkt', name: 'Marketing' },
    { id: 'd-prod', name: 'Produkcja' },
    { id: 'd-sales', name: 'Dział handlowy' },
  ];
  const people: Person[] = [
    person({ id: 'boss', name: 'Szef Działu', accessRole: 'pelne', departmentId: 'd-mkt', role: 'Kierownik' }),
    person({ id: 'm1', name: 'Marek Marketing', departmentId: 'd-mkt', role: 'Specjalista', supervisorId: 'boss' }),
    person({ id: 'des', name: 'Dorota Design', departmentId: 'd-design', role: 'Projektantka' }),
    person({ id: 'lost', name: 'Bez Działu', departmentId: '' }),
    person({ id: 'ghost', name: 'Nieznany Dział', departmentId: 'd-usuniety' }),
  ];

  it('zwraca pustą listę bez dostępu', () => {
    expect(buildTeamHierarchy(people, departments, { visible: false })).toEqual([]);
  });

  it('każdy zalogowany widzi wszystkie działy oraz grupę „Bez działu"', () => {
    const groups = buildTeamHierarchy(people, departments, { visible: true, scope: 'all' });
    const names = groups.map((g) => g.name);
    expect(names).toEqual([
      'Design i IT',
      'Marketing',
      'Produkcja',
      'Dział handlowy',
      NO_DEPARTMENT_LABEL,
    ]);
    // Osoby bez działu i z nieznanym działem trafiają do grupy „Bez działu".
    const orphan = groups.find((g) => g.id === '');
    expect(orphan?.people.map((p) => p.id).sort()).toEqual(['ghost', 'lost']);
  });

  it('renderuje stanowisko i przełożonego (etykieta roli dostępu zniknęła z widoku)', () => {
    const groups = buildTeamHierarchy(people, departments, { visible: true, scope: 'all' });
    const mkt = groups.find((g) => g.id === 'd-mkt')!;
    const marek = mkt.people.find((p) => p.id === 'm1')!;
    expect(marek.roleTitle).toBe('Specjalista');
    expect(marek.supervisorName).toBe('Szef Działu');
    const boss = mkt.people.find((p) => p.id === 'boss')!;
    expect(boss.supervisorName).toBe('');
  });
});

describe('buildCloudTeamHierarchy', () => {
  const cloud = (o: Partial<CloudProfile> & { id: string }): CloudProfile => ({
    firstName: 'Jan', lastName: 'Kowalski', email: 'jan@x.pl', roleTitle: '', cloudRole: 'worker',
    departmentId: null, companyId: null, supervisorId: null, phone: '', avatar: '', capacity: 8, workDays: [1, 2, 3, 4, 5], workStartMinutes: 480, workEndMinutes: 960, birthDate: '', ...o,
  });
  const departments: Department[] = [
    { id: 'd-kre', name: 'Kreacja' },
    { id: 'd-str', name: 'Strategia' },
  ];

  it('grupuje profile po dziale bez ponownego filtrowania i rozwiązuje przełożonego', () => {
    const profiles: CloudProfile[] = [
      cloud({ id: 'a', firstName: 'Ada', lastName: 'Admin', cloudRole: 'administrator', departmentId: 'd-kre', roleTitle: 'Szef' }),
      cloud({ id: 'm', firstName: 'Marek', cloudRole: 'manager', departmentId: 'd-str', supervisorId: 'a' }),
    ];
    const groups = buildCloudTeamHierarchy(profiles, departments);
    expect(groups.map((g) => g.name)).toEqual(['Kreacja', 'Strategia']);
    const ada = groups[0].people[0];
    expect(ada).toMatchObject({ name: 'Ada Admin', roleTitle: 'Szef', supervisorName: '' });
    expect(groups[1].people[0].supervisorName).toBe('Ada Admin');
  });

  it('przełożony spoza widocznego (RLS) zbioru profili => supervisorName pusty', () => {
    const groups = buildCloudTeamHierarchy(
      [cloud({ id: 'm', firstName: 'Marek', departmentId: 'd-kre', supervisorId: 'niewidoczny' })],
      departments,
    );
    expect(groups[0].people[0].supervisorName).toBe('');
  });

  it('dodaje grupę „Bez działu" tylko gdy istnieją profile spoza znanych działów', () => {
    const profiles: CloudProfile[] = [
      cloud({ id: 'orphan', departmentId: null }),
      cloud({ id: 'ghost', departmentId: 'd-usuniety' }),
      cloud({ id: 'in', departmentId: 'd-kre' }),
    ];
    const groups = buildCloudTeamHierarchy(profiles, departments);
    const orphan = groups.find((g) => g.id === '');
    expect(orphan?.name).toBe(NO_DEPARTMENT_LABEL);
    expect(orphan?.people.map((p) => p.id).sort()).toEqual(['ghost', 'orphan']);
  });

  it('brak grupy „Bez działu" gdy wszyscy mają znany dział', () => {
    const groups = buildCloudTeamHierarchy([cloud({ id: 'in', departmentId: 'd-kre' })], departments);
    expect(groups.some((g) => g.id === '')).toBe(false);
  });

  it('puste wejście => pusta lista', () => {
    expect(buildCloudTeamHierarchy([], [])).toEqual([]);
  });

  it('używa e-maila gdy brak imienia i nazwiska', () => {
    const groups = buildCloudTeamHierarchy(
      [cloud({ id: 'x', firstName: '', lastName: '', email: 'only@x.pl', departmentId: 'd-kre' })],
      departments,
    );
    expect(groups[0].people[0].name).toBe('only@x.pl');
  });
});

describe('buildOrgChart — drzewo struktury z relacji przełożony → podwładny', () => {
  const item = (id: string, name: string, supervisorId = ''): OrgChartInput => ({
    id,
    name,
    supervisorId,
  });
  // Zwraca zwięzłą reprezentację drzewa: id → posortowane dzieci (rekurencyjnie).
  const shape = (nodes: OrgChartNode[]): Record<string, unknown> =>
    Object.fromEntries(nodes.map((n) => [n.id, shape(n.children)]));

  it('puste wejście => brak korzeni i brak cyklu', () => {
    expect(buildOrgChart([])).toEqual({ roots: [], hasCycle: false });
  });

  it('buduje drzewo, sortuje korzenie i dzieci po nazwie (locale pl)', () => {
    const chart = buildOrgChart([
      item('boss', 'Zenon'),
      item('a', 'Ala', 'boss'),
      item('b', 'Świętosław', 'boss'),
      item('c', 'Ćma', 'boss'),
      item('sub', 'Adam', 'a'),
    ]);
    expect(chart.hasCycle).toBe(false);
    // Jeden korzeń „Zenon"; dzieci posortowane po polsku: Ala, Ćma, Świętosław.
    expect(shape(chart.roots)).toEqual({
      boss: { a: { sub: {} }, c: {}, b: {} },
    });
  });

  it('sierota wskazująca usuniętego/niewidocznego przełożonego => korzeń', () => {
    const chart = buildOrgChart([item('lost', 'Zaginiony', 'nieistnieje')]);
    expect(chart.hasCycle).toBe(false);
    expect(chart.roots.map((r) => r.id)).toEqual(['lost']);
    expect(chart.roots[0].inCycle).toBe(false);
  });

  it('wykrywa cykl A→B→A: obaj oznaczeni inCycle i awansowani do korzenia', () => {
    const chart = buildOrgChart([item('a', 'Anna', 'b'), item('b', 'Bartek', 'a')]);
    expect(chart.hasCycle).toBe(true);
    const roots = chart.roots;
    expect(roots.map((r) => r.id).sort()).toEqual(['a', 'b']);
    expect(roots.every((r) => r.inCycle)).toBe(true);
  });

  it('samopodległość (A→A) to cykl długości 1', () => {
    const chart = buildOrgChart([item('a', 'Anna', 'a')]);
    expect(chart.hasCycle).toBe(true);
    expect(chart.roots).toHaveLength(1);
    expect(chart.roots[0]).toMatchObject({ id: 'a', inCycle: true });
    expect(chart.roots[0].children).toEqual([]);
  });

  it('podwładny spoza cyklu wisi pod członkiem cyklu (render bez zapętlenia)', () => {
    // A↔B cykl; C podlega A (poza cyklem). C renderuje się pod A w korzeniu.
    const chart = buildOrgChart([
      item('a', 'Anna', 'b'),
      item('b', 'Bartek', 'a'),
      item('c', 'Celina', 'a'),
    ]);
    expect(chart.hasCycle).toBe(true);
    const a = chart.roots.find((r) => r.id === 'a')!;
    const b = chart.roots.find((r) => r.id === 'b')!;
    expect(a.inCycle && b.inCycle).toBe(true);
    expect(a.children.map((c) => c.id)).toEqual(['c']);
    expect(a.children[0].inCycle).toBe(false);
    expect(b.children).toEqual([]);
  });

  it('rozłączne poddrzewa i cykl współistnieją niezależnie', () => {
    const chart = buildOrgChart([
      item('root', 'Root'),
      item('kid', 'Kid', 'root'),
      item('x', 'Xena', 'y'),
      item('y', 'Yeti', 'x'),
    ]);
    expect(chart.hasCycle).toBe(true);
    expect(chart.roots.map((r) => r.id).sort()).toEqual(['root', 'x', 'y']);
    const root = chart.roots.find((r) => r.id === 'root')!;
    expect(root.inCycle).toBe(false);
    expect(root.children.map((c) => c.id)).toEqual(['kid']);
  });
});

describe('PROVISION_ROLE_OPTIONS', () => {
  it('daje dwie opcje selecta: administrator→Pełne, worker→Ograniczone', () => {
    expect(PROVISION_ROLE_OPTIONS).toEqual([
      { value: 'administrator', label: 'Pełne' },
      { value: 'worker', label: 'Ograniczone' },
    ]);
  });
});

describe('buildProvisionRequest — walidacja (reużycie kontraktu)', () => {
  const valid: ProvisionFormState = {
    firstName: '  Jan ',
    lastName: ' Nowak ',
    email: '  Jan.Nowak@Firma.PL ',
    roleTitle: ' Specjalista ',
    departmentId: UUID_DEP,
    managerProfileId: UUID_MGR,
    accessRole: 'worker',
  };

  it('normalizuje i buduje żądanie z bazowym hasłem startowym', () => {
    const result = buildProvisionRequest(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        firstName: 'Jan',
        lastName: 'Nowak',
        email: 'jan.nowak@firma.pl',
        roleTitle: 'Specjalista',
        departmentId: UUID_DEP,
        managerProfileId: UUID_MGR,
        accessRole: 'worker',
        initialPassword: { mode: 'temporary-password', password: DEFAULT_INITIAL_PASSWORD },
      });
    }
  });

  it('mapuje pusty dział i menedżera na null', () => {
    const result = buildProvisionRequest({ ...valid, departmentId: '', managerProfileId: '' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.departmentId).toBeNull();
      expect(result.value.managerProfileId).toBeNull();
    }
  });

  it('odrzuca brak imienia polskim komunikatem kontraktu', () => {
    const result = buildProvisionRequest({ ...valid, firstName: '   ' });
    expect(result).toEqual({ ok: false, message: PROVISIONING_MESSAGES.firstNameRequired });
  });

  it('odrzuca niepoprawny e-mail', () => {
    const result = buildProvisionRequest({ ...valid, email: 'bez-malpy' });
    expect(result).toEqual({ ok: false, message: PROVISIONING_MESSAGES.emailInvalid });
  });

  it('odrzuca niepoprawny UUID działu', () => {
    const result = buildProvisionRequest({ ...valid, departmentId: 'nie-uuid' });
    expect(result).toEqual({ ok: false, message: PROVISIONING_MESSAGES.departmentIdInvalid });
  });

  it('emptyProvisionForm startuje z rolą administrator (pełne) i pustymi polami', () => {
    const form = emptyProvisionForm();
    expect(form.accessRole).toBe('administrator');
    expect(form.departmentId).toBe('');
    expect(form.managerProfileId).toBe('');
  });
});

// Test kontrolny: obie lokalne role po kolapsie mają zdefiniowaną widoczność
// (dokumentuje pełną enum lokalnych ról: pełne/ograniczone).
describe('kompletność mapowania ról', () => {
  it('każda lokalna rola ma zdefiniowaną widoczność', () => {
    const roles: AccessRole[] = ['pelne', 'ograniczone'];
    for (const role of roles) {
      const access = teamAccessForUser(person({ accessRole: role }));
      expect(typeof access.visible).toBe('boolean');
    }
  });
});
