// Single persistence module. Wraps localStorage so it can be swapped for an API later.
// The stored JSON is versioned; loadData migrates older payloads forward.
import type {
  AccessRole,
  AppData,
  ChecklistItem,
  Person,
  SavedFilterCriteria,
  Status,
  Task,
  TaskPriority,
  WorkloadEntry,
} from '../types';
import { TASK_PRIORITIES } from '../utils/priority';
import {
  BIN_DATE,
  DAY_MINUTES,
  HOURS_STEP,
  MINUTE_STEP,
  clampBlockStart,
  hoursToMinutes,
  snapToStep,
  stackStartTimes,
} from '../utils/time';

const STORAGE_KEY = 'n2hub.data.v1';
const LEGACY_STORAGE_KEYS = ['n2ub.data.v1', 'n2click.data.v1'];
export const DATA_VERSION = 6;

export const DEFAULT_CAPACITY = 8; // hours available per person per day
export const WORKDAY_START_MIN = 480; // 8:00 — default person work-hours start
export const DEFAULT_WORKDAYS: number[] = [1, 2, 3, 4, 5]; // Mon–Fri (ISO weekdays)

/** Canonical "all" filter criteria. Storage owns this so it never imports from
 *  components; the UI (FilterPresets) re-exports it as DEFAULT_CRITERIA. */
export const DEFAULT_FILTER_CRITERIA: SavedFilterCriteria = {
  paid: 'all',
  clientId: '',
  statusId: '',
  personId: '',
  priority: '',
  workCategoryId: '',
  from: '',
  to: '',
};

/** Default informational work-end minute for a given daily capacity. */
export function defaultWorkEndMinutes(capacity: number): number {
  return Math.min(DAY_MINUTES, WORKDAY_START_MIN + Math.round(capacity * 60));
}

/**
 * Sanitize a workDays array: keep only integer ISO weekdays 1–7, dedupe, sort
 * ascending. An empty array is allowed (= no workdays). Non-arrays collapse to
 * empty here — callers decide when a MISSING value should default to Mon–Fri.
 */
export function sanitizeWorkDays(days: unknown): number[] {
  if (!Array.isArray(days)) return [];
  const cleaned = days.filter(
    (d): d is number => typeof d === 'number' && Number.isInteger(d) && d >= 1 && d <= 7,
  );
  return Array.from(new Set(cleaned)).sort((a, b) => a - b);
}

export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function uid(): string {
  return crypto.randomUUID();
}

/** The default pipeline. Admins can extend/rename/reorder/archive from /admin. */
export function buildDefaultStatuses(): Status[] {
  const defs: Array<[string, string]> = [
    ['Do zrobienia', '#9aa7c4'],
    ['W trakcie', '#5bdcff'],
    ['Akceptacja', '#ffc857'],
    ['Gotowe', '#b9ff4d'],
  ];
  return defs.map(([name, color], order) => ({
    id: uid(),
    name,
    slug: slugify(name),
    color,
    order,
    archived: false,
  }));
}

export function emptyData(): AppData {
  return {
    version: DATA_VERSION,
    clients: [],
    departments: [],
    serviceTypes: [],
    workCategories: [],
    statuses: buildDefaultStatuses(),
    projects: [],
    milestones: [],
    tasks: [],
    people: [],
    assignments: [],
    workload: [],
    comments: [],
    activity: [],
    currentUserId: '',
    impersonatorId: '',
    sampleBannerDismissed: false,
    savedFilters: [],
  };
}

function looksLikeData(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.tasks) && Array.isArray(v.people) && Array.isArray(v.workload);
}

const ACCESS_ROLES: AccessRole[] = ['administrator', 'pm', 'handlowiec', 'pracownik'];

/**
 * Normalize one stored person (any pre-v5 or v5 shape) into the current Person.
 * - `accessRole`: kept if already a valid role; otherwise derived from the old
 *   `isAdmin` flag (`true` → 'administrator', else 'pracownik').
 * - new fields (`phone`, `passwordHash`, `workDays`, work hours, `supervisorId`)
 *   get the documented defaults when absent. `workDays` MISSING ⇒ Mon–Fri;
 *   PRESENT ⇒ sanitized (empty allowed).
 * Idempotent: an already-v5 person round-trips unchanged (`isAdmin` is dropped).
 */
