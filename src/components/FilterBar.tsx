// Reusable horizontal filter toolbar for the Projects, Tasks and Kanban pages
// (and, in a follow-up, TimelinePage). One wrapping row that COMPOSES the
// existing filter primitives; it owns no state and reads no store — every page
// keeps its own filter useState and hands this bar the finished pieces.
//
// Layout (single row, wraps on narrow widths):
//   [ Filtry popover + chips ] [ person chips? ] [ presets incl. "Zapisz filtr" ]
//   … trailing slot (e.g. the "X z Y…" counter) pushed to the end.
//
// The FilterPanel props are passed straight through; the person filter, saved
// presets and trailing counter are optional slots so each page can opt in. The
// `dataTour` pass-through keeps the onboarding anchors (projects.filters /
// tasks.filters) intact — the tour targets this element.
import type { ComponentProps, ReactNode } from 'react';
import { FilterPanel } from './FilterPanel';

export function FilterBar({
  dataTour,
  filterPanel,
  personFilter,
  presets,
  trailing,
}: {
  dataTour?: string;
  filterPanel: ComponentProps<typeof FilterPanel>;
  personFilter?: ReactNode;
  presets?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="filter-toolbar" data-tour={dataTour}>
      <FilterPanel {...filterPanel} />
      {personFilter && <div className="filter-toolbar-people">{personFilter}</div>}
      {presets && <div className="filter-toolbar-presets">{presets}</div>}
      {trailing && <div className="filter-toolbar-trailing">{trailing}</div>}
    </div>
  );
}
