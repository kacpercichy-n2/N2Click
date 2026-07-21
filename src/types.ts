// All dates are calendar-date strings 'yyyy-MM-dd' (never Date serialized with time).
// All ids are crypto.randomUUID().
// Core model: Client -> Project -> Tasks -> Time blocks (WorkloadEntry).
// Supporting models: Status, Department, ServiceType, Person, Comment,
// TaskAssignment, Milestone, ActivityEvent.

export type DateStr = string; // 'yyyy-MM-dd'

export interface Client {
  id: string;
  name: string; // required
  archived: boolean;
  /** Dane kontaktowe (zakładka „Klienci”); brak pola / '' = brak danych. */
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  notes?: string;
}

export interface Department {
  id: string;
  name: string;
}

export interface ServiceType {
  id: string;
  name: string;
}

/** Admin-managed work-category dictionary (mirrors ServiceType). */
export interface WorkCategory {
  id: string;
  name: string;
}

/** Task priority — fixed 4-value enum. Polish labels live in utils/priority.ts. */
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

/** One embedded checklist item on a Task. */
export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

/** Pipeline status, shared by projects and tasks. Admin-managed. */
export interface Status {
  id: string;
  name: string;
  slug: string; // kebab-case, derived from name
  color: string; // hex
  order: number; // position in the pipeline, 0-based
  archived: boolean; // archived statuses are hidden from pickers/kanban
  // Stable completion semantics: whether entities in this status count as
  // "done". Independent of pipeline `order` and `archived` (archived done
  // statuses still count as done) — reordering/archiving never rewrites which
  // work is complete. Multiple statuses may be done. See doneStatusIds.
  isDone: boolean;
}

/** Rodzaj dokumentu handlowego projektu — stały zbiór wartości. Wartości są
 *  polskimi slugami (persystencja + jsonb chmury), etykiety UI żyją w
 *  `src/utils/projectDocuments.ts`. */
export type ProjectDocumentKind = 'oferta' | 'wycena' | 'brief' | 'link';

/**
 * Jeden ODNOŚNIK do dokumentu handlowego projektu (oferta, wycena, brief lub
 * zwykły link). To WYŁĄCZNIE adres — pliki nie są przechowywane w aplikacji.
 */
export interface ProjectDocument {
  id: string;
  kind: ProjectDocumentKind;
  label: string; // nazwa wyświetlana; '' => pokazujemy sam adres
  url: string; // wymagany (niepusty po trim)
}

export interface Project {
  id: string;
  clientId: string;
  name: string; // required
  description: string;
  statusId: string;
  paid: boolean; // gold coin (paid) vs bronze coin (unpaid)
  startDate: DateStr;
  endDate: DateStr;
  departmentId: string; // '' when unset
  serviceTypeId: string; // '' when unset
  // Odnośniki do dokumentów handlowych; osadzone, wymieniane w całości przy
  // zapisie (jak `Task.checklist`). Legacy payload bez pola dostaje [] w
  // repairze wczytania (storage.repairProjectDocuments).
  documents: ProjectDocument[];
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}

export interface Milestone {
  id: string;
  projectId: string;
  name: string;
  date: DateStr;
}

