import type { PlanningStatus } from '../store/selectors';

const TONE: Record<PlanningStatus, string> = {
  'nie rozplanowano': 'planning-none',
  'częściowo': 'planning-partial',
  rozplanowano: 'planning-full',
  przekroczono: 'planning-over',
};

/** Compact derived task planning-status pill (styled like `.status-badge`). */
export function PlanningBadge({ status }: { status: PlanningStatus }) {
  return <span className={`planning-badge ${TONE[status]}`}>{status}</span>;
}
