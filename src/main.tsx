import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import { AppStoreProvider } from './store/AppStore';
import { SessionProvider } from './auth/SessionProvider';
import { OrgDataProvider } from './supabase/OrgDataProvider';
import { CloudSyncProvider } from './supabase/CloudSyncProvider';
import { AvatarProvider } from './supabase/AvatarProvider';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

// Data router (a single splat route hosting the whole shell; App keeps its
// descendant <Routes>). Required by the dirty-navigation guard in App —
// `useBlocker` can cancel Back/Forward pops, which plain <BrowserRouter>
// cannot do.
const router = createBrowserRouter(
  [
    {
      path: '*',
      // Data routers catch route-render errors before they can reach a boundary
      // wrapped around <RouterProvider>. Keep a boundary inside the route as
      // well so page crashes use N2Hub's export/reset recovery screen instead
      // of React Router's generic "Unexpected Application Error" page.
      element: (
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      ),
    },
  ],
  { future: { v7_relativeSplatPath: true } },
);

createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      <AppStoreProvider>
        {/* SessionProvider decides local vs Supabase auth mode once at startup
            and (in Supabase mode) gates the shell behind a real Auth session.
            It sits inside the store (needs people/dispatch) and outside the
            router (needs no router hooks). */}
        <SessionProvider>
          {/* Reads the RLS-scoped org snapshot in Supabase mode (idle in local
              mode — no client is created). Sits inside SessionProvider (needs the
              auth mode + session) and outside the router (needs no router hooks). */}
          <OrgDataProvider>
            {/* Mirrors the seven planner groups to Supabase (writes) and
                hydrates them on sign-in (one MERGE_CLOUD_ENTITIES). Sits inside
                OrgDataProvider (needs the org snapshot) and outside the router
                (needs no router hooks). Idle in local mode — no client created. */}
            <CloudSyncProvider>
              {/* Wspólne źródło zdjęć profilowych dla każdego <Avatar> w
                  aplikacji. Siedzi wewnątrz OrgDataProvider (bierze profile ze
                  snapshotu organizacji) i poza routerem (nie potrzebuje jego
                  hooków). W trybie lokalnym bezczynny — katalog pusty. */}
              <AvatarProvider>
                {/* Respect OS "reduce motion" for every animation in the app. */}
                <MotionConfig reducedMotion="user">
                  <RouterProvider router={router} future={{ v7_startTransition: true }} />
                </MotionConfig>
              </AvatarProvider>
            </CloudSyncProvider>
          </OrgDataProvider>
        </SessionProvider>
      </AppStoreProvider>
    </ErrorBoundary>
  </StrictMode>,
);
