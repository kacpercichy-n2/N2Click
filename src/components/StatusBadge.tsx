import type { Status } from '../types';

/** Small colored pipeline-status pill. */
export function StatusBadge({ status }: { status: Status | undefined }) {
  if (!status) return null;
  return (
    <span
      className="status-badge"
      style={{ borderColor: status.color, color: status.color, background: `${status.color}1a` }}
    >
      {status.name}
      {status.archived ? ' (archived)' : ''}
    </span>
  );
}
