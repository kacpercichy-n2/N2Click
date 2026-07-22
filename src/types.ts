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

/** Admin-managed stanowiska (job titles) dictionary; mirrors Department. */
export interface JobTitle {
  id: string;
  name: string;
}

/** Admin-managed spółki (companies) dictionary; mirrors Department. */
export interface Company {
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
  // Spółka WYKONAWCZA projektu ('' = brak / projekt ogólnofirmowy) — jawne
  // przypisanie ze słownika `companies` (decyzja 2026-07-22). Steruje wyłącznie
  // DOMYŚLNYM filtrem widoków (osoba ze spółką X bazowo widzi projekty/taski
  // spółki X i może filtrem dołożyć inne) — nigdy twardą widocznością.
  // OPCJONALNE i ADDYTYWNE: legacy payload / chmura bez kolumny czytają '' na
  // repairze wczytania. DATA_VERSION zostaje 7.
  companyId?: string;
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
  // Reguła cykliczności (RRULE-lite) + per-datowe wyjątki. Wystąpienia są
  // WYŁĄCZNIE prezentacyjne — nigdy nie tworzą wierszy `WorkloadEntry` ani nie
  // zasilają sum/przeciążenia/kolizji (inwariant 1); mają własną granicę `until`
  // i nie przechodzą przez limit 92 dni okresu bazowego (inwariant 2). FORMA
  // KANONICZNA (patrz `TaskRecurrence` i `src/utils/recurrence.ts`): klucz
  // obecny WYŁĄCZNIE gdy istnieje poprawna reguła; NIGDY na szkicu
  // (`isDraft === true`) i NIGDY gdy `startDate` nie jest poprawną datą.
  // Egzekwowane w reduktorze, `normalizeTaskMeta` i hydracji chmury. OPCJONALNE
  // i ADDYTYWNE (`DATA_VERSION` zostaje na 7).
  recurrence?: TaskRecurrence;
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}

/**
 * Jeden per-datowy WYJĄTEK reguły cykliczności. `date` to ZAWSZE oryginalna data
 * wystąpienia ('yyyy-MM-dd'), unikalna w obrębie `overrides` — wyjątek nigdy nie
 * przenosi wystąpienia na inny dzień, tylko przesuwa jego godzinę albo pomija
 * ten dzień. FORMA KANONICZNA (egzekwowana w reduktorze, repairze wczytania i
 * hydracji chmury): albo `{ date, skip: true }` (bez pól czasu), albo
 * `{ date, startMinutes, durationMinutes }` (przesunięcie czasu, oba pola
 * obecne). Klucz `skip` występuje wyłącznie jako literalne `true`.
 */
export interface RecurrenceOverride {
  date: DateStr; // oryginalna data wystąpienia (yyyy-MM-dd)
  skip?: true; // pominięcie tego dnia; kanonicznie tylko literalne `true`
  startMinutes?: number; // przesunięcie czasu — OBA pola obecne razem
  durationMinutes?: number;
}

/**
 * Reguła cykliczności zadania (RRULE-lite): powtarzanie w wybrane dni tygodnia o
 * stałej porze, od kotwicy (`task.startDate`) do opcjonalnej włącznej granicy
 * `until`. Wystąpienia są WYŁĄCZNIE prezentacyjne — NIGDY nie materializują się
 * jako wiersze `WorkloadEntry` ani nie zasilają sum/przeciążenia/kolizji
 * (inwariant 1). FORMA KANONICZNA (patrz `src/utils/recurrence.ts`): klucz
 * `recurrence` istnieje TYLKO gdy reguła jest poprawna i zadanie jest
 * opublikowane z poprawną datą startu; `until` obecny tylko gdy poprawny i
 * `>= task.startDate`; `overrides` obecne tylko gdy niepuste, posortowane po
 * dacie rosnąco. OPCJONALNE i ADDYTYWNE (`DATA_VERSION` zostaje na 7).
 */
