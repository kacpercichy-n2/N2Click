// Single persistence module. Wraps localStorage so it can be swapped for an API later.
// The stored JSON is versioned; loadData migrates older payloads forward.
import type { AppData, Person, Status } from '../types';

const STORAGE_KEY = 'n2click.data.v1';
export const DATA_VERSION = 2;

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
  // Brand-compatible, dark-legible hues (used as pill text on a translucent tint
  // in StatusBadge and as bright accents on kanban columns / timeline bars):
  //   To do = cool slate, WIP = info cyan, Accept = warning amber, Done = success lime.
  const defs: Array<[string, string]> = [
    ['To do', '#9aa7c4'],
    ['Work in progress', '#5bdcff'],
    ['Accept', '#ffc857'],
    ['Done', '#b9ff4d'],
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
    const key = label || 'General';
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

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyData();
    const parsed: unknown = JSON.parse(raw);
    if (!looksLikeData(parsed)) return emptyData();
    const version = typeof parsed.version === 'number' ? parsed.version : 1;
    if (version < 2) return migrateV1(parsed);
    // Same-version load: fill any missing fields with defaults.
    return {
      ...emptyData(),
      ...(parsed as Partial<AppData>),
      version: DATA_VERSION,
    };
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
