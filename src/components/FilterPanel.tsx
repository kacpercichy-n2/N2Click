// Shared filter UI for the Projects, Tasks, Kanban and Workload pages.
// An e-commerce-style "Filtry" button with an active-count badge opens a
// popover of single-select option groups (radio) plus optional date inputs;
// applied filters render as removable chips with a clear-all in the footer.
//
// The component is a dumb, controlled presentation layer: every page keeps its
// own filter useState and builds the `groups`/`chips`/`dates` props from it.
// Choosing an option applies live (no "Zastosuj"). Zamykanie żyje we WSPÓLNEJ
// powłoce `useOverlay` (ta sama co menu kontekstowe WeekView): stos warstw dla
// Escape (zamyka tylko wierzchnią warstwę, więc modal pod spodem zostaje),
// para `pointerdown`+`click` na zewnątrz (ciągnięcie paska przewijania nie
// zamyka) i klasyfikacja zdarzeń przycisku „Filtry”, żeby jego własny toggle
// nie ścigał się z zamknięciem.
//
// Panel renderuje się w PORTALU (`OverlayLayer`) w dwóch wariantach:
//   • desktop — mierzony popover przy przycisku (`getAnchorRect`, flip + shift),
//     zamykany także wtedy, gdy kotwica wyjedzie poza widok
//     (`closeOnAnchorOutOfView`); przycięcie przez `overflow` rodzica przestaje
//     istnieć, a `--anchor-width` daje mu minimalną szerokość przycisku,
//   • telefon (≤760 px) — arkusz od dołu ze scrimem, blokadą scrolla tła i
//     lepką stopką „Wyczyść · Pokaż N”; tu NIE ma `getAnchorRect`, bo arkusz
//     kotwiczy CSS przy dolnej krawędzi (jak arkusz „Więcej” w `App.tsx`).
// W obu wariantach fokus wchodzi do panelu i KRĄŻY w nim (portal na końcu
// `<body>` wyprowadziłby Tab poza treść strony) — decyzje bierze czysty
// `modalShell.ts`, a powrót fokusa na przycisk robi `useOverlay`.
// `menuKeyboard` zostaje wyłączone (to dialog z radiami, nie lista `role="menu"`).
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { MOBILE_NAV_QUERY, useMediaQuery } from '../utils/useMediaQuery';
import { Filter, X } from './icons';
import { resolveTrapAction, shouldHandleTrapKey } from './modalShell';
import { focusInitialIn, tabbableElementsIn, useBodyScrollLock } from './useModalShell';
import { OverlayLayer, useOverlay } from './useOverlay';

export interface FilterGroup {
  key: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
}

export interface FilterChip {
  key: string;
  label: string;
  onRemove: () => void;
}

