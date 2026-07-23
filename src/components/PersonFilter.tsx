import type { Person } from '../types';
import { personColor } from '../utils/colors';
import { X } from './icons';

interface Props {
  people: Person[];
  selected: Set<string>; // empty set == "All"
  onToggle: (personId: string) => void;
  onAll: () => void;
}

/** "All" chip plus one chip per person. Multi-select; All resets the filter. */
export function PersonFilter({ people, selected, onToggle, onAll }: Props) {
  const allActive = selected.size === 0;
  return (
    <div className="person-filter" role="group" aria-label="Filtruj po osobie">
      <button
        type="button"
        className={allActive ? 'filter-chip active' : 'filter-chip'}
        onClick={onAll}
      >
        Wszyscy
      </button>
      {people.map((p) => {
        const active = selected.has(p.id);
        return (
          <button
            key={p.id}
            type="button"
            className={active ? 'filter-chip active' : 'filter-chip'}
            onClick={() => onToggle(p.id)}
            style={
              active
                ? { borderColor: personColor(p.id), background: `${personColor(p.id)}22` }
                : undefined
            }
          >
            <span
              className="person-dot"
              style={{ background: personColor(p.id) }}
              aria-hidden
            />
            {p.name}
          </button>
        );
      })}
    </div>
  );
}

/** The multi-select "Osoby" group as it appears inside the FilterPanel popover:
 *  a labelled fieldset wrapping {@link PersonFilter}. Shared by FilterBar (which
 *  injects it via the panel `extra`) and pages that use FilterPanel directly. */
export function PersonFilterSection(props: Props) {
  return (
    <fieldset className="filter-group">
      <legend>Osoby</legend>
      <PersonFilter {...props} />
    </fieldset>
  );
}

/** Compact chips showing only the ACTIVE person selection (for the filter bar
 *  row). Renders nothing when the selection is empty ("Wszyscy"). Each chip is a
 *  remove button; past `maxVisible` the rest collapse into an informational
 *  "+N" chip. People are shown in list order for stability. */
export function ActivePersonChips({
  people,
  selected,
  onRemove,
  maxVisible = 4,
}: {
  people: Person[];
  selected: Set<string>;
  onRemove: (personId: string) => void;
  maxVisible?: number;
}) {
  if (selected.size === 0) return null;
  const active = people.filter((p) => selected.has(p.id));
  if (active.length === 0) return null;
  const shown = active.slice(0, maxVisible);
  const overflow = active.length - shown.length;
  return (
    <div className="person-active-chips" role="group" aria-label="Aktywne filtry osób">
      {shown.map((p) => (
        <button
          key={p.id}
          type="button"
          className="person-active-chip"
          onClick={() => onRemove(p.id)}
          aria-label={`Usuń filtr osoby ${p.name}`}
          style={{ borderColor: personColor(p.id), background: `${personColor(p.id)}22` }}
        >
          <span className="person-dot" style={{ background: personColor(p.id) }} aria-hidden />
          <span className="person-active-chip-name">{p.name}</span>
          <X size={12} aria-hidden />
        </button>
      ))}
      {overflow > 0 && <span className="person-active-chip more">+{overflow}</span>}
    </div>
  );
}
