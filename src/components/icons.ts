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
  // Dzwonek powiadomień w wierszu marki sidebara (NotificationsBell).
  Bell,
  Menu,
  X,
  ChevronRight,
  ChevronLeft,
  ChevronsLeft,
  ChevronsRight,
  // Czat (dok bąbelków): zwijanie i rozwijanie okna rozmowy.
  ChevronDown,
  ChevronUp,
  // Czat: wysłanie wiadomości (kompozytor) i bąbelek grupy bez inicjałów.
  Send,
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
  // Zakładka „Konto" — pełny profil zalogowanego użytkownika.
  CircleUser,
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
  // otwartym arkuszem bloków bez terminu) oraz akcja „Archiwizuj" na karcie
  // klienta; `ArchiveRestore` to jej odwrotność („Przywróć").
  Archive,
  ArchiveRestore,
  // Urlop: blok w kalendarzu, wskaźnik zamiast wykrzyknika przeciążenia i
  // wejście „Dodaj urlop". `Palmtree` to przestarzały alias tej samej ikony.
  TreePalm,
  // Moduł „Content plan": kalendarz miesiąca publikacji. Zakres (a nie pojedynczy
  // dzień jak `CalendarDays` czy godzina jak `CalendarClock`) odróżnia pozycję od
  // Kalendarza i Wydarzeń, które stoją w menu obok.
  CalendarRange,
  // Kalendarz „Content planu": kopiowanie i wklejanie slotu publikacji między
  // dniami, widoczność publikacji dla klienta (szkic vs udostępnione) oraz
  // zastępnik miniatury pliku z Drive.
  Copy,
  ClipboardPaste,
  Eye,
  EyeOff,
  FileImage,
  // Edytor publikacji „Content planu": wskazanie folderu marki na Dysku Google
  // (Picker), obok wyboru plików dla poszczególnych platform.
  FolderOpen,
  // Edytor publikacji „Content planu": sekcja komentarzy, wątek odpowiedzi,
  // dziennik zmian publikacji oraz słowniki marki w edytorze marki. `History`
  // stoi też przy przycisku „Zobacz zmiany" na Panelu (ten sam sens: historia).
  MessageSquare,
  CornerDownRight,
  History,
  Settings2,
} from 'lucide-react';
