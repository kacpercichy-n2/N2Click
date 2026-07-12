import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import { AppStoreProvider } from './store/AppStore';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <AppStoreProvider>
          {/* Respect OS "reduce motion" for every animation in the app. */}
          <MotionConfig reducedMotion="user">
            <App />
          </MotionConfig>
        </AppStoreProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
