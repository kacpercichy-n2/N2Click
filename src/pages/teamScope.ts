// Czysta logika obszaru „Zespół": widoczność zależna od roli, budowanie
// hierarchii działów/osób oraz stan i walidacja formularza zakładania konta.
//
// Moduł jest CELOWO pozbawiony zależności od Reacta, DOM-u i localStorage —
// przyjmuje zwykłe dane (people/departments) i deleguje walidację do czystego
// kontraktu Edge Function. Dzięki temu jest testowalny w środowisku node bez
// jsdom (patrz vitest.config.ts, environment: 'node').
import type { Department, Person } from '../types';
import type { CloudProfile } from '../supabase/referenceData';
import { ROLE_LABELS } from '../store/permissions';
import {
  parseProvisionRequest,
  type AccessRole as ProvisionAccessRole,
  type ParseResult,
} from '../../supabase/functions/provision-account/contract';

// --- Widoczność obszaru „Zespół" ---------------------------------------------

/**
 * Efektywny zakres widoczności obszaru „Zespół" dla bieżącego użytkownika.
 * Mapowanie ról (zgodnie z komentarzem w migracji rdzenia): lokalny `pracownik`
 * i `handlowiec` = worker → obszar UKRYTY; `pm` = manager → wyłącznie własny
 * dział; `administrator` → wszystkie działy. To gate UX — realny zakres wymusza
 * serwer (RLS), nie ten kod.
 */
export type TeamAccess =
  | { visible: false }
  | { visible: true; scope: 'all' }
  | { visible: true; scope: 'department'; departmentId: string };

export function teamAccessForUser(user: Person | undefined): TeamAccess {
  if (!user) return { visible: false };
  switch (user.accessRole) {
    case 'administrator':
      return { visible: true, scope: 'all' };
    case 'pm':
      return { visible: true, scope: 'department', departmentId: user.departmentId };
    // 'handlowiec' oraz 'pracownik' → worker: brak dostępu do obszaru.
    default:
      return { visible: false };
  }
}

/** Czy obszar „Zespół" jest w ogóle widoczny dla użytkownika (nav + trasa). */
export function canViewTeam(user: Person | undefined): boolean {
  return teamAccessForUser(user).visible;
}

// --- Hierarchia działów i osób -----------------------------------------------

export interface TeamPersonView {
  id: string;
  name: string;
  /** Stanowisko (job title) — pole `role`. '' gdy nieustawione. */
  roleTitle: string;
  /** Polska etykieta roli dostępu (ROLE_LABELS). */
  accessRoleLabel: string;
  /** Nazwa przełożonego; '' gdy brak. */
  supervisorName: string;
}

export interface TeamDepartmentView {
  /** Id działu; '' dla syntetycznej grupy „Bez działu". */
  id: string;
  name: string;
  people: TeamPersonView[];
}

/** Etykieta syntetycznej grupy osób bez przypisanego działu. */
export const NO_DEPARTMENT_LABEL = 'Bez działu';

function toPersonView(person: Person, nameById: Map<string, string>): TeamPersonView {
  return {
    id: person.id,
    name: person.name,
    roleTitle: person.role,
    accessRoleLabel: ROLE_LABELS[person.accessRole] ?? '',
    supervisorName: person.supervisorId ? nameById.get(person.supervisorId) ?? '' : '',
  };
}

/**
 * Buduje widoczną hierarchię działów → osób dla danego zakresu dostępu.
 * Administrator (`scope: 'all'`) widzi wszystkie działy oraz grupę „Bez działu"
 * dla osób bez (lub z nieznanym) działem. Menedżer (`scope: 'department'`) widzi
 * wyłącznie własny dział. Brak dostępu → pusta lista.
 */
export function buildTeamHierarchy(
  people: Person[],
  departments: Department[],
  access: TeamAccess,
): TeamDepartmentView[] {
  if (!access.visible) return [];
  const nameById = new Map(people.map((p) => [p.id, p.name]));
  const knownDeptIds = new Set(departments.map((d) => d.id));
  const groups: TeamDepartmentView[] = [];

  for (const dept of departments) {
    if (access.scope === 'department' && dept.id !== access.departmentId) continue;
    const members = people.filter((p) => p.departmentId === dept.id);
    groups.push({
      id: dept.id,
      name: dept.name,
      people: members.map((p) => toPersonView(p, nameById)),
    });
  }

  // Grupa „Bez działu" tylko dla administratora — menedżer jest scope'owany do
  // własnego działu.
  if (access.scope === 'all') {
    const orphans = people.filter((p) => p.departmentId === '' || !knownDeptIds.has(p.departmentId));
    if (orphans.length > 0) {
      groups.push({
        id: '',
        name: NO_DEPARTMENT_LABEL,
        people: orphans.map((p) => toPersonView(p, nameById)),
      });
    }
  }

  return groups;
}