export function FilterPanel({
  groups,
  dates,
  extra,
  activeCount,
  onClearAll,
  chips,
  resultCount,
}: {
  groups: FilterGroup[];
  dates?: {
    from: string;
    to: string;
    onFrom: (v: string) => void;
    onTo: (v: string) => void;
  };
  /** Optional additional controls rendered inside the popover (e.g. a
   *  multi-select "Osoby" fieldset). Purely additive; other consumers omit it. */
  extra?: ReactNode;
  activeCount: number;
  onClearAll: () => void;
  chips: FilterChip[];
  /** Liczba wyników po filtrach — pokazuje ją WYŁĄCZNIE lepka stopka arkusza
   *  („Pokaż 12”). Strony bez licznika pomijają prop: stopka mówi wtedy
   *  „Pokaż wyniki”. */
  resultCount?: number;
}) {
  const [open, setOpen] = useState(false);
  // Ten sam breakpoint, co powłoka telefonu i widok dnia kalendarza.
  const sheet = useMediaQuery(MOBILE_NAV_QUERY);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => setOpen(false), []);

  const getAnchorRect = useCallback(() => {
    const button = btnRef.current;
    if (button === null) return null;
    const rect = button.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }, []);

  // Arkusz jest NIEPOZYCJONOWANY (bez `getAnchorRect`) — pomiar popovera byłby
  // tam tylko szumem, bo o miejscu decyduje `inset: auto 0 0 0` w CSS.
  const overlay = useOverlay({
    open,
    onClose: close,
    overlayRef: popRef,
    triggerRef: btnRef,
    ...(sheet
      ? {}
      : {
          getAnchorRect,
          placement: 'bottom-start' as const,
          offset: 6,
          closeOnAnchorOutOfView: true,
        }),
  });

  // Blokada scrolla tła TYLKO w arkuszu, na wspólnym liczniku modali — po
  // zamknięciu strona wraca na swoją pozycję przewijania.
  useBodyScrollLock(open && sheet);

  // Wejście fokusa w panel po otwarciu (pierwsza kontrolka, a przy panelu bez
  // kontrolek — sam kontener z `tabIndex={-1}`).
  useEffect(() => {
    if (!open) return;
    const panel = popRef.current;
    if (panel === null) return;
    focusInitialIn(panel);
  }, [open]);

  // Pułapka Tab. Bez niej fokus z portalu na końcu `<body>` uciekłby na pasek
  // przeglądarki zamiast wrócić na początek panelu.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!shouldHandleTrapKey(event)) return;
      const panel = popRef.current;
      if (panel === null) return;
      const elements = tabbableElementsIn(panel);
      const active = document.activeElement;
      const currentIndex = active instanceof HTMLElement ? elements.indexOf(active) : -1;
      const action = resolveTrapAction(currentIndex, elements.length, event.shiftKey);
      if (action.type === 'none') return;
      event.preventDefault();
      if (action.type === 'card') panel.focus();
      else elements[action.index].focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  // Treść jest DOKŁADNIE ta sama w obu wariantach — różni je tylko obudowa
  // (klasa, scrim, uchwyt) i stopka.
  const panel = (
    <div
      className={sheet ? 'filter-sheet' : 'filter-popover'}
      role="dialog"
      // `aria-modal` tylko w arkuszu: tam tło jest naprawdę zasłonięte scrimem
      // i zablokowane, popover na desktopie zostawia stronę do czytania.
      aria-modal={sheet ? true : undefined}
      aria-label="Filtry"
      ref={popRef}
      tabIndex={-1}
      style={overlay.style}
    >
      {sheet && <div className="app-sheet-handle" aria-hidden />}
      {groups.map((g) => (
        <fieldset key={g.key} className="filter-group">
          <legend>{g.label}</legend>
          <div className="filter-options">
            {g.options.map((o) => (
              <label key={o.value || '__all'} className="filter-option">
                <input
                  type="radio"
                  name={`filter-${g.key}`}
                  checked={g.value === o.value}
                  onChange={() => g.onChange(o.value)}
                />
                <span>{o.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      {dates && (
        <fieldset className="filter-group">
          <legend>Okres</legend>
          <div className="filter-dates">
            <label className="filter-date">
              <span>Od</span>
              <input type="date" value={dates.from} onChange={(e) => dates.onFrom(e.target.value)} />
            </label>
            <label className="filter-date">
              <span>Do</span>
              <input type="date" value={dates.to} onChange={(e) => dates.onTo(e.target.value)} />
            </label>
          </div>
        </fieldset>
      )}
      {extra}
      <div className="filter-popover-foot">
        <button
          type="button"
          className={sheet ? 'btn ghost' : 'btn ghost small'}
          onClick={onClearAll}
          disabled={activeCount === 0}
        >
          {sheet ? 'Wyczyść' : 'Wyczyść wszystko'}
        </button>
        {sheet && (
          <button type="button" className="btn primary" onClick={close}>
            {resultCount === undefined ? 'Pokaż wyniki' : `Pokaż ${resultCount}`}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="filter-bar">
      <div className="filter-panel-wrap">
        <button
          type="button"
          ref={btnRef}
          className={activeCount > 0 ? 'btn soft filter-btn active' : 'btn soft filter-btn'}
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => setOpen((v) => !v)}
        >
          <Filter size={15} aria-hidden /> Filtry
          {activeCount > 0 && <span className="filter-badge">{activeCount}</span>}
        </button>
        {open && (
          <OverlayLayer>
            {/* Scrim nie ma własnego handlera — zamknięcie „kliknięciem poza”
                obsługuje `useOverlay` (para pointerdown+click). */}
            {sheet && <div className="app-sheet-scrim" aria-hidden />}
            {panel}
          </OverlayLayer>
        )}
      </div>
      {chips.map((c) => (
        <span key={c.key} className="filter-chip">
          <span className="filter-chip-label">{c.label}</span>
          <button
            type="button"
            className="filter-chip-del"
            onClick={c.onRemove}
            aria-label={`Usuń filtr ${c.label}`}
          >
            <X size={13} />
          </button>
        </span>
      ))}
    </div>
  );
}
