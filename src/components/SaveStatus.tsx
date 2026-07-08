// Presentational save-status badge. Renders nothing when clean.
import type { SaveState } from '../utils/useSaveStatus';
import { AlertTriangle, Check } from './icons';

export function SaveStatus({ status }: { status: SaveState }) {
  if (status === 'clean') return null;
  if (status === 'dirty') {
    return (
      <span className="save-status save-status--dirty" role="status">
        <AlertTriangle size={14} aria-hidden />
        Niezapisane zmiany
      </span>
    );
  }
  if (status === 'saving') {
    return (
      <span className="save-status save-status--saving" role="status">
        Zapisywanie…
      </span>
    );
  }
  return (
    <span className="save-status save-status--saved" role="status">
      <Check size={14} aria-hidden />
      Zapisano
    </span>
  );
}
