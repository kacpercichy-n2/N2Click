import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import { AppStoreProvider } from './store/AppStore';
import { SessionProvider } from './auth/SessionProvider';
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
          {/* Respect OS "reduce motion" for every animation in the app. */}
          <MotionConfig reducedMotion="user">
            <RouterProvider router={router} future={{ v7_startTransition: true }} />
          </MotionConfig>
        </SessionProvider>
      </AppStoreProvider>
    </ErrorBoundary>
  </StrictMode>,
);
