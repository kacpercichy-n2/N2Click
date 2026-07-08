import { useEffect, useRef, useState } from 'react';
import {
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { motion } from 'motion/react';
import { useStore } from './store/AppStore';
import { DashboardPage } from './pages/DashboardPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { KanbanPage } from './pages/KanbanPage';
import { TimelinePage } from './pages/TimelinePage';
import { TasksPage } from './pages/TasksPage';
import { CalendarPage } from './pages/CalendarPage';
import { PeoplePage } from './pages/PeoplePage';
import { PersonProfilePage } from './pages/PersonProfilePage';
import { WorkloadPage } from './pages/WorkloadPage';
import { AdminPage } from './pages/AdminPage';
import { SampleBanner } from './components/SampleBanner';
import { TaskModal } from './components/TaskModal';
import { GlobalSearch } from './components/GlobalSearch';
import {
  LayoutDashboard,
  FolderKanban,
  Columns3,
  GanttChart,
  ListChecks,
  CalendarDays,
  Users,
  Gauge,
  Settings,
  Menu,
  X,
} from './components/icons';
import type { LucideIcon } from './components/icons';

const NAV: Array<[string, string, LucideIcon]> = [
  ['/dashboard', 'Panel', LayoutDashboard],
  ['/projects', 'Projekty', FolderKanban],
  ['/kanban', 'Kanban', Columns3],
  ['/timeline', 'Oś czasu', GanttChart],
  ['/tasks', 'Zadania', ListChecks],
  ['/calendar', 'Kalendarz', CalendarDays],
  ['/people', 'Zespół', Users],
  ['/workload', 'Obciążenie', Gauge],
  ['/admin', 'Administracja', Settings],
];

export function App() {
  const { state, dispatch } = useStore();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // While the drawer is open: lock body scroll, focus the first nav link, and
  // close on Escape. Cleanup restores everything (same pattern as TaskModal).
  useEffect(() => {
    if (!menuOpen) return;
    const firstLink = drawerRef.current?.querySelector<HTMLElement>('.app-nav-link');
    firstLink?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  // Return focus to the hamburger after closing (only when it was open).
  const wasOpen = useRef(false);
  useEffect(() => {
    if (menuOpen) {
      wasOpen.current = true;
    } else if (wasOpen.current) {
      wasOpen.current = false;
      hamburgerRef.current?.focus();
    }
  }, [menuOpen]);

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <div className="app-brand">
          <span className="app-brand-mark" aria-hidden />
          <span className="app-brand-name">N2Hub</span>
        </div>
        <button
          ref={hamburgerRef}
          type="button"
          className="app-hamburger"
          aria-label={menuOpen ? 'Zamknij menu' : 'Otwórz menu'}
          aria-expanded={menuOpen}
          aria-controls="app-drawer"
          onClick={() => setMenuOpen((v) => !v)}
        >
          {menuOpen ? <X size={22} aria-hidden /> : <Menu size={22} aria-hidden />}
        </button>
      </header>

      {menuOpen && (
        <div
          className="app-drawer-scrim"
          aria-hidden
          onClick={() => setMenuOpen(false)}
        />
      )}

      <aside
        id="app-drawer"
        ref={drawerRef}
        className={menuOpen ? 'app-sidebar open' : 'app-sidebar'}
      >
        <div className="app-brand">
          <span className="app-brand-mark" aria-hidden />
          <span className="app-brand-name">N2Hub</span>
        </div>
        <GlobalSearch />
        <nav className="app-nav">
          {NAV.map(([to, label, Icon]) => (
            <NavLink
              key={to}
              to={to}
              className={navClass}
              onClick={() => setMenuOpen(false)}
            >
              <Icon size={18} aria-hidden className="nav-icon" />
              {label}
            </NavLink>
          ))}
        </nav>
        {state.people.length > 0 && (
          <label className="acting-as" title="Aktualny użytkownik aplikacji (autor komentarzy, uprawnienia admina)">
            <span className="acting-as-label">Występuj jako</span>
            <select
              value={state.currentUserId}
              onChange={(e) =>
                dispatch({ type: 'SET_CURRENT_USER', personId: e.target.value })
              }
            >
              <option value="">—</option>
              {state.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.isAdmin ? ' (administrator)' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
      </aside>

      <main className="app-main">
        <SampleBanner />
        <motion.div
          key={location.pathname}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
        >
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/:id" element={<ProjectDetailPage />} />
            <Route path="/kanban" element={<KanbanPage />} />
            <Route path="/timeline" element={<TimelinePage />} />
            <Route path="/tasks" element={<TasksPage />} />
            {/* Old page-form routes now redirect into the modal (deep-link compatible). */}
            <Route path="/tasks/new" element={<NewTaskRedirect />} />
            <Route path="/tasks/:id" element={<TaskRedirect />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/people" element={<PeoplePage />} />
            <Route path="/people/:id" element={<PersonProfilePage />} />
            <Route path="/workload" element={<WorkloadPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </motion.div>
      </main>

      {/* The task popout modal lives once, above every page. */}
      <TaskModal />
    </div>
  );
}

/** `/tasks/new[?project=<id>]` → `/tasks?task=new[&project=<id>]`. */
function NewTaskRedirect() {
  const [params] = useSearchParams();
  const project = params.get('project');
  const search = project
    ? `?task=new&project=${encodeURIComponent(project)}`
    : '?task=new';
  return <Navigate to={`/tasks${search}`} replace />;
}

/** `/tasks/<id>` → `/tasks?task=<id>`. */
function TaskRedirect() {
  const { id } = useParams();
  return <Navigate to={`/tasks?task=${encodeURIComponent(id ?? '')}`} replace />;
}

function navClass({ isActive }: { isActive: boolean }): string {
  return isActive ? 'app-nav-link active' : 'app-nav-link';
}
