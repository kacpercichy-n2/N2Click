// Single persistence module. Wraps localStorage so it can be swapped for an API later.
// The stored JSON is versioned; loadData migrates older payloads forward.
import type {
  AccessRole,
  AppData,
  ChecklistItem,
  Person,
  Project,
  ProjectDocument,
  SavedFilterCriteria,
  Status,
  Task,
  TaskPriority,
  Ticket,
  WorkloadEntry,
} from '../types';
import { isValidDateStr, todayStr } from '../utils/dates';
import { TASK_PRIORITIES } from '../utils/priority';
import {
  DEFAULT_PROJECT_DOCUMENT_KIND,
  isProjectDocumentKind,
  normalizeProjectDocumentUrl,
} from '../utils/projectDocuments';
import {
  DEFAULT_TICKET_KIND,
  DEFAULT_TICKET_PRIORITY,
  DEFAULT_TICKET_STATUS,
  isTicketKind,
  isTicketPriority,
  isTicketStatus,
} from '../utils/tickets';
import {
  BIN_DATE,
  DAY_MINUTES,
  HOURS_STEP,
  MINUTE_STEP,
  clampBlockStart,
  hoursToMinutes,
  isBinEntry,
  snapHours,
  snapToStep,
  stackStartTimes,
} from '../utils/time';

const STORAGE_KEY = 'n2hub.data.v1';
const LEGACY_STORAGE_KEYS = ['n2ub.data.v1', 'n2click.data.v1'];
export const DATA_VERSION = 7;
const LOCALIZATION_MIGRATION_VERSION = 6;

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
    // Only the last default ('Gotowe') is a done status.
    isDone: name === 'Gotowe',
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
    tickets: [],
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

/**
 * Keep a stored array collection as-is, else fall back to its emptyData default
 * ([] for most collections; the default pipeline for statuses). Mirrors how
 * normalizeTaskMeta already guards `workCategories`, applied uniformly to every
 * collection so a single present-but-non-array collection (e.g. a stored
 * `"statuses": null`) is repaired in isolation instead of throwing inside a
 * later `.map` repair pass and taking the whole payload down with it.
 */
