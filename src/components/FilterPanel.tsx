// Shared filter UI for the Projects, Tasks, Kanban and Workload pages.
// An e-commerce-style "Filtry" button with an active-count badge opens a
// popover of single-select option groups (radio) plus optional date inputs;
// applied filters render as removable chips with a clear-all in the footer.
//
// The component is a dumb, controlled presentation layer: every page keeps its
// own filter useState and builds the `groups`/`chips`/`dates` props from it.
// Choosing an option applies live (no "Zastosuj"). Zamykanie żyje we WSPÓLNEJ
// powłoce `useOverlay` (ta sama co menu kontekstowe WeekView): stos warstw dla
// Escape (zamyka tylko wierzchnią warstwę, więc modal pod spodem zostaje),
// para `pointerdown`+`click` na zewnątrz (ciągnięcie paska przewijania nie
// zamyka) i klasyfikacja zdarzeń przycisku „Filtry”, żeby jego własny toggle
// nie ścigał się z zamknięciem. Popover CELOWO nie idzie do portalu ani nie
// jest mierzony — kotwiczy go CSS, a na wąskim ekranie wchodzi w normalny
// przepływ (`position: static`), więc `menuKeyboard` też zostaje wyłączone
// (to dialog z radiami, nie lista `role="menu"`).
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Filter, X } from './icons';
import { useOverlay } from './useOverlay';

export interface FilterGroup {
  key: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
}

export interface FilterChip {
  key: string;
  label: string;
  onRemove: () => void;
}

export function FilterPanel({
  groups,
  dates,
  extra,
  activeCount,
  onClearAll,
  chips,
}: {
  groups: FilterGroup[];
  dates?: {
    from: string;
    to: string;
    onFrom: (v: string) => void;
    onTo: (v: string) => void;
  };
  /** Optional additional controls rendered inside the popover (e.g. a
   *  multi-select "Osoby" fieldset). Purely additive; other consumers omit it. */
  extra?: ReactNode;
  activeCount: number;
  onClearAll: () => void;
  chips: FilterChip[];
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => setOpen(false), []);

  useOverlay({ open, onClose: close, overlayRef: popRef, triggerRef: btnRef });

  return (
    <div className="filter-bar">
      <div className="filter-panel-wrap">
        <button
          type="button"
          ref={btnRef}
          className={activeCount > 0 ? 'btn soft filter-btn active' : 'btn soft filter-btn'}
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => setOpen((v) => !v)}
        >
          <Filter size={15} aria-hidden /> Filtry
          {activeCount > 0 && <span className="filter-badge">{activeCount}</span>}
        </button>
        {open && (
          <div className="filter-popover" role="dialog" aria-label="Filtry" ref={popRef}>
            {groups.map((g) => (
              <fieldset key={g.key} className="filter-group">
                <legend>{g.label}</legend>
                <div className="filter-options">
                  {g.options.map((o) => (
                    <label key={o.value || '__all'} className="filter-option">
                      <input
                        type="radio"
                        name={`filter-${g.key}`}
                        checked={g.value === o.value}
                        onChange={() => g.onChange(o.value)}
                      />
                      <span>{o.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
            {dates && (
              <fieldset className="filter-group">
                <legend>Okres</legend>
                <div className="filter-dates">
                  <label className="filter-date">
                    <span>Od</span>
                    <input
                      type="date"
                      value={dates.from}
                      onChange={(e) => dates.onFrom(e.target.value)}
                    />
                  </label>
                  <label className="filter-date">
                    <span>Do</span>
                    <input
                      type="date"
                      value={dates.to}
                      onChange={(e) => dates.onTo(e.target.value)}
                    />
                  </label>
                </div>
              </fieldset>
            )}
            {extra}
            <div className="filter-popover-foot">
              <button
                type="button"
                className="btn ghost small"
                onClick={onClearAll}
                disabled={activeCount === 0}
              >
                Wyczyść wszystko
              </button>
            </div>
          </div>
        )}
      </div>
      {chips.map((c) => (
        <span key={c.key} className="filter-chip">
          <span className="filter-chip-label">{c.label}</span>
          <button
            type="button"
            className="filter-chip-del"
            onClick={c.onRemove}
            aria-label={`Usuń filtr ${c.label}`}
          >
            <X size={13} />
          </button>
        </span>
      ))}
    </div>
  );
}
