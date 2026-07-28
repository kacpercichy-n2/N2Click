// Kanban: the TASK board. Columns = active statuses in pipeline order, plus a
// trailing "Zarchiwizowane" column for tasks sitting in an archived status;
// moving a task card into a column dispatches SET_TASK_STATUS. A card opens
// the task in TaskModal (it never navigates to the project). Client and payment
// filters are resolved through the task's project, the person filter through its
// assignees. All filtering/grouping lives in the pure module `kanbanBoard.ts`.
// Admins can quick-create a status by typing "/Status name" in the quick-add box.
//
// Przenoszenie karty ma TRZY równoprawne ścieżki, wszystkie kończące się tą samą
// (jedyną) akcją `SET_TASK_STATUS` — inwariant 6, żadnego nowego reduktora ani
// zapisanej kolejności w kolumnie:
// 1. wskaźnik (mysz + dotyk) na Pointer Events — natywne HTML5 DnD (`draggable`
//    + `dataTransfer`) ZNIKŁO, bo na dotyku nie istniało w ogóle; dotyk wchodzi
//    przez wspólną bramkę `useTouchDragGate` (przytrzymanie 350 ms), więc ruch
//    palcem przed czasem po prostu przewija tablicę;
// 2. klawiatura — uchwyt przenoszenia na karcie + czysty automat `kanbanMove.ts`;
// 3. menu karty („Przenieś do statusu") na wspólnej powłoce `useOverlay`.
// Cykl życia wskaźnika (inwariant 7): przechwycenie, rAF i nasłuchy okna są
// sprzątane na KAŻDEJ ścieżce — upuszczenie, `pointercancel`, Escape, blur okna,
// ukrycie karty przeglądarki i odmontowanie w trakcie gestu.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { useStore } from '../store/AppStore';
import { useCan } from '../store/useCan';
import { activeStatuses, getClient, getProject } from '../store/selectors';
import { Avatar } from '../components/Avatar';
import { PriorityBadge } from '../components/PriorityBadge';
import { type FilterChip, type FilterGroup } from '../components/FilterPanel';
import { FilterBar } from '../components/FilterBar';
import { FilterPresets, DEFAULT_CRITERIA } from '../components/FilterPresets';
import { IconButton } from '../components/IconButton';
import { GripVertical, MoreVertical } from '../components/icons';
import { OverlayLayer, useOverlay } from '../components/useOverlay';
import { useOpenTask } from '../components/TaskModal';
import { clientProjectPath } from '../utils/entityPath';
import { useTouchDragGate } from '../utils/useTouchDragGate';
import { buildKanbanColumns, buildTaskAssigneeIds } from './kanbanBoard';
import {
  cancelAnnouncement,
  dropAnnouncement,
  kanbanDropIntent,
  kanbanDropPosition,
  kanbanMoveReducer,
  pickupAnnouncement,
  targetAnnouncement,
  type KanbanMoveColumn,
  type KanbanMoveState,
} from './kanbanMove';
import { type PaidFilter } from './ProjectsPage';
import { formatShortWithWeekday } from '../utils/dates';
import type { SavedFilterCriteria, Task } from '../types';

// Stała pusta lista chipów osób — stabilna referencja, gdy widok nie ma jeszcze
// zapamiętanego filtra (unika przeliczania Setu/tablicy co render).
const EMPTY_PERSON_IDS: string[] = [];

// Dark-legible, on-brand rotation for admin quick-created statuses.
const STATUS_COLORS = ['#9aa7c4', '#5bdcff', '#ffc857', '#b9ff4d', '#c496ff', '#ff9640'];

// How many assignee avatars fit on a card before we collapse the rest into "+N".
const MAX_AVATARS = 3;

// Dryf (px), powyżej którego gest myszą przestaje być kliknięciem otwierającym
// zadanie. Dotyk nie potrzebuje progu: samo przytrzymanie jest już deklaracją
// przeciągania (wzorzec `moved`-ref z TimelinePage.Bar).
const CLICK_SLOP_PX = 4;

/** Nazwa kolumny archiwum — źródło karty, które NIE jest celem upuszczenia. */
const ARCHIVED_COLUMN_NAME = 'Zarchiwizowane';

/** Jeden ukryty opis skrótów na stronę, wskazywany przez każdy uchwyt. */
const MOVE_HINT_ID = 'kanban-move-hint';

const moveHandleId = (taskId: string) => `kanban-move-${taskId}`;