function migratePerson(raw: Record<string, unknown>): Person {
  const capacity =
    typeof raw.capacity === 'number' && raw.capacity > 0 ? raw.capacity : DEFAULT_CAPACITY;
  const accessRole: AccessRole = ACCESS_ROLES.includes(raw.accessRole as AccessRole)
    ? (raw.accessRole as AccessRole)
    : raw.isAdmin === true
      ? 'administrator'
      : 'pracownik';
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  return {
    id: str(raw.id),
    firstName: str(raw.firstName),
    lastName: str(raw.lastName),
    name: str(raw.name),
    email: str(raw.email),
    phone: str(raw.phone),
    role: str(raw.role),
    departmentId: str(raw.departmentId),
    avatar: str(raw.avatar),
    capacity,
    accessRole,
    passwordHash: str(raw.passwordHash),
    workDays: raw.workDays === undefined ? [...DEFAULT_WORKDAYS] : sanitizeWorkDays(raw.workDays),
    workStartMinutes:
      typeof raw.workStartMinutes === 'number' ? raw.workStartMinutes : WORKDAY_START_MIN,
    workEndMinutes:
      typeof raw.workEndMinutes === 'number' ? raw.workEndMinutes : defaultWorkEndMinutes(capacity),
    supervisorId: str(raw.supervisorId),
  };
}

/**
 * Migration v4→v5: replace `isAdmin` with `accessRole` and add the account
 * fields (phone, passwordHash, availability, supervisor). Person-only shape
 * change — everything else passes through untouched. Idempotent.
 */
function migrateV4toV5(data: AppData): AppData {
  return {
    ...data,
    version: DATA_VERSION,
    people: (data.people as unknown as Record<string, unknown>[]).map(migratePerson),
  };
}

/**
 * Migrate a v1 payload (flat tasks with a free-text `project` label) to v2:
 * - each distinct project label becomes a Project under a default client;
 * - people get name split + capacity/avatar/admin defaults (first person is admin);
 * - workload entries get a per-person/day sortIndex;
 * - default statuses are created; everything starts in the first status.
 */
