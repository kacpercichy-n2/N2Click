import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useBlocker,
  useLocation,
  useSearchParams,
} from 'react-router-dom';
import { m } from 'motion/react';
import { useStore } from './store/AppStore';
// Wszystkie strony tras są LENIWE — jedna mapa `routeChunks.ts` daje i te
// komponenty, i `prefetchRoute` podgrzewający ten sam chunk na hoverze pozycji
// menu. `LoginPage` zostaje zwykłym importem: renderuje się przed powłoką i
// przed granicą `<Suspense>`.
import {
  AccountPage,
  AdminPage,
  CalendarPage,
  ChangelogPage,
  ClientsPage,
  DashboardPage,
  EventsPage,
  KanbanPage,
  PeoplePage,
  PersonProfilePage,
  ProjectDetailPage,
  ProjectsPage,
  TaskFullPage,
  TasksPage,
  TeamPage,
  TicketsPage,
  TimelinePage,
  WorkloadPage,
  prefetchRoute,
} from './pages/routeChunks';
import { canViewTeam } from './pages/teamScope';
import { LoginPage } from './pages/LoginPage';
import { HOME_PATH } from './pages/homeRoute';
import { useAuth } from './auth/SessionProvider';
import { useOrgData } from './supabase/OrgDataProvider';
import { buildCloudPeoplePayload, effectiveAccessRole } from './supabase/referenceData';
import {
  AuthBlocked,
  AuthLoading,
  ForcedPasswordChange,
  SupabaseLoginPage,
} from './auth/AuthScreens';
import { findPersonByEmail } from './auth/profile';
import { can } from './store/permissions';
import { unreadNotificationCountFor } from './utils/tabBadge';
import { useTabBadge } from './utils/useTabBadge';
import { SampleBanner } from './components/SampleBanner';
import { PersistenceBanner } from './components/PersistenceBanner';
import { LiveRegionHost } from './components/LiveRegionHost';
import { CloudSyncBanner } from './components/CloudSyncBanner';
import { TaskModal } from './components/TaskModal';
import { TicketModal } from './components/TicketModal';
import { EventModal } from './components/EventModal';
import { GlobalSearch } from './components/GlobalSearch';
import { useConfirm } from './components/ConfirmProvider';
import { Avatar } from './components/Avatar';
import { Tooltip } from './components/Tooltip';
import {
  Settings,
  Archive,
  CalendarDays,
  LayoutDashboard,
  ListChecks,
  MoreHorizontal,
  ChevronsLeft,
  ChevronsRight,
  CircleHelp,
} from './components/icons';
import { NAV_ITEMS, orderNavPaths } from './components/navItems';
import {
  BIN_TAB_TARGET,
  activeTabPath,
  moreNavPaths,
  topBarTitle,
} from './components/bottomNav';
import { OverlayLayer, useOverlay } from './components/useOverlay';
import { MOBILE_NAV_QUERY, useMediaQuery } from './utils/useMediaQuery';
import { loadUiPrefs, updateUiPrefs } from './utils/uiPrefs';
import {
  consumeNavGuardBypass,
  dirtyNavScopes,
  navGuardBlocks,
} from './utils/dirtyRegistry';
import { OnboardingRoot } from './onboarding/OnboardingRoot';

const NAV_ITEM_BY_PATH = new Map(NAV_ITEMS.map((item) => [item[0], item]));
/** Etykiety tras dla tytułu górnego paska telefonu (jedno źródło: NAV_ITEMS). */
const NAV_LABELS: ReadonlyMap<string, string> = new Map(
  NAV_ITEMS.map(([to, label]) => [to, label]),
);

/**
 * Trzy zakładki-trasy dolnego paska. Ikony powtarzają te z `NAV_ITEMS`, ale
 * kolejność i skład zakładek są WŁASNĄ decyzją paska (nie podlegają edytorowi
 * kolejności menu — ten rządzi wyłącznie listą w arkuszu „Więcej”).
 */
const BOTTOM_TABS: Array<[string, string, typeof LayoutDashboard]> = [
  ['/dashboard', 'Panel', LayoutDashboard],
  ['/calendar', 'Kalendarz', CalendarDays],
  ['/tasks', 'Zadania', ListChecks],
];

