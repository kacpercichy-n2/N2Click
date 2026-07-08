// Week view: a Google-Calendar-style timed day grid. A left hour axis (0:00–24:00)
// and 7 day columns; each person's time blocks are absolutely positioned by
// `startMinutes` with height proportional to `plannedHours`. Blocks drag to move
// (same day or cross-day) and edge-drag to resize on a 15-min grid; a same-person
// time overlap shows a danger tint and the drop reverts. Right-clicking a block
// still opens "Dodaj przed / Dodaj po" to ripple-insert a new block.
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { AppData, Person, Project, Task, WorkloadEntry } from '../types';
import { useStore } from '../store/AppStore';
import { useCan } from '../store/useCan';
import { useOpenTask } from './TaskModal';
import { personColor } from '../utils/colors';
import { isTodayStr, isWeekend, parseDate, weekDays } from '../utils/dates';
import { format } from 'date-fns';
import { pl } from 'date-fns/locale/pl';
import {
  binEntriesForPerson,
  binTotalForPerson,
  blockCollides,
  dayTotal,
  entriesForDate,
  getClient,
  getPerson,
  getProject,
  getTask,
  growAllowanceHours,
  hoursForPersonOnDate,
  overloadedPeopleOnDate,
  personCapacity,
  taskIdsOfPerson,
} from '../store/selectors';
import {
  DAY_MINUTES,
  MINUTE_STEP,
  blockEndMinutes,
  clampBlockStart,
  formatDuration,
  formatMinutes,
  hoursToMinutes,
  isBinEntry,
  minutesToHours,
  packDayBlocks,
  snapToStep,
} from '../utils/time';
import { Coin } from './Coin';

interface Props {
  state: AppData;
  anchor: string; // any date within the week to render
  filter: Set<string>;
}

// ---- Grid geometry ----
const HOUR_PX = 48; // 12px per 15 min
const DAY_BODY_H = 24 * HOUR_PX; // 1152px full-day column height
const MIN_BLOCK_H = 14; // keep 0.25h blocks clickable
const SCROLL_TO_MIN = 7 * 60; // open scrolled to 07:00
const DAY_COLS = 7; // the days grid holds 7 columns (no axis inside)

interface MenuState {
  entry: WorkloadEntry;
  x: number;
  y: number;
  step: 'menu' | 'form';
  position: 'before' | 'after';
}

// ---- Draggable / resizable timed block ----

type DragMode = 'move' | 'top' | 'bottom';

interface DragState {
  mode: DragMode;
  originX: number;
  originY: number;
  colWidth: number;
  projStart: number; // projected startMinutes
  projHours: number; // projected plannedHours
  projDayIndex: number; // projected day column (0–6)
  overBin: boolean; // pointer is over the bin panel → strip date/time on drop
  colliding: boolean;
  maxHours: number; // resize cap = baseHours + growAllowance (Infinity when unbudgeted)
  atCap: boolean; // the raw resize projection exceeded maxHours (clamped)
  willMergeWithId: string | null; // neighbor id the drop would fuse into (exact adjacency)
  willMergeEdge: 'top' | 'bottom' | null; // which edge touches the neighbor
}

