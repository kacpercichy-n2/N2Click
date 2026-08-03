/**
 * Shared sidebar nav config — the single source of truth for routes, labels,
 * icons and their SHIPPED default order. Both `src/App.tsx` (renderer) and
 * `src/components/NavOrderEditor.tsx` (reorder UI) import it, so a per-user
 * order stays a mere permutation of these paths (see `src/utils/navOrder.ts`).
 * Gates (canAdmin, supabase-only Konto) are applied by the renderer AFTER
 * ordering — never encoded here.
 *
 * „Moja praca” (/my-work) zniknęła 2026-07-22 (run 258): jej sekcje żyją na
 * Panelu, a stara trasa przekierowuje na /dashboard (patrz homeRoute.ts).
 */
import type { LucideIcon } from './icons';
import {
  LayoutDashboard,
  FolderKanban,
  Building2,
  Columns3,
  GanttChart,
  ListChecks,
  CalendarDays,
  CalendarClock,
  CalendarRange,
  Users,
  Gauge,
  Settings,
  KeyRound,
} from './icons';

export type NavItem = [string, string, LucideIcon];

export const NAV: NavItem[] = [
  ['/dashboard', 'Panel', LayoutDashboard],
  ['/clients', 'Klienci', Building2],
  ['/projects', 'Projekty', FolderKanban],
  ['/tasks', 'Zadania', ListChecks],
  ['/kanban', 'Kanban', Columns3],
  ['/calendar', 'Kalendarz', CalendarDays],
  ['/wydarzenia', 'Wydarzenia', CalendarClock],
  // Content plan stoi przy pozycjach kalendarzowych, bo jego jednostką jest
  // miesiąc publikacji. Bramka roli (tylko administratorzy) siedzi w App.tsx,
  // nie tutaj — patrz src/pages/contentPlanScope.ts.
  ['/content-plan', 'Content plan', CalendarRange],
  ['/timeline', 'Oś czasu', GanttChart],
  ['/workload', 'Obciążenie', Gauge],
  ['/people', 'Zespół', Users],
  // Konto istnieje tylko dla realnego konta Supabase (tryb lokalny nie zna
  // tego pojęcia) — filtr w App ukrywa je w trybie lokalnym.
  ['/account', 'Konto', KeyRound],
  ['/admin', 'Ustawienia', Settings],
];
