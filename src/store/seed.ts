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
  const vela = { id: uid(), name: 'Vela Living', archived: false };
  const greenVolt = { id: uid(), name: 'GreenVolt Energy', archived: false };
  const mizu = { id: uid(), name: 'Mizu Skincare', archived: false };
  const kite = { id: uid(), name: 'Kite & Co.', archived: false };
  const clients = [acme, nordic, vela, greenVolt, mizu, kite];

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
  const projBrand = {
    id: uid(),
    clientId: vela.id,
    name: 'Nowa identyfikacja Vela Living',
    description: 'System wizualny dla kolekcji jesiennej: kierunek artystyczny, key visual, katalog i pakiet materiałów dla salonów.',
    statusId: wip.id,
    paid: true,
    startDate: addDaysStr(mon, -4),
    endDate: addDaysStr(fri, 10),
    departmentId: depDesign.id,
    serviceTypeId: svcBrand.id,
    createdAt: now,
    updatedAt: now,
  };
  const projPlatform = {
    id: uid(),
    clientId: greenVolt.id,
    name: 'Platforma partnerów instalacyjnych',
    description: 'MVP portalu dla partnerów GreenVolt: generator leadów, strefa materiałów sprzedażowych i formularz rejestracji instalacji.',
    statusId: todo.id,
    paid: false,
    startDate: addDaysStr(mon, 7),
    endDate: addDaysStr(fri, 28),
    departmentId: depDev.id,
    serviceTypeId: svcWeb.id,
    createdAt: now,
    updatedAt: now,
  };
  const projLaunch = {
    id: uid(),
    clientId: mizu.id,
    name: 'Premiera serum Hikari',
    description: 'Finalna faza kampanii premierowej: landing page, kreacje reklamowe, mailing i pakiet publikacji dla social media.',
    statusId: accept.id,
    paid: true,
    startDate: addDaysStr(mon, -10),
    endDate: addDaysStr(fri, 7),
    departmentId: depMgmt.id,
    serviceTypeId: svcSocial.id,
    createdAt: now,
    updatedAt: now,
  };
  const projAudit = {
    id: uid(),
    clientId: kite.id,
    name: 'Audyt konwersji e-commerce',
    description: 'Zakończony audyt ścieżki zakupu z listą priorytetów CRO, rekomendacjami UX i planem eksperymentów A/B.',
    statusId: done.id,
    paid: true,
    startDate: addDaysStr(mon, -24),
    endDate: addDaysStr(fri, -5),
    departmentId: depDesign.id,
    serviceTypeId: svcWeb.id,
    createdAt: now,
    updatedAt: now,
  };
  const projects = [
    projRedesign,
    projCampaign,
    projRelease,
    projBrand,
    projPlatform,
    projLaunch,
    projAudit,
  ];

  const milestones = [
    { id: uid(), projectId: projRedesign.id, name: 'Projekt zaakceptowany', date: thu },
    { id: uid(), projectId: projRedesign.id, name: 'Publikacja', date: addDaysStr(fri, 14) },
    { id: uid(), projectId: projCampaign.id, name: 'Przegląd koncepcji', date: addDaysStr(fri, 7) },
    { id: uid(), projectId: projRelease.id, name: 'Zamknięcie wydania', date: fri },
    { id: uid(), projectId: projBrand.id, name: 'Warsztat z klientem', date: addDaysStr(wed, 2) },
    { id: uid(), projectId: projBrand.id, name: 'Oddanie katalogu', date: addDaysStr(fri, 10) },
    { id: uid(), projectId: projPlatform.id, name: 'Demo MVP', date: addDaysStr(fri, 21) },
    { id: uid(), projectId: projLaunch.id, name: 'Start kampanii płatnej', date: addDaysStr(thu, 1) },
    { id: uid(), projectId: projAudit.id, name: 'Prezentacja wniosków', date: addDaysStr(fri, -5) },
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

  // --- Task 5: client-facing brand workshop with a present-week deadline ---
  const t5: Task = {
    id: uid(),
    projectId: projBrand.id,
    statusId: wip.id,
    title: 'Key visual i makieta katalogu',
    description: 'Dopracowanie kluczowego motywu kampanii oraz pierwszych 12 stron katalogu kolekcji jesiennej.',
    startDate: mon,
    endDate: addDaysStr(fri, 10),
    estimatedHours: 26,
    priority: 'high',
    workCategoryId: catKreacja.id,
    checklist: [
      { id: uid(), text: 'Kierunek wizualny potwierdzony', done: true },
      { id: uid(), text: 'Makiety kategorii', done: false },
      { id: uid(), text: 'Komentarze klienta', done: false },
    ],
    createdAt: now,
    updatedAt: now,
  };
  tasks.push(t5);
  addAssign(t5.id, ola.id);
  addAssign(t5.id, kasia.id);
  addWork(t5.id, ola.id, tue, 2);
  addWork(t5.id, ola.id, wed, 2);
  addWork(t5.id, kasia.id, tue, 3);
  addWork(t5.id, kasia.id, thu, 2);
  addBinWork(t5.id, ola.id, 2);

  // --- Task 6: a future platform feature makes Timeline and workload useful ---
  const t6: Task = {
    id: uid(),
    projectId: projPlatform.id,
    statusId: todo.id,
    title: 'Strefa partnera — zakres MVP',
    description: 'Rozpisanie ekranów, uprawnień i kryteriów odbioru dla pierwszej wersji panelu partnerów instalacyjnych.',
    startDate: addDaysStr(mon, 7),
    endDate: addDaysStr(fri, 14),
    estimatedHours: 30,
    priority: 'high',
    workCategoryId: catWdrozenie.id,
    checklist: [
      { id: uid(), text: 'Mapa ekranów', done: false },
      { id: uid(), text: 'Kryteria odbioru', done: false },
    ],
    createdAt: now,
    updatedAt: now,
  };
  tasks.push(t6);
  addAssign(t6.id, marek.id);
  addAssign(t6.id, kasia.id);
  addWork(t6.id, marek.id, addDaysStr(mon, 7), 5);
  addWork(t6.id, marek.id, addDaysStr(tue, 7), 5);
  addWork(t6.id, kasia.id, addDaysStr(mon, 7), 3);
  addWork(t6.id, kasia.id, addDaysStr(wed, 7), 3);

  // --- Task 7: launch assets — deadline within the demo horizon ---
  const t7: Task = {
    id: uid(),
    projectId: projLaunch.id,
    statusId: accept.id,
    title: 'Pakiet kreacji do premiery',
    description: 'Formaty do Meta i Google, mailing premierowy oraz zestaw materiałów dla influencerów.',
    startDate: addDaysStr(mon, -2),
    endDate: addDaysStr(fri, 7),
    estimatedHours: 22,
    priority: 'urgent',
    workCategoryId: catKreacja.id,
    checklist: [
      { id: uid(), text: 'Formaty reklamowe', done: true },
      { id: uid(), text: 'Mailing', done: true },
      { id: uid(), text: 'Pakiet influencer', done: false },
    ],
    createdAt: now,
    updatedAt: now,
  };
  tasks.push(t7);
  addAssign(t7.id, ola.id);
  addAssign(t7.id, kasia.id);
  addWork(t7.id, ola.id, mon, 2);
  addWork(t7.id, kasia.id, wed, 3);
  addWork(t7.id, kasia.id, fri, 2);

  // --- Task 8: an intentionally unscheduled discovery item for the bin tour ---
  const t8: Task = {
    id: uid(),
    projectId: projPlatform.id,
    statusId: todo.id,
    title: 'Wywiady z partnerami instalacyjnymi',
    description: 'Przygotowanie scenariusza rozmów i synteza najważniejszych potrzeb partnerów przed startem MVP.',
    startDate: addDaysStr(mon, 7),
    endDate: addDaysStr(fri, 21),
    estimatedHours: 12,
    priority: 'normal',
    workCategoryId: catTesty.id,
    checklist: [],
    createdAt: now,
    updatedAt: now,
  };
  tasks.push(t8);
  addAssign(t8.id, marek.id);
  addAssign(t8.id, kasia.id);
  addBinWork(t8.id, marek.id, 2.5);
  addBinWork(t8.id, kasia.id, 2);

  // --- Task 9: completed historical work completes the project/kanban story ---
  const t9: Task = {
    id: uid(),
    projectId: projAudit.id,
    statusId: done.id,
    title: 'Raport CRO i backlog eksperymentów',
    description: 'Raport z audytu, priorytety hipotez oraz plan testów A/B na kolejny kwartał.',
    startDate: addDaysStr(mon, -20),
    endDate: addDaysStr(fri, -5),
    estimatedHours: 18,
    priority: 'normal',
    workCategoryId: catTesty.id,
    checklist: [
      { id: uid(), text: 'Raport wysłany', done: true },
      { id: uid(), text: 'Prezentacja dla klienta', done: true },
    ],
    createdAt: now,
    updatedAt: now,
  };
  tasks.push(t9);
  addAssign(t9.id, ola.id);
  addAssign(t9.id, kasia.id);
  addWork(t9.id, ola.id, addDaysStr(mon, -14), 4);
  addWork(t9.id, kasia.id, addDaysStr(tue, -14), 3);

  // --- Task 10: a small client follow-up keeps the current project list dense ---
  const t10: Task = {
    id: uid(),
    projectId: projCampaign.id,
    statusId: todo.id,
    title: 'Plan publikacji i raportowania',
    description: 'Kalendarz treści, odpowiedzialności, budżet testowy oraz układ cotygodniowego raportu dla Nordic Fitness.',
    startDate: addDaysStr(mon, 1),
    endDate: addDaysStr(fri, 14),
    estimatedHours: 14,
    priority: 'normal',
    workCategoryId: catKreacja.id,
    checklist: [
      { id: uid(), text: 'Tematy tygodniowe', done: false },
      { id: uid(), text: 'Szablon raportu', done: false },
    ],
    createdAt: now,
    updatedAt: now,
  };
  tasks.push(t10);
  addAssign(t10.id, kasia.id);
  addWork(t10.id, kasia.id, thu, 2);
  addWork(t10.id, kasia.id, addDaysStr(mon, 7), 2);

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
      entityType: 'project' as const,
      entityId: projBrand.id,
      authorId: kasia.id,
      body: `@${ola.firstName} po warsztacie dopisz proszę trzy warianty okładki katalogu do środy.`,
      mentionIds: [ola.id],
      createdAt: now,
    },
    {
      id: uid(),
      entityType: 'task' as const,
      entityId: t6.id,
      authorId: kasia.id,
      body: `@${marek.firstName} klient potwierdził, że pierwszy priorytet to generator leadów i materiały do pobrania.`,
      mentionIds: [marek.id],
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
