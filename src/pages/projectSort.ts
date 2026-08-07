// Pure presentation-only ordering for the Projects page. Client groups sort
// alphabetically by client name (pl locale so polskie znaki collate correctly),
// projects within each group sort alphabetically by project name. The "Bez
// klienta" group (empty clientId) always sorts last. Returns a sorted copy —
// never mutates the input, the store order or persistence.

import { comparePl } from '../utils/collation';

/** A client group as rendered on the Projects page. */
export interface ProjectGroup<P extends { name: string }> {
  clientId: string;
  clientName: string;
  projects: P[];
}

export function sortProjectGroups<P extends { name: string }>(
  groups: ProjectGroup<P>[],
  // Porządek projektów WEWNĄTRZ grupy (zgłoszenie 9db56d5a): domyślnie
  // alfabetycznie po nazwie; strona może podać własny komparator (sortowanie
  // po dacie). Kolejność grup (klienci alfabetycznie, „Bez klienta" ostatnia)
  // jest stała niezależnie od wyboru.
  compareProjects: (a: P, b: P) => number = (a, b) => comparePl(a.name, b.name),
): ProjectGroup<P>[] {
  return groups
    .map((g) => ({
      ...g,
      projects: [...g.projects].sort(compareProjects),
    }))
    .sort((a, b) => {
      // "Bez klienta" (clientId === '') always last, regardless of its label.
      if (!a.clientId && b.clientId) return 1;
      if (a.clientId && !b.clientId) return -1;
      return comparePl(a.clientName, b.clientName);
    });
}
