/**
 * Shared sidebar nav config — the single source of truth for routes, labels,
 * icons and their SHIPPED default order. Both `src/App.tsx` (renderer) and
 * `src/components/NavOrderEditor.tsx` (reorder UI) import it, so a per-user
 * order stays a mere permutation of these paths (see `src/utils/navOrder.ts`).
 * Gates (canAdmin, supabase-only Konto) are applied by the renderer AFTER
 * ordering — never encoded here.
 */
import type { LucideIcon } from './icons';
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
  Settings,
  KeyRound,
} from './icons';

export type NavItem = [string, string, LucideIcon];

export const NAV: NavItem[] = [
  ['/dashboard', 'Panel', LayoutDashboard],
  ['/my-work', 'Moja praca', ClipboardList],
  ['/clients', 'Klienci', Building2],
  ['/projects', 'Projekty', FolderKanban],
  ['/tasks', 'Zadania', ListChecks],
  ['/kanban', 'Kanban', Columns3],
  ['/calendar', 'Kalendarz', CalendarDays],
  ['/wydarzenia', 'Wydarzenia', CalendarClock],
  ['/timeline', 'Oś czasu', GanttChart],
  ['/workload', 'Obciążenie', Gauge],
  ['/people', 'Zespół', Users],
  // Konto istnieje tylko dla realnego konta Supabase (tryb lokalny nie zna
  // tego pojęcia) — filtr w App ukrywa je w trybie lokalnym.
  ['/account', 'Konto', KeyRound],
  ['/admin', 'Ustawienia', Settings],
];
