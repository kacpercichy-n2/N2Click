// Sample data generator. Dates are computed relative to TODAY so the seed always
// lands in the current week/month. Includes: a multi-person task, a task with
// zero-hour gap days inside its period, and a day where one person totals >8h so
// the overload indicator is demonstrable.
import type {
  AppData,
  Person,
  Task,
  TaskAssignment,
  WorkloadEntry,
} from '../types';
import { DATA_VERSION } from './storage';
import { todayStr, weekDays } from '../utils/dates';

function uid(): string {
  return crypto.randomUUID();
}

export function buildSampleData(): AppData {
  const now = new Date().toISOString();
  const today = todayStr();

  // Anchor allocations to this week (Mon..Sun) so the demo is legible in the
  // Week view without navigating. weekDays returns 'yyyy-MM-dd' Mon..Sun.
  const [mon, tue, wed, thu, fri] = weekDays(today);

  // People
  const ola: Person = { id: uid(), name: 'Ola', email: 'ola@n2.example', role: 'Designer' };
  const marek: Person = { id: uid(), name: 'Marek', email: 'marek@n2.example', role: 'Developer' };
  const kasia: Person = { id: uid(), name: 'Kasia', email: 'kasia@n2.example', role: 'PM' };
  const people: Person[] = [ola, marek, kasia];

  const tasks: Task[] = [];
  const assignments: TaskAssignment[] = [];
  const workload: WorkloadEntry[] = [];

  const addAssign = (taskId: string, personId: string) =>
    assignments.push({ id: uid(), taskId, personId });
  const addWork = (
    taskId: string,
    personId: string,
    date: string,
    plannedHours: number,
  ) => {
    if (plannedHours > 0)
      workload.push({ id: uid(), taskId, personId, date, plannedHours });
  };

  // --- Task 1: multi-person website redesign (Mon–Fri this week) ---
  const t1: Task = {
    id: uid(),
    title: 'Website redesign',
    description: 'Refresh the marketing site: hero, pricing, and case studies.',
    project: 'Marketing',
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
    title: 'Q3 campaign planning',
    description:
      'Scope the summer campaign; mid-week reserved for stakeholder review.',
    project: 'Marketing',
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
    title: 'Release bugfix sprint',
    description: 'Critical fixes before the release cut.',
    project: 'Engineering',
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

  return {
    version: DATA_VERSION,
    tasks,
    people,
    assignments,
    workload,
    sampleBannerDismissed: true,
  };
}