function migrateV1(raw: Record<string, unknown>): AppData {
  const base = emptyData();
  const now = new Date().toISOString();
  const statuses = base.statuses;
  const firstStatusId = statuses[0].id;

  type V1Task = {
    id: string;
    title: string;
    description: string;
    project?: string;
    startDate: string;
    endDate: string;
    estimatedHours: number | null;
    createdAt: string;
    updatedAt: string;
  };
  type V1Person = { id: string; name: string; email?: string; role?: string };
  type V1Entry = {
    id: string;
    taskId: string;
    personId: string;
    date: string;
    plannedHours: number;
  };

  const v1Tasks = (raw.tasks as V1Task[]) ?? [];
  const v1People = (raw.people as V1Person[]) ?? [];
  const v1Workload = (raw.workload as V1Entry[]) ?? [];
  const v1Assignments =
    (raw.assignments as Array<{ id: string; taskId: string; personId: string }>) ?? [];

  // People: split "First Last", defaults for the new fields. Built through
  // migratePerson so v1 people land in the current (v5) shape directly; the
  // shared v4→v5 pass in loadData is then idempotent over them.
  const people: Person[] = v1People.map((p, i) => {
    const name = (p.name ?? '').trim();
    const spaceIdx = name.indexOf(' ');
    const firstName = spaceIdx === -1 ? name : name.slice(0, spaceIdx);
    const lastName = spaceIdx === -1 ? '' : name.slice(spaceIdx + 1);
    return migratePerson({
      id: p.id,
      firstName,
      lastName,
      name,
      email: p.email ?? '',
      role: p.role ?? '',
      departmentId: '',
      avatar: '',
      capacity: DEFAULT_CAPACITY,
      isAdmin: i === 0, // someone has to be able to open the admin panel
    });
  });

  // Projects from distinct v1 task.project labels, under one default client.
  const client = { id: uid(), name: 'N2 Media', archived: false };
  const projectByLabel = new Map<string, string>(); // label -> projectId
  const projects: AppData['projects'] = [];
  const projectIdFor = (label: string): string => {
    const key = label || 'Ogólne';
    const found = projectByLabel.get(key);
    if (found) return found;
    const id = uid();
    projectByLabel.set(key, id);
    projects.push({
      id,
      clientId: client.id,
      name: key,
      description: '',
      statusId: firstStatusId,
      paid: false,
      startDate: '', // fixed up below from task spans
      endDate: '',
      departmentId: '',
      serviceTypeId: '',
      createdAt: now,
      updatedAt: now,
    });
    return id;
  };

  const tasks: AppData['tasks'] = v1Tasks.map((t) => ({
    id: t.id,
    projectId: projectIdFor((t.project ?? '').trim()),
    statusId: firstStatusId,
    title: t.title,
    description: t.description ?? '',
    startDate: t.startDate,
    endDate: t.endDate,
    estimatedHours: t.estimatedHours ?? null,
    priority: 'normal',
    workCategoryId: '',
    checklist: [],
    createdAt: t.createdAt ?? now,
    updatedAt: t.updatedAt ?? now,
  }));

  // Project spans = min/max of their tasks (today for empty projects).
  for (const project of projects) {
    const own = tasks.filter((t) => t.projectId === project.id);
    if (own.length > 0) {
      project.startDate = own.map((t) => t.startDate).sort()[0];
      project.endDate = own.map((t) => t.endDate).sort().slice(-1)[0];
    }
  }

  // Workload: assign sortIndex per (person, date) in stored order.
  const counters = new Map<string, number>();
  const workload: AppData['workload'] = v1Workload.map((w) => {
    const key = `${w.personId}|${w.date}`;
    const idx = counters.get(key) ?? 0;
    counters.set(key, idx + 1);
    // startMinutes intentionally invalid — ensureStartMinutes restacks it.
    return { ...w, sortIndex: idx, startMinutes: -1 };
  });

  return {
    ...base,
    clients: v1Tasks.length > 0 ? [client] : [],
    projects,
    tasks,
    people,
    assignments: v1Assignments,
    workload,
    currentUserId: people[0]?.id ?? '',
    impersonatorId: '',
    sampleBannerDismissed: Boolean(raw.sampleBannerDismissed),
  };
}

function translateKnownName(name: string, map: Record<string, string>): string {
  return map[name] ?? name;
}