export interface Task {
  id: string;
  projectId: string; // required — every task belongs to a project
  statusId: string;
  title: string; // required
  description: string;
  startDate: DateStr;
  endDate: DateStr;
  estimatedHours: number | null; // optional up-front estimate
  priority: TaskPriority; // fixed enum; defaults to 'normal'
  workCategoryId: string; // reference into workCategories; '' when unset
  // Dział wykonujący zadanie ('' = brak). Działy PROJEKTU są POCHODNE: unikalny
  // zbiór działów jego zadań (patrz selectors.departmentIdsOfProject) — projekt
  // może więc obejmować kilka działów naraz. `Project.departmentId` pozostaje
  // wyłącznie jako zaszłość (fallback, gdy żadne zadanie nie ma działu).
  departmentId: string;
  checklist: ChecklistItem[]; // embedded, replaced wholesale on save
  // Ręczna, per-PROJEKT ranga wyświetlania na liście zadań w szczegółach
  // projektu (0-based). NIE mylić z `WorkloadEntry.sortIndex`, które porządkuje
  // bloki w obrębie doby/zasobnika danej osoby (patrz niżej). `orderIndex`
  // dotyczy wyłącznie kolejności zadań w projekcie; ukończenie/kalendarz/godziny
  // są od niej niezależne. Legacy repair nadaje deterministyczny domyślny ciąg
  // 0..n-1 per projekt w kolejności (startDate, createdAt, id).
  orderIndex: number;
  // Szkic: zadanie utworzone WEWNĄTRZ projektu, jeszcze NIEopublikowane. Szkic
  // jest widoczny wyłącznie w widoku projektu (oznaczony „szkic”) i celowo
  // wykluczony z widoków planowania (Moja praca, pulpit, kanban, lista zadań) —
  // NIGDY nie tworzy wierszy `WorkloadEntry` (zasobnik/kalendarz), więc godziny
  // planera dla szkicu nie istnieją (inwariant 1). Publikacja („Zapisz i
  // opublikuj” na projekcie) przełącza flagę na `false` jedną atomową akcją
  // reduktora (inwariant 6). Pole OPCJONALNE i ADDYTYWNE: brak / `false` =
  // opublikowane, więc legacy (localStorage), chmura bez kolumny i wszystkie
  // dotychczasowe fixture'y czytają się jako opublikowane bez migracji danych.
  isDraft?: boolean;
  // Godziny sprzedane per osoba wpisane na etapie SZKICU (intencja sprzed
  // publikacji, NIE planowane godziny — inwariant 1). Materializują się w jeden
  // wiersz zasobnika `WorkloadEntry` na osobę przy publikacji, po czym pole jest
  // USUWANE (jedno źródło prawdy w workload). Żaden selektor / suma / kalendarz /
  // zasobnik / przeciążenie NIGDY go nie czyta. FORMA KANONICZNA (nośna dla
  // reference-preserving merge `sameRowValue`): klucz JEST obecny WYŁĄCZNIE gdy
  // zadanie jest szkicem i tablica ma ≥1 wpis z `hours > 0` na siatce 0,25h i
  // unikalnym `personId` — inaczej klucz jest NIEOBECNY (nigdy `[]`, nigdy na
  // zadaniu opublikowanym). Egzekwowane w reduktorze, `normalizeTaskMeta` i
  // hydracji chmury. OPCJONALNE i ADDYTYWNE (`DATA_VERSION` zostaje na 7).
  draftHours?: { personId: string; hours: number }[];
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}

/** Access role — the app-permission tier (distinct from `role`, the job title). */
export type AccessRole = 'administrator' | 'pm' | 'handlowiec' | 'pracownik';

export interface Person {
  id: string;
  firstName: string; // required
  lastName: string; // '' when unset
  name: string; // display name, kept in sync with firstName + lastName
  email: string; // '' when unset
  phone: string; // '' when unset
  role: string; // job title; '' when unset
  departmentId: string; // '' when unset
  avatar: string; // emoji; '' -> initials fallback
  capacity: number; // available hours per day (overload threshold + availability quantum)
  // App-permission tier (replaced the old `isAdmin` flag in migration v4→v5).
  accessRole: AccessRole;
  // SHA-256 hex of the person's login password. '' = no password set: that person
  // logs in without a password (the no-lockout rule, mirroring the zero-people
  // admin gate). Cosmetic client-side gating only — see src/utils/password.ts.
  passwordHash: string;
  // Availability: ISO weekdays worked, 1 (Mon) … 7 (Sun); default [1,2,3,4,5].
  // Deduped, 1–7 only, sorted ascending; empty array is allowed (= no workdays).
  workDays: number[];
  // Informational work hours (minutes from midnight): profile display / future
  // hints only. `capacity` stays THE overload threshold and availability quantum —
  // there is intentionally NO validation coupling between work hours and capacity.
  workStartMinutes: number; // default 480 (8:00)
  workEndMinutes: number; // default min(1440, 480 + capacity*60)
  // Supervisor (przełożony); '' when none. Must never form a cycle — the reducer
  // drops a cycle-forming value (see wouldCreateSupervisorCycle in selectors.ts).
  supervisorId: string;
  // Data urodzenia (yyyy-MM-dd); '' when unset. Presentational only — surfaces a
  // birthday marker in the calendar on the matching month+day. Never a required
  // field. Validated as a real 'yyyy-MM-dd' date on load (garbage → '').
  birthDate: DateStr;
}

export interface TaskAssignment {
  id: string;
  taskId: string;
  personId: string;
}

export interface WorkloadEntry {
  id: string;
  taskId: string;
  personId: string;
  // Calendar day of the block, OR the empty string '' (BIN_DATE) sentinel for an
  // "unassigned / bin" (zasobnik) block that has no calendar day yet.
  date: DateStr;
  plannedHours: number;
  // Time-of-day the block starts, in minutes from local midnight. Invariant:
  // multiple of 15, 0 <= startMinutes and startMinutes + plannedHours*60 <= 1440.
  // Bin entries (date === '') always have startMinutes: 0.
  startMinutes: number;
  // Order within the person's day == rank by startMinutes. For bin entries
  // (date === '') it orders the person's bin (contiguous per (personId, '')).
  sortIndex: number;
  // Two invariants added by the hour-budget work (PKG-20260708-budget-store):
  // 1. At most ONE bin entry per (taskId, personId). All bin-writing paths merge
  //    into the existing row, and ensureStartMinutes merges stray duplicates on
  //    load. (Selectors: binEntryForTaskPerson / binHoursForTaskPerson.)
  // 2. No two same-task same-person DATED blocks that are exactly adjacent
  //    (one's end == the other's start, no gap) survive a SET_BLOCK_TIME — the
  //    calendar drag/resize path fuses them into one block (earlier id survives).

}

