import type { Status } from '../types';
import { archivedAttr, archivedSuffix } from '../utils/archivedLabel';
import { tintVar } from '../utils/colors';

/** Small colored pipeline-status pill. */
export function StatusBadge({ status }: { status: Status | undefined }) {
  if (!status) return null;
  return (
    <span
      className="status-badge"
      // Kolor idzie do CSS JEDNĄ zmienną; obramowanie i tło (`color-mix`) liczy
      // arkusz, więc kolor z panelu administratora działa w każdej notacji CSS,
      // a nie tylko jako 6-znakowy hex (patrz `tintVar`).
      style={tintVar('--status', status.color)}
      data-archived={archivedAttr(status.archived)}
    >
      {status.name}
      {archivedSuffix(status.archived)}
    </span>
  );
}
