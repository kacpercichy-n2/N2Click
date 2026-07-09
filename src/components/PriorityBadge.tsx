import type { TaskPriority } from '../types';
import { PRIORITY_LABELS } from '../utils/priority';

/** Compact task-priority pill (styled like `.status-badge`/`.planning-badge`).
 * Renders all four values — the call site decides whether to show it. */
export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  return (
    <span className={`priority-badge priority-${priority}`}>{PRIORITY_LABELS[priority]}</span>
  );
}
