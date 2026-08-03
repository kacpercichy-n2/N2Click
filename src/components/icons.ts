/**
 * Central icon module. Pages/components import icons from here, never
 * directly from `lucide-react` — this keeps the icon set curated and makes
 * it easy to swap a name later without touching call sites everywhere.
 */
export type { LucideIcon } from 'lucide-react';
export {
  LayoutDashboard,
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
  Search,
  Menu,
  X,
  ChevronRight,
  ChevronLeft,
  ChevronsLeft,
  ChevronsRight,
  Plus,
  Trash2,
  Pencil,
  Save,
  Check,
  AlertTriangle,
  ArrowRightLeft,
  ZoomIn,
  ZoomOut,
  Filter,
  Bookmark,
  Clock,
  ClipboardList,
  CircleHelp,
  Compass,
  Sparkles,
  ArrowLeft,
  KeyRound,
  Network,
  Inbox,
  Megaphone,
  ShieldCheck,
  // Karta Kanban: uchwyt przenoszenia (chwyt) i wyzwalacz menu karty.
  GripVertical,
  MoreVertical,
  // Wspólny wyzwalacz menu „⋯" (OverflowMenu) — poziomy wariant, bo stoi w
  // paskach akcji (nagłówek modala, nagłówek kolumny osoby w siatce).
  MoreHorizontal,
  // Zakładka „Zasobnik" w dolnym pasku telefonu (deep-link do kalendarza z
  // otwartym arkuszem bloków bez terminu).
  Archive,
  // Urlop: blok w kalendarzu, wskaźnik zamiast wykrzyknika przeciążenia i
  // wejście „Dodaj urlop". `Palmtree` to przestarzały alias tej samej ikony.
  TreePalm,
} from 'lucide-react';
