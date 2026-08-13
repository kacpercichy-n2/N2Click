import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { LazyMotion, MotionConfig, domAnimation } from 'motion/react';
import { AppStoreProvider } from './store/AppStore';
import { SessionProvider } from './auth/SessionProvider';
import { OrgDataProvider } from './supabase/OrgDataProvider';
import { CloudSyncProvider } from './supabase/CloudSyncProvider';
import { AvatarUrlsProvider } from './supabase/AvatarUrlsProvider';
import { ChatProvider } from './chat/ChatProvider';
import { ChatDock } from './chat/ui/ChatDock';
import { App } from './App';
import { ConfirmProvider } from './components/ConfirmProvider';
import { ErrorBoundary } from './components/ErrorBoundary';
import { installNumberInputWheelGuard } from './utils/numberInputWheel';
import './styles.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

// Scroll nad polem liczbowym nie może zmieniać jego wartości (zgłoszenie:
// przypadkowe zmiany planowanych godzin). Jedna globalna blokada dla całej
// aplikacji.
installNumberInputWheelGuard();

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
      {/* Jedno okno potwierdzenia (`role="alertdialog"`) dla całej aplikacji,
          zamiast `window.confirm`. Stoi NAJWYŻEJ, bo pytają z niego zarówno
          strony i modale pod routerem, jak i banery spoza niego; niczego nie
          czyta (ani store'a, ani routera), więc nie ma powodu schodzić niżej.
          ErrorBoundary zostaje NAD nim — ekran awarii nie może zależeć od
          drzewa, które właśnie się wysypało (dlatego jako jedyny trzyma
          natywny `window.confirm`). */}
      <ConfirmProvider>
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
                {/* Podpisane URL-e zdjęć profilowych dla całego UI (tryb
                    supabase); w trybie lokalnym mapy są puste i nic się nie
                    zmienia. Wewnątrz OrgDataProvider (czyta snapshot). */}
                <AvatarUrlsProvider>
                  {/* Czat (rozmowy, obecność, Realtime). Wewnątrz
                      AvatarUrlsProvider, bo bąbelki i dymki biorą zdjęcia z jego
                      map, a nazwiska ze snapshotu organizacji wyżej. W trybie
                      lokalnym provider nie tworzy ANI klienta Supabase, ANI
                      kanału, a `ChatDock` renderuje `null`. */}
                  <ChatProvider>
                    {/* Respect OS "reduce motion" for every animation in the app. */}
                    <MotionConfig reducedMotion="user">
                      {/* JEDYNE miejsce, w którym ładujemy silnik animacji. Cała
                          aplikacja renderuje `m.*` (nigdy `motion.*`), więc do
                          drzewa wchodzi lekki `domAnimation` (animacje, warianty,
                          wyjścia `AnimatePresence`, gesty hover/tap/focus) zamiast
                          pełnego pakietu z projekcją layoutu i przeciąganiem.
                          `strict` pilnuje tej umowy: każde `motion.*` rzuci błąd
                          zamiast po cichu dociągnąć pełny silnik. */}
                      <LazyMotion features={domAnimation} strict>
                        <RouterProvider router={router} future={{ v7_startTransition: true }} />
                        {/* Dok czatu jest `position: fixed` i nie czyta tras, więc
                            stoi OBOK routera, a nie w powłoce strony — żadna trasa
                            nie może go przypadkiem odmontować. */}
                        <ChatDock />
                      </LazyMotion>
                    </MotionConfig>
                  </ChatProvider>
                </AvatarUrlsProvider>
              </CloudSyncProvider>
            </OrgDataProvider>
          </SessionProvider>
        </AppStoreProvider>
      </ConfirmProvider>
    </ErrorBoundary>
  </StrictMode>,
);