interface BlockProps {
  state: AppData;
  entry: WorkloadEntry;
  task: Task;
  person: Person;
  project?: Project;
  dayIndex: number;
  days: string[];
  col: number;
  cols: number;
  gridRef: React.RefObject<HTMLDivElement | null>;
  binRef: React.RefObject<HTMLDivElement | null>;
  mergeTargetId: string | null;
  setMergeTargetId: (id: string | null) => void;
  fusedId: string | null;
  setFusedId: (id: string | null) => void;
  editable: boolean;
  onOpen: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

function TimedBlock({
  state,
  entry,
  task,
  person,
  project,
  dayIndex,
  days,
  col,
  cols,
  gridRef,
  binRef,
  mergeTargetId,
  setMergeTargetId,
  fusedId,
  setFusedId,
  editable,
  onOpen,
  onContextMenu,
}: BlockProps) {
  const { dispatch } = useStore();
  const [drag, setDrag] = useState<DragState | null>(null);
  const moved = useRef(false);

  const baseStart = entry.startMinutes;
  const baseHours = entry.plannedHours;

  // Cancel a drag on Escape (prevents a stuck pointer capture; no dispatch).
  useEffect(() => {
    if (!drag) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDrag(null);
        setMergeTargetId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drag, setMergeTargetId]);

  const begin = (mode: DragMode) => (e: React.PointerEvent) => {
    if (e.button !== 0) return; // right/middle button → let the context menu open
    e.stopPropagation();
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // No active pointer (synthetic events) — dragging still works within the block.
    }
    moved.current = false;
    const rect = gridRef.current?.getBoundingClientRect();
    const colWidth = rect ? rect.width / DAY_COLS : 0;
    // Capture the grow allowance ONCE at drag start (state won't change mid-drag).
    // null ⇒ the task has no estimate ⇒ free grow (no cap).
    const allowance = growAllowanceHours(state, entry.id);
    const maxHours = allowance === null ? Infinity : baseHours + allowance;
    setDrag({
      mode,
      originX: e.clientX,
      originY: e.clientY,
      colWidth,
      projStart: baseStart,
      projHours: baseHours,
      projDayIndex: dayIndex,
      overBin: false,
      colliding: false,
      maxHours,
      atCap: false,
      willMergeWithId: null,
      willMergeEdge: null,
    });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const dy = e.clientY - drag.originY;
    const deltaMin = snapToStep((dy / HOUR_PX) * 60);
    const baseEnd = blockEndMinutes(baseStart, baseHours);

    let projStart = baseStart;
    let projHours = baseHours;
    let projDayIndex = dayIndex;
    let overBin = false;

    if (drag.mode === 'move') {
      const dur = baseHours * 60;
      projStart = clampBlockStart(baseStart + deltaMin, dur);
      const dx = e.clientX - drag.originX;
      const dayDelta = drag.colWidth > 0 ? Math.round(dx / drag.colWidth) : 0;
      projDayIndex = Math.max(0, Math.min(DAY_COLS - 1, dayIndex + dayDelta));
      // The bin panel sits outside the days grid; a pointer inside its rect
      // targets the bin instead of a calendar day.
      const binRect = binRef.current?.getBoundingClientRect();
      overBin = binRect
        ? e.clientX >= binRect.left &&
          e.clientX <= binRect.right &&
          e.clientY >= binRect.top &&
          e.clientY <= binRect.bottom
        : false;
    } else if (drag.mode === 'top') {
      // Move the start, keep the end fixed. Min duration one step (0.25h).
      const newStart = Math.max(0, Math.min(baseStart + deltaMin, baseEnd - MINUTE_STEP));
      projStart = newStart;
      projHours = minutesToHours(baseEnd - newStart);
    } else {
      // bottom: change hours only, start fixed.
      const newEnd = Math.max(baseStart + MINUTE_STEP, Math.min(baseEnd + deltaMin, DAY_MINUTES));
      projHours = minutesToHours(newEnd - baseStart);
    }

    // Budget clamp on resize: growth stops at maxHours (bin + headroom). Moving
    // never changes hours, so it is never capped. For a top resize the end stays
    // fixed, so re-derive the start from the clamped hours.
    let atCap = false;
    if (drag.mode !== 'move' && projHours > drag.maxHours + 1e-9) {
      atCap = true;
      projHours = drag.maxHours;
      if (drag.mode === 'top') {
        projStart = baseEnd - hoursToMinutes(projHours);
      }
    }

    if (
      projStart !== baseStart ||
      projHours !== baseHours ||
      projDayIndex !== dayIndex ||
      overBin
    ) {
      moved.current = true;
    }

    // Over the bin there is no date and no collision — dropping just strips the
    // block's date/time.
    const colliding = overBin
      ? false
      : blockCollides(state, person.id, days[projDayIndex], projStart, projHours, entry.id);

    // Will-merge affordance: mirror the reducer's merge predicate exactly — same
    // task, same person, same date, exact adjacency (touching edge), no collision,
    // not over the bin. The drop would fuse into that neighbor.
    let willMergeWithId: string | null = null;
    let willMergeEdge: 'top' | 'bottom' | null = null;
    if (!overBin && !colliding) {
      const projDate = days[projDayIndex];
      const projEnd = blockEndMinutes(projStart, projHours);
      const neighbor = state.workload.find(
        (w) =>
          w.id !== entry.id &&
          w.personId === person.id &&
          w.taskId === entry.taskId &&
          w.date === projDate &&
          (blockEndMinutes(w.startMinutes, w.plannedHours) === projStart ||
            projEnd === w.startMinutes),
      );
      if (neighbor) {
        willMergeWithId = neighbor.id;
        willMergeEdge =
          blockEndMinutes(neighbor.startMinutes, neighbor.plannedHours) === projStart
            ? 'top'
            : 'bottom';
      }
    }
    setMergeTargetId(willMergeWithId);

    setDrag((d) =>
      d
        ? {
            ...d,
            projStart,
            projHours,
            projDayIndex,
            overBin,
            colliding,
            atCap,
            willMergeWithId,
            willMergeEdge,
          }
        : d,
    );
  };

