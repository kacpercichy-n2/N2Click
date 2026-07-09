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
import { BIN_DATE, hoursToMinutes, nextFreeStart } from '../utils/time';

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
  const depDesign = { id: uid(), name: 'Projektowanie' };
  const depDev = { id: uid(), name: 'Programowanie' };
  const depMgmt = { id: uid(), name: 'Zarządzanie' };
  const departments = [depDesign, depDev, depMgmt];

  const svcWeb = { id: uid(), name: 'WWW' };
  const svcBrand = { id: uid(), name: 'Marka' };
  const svcSocial = { id: uid(), name: 'Media społecznościowe' };
  const serviceTypes = [svcWeb, svcBrand, svcSocial];

  // Work categories (admin-managed dictionary; referenced by task.workCategoryId)
  const catKreacja = { id: uid(), name: 'Kreacja' };
  const catWdrozenie = { id: uid(), name: 'Wdrożenie' };
  const catTesty = { id: uid(), name: 'Testy' };
  const workCategories = [catKreacja, catWdrozenie, catTesty];

  // People. Work hours default to 8:00–16:00 (480 → min(1440, 480+capacity*60)).
  // All passwordless (passwordHash: '') so the demo can log in without a password.
  // Kasia is defined first so she can be the others' supervisor; the `people`
  // array order [ola, marek, kasia] is preserved for stable person colours.
  const kasia: Person = {
    id: uid(),
    firstName: 'Kasia',
    lastName: 'Kowalska',
    name: 'Kasia Kowalska',
    email: 'kasia@n2.example',
    phone: '+48 501 100 100',
    role: 'Kierowniczka projektu',
    departmentId: depMgmt.id,
    avatar: '📋',
    capacity: DEFAULT_CAPACITY,
    accessRole: 'administrator', // Kasia manages statuses & admin settings
    passwordHash: '',
    workDays: [1, 2, 3, 4, 5],
    workStartMinutes: 480,
    workEndMinutes: Math.min(1440, 480 + DEFAULT_CAPACITY * 60),
    supervisorId: '',
  };
  const ola: Person = {
    id: uid(),
    firstName: 'Ola',
    lastName: 'Nowak',
    name: 'Ola Nowak',
    email: 'ola@n2.example',
    phone: '+48 502 200 200',
    role: 'Projektantka',
    departmentId: depDesign.id,
    avatar: '🎨',
    capacity: DEFAULT_CAPACITY,
    accessRole: 'pm',
    passwordHash: '',
    workDays: [1, 2, 3, 4], // Mon–Thu — availability math is visibly non-uniform
    workStartMinutes: 480,
    workEndMinutes: Math.min(1440, 480 + DEFAULT_CAPACITY * 60),
    supervisorId: kasia.id,
  };
  const marek: Person = {
    id: uid(),
    firstName: 'Marek',
    lastName: 'Wiśniewski',
    name: 'Marek Wiśniewski',
    email: 'marek@n2.example',
    phone: '+48 503 300 300',
    role: 'Programista',
    departmentId: depDev.id,
    avatar: '💻',
    capacity: DEFAULT_CAPACITY,
    accessRole: 'pracownik',
    passwordHash: '',
    workDays: [1, 2, 3, 4, 5],
    workStartMinutes: 480,
    workEndMinutes: Math.min(1440, 480 + DEFAULT_CAPACITY * 60),
    supervisorId: kasia.id,
  };
  const people: Person[] = [ola, marek, kasia];

  // Clients & projects
  const acme = { id: uid(), name: 'Acme Foods', archived: false };
  const nordic = { id: uid(), name: 'Nordic Fitness', archived: false };
  const clients = [acme, nordic];

  const projRedesign = {
    id: uid(),
    clientId: acme.id,
    name: 'Redesign strony',
    description: 'Pełne odświeżenie strony marketingowej Acme: sekcja hero, cennik i studia przypadków.',
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
    name: 'Kampania letnia',
    description: 'Kampania w mediach społecznościowych Q3 dla letniej premiery Nordic Fitness.',
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
    name: 'Wydanie aplikacji 2.4',
    description: 'Stabilizacja i publikacja wersji 2.4 aplikacji do zamówień.',
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
    { id: uid(), projectId: projRedesign.id, name: 'Projekt zaakceptowany', date: thu },
    { id: uid(), projectId: projRedesign.id, name: 'Publikacja', date: addDaysStr(fri, 14) },
    { id: uid(), projectId: projCampaign.id, name: 'Przegląd koncepcji', date: addDaysStr(fri, 7) },
    { id: uid(), projectId: projRelease.id, name: 'Zamknięcie wydania', date: fri },
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
    // Stack each person/day schedule from 08:00, appending to the last block.
    const existing = workload.filter((w) => w.personId === personId && w.date === date);
    const startMinutes = nextFreeStart(existing, hoursToMinutes(plannedHours));
    workload.push({ id: uid(), taskId, personId, date, plannedHours, startMinutes, sortIndex });
  };
  // A dateless "bin" block: startMinutes 0, contiguous sortIndex per person bin.
  const addBinWork = (taskId: string, personId: string, plannedHours: number) => {
    if (plannedHours <= 0) return;
    const key = `${personId}|${BIN_DATE}`;
    const sortIndex = sortCounters.get(key) ?? 0;
    sortCounters.set(key, sortIndex + 1);
    workload.push({ id: uid(), taskId, personId, date: BIN_DATE, plannedHours, startMinutes: 0, sortIndex });
  };

  // --- Task 1: multi-person design/dev task (Mon–Fri this week) ---
  const t1: Task = {
    id: uid(),
    projectId: projRedesign.id,
    statusId: wip.id,
    title: 'Strona główna i cennik',
    description: 'Zaprojektowanie i wdrożenie nowej sekcji hero, tabeli cen oraz studiów przypadków.',
    startDate: mon,
    endDate: fri,
    estimatedHours: 40,
    priority: 'high',
    workCategoryId: catKreacja.id,
    checklist: [
      { id: uid(), text: 'Moodboard zaakceptowany', done: true },
      { id: uid(), text: 'Sekcja hero', done: false },
      { id: uid(), text: 'Tabela cen', done: false },
    ],
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
  // Ola has 3h of unscheduled hero work sitting in her bin (zasobnik).
  addBinWork(t1.id, ola.id, 3);

  // --- Task 2: task with zero-hour gap days inside its period ---
  // Kasia plans the campaign: works Mon and Thu/Fri, but Tue/Wed are intentional
  // 0h gap days that REMAIN inside the task period.
  const t2: Task = {
    id: uid(),
    projectId: projCampaign.id,
    statusId: todo.id,
    title: 'Koncepcja i plan kampanii',
    description:
      'Zakres kampanii letniej; środek tygodnia zarezerwowany na przegląd z interesariuszami.',
    startDate: mon,
    endDate: fri,
    estimatedHours: 12,
    priority: 'normal',
    workCategoryId: catKreacja.id,
    checklist: [],
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
    title: 'Sprint poprawek do wydania',
    description: 'Krytyczne poprawki przed zamknięciem wydania.',
    startDate: wed,
    endDate: fri,
    estimatedHours: 16,
    priority: 'urgent',
    workCategoryId: catWdrozenie.id,
    checklist: [],
    createdAt: now,
    updatedAt: now,
  };
  tasks.push(t3);
  addAssign(t3.id, marek.id);
  addWork(t3.id, marek.id, wed, 4); // -> Marek Wed total = 10h (overload)
  addWork(t3.id, marek.id, thu, 2);
  addWork(t3.id, marek.id, fri, 3);
  // Marek keeps 2h of this sprint in his bin so his "Moja praca" zasobnik has
  // content (9h dated + 2h bin = 11h ≤ 16h estimate — budget-safe).
  addBinWork(t3.id, marek.id, 2);

  // --- Task 4: done QA pass last week (fills out the pipeline & timeline) ---
  const t4: Task = {
    id: uid(),
    projectId: projRelease.id,
    statusId: done.id,
    title: 'Regresja QA',
    description: 'Pełny zestaw testów regresji na stagingu.',
    startDate: addDaysStr(mon, -7),
    endDate: addDaysStr(fri, -7),
    estimatedHours: 10,
    priority: 'normal',
    workCategoryId: catTesty.id,
    checklist: [],
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
      body: `@${ola.firstName} klient zaakceptował moodboard — można ruszać z projektami sekcji hero.`,
      mentionIds: [ola.id],
      createdAt: now,
    },
    {
      id: uid(),
      entityType: 'task' as const,
      entityId: t3.id,
      authorId: marek.id,
      body: 'Zostały dwa blokery, reszta to dopracowanie. Zamknięcie wydania nadal wygląda bezpiecznie.',
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
      message: 'utworzył(a) projekt',
      createdAt: now,
    },
    {
      id: uid(),
      entityType: 'project' as const,
      entityId: projRedesign.id,
      actorId: kasia.id,
      message: 'oznaczył(a) projekt jako opłacony',
      createdAt: now,
    },
  ];

  return {
    version: DATA_VERSION,
    clients,
    departments,
    serviceTypes,
    workCategories,
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
    impersonatorId: '',
    sampleBannerDismissed: true,
    savedFilters: [],
  };
}