export function App() {
  const { state, dispatch } = useStore();
  const auth = useAuth();
  const org = useOrgData();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => loadUiPrefs().sidebarCollapsed);
  // Device-local sidebar order (paths). The Ustawienia editor persists it and
  // fires 'n2hub:nav-order-changed'; the effect below reloads it into state so
  // the sidebar reorders in the same tab without a reload (house pattern — see
  // 'n2hub:open-tutorials').
  const [navOrder, setNavOrder] = useState(() => loadUiPrefs().navOrder);
  // Telefon (≤760 px): dolny pasek zakładek zamiast szuflady. Wspólny hook, z
  // którego korzysta też CalendarPage — jeden breakpoint na całą aplikację.
  const mobileNav = useMediaQuery(MOBILE_NAV_QUERY);
  // Arkusz „Więcej”: reszta tras + Ustawienia, Pomoc, profil i wylogowanie.
  const [moreOpen, setMoreOpen] = useState(false);
  const moreBtnRef = useRef<HTMLButtonElement | null>(null);
  const moreSheetRef = useRef<HTMLDivElement | null>(null);

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      const next = !v;
      updateUiPrefs({ sidebarCollapsed: next });
      return next;
    });
  };
  // Pełna synchronizacja zespołu (tryb supabase): każdy gotowy snapshot
  // organizacji scala WSZYSTKIE widoczne (RLS) profile chmury w lokalną listę
  // osób — w tym własny profil zalogowanego konta, więc świeża przeglądarka
  // nigdy nie kończy na ekranie „Brak profilu w planerze”. Reduktor jest
  // idempotentny (brak zmian => ta sama referencja stanu), więc ponowne
  // dispatchowanie tego samego snapshotu jest darmowe i bez pętli.
  const authedSignedIn = auth.mode === 'supabase' && auth.state.status === 'signedIn';
  const orgState = org.state;
  useEffect(() => {
    if (!authedSignedIn || auth.mustChangePassword !== false) return;
    if (orgState.status !== 'ready') return;
    const snap = orgState.snapshot;
    // Słowniki najpierw (statusy/działy/typy usług/kategorie prac), potem
    // zespół — dział osoby wskazuje wtedy istniejący wiersz. Obie akcje są
    // autorytatywne i idempotentne (brak zmian => ta sama referencja stanu).
    dispatch({
      type: 'MERGE_CLOUD_DICTIONARIES',
      payload: {
        departments: snap.departments,
        statuses: snap.statuses,
        serviceTypes: snap.serviceTypes,
        workCategories: snap.workCategories,
        jobTitles: snap.jobTitles,
        companies: snap.companies,
      },
    });
    dispatch({ type: 'MERGE_CLOUD_PEOPLE', payload: buildCloudPeoplePayload(snap.profiles) });
  }, [authedSignedIn, auth.mustChangePassword, orgState, dispatch]);

  const currentUser = state.people.find((p) => p.id === state.currentUserId);
  // Badge karty przeglądarki (favicon + tytuł) — te same dane co karta
  // „Powiadomienia” na Panelu; wylogowanie => licznik 0 => przywrócenie
  // oryginalnej karty. Wpięty tu raz, więc działa na każdej stronie aplikacji.
  useTabBadge(unreadNotificationCountFor(state.notifications, currentUser?.id));
  const peopleCount = state.people.length;
  const canAdmin = can(currentUser, 'admin.panel', { peopleCount });
  // `/team` visibility mirrors the server role model (worker hidden, manager =
  // own department, administrator = all). UX gate only — see pages/teamScope.ts.
  // In Supabase mode (snapshot ready) the effective cloud role drives it;
  // otherwise the local role (loading/error/local mode).
  const teamRole = effectiveAccessRole(currentUser, org.state, { mode: auth.mode });
  const teamUser = currentUser && teamRole ? { ...currentUser, accessRole: teamRole } : currentUser;
  const canTeam = canViewTeam(teamUser);
  // Kolejność menu (device-local) PO bramkach uprawnień — jedno źródło dla
  // sidebara (desktop) i arkusza „Więcej” (telefon).
  const navPaths = orderNavPaths(
    NAV_ITEMS.map(([to]) => to),
    navOrder,
  ).filter((to) => (to !== '/admin' || canAdmin) && (to !== '/team' || canTeam));
  /** Która zakładka dolnego paska ma stan aktywny (`null` = np. „Więcej”). */
  const activeTab = activeTabPath(location.pathname);
  // Session gate: with people present and nobody resolving to a current user,
  // only the login screen renders (no sidebar, no routes). Zero people = setup
  // mode (no lockout — mirrors the admin gate). `currentUserId` persists, so a
  // logged-in session survives reload BY DESIGN; real sessions/tokens land with
  // the API. A deleted current user falls back here (DELETE_PERSON clears it).
  const needsLogin = state.people.length > 0 && !currentUser;

  // Logout: in Supabase mode end the real Auth session first (its SIGNED_OUT
  // event returns us to the login screen), then clear the local acting identity.
  // In local mode this is just the existing LOGOUT dispatch. These are the same
  // client-side gates as before — UX/data-integrity only, never a security
  // boundary (localStorage is client-mutable; authorization lives server-side).
  const handleLogout = useCallback(async () => {
    if (auth.mode === 'supabase') {
      await auth.signOut();
    }
    dispatch({ type: 'LOGOUT' });
  }, [auth, dispatch]);

  // Reload the saved menu order whenever the Ustawienia editor changes it.
  useEffect(() => {
    const reload = () => setNavOrder(loadUiPrefs().navOrder);
    window.addEventListener('n2hub:nav-order-changed', reload);
    return () => window.removeEventListener('n2hub:nav-order-changed', reload);
  }, []);

  // Arkusz „Więcej” zamyka się po zmianie trasy (pozycja w nim nawiguje).
  useEffect(() => {
    setMoreOpen(false);
  }, [location.pathname]);

  // Escape, klik poza i powrót fokusa na przycisk „Więcej” bierzemy ze WSPÓLNEJ
  // powłoki nakładek — w wariancie NIEPOZYCJONOWANYM (bez `getAnchorRect`, jak
  // arkusz filtrów na telefonie): arkusz kotwiczy CSS przy dolnej krawędzi, więc
  // mierzenie popovera byłoby tu tylko szumem.
  const closeMore = useCallback(() => setMoreOpen(false), []);
  useOverlay({
    open: moreOpen,
    onClose: closeMore,
    overlayRef: moreSheetRef,
    triggerRef: moreBtnRef,
    menuKeyboard: true,
  });

  // Supabase mode: a real Supabase Auth session gates the ENTIRE shell. Nothing
  // below renders without a valid session AND a matched local profile. This is a
  // UX/data-integrity gate only — never a security boundary.
  if (auth.mode === 'supabase') {
    if (auth.state.status === 'restoring') return <AuthLoading />;
    if (auth.state.status === 'signedOut') return <SupabaseLoginPage />;
    // Forced first-password change gates the whole shell BEFORE profile matching,
    // so even an account without a local profile must set its password first.
    // `null` = flag still loading; `true` = must change. This is a UX/data-
    // integrity gate (owner can clear their own server flag via API), not a
    // security boundary. Loading fail-opens to `false` in the provider.
    if (auth.mustChangePassword === null) return <AuthLoading />;
    if (auth.mustChangePassword === true) {
      return <ForcedPasswordChange onSignOut={() => void handleLogout()} />;
    }
    // Signed in: associate by identity (email) only. Role/department always come
    // from the local Person record — never from user_metadata/JWT claims.
    const email = auth.state.session?.user?.email ?? '';
    const person = findPersonByEmail(state.people, email);
    if (!person) {
      // Snapshot w drodze albo własny profil chmury istnieje → auto-provisioning
      // (efekt wyżej) zaraz utworzy lokalny wiersz; nie migamy ekranem blokady.
      const orgLoading = orgState.status === 'idle' || orgState.status === 'loading';
      const willProvision = orgState.status === 'ready' && orgState.snapshot.profile !== null;
      if (orgLoading || willProvision) return <AuthLoading />;
      return <AuthBlocked email={email.trim()} onSignOut={() => void handleLogout()} />;
    }
    // Matched, but SET_CURRENT_USER may not have synced yet — never flash the
    // shell before the acting identity resolves to the matched person.
    if (state.currentUserId !== person.id) return <AuthLoading />;
  }

  if (needsLogin) {
    return <LoginPage />;
  }

  return (
    <div className={collapsed ? 'app-shell sidebar-collapsed' : 'app-shell'}>
      {/* Telefon: górny pasek niesie TYTUŁ TRASY (szuflada i hamburger już nie
          istnieją) i JEDNĄ akcję kontekstową — wyszukiwarkę. Powyżej 760 px nie
          renderuje się wcale; dotąd był tylko ukrywany `display: none`. */}
      {mobileNav && (
        <header className="app-topbar">
          <h2 className="app-topbar-title">{topBarTitle(location.pathname, NAV_LABELS)}</h2>
          {/* JEDYNY montaż `GlobalSearch` na telefonie — dwa egzemplarze to dwa
              nasłuchy Ctrl+K, które przełączałyby paletę tam i z powrotem. */}
          <GlobalSearch />
        </header>
      )}

      {/* Sidebar jest teraz WYŁĄCZNIE desktopowy: poniżej 760 px nawigację
          niesie dolny pasek, więc szuflada, jej scrim i pułapka Tab zniknęły
          razem ze stanem `menuOpen`. `id` zostaje jako stabilny uchwyt paska
          bocznego (czyta go też przeglądarkowy check klawiatury). */}
      {!mobileNav && (
      <aside id="app-drawer" className="app-sidebar">
        <div className="app-brand-row">
          <div className="app-brand">
            <span className="app-brand-mark" aria-hidden />
            <span className="app-brand-name">N2Hub</span>
          </div>
          <Tooltip text={collapsed ? 'Rozwiń menu' : 'Zwiń menu'}>
            <button
              type="button"
              className="sidebar-toggle"
              aria-label={collapsed ? 'Rozwiń menu' : 'Zwiń menu'}
              onClick={toggleCollapsed}
            >
              {collapsed ? (
                <ChevronsRight size={18} aria-hidden />
              ) : (
                <ChevronsLeft size={18} aria-hidden />
              )}
            </button>
          </Tooltip>
        </div>
        <GlobalSearch />
        <nav className="app-nav" data-tour="shell.nav">
          {navPaths.map((to) => {
              const item = NAV_ITEM_BY_PATH.get(to);
              if (!item) return null;
              const [, label, Icon] = item;
              // Rozwinięte menu POKAZUJE etykietę — dymek powtarzałby widoczny
              // tekst. Dymek ma sens wyłącznie w zwiniętej listwie ikon.
              const link = (
                <NavLink
                  key={to}
                  to={to}
                  className={navClass}
                  onPointerEnter={() => prefetchRoute(to)}
                  onFocus={() => prefetchRoute(to)}
                >
                  <Icon size={18} aria-hidden className="nav-icon" />
                  <span className="nav-label">{label}</span>
                </NavLink>
              );
              // Dymek jest OSOBNYM elementem listy tylko w listwie ikon — w
              // rozwiniętym menu wraca dokładnie dotychczasowe drzewo DOM.
              return collapsed ? (
                <Tooltip key={to} text={label}>
                  {link}
                </Tooltip>
              ) : (
                link
              );
            })}
          {/* Ustawienia: preferencje interfejsu (oba tryby) + zmiana hasła w
              trybie supabase. Przypięte PO liście, poza edytorem kolejności. */}
          {(() => {
            const settingsLink = (
              <NavLink
                to="/account"
                className={navClass}
                onPointerEnter={() => prefetchRoute('/account')}
                onFocus={() => prefetchRoute('/account')}
              >
                <Settings size={18} aria-hidden className="nav-icon" />
                <span className="nav-label">Ustawienia</span>
              </NavLink>
            );
            return collapsed ? <Tooltip text="Ustawienia">{settingsLink}</Tooltip> : settingsLink;
          })()}
        </nav>
        {/* S1 — stopka sidebara jest jednym blokiem przyklejonym do dołu (kryjące
            tło + gradient nad nią), żeby przewijana lista nawigacji nigdy się z
            nią nie zlewała i żeby było widać, że pod „Ustawieniami” coś jest. */}
        <div className="sidebar-footer">
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
            <div className="sidebar-user">
              {/* Collapsed avatar shortcut (CSS-shown only >1180px + collapsed):
                  links to the user's own profile (the chevron toggle is the only
                  expand control now). */}
              {currentUser && (
                <Tooltip text={`Mój profil: ${currentUser.name}`}>
                  <Link
                    to={`/people/${currentUser.id}`}
                    className="sidebar-user-collapsed"
                    aria-label={`Mój profil: ${currentUser.name}`}
                    onPointerEnter={() => prefetchRoute('/people/:id')}
                    onFocus={() => prefetchRoute('/people/:id')}
                  >
                    <Avatar person={currentUser} size={32} />
                  </Link>
                </Tooltip>
              )}
              {/* Expanded footer row: avatar → own profile + narrower logout. */}
              <div className="sidebar-user-row">
                {currentUser && (
                  <Tooltip text={`Mój profil: ${currentUser.name}`}>
                    <Link
                      to={`/people/${currentUser.id}`}
                      className="sidebar-user-avatar"
                      aria-label={`Mój profil: ${currentUser.name}`}
                      onPointerEnter={() => prefetchRoute('/people/:id')}
                      onFocus={() => prefetchRoute('/people/:id')}
                    >
                      <Avatar person={currentUser} size={32} />
                    </Link>
                  </Tooltip>
                )}
                {/* Everyone can log out (returns to the login screen). */}
                <button
                  type="button"
                  className="btn ghost logout-btn"
                  onClick={() => void handleLogout()}
                >
                  Wyloguj
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>
      )}

      <main className="app-main" data-tour="shell.main">
        {/* Trwałe regiony ogłoszeń (polite + assertive) — montowane PRZED
            banerami, żeby istniały w DOM zanim pojawi się pierwszy komunikat.
            Ekran logowania jest poza tą powłoką i ma własną obsługę. */}
        <LiveRegionHost />
        {/* Persistence banner shows on every routed page (not the login screen —
            no edits happen there and a clean tab auto-refreshes silently). */}
        <PersistenceBanner />
        {/* Cloud sync status (supabase mode only; renders null in local mode). */}
        <CloudSyncBanner />
        <SampleBanner />
        <m.div
          key={location.pathname}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
        >
          {/* Granica leniwych tras stoi WEWNĄTRZ powłoki i wszystkich dostawców
              (store, sesja, dane organizacji, sync, avatary, potwierdzenia,
              MotionConfig/LazyMotion) oraz wewnątrz ErrorBoundary z `main.tsx`.
              Zawieszenie trasy wymienia więc wyłącznie treść `main` — sidebar,
              dolny pasek, banery, modale i strażnik `useBlocker` zostają
              zamontowane. */}
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<HomeRedirect />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              {/* Changelog: pełna historia wpisów z src/data/changelog.ts, dostępna dla każdej roli. */}
              <Route path="/changelog" element={<ChangelogPage />} />
              {/* „Moja praca" scalona w „Panel"; stary link/zakładka nie pęka. */}
              <Route path="/my-work" element={<Navigate to={HOME_PATH} replace />} />
              <Route path="/projects" element={<ProjectsPage />} />
              <Route path="/projects/:id" element={<ProjectDetailPage />} />
              <Route path="/clients" element={<ClientsPage />} />
              <Route path="/kanban" element={<KanbanPage />} />
              <Route path="/timeline" element={<TimelinePage />} />
              <Route path="/tasks" element={<TasksPage />} />
              {/* Tworzenie zostaje w modalu (deep-link zgodny wstecz); konkretne
                  zadanie ma PEŁNĄ stronę (IA-15). Statyczny segment `new` wygrywa
                  z `:id`, więc `id === 'new'` jest nieosiągalne. */}
              <Route path="/tasks/new" element={<NewTaskRedirect />} />
              <Route path="/tasks/:id" element={<TaskFullPage />} />
              <Route path="/calendar" element={<CalendarPage />} />
              {/* Wydarzenia: widoczne dla każdej roli (zarządzanie gated przez events.manage). */}
              <Route path="/wydarzenia" element={<EventsPage />} />
              <Route path="/people" element={<PeoplePage />} />
              <Route path="/people/:id" element={<PersonProfilePage />} />
              <Route path="/workload" element={<WorkloadPage />} />
              {/* Zgłoszenia: widoczne dla każdej roli (zakres wierszy filtruje strona). */}
              <Route path="/zgloszenia" element={<TicketsPage />} />
              <Route
                path="/admin"
                element={canAdmin ? <AdminPage /> : <Navigate to="/dashboard" replace />}
              />
              {/* Team area: role-gated (worker redirected). TeamPage also guards. */}
              <Route
                path="/team"
                element={canTeam ? <TeamPage /> : <Navigate to="/dashboard" replace />}
              />
              {/* Ustawienia: dostępne w OBU trybach (tryb lokalny widzi tylko
                  sekcję „Interfejs”). */}
              <Route path="/account" element={<AccountPage />} />
              <Route path="*" element={<HomeRedirect />} />
            </Routes>
          </Suspense>
        </m.div>
      </main>

      {/* Telefon: dolny pasek pięciu zakładek. Trzy trasy + deep-link zasobnika
          + arkusz „Więcej”. Kotwica onboardingu `shell.nav` przenosi się tu z
          hamburgera — na telefonie to JEST nawigacja aplikacji. */}
      {mobileNav && (
        <nav className="app-bottom-nav" data-tour="shell.nav">
          {BOTTOM_TABS.map(([to, label, Icon]) => {
            const active = to === activeTab;
            return (
              // Stan aktywny liczy WSPÓLNA, testowana reguła `activeTabPath`, a
              // nie `isActive` z NavLinka: dzięki temu klasa i `aria-current`
              // zawsze mówią to samo, a zakładka „Zasobnik” (deep-link do tej
              // samej trasy `/calendar`) nigdy nie zapala się razem z
              // „Kalendarzem”.
              <NavLink
                key={to}
                to={to}
                className={() => (active ? 'app-bottom-nav-item active' : 'app-bottom-nav-item')}
                aria-current={active ? 'page' : undefined}
                onPointerEnter={() => prefetchRoute(to)}
                onFocus={() => prefetchRoute(to)}
              >
                <Icon size={20} aria-hidden />
                <span className="app-bottom-nav-label">{label}</span>
              </NavLink>
            );
          })}
          {/* Zwykły `Link`, nie `NavLink`: prowadzi na `/calendar`, więc stan
              aktywny podświetlałby dwie zakładki naraz. */}
          <Link
            to={BIN_TAB_TARGET}
            className="app-bottom-nav-item"
            onPointerEnter={() => prefetchRoute('/calendar')}
            onFocus={() => prefetchRoute('/calendar')}
          >
            <Archive size={20} aria-hidden />
            <span className="app-bottom-nav-label">Zasobnik</span>
          </Link>
          <button
            type="button"
            ref={moreBtnRef}
            className={moreOpen ? 'app-bottom-nav-item active' : 'app-bottom-nav-item'}
            data-tour="shell.help"
            aria-expanded={moreOpen}
            aria-haspopup="menu"
            onClick={() => setMoreOpen((v) => !v)}
          >
            <MoreHorizontal size={20} aria-hidden />
            <span className="app-bottom-nav-label">Więcej</span>
          </button>
        </nav>
      )}

      {mobileNav && moreOpen && (
        <OverlayLayer>
          {/* Scrim nie ma własnego handlera — zamknięcie „kliknięciem poza”
              obsługuje `useOverlay` (para pointerdown+click), tak jak w każdej
              innej nakładce aplikacji. */}
          <div className="app-sheet-scrim" aria-hidden />
          <div className="app-more-sheet" role="menu" aria-label="Więcej" ref={moreSheetRef}>
            <div className="app-sheet-handle" aria-hidden />
            {moreNavPaths(navPaths).map((to) => {
              const item = NAV_ITEM_BY_PATH.get(to);
              if (!item) return null;
              const [, label, Icon] = item;
              return (
                <Link
                  key={to}
                  to={to}
                  role="menuitem"
                  className="app-more-item"
                  onPointerEnter={() => prefetchRoute(to)}
                  onFocus={() => prefetchRoute(to)}
                >
                  <Icon size={18} aria-hidden />
                  <span>{label}</span>
                </Link>
              );
            })}
            <Link
              to="/account"
              role="menuitem"
              className="app-more-item"
              onPointerEnter={() => prefetchRoute('/account')}
              onFocus={() => prefetchRoute('/account')}
            >
              <Settings size={18} aria-hidden />
              <span>Ustawienia</span>
            </Link>
            <button
              type="button"
              role="menuitem"
              className="app-more-item"
              onClick={() => {
                setMoreOpen(false);
                window.dispatchEvent(new Event('n2hub:open-tutorials'));
              }}
            >
              <CircleHelp size={18} aria-hidden />
              <span>Pomoc i samouczki</span>
            </button>
            {currentUser && (
              <Link
                to={`/people/${currentUser.id}`}
                role="menuitem"
                className="app-more-item"
                onPointerEnter={() => prefetchRoute('/people/:id')}
                onFocus={() => prefetchRoute('/people/:id')}
              >
                <Avatar person={currentUser} size={22} />
                <span>Mój profil</span>
              </Link>
            )}
            <button
              type="button"
              role="menuitem"
              className="app-more-item"
              onClick={() => {
                setMoreOpen(false);
                void handleLogout();
              }}
            >
              <span>Wyloguj</span>
            </button>
          </div>
        </OverlayLayer>
      )}

      {/* The task popout modal lives once, above every page. */}
      <TaskModal />
      {/* Ten sam wzorzec dla zgłoszeń (?zgloszenie=new | <id>). */}
      <TicketModal />
      {/* Ten sam wzorzec dla wydarzeń (?wydarzenie=new | <id>). */}
      <EventModal />
      <DirtyNavigationGuard />
      <OnboardingRoot owner={currentUser} viewer={currentUser} />
    </div>
  );
}

