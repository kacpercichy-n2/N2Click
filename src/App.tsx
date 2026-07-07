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

const NAV: Array<[string, string]> = [
  ['/dashboard', 'Dashboard'],
  ['/projects', 'Projects'],
  ['/kanban', 'Kanban'],
  ['/timeline', 'Timeline'],
  ['/tasks', 'Tasks'],
  ['/calendar', 'Calendar'],
  ['/people', 'People'],
  ['/workload', 'Workload'],
  ['/admin', 'Admin'],
];

export function App() {
  const { state, dispatch } = useStore();
  const location = useLocation();

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-brand">
          <span className="app-brand-mark" aria-hidden />
          <span className="app-brand-name">N2click</span>
        </div>
        <nav className="app-nav">
          {NAV.map(([to, label]) => (
            <NavLink key={to} to={to} className={navClass}>
              {label}
            </NavLink>
          ))}
        </nav>
        {state.people.length > 0 && (
          <label className="acting-as" title="Who is using the app (comment author, admin rights)">
            <span className="acting-as-label">Acting as</span>
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
                  {p.isAdmin ? ' (admin)' : ''}
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