function localizeLegacyData(data: AppData): AppData {
  const statusNames: Record<string, string> = {
    'To do': 'Do zrobienia',
    'Work in progress': 'W trakcie',
    Accept: 'Akceptacja',
    Done: 'Gotowe',
  };
  const departments: Record<string, string> = {
    Design: 'Projektowanie',
    Development: 'Programowanie',
    Management: 'Zarządzanie',
  };
  const serviceTypes: Record<string, string> = {
    Web: 'WWW',
    Branding: 'Marka',
    'Social media': 'Media społecznościowe',
  };
  const roles: Record<string, string> = {
    Designer: 'Projektantka',
    Developer: 'Programista',
    'Project Manager': 'Kierowniczka projektu',
  };
  const projectNames: Record<string, string> = {
    'Website redesign': 'Redesign strony',
    'Summer campaign': 'Kampania letnia',
    'App release 2.4': 'Wydanie aplikacji 2.4',
  };
  const projectDescriptions: Record<string, string> = {
    'Full refresh of the Acme marketing site: hero, pricing, case studies.':
      'Pełne odświeżenie strony marketingowej Acme: sekcja hero, cennik i studia przypadków.',
    'Q3 social campaign for the Nordic Fitness summer launch.':
      'Kampania w mediach społecznościowych Q3 dla letniej premiery Nordic Fitness.',
    'Stabilise and ship the 2.4 release of the ordering app.':
      'Stabilizacja i publikacja wersji 2.4 aplikacji do zamówień.',
  };
  const milestoneNames: Record<string, string> = {
    'Design approved': 'Projekt zaakceptowany',
    'Go live': 'Publikacja',
    'Concept review': 'Przegląd koncepcji',
    'Release cut': 'Zamknięcie wydania',
  };
  const taskTitles: Record<string, string> = {
    'Homepage & pricing pages': 'Strona główna i cennik',
    'Campaign concept & plan': 'Koncepcja i plan kampanii',
    'Release bugfix sprint': 'Sprint poprawek do wydania',
    'Regression QA pass': 'Regresja QA',
  };
  const taskDescriptions: Record<string, string> = {
    'Design and build the new hero, pricing table, and case studies.':
      'Zaprojektowanie i wdrożenie nowej sekcji hero, tabeli cen oraz studiów przypadków.',
    'Scope the summer campaign; mid-week reserved for stakeholder review.':
      'Zakres kampanii letniej; środek tygodnia zarezerwowany na przegląd z interesariuszami.',
    'Critical fixes before the release cut.': 'Krytyczne poprawki przed zamknięciem wydania.',
    'Full regression suite on staging.': 'Pełny zestaw testów regresji na stagingu.',
  };
  const commentBodies: Record<string, string> = {
    '@Ola client approved the moodboard — go ahead with the hero designs.':
      '@Ola klient zaakceptował moodboard — można ruszać z projektami sekcji hero.',
    'Two blockers left, rest is polish. Release cut still looks safe.':
      'Zostały dwa blokery, reszta to dopracowanie. Zamknięcie wydania nadal wygląda bezpiecznie.',
  };
  const activityMessages: Record<string, string> = {
    'created the project': 'utworzył(a) projekt',
    'marked the project as paid': 'oznaczył(a) projekt jako opłacony',
    'marked the project as unpaid': 'oznaczył(a) projekt jako nieopłacony',
    'updated the project': 'zaktualizował(a) projekt',
    'created the task': 'utworzył(a) zadanie',
    'updated the task': 'zaktualizował(a) zadanie',
    commented: 'dodał(a) komentarz',
  };

  return {
    ...data,
    version: DATA_VERSION,
    statuses: data.statuses.map((s) => {
      const name = translateKnownName(s.name, statusNames);
      return name === s.name ? s : { ...s, name, slug: slugify(name) };
    }),
    departments: data.departments.map((d) => ({
      ...d,
      name: translateKnownName(d.name, departments),
    })),
    serviceTypes: data.serviceTypes.map((s) => ({
      ...s,
      name: translateKnownName(s.name, serviceTypes),
    })),
    people: data.people.map((p) => ({
      ...p,
      role: translateKnownName(p.role, roles),
    })),
    projects: data.projects.map((p) => ({
      ...p,
      name: translateKnownName(p.name, projectNames),
      description: translateKnownName(p.description, projectDescriptions),
    })),
    milestones: data.milestones.map((m) => ({
      ...m,
      name: translateKnownName(m.name, milestoneNames),
    })),
    tasks: data.tasks.map((t) => ({
      ...t,
      title: translateKnownName(t.title, taskTitles),
      description: translateKnownName(t.description, taskDescriptions),
    })),
    comments: data.comments.map((c) => ({
      ...c,
      body: translateKnownName(c.body, commentBodies),
    })),
    activity: data.activity.map((a) => ({
      ...a,
      message: translateKnownName(a.message, activityMessages),
    })),
  };
}

/** True when the entry already carries a usable startMinutes (block fits the day). */
function hasValidStart(w: WorkloadEntry): boolean {
  const s = (w as Partial<WorkloadEntry>).startMinutes;
  return (
    typeof s === 'number' &&
    Number.isFinite(s) &&
    s >= 0 &&
    s + hoursToMinutes(w.plannedHours) <= DAY_MINUTES
  );
}

/**
 * Idempotent normalize pass: guarantee every workload entry has a valid,
 * on-grid `startMinutes`. Runs on EVERY load (covers v<4 payloads and any entry
 * with a missing/invalid value). Deterministic rule: if a (person, date) group
 * contains ANY invalid entry, restack the WHOLE group from 08:00 in sortIndex
 * order; fully-valid groups are left alone except off-grid values are snapped.
 *
 * Bin groups additionally enforce the one-bin-row invariant (PKG-20260708-
 * budget-store): duplicate rows for the same taskId are merged into the
 * lowest-sortIndex survivor (hours summed) and the rest dropped, before the
 * group's sortIndex is renumbered 0..n.
 */
