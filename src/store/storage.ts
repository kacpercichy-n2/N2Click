// Single persistence module. Wraps localStorage so it can be swapped for an API later.
// The stored JSON is versioned; loadData migrates older payloads forward.
import type { AppData, Person, Status } from '../types';

const STORAGE_KEY = 'n2click.data.v1';
export const DATA_VERSION = 3;

export const DEFAULT_CAPACITY = 8; // hours available per person per day

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
    sampleBannerDismissed: false,
  };
}

function looksLikeData(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.tasks) && Array.isArray(v.people) && Array.isArray(v.workload);
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

  // People: split "First Last", defaults for the new fields.
  const people: Person[] = v1People.map((p, i) => {
    const name = (p.name ?? '').trim();
    const spaceIdx = name.indexOf(' ');
    const firstName = spaceIdx === -1 ? name : name.slice(0, spaceIdx);
    const lastName = spaceIdx === -1 ? '' : name.slice(spaceIdx + 1);
    return {
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
    };
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
    return { ...w, sortIndex: idx };
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

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyData();
    const parsed: unknown = JSON.parse(raw);
    if (!looksLikeData(parsed)) return emptyData();
    const version = typeof parsed.version === 'number' ? parsed.version : 1;
    if (version < 2) return localizeLegacyData(migrateV1(parsed));
    // Same-version load: fill any missing fields with defaults.
    const loaded = {
      ...emptyData(),
      ...(parsed as Partial<AppData>),
      version: DATA_VERSION,
    };
    return version < DATA_VERSION ? localizeLegacyData(loaded) : loaded;
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
  } catch {
    // ignore
  }
}
