// Dzwonek powiadomień w wierszu marki sidebara (na lewo od przycisku zwijania).
// Licznik nieprzeczytanych pochodzi z TEGO SAMEGO pochodnego feedu co kafelek
// „Powiadomienia" na Panelu i badge karty przeglądarki
// (selectors.notificationsForPerson) — trzy widoki, jedno źródło liczby.
// Klik otwiera overlay na wzór palety wyszukiwania (OverlayLayer portal +
// AnimatePresence + klasy `.gs-*`): lista WYŁĄCZNIE nieprzeczytanych wpisów.
// Klik wiersza oznacza POJEDYNCZY wpis jako przeczytany
// (MARK_NOTIFICATION_ENTRY_READ — reduktor sam odrzuca id spoza feedu) i
// otwiera cel: zadanie w modalu popout, projekt trasą.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, m } from 'motion/react';
import { useStore } from '../store/AppStore';
import { notificationsForPerson } from '../store/selectors';
import type { PersonNotification } from '../store/selectors';
import { formatTimestamp } from '../utils/dates';
import { Bell } from './icons';
import { Tooltip } from './Tooltip';
import { useOpenTask } from './TaskModal';
import { OverlayLayer, useOverlay } from './useOverlay';
import { resolveTrapAction, shouldHandleTrapKey } from './modalShell';
import { tabbableElementsIn } from './useModalShell';

/** App-level single mount (sidebar): trigger z licznikiem + overlay z listą. */
export function NotificationsBell() {
  const { state, dispatch } = useStore();
  const navigate = useNavigate();
  const { openTask } = useOpenTask();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const me = state.people.find((p) => p.id === state.currentUserId);
  // `now` wstrzykiwany jak w pozostałych konsumentach — selektor zostaje czysty.
  const feed = me ? notificationsForPerson(state, me.id, new Date().toISOString()) : [];
  const unread = feed.filter((n) => !n.read);

  const close = useCallback(() => setOpen(false), []);
  // Wspólna powłoka nakładek w wariancie NIEPOZYCJONOWANYM (bez `getAnchorRect`,
  // jak arkusz „Więcej"): Escape tylko dla wierzchniej warstwy, zamknięcie
  // klikiem poza panelem (scrim/viewport) i powrót fokusa na dzwonek.
  useOverlay({ open, onClose: close, overlayRef: panelRef, triggerRef });

  // Panel nie ma pola tekstowego (inaczej niż paleta), więc fokus po otwarciu
  // bierze sam kontener dialogu — Escape i Tab działają od razu z klawiatury.
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  // Pułapka Tab dla dialogu aria-modal (useOverlay daje Escape/klik-poza/powrót
  // fokusa, ale nie trap) — wspólne helpery modala, wzorzec jak FilterPanel:
  // Tab/Shift+Tab krąży po wierszach panelu zamiast wypadać w tło.
  const onPanelKeyDown = (e: React.KeyboardEvent) => {
    if (!shouldHandleTrapKey(e)) return;
    const panel = panelRef.current;
    if (!panel) return;
    const elements = tabbableElementsIn(panel);
    const active = document.activeElement;
    const currentIndex = active instanceof HTMLElement ? elements.indexOf(active) : -1;
    const action = resolveTrapAction(currentIndex, elements.length, e.shiftKey);
    if (action.type === 'none') return;
    e.preventDefault();
    if (action.type === 'card') panel.focus();
    else elements[action.index].focus();
  };

  const openNotification = (n: PersonNotification): void => {
    dispatch({ type: 'MARK_NOTIFICATION_ENTRY_READ', entryId: n.id });
    close();
    if (n.taskId !== '') openTask(n.taskId);
    else navigate(`/projects/${n.entityId}`);
  };

  if (!me) return null;

  const count = unread.length;
  const label = count > 0 ? `Powiadomienia (${count} nieprzeczytanych)` : 'Powiadomienia';

  return (
    <>
      <Tooltip text="Powiadomienia">
        <button
          type="button"
          ref={triggerRef}
          className="bell-trigger"
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <Bell size={18} aria-hidden />
          {count > 0 && (
            <span className="bell-badge" aria-hidden="true">
              {count > 99 ? '99+' : count}
            </span>
          )}
        </button>
      </Tooltip>
      {/* Portal PRZED AnimatePresence (kontrakt `OverlayLayer`): węzeł portalu
          żyje po zamknięciu, więc animacja wyjścia dogrywa się do końca. */}
      <OverlayLayer>
        <AnimatePresence>
          {open && (
            <div key="notifications-overlay">
              <m.div
                className="gs-scrim"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
              />
              <div className="gs-viewport">
                <m.div
                  ref={panelRef}
                  className="gs-panel notif-panel"
                  role="dialog"
                  aria-modal="true"
                  aria-label="Powiadomienia"
                  tabIndex={-1}
                  onKeyDown={onPanelKeyDown}
                  initial={{ opacity: 0, scale: 0.97, y: 8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97, y: 8 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                >
                  <div className="notif-head">
                    <Bell size={18} aria-hidden className="gs-input-icon" />
                    <h2 className="notif-head-title">Powiadomienia</h2>
                    {count > 0 && (
                      <span className="dash-badge" aria-label={`${count} nieprzeczytanych`}>
                        {count}
                      </span>
                    )}
                  </div>
                  {count === 0 ? (
                    <p className="gs-hint">Brak nowych powiadomień.</p>
                  ) : (
                    <div className="gs-results">
                      {unread.map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          className="gs-row notif-row"
                          onClick={() => openNotification(n)}
                        >
                          <span className="dash-unread-dot" aria-hidden="true" />
                          <span className="notif-row-title">{n.title}</span>
                          <span className="gs-row-meta">{formatTimestamp(n.createdAt)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </m.div>
              </div>
            </div>
          )}
        </AnimatePresence>
      </OverlayLayer>
    </>
  );
}
