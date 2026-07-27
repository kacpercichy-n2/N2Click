// Presentational save-status badge. Renders nothing when clean.
import type { SaveState } from '../utils/useSaveStatus';
import { AlertTriangle, Check } from './icons';

/** IA-12 — gdy zapis jest zablokowany, odznaka przestaje być samą etykietą:
 *  klik przenosi do pola, które go blokuje. Prop jest opcjonalny, więc
 *  pozostałe formularze używają odznaki bez zmian. */
export interface SaveBlockedInfo {
  message: string;
  onJump: () => void;
}

export function SaveStatus({
  status,
  blocked,
}: {
  status: SaveState;
  blocked?: SaveBlockedInfo;
}) {
  // Tylko stan „są niezapisane zmiany, których NIE da się zapisać”. Czysty
  // formularz nic nie ryzykuje (świeże zadanie bez tytułu nie krzyczy), a
  // 'error' (nieudany zapis do pamięci) i przejściowe „Zapisywanie…/Zapisano”
  // są ważniejsze niż walidacja i zostają bez zmian.
  if (status === 'dirty' && blocked) {
    return (
      <button
        type="button"
        className="save-status save-status--blocked"
        onClick={blocked.onJump}
        title={`${blocked.message} Kliknij, aby przejść do przyczyny.`}
      >
        <AlertTriangle size={14} aria-hidden />
        Nie można zapisać — pokaż przyczynę
      </button>
    );
  }
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
  if (status === 'error') {
    return (
      <span className="save-status save-status--error" role="status">
        <AlertTriangle size={14} aria-hidden />
        Nie zapisano
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
