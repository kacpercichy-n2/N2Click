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
}

export interface Department {
  id: string;
  name: string;
}

export interface ServiceType {
  id: string;
  name: string;
}

/** Pipeline status, shared by projects and tasks. Admin-managed. */
export interface Status {
  id: string;
  name: string;
  slug: string; // kebab-case, derived from name
  color: string; // hex
  order: number; // position in the pipeline, 0-based
  archived: boolean; // archived statuses are hidden from pickers/kanban
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

export interface Comment {
  id: string;
  entityType: CommentEntityType;
  entityId: string;
  authorId: string; // '' when no acting user was selected
  body: string;
  mentionIds: string[]; // person ids @mentioned in the body
  createdAt: string; // ISO timestamp
}

export interface ActivityEvent {
  id: string;
  entityType: CommentEntityType;
  entityId: string;
  actorId: string; // '' when no acting user was selected
  message: string;
  createdAt: string; // ISO timestamp
}

export type FilterPage = 'projects' | 'tasks';

export interface SavedFilterCriteria {
  paid: 'all' | 'paid' | 'unpaid'; // meaningful on projects; keep 'all' for tasks
  clientId: string; // '' = all
  statusId: string; // '' = all
  personId: string; // '' = all; assignee — meaningful on tasks
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
  statuses: Status[];
  projects: Project[];
  milestones: Milestone[];
  tasks: Task[];
  people: Person[];
  assignments: TaskAssignment[];
  workload: WorkloadEntry[];
  comments: Comment[];
  activity: ActivityEvent[];
  currentUserId: string; // "acting as" person; '' when unset
  // Safe impersonation: '' when not impersonating; otherwise the REAL logged-in
  // person's id while `currentUserId` holds the impersonated identity. Additive
  // (no version bump) — defaulted + sanitized on every load in storage.ts.
  impersonatorId: string;
  sampleBannerDismissed: boolean;
  savedFilters: SavedFilter[]; // named filter presets for Projects/Tasks pages
}
