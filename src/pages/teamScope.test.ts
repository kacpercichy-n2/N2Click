// Testy czystej logiki obszaru „Zespół": widoczność ról, hierarchia oraz
// walidacja formularza (reużycie kontraktu). Środowisko node, bez jsdom.
import { describe, expect, it } from 'vitest';
import {
  NO_DEPARTMENT_LABEL,
  PROVISION_ROLE_LABELS,
  buildCloudTeamHierarchy,
  buildProvisionRequest,
  buildTeamHierarchy,
  canViewTeam,
  emptyProvisionForm,
  teamAccessForUser,
  type ProvisionFormState,
} from './teamScope';
import type { CloudProfile } from '../supabase/referenceData';
import type { AccessRole, Department, Person } from '../types';
import { PROVISIONING_MESSAGES } from '../../supabase/functions/provision-account/contract';

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
    avatar: '',
    capacity: 8,
    accessRole: 'pracownik',
    passwordHash: '',
    workDays: [1, 2, 3, 4, 5],
    workStartMinutes: 480,
    workEndMinutes: 960,
    supervisorId: '',
    ...overrides,
  };
}

describe('teamAccessForUser / canViewTeam — cztery role lokalne', () => {
  it('ukrywa obszar dla pracownika (worker)', () => {
    const user = person({ accessRole: 'pracownik' });
    expect(teamAccessForUser(user)).toEqual({ visible: false });
    expect(canViewTeam(user)).toBe(false);
  });

  it('ukrywa obszar dla handlowca (worker)', () => {
    const user = person({ accessRole: 'handlowiec' });
    expect(teamAccessForUser(user)).toEqual({ visible: false });
    expect(canViewTeam(user)).toBe(false);
  });

  it('daje menedżerowi (pm) zakres własnego działu', () => {
    const user = person({ accessRole: 'pm', departmentId: 'dep-marketing' });
    expect(teamAccessForUser(user)).toEqual({
      visible: true,
      scope: 'department',
      departmentId: 'dep-marketing',
    });
    expect(canViewTeam(user)).toBe(true);
  });

  it('daje administratorowi zakres wszystkich działów', () => {
    const user = person({ accessRole: 'administrator' });
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
    person({ id: 'boss', name: 'Szef Działu', accessRole: 'pm', departmentId: 'd-mkt', role: 'Kierownik' }),
    person({ id: 'm1', name: 'Marek Marketing', departmentId: 'd-mkt', role: 'Specjalista', supervisorId: 'boss' }),
    person({ id: 'des', name: 'Dorota Design', departmentId: 'd-design', role: 'Projektantka' }),
    person({ id: 'lost', name: 'Bez Działu', departmentId: '' }),
    person({ id: 'ghost', name: 'Nieznany Dział', departmentId: 'd-usuniety' }),
  ];

  it('zwraca pustą listę bez dostępu', () => {
    expect(buildTeamHierarchy(people, departments, { visible: false })).toEqual([]);
  });

  it('administrator widzi wszystkie działy oraz grupę „Bez działu"', () => {
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

  it('menedżer widzi wyłącznie własny dział', () => {
    const groups = buildTeamHierarchy(people, departments, {
      visible: true,
      scope: 'department',
      departmentId: 'd-mkt',
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('Marketing');
    expect(groups[0].people.map((p) => p.id).sort()).toEqual(['boss', 'm1']);
  });

  it('renderuje stanowisko, etykietę roli dostępu i przełożonego', () => {
    const groups = buildTeamHierarchy(people, departments, { visible: true, scope: 'all' });
    const mkt = groups.find((g) => g.id === 'd-mkt')!;
    const marek = mkt.people.find((p) => p.id === 'm1')!;
    expect(marek.roleTitle).toBe('Specjalista');
    expect(marek.accessRoleLabel).toBe('Pracownik');
    expect(marek.supervisorName).toBe('Szef Działu');
    const boss = mkt.people.find((p) => p.id === 'boss')!;
    expect(boss.accessRoleLabel).toBe('PM');
    expect(boss.supervisorName).toBe('');
  });
});

describe('buildCloudTeamHierarchy', () => {
  const cloud = (o: Partial<CloudProfile> & { id: string }): CloudProfile => ({
    firstName: 'Jan', lastName: 'Kowalski', email: 'jan@x.pl', roleTitle: '', cloudRole: 'worker',
    departmentId: null, ...o,
  });
  const departments: Department[] = [
    { id: 'd-kre', name: 'Kreacja' },
    { id: 'd-str', name: 'Strategia' },
  ];

  it('grupuje profile po dziale bez ponownego filtrowania i pomija wiersz przełożonego', () => {
    const profiles: CloudProfile[] = [
      cloud({ id: 'a', firstName: 'Ada', lastName: 'Admin', cloudRole: 'administrator', departmentId: 'd-kre', roleTitle: 'Szef' }),
      cloud({ id: 'm', firstName: 'Marek', cloudRole: 'manager', departmentId: 'd-str' }),
    ];
    const groups = buildCloudTeamHierarchy(profiles, departments);
    expect(groups.map((g) => g.name)).toEqual(['Kreacja', 'Strategia']);
    const ada = groups[0].people[0];
    expect(ada).toMatchObject({ name: 'Ada Admin', roleTitle: 'Szef', accessRoleLabel: 'Administrator', supervisorName: '' });
    expect(groups[1].people[0].accessRoleLabel).toBe('Menedżer');
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

describe('PROVISION_ROLE_LABELS', () => {
  it('mapuje trzy role dostępu na polskie etykiety', () => {
    expect(PROVISION_ROLE_LABELS).toEqual({
      administrator: 'Administrator',
      manager: 'Menedżer',
      worker: 'Pracownik',
    });
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

  it('normalizuje i buduje żądanie w trybie invite', () => {
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
        initialPassword: { mode: 'invite' },
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

  it('emptyProvisionForm startuje z rolą worker i pustymi polami', () => {
    const form = emptyProvisionForm();
    expect(form.accessRole).toBe('worker');
    expect(form.departmentId).toBe('');
    expect(form.managerProfileId).toBe('');
  });
});

// Test kontrolny: żaden akceptowany dla /team lokalny accessRole nie jest
// pominięty w mapowaniu (dokumentuje pełną enum lokalnych ról).
describe('kompletność mapowania ról', () => {
  it('każda lokalna rola ma zdefiniowaną widoczność', () => {
    const roles: AccessRole[] = ['administrator', 'pm', 'handlowiec', 'pracownik'];
    for (const role of roles) {
      const access = teamAccessForUser(person({ accessRole: role }));
      expect(typeof access.visible).toBe('boolean');
    }
  });
});