/** Prostokąt kolumny ZMIERZONY raz na starcie przeciągania. */
interface ColumnBand {
  statusId: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface PointerDrag {
  taskId: string;
  sourceStatusId: string;
}

export function KanbanPage() {
  const { state, dispatch } = useStore();
  const statuses = activeStatuses(state);
  const can = useCan();
  const admin = can('admin.panel');
  const canManage = can('tasks.manage');
  const { openTask } = useOpenTask();

  const [quickStatus, setQuickStatus] = useState('');

  // Stan filtrów ZAPAMIĘTANY w store (`lastFilters.kanban`): FilterPanel-owe wymiary
  // (paid/client/project) żyją w `criteria`, a chipy osób w `personIds`. Setter
  // wysyła pełny snapshot przez `SET_LAST_FILTER` (no-op zapisu identycznego).
  const remembered = state.lastFilters.kanban;
  const criteria: SavedFilterCriteria = remembered?.criteria ?? DEFAULT_CRITERIA;
  const paidFilter = criteria.paid;
  const clientFilter = criteria.clientId;
  const projectFilter = criteria.projectId;
  const personIds = remembered?.personIds ?? EMPTY_PERSON_IDS;
  // Set osób pochodny z `personIds` (Setów NIE trzymamy w AppData — inwariant 7:
  // to tylko ZMIANA ŹRÓDŁA zaznaczenia, nie ścieżki wskaźnika kalendarza).
  const personFilter = useMemo(() => new Set(personIds), [personIds]);

  const commit = (next: { criteria?: SavedFilterCriteria; personIds?: string[] }) =>
    dispatch({
      type: 'SET_LAST_FILTER',
      view: 'kanban',
      filter: {
        criteria: next.criteria ?? criteria,
        personIds: next.personIds ?? personIds,
        departmentId: '',
        serviceTypeId: '',
        planning: '',
      },
    });

  const setPaidFilter = (v: PaidFilter) => commit({ criteria: { ...criteria, paid: v } });
  const setClientFilter = (v: string) => commit({ criteria: { ...criteria, clientId: v } });
  const setProjectFilter = (v: string) => commit({ criteria: { ...criteria, projectId: v } });
  const setPersonFilter = (next: Set<string>) => commit({ personIds: [...next] });

  const sortedProjects = useMemo(
    () => [...state.projects].sort((a, b) => a.name.localeCompare(b.name)),
    [state.projects],
  );

  const board = useMemo(() => {
    // buildKanbanColumns pozostaje NIEZMIENIONE (inwariant): filtr projektu
    // nakładamy PO zbudowaniu tablicy, przycinając zadania każdej kolumny.
    const full = buildKanbanColumns(state, {
      paid: paidFilter,
      clientId: clientFilter,
      personIds: personFilter,
    });
    if (!projectFilter) return full;
    return {
      columns: full.columns.map((c) => ({
        ...c,
        tasks: c.tasks.filter((t) => t.projectId === projectFilter),
      })),
      archived: full.archived.filter((t) => t.projectId === projectFilter),
    };
  }, [state, paidFilter, clientFilter, projectFilter, personFilter]);

  // Cheap per-card lookups: no card scans projects/clients/assignments itself.
  const lookups = useMemo(
    () => ({
      projects: new Map(state.projects.map((p) => [p.id, p])),
      clients: new Map(state.clients.map((c) => [c.id, c])),
      people: new Map(state.people.map((p) => [p.id, p])),
      tasks: new Map(state.tasks.map((t) => [t.id, t])),
      assignees: buildTaskAssigneeIds(state),
    }),
    [state],
  );

  // Kolumny-CELE przenoszenia: wyłącznie aktywne statusy w kolejności lejka.
  // Archiwum jest źródłem, nigdy celem — dlatego nie ma go na tej liście ani
  // wśród mierzonych prostokątów.
  const moveColumns = useMemo<KanbanMoveColumn[]>(
    () =>
      board.columns.map((c) => ({ statusId: c.status.id, name: c.status.name, tasks: c.tasks })),
    [board],
  );

  const columnName = useCallback(
    (statusId: string) =>
      moveColumns.find((c) => c.statusId === statusId)?.name ?? ARCHIVED_COLUMN_NAME,
    [moveColumns],
  );

  // ---------------- Komunikaty dla czytnika ekranu ----------------

  const [announcement, setAnnouncement] = useState('');
  // Element, któremu po zakończonej operacji trzeba ODDAĆ fokus. Trzymamy id, nie
  // referencję: karta zmieniająca status odmontowuje się z jednej kolumny i
  // montuje w drugiej, więc stary węzeł już nie istnieje.
  const refocusRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    const id = refocusRef.current;
    if (id === null) return;
    refocusRef.current = null;
    document.getElementById(id)?.focus();
  });

  // ---------------- Przeciąganie wskaźnikiem (mysz + dotyk) ----------------

  const gate = useTouchDragGate();
  const boardRef = useRef<HTMLDivElement>(null);
  // Stan przeciągania żyje w DWÓCH miejscach naraz (wzorzec WeekView): ref jest
  // źródłem prawdy dla handlerów (widzą najświeższą projekcję jeszcze w tej samej
  // klatce), stan Reactowy służy WYŁĄCZNIE renderowi.
  const dragRef = useRef<PointerDrag | null>(null);
  const [drag, setDrag] = useState<PointerDrag | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null); // statusId
  const targetRef = useRef<string | null>(null);
  const captureRef = useRef<{ el: HTMLElement; pointerId: number } | null>(null);
  const bandsRef = useRef<ColumnBand[]>([]);
  const originRef = useRef({ x: 0, y: 0 });
  const movedRef = useRef(false);
  const rafRef = useRef(0);

  const cancelRaf = () => {
    if (rafRef.current !== 0) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
  };

  const releaseCapture = () => {
    const capture = captureRef.current;
    if (capture === null) return;
    try {
      capture.el.releasePointerCapture(capture.pointerId);
    } catch {
      // Already released — ignore.
    }
    captureRef.current = null;
  };

  /** Jedyna ścieżka wyjścia z przeciągania: nic nie wysyła, sprząta wszystko. */
  const endDrag = () => {
    cancelRaf();
    releaseCapture();
    dragRef.current = null;
    targetRef.current = null;
    bandsRef.current = [];
    setDrag(null);
    setDragOver(null);
  };

  // Odmontowanie w trakcie gestu (nawigacja, zmiana filtrów) nie może zostawić
  // wiszącej klatki animacji ani przechwyconego wskaźnika.
  useEffect(
    () => () => {
      cancelRaf();
      releaseCapture();
    },
    [],
  );

  // Przerwania przeciągania BEZ wysyłki. Nasłuchy wstają raz na gest i znikają
  // razem z nim (te same bezpieczniki co blok kalendarza).
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') endDrag();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') endDrag();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', endDrag);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', endDrag);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nasłuchy mają wstać RAZ na gest; `endDrag` czyta wyłącznie refy
  }, [dragging]);

  /**
   * Prostokąty RENDEROWANYCH kolumn, mierzone RAZ na starcie gestu. Celu nie da
   * się czytać z `elementFromPoint`: przechwycenie wskaźnika przekierowuje
   * wszystkie zdarzenia na kartę, więc pod kursorem „jest" zawsze ona.
   * Pionowo bierzemy zakres CAŁEJ tablicy — kolumny mają różne wysokości, a
   * przeciągnięcie w bok nie może gubić celu tylko dlatego, że sąsiad jest
   * krótszy.
   */
  const measureColumns = () => {
    const element = boardRef.current;
    if (element === null) {
      bandsRef.current = [];
      return;
    }
    const boardRect = element.getBoundingClientRect();
    bandsRef.current = Array.from(
      element.querySelectorAll<HTMLElement>('.kanban-col[data-status-id]'),
    ).map((column) => {
      const rect = column.getBoundingClientRect();
      return {
        statusId: column.dataset.statusId ?? '',
        left: rect.left,
        right: rect.right,
        top: boardRect.top,
        bottom: boardRect.bottom,
      };
    });
  };

  const targetAt = (x: number, y: number): string | null => {
    for (const band of bandsRef.current) {
      if (x >= band.left && x <= band.right && y >= band.top && y <= band.bottom) {
        return band.statusId;
      }
    }
    return null;
  };

  // Odroczony start przeciągania. `init` jest zbierany SYNCHRONICZNIE w
  // handlerze, bo React zeruje `currentTarget` po wysyłce zdarzenia — na dotyku
  // ta funkcja odpala się dopiero po przytrzymaniu i nie ma już czego czytać.
  const startDrag = (
    init: {
      el: HTMLElement;
      pointerId: number;
      clientX: number;
      clientY: number;
      taskId: string;
      sourceStatusId: string;
    },
    viaHold: boolean,
  ) => {
    try {
      init.el.setPointerCapture(init.pointerId);
      captureRef.current = { el: init.el, pointerId: init.pointerId };
    } catch {
      // No active pointer (synthetic events) — dragging still works within the card.
      captureRef.current = null;
    }
    // Przytrzymanie na dotyku JEST już deklaracją przeciągania, więc puszczenie
    // palca nie może otworzyć zadania; mysz decyduje dopiero progiem ruchu.
    movedRef.current = viaHold;
    originRef.current = { x: init.clientX, y: init.clientY };
    targetRef.current = null;
    measureColumns();
    const next: PointerDrag = { taskId: init.taskId, sourceStatusId: init.sourceStatusId };
    dragRef.current = next;
    setDrag(next);
    setDragOver(null);
  };

  const beginDrag = (task: Task) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return; // prawy/środkowy przycisk zostawiamy przeglądarce
    // Klaster akcji ma własne zdarzenia (menu, uchwyt klawiaturowy) — nie może
    // startować przeciągania ani gubić kliknięcia w przycisk.
    if ((e.target as HTMLElement).closest('.kanban-card-actions') !== null) return;
    // Reset PRZED bramką: dotknięcie bez przeciągnięcia ma otwierać zadanie.
    movedRef.current = false;
    const init = {
      el: e.currentTarget,
      pointerId: e.pointerId,
      clientX: e.clientX,
      clientY: e.clientY,
      taskId: task.id,
      sourceStatusId: task.statusId,
    };
    // Dotyk/pióro: przeciąganie startuje dopiero po przytrzymaniu, więc ruch
    // palcem po karcie przewija tablicę zamiast przestawiać zadanie.
    if (gate.arm(e.pointerType, e.clientX, e.clientY, () => startDrag(init, true))) return;
    startDrag(init, false);
  };

  const onDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current === null) return;
    // Mysz puszczona POZA oknem wraca z `buttons === 0`, choć karta nigdy nie
    // dostała `pointerup` — traktujemy to jak anulowanie.
    if (e.pointerType === 'mouse' && e.buttons === 0) {
      endDrag();
      return;
    }
    if (!movedRef.current) {
      const origin = originRef.current;
      if (Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > CLICK_SLOP_PX) {
        movedRef.current = true;
      }
    }
    // Najświeższy cel siedzi w refie, żeby `pointerup` w tej samej klatce widział
    // aktualną projekcję; do Reacta oddajemy go RAZ na klatkę (koalescencja).
    targetRef.current = targetAt(e.clientX, e.clientY);
    if (rafRef.current !== 0) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      if (dragRef.current === null) return;
      setDragOver(targetRef.current);
    });
  };

  const onDragEnd = () => {
    const active = dragRef.current;
    if (active === null) return;
    const target = targetRef.current;
    const task = lookups.tasks.get(active.taskId);
    endDrag();
    // Poza kolumną, na kolumnie źródłowej albo bez zadania → żadnej wysyłki.
    if (target === null || target === active.sourceStatusId || task === undefined) return;
    dispatch({ type: 'SET_TASK_STATUS', taskId: active.taskId, statusId: target });
    setAnnouncement(dropAnnouncement(task.title, columnName(target)));
  };

  // ---------------- Tryb przenoszenia z klawiatury ----------------

  // Ten sam podział, co przy przeciąganiu: stan Reactowy dla renderu, ref dla
  // handlerów. Ref jest tu NOŚNY — karta zmieniająca status odmontowuje swój
  // uchwyt, a wychodzący z niego `blur` niesie propsy STAREGO renderu; bez refa
  // „anulowano" nadpisałoby świeżo ogłoszone „przeniesiono".
  const [move, setMove] = useState<KanbanMoveState | null>(null);
  const moveRef = useRef<KanbanMoveState | null>(null);
  const applyMove = (next: KanbanMoveState | null) => {
    moveRef.current = next;
    setMove(next);
  };

  /** Ogłasza cel wynikający ze stanu; pozycja jest WYLICZANA, nie zapisywana. */
  const announceTarget = (next: KanbanMoveState, task: Task, kind: 'pickup' | 'target') => {
    const column = moveColumns[next.targetIndex];
    if (column === undefined) return;
    const position = kanbanDropPosition(column, task);
    setAnnouncement(
      kind === 'pickup'
        ? pickupAnnouncement(task.title, column.name, position)
        : targetAnnouncement(column.name, position),
    );
  };

  const cancelMove = (active: KanbanMoveState, task: Task, refocus: boolean) => {
    applyMove(kanbanMoveReducer(active, { type: 'cancel' }, moveColumns));
    setAnnouncement(cancelAnnouncement(task.title, columnName(active.sourceStatusId)));
    // Escape oddaje fokus uchwytowi; wyjście Tabem NIE — inaczej odbijalibyśmy
    // fokus użytkownikowi w drodze do następnego elementu.
    if (refocus) refocusRef.current = moveHandleId(task.id);
  };

  const dropMove = (active: KanbanMoveState, task: Task) => {
    const intent = kanbanDropIntent(active, moveColumns);
    applyMove(kanbanMoveReducer(active, { type: 'drop' }, moveColumns));
    refocusRef.current = moveHandleId(task.id);
    if (intent === null) {
      // Cel = źródło (albo cel wypadł z tablicy): no-opa do store'u nie wysyłamy.
      setAnnouncement(cancelAnnouncement(task.title, columnName(active.sourceStatusId)));
      return;
    }
    dispatch({ type: 'SET_TASK_STATUS', taskId: intent.taskId, statusId: intent.statusId });
    setAnnouncement(dropAnnouncement(task.title, columnName(intent.statusId)));
  };

  const onHandleKey = (e: React.KeyboardEvent<HTMLButtonElement>, task: Task) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const current = moveRef.current;
    const active = current !== null && current.taskId === task.id ? current : null;
    const key = e.key;
    // Spacja/Enter: podnieś albo upuść. `preventDefault` jest nośne — bez niego
    // spacja przewija tablicę, a Enter dobija kliknięciem do karty pod spodem.
    if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
      e.preventDefault();
      e.stopPropagation();
      if (active !== null) dropMove(active, task);
      else {
        const next = kanbanMoveReducer(
          null,
          { type: 'pickup', taskId: task.id, sourceStatusId: task.statusId },
          moveColumns,
        );
        if (next === null) return; // brak aktywnych kolumn — nie ma dokąd przenosić
        applyMove(next);
        announceTarget(next, task, 'pickup');
      }
      return;
    }
    if (active === null) return;
    if (key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancelMove(active, task, true);
      return;
    }
    // Tablica to JEDEN poziomy pas, a pozycja w kolumnie jest pochodna — dlatego
    // obie osie strzałek zmieniają KOLUMNĘ (patrz `kanbanMove.ts`).
    const event =
      key === 'ArrowLeft' || key === 'ArrowUp'
        ? ({ type: 'move', delta: -1 } as const)
        : key === 'ArrowRight' || key === 'ArrowDown'
          ? ({ type: 'move', delta: 1 } as const)
          : key === 'Home'
            ? ({ type: 'first' } as const)
            : key === 'End'
              ? ({ type: 'last' } as const)
              : null;
    if (event === null) return;
    e.preventDefault();
    e.stopPropagation();
    const next = kanbanMoveReducer(active, event, moveColumns);
    if (next === null || next === active) return; // krawędź listy — nic do ogłoszenia
    applyMove(next);
    announceTarget(next, task, 'target');
  };

  // Wyjście fokusa z uchwytu (Tab, klik gdzie indziej) nie może zostawić
  // wiszącego trybu przenoszenia. Czytamy z refa, więc `blur` odmontowanego
  // uchwytu (po udanym upuszczeniu) jest już bezskuteczny.
  const onHandleBlur = (task: Task) => {
    const current = moveRef.current;
    if (current === null || current.taskId !== task.id) return;
    cancelMove(current, task, false);
  };

  // ---------------- Menu karty ----------------

  const [menu, setMenu] = useState<{ taskId: string; step: 'menu' | 'status' } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Wyzwalacze menu per karta: kotwica popovera musi być ŻYWYM węzłem, a karta
  // wraz z nim przenosi się między kolumnami.
  const triggersRef = useRef(new Map<string, HTMLButtonElement>());
  // Stabilny ref dla powłoki: jego zdarzenia nie zamykają nakładki, więc drugie
  // kliknięcie w wyzwalacz zamyka menu, zamiast otwierać je na nowo.
  const openTriggerRef = useRef<HTMLElement | null>(null);

  const setTriggerRef = (taskId: string) => (el: HTMLButtonElement | null) => {
    if (el === null) triggersRef.current.delete(taskId);
    else triggersRef.current.set(taskId, el);
  };

  const trigger = (taskId: string): HTMLButtonElement | null =>
    triggersRef.current.get(taskId) ?? null;

  const closeMenu = useCallback(() => setMenu(null), []);
  const menuAnchorRect = useCallback(() => {
    if (menu === null) return null;
    const el = trigger(menu.taskId);
    return el === null || !el.isConnected ? null : el.getBoundingClientRect();
  }, [menu]);
  const menuFocusReturn = useCallback(() => (menu === null ? null : trigger(menu.taskId)), [menu]);

  const menuOverlay = useOverlay({
    open: menu !== null,
    onClose: closeMenu,
    overlayRef: menuRef,
    getAnchorRect: menuAnchorRect,
    getFocusReturn: menuFocusReturn,
    triggerRef: openTriggerRef,
    menuKeyboard: true,
    offset: 4,
  });

  const toggleMenu = (taskId: string) => {
    openTriggerRef.current = trigger(taskId);
    setMenu((current) => (current?.taskId === taskId ? null : { taskId, step: 'menu' }));
  };

  const menuTask = menu === null ? undefined : lookups.tasks.get(menu.taskId);

  const moveViaMenu = (statusId: string) => {
    setMenu(null);
    if (menuTask === undefined || menuTask.statusId === statusId) return;
    dispatch({ type: 'SET_TASK_STATUS', taskId: menuTask.id, statusId });
    setAnnouncement(dropAnnouncement(menuTask.title, columnName(statusId)));
    // Karta przemontowuje się do innej kolumny, więc powrót fokusa z powłoki
    // trafiłby w martwy węzeł — oddajemy fokus uchwytowi tej samej karty.
    refocusRef.current = moveHandleId(menuTask.id);
  };

  // ---------------- Wspólny wskaźnik upuszczenia ----------------

  // JEDEN wskaźnik obsługuje przeciąganie wskaźnikiem i tryb klawiaturowy:
  // podświetlona kolumna + kreska na WYLICZONYM miejscu docelowym.
  const activeDrop = useMemo(() => {
    const resolve = (taskId: string, statusId: string | null) => {
      if (statusId === null) return null;
      const column = moveColumns.find((c) => c.statusId === statusId);
      const task = lookups.tasks.get(taskId);
      if (column === undefined || task === undefined) return null;
      return { statusId, index: kanbanDropPosition(column, task).index };
    };
    if (move !== null) {
      return resolve(move.taskId, moveColumns[move.targetIndex]?.statusId ?? null);
    }
    if (drag !== null) return resolve(drag.taskId, dragOver);
    return null;
  }, [move, drag, dragOver, moveColumns, lookups]);

  const paidLabel = (v: PaidFilter) =>
    v === 'paid' ? 'Opłacone' : v === 'unpaid' ? 'Nieopłacone' : 'Wszystkie';

  const filterGroups: FilterGroup[] = [
    {
      key: 'paid',
      label: 'Płatność',
      value: paidFilter,
      onChange: (v) => setPaidFilter(v as PaidFilter),
      options: [
        { value: 'all', label: 'Wszystkie' },
        { value: 'paid', label: 'Opłacone' },
        { value: 'unpaid', label: 'Nieopłacone' },
      ],
    },
    {
      key: 'client',
      label: 'Klient',
      value: clientFilter,
      onChange: setClientFilter,
      options: [
        { value: '', label: 'Wszyscy klienci' },
        ...state.clients.map((c) => ({ value: c.id, label: c.name })),
      ],
    },
    {
      key: 'project',
      label: 'Projekt',
      value: projectFilter,
      onChange: setProjectFilter,
      options: [
        { value: '', label: 'Wszystkie' },
        ...sortedProjects.map((p) => ({ value: p.id, label: p.name })),
      ],
    },
  ];

  const activeCount =
    (paidFilter !== 'all' ? 1 : 0) +
    (clientFilter ? 1 : 0) +
    (projectFilter ? 1 : 0) +
    (personFilter.size > 0 ? 1 : 0);

  const chips: FilterChip[] = [];
  if (paidFilter !== 'all')
    chips.push({ key: 'paid', label: `Płatność: ${paidLabel(paidFilter)}`, onRemove: () => setPaidFilter('all') });
  if (clientFilter)
    chips.push({
      key: 'client',
      label: `Klient: ${getClient(state, clientFilter)?.name ?? '—'}`,
      onRemove: () => setClientFilter(''),
    });
  if (projectFilter)
    chips.push({
      key: 'project',
      label: `Projekt: ${getProject(state, projectFilter)?.name ?? '—'}`,
      onRemove: () => setProjectFilter(''),
    });
  // Zaznaczone osoby renderują się jako kompaktowe chipy w pasku (FilterBar
  // `person`), a nie jako pojedynczy zbiorczy chip w popoverze.

  const clearAll = () => commit({ criteria: DEFAULT_CRITERIA, personIds: [] });

  const applyPreset = (c: SavedFilterCriteria) => commit({ criteria: c });

  const togglePerson = (personId: string) => {
    const next = new Set(personFilter);
    if (next.has(personId)) next.delete(personId);
    else next.add(personId);
    setPersonFilter(next);
  };

  const renderCard = (t: Task) => {
    const project = lookups.projects.get(t.projectId);
    const client = project ? lookups.clients.get(project.clientId) : undefined;
    const assigneeIds = lookups.assignees.get(t.id) ?? [];
    const shown = assigneeIds.slice(0, MAX_AVATARS);
    const overflow = assigneeIds.length - shown.length;
    const moving = move !== null && move.taskId === t.id;
    return (
      // Bez `layout`: projekcja FLIP mierzyła KAŻDĄ kartę tablicy przy każdym
      // renderze (a przy przeciąganiu — co klatkę), a jej jedyny efekt to
      // przesuwanie kart po zmianie kolumny. Nie zastępujemy jej też CSS-owym
      // `transition: transform` na `.kanban-card`: tym samym `transform`
      // steruje `whileHover` z motion, więc przejście CSS biłoby się z
      // animacją silnika. Trzy ścieżki przenoszenia (wskaźnik, klawiatura,
      // menu) nie zależały od projekcji — kończą się tym samym
      // `SET_TASK_STATUS`.
      <m.div
        key={t.id}
        whileHover={{ y: -2 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className={[
          'kanban-card',
          drag?.taskId === t.id ? 'dragging' : '',
          moving ? 'moving' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        // Przeciąganie na Pointer Events: jedna ścieżka dla myszy i dotyku,
        // bez `draggable`/`dataTransfer` (te na dotyku nie istniały).
        onPointerDown={canManage ? beginDrag(t) : undefined}
        onPointerMove={canManage ? onDragMove : undefined}
        onPointerUp={canManage ? onDragEnd : undefined}
        onPointerCancel={canManage ? endDrag : undefined}
        onClick={() => {
          if (movedRef.current) return; // to było przeciąganie, nie kliknięcie
          openTask(t.id);
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter') openTask(t.id);
        }}
      >
        {canManage && (
          // Klaster akcji: w spoczynku niewidoczny (karta wygląda 1:1 jak dotąd),
          // ujawniany hoverem/fokusem, a na dotyku widoczny stale — patrz CSS.
          // `stopPropagation` na kliknięciu trzyma przyciski z dala od otwierania
          // zadania kliknięciem w kartę.
          <div className="kanban-card-actions" onClick={(e) => e.stopPropagation()}>
            <button
              id={moveHandleId(t.id)}
              type="button"
              className="icon-btn kanban-card-grip"
              data-size="sm"
              aria-label={`Przenieś zadanie: ${t.title}`}
              aria-pressed={moving}
              aria-describedby={MOVE_HINT_ID}
              onKeyDown={(e) => onHandleKey(e, t)}
              onBlur={() => onHandleBlur(t)}
            >
              <GripVertical size={14} aria-hidden />
            </button>
            <IconButton
              ref={setTriggerRef(t.id)}
              size="sm"
              label={`Menu zadania: ${t.title}`}
              tooltip="Menu zadania"
              icon={<MoreVertical size={14} aria-hidden />}
              expanded={menu?.taskId === t.id}
              onClick={() => toggleMenu(t.id)}
            />
          </div>
        )}
        <div className="kanban-card-top">
          <span className="kanban-card-title">{t.title}</span>
        </div>
        {/* Ścieżka adresowa idzie WSZĘDZIE tą samą regułą (SY-06): najpierw
            klient, potem projekt, separator `›`. Zmienia się wyłącznie treść i
            kolejność tekstu — układ i wymiary karty zostają bez zmian. */}
        <div className="kanban-card-client">
          {clientProjectPath(client?.name, project?.name ?? 'Bez projektu')}
        </div>
        <div className="kanban-card-badges">
          <PriorityBadge priority={t.priority} />
          <span className="kanban-card-meta">{formatShortWithWeekday(t.endDate)}</span>
        </div>
        {assigneeIds.length > 0 && (
          <div className="kanban-card-people">
            {shown.map((id) => {
              const person = lookups.people.get(id);
              return person ? <Avatar key={id} person={person} size={22} /> : null;
            })}
            {overflow > 0 && <span className="kanban-card-more">+{overflow}</span>}
          </div>
        )}
      </m.div>
    );
  };

  /** Karty kolumny z kreską wskaźnika wstawioną na wyliczonym indeksie. */
  const renderColumnBody = (tasks: Task[], dropIndex: number | null) => {
    const indicator = <div key="drop" className="kanban-drop-indicator" aria-hidden />;
    const nodes: React.ReactNode[] = [];
    tasks.forEach((t, index) => {
      if (dropIndex === index) nodes.push(indicator);
      nodes.push(renderCard(t));
    });
    if (dropIndex !== null && dropIndex >= tasks.length) nodes.push(indicator);
    return nodes;
  };

  const quickCreate = (e: React.FormEvent) => {
    e.preventDefault();
    // "/Name here" quick-create command; a bare name works too.
    const name = quickStatus.replace(/^\//, '').trim();
    if (!name) return;
    dispatch({
      type: 'SAVE_STATUS',
      statusId: null,
      name,
      color: STATUS_COLORS[statuses.length % STATUS_COLORS.length],
    });
    setQuickStatus('');
  };

  return (
    <section className="page page-wide">
      <div className="page-head">
        <h1>Kanban</h1>
      </div>

      <FilterBar
        filterPanel={{
          groups: filterGroups,
          activeCount,
          onClearAll: clearAll,
          chips,
        }}
        person={{
          people: state.people,
          selected: personFilter,
          onToggle: togglePerson,
          onAll: () => setPersonFilter(new Set()),
        }}
        presets={<FilterPresets page="kanban" criteria={criteria} onApply={applyPreset} />}
      />

      {/* Jeden region ogłoszeń na stronę: podniesienie, zmiana celu, upuszczenie
          i anulowanie — jedyny kanał, którym czytnik ekranu wie, co się dzieje. */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
      {canManage && (
        <span id={MOVE_HINT_ID} className="sr-only">
          Naciśnij spację lub Enter, aby podnieść kartę. Strzałki zmieniają kolumnę docelową, Home i
          End wybierają pierwszą lub ostatnią kolumnę. Spacja lub Enter upuszcza, Escape anuluje.
        </span>
      )}

      {statuses.length === 0 && board.archived.length === 0 ? (
        <div className="empty-state">
          <p className="empty-title">Brak statusów</p>
          <p className="empty-hint">Administrator może utworzyć statusy lejka w panelu Administracja.</p>
        </div>
      ) : (
        <div className="kanban-board" data-tour="kanban.board" ref={boardRef}>
          {board.columns.map(({ status: s, tasks }) => {
            const dropIndex = activeDrop?.statusId === s.id ? activeDrop.index : null;
            return (
              <div
                key={s.id}
                data-tour="kanban.column"
                // Cel upuszczenia jest czytany z ZMIERZONYCH prostokątów kolumn,
                // a nie z `elementFromPoint` — ten atrybut jest ich kluczem.
                data-status-id={s.id}
                className={dropIndex !== null ? 'kanban-col drag-over' : 'kanban-col'}
              >
                <div className="kanban-col-head" style={{ borderTopColor: s.color }}>
                  <span className="kanban-col-name" style={{ color: s.color }}>
                    {s.name}
                  </span>
                  <span className="kanban-col-count">{tasks.length}</span>
                </div>
                <div className="kanban-col-body">
                  {tasks.length === 0 && dropIndex === null && (
                    <div className="kanban-empty">Upuść tutaj</div>
                  )}
                  {renderColumnBody(tasks, dropIndex)}
                </div>
              </div>
            );
          })}

          {board.archived.length > 0 && (
            // Bez `data-status-id`: archiwum jest źródłem, nigdy celem upuszczenia.
            <div className="kanban-col archived-col">
              <div className="kanban-col-head">
                <span className="kanban-col-name">{ARCHIVED_COLUMN_NAME}</span>
                <span className="kanban-col-count">{board.archived.length}</span>
              </div>
              {/* Instrukcja była dotąd hover-only (`title`) — na dotyku nie
                  istniała. Teraz jest po prostu WIDOCZNA. */}
              <p className="kanban-col-note">
                Zadania w zarchiwizowanych statusach — przeciągnij kartę do aktywnej kolumny, aby
                przywrócić.
              </p>
              <div className="kanban-col-body">{board.archived.map((t) => renderCard(t))}</div>
            </div>
          )}

          {admin && (
            <form className="kanban-add-col" onSubmit={quickCreate}>
              <input
                value={quickStatus}
                onChange={(e) => setQuickStatus(e.target.value)}
                placeholder="/Nazwa nowego statusu"
                aria-label="Szybkie dodanie statusu"
                aria-describedby="kanban-quick-status-hint"
              />
              {/* Wzorzec pokazuje placeholder, więc pełna instrukcja zostaje
                  ukrytym opisem zamiast hover-only `title`. */}
              <span id="kanban-quick-status-hint" className="sr-only">
                Wpisz „/Nazwa statusu” i naciśnij Enter (tylko administrator).
              </span>
              <button type="submit" className="btn soft" disabled={!quickStatus.trim()}>
                Dodaj
              </button>
            </form>
          )}
        </div>
      )}

      {/* Menu karty na WSPÓLNEJ powłoce nakładek (portal, stos Escape, zamykanie
          parą pointerdown+click, klawiatura `role="menu"`). */}
      <OverlayLayer>
        <AnimatePresence>
          {menu !== null && (
            <m.div
              className="context-menu"
              style={{ ...menuOverlay.style, transformOrigin: 'top left' }}
              role="menu"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.12, ease: 'easeOut' }}
            >
              <div ref={menuRef}>
                {menu.step === 'menu' ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="context-menu-item"
                    onClick={() => setMenu({ ...menu, step: 'status' })}
                  >
                    Przenieś do statusu →
                  </button>
                ) : (
                  <>
                    <div className="context-menu-title">Przenieś do statusu</div>
                    {moveColumns.map((column) => {
                      // Bieżący status jest WYŁĄCZONY: no-opa do store'u nie
                      // wysyłamy, a powłoka pomija go w nawigacji klawiaturą.
                      const current = menuTask?.statusId === column.statusId;
                      return (
                        <button
                          key={column.statusId}
                          type="button"
                          role="menuitem"
                          className="context-menu-item"
                          disabled={current}
                          onClick={() => moveViaMenu(column.statusId)}
                        >
                          {current ? `✓ ${column.name}` : column.name}
                        </button>
                      );
                    })}
                  </>
                )}
              </div>
            </m.div>
          )}
        </AnimatePresence>
      </OverlayLayer>
    </section>
  );
}