export type CommentEntityType = 'project' | 'task';

// Entity buckets for the LOCAL activity log. Comments stay project/task-only.
export type ActivityEntityType =
  | CommentEntityType
  | 'person' // entityId = person id
  | 'status' // entityId = status id
  | 'client' // entityId = client id
  | 'system'; // session events (login/logout/impersonation), entityId = ''

export interface Comment {
  id: string;
  entityType: CommentEntityType;
  entityId: string;
  authorId: string; // '' when no acting user was selected
  body: string;
  mentionIds: string[]; // person ids @mentioned in the body
  createdAt: string; // ISO timestamp
}

// Local, user-editable activity log for attribution/UX. localStorage is
// client-mutable, so this is NOT a security audit trail.
export interface ActivityEvent {
  id: string;
  entityType: ActivityEntityType;
  entityId: string;
  actorId: string; // acting identity ('' when no acting user); the IMPERSONATED person while impersonating
  // Real logged-in administrator when the row was written under impersonation;
  // '' when not impersonating. Optional: rows persisted before this field exist
  // without it and load fine (additive, no version bump).
  impersonatorId?: string;
  message: string;
  createdAt: string; // ISO timestamp
}

/** Zgłoszenie zespołu: rodzaj / priorytet / status — stałe zbiory wartości.
 *  Wartości są polskimi slugami (persystencja + kolumny chmury), etykiety UI
 *  żyją w `src/utils/tickets.ts`. */
export type TicketKind = 'blad' | 'usprawnienie' | 'nowa-funkcja' | 'inne';
export type TicketPriority = 'niski' | 'sredni' | 'wysoki';
export type TicketStatus = 'nowe' | 'w-trakcie' | 'zrobione' | 'odrzucone';

/**
 * Zgłoszenie od zespołu (błąd / usprawnienie / nowa funkcja). Zakładka
 * „Zgłoszenia”: składa każdy, pełen wgląd i triage ma administrator
 * (`tickets.manage`). Kolekcja jest ADDYTYWNA — nie dotyka żadnej istniejącej
 * encji planera.
 */
export interface Ticket {
  id: string;
  title: string; // „Nazwa zgłoszenia” — wymagane
  area: string; // „Funkcja / czego dotyczy”; '' gdy nie podano
  description: string; // „Opis” — wymagane
  kind: TicketKind;
  priority: TicketPriority;
  status: TicketStatus; // nowe zgłoszenie zawsze startuje jako 'nowe'
  reporterId: string; // id osoby zgłaszającej (musi istnieć w `people`)
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp; odświeżany przy każdym zapisie
}

export type FilterPage = 'projects' | 'tasks';

export interface SavedFilterCriteria {
  paid: 'all' | 'paid' | 'unpaid'; // meaningful on projects; keep 'all' for tasks
  clientId: string; // '' = all
  statusId: string; // '' = all
  personId: string; // '' = all; assignee — meaningful on tasks
  priority: '' | TaskPriority; // '' = all; meaningful on tasks
  workCategoryId: string; // '' = all; meaningful on tasks
  from: DateStr | ''; // period overlap lower bound
  to: DateStr | ''; // period overlap upper bound
}

export interface SavedFilter {
  id: string;
  name: string;
  page: FilterPage;
  criteria: SavedFilterCriteria;
}

export interface AppData {
  version: number;
  clients: Client[];
  departments: Department[];
  serviceTypes: ServiceType[];
  workCategories: WorkCategory[];
  statuses: Status[];
  projects: Project[];
  milestones: Milestone[];
  tasks: Task[];
  people: Person[];
  assignments: TaskAssignment[];
  workload: WorkloadEntry[];
  comments: Comment[];
  activity: ActivityEvent[];
  tickets: Ticket[];
  currentUserId: string; // "acting as" person; '' when unset
  // Safe impersonation: '' when not impersonating; otherwise the REAL logged-in
  // person's id while `currentUserId` holds the impersonated identity. Additive
  // (no version bump) — defaulted + sanitized on every load in storage.ts.
  impersonatorId: string;
  sampleBannerDismissed: boolean;
  savedFilters: SavedFilter[]; // named filter presets for Projects/Tasks pages
}
