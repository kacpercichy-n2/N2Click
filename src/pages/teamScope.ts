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
  DEFAULT_INITIAL_PASSWORD,
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
  /** Telefon kontaktowy; '' gdy brak (lista kontaktów zespołu). */
  phone: string;
  /** E-mail kontaktowy; '' gdy brak. */
  email: string;
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
    phone: person.phone,
    email: person.email,
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
    phone: p.phone,
    email: p.email,
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

// --- Drzewo struktury organizacyjnej (relacja przełożony → podwładny) --------

/** Węzeł drzewa struktury: id osoby, jej podwładni oraz flaga uczestnictwa w cyklu. */
export interface OrgChartNode {
  id: string;
  /**
   * true, gdy osoba należy do cyklu podległości (A→B→…→A). Takie osoby są
   * awansowane do korzenia (nie zapętlamy renderu), a widok oznacza je polską notą.
   */
  inCycle: boolean;
  children: OrgChartNode[];
}

export interface OrgChart {
  /** Korzenie: osoby bez (widocznego) przełożonego oraz członkowie cykli. */
  roots: OrgChartNode[];
  /** true, gdy w danych wykryto co najmniej jeden cykl podległości. */
  hasCycle: boolean;
}

/** Minimalne wejście selektora drzewa — niezależne od Reacta i modelu Person. */
export interface OrgChartInput {
  id: string;
  name: string;
  /** Id przełożonego; '' gdy brak. Cel spoza zbioru = sierota → korzeń. */
  supervisorId: string;
}

/**
 * Buduje drzewo struktury z relacji przełożony → podwładny nad już
 * zscope'owanym zbiorem osób. Czysta funkcja (bez Reacta/DOM) — testowalna w node.
 *
 * Odporność na wady danych:
 * - sierota wskazująca usuniętego/niewidocznego przełożonego → traktowana jak
 *   korzeń (efektywny rodzic = brak);
 * - cykle (także samopodległość A→A) → wykrywane strażnikiem odwiedzin; ich
 *   członkowie trafiają do korzenia z flagą `inCycle`, więc render się nie zapętla.
 *
 * Korzenie i dzieci są sortowane po nazwie (locale 'pl'), a przy remisie po id —
 * wynik jest deterministyczny niezależnie od kolejności wejścia.
 */
export function buildOrgChart(items: ReadonlyArray<OrgChartInput>): OrgChart {
  const byId = new Map(items.map((it) => [it.id, it]));

  // Efektywny rodzic: istniejący, różny od pustego wskaźnik na znany węzeł.
  // Samopodległość (id === supervisorId) zostawiamy — to cykl długości 1.
  const parent = new Map<string, string | null>();
  for (const it of items) {
    const sup = it.supervisorId;
    parent.set(it.id, sup !== '' && byId.has(sup) ? sup : null);
  }

  // Wykrycie cykli: dla każdej osoby idziemy w górę po rodzicach; trafienie na
  // węzeł „na ścieżce" (visiting) oznacza cykl — oznaczamy jego domknięcie.
  const inCycle = new Set<string>();
  const seen = new Map<string, 'visiting' | 'done'>();
  for (const start of byId.keys()) {
    if (seen.has(start)) continue;
    const path: string[] = [];
    const onPath = new Set<string>();
    let cur: string | null = start;
    while (cur !== null && !seen.has(cur)) {
      seen.set(cur, 'visiting');
      path.push(cur);
      onPath.add(cur);
      cur = parent.get(cur) ?? null;
    }
    if (cur !== null && onPath.has(cur)) {
      for (let i = path.indexOf(cur); i < path.length; i++) inCycle.add(path[i]);
    }
    for (const n of path) seen.set(n, 'done');
  }

  // Budowa lasu: członek cyklu → korzeń (krawędź do rodzica-w-cyklu pominięta,
  // więc mapa dzieci pozostaje acykliczna); pozostali podpięci pod rodzica.
  const childIds = new Map<string, string[]>();
  const rootIds: string[] = [];
  for (const it of items) {
    const p = parent.get(it.id) ?? null;
    if (inCycle.has(it.id) || p === null) {
      rootIds.push(it.id);
    } else {
      const list = childIds.get(p);
      if (list) list.push(it.id);
      else childIds.set(p, [it.id]);
    }
  }

  const byName = (a: string, b: string): number => {
    const na = byId.get(a)?.name ?? '';
    const nb = byId.get(b)?.name ?? '';
    return na.localeCompare(nb, 'pl') || a.localeCompare(b);
  };
  const build = (id: string): OrgChartNode => ({
    id,
    inCycle: inCycle.has(id),
    children: (childIds.get(id) ?? []).sort(byName).map(build),
  });

  return { roots: rootIds.sort(byName).map(build), hasCycle: inCycle.size > 0 };
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
 * (tryb hasła: bazowe hasło startowe wymuszające zmianę przy pierwszym
 * logowaniu) albo polski komunikat błędu. Pusty select działu/menedżera
 * mapujemy na `null`.
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
      initialPassword: { mode: 'temporary-password', password: DEFAULT_INITIAL_PASSWORD },
    },
    { allowedEmailDomains: [] },
  );
}
