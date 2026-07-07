import type { Person } from '../types';
import { personColor } from '../utils/colors';

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
    <div className="person-filter" role="group" aria-label="Filter by person">
      <button
        type="button"
        className={allActive ? 'filter-chip active' : 'filter-chip'}
        onClick={onAll}
      >
        All
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
