// Wskaźnik zapisu powierzchni z auto-zapisem. TRZY stany widoczne dla oka
// („Niezapisane zmiany” → „Zapisywanie…” → „Zapisano HH:mm”) i jeden trwały stan
// błędu („Nie zapisano”). Po PIERWSZYM udanym zapisie wskaźnik już nie znika —
// czysty formularz pokazuje wtedy godzinę ostatniego zapisu.
//
// Sam element NIE jest regionem live: ogłoszenia idą wspólnym kanałem
// (`src/utils/liveRegion.ts`) do dwóch trwałych węzłów w powłoce App. Bez
// `announceId` komponent jest czysto wizualny i nie ogłasza nic.
import { useEffect } from 'react';
import type { SaveState } from '../utils/useSaveStatus';
import { announce } from '../utils/liveRegion';
import { AlertTriangle, Check } from './icons';
import { Tooltip } from './Tooltip';

/** IA-12 — gdy zapis jest zablokowany, odznaka przestaje być samą etykietą:
 *  klik przenosi do pola, które go blokuje. Prop jest opcjonalny, więc
 *  pozostałe formularze używają odznaki bez zmian. */
export interface SaveBlockedInfo {
  message: string;
  onJump: () => void;
}

const DIRTY_TEXT = 'Niezapisane zmiany';
const SAVING_TEXT = 'Zapisywanie…';
const ERROR_TEXT = 'Nie zapisano';
const ERROR_ANNOUNCEMENT = 'Nie zapisano — zmiany nie zostały utrwalone.';

/** Etykieta stanu „zapisane”: z godziną, gdy znamy moment zapisu. */
function savedText(savedAtLabel: string | null): string {
  return savedAtLabel === null ? 'Zapisano' : `Zapisano ${savedAtLabel}`;
}

export function SaveStatus({
  status,
  savedAtLabel = null,
  announceId,
  blocked,
}: {
  status: SaveState;
  savedAtLabel?: string | null;
  /** Stabilny identyfikator ŹRÓDŁA ogłoszeń (np. `save:task-modal`). */
  announceId?: string;
  blocked?: SaveBlockedInfo;
}) {
  // Ogłoszenie idzie wspólnym kanałem: ten sam `id` z nowym tekstem podmienia
  // komunikat, a powtórka tego samego tekstu (auto-zapis w tej samej minucie)
  // jest zdeduplikowana w kanale.
  useEffect(() => {
    if (announceId === undefined) return;
    // Nieudany zapis ma własny, PILNY komunikat i nigdy nie mówi „Zapisano”.
    if (status === 'error') {
      announce({ id: announceId, text: ERROR_ANNOUNCEMENT, tone: 'assertive' });
      return;
    }
    if (status === 'dirty') {
      announce({ id: announceId, text: DIRTY_TEXT, tone: 'polite' });
      return;
    }
    if (status === 'saving') {
      announce({ id: announceId, text: SAVING_TEXT, tone: 'polite' });
      return;
    }
    if (status === 'saved') {
      announce({ id: announceId, text: savedText(savedAtLabel), tone: 'polite' });
    }
  }, [status, savedAtLabel, announceId]);

  // Tylko stan „są niezapisane zmiany, których NIE da się zapisać”. Czysty
  // formularz nic nie ryzykuje (świeże zadanie bez tytułu nie krzyczy), a
  // 'error' (nieudany zapis do pamięci) i przejściowe „Zapisywanie…/Zapisano”
  // są ważniejsze niż walidacja i zostają bez zmian.
  if (status === 'dirty' && blocked) {
    return (
      <Tooltip text={`${blocked.message} Kliknij, aby przejść do przyczyny.`}>
        <button
          type="button"
          className="save-status save-status--blocked"
          onClick={blocked.onJump}
        >
          <AlertTriangle size={14} aria-hidden />
          Nie można zapisać — pokaż przyczynę
        </button>
      </Tooltip>
    );
  }
  if (status === 'error') {
    return (
      <span className="save-status save-status--error">
        <AlertTriangle size={14} aria-hidden />
        {ERROR_TEXT}
      </span>
    );
  }
  if (status === 'dirty') {
    return (
      <span className="save-status save-status--dirty">
        <AlertTriangle size={14} aria-hidden />
        {DIRTY_TEXT}
      </span>
    );
  }
  if (status === 'saving') {
    return <span className="save-status save-status--saving">{SAVING_TEXT}</span>;
  }
  // 'clean' bez ani jednego zapisu w tej sesji formularza: nic nie pokazujemy.
  if (status === 'clean' && savedAtLabel === null) return null;
  return (
    <span className="save-status save-status--saved">
      <Check size={14} aria-hidden />
      {savedText(savedAtLabel)}
    </span>
  );
}
