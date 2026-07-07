import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { TasksPage } from './pages/TasksPage';
import { TaskEditorPage } from './pages/TaskEditorPage';
import { CalendarPage } from './pages/CalendarPage';
import { PeoplePage } from './pages/PeoplePage';
import { SampleBanner } from './components/SampleBanner';

export function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <div className="app-brand">
            <span className="app-brand-mark">N2</span>
            <span className="app-brand-name">N2click Planner</span>
          </div>
          <nav className="app-nav">
            <NavLink to="/tasks" className={navClass}>
              Tasks
            </NavLink>
            <NavLink to="/calendar" className={navClass}>
              Calendar
            </NavLink>
            <NavLink to="/people" className={navClass}>
              People
            </NavLink>
          </nav>
        </div>
      </header>

      <main className="app-main">
        <SampleBanner />
        <Routes>
          <Route path="/" element={<Navigate to="/tasks" replace />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/tasks/new" element={<TaskEditorPage />} />
          <Route path="/tasks/:id" element={<TaskEditorPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/people" element={<PeoplePage />} />
          <Route path="*" element={<Navigate to="/tasks" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function navClass({ isActive }: { isActive: boolean }): string {
  return isActive ? 'app-nav-link active' : 'app-nav-link';
}
