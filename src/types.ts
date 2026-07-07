// All dates are calendar-date strings 'yyyy-MM-dd' (never Date serialized with time).
// All ids are crypto.randomUUID().

export type DateStr = string; // 'yyyy-MM-dd'

export interface Task {
  id: string;
  title: string; // required
  description: string;
  project: string; // optional category; '' when unset
  startDate: DateStr;
  endDate: DateStr;
  estimatedHours: number | null; // optional up-front estimate
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}

export interface Person {
  id: string;
  name: string; // required
  email: string; // '' when unset
  role: string; // '' when unset
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
}

export interface AppData {
  version: number;
  tasks: Task[];
  people: Person[];
  assignments: TaskAssignment[];
  workload: WorkloadEntry[];
  sampleBannerDismissed: boolean;
}