export function ensureStartMinutes(data: AppData): AppData {
  const groups = new Map<string, WorkloadEntry[]>();
  for (const w of data.workload) {
    const key = `${w.personId}|${w.date}`;
    const list = groups.get(key);
    if (list) list.push(w);
    else groups.set(key, [w]);
  }

  const patched = new Map<string, number>(); // entryId -> startMinutes
  const patchedSort = new Map<string, number>(); // entryId -> sortIndex
  const patchedHours = new Map<string, number>(); // entryId -> plannedHours (bin merges)
  const removed = new Set<string>(); // entryIds merged away
  for (const list of groups.values()) {
    const ordered = [...list].sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0));
    // Bin groups (date === '') don't follow the 08:00 stacking rule: every
    // entry sits at startMinutes 0 and the group's sortIndex is renumbered
    // 0..n in existing sortIndex order. First merge duplicate per-task rows.
    if (ordered.length > 0 && ordered[0].date === BIN_DATE) {
      const survivorByTask = new Map<string, WorkloadEntry>(); // taskId -> survivor
      const mergedQ = new Map<string, number>(); // survivorId -> total quarters
      for (const w of ordered) {
        const survivor = survivorByTask.get(w.taskId);
        if (survivor) {
          removed.add(w.id);
          mergedQ.set(
            survivor.id,
            (mergedQ.get(survivor.id) ?? Math.round(survivor.plannedHours / HOURS_STEP)) +
              Math.round(w.plannedHours / HOURS_STEP),
          );
        } else {
          survivorByTask.set(w.taskId, w);
        }
      }
      for (const [id, q] of mergedQ) patchedHours.set(id, q * HOURS_STEP);
      const survivors = ordered.filter((w) => !removed.has(w.id));
      survivors.forEach((w, i) => {
        if (w.startMinutes !== 0) patched.set(w.id, 0);
        if (w.sortIndex !== i) patchedSort.set(w.id, i);
      });
      continue;
    }
    if (ordered.some((w) => !hasValidStart(w))) {
      const starts = stackStartTimes(ordered.map((w) => ({ plannedHours: w.plannedHours })));
      ordered.forEach((w, i) => {
        if (w.startMinutes !== starts[i]) patched.set(w.id, starts[i]);
      });
    } else {
      for (const w of ordered) {
        if (w.startMinutes % MINUTE_STEP !== 0) {
          patched.set(
            w.id,
            clampBlockStart(snapToStep(w.startMinutes), hoursToMinutes(w.plannedHours)),
          );
        }
      }
    }
  }

  if (
    patched.size === 0 &&
    patchedSort.size === 0 &&
    patchedHours.size === 0 &&
    removed.size === 0
  ) {
    return data;
  }
  return {
    ...data,
    workload: data.workload
      .filter((w) => !removed.has(w.id))
      .map((w) => {
        const s = patched.get(w.id);
        const si = patchedSort.get(w.id);
        const h = patchedHours.get(w.id);
        if (s === undefined && si === undefined && h === undefined) return w;
        return {
          ...w,
          ...(s === undefined ? null : { startMinutes: s }),
          ...(si === undefined ? null : { sortIndex: si }),
          ...(h === undefined ? null : { plannedHours: h }),
        };
      }),
  };
}

/**
 * Clears a stale `impersonatorId` on every load (idempotent, like
 * ensureStartMinutes). Impersonation bookkeeping must reference a real person
 * distinct from the acted-as identity; anything else resets to '' (= not
 * impersonating). Disjoint from ensureStartMinutes — order is irrelevant.
 */
export function sanitizeImpersonator(data: AppData): AppData {
  const id = data.impersonatorId;
  if (id === '') return data;
  const dangling = !data.people.some((p) => p.id === id);
  if (dangling || id === data.currentUserId) {
    return { ...data, impersonatorId: '' };
  }
  return data;
}