  const finish = () => {
    if (!drag) return;
    const { projStart, projHours, projDayIndex, overBin, colliding, willMergeWithId } = drag;
    setDrag(null);
    setMergeTargetId(null);
    if (!moved.current) return; // treated as a click by onClick
    if (overBin) {
      dispatch({ type: 'MOVE_BLOCK_TO_BIN', entryId: entry.id });
      return;
    }
    if (colliding) return; // invalid drop → snap back (re-render restores it)
    // Merge drop: the reducer keeps the EARLIER-starting block's id. Remember it
    // so the surviving block plays the fuse animation after it re-renders.
    if (willMergeWithId) {
      const neighbor = state.workload.find((w) => w.id === willMergeWithId);
      if (neighbor) {
        setFusedId(projStart < neighbor.startMinutes ? entry.id : neighbor.id);
      }
    }
    dispatch({
      type: 'SET_BLOCK_TIME',
      entryId: entry.id,
      date: days[projDayIndex],
      startMinutes: projStart,
      plannedHours: projHours,
    });
  };

  const start = drag ? drag.projStart : baseStart;
  const hours = drag ? drag.projHours : baseHours;
  const end = blockEndMinutes(start, hours);
  const dayShift = drag ? drag.projDayIndex - dayIndex : 0;
  const tx = drag && dayShift !== 0 ? dayShift * drag.colWidth : 0;

  const top = (start / 60) * HOUR_PX;
  const height = Math.max(MIN_BLOCK_H, hours * HOUR_PX);

  const isMergeTarget = !drag && mergeTargetId === entry.id;
  const className = [
    'week-block',
    editable ? '' : 'readonly',
    drag ? 'dragging' : '',
    drag?.colliding ? 'colliding' : '',
    drag?.overBin ? 'to-bin' : '',
    drag?.atCap ? 'at-cap' : '',
    drag?.willMergeWithId ? 'will-merge' : '',
    drag?.willMergeEdge === 'top' ? 'merge-top' : '',
    drag?.willMergeEdge === 'bottom' ? 'merge-bottom' : '',
    isMergeTarget ? 'will-merge-target' : '',
    fusedId === entry.id ? 'fused' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={className}
      style={{
        top,
        height,
        left: `calc(${(col / cols) * 100}% + 1px)`,
        width: `calc(${100 / cols}% - 3px)`,
        transform: tx ? `translateX(${tx}px)` : undefined,
        borderLeftColor: personColor(person.id),
      }}
      role="button"
      tabIndex={0}
      title={
        !editable
          ? `${task.title} — ${person.name}: ${formatMinutes(start)}–${formatMinutes(end)} (${formatDuration(hours)}).`
          : drag?.atCap
            ? 'Limit czasu zadania — brak godzin w zasobniku'
            : `${task.title} — ${person.name}: ${formatMinutes(start)}–${formatMinutes(end)} (${formatDuration(hours)}). Przeciągnij, aby przenieść; przeciągnij krawędź, aby zmienić czas trwania; kliknij prawym przyciskiem, aby wstawić blok.`
      }
      onPointerDown={editable ? begin('move') : undefined}
      onPointerMove={editable ? onPointerMove : undefined}
      onPointerUp={editable ? finish : undefined}
      onPointerCancel={
        editable
          ? () => {
              setDrag(null);
              setMergeTargetId(null);
            }
          : undefined
      }
      onAnimationEnd={() => {
        if (fusedId === entry.id) setFusedId(null);
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (!moved.current) onOpen();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen();
      }}
      onContextMenu={editable ? onContextMenu : undefined}
    >
      {editable && (
        <span className="week-block-handle top" onPointerDown={begin('top')} aria-hidden />
      )}
      <span className="week-block-title">
        {project && <Coin paid={project.paid} size={12} />}
        {task.title}
      </span>
      <span className="week-block-time">
        {formatMinutes(start)}–{formatMinutes(end)}
      </span>
      <span className="week-block-meta">
        <span
          className="person-dot"
          style={{ background: personColor(person.id) }}
          aria-hidden
        />
        {person.name}
        <span className="week-block-hours">{formatDuration(hours)}</span>
      </span>
      {editable && (
        <span className="week-block-handle bottom" onPointerDown={begin('bottom')} aria-hidden />
      )}
    </div>
  );
}

