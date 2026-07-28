// Jedno okno potwierdzenia dla całej aplikacji — zamiennik `window.confirm`,
// który (a) jest polski i stylowany jak reszta UI, (b) ma dostępność
// `role="alertdialog"` z pułapką fokusa, (c) potrafi pokazać SKUTKI operacji.
//
// Cienka warstwa React/DOM: cała decyzyjność siedzi w czystym `confirmDialog.ts`
// (kolejka żądań, blokada `requireAck`, treść skutków), a fokus/Escape/scroll
// bierze wspólna powłoka `useModalShell`. Dostawca montuje się RAZ w `main.tsx`
// PONAD wszystkim, co go używa, i renderuje DOKŁADNIE jeden dialog naraz.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  DEFAULT_ACK_LABEL,
  DEFAULT_CANCEL_LABEL,
  DEFAULT_CONFIRM_LABEL,
  activeConfirm,
  confirmIsBlocked,
  drainConfirms,
  emptyConfirmQueue,
  enqueueConfirm,
  resolveConfirm,
  type ConfirmEntry,
  type ConfirmOptions,
  type ConfirmQueueState,
} from './confirmDialog';
import { useModalShell } from './useModalShell';

export type { ConfirmOptions, ConfirmTone } from './confirmDialog';

/** `await confirm({...})` → `true` (potwierdzone) albo `false` (anulowane). */
export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * Hook konsumenta. Rzuca poza dostawcą — dokładnie jak `useStore`; dostawca
 * stoi w `main.tsx` nad całym drzewem, więc brak kontekstu to błąd montażu,
 * a nie sytuacja do cichego obejścia.
 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (ctx === null) throw new Error('useConfirm must be used within ConfirmProvider');
  return ctx;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  // Kolejka żyje w REFIE, bo rozstrzygnięcie obietnicy jest efektem ubocznym i
  // nie może siedzieć w funkcji aktualizującej stan (StrictMode woła ją dwa
  // razy). Render wymusza osobny licznik — ref jest zawsze aktualny, także dla
  // handlera wywołanego w tym samym takcie co żądanie.
  const queueRef = useRef<ConfirmQueueState>(emptyConfirmQueue());
  const [, forceRender] = useReducer((n: number) => n + 1, 0);

  const confirm = useCallback<ConfirmFn>(
    (options) =>
      new Promise<boolean>((resolve) => {
        queueRef.current = enqueueConfirm(queueRef.current, options, resolve);
        forceRender();
      }),
    [],
  );

  const settle = useCallback((id: number, result: boolean) => {
    const { state, resolved } = resolveConfirm(queueRef.current, id);
    // Nieznane `id` = już rozstrzygnięte (podwójny klik, spóźniony handler).
    if (resolved === null) return;
    queueRef.current = state;
    forceRender();
    resolved.resolve(result);
  }, []);

  // Odmontowanie dostawcy nie może zostawić wiszącego `await confirm(...)`.
  useEffect(
    () => () => {
      const { state, drained } = drainConfirms(queueRef.current);
      queueRef.current = state;
      drained.forEach((pending) => pending.resolve(false));
    },
    [],
  );

  const entry = activeConfirm(queueRef.current);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {entry !== null && <ConfirmDialog key={entry.id} entry={entry} onSettle={settle} />}
    </ConfirmContext.Provider>
  );
}

interface DialogProps {
  entry: ConfirmEntry;
  onSettle: (id: number, result: boolean) => void;
}

/**
 * Karta dialogu. Klucz `entry.id` sprawia, że kolejne pytanie z kolejki dostaje
 * ŚWIEŻY komponent: checkbox `requireAck` się zeruje, a powłoka na nowo wchodzi
 * fokusem w „Anuluj”. Świadomie BEZ `AnimatePresence` — natychmiastowe
 * odmontowanie oddaje fokus elementowi sprzed otwarcia w tym samym takcie,
 * więc przy dialogu nad modalem fokus wraca DO modala, a nie na stronę pod nim.
 */
function ConfirmDialog({ entry, onSettle }: DialogProps) {
  const { id, options } = entry;
  const [acknowledged, setAcknowledged] = useState(false);
  const titleId = useId();
  const describeId = useId();

  const cancel = useCallback(() => onSettle(id, false), [id, onSettle]);
  const blocked = confirmIsBlocked(options, acknowledged);
  const accept = useCallback(() => {
    if (confirmIsBlocked(options, acknowledged)) return;
    onSettle(id, true);
  }, [id, onSettle, options, acknowledged]);

  const description = options.description ?? '';
  const consequences = options.consequences ?? '';
  const hasBody = description !== '' || consequences !== '';

  // `stacked` — dialog potrafi stanąć NAD otwartym TaskModalem/EventModalem.
  const { cardRef, cardProps, viewportProps } = useModalShell({
    onRequestClose: cancel,
    labelledBy: titleId,
    describedBy: hasBody ? describeId : undefined,
    role: 'alertdialog',
    stacked: true,
  });

  const danger = options.tone === 'danger';

  return (
    <>
      <div className="task-modal-scrim confirm-scrim" />
      <div className="task-modal-viewport confirm-viewport" {...viewportProps}>
        {/* Świadomie ZWYKŁY `div`, nie `m.div`: dostawca stoi PONAD
            `MotionConfig reducedMotion="user"` i `LazyMotion` (opakowują tylko
            router), więc wejście karty robi animacja CSS — globalna reguła
            `prefers-reduced-motion` w `styles.css` wycisza ją bez wyjątków. */}
        <div ref={cardRef} className="task-modal-card confirm-card" {...cardProps}>
          <div className="confirm-body">
            <h1 className="task-modal-title confirm-title" id={titleId}>
              {options.title}
            </h1>
            {hasBody && (
              <div className="confirm-text" id={describeId}>
                {description !== '' && <p className="confirm-description">{description}</p>}
                {consequences !== '' && (
                  <p className={danger ? 'confirm-consequences danger' : 'confirm-consequences'}>
                    {consequences}
                  </p>
                )}
              </div>
            )}
            {options.requireAck === true && (
              <label className="confirm-ack">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />
                <span>{options.ackLabel ?? DEFAULT_ACK_LABEL}</span>
              </label>
            )}
          </div>
          <div className="confirm-actions">
            {/* „Anuluj” jest PIERWSZY w DOM: dostaje fokus startowy przez
                `data-autofocus`, a Escape i tło robią to samo co on. */}
            <button type="button" className="btn ghost" data-autofocus onClick={cancel}>
              {options.cancelLabel ?? DEFAULT_CANCEL_LABEL}
            </button>
            <button
              type="button"
              className={danger ? 'btn danger' : 'btn primary'}
              onClick={accept}
              disabled={blocked}
            >
              {options.confirmLabel ?? DEFAULT_CONFIRM_LABEL}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