export interface TaskRecurrence {
  daysOfWeek: number[]; // ISO 1 (pon) … 7 (nd); zdeduplikowane, rosnąco, niepuste
  startMinutes: number; // 0..1425, wielokrotność 15
  durationMinutes: number; // 15..1440, wielokrotność 15; start + duration <= 1440
  until?: DateStr; // włączna granica; brak klucza = otwarta
  overrides?: RecurrenceOverride[]; // brak klucza gdy pusto; sort po dacie rosnąco
}

/**
 * Access role — the app-permission tier (distinct from `role`, the job title).
 * Two tiers since 2026-07-22: `pelne` (full — the old administrator matrix) and
 * `ograniczone` (limited — the old pracownik matrix). Legacy stored values
 * (`administrator|pm|handlowiec|pracownik`) map to `pelne` on load repair
 * (storage.migratePerson). Cloud `access_role` keeps its own 3-value enum;
 * mapping lives at the referenceData/cloudMirror boundary.
 */
export type AccessRole = 'pelne' | 'ograniczone';

export interface Person {
  id: string;
  firstName: string; // required
  lastName: string; // '' when unset
  name: string; // display name, kept in sync with firstName + lastName
  email: string; // '' when unset
  phone: string; // '' when unset
  role: string; // job title; '' when unset
  departmentId: string; // '' when unset
  // Spółka osoby ('' = brak). Od 2026-07-22 czysto informacyjna + źródło
  // DOMYŚLNEGO filtra spółek w widokach (osoba ze spółką X bazowo widzi
  // projekty/taski swojej spółki; filtrem może dołożyć inne). Dawne RLS-owe
  // zawężanie projektów po spółce jest martwe — wszyscy są chmurowymi
  // administratorami. OPCJONALNE i ADDYTYWNE: legacy payload / chmura bez
  // kolumny czytają '' na repairze (migratePerson). DATA_VERSION zostaje 7.
  companyId?: string;
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

