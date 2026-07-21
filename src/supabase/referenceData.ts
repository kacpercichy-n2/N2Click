// Odczyty referencyjne i organizacyjne z Supabase (RLS-scoped selects).
//
// W trybie supabase snapshot organizacji jest AUTORYTATYWNY: profil, rola
// dostępu i widoczność zespołu sterują bramkami UX, a gotowy snapshot jest
// scalany w stan lokalny (App: MERGE_CLOUD_DICTIONARIES dla słowników,
// MERGE_CLOUD_PEOPLE dla zespołu — lokalne kopie są zastępowane, osoby bez
// konta chmury usuwane). Tryb lokalny korzysta wyłącznie z localStorage.
// Ładowanie/błąd w trybie supabase spada z powrotem na lokalną rolę na
// potrzeby bramek UX; autoryzacja i tak żyje po stronie serwera (RLS).
//
// Moduł jest CZYSTY i testowalny w node: cały dostęp do bazy idzie przez
// wstrzyknięty interfejs `ReferenceDb` (współdzielony z dataImport.ts). Bez
// mockowania SDK, bez żywego Supabase w vitest, bez jsdom.
import type {
  AccessRole,
  Department,
  Person,
  ServiceType,
  Status,
  WorkCategory,
} from '../types';
import type { AuthMode } from '../auth/mode';
import { isValidDateStr } from '../utils/dates';
import type { ImportDb } from './dataImport';

/** Read-only granica bazy: reużywamy `select` z ImportDb (jeden adapter). */
export type ReferenceDb = Pick<ImportDb, 'select'>;

/** Rola dostępu po stronie serwera (enum public.access_role). */
export type CloudRole = 'administrator' | 'manager' | 'worker';

export interface CloudProfile {
  id: string; // auth.users id (NIE e-mail)
  firstName: string;
  lastName: string;
  email: string;
  roleTitle: string;
  cloudRole: CloudRole;
  departmentId: string | null;
  /** Przełożony (profiles.supervisor_id); null gdy brak. */
  supervisorId: string | null;
  /** Pola planera (migracja 20260717130000_profiles_planner_fields). */
  phone: string;
  avatar: string;
  /** Ścieżka zdjęcia w buckecie `avatars` (profiles.avatar_path); brak/null = brak. */
  avatarPath?: string | null;
  capacity: number;
  workDays: number[];
  workStartMinutes: number;
  workEndMinutes: number;
  /** Data urodzenia (profiles.birth_date, yyyy-MM-dd); '' gdy brak/null. */
  birthDate: string;
}

export interface OrgSnapshot {
  /** Wiersz profilu bieżącego użytkownika (id === userId) albo null (brak). */
  profile: CloudProfile | null;
  profiles: CloudProfile[];
  departments: Department[];
  statuses: Status[];
  serviceTypes: ServiceType[];
  workCategories: WorkCategory[];
}

export type LoadOrgResult =
  | { ok: true; snapshot: OrgSnapshot }
  | { ok: false; error: string };

/** Jeden, stały polski komunikat błędu — nigdy nie pokazujemy surowego SDK. */
export const ORG_SNAPSHOT_ERROR = 'Nie udało się wczytać danych organizacji z serwera.';

/**
 * Odwrotność udokumentowanego mapowania frontend→cloud
 * (`administrator→administrator`, `pm→manager`, `handlowiec/pracownik→worker`).
 * `handlowiec` nie jest reprezentowalny po stronie serwera i celowo ląduje na
 * `pracownik` w UX trybu supabase — to jest prawda RLS (worker), a nie utrata
 * uprawnień handlowca planera lokalnego.
 */
export function cloudRoleToAccessRole(role: CloudRole): AccessRole {
  switch (role) {
    case 'administrator':
      return 'administrator';
    case 'manager':
      return 'pm';
    case 'worker':
      return 'pracownik';
  }
}

// ---- Mapowanie wierszy -------------------------------------------------------

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const bool = (v: unknown): boolean => v === true;
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function toCloudRole(v: unknown): CloudRole {
  return v === 'administrator' || v === 'manager' ? v : 'worker';
}