/**
 * Zastępnik treści trasy na czas dociągania jej chunku. Świadomie NIE wprowadza
 * nowego języka wizualnego: to ten sam pusty stan (`empty-state`/`empty-title`),
 * którego używają strony, więc nie przybywa ani jednej klasy CSS. Region
 * `role="status"` ogłasza ładowanie czytnikom ekranu.
 */
function RouteFallback() {
  return (
    <div className="empty-state" role="status">
      <p className="empty-title">Wczytywanie…</p>
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
  const confirm = useConfirm();
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

  // Same pattern as react-router's usePrompt, ale pytanie jest teraz wspólnym
  // oknem `alertdialog` (asynchronicznym). Cancel keeps the URL and the edit;
  // confirm proceeds. The setTimeout avoids racing the history revert on
  // Back/Forward pops.
  //
  // Dwie rzeczy, których nie wymagał natywny (blokujący) `confirm`:
  //  * `askingRef` — dopóki pytanie wisi, żaden ponowny render z tym samym
  //    zablokowanym stanem nie może dołożyć drugiego pytania do kolejki;
  //  * `proceed`/`reset` zdjęte z blockera PRZED `await` — rozstrzygamy DOKŁADNIE
  //    tę nawigację, o którą pytaliśmy, nawet jeśli obiekt blockera się zmienił.
  const askingRef = useRef(false);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (askingRef.current) return;
    askingRef.current = true;
    const { proceed, reset } = blocker;
    void confirm({
      title: 'Masz niezapisane zmiany.',
      description: 'Opuścić bez zapisywania?',
      confirmLabel: 'Opuść bez zapisywania',
      cancelLabel: 'Wróć do edycji',
    }).then((leave) => {
      askingRef.current = false;
      if (leave) setTimeout(proceed, 0);
      else reset();
    });
  }, [blocker, confirm]);

  return null;
}

/**
 * Landing redirect for `/` and unknown routes. „Panel" (`HOME_PATH`) is the one
 * and only home for every role now — the former per-role „Moja praca" surface
 * was merged into it (Zasobnik + Alerty are Panel tiles).
 */
function HomeRedirect() {
  return <Navigate to={HOME_PATH} replace />;
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

function navClass({ isActive }: { isActive: boolean }): string {
  return isActive ? 'app-nav-link active' : 'app-nav-link';
}
