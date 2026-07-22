// Lekki modal „szybkiego dodania” wpisu słownika (spółka / dział / stanowisko)
// wprost z selecta formularza — opcja „+ Nowe…” na końcu listy otwiera ten
// dialog zamiast zmieniać wartość. Zapis idzie normalną akcją reduktora u
// wołającego (ADD_COMPANY / ADD_DEPARTMENT / ADD_JOB_TITLE), więc reguły
// unikalności i mirror do chmury pozostają w jednym miejscu; `validate` pozwala
// wołającemu pokazać duplikat PRZED dispatchem (reduktor odrzuca po cichu).
import { useState } from 'react';
import { ModalFrame } from './ModalFrame';

/** Wartość-strażnik opcji „+ Nowe…” w selektach słownikowych. */
export const NEW_OPTION_VALUE = '__nowy-wpis__';

export function QuickAddModal({
  title,
  label,
  placeholder,
  validate,
  onSubmit,
  onClose,
}: {
  title: string; // np. „Nowa spółka”
  label: string; // etykieta pola, np. „Nazwa spółki *”
  placeholder?: string;
  /** Polski komunikat błędu albo null, gdy nazwa jest OK (np. duplikat). */
  validate?: (name: string) => string | null;
  /** Wołane z przyciętą, zwalidowaną nazwą; wołający dispatchuje i wybiera wpis. */
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Nazwa jest wymagana');
      return;
    }
    const err = validate?.(trimmed) ?? null;
    if (err) {
      setError(err);
      return;
    }
    onSubmit(trimmed);
    onClose();
  };

  return (
    <ModalFrame
      ariaLabel={title}
      cardClassName="quick-add-card"
      onRequestClose={onClose}
    >
      <div className="task-modal-head">
        <h1 className="task-modal-title">{title}</h1>
        <div className="task-modal-head-actions">
          <button
            type="button"
            className="task-modal-close"
            onClick={onClose}
            aria-label="Zamknij"
          >
            ×
          </button>
        </div>
      </div>
      <form className="task-modal-body" onSubmit={submit}>
        <div className="field">
          <label htmlFor="quick-add-name">{label}</label>
          <input
            id="quick-add-name"
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError('');
            }}
            placeholder={placeholder}
          />
          {error && <p className="field-error">{error}</p>}
        </div>
        <div className="field-row">
          <button type="submit" className="btn primary">
            Dodaj
          </button>
          <button type="button" className="btn ghost" onClick={onClose}>
            Anuluj
          </button>
        </div>
      </form>
    </ModalFrame>
  );
}
