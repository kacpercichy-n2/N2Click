// Shared saved-filter preset UI for the Projects and Tasks pages.
// Renders chips for the stored presets of `page` (apply on click, ✕ deletes),
// plus a "Zapisz filtr" control that snapshots the current criteria as a preset.
import { useState } from 'react';
import { useStore } from '../store/AppStore';
import type { FilterPage, SavedFilterCriteria } from '../types';
import { Bookmark, Check, X } from './icons';

export const DEFAULT_CRITERIA: SavedFilterCriteria = {
  paid: 'all',
  clientId: '',
  statusId: '',
  personId: '',
  from: '',
  to: '',
};

/** True when any criterion differs from the neutral default. */
export function isCriteriaActive(c: SavedFilterCriteria): boolean {
  return (
    c.paid !== 'all' ||
    c.clientId !== '' ||
    c.statusId !== '' ||
    c.personId !== '' ||
    c.from !== '' ||
    c.to !== ''
  );
}

export function FilterPresets({
  page,
  criteria,
  onApply,
}: {
  page: FilterPage;
  criteria: SavedFilterCriteria;
  onApply: (criteria: SavedFilterCriteria) => void;
}) {
  const { state, dispatch } = useStore();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');

  const presets = state.savedFilters.filter((f) => f.page === page);
  const canSave = isCriteriaActive(criteria);

  const remove = (filterId: string, filterName: string) => {
    if (window.confirm(`Usunąć zapisany filtr „${filterName}”?`)) {
      dispatch({ type: 'DELETE_FILTER_PRESET', filterId });
    }
  };

  const confirmSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    dispatch({ type: 'SAVE_FILTER_PRESET', name: trimmed, page, criteria });
    setName('');
    setNaming(false);
  };

  return (
    <div className="filter-presets">
      {presets.map((f) => (
        <span key={f.id} className="preset-chip">
          <button
            type="button"
            className="preset-chip-apply"
            onClick={() => onApply(f.criteria)}
            title="Zastosuj zapisany filtr"
          >
            <Bookmark size={13} />
            {f.name}
          </button>
          <button
            type="button"
            className="preset-chip-del"
            onClick={() => remove(f.id, f.name)}
            aria-label={`Usuń filtr ${f.name}`}
          >
            <X size={13} />
          </button>
        </span>
      ))}

      {naming ? (
        <span className="preset-save-form">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirmSave();
              if (e.key === 'Escape') {
                setNaming(false);
                setName('');
              }
            }}
            placeholder="Nazwa filtra"
            aria-label="Nazwa zapisywanego filtra"
          />
          <button
            type="button"
            className="btn primary small"
            onClick={confirmSave}
            aria-label="Zapisz filtr"
          >
            <Check size={14} />
          </button>
          <button
            type="button"
            className="btn ghost small"
            onClick={() => {
              setNaming(false);
              setName('');
            }}
          >
            Anuluj
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="btn ghost small preset-save-btn"
          onClick={() => setNaming(true)}
          disabled={!canSave}
          title={canSave ? 'Zapisz bieżące filtry jako preset' : 'Ustaw jakiś filtr, aby go zapisać'}
        >
          <Bookmark size={14} /> Zapisz filtr
        </button>
      )}
    </div>
  );
}
