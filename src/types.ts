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

export interface Person {
  id: string;
  firstName: string; // required
  lastName: string; // '' when unset
  name: string; // display name, kept in sync with firstName + lastName
  email: string; // '' when unset
  role: string; // job title; '' when unset
  departmentId: string; // '' when unset
  avatar: string; // emoji; '' -> initials fallback
  capacity: number; // available hours per day (overload threshold)
  isAdmin: boolean;
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
  date: DateStr;
  plannedHours: number;
  sortIndex: number; // order of this block within the person's day
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
  sampleBannerDismissed: boolean;
  savedFilters: SavedFilter[]; // named filter presets for Projects/Tasks pages
}
