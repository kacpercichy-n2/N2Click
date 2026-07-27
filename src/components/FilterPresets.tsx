// Shared saved-filter preset UI for the Projects and Tasks pages.
// Renders chips for the stored presets of `page` (apply on click, ✕ deletes),
// plus a "Zapisz filtr" control that snapshots the current criteria as a preset.
import { useId, useState } from 'react';
import { useStore } from '../store/AppStore';
import type { FilterPage, SavedFilterCriteria } from '../types';
import { DEFAULT_FILTER_CRITERIA } from '../store/storage';
import { useConfirm } from './ConfirmProvider';
import { Bookmark, Check, X } from './icons';
import { DisabledHint, Tooltip } from './Tooltip';

// Single source of truth lives in storage.ts; re-exported under the name the
// import sites (ProjectsPage/TasksPage) already use.
export const DEFAULT_CRITERIA: SavedFilterCriteria = DEFAULT_FILTER_CRITERIA;

/** True when any criterion differs from the neutral default. */
export function isCriteriaActive(c: SavedFilterCriteria): boolean {
  return (
    c.paid !== 'all' ||
    c.clientId !== '' ||
    c.projectId !== '' ||
    c.statusId !== '' ||
    c.personId !== '' ||
    c.priority !== '' ||
    c.workCategoryId !== '' ||
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
  const confirm = useConfirm();
  const uid = useId();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');

  const presets = state.savedFilters.filter((f) => f.page === page);
  const canSave = isCriteriaActive(criteria);

  // Preset to zapisane kryteria, nie dane planu — jednoklikowe pytanie bez
  // wyliczania skutków i bez `requireAck`.
  const remove = async (filterId: string, filterName: string) => {
    if (
      await confirm({
        title: `Usunąć zapisany filtr „${filterName}”?`,
        confirmLabel: 'Usuń filtr',
        tone: 'danger',
      })
    ) {
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
          <Tooltip text="Zastosuj zapisany filtr">
            <button
              type="button"
              className="preset-chip-apply"
              onClick={() => onApply(f.criteria)}
            >
              <Bookmark size={13} />
              {f.name}
            </button>
          </Tooltip>
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
        // Wyłączony przycisk POŁYKA zdarzenia wskaźnika, więc powód blokady
        // niesie `DisabledHint` (opakowanie + ukryty opis); sprawny przycisk
        // dostaje zwykły dymek.
        (() => {
          const saveBtn = (
            <button
              type="button"
              className="btn ghost small preset-save-btn"
              onClick={() => setNaming(true)}
              disabled={!canSave}
            >
              <Bookmark size={14} /> Zapisz filtr
            </button>
          );
          return canSave ? (
            <Tooltip text="Zapisz bieżące filtry jako preset">{saveBtn}</Tooltip>
          ) : (
            <DisabledHint reason="Ustaw jakiś filtr, aby go zapisać" id={`${uid}-save-blocked`}>
              {saveBtn}
            </DisabledHint>
          );
        })()
      )}
    </div>
  );
}
