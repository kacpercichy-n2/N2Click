import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AppStoreProvider } from './store/AppStore';
import { App } from './App';
import './styles.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

createRoot(rootEl).render(
  <StrictMode>
    <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <AppStoreProvider>
        <App />
      </AppStoreProvider>
    </BrowserRouter>
  </StrictMode>,
);
