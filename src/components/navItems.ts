// Canonical sidebar navigation list + the pure ordering helper behind the
// device-local menu-order editor (see AccountPage „Interfejs”). Moved out of
// App.tsx so the ordering logic stays testable in node with zero React/store
// imports. The tuple order here IS the default order; the „Ustawienia” link is
// pinned separately in App.tsx and is NOT part of this list.
import {
  LayoutDashboard,
  ClipboardList,
  FolderKanban,
  Building2,
  Columns3,
  GanttChart,
  ListChecks,
  CalendarDays,
  CalendarClock,
  Users,
  Gauge,
  Network,
  Inbox,
  ShieldCheck,
} from './icons';
import type { LucideIcon } from './icons';

export const NAV_ITEMS: Array<[string, string, LucideIcon]> = [
  ['/dashboard', 'Panel', LayoutDashboard],
  ['/my-work', 'Moja praca', ClipboardList],
  ['/projects', 'Projekty', FolderKanban],
  ['/clients', 'Klienci', Building2],
  ['/kanban', 'Kanban', Columns3],
  ['/timeline', 'Oś czasu', GanttChart],
  ['/tasks', 'Zadania', ListChecks],
  ['/calendar', 'Kalendarz', CalendarDays],
  ['/wydarzenia', 'Wydarzenia', CalendarClock],
  ['/people', 'Zespół', Users],
  ['/team', 'Struktura zespołu', Network],
  ['/workload', 'Obciążenie', Gauge],
  // Zgłoszenia widzi KAŻDY (każda rola może zgłosić) — bez bramki jak /admin.
  ['/zgloszenia', 'Zgłoszenia', Inbox],
  ['/admin', 'Administracja', ShieldCheck],
];

/**
 * Order `defaultPaths` by a device-saved preference. Saved paths come first (only
 * those still present in `defaultPaths`, deduped in saved order), then every
 * remaining default path in its default order. An undefined/empty `saved` (or one
 * that references only unknown paths) degrades to the plain default order. Pure —
 * no side effects, unknown saved entries are ignored.
 */
export function orderNavPaths(
  defaultPaths: string[],
  saved: string[] | undefined,
): string[] {
  if (!saved || saved.length === 0) return [...defaultPaths];
  const known = new Set(defaultPaths);
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const path of saved) {
    if (known.has(path) && !seen.has(path)) {
      seen.add(path);
      ordered.push(path);
    }
  }
  for (const path of defaultPaths) {
    if (!seen.has(path)) {
      seen.add(path);
      ordered.push(path);
    }
  }
  return ordered;
}