  // Per-block completion (PKG-20260721-per-block-done). OPTIONAL + ADDITIVE:
  // undefined/false = not done, true = this specific block's portion of hours is
  // done. INDEPENDENT of Task.statusId — marking a block done never changes the
  // task status, and a done task status still lights ALL its blocks
  // (`blockIsDone`). Granularity is per WorkloadEntry.id, NOT per day: two blocks
  // on the same date carry independent `done`. DATA_VERSION stays 7 (additive,
  // like recurrence/isDraft); load repair passes it through untouched.
  done?: boolean;
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

/**
 * Wydarzenie / spotkanie kalendarza. Kolekcja jest ADDYTYWNA i CZYSTO
 * PREZENTACYJNA — wydarzenia NIGDY nie tworzą wierszy `WorkloadEntry` ani nie
 * zasilają sum/przeciążenia/kolizji/`packDayBlocks` (inwariant 1). Renderowane w
 * WeekView/MonthView innym kolorem niż zadania, zarządzane w panelu
 * „Wydarzenia”. Cykliczność REUŻYWA `TaskRecurrence` + `src/utils/recurrence.ts`
 * (żadnej drugiej implementacji).
 *
 * FORMA KANONICZNA `recurrence` (egzekwowana w reduktorze, `repairEvents` i
 * hydracji chmury): gdy klucz istnieje, `rule.startMinutes === startMinutes` i
 * `rule.durationMinutes === durationMinutes` (czas wydarzenia JEST czasem
 * reguły), a `daysOfWeek` ZAWSZE zawiera `isoWeekday(date)` (baza widoczna).
 * OPCJONALNE i ADDYTYWNE (`DATA_VERSION` zostaje 7).
 */
export interface CalendarEvent {
  id: string;
  title: string; // wymagane (trim niepusty)
  description: string; // '' gdy brak
  location: string; // biuro/lokalizacja; '' gdy brak
  meetingUrl: string; // '' albo znormalizowany http(s) URL
  date: DateStr; // kotwica; dla cyklicznych = anchor reguły
  startMinutes: number; // 0..1425, wielokrotność 15
  durationMinutes: number; // 15..1440, wielokrotność 15; start+dur <= 1440
  attendeeIds: string[]; // ids z people, zdeduplikowane; [] = ogólnofirmowe
  recurrence?: TaskRecurrence; // REUŻYTY typ; brak klucza = jednorazowe
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp; odświeżany przy każdym zapisie
}

export type FilterPage = 'projects' | 'tasks' | 'kanban';

export interface SavedFilterCriteria {
  paid: 'all' | 'paid' | 'unpaid'; // meaningful on projects; keep 'all' for tasks
  clientId: string; // '' = all
  projectId: string; // '' = all; meaningful on tasks/kanban — additive at v7
  statusId: string; // '' = all
  personId: string; // '' = all; assignee — meaningful on tasks
  priority: '' | TaskPriority; // '' = all; meaningful on tasks
  workCategoryId: string; // '' = all; meaningful on tasks
  // Spółka wykonawcza projektu ('' = wszystkie) — additive 2026-07-22. Dopasowuje
  // projekt spółki ORAZ projekt „neutralny” (bez spółki) — świeży/nieprzypisany
  // projekt nie znika nikomu. Wartością INICJALNĄ widoku (bez zapamiętanego
  // filtra) jest spółka zalogowanego — patrz defaultCriteriaForUser.
  companyId: string;
  from: DateStr | ''; // period overlap lower bound
  to: DateStr | ''; // period overlap upper bound
}

export interface SavedFilter {
  id: string;
  name: string;
  page: FilterPage;
  criteria: SavedFilterCriteria;
}

/** Widoki, których ostatnio używany filtr zapamiętujemy (lokalnie, NIE w chmurze).
 *  Filtry są per-użytkownik — jak `savedFilters` nie mają domu w chmurze. */
export type FilterViewKey =
  | 'projects'
  | 'tasks'
  | 'kanban'
  | 'workload'
  | 'calendar'
  | 'timeline';

/** Ostatnio używany (nienazwany) filtr dla jednego widoku. Trzymamy OBOK
 *  `savedFilters` w `AppData`, wyłącznie lokalnie — przetrwanie nawigacji i
 *  przeładowania. Sanityzowany i defaultowany na każdym wczytaniu (storage.ts)
 *  oraz przy zapisie przez reduktor (`SET_LAST_FILTER`). */
export interface LastViewFilter {
  criteria: SavedFilterCriteria; // single-select dims + from/to dates
  personIds: string[]; // PersonFilter multi-chips; [] = all
  departmentId: string; // workload-only dim; '' = all
  serviceTypeId: string; // workload-only dim; '' = all
  planning: string; // tasks-only planning filter; '' = all
}

export interface AppData {
  version: number;
  clients: Client[];
  departments: Department[];
  serviceTypes: ServiceType[];
  workCategories: WorkCategory[];
  jobTitles: JobTitle[];
  companies: Company[];
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
  events: CalendarEvent[];
  currentUserId: string; // "acting as" person; '' when unset
  // Safe impersonation: '' when not impersonating; otherwise the REAL logged-in
  // person's id while `currentUserId` holds the impersonated identity. Additive
  // (no version bump) — defaulted + sanitized on every load in storage.ts.
  impersonatorId: string;
  sampleBannerDismissed: boolean;
  savedFilters: SavedFilter[]; // named filter presets for Projects/Tasks/Kanban pages
  // Ostatnio używany filtr per widok (nienazwany). LOKALNIE ONLY — jak
  // `savedFilters` nie ma domu w chmurze (per-użytkownik). Addytywne przy v7:
  // defaultowane do `{}` i sanityzowane na każdym wczytaniu. Nieznane klucze
  // widoków są odrzucane na wczytaniu.
  lastFilters: Partial<Record<FilterViewKey, LastViewFilter>>;
}
