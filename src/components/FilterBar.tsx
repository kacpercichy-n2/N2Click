// Reusable horizontal filter toolbar for the Projects, Tasks and Kanban pages
// (and, in a follow-up, TimelinePage). One wrapping row that COMPOSES the
// existing filter primitives; it owns no state and reads no store — every page
// keeps its own filter useState and hands this bar the finished pieces.
//
// Layout (single row, wraps on narrow widths):
//   [ Filtry popover + chips ] [ active person chips? ] [ presets incl. "Zapisz filtr" ]
//   … trailing slot (e.g. the "X z Y…" counter) pushed to the end.
//
// The FilterPanel props are passed straight through; presets and the trailing
// counter are optional slots so each page can opt in. The optional `person`
// prop group wires the multi-select person filter in ONE place: its "Osoby"
// section is injected into the popover (via the panel `extra`) and only the
// ACTIVE selection renders in the bar as compact chips. The `dataTour`
// pass-through keeps the onboarding anchors (projects.filters / tasks.filters)
// intact — the tour targets this element.
import type { ComponentProps, ReactNode } from 'react';
import type { Person } from '../types';
import { FilterPanel } from './FilterPanel';
import { ActivePersonChips, PersonFilterSection } from './PersonFilter';

interface PersonFilterProps {
  people: Person[];
  selected: Set<string>; // empty set == "Wszyscy"
  onToggle: (personId: string) => void;
  onAll: () => void;
}

export function FilterBar({
  dataTour,
  filterPanel,
  person,
  presets,
  trailing,
}: {
  dataTour?: string;
  filterPanel: ComponentProps<typeof FilterPanel>;
  person?: PersonFilterProps;
  presets?: ReactNode;
  trailing?: ReactNode;
}) {
  // Compose the "Osoby" section into the popover after any page-provided extra.
  const extra = person ? (
    <>
      {filterPanel.extra}
      <PersonFilterSection
        people={person.people}
        selected={person.selected}
        onToggle={person.onToggle}
        onAll={person.onAll}
      />
    </>
  ) : (
    filterPanel.extra
  );

  return (
    <div className="filter-toolbar" data-tour={dataTour}>
      <FilterPanel {...filterPanel} extra={extra} />
      {person && person.selected.size > 0 && (
        <div className="filter-toolbar-people">
          <ActivePersonChips
            people={person.people}
            selected={person.selected}
            onRemove={person.onToggle}
          />
        </div>
      )}
      {presets && <div className="filter-toolbar-presets">{presets}</div>}
      {trailing && <div className="filter-toolbar-trailing">{trailing}</div>}
    </div>
  );
}