// ---- Bin card: a dateless block that drags OUT of the bin onto the grid ----

interface BinDragState {
  originX: number;
  originY: number;
  dx: number;
  dy: number;
  colIndex: number; // projected day column (0–6); -1 = not over a day column
  startMin: number; // projected startMinutes
  valid: boolean; // over a real day column
  colliding: boolean;
}

interface BinCardProps {
  state: AppData;
  entry: WorkloadEntry;
  task: Task;
  person: Person;
  project?: Project;
  days: string[];
  gridRef: React.RefObject<HTMLDivElement | null>;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  editable: boolean;
  onOpen: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

function BinCard({
  state,
  entry,
  task,
  person,
  project,
  days,
  gridRef,
  viewportRef,
  editable,
  onOpen,
  onContextMenu,
}: BinCardProps) {
  const { dispatch } = useStore();
  const [drag, setDrag] = useState<BinDragState | null>(null);
  const moved = useRef(false);

  // Cancel the drag on Escape (no dispatch → the card snaps home).
  useEffect(() => {
    if (!drag) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrag(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drag]);

  const begin = (e: React.PointerEvent) => {
    if (e.button !== 0) return; // right button → context menu
    e.stopPropagation();
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // No active pointer (synthetic events) — drag still works.
    }
    moved.current = false;
    setDrag({
      originX: e.clientX,
      originY: e.clientY,
      dx: 0,
      dy: 0,
      colIndex: -1,
      startMin: 0,
      valid: false,
      colliding: false,
    });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const gridRect = gridRef.current?.getBoundingClientRect();
    const viewRect = viewportRef.current?.getBoundingClientRect();
    if (!gridRect || !viewRect) return;
    const dx = e.clientX - drag.originX;
    const dy = e.clientY - drag.originY;
    if (dx !== 0 || dy !== 0) moved.current = true;

    // The days grid starts at 0:00 (no header inside it), so x → column and
    // y → minutes project directly off its rect.
    const colWidth = gridRect.width / DAY_COLS;
    const colIndex = colWidth > 0 ? Math.floor((e.clientX - gridRect.left) / colWidth) : -1;
    // A single clamp — the pointer must be inside the visible days viewport —
    // covers the header row, the axis pane, the bin and any outside-drop cases.
    const inView =
      e.clientX >= viewRect.left &&
      e.clientX <= viewRect.right &&
      e.clientY >= viewRect.top &&
      e.clientY <= viewRect.bottom;
    const valid = inView && colIndex >= 0 && colIndex <= DAY_COLS - 1;

    const dur = entry.plannedHours * 60;
    const relY = e.clientY - gridRect.top;
    const startMin = clampBlockStart(snapToStep((relY / HOUR_PX) * 60), dur);
    const colliding = valid
      ? blockCollides(state, person.id, days[colIndex], startMin, entry.plannedHours)
      : false;

    setDrag((d) => (d ? { ...d, dx, dy, colIndex, startMin, valid, colliding } : d));
  };

  const finish = () => {
    if (!drag) return;
    const { colIndex, startMin, valid, colliding } = drag;
    setDrag(null);
    if (!moved.current) return; // plain click → open
    if (!valid || colliding) return; // invalid target / collision → snap home
    dispatch({
      type: 'SET_BLOCK_TIME',
      entryId: entry.id,
      date: days[colIndex],
      startMinutes: startMin,
      plannedHours: entry.plannedHours,
    });
  };

  const className = [
    'week-bin-block',
    editable ? '' : 'readonly',
    drag ? 'dragging' : '',
    drag?.colliding ? 'colliding' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={className}
      style={{
        borderLeftColor: personColor(person.id),
        transform: drag ? `translate(${drag.dx}px, ${drag.dy}px)` : undefined,
      }}
      role="button"
      tabIndex={0}
      title={
        editable
          ? `${task.title} — ${person.name}: ${formatDuration(entry.plannedHours)} bez terminu. Przeciągnij na siatkę, aby nadać termin.`
          : `${task.title} — ${person.name}: ${formatDuration(entry.plannedHours)} bez terminu.`
      }
      onPointerDown={editable ? begin : undefined}
      onPointerMove={editable ? onPointerMove : undefined}
      onPointerUp={editable ? finish : undefined}
      onPointerCancel={editable ? () => setDrag(null) : undefined}
      onClick={(e) => {
        e.stopPropagation();
        if (!moved.current) onOpen();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen();
      }}
      onContextMenu={editable ? onContextMenu : undefined}
    >
      <span className="week-bin-block-title">
        {project && <Coin paid={project.paid} size={12} />}
        {task.title}
      </span>
      <span className="week-bin-block-hours">{formatDuration(entry.plannedHours)}</span>
    </div>
  );
}

export function WeekView({ state, anchor, filter }: Props) {
  const { openTask } = useOpenTask();
  const { dispatch } = useStore();
  const can = useCan();
  const canEditAny = can('blocks.editAny');
  const canEditOwn = can('blocks.editOwn');
  // A block is editable when the role edits anyone's blocks, or edits its own and
  // this block belongs to the logged-in user. The right-click insert flow lives
  // on the block itself, so it inherits the same rule.
  const canEditEntry = (personId: string): boolean =>
    canEditAny ||
    (canEditOwn && personId === state.currentUserId && state.currentUserId !== '');
  const days = weekDays(anchor);

  const gridRef = useRef<HTMLDivElement | null>(null); // .week-days-grid (7 columns, 0:00 at top)
  const viewportRef = useRef<HTMLDivElement | null>(null); // .week-days-viewport (both scrollbars)
  const axisPaneRef = useRef<HTMLDivElement | null>(null); // .week-axis-pane (vertical scroll synced)
  const headTrackRef = useRef<HTMLDivElement | null>(null); // .week-head-track (horizontal scroll synced)
  const binRef = useRef<HTMLDivElement | null>(null); // .week-bin-pane (grid→bin drop target)

  const [menu, setMenu] = useState<MenuState | null>(null);
  const [hoursRaw, setHoursRaw] = useState('1');
  const [insertTaskId, setInsertTaskId] = useState('');
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Transient cross-block drag state (a dragged block and its merge neighbor live
  // in different day-column component instances). mergeTargetId = the neighbor a
  // drop would fuse into; fusedId = the surviving block that plays the fuse anim.
  const [mergeTargetId, setMergeTargetId] = useState<string | null>(null);
  const [fusedId, setFusedId] = useState<string | null>(null);

  // Fallback clear in case animationend never fires (reduced motion neutralizes
  // the keyframe, and re-parenting can drop the event).
  useEffect(() => {
    if (!fusedId) return;
    const t = setTimeout(() => setFusedId(null), 400);
    return () => clearTimeout(t);
  }, [fusedId]);

  // Open the grid scrolled to ~07:00 (once, on mount).
  useEffect(() => {
    if (viewportRef.current) viewportRef.current.scrollTop = (SCROLL_TO_MIN / 60) * HOUR_PX;
  }, []);

  // Keep the fixed axis pane (vertical) and header track (horizontal) in step
  // with the days viewport — both are overflow:hidden, driven only from here.
  const onViewportScroll = () => {
    const v = viewportRef.current;
    if (!v) return;
    if (axisPaneRef.current) axisPaneRef.current.scrollTop = v.scrollTop;
    if (headTrackRef.current) headTrackRef.current.scrollLeft = v.scrollLeft;
  };

  // Close the context menu on Escape or on any click outside it.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [menu]);

  const openMenu = (entry: WorkloadEntry, e: React.MouseEvent) => {
    e.preventDefault();
    setHoursRaw('1');
    setInsertTaskId(entry.taskId);
    setMenu({
      entry,
      x: Math.min(e.clientX, window.innerWidth - 280),
      y: Math.min(e.clientY, window.innerHeight - 240),
      step: 'menu',
      position: 'after',
    });
  };

  const confirmInsert = () => {
    if (!menu) return;
    const hours = Number(hoursRaw);
    if (Number.isNaN(hours) || hours <= 0) return;
    dispatch({
      type: 'INSERT_BLOCK',
      payload: {
        refEntryId: menu.entry.id,
        position: menu.position,
        taskId: insertTaskId || menu.entry.taskId,
        hours: Math.min(24, hours),
      },
    });
    setMenu(null);
  };

  const doSplit = (parts: 2 | 4) => {
    if (!menu) return;
    dispatch({ type: 'SPLIT_BLOCK', entryId: menu.entry.id, parts });
    setMenu(null);
  };

  const doDelete = () => {
    if (!menu) return;
    if (window.confirm(`Usunąć blok ${formatDuration(menu.entry.plannedHours)} z zasobnika?`)) {
      dispatch({ type: 'DELETE_BLOCK', entryId: menu.entry.id });
    }
    setMenu(null);
  };

  // Bin (zasobnik) content — week-independent, per-person, filtered.
  const inFilter = (id: string) => filter.size === 0 || filter.has(id);
  const binPeople = state.people.filter(
    (p) => inFilter(p.id) && binEntriesForPerson(state, p.id).length > 0,
  );
  const binGrandTotal = binPeople.reduce((s, p) => s + binTotalForPerson(state, p.id), 0);

  // Overload preview for the insert form.
  const menuPerson = menu ? getPerson(state, menu.entry.personId) : undefined;
  // Task picker options for the insert form. Users who can manage tasks pick any
  // task; users limited to their own blocks (blocks.editOwn) may only insert for
  // tasks the block's person is ALREADY assigned to — INSERT_BLOCK auto-assigns,
  // so an unrestricted list would let them self-allocate to arbitrary tasks and
  // bypass the read-only TaskModal. The clicked block's own task is always in
  // this set, so it stays available as the default.
  const insertTaskOptions = (() => {
    if (!menu) return [];
    if (can('tasks.manage')) return state.tasks;
    const allowed = new Set(taskIdsOfPerson(state, menu.entry.personId));
    return state.tasks.filter((t) => allowed.has(t.id));
  })();
  const menuDayHours = menu
    ? hoursForPersonOnDate(state, menu.entry.personId, menu.entry.date)
    : 0;
  const menuCapacity = menu ? personCapacity(state, menu.entry.personId) : 0;
  const parsedHours = Number(hoursRaw);
  const projectedTotal =
    menuDayHours + (Number.isNaN(parsedHours) ? 0 : Math.max(parsedHours, 0));
  const wouldOverload = menu !== null && projectedTotal > menuCapacity;

  const hours = Array.from({ length: 24 }, (_, h) => h);

  return (
    <div className="week-cal">
      {/* Header row: corner + horizontally-synced day headers + bin header.
          Not scrollable itself; its track mirrors the days viewport scrollLeft. */}
      <div className="week-head-row">
        <div className="week-corner" />
        <div className="week-head-track" ref={headTrackRef}>
          <div className="week-head-inner">
            {days.map((d) => {
              const total = dayTotal(state, d, filter);
              const overloadedIds = overloadedPeopleOnDate(state, d, filter);
              const empty = entriesForDate(state, d, filter).length === 0;
              const overloadNames = overloadedIds
                .map((id) => getPerson(state, id)?.name)
                .filter(Boolean)
                .join(', ');
              return (
                <div
                  key={`head-${d}`}
                  className={[
                    'week-day-head',
                    isTodayStr(d) ? 'today' : '',
                    isWeekend(d) ? 'weekend' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <div className="week-col-weekday">
                    {format(parseDate(d), 'EEE', { locale: pl })}
                  </div>
                  <div className="week-col-date">
                    {format(parseDate(d), 'd MMM', { locale: pl })}
                  </div>
                  <div className="week-col-total">{empty ? '—' : formatDuration(total)}</div>
                  {overloadNames && (
                    <div
                      className="week-col-overload"
                      title={`Powyżej dostępności: ${overloadNames}`}
                    >
                      ⚠ {overloadNames}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div className="week-bin-head">
          <div className="week-bin-head-title">Zasobnik</div>
          <div className="week-bin-head-sub">bez terminu</div>
          <div className="week-col-total">
            {binGrandTotal > 0 ? formatDuration(binGrandTotal) : '—'}
          </div>
        </div>
      </div>

      {/* Body: fixed axis pane | scrollable days viewport | always-visible bin. */}
      <div className="week-main">
        <div className="week-axis-pane" ref={axisPaneRef}>
          <div className="week-axis" style={{ height: DAY_BODY_H }}>
            {hours.map((h) => (
              <span key={h} className="week-axis-label" style={{ top: h * HOUR_PX }}>
                {h}:00
              </span>
            ))}
          </div>
        </div>

        <div className="week-days-viewport" ref={viewportRef} onScroll={onViewportScroll}>
          <div className="week-days-grid" ref={gridRef} style={{ height: DAY_BODY_H }}>
            {days.map((d, dayIndex) => {
              const entries = entriesForDate(state, d, filter);
              const packed = packDayBlocks(entries);
              return (
                <div
                  key={`col-${d}`}
                  className={[
                    'week-day-col',
                    isTodayStr(d) ? 'today' : '',
                    isWeekend(d) ? 'weekend' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {packed.map(({ block: e, col, cols }) => {
                    const task = getTask(state, e.taskId);
                    const person = getPerson(state, e.personId);
                    if (!task || !person) return null;
                    const project = getProject(state, task.projectId);
                    return (
                      <TimedBlock
                        key={e.id}
                        state={state}
                        entry={e}
                        task={task}
                        person={person}
                        project={project}
                        dayIndex={dayIndex}
                        days={days}
                        col={col}
                        cols={cols}
                        gridRef={gridRef}
                        binRef={binRef}
                        mergeTargetId={mergeTargetId}
                        setMergeTargetId={setMergeTargetId}
                        fusedId={fusedId}
                        setFusedId={setFusedId}
                        editable={canEditEntry(e.personId)}
                        onOpen={() => openTask(task.id)}
                        onContextMenu={(ev) => openMenu(e, ev)}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* Bin pane: always visible, own vertical scroll, outside the days scroller. */}
        <div className="week-bin-pane" ref={binRef}>
          <div className="week-bin-col">
            {binPeople.length === 0 ? (
              <p className="week-bin-empty">Brak bloków bez terminu</p>
            ) : (
              binPeople.map((p) => {
                const entries = binEntriesForPerson(state, p.id);
                return (
                  <div key={`bin-${p.id}`} className="week-bin-group">
                    <div className="week-bin-group-head">
                      <span
                        className="person-dot"
                        style={{ background: personColor(p.id) }}
                        aria-hidden
                      />
                      {p.name}
                      <span className="week-bin-group-total">
                        {formatDuration(binTotalForPerson(state, p.id))}
                      </span>
                    </div>
                    {entries.map((e) => {
                      const task = getTask(state, e.taskId);
                      if (!task) return null;
                      const project = getProject(state, task.projectId);
                      return (
                        <BinCard
                          key={e.id}
                          state={state}
                          entry={e}
                          task={task}
                          person={p}
                          project={project}
                          days={days}
                          gridRef={gridRef}
                          viewportRef={viewportRef}
                          editable={canEditEntry(p.id)}
                          onOpen={() => openTask(task.id)}
                          onContextMenu={(ev) => openMenu(e, ev)}
                        />
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {menu && (
          <motion.div
            ref={menuRef}
            className="context-menu"
            style={{ left: menu.x, top: menu.y, transformOrigin: 'top left' }}
            role="menu"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.12, ease: 'easeOut' }}
          >
            {menu.step === 'menu' ? (
            <>
              <div className="context-menu-title">
                {getTask(state, menu.entry.taskId)?.title} — {menuPerson?.name},{' '}
                {formatDuration(menu.entry.plannedHours)}
              </div>
              {!isBinEntry(menu.entry) && (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    className="context-menu-item"
                    onClick={() => setMenu({ ...menu, step: 'form', position: 'before' })}
                  >
                    ↑ Dodaj przed
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="context-menu-item"
                    onClick={() => setMenu({ ...menu, step: 'form', position: 'after' })}
                  >
                    ↓ Dodaj po
                  </button>
                  <div className="context-menu-sep" role="separator" />
                  {/* Split only applies to dated blocks — SPLIT_BLOCK no-ops on a
                      bin entry (one-bin-row-per-(task,person) invariant). */}
                  <button
                    type="button"
                    role="menuitem"
                    className="context-menu-item"
                    disabled={menu.entry.plannedHours < 0.5}
                    title={
                      menu.entry.plannedHours < 0.5
                        ? 'Blok jest za krótki, aby go podzielić'
                        : undefined
                    }
                    onClick={() => doSplit(2)}
                  >
                    Podziel na pół
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="context-menu-item"
                    disabled={menu.entry.plannedHours < 1}
                    title={
                      menu.entry.plannedHours < 1
                        ? 'Blok jest za krótki, aby go podzielić'
                        : undefined
                    }
                    onClick={() => doSplit(4)}
                  >
                    Podziel na ćwiartki
                  </button>
                </>
              )}
              {isBinEntry(menu.entry) && (
                <button
                  type="button"
                  role="menuitem"
                  className="context-menu-item danger"
                  onClick={doDelete}
                >
                  Usuń blok
                </button>
              )}
            </>
          ) : (
            <div className="context-insert-form">
              <div className="context-menu-title">
                Wstaw {menu.position === 'before' ? 'przed' : 'po'} dla {menuPerson?.name}
              </div>
              <label className="context-field">
                Zadanie
                <select
                  value={insertTaskId}
                  onChange={(e) => setInsertTaskId(e.target.value)}
                >
                  {insertTaskOptions.map((t) => {
                    const proj = getProject(state, t.projectId);
                    const client = proj ? getClient(state, proj.clientId) : undefined;
                    return (
                      <option key={t.id} value={t.id}>
                        {t.title}
                        {client ? ` (${client.name})` : ''}
                      </option>
                    );
                  })}
                </select>
              </label>
              <label className="context-field">
                Godziny
                <input
                  type="number"
                  min={0.25}
                  max={24}
                  step={0.25}
                  value={hoursRaw}
                  onChange={(e) => setHoursRaw(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') confirmInsert();
                  }}
                />
              </label>
              {wouldOverload && (
                <p className="context-warning">
                  ⚠ {menuPerson?.name} będzie mieć {formatDuration(projectedTotal)} — powyżej dostępności{' '}
                  {formatDuration(menuCapacity)}/dzień.
                </p>
              )}
              <div className="context-actions">
                <button
                  type="button"
                  className="btn primary"
                  onClick={confirmInsert}
                  disabled={Number.isNaN(parsedHours) || parsedHours <= 0}
                >
                  Wstaw
                </button>
                <button type="button" className="btn ghost" onClick={() => setMenu(null)}>
                  Anuluj
                </button>
              </div>
            </div>
          )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
