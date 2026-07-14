import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import { AppStoreProvider } from './store/AppStore';
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
  [{ path: '*', element: <App /> }],
  { future: { v7_relativeSplatPath: true } },
);

createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      <AppStoreProvider>
        {/* Respect OS "reduce motion" for every animation in the app. */}
        <MotionConfig reducedMotion="user">
          <RouterProvider router={router} future={{ v7_startTransition: true }} />
        </MotionConfig>
      </AppStoreProvider>
    </ErrorBoundary>
  </StrictMode>,
);