/** Dni robocze: liczby całkowite 1..7, bez duplikatów, rosnąco; śmieci odpadają. */
function toWorkDays(v: unknown): number[] {
  if (!Array.isArray(v)) return [1, 2, 3, 4, 5];
  const days = Array.from(
    new Set(v.filter((d): d is number => typeof d === 'number' && Number.isInteger(d) && d >= 1 && d <= 7)),
  );
  return days.sort((a, b) => a - b);
}

/** Minuty doby z bezpiecznym domyślnym (numeric z PostgREST może być stringiem). */
function toMinutes(v: unknown, fallback: number): number {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 1440 ? n : fallback;
}

function toCapacity(v: unknown): number {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 24 ? n : 8;
}

function toCloudProfile(row: Record<string, unknown>): CloudProfile {
  const departmentId = row.department_id;
  const supervisorId = row.supervisor_id;
  return {
    id: str(row.id),
    firstName: str(row.first_name),
    lastName: str(row.last_name),
    email: str(row.email),
    roleTitle: str(row.role_title),
    cloudRole: toCloudRole(row.access_role),
    departmentId: typeof departmentId === 'string' && departmentId !== '' ? departmentId : null,
    supervisorId: typeof supervisorId === 'string' && supervisorId !== '' ? supervisorId : null,
    phone: str(row.phone),
    avatar: str(row.avatar),
    avatarPath: typeof row.avatar_path === 'string' && row.avatar_path !== '' ? row.avatar_path : null,
    capacity: toCapacity(row.capacity),
    workDays: toWorkDays(row.work_days),
    workStartMinutes: toMinutes(row.work_start_minutes, 480),
    workEndMinutes: toMinutes(row.work_end_minutes, 960),
    // Postgres `date` przychodzi z PostgREST jako 'yyyy-MM-dd' albo null; śmieci
    // (teoretyczne) spadają na ''.
    birthDate: isValidDateStr(str(row.birth_date)) ? str(row.birth_date) : '',
  };
}

function toDepartment(row: Record<string, unknown>): Department {
  return { id: str(row.id), name: str(row.name) };
}

function toStatus(row: Record<string, unknown>): Status {
  return {
    id: str(row.id),
    name: str(row.name),
    slug: str(row.slug),
    color: str(row.color),
    order: num(row.sort_order),
    archived: bool(row.archived),
    isDone: bool(row.is_done),
  };
}

function toNamed(row: Record<string, unknown>): ServiceType {
  return { id: str(row.id), name: str(row.name) };
}

const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name);

/**
 * Wczytuje atomowo snapshot organizacji dla zalogowanego użytkownika. Wszystkie
 * selecty biegną równolegle; RLS zwraca ograniczony zestaw wierszy (to poprawne
 * scope'owanie, NIE błąd). JAKIKOLWIEK błąd selectu psuje cały snapshot (atomowo)
 * z jednym polskim komunikatem. Puste kolekcje są POPRAWNE (`ok: true`). Brak
 * własnego profilu (RLS nie zwrócił wiersza o id === userId) to stan
 * `profile: null`, a nie błąd.
 */
export async function loadOrgSnapshot(db: ReferenceDb, userId: string): Promise<LoadOrgResult> {
  const [profilesRes, departmentsRes, statusesRes, serviceTypesRes, workCategoriesRes] =
    await Promise.all([
      db.select(
        'profiles',
        'id, first_name, last_name, email, role_title, access_role, department_id, supervisor_id, phone, avatar, avatar_path, capacity, work_days, work_start_minutes, work_end_minutes, birth_date',
      ),
      db.select('departments', 'id, name'),
      db.select('statuses', 'id, name, slug, color, sort_order, archived, is_done'),
      db.select('service_types', 'id, name'),
      db.select('work_categories', 'id, name'),
    ]);

  if (
    profilesRes.error ||
    departmentsRes.error ||
    statusesRes.error ||
    serviceTypesRes.error ||
    workCategoriesRes.error
  ) {
    return { ok: false, error: ORG_SNAPSHOT_ERROR };
  }

  const profiles = profilesRes.rows.map(toCloudProfile);
  const departments = departmentsRes.rows.map(toDepartment).sort(byName);
  const statuses = statusesRes.rows
    .map(toStatus)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  const serviceTypes = serviceTypesRes.rows.map(toNamed).sort(byName);
  const workCategories = workCategoriesRes.rows.map((r) => toNamed(r) as WorkCategory).sort(byName);

  const profile = profiles.find((p) => p.id === userId) ?? null;

  return {
    ok: true,
    snapshot: { profile, profiles, departments, statuses, serviceTypes, workCategories },
  };
}