// --- Hierarchia z chmury (tryb supabase) -------------------------------------

/**
 * Polskie etykiety ról CHMURY (public.access_role: administrator/manager/worker).
 * `manager` to „Menedżer", `worker` to „Pracownik" — mapowanie RLS, nie lokalne
 * cztery role planera.
 */
const CLOUD_ROLE_LABELS: Record<CloudProfile['cloudRole'], string> = {
  administrator: 'Administrator',
  manager: 'Menedżer',
  worker: 'Pracownik',
};

/** Nazwa wyświetlana profilu chmury (imię+nazwisko → e-mail → placeholder). */
export function cloudProfileName(p: CloudProfile): string {
  return `${p.firstName} ${p.lastName}`.trim() || p.email || '(bez nazwy)';
}

function cloudPersonView(p: CloudProfile, nameById: Map<string, string>): TeamPersonView {
  return {
    id: p.id,
    name: cloudProfileName(p),
    roleTitle: p.roleTitle,
    accessRoleLabel: CLOUD_ROLE_LABELS[p.cloudRole],
    // Przełożony spoza widocznego (RLS) zbioru profili → '' (bez wiersza).
    supervisorName: p.supervisorId ? nameById.get(p.supervisorId) ?? '' : '',
  };
}

/**
 * Buduje hierarchię działów → osób z surowych, już zscope'owanych przez RLS
 * wierszy chmury (administrator: wszystko, menedżer: własny dział, pracownik:
 * tylko siebie). NIE filtruje ponownie — wyłącznie grupuje. Grupa „Bez działu"
 * pojawia się tylko, gdy istnieją profile spoza znanych działów. Puste wejście
 * (brak działów i profili) → pusta lista.
 */
export function buildCloudTeamHierarchy(
  profiles: CloudProfile[],
  departments: Department[],
): TeamDepartmentView[] {
  const knownDeptIds = new Set(departments.map((d) => d.id));
  const nameById = new Map(profiles.map((p) => [p.id, cloudProfileName(p)]));
  const view = (p: CloudProfile): TeamPersonView => cloudPersonView(p, nameById);
  const groups: TeamDepartmentView[] = [];

  for (const dept of departments) {
    const members = profiles.filter((p) => p.departmentId === dept.id);
    groups.push({ id: dept.id, name: dept.name, people: members.map(view) });
  }

  const orphans = profiles.filter(
    (p) => p.departmentId === null || !knownDeptIds.has(p.departmentId),
  );
  if (orphans.length > 0) {
    groups.push({ id: '', name: NO_DEPARTMENT_LABEL, people: orphans.map(view) });
  }

  return groups;
}

// --- Formularz zakładania konta ----------------------------------------------

/** Polskie etykiety ról dostępu systemowego (kontrakt provisioningu). */
export const PROVISION_ROLE_LABELS: Record<ProvisionAccessRole, string> = {
  administrator: 'Administrator',
  manager: 'Menedżer',
  worker: 'Pracownik',
};

/** Stan formularza zakładania konta. Działy/menedżer to UUID-y serwerowe. */
export interface ProvisionFormState {
  firstName: string;
  lastName: string;
  email: string;
  roleTitle: string;
  /** UUID działu serwerowego albo '' (brak). */
  departmentId: string;
  /** UUID profilu menedżera albo '' (brak). */
  managerProfileId: string;
  accessRole: ProvisionAccessRole;
}

export function emptyProvisionForm(): ProvisionFormState {
  return {
    firstName: '',
    lastName: '',
    email: '',
    roleTitle: '',
    departmentId: '',
    managerProfileId: '',
    accessRole: 'worker',
  };
}

/**
 * Waliduje stan formularza reużywając czystego `parseProvisionRequest` z
 * kontraktu (bez duplikowania reguł). Zwraca znormalizowany ładunek żądania
 * (tryb hasła zawsze `invite` — zero haseł w UI) albo polski komunikat błędu.
 * Pusty select działu/menedżera mapujemy na `null`.
 */
export function buildProvisionRequest(form: ProvisionFormState): ParseResult {
  return parseProvisionRequest(
    {
      firstName: form.firstName,
      lastName: form.lastName,
      email: form.email,
      roleTitle: form.roleTitle,
      departmentId: form.departmentId || null,
      managerProfileId: form.managerProfileId || null,
      accessRole: form.accessRole,
      initialPassword: { mode: 'invite' },
    },
    { allowedEmailDomains: [] },
  );
}
