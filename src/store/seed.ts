// Sample data generator. Dates are computed relative to TODAY so the seed always
// lands in the current week/month. Demonstrates every feature: clients ->
// projects (statuses across the pipeline, paid + unpaid) -> tasks -> time
// blocks; milestones; comments with @mentions; a zero-hour gap day; and a day
// where one person totals over capacity so the overload indicator shows.
import type {
  AppData,
  Person,
  Task,
  TaskAssignment,
  WorkloadEntry,
} from '../types';
import { buildDefaultStatuses, DATA_VERSION, DEFAULT_CAPACITY } from './storage';
import { addDaysStr, todayStr, weekDays } from '../utils/dates';

function uid(): string {
  return crypto.randomUUID();
}

export function buildSampleData(): AppData {
  const now = new Date().toISOString();
  const today = todayStr();

  // Anchor allocations to this week (Mon..Sun) so the demo is legible in the
  // Week view without navigating. weekDays returns 'yyyy-MM-dd' Mon..Sun.
  const [mon, tue, wed, thu, fri] = weekDays(today);

  const statuses = buildDefaultStatuses();
  const [todo, wip, accept, done] = statuses;

  // Departments & service types (the structured tag categories)
  const depDesign = { id: uid(), name: 'Design' };
  const depDev = { id: uid(), name: 'Development' };
  const depMgmt = { id: uid(), name: 'Management' };
  const departments = [depDesign, depDev, depMgmt];

  const svcWeb = { id: uid(), name: 'Web' };
  const svcBrand = { id: uid(), name: 'Branding' };
  const svcSocial = { id: uid(), name: 'Social media' };
  const serviceTypes = [svcWeb, svcBrand, svcSocial];

  // People
  const ola: Person = {
    id: uid(),
    firstName: 'Ola',
    lastName: 'Nowak',
    name: 'Ola Nowak',
    email: 'ola@n2.example',
    role: 'Designer',
    departmentId: depDesign.id,
    avatar: '🎨',
    capacity: DEFAULT_CAPACITY,
    isAdmin: false,
  };
  const marek: Person = {
    id: uid(),
    firstName: 'Marek',
    lastName: 'Wiśniewski',
    name: 'Marek Wiśniewski',
    email: 'marek@n2.example',
    role: 'Developer',
    departmentId: depDev.id,
    avatar: '💻',
    capacity: DEFAULT_CAPACITY,
    isAdmin: false,
  };
  const kasia: Person = {
    id: uid(),
    firstName: 'Kasia',
    lastName: 'Kowalska',
    name: 'Kasia Kowalska',
    email: 'kasia@n2.example',
    role: 'Project Manager',
    departmentId: depMgmt.id,
    avatar: '📋',
    capacity: DEFAULT_CAPACITY,
    isAdmin: true, // Kasia manages statuses & admin settings
  };
  const people: Person[] = [ola, marek, kasia];

  // Clients & projects
  const acme = { id: uid(), name: 'Acme Foods', archived: false };
  const nordic = { id: uid(), name: 'Nordic Fitness', archived: false };
  const clients = [acme, nordic];

  const projRedesign = {
    id: uid(),
    clientId: acme.id,
    name: 'Website redesign',
    description: 'Full refresh of the Acme marketing site: hero, pricing, case studies.',
    statusId: wip.id,
    paid: true, // gold coin
    startDate: mon,
    endDate: addDaysStr(fri, 14),
    departmentId: depDesign.id,
    serviceTypeId: svcWeb.id,
    createdAt: now,
    updatedAt: now,
  };
  const projCampaign = {
    id: uid(),
    clientId: nordic.id,
    name: 'Summer campaign',
    description: 'Q3 social campaign for the Nordic Fitness summer launch.',
    statusId: todo.id,
    paid: false, // bronze coin
    startDate: mon,
    endDate: addDaysStr(fri, 21),
    departmentId: depMgmt.id,
    serviceTypeId: svcSocial.id,
    createdAt: now,
    updatedAt: now,
  };
  const projRelease = {
    id: uid(),
    clientId: acme.id,
    name: 'App release 2.4',
    description: 'Stabilise and ship the 2.4 release of the ordering app.',
    statusId: accept.id,
    paid: true,
    startDate: addDaysStr(mon, -7),
    endDate: fri,
    departmentId: depDev.id,
    serviceTypeId: svcWeb.id,
    createdAt: now,
    updatedAt: now,
  };
  const projects = [projRedesign, projCampaign, projRelease];

  const milestones = [
    { id: uid(), projectId: projRedesign.id, name: 'Design approved', date: thu },
    { id: uid(), projectId: projRedesign.id, name: 'Go live', date: addDaysStr(fri, 14) },
    { id: uid(), projectId: projCampaign.id, name: 'Concept review', date: addDaysStr(fri, 7) },
    { id: uid(), projectId: projRelease.id, name: 'Release cut', date: fri },
  ];

  const tasks: Task[] = [];
  const assignments: TaskAssignment[] = [];
  const workload: WorkloadEntry[] = [];

  const addAssign = (taskId: string, personId: string) =>
    assignments.push({ id: uid(), taskId, personId });
  const sortCounters = new Map<string, number>();
  const addWork = (
    taskId: string,
    personId: string,
    date: string,
    plannedHours: number,
  ) => {
    if (plannedHours <= 0) return;
    const key = `${personId}|${date}`;
    const sortIndex = sortCounters.get(key) ?? 0;
    sortCounters.set(key, sortIndex + 1);
    workload.push({ id: uid(), taskId, personId, date, plannedHours, sortIndex });
  };

  // --- Task 1: multi-person design/dev task (Mon–Fri this week) ---
  const t1: Task = {
    id: uid(),
    projectId: projRedesign.id,
    statusId: wip.id,
    title: 'Homepage & pricing pages',
    description: 'Design and build the new hero, pricing table, and case studies.',
    startDate: mon,
    endDate: fri,
    estimatedHours: 40,
    createdAt: now,
    updatedAt: now,
  };
  tasks.push(t1);
  addAssign(t1.id, ola.id);
  addAssign(t1.id, marek.id);
  // Ola design work
  addWork(t1.id, ola.id, mon, 6);
  addWork(t1.id, ola.id, tue, 6);
  addWork(t1.id, ola.id, wed, 4);
  addWork(t1.id, ola.id, thu, 5);
  // Marek dev work — Wed he is heavily booked (contributes to >8h total, see t3)
  addWork(t1.id, marek.id, tue, 4);
  addWork(t1.id, marek.id, wed, 6);
  addWork(t1.id, marek.id, thu, 6);
  addWork(t1.id, marek.id, fri, 5);

  // --- Task 2: task with zero-hour gap days inside its period ---
  // Kasia plans the campaign: works Mon and Thu/Fri, but Tue/Wed are intentional
  // 0h gap days that REMAIN inside the task period.
  const t2: Task = {
    id: uid(),
    projectId: projCampaign.id,
    statusId: todo.id,
    title: 'Campaign concept & plan',
    description:
      'Scope the summer campaign; mid-week reserved for stakeholder review.',
    startDate: mon,
    endDate: fri,
    estimatedHours: 12,
    createdAt: now,
    updatedAt: now,
  };
  tasks.push(t2);
  addAssign(t2.id, kasia.id);
  addWork(t2.id, kasia.id, mon, 4);
  // Tue, Wed: 0h gap days (no entries)
  addWork(t2.id, kasia.id, thu, 3);
  addWork(t2.id, kasia.id, fri, 3);

  // --- Task 3: bugfix sprint that overloads Marek on Wednesday ---
  // Marek already has 6h on Wed from t1; add 4h here => 10h total on Wed (>8h).
  const t3: Task = {
    id: uid(),
    projectId: projRelease.id,
    statusId: accept.id,
    title: 'Release bugfix sprint',
    description: 'Critical fixes before the release cut.',
    startDate: wed,
    endDate: fri,
    estimatedHours: 16,
    createdAt: now,
    updatedAt: now,
  };
  tasks.push(t3);
  addAssign(t3.id, marek.id);
  addWork(t3.id, marek.id, wed, 4); // -> Marek Wed total = 10h (overload)
  addWork(t3.id, marek.id, thu, 2);
  addWork(t3.id, marek.id, fri, 3);

  // --- Task 4: done QA pass last week (fills out the pipeline & timeline) ---
  const t4: Task = {
    id: uid(),
    projectId: projRelease.id,
    statusId: done.id,
    title: 'Regression QA pass',
    description: 'Full regression suite on staging.',
    startDate: addDaysStr(mon, -7),
    endDate: addDaysStr(fri, -7),
    estimatedHours: 10,
    createdAt: now,
    updatedAt: now,
  };
  tasks.push(t4);
  addAssign(t4.id, kasia.id);
  addWork(t4.id, kasia.id, addDaysStr(mon, -7), 4);
  addWork(t4.id, kasia.id, addDaysStr(tue, -7), 4);
  addWork(t4.id, kasia.id, addDaysStr(wed, -7), 2);

  // Comments with an @mention, plus a seeded activity trail.
  const comments = [
    {
      id: uid(),
      entityType: 'project' as const,
      entityId: projRedesign.id,
      authorId: kasia.id,
      body: `@${ola.firstName} client approved the moodboard — go ahead with the hero designs.`,
      mentionIds: [ola.id],
      createdAt: now,
    },
    {
      id: uid(),
      entityType: 'task' as const,
      entityId: t3.id,
      authorId: marek.id,
      body: 'Two blockers left, rest is polish. Release cut still looks safe.',
      mentionIds: [],
      createdAt: now,
    },
  ];
  const activity = [
    {
      id: uid(),
      entityType: 'project' as const,
      entityId: projRedesign.id,
      actorId: kasia.id,
      message: 'created the project',
      createdAt: now,
    },
    {
      id: uid(),
      entityType: 'project' as const,
      entityId: projRedesign.id,
      actorId: kasia.id,
      message: 'marked the project as paid',
      createdAt: now,
    },
  ];

  return {
    version: DATA_VERSION,
    clients,
    departments,
    serviceTypes,
    statuses,
    projects,
    milestones,
    tasks,
    people,
    assignments,
    workload,
    comments,
    activity,
    currentUserId: kasia.id,
    sampleBannerDismissed: true,
  };
}
