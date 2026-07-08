// Shared filter UI for the Projects, Tasks, Kanban and Workload pages.
// An e-commerce-style "Filtry" button with an active-count badge opens a
// popover of single-select option groups (radio) plus optional date inputs;
// applied filters render as removable chips with a clear-all in the footer.
//
// The component is a dumb, controlled presentation layer: every page keeps its
// own filter useState and builds the `groups`/`chips`/`dates` props from it.
// Choosing an option applies live (no "Zastosuj"). Closes on outside
// mousedown, Escape, or toggling the button — mirroring the WeekView
// context-menu pattern (no page-blocking scrim).
import { useEffect, useRef, useState } from 'react';
import { Filter, X } from './icons';

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
  activeCount: number;
  onClearAll: () => void;
  chips: FilterChip[];
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Close on Escape or a mousedown outside the button+popover wrapper.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  return (
    <div className="filter-bar">
      <div className="filter-panel-wrap" ref={wrapRef}>
        <button
          type="button"
          className={activeCount > 0 ? 'btn soft filter-btn active' : 'btn soft filter-btn'}
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => setOpen((v) => !v)}
        >
          <Filter size={15} aria-hidden /> Filtry
          {activeCount > 0 && <span className="filter-badge">{activeCount}</span>}
        </button>
        {open && (
          <div className="filter-popover" role="dialog" aria-label="Filtry">
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
