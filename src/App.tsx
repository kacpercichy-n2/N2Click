import { useCallback, useEffect, useRef, useState } from 'react';
import {
  NavLink,
  Navigate,
  Route,
  Routes,
  useBlocker,
  useLocation,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { motion } from 'motion/react';
import { useStore } from './store/AppStore';
import { DashboardPage } from './pages/DashboardPage';
import { MyWorkPage } from './pages/MyWorkPage';
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
import { landingPathForRole, LoginPage } from './pages/LoginPage';
import { can } from './store/permissions';
import { currentUser as currentUserSel, isImpersonating, realUser } from './store/selectors';
import { SampleBanner } from './components/SampleBanner';
import { PersistenceBanner } from './components/PersistenceBanner';
import { TaskModal } from './components/TaskModal';
import { GlobalSearch } from './components/GlobalSearch';
import { Avatar } from './components/Avatar';
import {
  LayoutDashboard,
  ClipboardList,
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
  ChevronsLeft,
  ChevronsRight,
  CircleHelp,
} from './components/icons';
import type { LucideIcon } from './components/icons';
import { loadUiPrefs, updateUiPrefs } from './utils/uiPrefs';
import {
  consumeNavGuardBypass,
  dirtyNavScopes,
  navGuardBlocks,
} from './utils/dirtyRegistry';
import { OnboardingRoot } from './onboarding/OnboardingRoot';

const NAV: Array<[string, string, LucideIcon]> = [
  ['/dashboard', 'Panel', LayoutDashboard],
  ['/my-work', 'Moja praca', ClipboardList],
  ['/projects', 'Projekty', FolderKanban],
  ['/kanban', 'Kanban', Columns3],
  ['/timeline', 'Oś czasu', GanttChart],
  ['/tasks', 'Zadania', ListChecks],
  ['/calendar', 'Kalendarz', CalendarDays],
  ['/people', 'Zespół', Users],
  ['/workload', 'Obciążenie', Gauge],
  ['/admin', 'Administracja', Settings],
];

const MOBILE_NAV_QUERY = '(max-width: 760px)';
const DRAWER_FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function visibleDrawerControls(drawer: HTMLElement | null): HTMLElement[] {
  if (!drawer) return [];
  return Array.from(drawer.querySelectorAll<HTMLElement>(DRAWER_FOCUSABLE)).filter(
    (element) =>
      element.getAttribute('aria-hidden') !== 'true' &&
      element.getClientRects().length > 0 &&
      window.getComputedStyle(element).visibility !== 'hidden',
  );
}

export function App() {
  const { state, dispatch } = useStore();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => loadUiPrefs().sidebarCollapsed);
  const [mobileNav, setMobileNav] = useState(() => window.matchMedia(MOBILE_NAV_QUERY).matches);
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      const next = !v;
      updateUiPrefs({ sidebarCollapsed: next });
      return next;
    });
  };
  const expandSidebar = () => {
    if (!collapsed) return;
    setCollapsed(false);
    updateUiPrefs({ sidebarCollapsed: false });
  };

  const currentUser = state.people.find((p) => p.id === state.currentUserId);
  // Real logged-in identity (the impersonator while impersonating). Only the
  // "Występuj jako" switcher visibility and the return banner key off this;
  // everything else is a true preview of the acted-as `currentUser`.
  const actualUser = realUser(state);
  const impersonating = isImpersonating(state);
  const peopleCount = state.people.length;
  const canAdmin = can(currentUser, 'admin.panel', { peopleCount });
  // Session gate: with people present and nobody resolving to a current user,
  // only the login screen renders (no sidebar, no routes). Zero people = setup
  // mode (no lockout — mirrors the admin gate). `currentUserId` persists, so a
  // logged-in session survives reload BY DESIGN; real sessions/tokens land with
  // the API. A deleted current user falls back here (DELETE_PERSON clears it).
  const needsLogin = state.people.length > 0 && !currentUser;

  useEffect(() => {
    const media = window.matchMedia(MOBILE_NAV_QUERY);
    const sync = () => setMobileNav(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // While the drawer is open: lock body scroll, focus the first nav link, and
  // close on Escape. Cleanup restores everything (same pattern as TaskModal).
  useEffect(() => {
    if (!menuOpen) return;
    const drawer = drawerRef.current;
    const firstLink = drawer?.querySelector<HTMLElement>('.app-nav-link');
    firstLink?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setMenuOpen(false);
        return;
      }
      if (e.key !== 'Tab' || !mobileNav) return;
      const controls = visibleDrawerControls(drawer);
      if (controls.length === 0) {
        e.preventDefault();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !drawer?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !drawer?.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen, mobileNav]);

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

  const closedMobileDrawerProps = mobileNav && !menuOpen ? { inert: '' } : {};
  const openMobileMainProps = mobileNav && menuOpen ? { inert: '' } : {};

  if (needsLogin) {
    return <LoginPage />;
  }

  return (
    <div className={collapsed ? 'app-shell sidebar-collapsed' : 'app-shell'}>
      <header className="app-topbar">
        <div className="app-brand">
          <span className="app-brand-mark" aria-hidden />
          <span className="app-brand-name">N2Hub</span>
        </div>
        <button
          ref={hamburgerRef}
          type="button"
          className="app-hamburger"
          data-tour="shell.nav"
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
        aria-hidden={mobileNav && !menuOpen ? true : undefined}
        {...closedMobileDrawerProps}
      >
        <div className="app-brand-row">
          <div className="app-brand">
            <span className="app-brand-mark" aria-hidden />
            <span className="app-brand-name">N2Hub</span>
          </div>
          <button
            type="button"
            className="sidebar-toggle"
            aria-label={collapsed ? 'Rozwiń menu' : 'Zwiń menu'}
            title={collapsed ? 'Rozwiń menu' : 'Zwiń menu'}
            onClick={toggleCollapsed}
          >
            {collapsed ? (
              <ChevronsRight size={18} aria-hidden />
            ) : (
              <ChevronsLeft size={18} aria-hidden />
            )}
          </button>
        </div>
        <GlobalSearch />
        <nav className="app-nav" data-tour="shell.nav">
          {NAV.filter(([to]) => to !== '/admin' || canAdmin).map(([to, label, Icon]) => (
            <NavLink
              key={to}
              to={to}
              className={navClass}
              title={label}
              onClick={() => setMenuOpen(false)}
            >
              <Icon size={18} aria-hidden className="nav-icon" />
              <span className="nav-label">{label}</span>
            </NavLink>
          ))}
        </nav>
        <button
          type="button"
          className="sidebar-help"
          data-tour="shell.help"
          onClick={() => window.dispatchEvent(new Event('n2hub:open-tutorials'))}
        >
          <CircleHelp size={18} aria-hidden />
          <span className="nav-label">Pomoc i samouczki</span>
        </button>
        {state.people.length > 0 && (
          <div className="acting-as-wrap">
            {/* Collapsed avatar shortcut (CSS-shown only >1180px + collapsed). */}
            <button
              type="button"
              className="acting-as-collapsed"
              title={
                currentUser ? `Występuj jako: ${currentUser.name}` : 'Występuj jako'
              }
              aria-label={
                currentUser ? `Występuj jako: ${currentUser.name}` : 'Występuj jako'
              }
              onClick={expandSidebar}
            >
              {currentUser ? (
                <Avatar person={currentUser} size={32} />
              ) : (
                <Users size={20} aria-hidden />
              )}
            </button>
            {/* "Występuj jako" is an administrator-only quick switch now. Gated
                on the REAL logged-in user so it never vanishes while the admin
                is previewing another identity. */}
            {can(actualUser, 'users.impersonate', { peopleCount: state.people.length }) && (
              <label className="acting-as" title="Aktualny użytkownik aplikacji (autor komentarzy, uprawnienia admina)">
                <span className="acting-as-label">Występuj jako</span>
                <select
                  value={state.currentUserId}
                  onChange={(e) =>
                    dispatch({ type: 'IMPERSONATE', personId: e.target.value })
                  }
                >
                  {state.people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.accessRole === 'administrator' ? ' (administrator)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {/* Everyone can log out (returns to the login screen). */}
            <button
              type="button"
              className="btn ghost logout-btn"
              onClick={() => dispatch({ type: 'LOGOUT' })}
            >
              Wyloguj
            </button>
          </div>
        )}
      </aside>

      <main
        className="app-main"
        data-tour="shell.main"
        aria-hidden={mobileNav && menuOpen ? true : undefined}
        {...openMobileMainProps}
      >
        {impersonating && currentUser && actualUser && (
          <div className="impersonation-banner" role="status">
            <span className="impersonation-banner-text">
              Występujesz jako {currentUser.name} — aktywne są uprawnienia tej osoby.
            </span>
            <button
              type="button"
              className="btn"
              onClick={() => dispatch({ type: 'STOP_IMPERSONATION' })}
            >
              Wróć do {actualUser.name}
            </button>
          </div>
        )}
        {/* Persistence banner shows on every routed page (not the login screen —
            no edits happen there and a clean tab auto-refreshes silently). */}
        <PersistenceBanner />
        <SampleBanner />
        <motion.div
          key={location.pathname}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
        >
          <Routes>
            <Route path="/" element={<HomeRedirect />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/my-work" element={<MyWorkPage />} />
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
            <Route
              path="/admin"
              element={canAdmin ? <AdminPage /> : <Navigate to="/dashboard" replace />}
            />
            <Route path="*" element={<HomeRedirect />} />
          </Routes>
        </motion.div>
      </main>

      {/* The task popout modal lives once, above every page. */}
      <TaskModal />
      <DirtyNavigationGuard />
      <OnboardingRoot
        owner={actualUser}
        viewer={currentUser}
        impersonating={impersonating}
      />
    </div>
  );
}

/**
 * Router-level guard for dirty task/project edits. Blocks any navigation that
 * would discard an unsaved edit — sidebar links, in-app links, programmatic
 * `navigate()` and browser Back/Forward (the data router reverts the URL on a
 * cancelled pop) — and asks in Polish before proceeding. Forms that already
 * confirmed the discard with their own dialog arm a one-shot bypass, so the
 * existing close-button confirmations fire exactly once. Only the task modal
 * and the project editor register in the guard registry; every other route and
 * form navigates untouched.
 */
function DirtyNavigationGuard() {
  const blocker = useBlocker(
    useCallback(
      ({ currentLocation, nextLocation }: {
        currentLocation: { pathname: string; search: string };
        nextLocation: { pathname: string; search: string };
      }) => {
        // Consume the bypass unconditionally so a stale one never outlives
        // the navigation it was armed for.
        const bypass = consumeNavGuardBypass();
        if (bypass) return false;
        return navGuardBlocks(dirtyNavScopes(), currentLocation, nextLocation);
      },
      [],
    ),
  );

  // Same pattern as react-router's usePrompt: resolve the blocked state with a
  // native confirm. Cancel keeps the URL and the edit; confirm proceeds. The
  // setTimeout avoids racing the history revert on Back/Forward pops.
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm('Masz niezapisane zmiany. Opuścić bez zapisywania?')) {
      setTimeout(blocker.proceed, 0);
    } else {
      blocker.reset();
    }
  }, [blocker]);

  return null;
}

/**
 * Landing redirect for `/` and unknown routes. `pracownik`-role users land on
 * their work page (`/my-work`); everyone else — admin/pm/handlowiec, setup mode,
 * or an unresolved user — keeps the dashboard. Keys off the acted-as
 * `currentUser`, so impersonation previews the target role's landing (correct).
 */
function HomeRedirect() {
  const { state } = useStore();
  const dest = landingPathForRole(currentUserSel(state)?.accessRole);
  return <Navigate to={dest} replace />;
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