// ---- Efektywna rola dostępu (bramka UX) -------------------------------------

/** Stan maszyny dostawcy danych organizacji (patrz OrgDataProvider). */
export type OrgState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; snapshot: OrgSnapshot };

/**
 * Efektywna rola dostępu dla bramek UX. Zwraca zmapowaną rolę CHMURY tylko gdy:
 * tryb === 'supabase', snapshot jest `ready`, ma własny `profile` i NIE trwa
 * personifikacja. W każdym innym przypadku (tryb lokalny, ładowanie, błąd,
 * brak profilu w chmurze, personifikacja) obowiązuje lokalna `accessRole`
 * (albo `undefined`, gdy nie ma użytkownika). Autoryzacja i tak żyje po stronie
 * serwera (RLS) — to wyłącznie spójność widoku.
 */
export function effectiveAccessRole(
  localUser: Person | undefined,
  org: OrgState,
  opts: { mode: AuthMode; impersonating: boolean },
): AccessRole | undefined {
  const localRole = localUser?.accessRole;
  // Bez lokalnej tożsamości nie ma kogo bramkować — undefined w każdym trybie.
  if (!localUser) return localRole;
  if (opts.mode !== 'supabase' || opts.impersonating) return localRole;
  if (org.status !== 'ready' || !org.snapshot.profile) return localRole;
  return cloudRoleToAccessRole(org.snapshot.profile.cloudRole);
}

// ---- Pełna synchronizacja osób (hydracja lokalnej listy z profili chmury) ----

/**
 * Jeden wiersz scalenia osób: profil chmury przełożony na semantykę lokalnego
 * `Person` (rola dostępu już zmapowana, przełożony po e-mailu — lokalne id
 * rozwiązuje reduktor). Dział celowo pominięty: lokalny słownik działów ma
 * własne id, a widok działu zapewnia snapshot organizacji.
 */
export interface CloudPersonMergeRow {
  /** Id profilu chmury (auth.users id) — id nowo tworzonej osoby lokalnej. */
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string; // stanowisko (role_title)
  /** Id działu chmury ('' gdy brak) — po MERGE_CLOUD_DICTIONARIES lokalne
   *  działy noszą te same id, więc odniesienie jest bezpośrednie. */
  departmentId: string;
  phone: string;
  avatar: string;
  capacity: number;
  workDays: number[];
  workStartMinutes: number;
  workEndMinutes: number;
  accessRole: AccessRole;
  /** E-mail przełożonego ('' gdy brak lub przełożony poza widocznym zbiorem). */
  supervisorEmail: string;
  /** Data urodzenia (yyyy-MM-dd); '' gdy brak. */
  birthDate: string;
}

/**
 * Buduje payload MERGE_CLOUD_PEOPLE ze zscope'owanych przez RLS profili.
 * Profile bez e-maila są pomijane (e-mail to klucz tożsamości — bez niego nie
 * ma jak dopasować ani zalogować). Puste imię spada na część lokalną e-maila,
 * ostatecznie na 'Użytkownik' (walidacja wymaga imienia).
 */
export function buildCloudPeoplePayload(profiles: CloudProfile[]): CloudPersonMergeRow[] {
  const emailById = new Map(profiles.map((p) => [p.id, p.email.trim().toLowerCase()]));
  const rows: CloudPersonMergeRow[] = [];
  for (const p of profiles) {
    const email = p.email.trim();
    if (p.id === '' || email === '') continue;
    rows.push({
      id: p.id,
      email,
      firstName: p.firstName.trim() || email.split('@')[0] || 'Użytkownik',
      lastName: p.lastName,
      role: p.roleTitle,
      departmentId: p.departmentId ?? '',
      phone: p.phone,
      avatar: p.avatar,
      capacity: p.capacity,
      workDays: p.workDays,
      workStartMinutes: p.workStartMinutes,
      workEndMinutes: p.workEndMinutes,
      accessRole: cloudRoleToAccessRole(p.cloudRole),
      supervisorEmail: (p.supervisorId ? emailById.get(p.supervisorId) : '') ?? '',
      birthDate: p.birthDate,
    });
  }
  return rows;
}
