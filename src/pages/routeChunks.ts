// Leniwe trasy powłoki. JEDNA mapa `ścieżka → () => import(...)` jest źródłem
// dla obu rzeczy naraz: komponentów `React.lazy` renderowanych przez `<Routes>`
// w `App.tsx` oraz podgrzewania chunku na `onPointerEnter`/`onFocus` pozycji
// nawigacji. Dzięki wspólnemu thunkowi hover ładuje DOKŁADNIE ten moduł, który
// za chwilę wyrenderuje trasa — bez drugiego, rozjeżdżającego się spisu.
//
// `LoginPage` i ekrany logowania (`auth/AuthScreens`) zostają ZWYKŁYMI
// importami: renderują się PRZED powłoką i przed granicą `<Suspense>`, więc
// leniwe ładowanie migałoby na nich pustym zastępnikiem przy pierwszym malowaniu.
import { lazy, type ComponentType } from 'react';

type RouteLoader = () => Promise<{ default: ComponentType }>;

/**
 * Ścieżka trasy → import jej modułu. Klucze parametryczne (`/tasks/:id`) są
 * wzorcami tras, nie adresami — podgrzewanie wołamy z nich jawnie.
 */
const ROUTE_LOADERS = {
  '/dashboard': () => import('./DashboardPage').then((m) => ({ default: m.DashboardPage })),
  '/changelog': () => import('./ChangelogPage').then((m) => ({ default: m.ChangelogPage })),
  '/projects': () => import('./ProjectsPage').then((m) => ({ default: m.ProjectsPage })),
  '/projects/:id': () =>
    import('./ProjectDetailPage').then((m) => ({ default: m.ProjectDetailPage })),
  '/clients': () => import('./ClientsPage').then((m) => ({ default: m.ClientsPage })),
  '/kanban': () => import('./KanbanPage').then((m) => ({ default: m.KanbanPage })),
  '/timeline': () => import('./TimelinePage').then((m) => ({ default: m.TimelinePage })),
  '/tasks': () => import('./TasksPage').then((m) => ({ default: m.TasksPage })),
  '/tasks/:id': () => import('./TaskFullPage').then((m) => ({ default: m.TaskFullPage })),
  '/calendar': () => import('./CalendarPage').then((m) => ({ default: m.CalendarPage })),
  '/wydarzenia': () => import('./EventsPage').then((m) => ({ default: m.EventsPage })),
  '/content-plan': () =>
    import('./ContentPlanPage').then((m) => ({ default: m.ContentPlanPage })),
  '/people': () => import('./PeoplePage').then((m) => ({ default: m.PeoplePage })),
  '/people/:id': () =>
    import('./PersonProfilePage').then((m) => ({ default: m.PersonProfilePage })),
  '/workload': () => import('./WorkloadPage').then((m) => ({ default: m.WorkloadPage })),
  '/zgloszenia': () => import('./TicketsPage').then((m) => ({ default: m.TicketsPage })),
  '/admin': () => import('./AdminPage').then((m) => ({ default: m.AdminPage })),
  '/team': () => import('./TeamPage').then((m) => ({ default: m.TeamPage })),
  '/account': () => import('./AccountPage').then((m) => ({ default: m.AccountPage })),
  '/jedzenie': () => import('./FoodPage').then((m) => ({ default: m.FoodPage })),
} satisfies Record<string, RouteLoader>;

/** Klucze mapy — jedyne wartości, które przyjmuje `prefetchRoute`. */
export type RouteChunkPath = keyof typeof ROUTE_LOADERS;

/**
 * Podgrzanie chunku trasy (hover/fokus pozycji nawigacji). Idempotentne bez
 * własnego cache — rejestr modułów ESM zwraca tę samą obietnicę dla drugiego
 * `import()`. Błąd sieci jest połykany: to tylko optymalizacja, prawdziwe
 * ładowanie i tak zrobi `React.lazy` przy nawigacji.
 */
export function prefetchRoute(path: string): void {
  const load = (ROUTE_LOADERS as Record<string, RouteLoader | undefined>)[path];
  if (load) void load().catch(() => {});
}

export const DashboardPage = lazy(ROUTE_LOADERS['/dashboard']);
export const ChangelogPage = lazy(ROUTE_LOADERS['/changelog']);
export const ProjectsPage = lazy(ROUTE_LOADERS['/projects']);
export const ProjectDetailPage = lazy(ROUTE_LOADERS['/projects/:id']);
export const ClientsPage = lazy(ROUTE_LOADERS['/clients']);
export const KanbanPage = lazy(ROUTE_LOADERS['/kanban']);
export const TimelinePage = lazy(ROUTE_LOADERS['/timeline']);
export const TasksPage = lazy(ROUTE_LOADERS['/tasks']);
export const TaskFullPage = lazy(ROUTE_LOADERS['/tasks/:id']);
export const CalendarPage = lazy(ROUTE_LOADERS['/calendar']);
export const EventsPage = lazy(ROUTE_LOADERS['/wydarzenia']);
export const ContentPlanPage = lazy(ROUTE_LOADERS['/content-plan']);
export const PeoplePage = lazy(ROUTE_LOADERS['/people']);
export const PersonProfilePage = lazy(ROUTE_LOADERS['/people/:id']);
export const WorkloadPage = lazy(ROUTE_LOADERS['/workload']);
export const TicketsPage = lazy(ROUTE_LOADERS['/zgloszenia']);
export const AdminPage = lazy(ROUTE_LOADERS['/admin']);
export const TeamPage = lazy(ROUTE_LOADERS['/team']);
export const AccountPage = lazy(ROUTE_LOADERS['/account']);
export const FoodPage = lazy(ROUTE_LOADERS['/jedzenie']);