/**
 * Idempotent normalize pass for the task-metadata model (priority, work
 * category, checklist) and saved-filter criteria. Runs on EVERY load — same
 * philosophy as migratePerson / ensureStartMinutes — so a payload stamped v6
 * whose tasks/presets were never actually migrated (e.g. persisted mid-dev via
 * HMR) still self-heals instead of staying broken forever. Idempotent by value:
 * a second pass changes nothing.
 *
 * Guarantees after the pass:
 * - `workCategories` is an array (defensive; the emptyData spread covers the
 *   plainly-missing case, this also catches a non-array value);
 * - every task has a valid `priority` (unknown value → 'normal'), a string
 *   `workCategoryId` that references an existing dictionary row (dangling
 *   reference → '', same spirit as sanitizeImpersonator), and a well-shaped
 *   `checklist` (non-array → []; each item coerced to { id, text, done },
 *   non-object entries dropped);
 * - every saved filter's criteria is filled from DEFAULT_FILTER_CRITERIA (old
 *   v5 presets gain the new fields as '') with invalid `priority` and dangling
 *   `workCategoryId` values reset to ''.
 */
export function normalizeTaskMeta(data: AppData): AppData {
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const workCategories = Array.isArray(data.workCategories) ? data.workCategories : [];
  const categoryIds = new Set(workCategories.map((c) => c.id));

  const tasks: Task[] = data.tasks.map((raw) => {
    const t = raw as unknown as Record<string, unknown>;
    const priority: TaskPriority = TASK_PRIORITIES.includes(t.priority as TaskPriority)
      ? (t.priority as TaskPriority)
      : 'normal';
    const rawCategory = str(t.workCategoryId);
    const workCategoryId = categoryIds.has(rawCategory) ? rawCategory : '';
    const checklist: ChecklistItem[] = Array.isArray(t.checklist)
      ? (t.checklist as unknown[])
          .filter((item): item is Record<string, unknown> =>
            typeof item === 'object' && item !== null,
          )
          .map((item) => ({
            id: str(item.id) || uid(),
            text: str(item.text),
            done: item.done === true,
          }))
      : [];
    return { ...(raw as Task), priority, workCategoryId, checklist };
  });

  const savedFilters = data.savedFilters.map((f) => {
    const criteria: SavedFilterCriteria = { ...DEFAULT_FILTER_CRITERIA, ...f.criteria };
    if (criteria.priority !== '' && !TASK_PRIORITIES.includes(criteria.priority as TaskPriority)) {
      criteria.priority = '';
    }
    if (criteria.workCategoryId !== '' && !categoryIds.has(criteria.workCategoryId)) {
      criteria.workCategoryId = '';
    }
    return { ...f, criteria };
  });

  return { ...data, workCategories, tasks, savedFilters };
}

export function loadData(): AppData {
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY) ??
      LEGACY_STORAGE_KEYS.map((key) => localStorage.getItem(key)).find(Boolean);
    if (!raw) return emptyData();
    const parsed: unknown = JSON.parse(raw);
    if (!looksLikeData(parsed)) return emptyData();
    const version = typeof parsed.version === 'number' ? parsed.version : 1;
    if (version < 2) {
      return sanitizeImpersonator(
        normalizeTaskMeta(ensureStartMinutes(migrateV4toV5(localizeLegacyData(migrateV1(parsed))))),
      );
    }
    // Same-version load: fill any missing fields with defaults.
    const loaded = {
      ...emptyData(),
      ...(parsed as Partial<AppData>),
      version: DATA_VERSION,
    };
    const localized = version < DATA_VERSION ? localizeLegacyData(loaded) : loaded;
    // Person normalization runs on EVERY load (defensive + idempotent), exactly
    // like ensureStartMinutes below — NOT only when `version < 5`. A payload
    // stamped v5 whose people were never actually migrated (e.g. persisted
    // mid-dev via HMR, still carrying `isAdmin` and no `accessRole`) would
    // otherwise stay broken forever: a missing `accessRole` makes
    // MATRIX[undefined] deny every action → permanent login-screen lockout.
    // migratePerson preserves valid existing values and fills only what's absent.
    const migrated = migrateV4toV5(localized);
    return sanitizeImpersonator(normalizeTaskMeta(ensureStartMinutes(migrated)));
  } catch {
    return emptyData();
  }
}

export function saveData(data: AppData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Ignore write failures (e.g. private mode / quota). Non-fatal for an alpha.
  }
}

export function clearData(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    LEGACY_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
  } catch {
    // ignore
  }
}
