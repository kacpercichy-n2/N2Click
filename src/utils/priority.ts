// Runtime constants for the fixed Task priority enum. The `TaskPriority` type
// itself lives in types.ts (it is a stored shape); this dependency-free module
// (except the type import) owns the display order and Polish labels.
import type { TaskPriority } from '../types';

/** Priority values in ascending order — the select/filter display order. */
export const TASK_PRIORITIES: readonly TaskPriority[] = ['low', 'normal', 'high', 'urgent'];

/** Polish display labels for each priority. */
export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'Niski',
  normal: 'Normalny',
  high: 'Wysoki',
  urgent: 'Pilny',
};