function coerceArray<T>(value: unknown, fallback: T[]): T[] {
  return Array.isArray(value) ? (value as T[]) : fallback;
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
      documents: [],
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
    departmentId: '',
    checklist: [],
    // NaN => normalizeTaskMeta (biegnie po migrateV1) nada deterministyczny
    // domyślny ciąg 0..n-1 per projekt w kolejności (startDate, createdAt, id).
    orderIndex: Number.NaN,
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

/**
 * Maps the English seed's default dictionary names to Polish. This completed
 * with v6, so only payloads older than that version may be transformed. A
 * later schema bump must never reinterpret a user's valid English labels.
 */
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
 * Normalize the persisted hour quantity before any placement repair runs.
 * Invalid/non-positive quantities fail closed: silently treating them as zero
 * would discard the only stored representation of planned work. Finite
 * positive values are snapped to the quarter-hour grid (with a 0.25h floor so
 * a tiny positive legacy value never disappears). A dated block whose ORIGINAL
 * duration exceeds one day is moved to the bin, preserving its hours and id;
 * ensureStartMinutes subsequently merges it into an existing same-task/person
 * bin row, whose lower sortIndex is deliberately preserved.
 */
export function normalizeWorkloadHours(data: AppData): AppData {
  for (const raw of data.workload as unknown[]) {
    if (typeof raw !== 'object' || raw === null) {
      throw new Error('Nieprawidłowy wpis workload: brak obiektu plannedHours.');
    }
    const hours = (raw as { plannedHours?: unknown }).plannedHours;
    if (typeof hours !== 'number' || !Number.isFinite(hours) || hours <= 0) {
      throw new Error('Nieprawidłowy plannedHours w zapisanych danych.');
    }
  }

  const nextBinSort = new Map<string, number>();
  for (const w of data.workload) {
    if (!isBinEntry(w)) continue;
    const key = `${w.personId}|${BIN_DATE}`;
    const sort = Number.isFinite(w.sortIndex) ? w.sortIndex : -1;
    nextBinSort.set(key, Math.max(nextBinSort.get(key) ?? -1, sort));
  }

  let changed = false;
  const workload = data.workload.map((w) => {
    const snapped = Math.max(HOURS_STEP, snapHours(w.plannedHours));
    if (!Number.isFinite(snapped)) {
      throw new Error('Nieprawidłowy plannedHours po normalizacji zapisanych danych.');
    }

    if (!isBinEntry(w) && w.plannedHours > DAY_MINUTES / 60) {
      const key = `${w.personId}|${BIN_DATE}`;
      const sortIndex = (nextBinSort.get(key) ?? -1) + 1;
      nextBinSort.set(key, sortIndex);
      changed = true;
      return {
        ...w,
        date: BIN_DATE,
        plannedHours: snapped,
        startMinutes: 0,
        sortIndex,
      };
    }

    if (snapped === w.plannedHours) return w;
    changed = true;
    return { ...w, plannedHours: snapped };
  });

  return changed ? { ...data, workload } : data;
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
      for (const [id, q] of mergedQ) {
        const hours = q * HOURS_STEP;
        if (!Number.isFinite(hours)) {
          throw new Error('Nieprawidłowy plannedHours po scaleniu zasobnika.');
        }
        patchedHours.set(id, hours);
      }
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

/** Fixed epoch sentinel for un-parseable comment/activity timestamps. Keeps
 *  the repair idempotent — `Date.parse` of this value is 0, not NaN. */
const EPOCH_ISO = '1970-01-01T00:00:00.000Z';

/** Repair one date period per the deterministic rules: both invalid → today;
 *  exactly one invalid → copy the valid one; both valid but reversed → swap. */
function repairPeriod(
  startDate: string,
  endDate: string,
): { startDate: string; endDate: string; changed: boolean } {
  const startOk = isValidDateStr(startDate);
  const endOk = isValidDateStr(endDate);
  if (!startOk && !endOk) {
    const t = todayStr();
    return { startDate: t, endDate: t, changed: true };
  }
  if (startOk && !endOk) return { startDate, endDate: startDate, changed: true };
  if (!startOk && endOk) return { startDate: endDate, endDate, changed: true };
  if (endDate < startDate) return { startDate: endDate, endDate: startDate, changed: true };
  return { startDate, endDate, changed: false };
}

/**
 * Idempotent every-load pass that guarantees no invalid calendar date can reach
 * render (where `parseDate('')` → date-fns `format(Invalid Date)` throws a
 * blank-screen RangeError). Runs BEFORE ensureStartMinutes so any workload entry
 * it moves to the bin gets merged/renumbered by the existing bin machinery.
 *
 * Repair rules (deterministic, value-idempotent — a second pass changes
 * nothing, and a fully-valid payload comes back as the SAME object):
 * - Project / Task `startDate`+`endDate`: both invalid → today; exactly one
 *   invalid → copy the valid one; both valid but reversed → swap. (Task periods
 *   are NOT retro-clamped to the 92-day cap — that's write-path only.)
 * - Milestone `date` invalid → its project's post-repair `startDate`, or today
 *   when the project no longer exists.
 * - WorkloadEntry `date`: `BIN_DATE` (`''`) stays valid; any other invalid date
 *   converts the entry into a bin entry (`date: ''`, `startMinutes: 0`), hours
 *   preserved — the downstream ensureStartMinutes bin merge enforces one row.
 * - SavedFilter `criteria.from` / `.to`: non-empty and invalid → `''`.
 * - Comment / ActivityEvent `createdAt`: un-parseable (`Date.parse` NaN) →
 *   EPOCH_ISO (also render-safe through formatTimestamp).
 */
export function normalizeDates(data: AppData): AppData {
  let changed = false;

  const projects = data.projects.map((p) => {
    const r = repairPeriod(p.startDate, p.endDate);
    if (!r.changed) return p;
    changed = true;
    return { ...p, startDate: r.startDate, endDate: r.endDate };
  });

  const tasks = data.tasks.map((t) => {
    const r = repairPeriod(t.startDate, t.endDate);
    if (!r.changed) return t;
    changed = true;
    return { ...t, startDate: r.startDate, endDate: r.endDate };
  });

  // Milestones reference the POST-repair project startDate.
  const projectStart = new Map(projects.map((p) => [p.id, p.startDate]));
  const milestones = data.milestones.map((m) => {
    if (isValidDateStr(m.date)) return m;
    changed = true;
    return { ...m, date: projectStart.get(m.projectId) ?? todayStr() };
  });

  const workload = data.workload.map((w) => {
    if (w.date === BIN_DATE || isValidDateStr(w.date)) return w;
    changed = true;
    return { ...w, date: BIN_DATE, startMinutes: 0 };
  });

  const savedFilters = data.savedFilters.map((f) => {
    const { from, to } = f.criteria;
    const fromBad = from !== '' && !isValidDateStr(from);
    const toBad = to !== '' && !isValidDateStr(to);
    if (!fromBad && !toBad) return f;
    changed = true;
    return {
      ...f,
      criteria: { ...f.criteria, from: fromBad ? '' : from, to: toBad ? '' : to },
    };
  });

  const comments = data.comments.map((c) => {
    if (!Number.isNaN(Date.parse(c.createdAt))) return c;
    changed = true;
    return { ...c, createdAt: EPOCH_ISO };
  });

  const activity = data.activity.map((a) => {
    if (!Number.isNaN(Date.parse(a.createdAt))) return a;
    changed = true;
    return { ...a, createdAt: EPOCH_ISO };
  });

  if (!changed) return data;
  return { ...data, projects, tasks, milestones, workload, savedFilters, comments, activity };
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
/**
 * Deterministyczny domyślny `Task.orderIndex` per projekt. Zadania z poprawną
 * (skończoną) wartością zachowują ją; pozostałe (legacy bez pola → tu oznaczone
 * `NaN`) są dopisywane PO aktualnym maksimum projektu w kolejności
 * (startDate, createdAt, id). Czysty legacy payload (żadne zadanie nie ma pola)
 * dostaje więc 0..n-1 na projekt w dzisiejszej kolejności wyświetlania.
 * Idempotentny WZGLĘDEM WARTOŚCI: drugie przejście na własnym wyniku (wszystkie
 * skończone) nic nie zmienia. Nie dotyka chmury — to wyłącznie repair na load.
 */
export function assignDefaultOrderIndex(tasks: Task[]): Task[] {
  const maxByProject = new Map<string, number>();
  for (const t of tasks) {
    if (Number.isFinite(t.orderIndex)) {
      const cur = maxByProject.get(t.projectId);
      maxByProject.set(t.projectId, cur === undefined ? t.orderIndex : Math.max(cur, t.orderIndex));
    }
  }
  const pending = tasks
    .filter((t) => !Number.isFinite(t.orderIndex))
    .sort(
      (a, b) =>
        a.projectId.localeCompare(b.projectId) ||
        a.startDate.localeCompare(b.startDate) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    );
  const resolved = new Map<string, number>();
  const nextByProject = new Map<string, number>();
  for (const t of pending) {
    let next = nextByProject.get(t.projectId);
    if (next === undefined) {
      const max = maxByProject.get(t.projectId);
      next = max === undefined ? 0 : max + 1;
    }
    resolved.set(t.id, next);
    nextByProject.set(t.projectId, next + 1);
  }
  if (resolved.size === 0) return tasks;
  return tasks.map((t) =>
    resolved.has(t.id) ? { ...t, orderIndex: resolved.get(t.id)! } : t,
  );
}

export function normalizeTaskMeta(data: AppData): AppData {
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const workCategories = Array.isArray(data.workCategories) ? data.workCategories : [];
  const categoryIds = new Set(workCategories.map((c) => c.id));
  const departmentIds = new Set(data.departments.map((d) => d.id));

  const tasks: Task[] = data.tasks.map((raw) => {
    const t = raw as unknown as Record<string, unknown>;
    const priority: TaskPriority = TASK_PRIORITIES.includes(t.priority as TaskPriority)
      ? (t.priority as TaskPriority)
      : 'normal';
    const rawCategory = str(t.workCategoryId);
    const workCategoryId = categoryIds.has(rawCategory) ? rawCategory : '';
    // Dział zadania (nowe pole, legacy = brak): dangling → '' jak kategoria.
    const rawDepartment = str(t.departmentId);
    const departmentId = departmentIds.has(rawDepartment) ? rawDepartment : '';
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
    // Ranga wyświetlania: wartości niebędące skończoną liczbą (legacy = brak
    // pola) trafiają do repairu poniżej jako `NaN` i dostają domyślny ciąg.
    const rawOrder = t.orderIndex;
    const orderIndex =
      typeof rawOrder === 'number' && Number.isFinite(rawOrder) ? rawOrder : Number.NaN;
    // Szkic (pole opcjonalne, ADDYTYWNE): każdy starszy zapis i chmura bez
    // kolumny czytają się jako OPUBLIKOWANE. Tylko jawne `true` zostaje szkicem.
    const isDraft = t.isDraft === true;
    return {
      ...(raw as Task),
      priority,
      workCategoryId,
      departmentId,
      checklist,
      orderIndex,
      isDraft,
    };
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

  return { ...data, workCategories, tasks: assignDefaultOrderIndex(tasks), savedFilters };
}

/**
 * Idempotentny repair listy dokumentów projektu. Pole jest ADDYTYWNE (bez
 * podbicia DATA_VERSION), więc KAŻDY starszy zapis wchodzi tu bez `documents`
 * i wychodzi z pustą listą — to jest domyślna wartość dla danych zastanych.
 *
 * Zasady:
 * 1. Brak pola albo wartość niebędąca tablicą => `[]`.
 * 2. Wiersz, którego `url` nie przechodzi `normalizeProjectDocumentUrl`, jest
 *    ODRZUCANY: pusty adres nie ma czego pokazać, a adres o schemacie innym niż
 *    http(s) (`javascript:`, `data:`) to przechowywany XSS — projekty są danymi
 *    współdzielonymi, więc zły adres może pochodzić z chmury albo ze starszego
 *    zapisu i sama walidacja na wejściu nie wystarcza. Adres bez schematu jest
 *    normalizowany do `https://`.
 * 3. Nieznany `kind` wraca do wartości domyślnej ('link') zamiast wywracać
 *    wczytanie; brakujące `id` dostaje nowe (stabilne po zapisie zwrotnym).
 *
 * Idempotentny po wartości: drugi przebieg na własnym wyniku nic nie zmienia.
 */
export function repairProjectDocuments(data: AppData): AppData {
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const projects: Project[] = data.projects.map((raw) => {
    const p = raw as unknown as Record<string, unknown>;
    const source = Array.isArray(p.documents) ? (p.documents as unknown[]) : [];
    const documents: ProjectDocument[] = [];
    for (const entry of source) {
      if (typeof entry !== 'object' || entry === null) continue;
      const d = entry as Record<string, unknown>;
      const url = normalizeProjectDocumentUrl(str(d.url));
      if (url === null) continue;
      documents.push({
        id: str(d.id) || uid(),
        kind: isProjectDocumentKind(d.kind) ? d.kind : DEFAULT_PROJECT_DOCUMENT_KIND,
        label: str(d.label).trim(),
        url,
      });
    }
    return { ...(raw as Project), documents };
  });
  return { ...data, projects };
}

/**
 * Idempotentny repair kolekcji zgłoszeń. Kolekcja jest ADDYTYWNA (bez podbicia
 * DATA_VERSION), więc każdy starszy zapis wchodzi tu jako `[]` z emptyData i
 * przechodzi bez zmian.
 *
 * Zasady:
 * 1. Wiersz bez `id` albo bez niepustego `title` jest ODRZUCANY (nie da się go
 *    ani pokazać, ani zaadresować).
 * 2. Nieznane `kind`/`priority`/`status` wracają do wartości domyślnych
 *    ('inne' / 'sredni' / 'nowe') zamiast wywracać wczytanie.
 * 3. Pola tekstowe i znaczniki czasu są koercjonowane do stringów; `reporterId`
 *    wskazujący nieistniejącą osobę zostaje ZACHOWANY (historyczne zgłoszenie
 *    osoby usuniętej z zespołu ma nadal wartość dla managera — UI pokazuje
 *    wtedy „nieznany”).
 *
 * Idempotentny po wartości: drugi przebieg na własnym wyniku nic nie zmienia.
 */
export function repairTickets(data: AppData): AppData {
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const source = Array.isArray(data.tickets) ? data.tickets : [];
  const tickets: Ticket[] = [];
  for (const raw of source) {
    if (typeof raw !== 'object' || raw === null) continue;
    const t = raw as unknown as Record<string, unknown>;
    const id = str(t.id);
    const title = str(t.title).trim();
    if (id === '' || title === '') continue;
    tickets.push({
      id,
      title,
      area: str(t.area),
      description: str(t.description),
      kind: isTicketKind(t.kind) ? t.kind : DEFAULT_TICKET_KIND,
      priority: isTicketPriority(t.priority) ? t.priority : DEFAULT_TICKET_PRIORITY,
      status: isTicketStatus(t.status) ? t.status : DEFAULT_TICKET_STATUS,
      reporterId: str(t.reporterId),
      createdAt: str(t.createdAt),
      updatedAt: str(t.updatedAt),
    });
  }
  return { ...data, tickets };
}

/**
 * Idempotent normalize pass for stable completion semantics. Runs on EVERY load
 * — same philosophy as normalizeTaskMeta / normalizeDates — so a payload with a
 * missing or malformed `isDone` (e.g. a v6 payload predating the flag, or one
 * persisted mid-dev via HMR) self-heals instead of staying broken.
 *
 * Two steps:
 * 1. Coerce each status's `isDone` to a strict boolean (`s.isDone === true`).
 * 2. If any statuses exist and NONE is done, mark a default: the LAST ACTIVE
 *    status by `order` (exactly what the removed `doneStatusId` selector used to
 *    return, so migrated data keeps its current done semantics). If every status
 *    is archived, mark the last status overall by `order` (a deliberate repair
 *    of a pathological all-archived pipeline). Zero statuses → mark nothing.
 *
 * Idempotent by value: once ≥1 status is done it never rewrites flags, so a
 * second pass on its own output changes nothing.
 */
export function normalizeStatusFlags(data: AppData): AppData {
  let changed = false;
  const statuses = data.statuses.map((s) => {
    const isDone = s.isDone === true;
    if (s.isDone === isDone) return s;
    changed = true;
    return { ...s, isDone };
  });

  // Older admin actions could archive every status. Keep one deterministic
  // column visible instead of leaving existing projects unreachable in Kanban.
  if (statuses.length > 0 && !statuses.some((s) => !s.archived)) {
    const done = statuses.filter((s) => s.isDone);
    const pool = done.length > 0 ? done : statuses;
    const target = pool.reduce((last, s) => (s.order >= last.order ? s : last), pool[0]);
    return {
      ...data,
      statuses: statuses.map((s) =>
        s.id === target.id ? { ...s, archived: false, isDone: true } : s,
      ),
    };
  }

  if (statuses.length > 0 && !statuses.some((s) => s.isDone)) {
    const active = statuses.filter((s) => !s.archived);
    const pool = active.length > 0 ? active : statuses;
    const target = pool.reduce((last, s) => (s.order >= last.order ? s : last), pool[0]);
    const marked = statuses.map((s) => (s.id === target.id ? { ...s, isDone: true } : s));
    return { ...data, statuses: marked };
  }

  if (!changed) return data;
  return { ...data, statuses };
}

/**
 * The status a task/project should fall back to when its stored one is missing.
 * Mirrors the "create a task/project" idiom used across the UI
 * (`activeStatuses(state)[0]` in TaskModal / ProjectsPage): the first ACTIVE
 * (unarchived) status by `order`, but preferring a non-done column so repaired
 * work does not silently land in "done". Falls back to the first active status
 * (when every active status is done), then the first status overall (all
 * archived). Empty pipeline → '' (caller skips the remap).
 */
function defaultStatusId(statuses: Status[]): string {
  if (statuses.length === 0) return '';
  const ordered = [...statuses].sort((a, b) => a.order - b.order);
  const active = ordered.filter((s) => !s.archived);
  const target = active.find((s) => !s.isDone) ?? active[0] ?? ordered[0];
  return target.id;
}

/**
 * Idempotent every-load pass guaranteeing every task/project `statusId` resolves
 * to an EXISTING status. Runs AFTER normalizeStatusFlags has finalized the
 * pipeline (archived/isDone repairs included) so `defaultStatusId` sees the real
 * final statuses.
 *
 * A dangling `statusId` reaches this pass two ways: a stored payload
 * hand-edited to a garbage/deleted status id, OR the collection-coercion pass
 * regenerating the default statuses with fresh ids while tasks/projects keep
 * their old ids. Either way isValidTaskDraft / isValidProjectDraft
 * (commandValidation.ts) would then reject EVERY subsequent save — the modal
 * closes and markSaved() fires as if persisted while nothing is written (silent
 * false-success). Remapping the reference to the default status keeps saves
 * working.
 *
 * Idempotent by value: once every reference resolves, a second pass changes
 * nothing and a fully-valid payload returns the SAME object reference. When
 * there are no statuses at all (a legitimately empty pipeline) nothing is
 * remapped — there is no status to point at.
 */
export function repairStatusReferences(data: AppData): AppData {
  if (data.statuses.length === 0) return data;
  const ids = new Set(data.statuses.map((s) => s.id));
  const fallback = defaultStatusId(data.statuses);
  let changed = false;

  const tasks = data.tasks.map((t) => {
    if (ids.has(t.statusId)) return t;
    changed = true;
    return { ...t, statusId: fallback };
  });
  const projects = data.projects.map((p) => {
    if (ids.has(p.statusId)) return p;
    changed = true;
    return { ...p, statusId: fallback };
  });

  if (!changed) return data;
  return { ...data, tasks, projects };
}

// ---- Persistence outcome + same-browser tab-safety revision protocol ----
// NOTE: everything below is SAME-BROWSER tab safety — NOT multi-user sync,
// collaboration, backups, or a backend. All data stays in this browser's
// localStorage. `revision` is an envelope field written alongside the AppData
// payload; it lets a second tab of the SAME browser notice that another tab
// wrote after it loaded, and keeps writes monotonic across ping-ponging tabs.

export type SaveFailureReason = 'quota' | 'unavailable' | 'serialization' | 'unknown';
export type SaveResult = { ok: true; revision: number } | { ok: false; reason: SaveFailureReason };
/** Payload of an external same-browser tab write. `null` = key cleared / unparsable. */
export type ExternalChangeInfo = { revision: number | null };

// Monotonic revision counter, owned entirely by this module. Bumped on every
// successful save; recorded (not bumped) on load and max-merged on external
// storage events, so a later local write always lands ABOVE any observed
// external revision. NEVER stored in React state — a stale in-state copy would
// lie about which write is newest.
let latestKnownRevision = 0;

/** The highest revision this module has written or observed. Exposed for tests. */
export function getLatestKnownRevision(): number {
  return latestKnownRevision;
}

/** Coerce an unknown envelope revision to a finite integer ≥ 0, else null. */
function coerceRevision(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * Parse a raw stored JSON string and return its envelope `revision` (finite
 * integer ≥ 0), or null on null / parse failure / absent / invalid. Pure — used
 * by the storage-event listener and by unit tests.
 */
export function readEnvelopeRevision(raw: string | null): number | null {
  if (raw == null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    return coerceRevision((parsed as Record<string, unknown>).revision);
  } catch {
    return null;
  }
}

/**
 * Classify a thrown storage error into a SaveFailureReason. Reads `name`/`code`
 * defensively off an unknown (no `instanceof DOMException`) so it also works in
 * the node test env with error-LIKE plain objects.
 * - QuotaExceededError / NS_ERROR_DOM_QUOTA_REACHED / code 22 / code 1014 →
 *   `quota` (Chromium / Firefox / Safari incl. legacy Safari private mode).
 * - SecurityError → `unavailable`.
 * - anything else → `unknown`.
 */
export function classifyStorageError(err: unknown): SaveFailureReason {
  const e = (err ?? {}) as { name?: unknown; code?: unknown };
  const name = typeof e.name === 'string' ? e.name : '';
  const code = typeof e.code === 'number' ? e.code : undefined;
  if (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    code === 22 ||
    code === 1014
  ) {
    return 'quota';
  }
  if (name === 'SecurityError') return 'unavailable';
  return 'unknown';
}

/**
 * Subscribe to same-browser external tab writes. Adds a `window` `storage`
 * listener — which never fires in the originating tab, so every relevant event
 * is external by definition (no writer-id needed). Ignores events whose `key`
 * is neither STORAGE_KEY nor `null` (`null` = another tab called
 * `localStorage.clear()`). For a relevant event it max-merges
 * latestKnownRevision with the incoming revision BEFORE invoking the callback,
 * so a later local write always lands above the observed external revision.
 * Returns an unsubscribe. Same-browser tab safety only — NOT multi-user sync.
 */
export function subscribeExternalChanges(cb: (info: ExternalChangeInfo) => void): () => void {
  const handler = (e: StorageEvent): void => {
    if (e.key !== STORAGE_KEY && e.key !== null) return;
    const incoming = readEnvelopeRevision(e.newValue);
    latestKnownRevision = Math.max(latestKnownRevision, incoming ?? 0);
    cb({ revision: incoming });
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}

export type LoadFailureReason = 'unavailable' | 'malformed' | 'invalid';
export type LoadDataResult =
  | { ok: true; data: AppData; needsWriteback: boolean }
  | { ok: false; reason: LoadFailureReason; error: Error };

/**
 * Side-effect-free read result (see peekDataResult). Same parse/migration/repair
 * pipeline as loadDataResult, but never records a revision and never writes.
 * `storedVersion` is the raw `version` field of the stored JSON (1 when absent,
 * DATA_VERSION when nothing is stored), for diagnostics/export metadata.
 */
export type PeekDataResult =
  | { ok: true; data: AppData; storedVersion: number }
  | { ok: false; reason: LoadFailureReason; error: Error };

function loadFailure(
  reason: LoadFailureReason,
): { ok: false; reason: LoadFailureReason; error: Error } {
  const detail =
    reason === 'unavailable'
      ? 'Pamięć przeglądarki jest niedostępna.'
      : reason === 'malformed'
        ? 'Zapisany JSON jest uszkodzony.'
        : 'Zapisane dane mają nieprawidłową strukturę.';
  return {
    ok: false,
    reason,
    error: new Error(`Nie udało się odczytać zapisanych danych. ${detail}`),
  };
}

/** Deep equality for JSON-compatible stored values, independent of object key order. */
function storedValueEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((value, i) => storedValueEqual(value, b[i]));
  }
  if (typeof a !== 'object') return false;
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord).sort();
  const bKeys = Object.keys(bRecord).sort();
  if (aKeys.length !== bKeys.length || aKeys.some((key, i) => key !== bKeys[i])) return false;
  return aKeys.every((key) => storedValueEqual(aRecord[key], bRecord[key]));
}

type InternalLoadResult =
  | { ok: true; data: AppData; needsWriteback: boolean; storedVersion: number }
  | { ok: false; reason: LoadFailureReason; error: Error };

/**
 * The shared load pipeline behind both loadDataResult (recordRevision = true,
 * the app load path) and peekDataResult (recordRevision = false, the read-only
 * export/dry-run tool). It NEVER writes to localStorage; the only side effect is
 * the `latestKnownRevision` bookkeeping, gated entirely by `recordRevision` so a
 * peek is provably free of side effects. Keeping one body guarantees the peek
 * runs the exact same migration/repair passes the real load does.
 */
function readData(recordRevision: boolean): InternalLoadResult {
  let raw: string | null = null;
  let sourceKey: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      sourceKey = STORAGE_KEY;
    } else {
      for (const key of LEGACY_STORAGE_KEYS) {
        const candidate = localStorage.getItem(key);
        if (candidate) {
          raw = candidate;
          sourceKey = key;
          break;
        }
      }
    }
  } catch {
    return loadFailure('unavailable');
  }

  if (!raw) {
    if (recordRevision) latestKnownRevision = 0;
    return { ok: true, data: emptyData(), needsWriteback: false, storedVersion: DATA_VERSION };
  }

  let parsed: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(raw);
    if (!looksLikeData(value)) return loadFailure('invalid');
    parsed = value;
  } catch {
    return loadFailure('malformed');
  }

  try {
    // Record the stored envelope revision so the next local save lands above it.
    // Stripped from the returned AppData below (both branches) — React state
    // never carries a revision. Skipped entirely for a side-effect-free peek.
    if (recordRevision) latestKnownRevision = coerceRevision(parsed.revision) ?? 0;
    const version = typeof parsed.version === 'number' ? parsed.version : 1;
    let data: AppData;
    if (version < 2) {
      data = repairTickets(
        repairStatusReferences(
          sanitizeImpersonator(
            normalizeStatusFlags(
              normalizeTaskMeta(
                ensureStartMinutes(
                  normalizeDates(
                    normalizeWorkloadHours(migrateV4toV5(localizeLegacyData(migrateV1(parsed)))),
                  ),
                ),
              ),
            ),
          ),
        ),
      );
    } else {
      // Same-version load: fill any missing fields with defaults. Strip the
      // envelope `revision` so React state never carries persistence metadata.
      const { revision: _revision, ...parsedRest } = parsed;
      // `looksLikeData` only guarantees tasks/people/workload are arrays. Any
      // OTHER collection present-but-non-array (e.g. a stored `"statuses":
      // null`) would spread over its emptyData default and then throw inside a
      // downstream `.map` repair pass, and the catch below would discard the
      // WHOLE payload. Coerce every collection to its emptyData default so one
      // corrupt collection is repaired in isolation while every valid
      // collection survives. tasks/people/workload are already array-guaranteed
      // here by looksLikeData (a non-array there fails closed to recovery
      // upstream) — coercing them too is harmless defense in depth.
      const defaults = emptyData();
      const loaded: AppData = {
        ...defaults,
        ...(parsedRest as Partial<AppData>),
        version: DATA_VERSION,
        clients: coerceArray(parsedRest.clients, defaults.clients),
        departments: coerceArray(parsedRest.departments, defaults.departments),
        serviceTypes: coerceArray(parsedRest.serviceTypes, defaults.serviceTypes),
        workCategories: coerceArray(parsedRest.workCategories, defaults.workCategories),
        statuses: coerceArray(parsedRest.statuses, defaults.statuses),
        projects: coerceArray(parsedRest.projects, defaults.projects),
        milestones: coerceArray(parsedRest.milestones, defaults.milestones),
        tasks: coerceArray(parsedRest.tasks, defaults.tasks),
        people: coerceArray(parsedRest.people, defaults.people),
        assignments: coerceArray(parsedRest.assignments, defaults.assignments),
        workload: coerceArray(parsedRest.workload, defaults.workload),
        comments: coerceArray(parsedRest.comments, defaults.comments),
        activity: coerceArray(parsedRest.activity, defaults.activity),
        tickets: coerceArray(parsedRest.tickets, defaults.tickets),
        savedFilters: coerceArray(parsedRest.savedFilters, defaults.savedFilters),
      };
      const localized =
        version < LOCALIZATION_MIGRATION_VERSION ? localizeLegacyData(loaded) : loaded;
      const migrated = migrateV4toV5(localized);
      data = repairTickets(
        repairStatusReferences(
          sanitizeImpersonator(
            normalizeStatusFlags(
              normalizeTaskMeta(
                ensureStartMinutes(normalizeDates(normalizeWorkloadHours(migrated))),
              ),
            ),
          ),
        ),
      );
    }

    // Odnośniki do dokumentów projektu: pole ADDYTYWNE, więc repair biegnie na
    // WYNIKU obu ścieżek (migracja i wczytanie w tej samej wersji) — zapis bez
    // `documents` wychodzi stąd z pustą listą.
    data = repairProjectDocuments(data);

    const { revision: _revision, ...storedData } = parsed;
    return {
      ok: true,
      data,
      needsWriteback: sourceKey !== STORAGE_KEY || !storedValueEqual(storedData, data),
      storedVersion: version,
    };
  } catch {
    return loadFailure('invalid');
  }
}

/**
 * Load persisted data together with explicit initial-writeback metadata.
 * Missing storage is a successful empty load. Any non-empty unreadable,
 * malformed or structurally invalid payload fails closed so the provider can
 * route it through the recovery boundary without replacing the raw source.
 */
export function loadDataResult(): LoadDataResult {
  const result = readData(true);
  if (!result.ok) return result;
  return { ok: true, data: result.data, needsWriteback: result.needsWriteback };
}

/**
 * Read the persisted data WITHOUT any side effect: no localStorage write and no
 * `latestKnownRevision` mutation (unlike loadDataResult). Runs the identical
 * parse/migration/repair pipeline and returns the normalized AppData plus the
 * raw `storedVersion`. Backs the admin-only export + migration dry-run tool,
 * which must never disturb the app's load/save bookkeeping. A missing key is a
 * clean empty load stamped at DATA_VERSION.
 */
export function peekDataResult(): PeekDataResult {
  const result = readData(false);
  if (!result.ok) return result;
  return { ok: true, data: result.data, storedVersion: result.storedVersion };
}

/** Compatibility entry point for non-provider callers; failures intentionally throw. */
export function loadData(): AppData {
  const result = loadDataResult();
  if (!result.ok) throw result.error;
  return result.data;
}

/**
 * The raw persisted JSON string (pre-normalization), for the error boundary's
 * "export my data" recovery button. Reads STORAGE_KEY, falling back to the
 * legacy keys; returns null when nothing is stored or storage throws.
 */
export function exportRawData(): string | null {
  try {
    return (
      localStorage.getItem(STORAGE_KEY) ??
      LEGACY_STORAGE_KEYS.map((key) => localStorage.getItem(key)).find(Boolean) ??
      null
    );
  } catch {
    return null;
  }
}

/**
 * Persist the whole AppData, reporting the real outcome (never swallowed).
 * Writes `{ ...data, revision }` with `revision = latestKnownRevision + 1`; on
 * success records the new revision and returns it. Serialization is detected
 * positionally (its own try around JSON.stringify → `serialization`, without
 * touching localStorage or latestKnownRevision); storage-layer throws are
 * classified by classifyStorageError. Same-browser tab safety only — the
 * revision envelope is not a sync/backup protocol. Does not mutate `data`.
 */
export function saveData(data: AppData): SaveResult {
  const revision = latestKnownRevision + 1;
  let raw: string;
  try {
    raw = JSON.stringify({ ...data, revision });
  } catch {
    return { ok: false, reason: 'serialization' };
  }
  try {
    localStorage.setItem(STORAGE_KEY, raw);
  } catch (err) {
    return { ok: false, reason: classifyStorageError(err) };
  }
  latestKnownRevision = revision;
  return { ok: true, revision };
}

// ---- Znacznik wycofania zapisów lokalnych (per-przeglądarka) ----------------
// DEDYKOWANY klucz POZA kluczem danych planera. Cache decyzji organizacji
// (app_settings.local_writes_retired) aktualizowany po każdej udanej hydracji.
// `clearData()` NIGDY go nie dotyka — reset/sample nie zmieniają decyzji migracji.

const CLOUD_MIGRATION_KEY = 'n2hub.cloudMigration.v1';

/** Odczyt zbuforowanego znacznika wycofania. Brak / błąd => `{ enabled: false }`. */
export function readCloudRetirementMarker(): { enabled: boolean } {
  try {
    const raw = localStorage.getItem(CLOUD_MIGRATION_KEY);
    if (!raw) return { enabled: false };
    const parsed: unknown = JSON.parse(raw);
    return { enabled: (parsed as { enabled?: unknown })?.enabled === true };
  } catch {
    return { enabled: false };
  }
}

/** Zapis zbuforowanego znacznika wycofania (na dedykowanym kluczu). Nie rzuca. */
export function writeCloudRetirementMarker(marker: { enabled: boolean }): void {
  try {
    localStorage.setItem(
      CLOUD_MIGRATION_KEY,
      JSON.stringify({ enabled: marker.enabled === true }),
    );
  } catch {
    // ignore — brak trwałego cache degraduje bramkę do „zapisuj lokalnie”.
  }
}

export function clearData(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    LEGACY_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
  } catch {
    // ignore
  }
  latestKnownRevision = 0;
}
