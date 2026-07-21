// Week view: a Google-Calendar-style timed day grid. A left hour axis (0:00–24:00)
// and 7 day columns; each person's time blocks are absolutely positioned by
// `startMinutes` with height proportional to `plannedHours`. Blocks drag to move
// (same day or cross-day) and edge-drag to resize on a 15-min grid; a same-person
// time overlap shows a danger tint and the drop reverts. Right-clicking a block
// still opens "Dodaj przed / Dodaj po" to ripple-insert a new block.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import type { AppData, Person, Project, Task, WorkloadEntry } from '../types';
import { useStore } from '../store/AppStore';
import { useCan } from '../store/useCan';
import { useOpenTask } from './TaskModal';
import { useOpenEvent } from './EventModal';
import { personColor } from '../utils/colors';
import { clearLiveSyncHold, setLiveSyncHold } from '../utils/liveSyncGate';
import {
  MAX_TASK_PERIOD_DAYS,
  inclusiveDayCount,
  isTodayStr,
  isValidDateStr,
  isWeekend,
  parseDate,
  todayStr,
  weekDays,
} from '../utils/dates';
import { format } from 'date-fns';
import { pl } from 'date-fns/locale/pl';
import {
  assigneeIdsOfTask,
  availableHoursOnDate,
  binEntriesForPerson,
  binTotalForPerson,
  blockCollides,
  blocksForPersonDate,
  blockIsDone,
  calendarEventsForDate,
  type CalendarEventOccurrence,
  dayTotal,
  entriesForDate,
  getClient,
  getPerson,
  getProject,
  getTask,
  growAllowanceHours,
  hoursForPersonOnDate,
  overloadedPeopleOnDate,
  peopleWithBirthdayOnDate,
  personCapacity,
  recurrenceOccurrencesForDate,
  taskDisplayStatus,
  taskGrowAllowance,
  taskIdsOfPerson,
} from '../store/selectors';
import {
  DAY_MINUTES,
  HOURS_STEP,
  MINUTE_STEP,
  blockEndMinutes,
  clampBlockStart,
  findFreeStart,
  formatDuration,
  formatMinutes,
  hoursToMinutes,
  isBinEntry,
  minutesToHours,
  nextFreeStart,
  planRippleInsert,
  packDayBlocks,
  slotStartFromOffset,
  snapHours,
  snapToStep,
} from '../utils/time';
import type { RecurrenceOccurrence } from '../utils/recurrence';
import { Coin } from './Coin';

interface Props {
  state: AppData;
  anchor: string; // any date within the week to render
  filter: Set<string>;
}

// ---- Grid geometry ----
// 21px per 15 min: ~8 hours fit one viewport (e.g. 08:00–16:00), the rest
// scrolls; 15/30-minute blocks render at 21/42px so their labels stay legible
// instead of being clamped by MIN_BLOCK_H. Mirrored by the hour/quarter grid
// lines in styles.css (.week-day-col) and scripts/browser-check-bin-drag.mjs.
const HOUR_PX = 84;
const DAY_BODY_H = 24 * HOUR_PX; // 2016px full-day column height
// Krótkie bloki dostają minimalną CZYTELNĄ wysokość (15 min ≥ dawne 30 min
// + 8px), nawet jeśli wizualnie zachodzą na kolejny kwadrans siatki —
// geometria dragu/resize liczy się z pozycji kursora, nie z wysokości bloku.
const MIN_BLOCK_H = 50;
const SCROLL_TO_MIN = 8 * 60; // open scrolled to 08:00
const DAY_COLS = 7; // the days grid holds 7 columns (no axis inside)
// Duration choices for a recurrence occurrence override: 0:15…8:00 on the
// 15-minute grid (minutes). Labeled via formatDuration in the menu.
const RECUR_DURATION_OPTIONS = Array.from({ length: 32 }, (_, i) => (i + 1) * MINUTE_STEP);

/** Announces a successful real calendar action to the optional guided practice. */
function announceCalendarPractice(kind: 'move' | 'resize' | 'bin-drop'): void {
  window.dispatchEvent(new CustomEvent('n2hub:calendar-practice', { detail: { kind } }));
}

interface MenuState {
  entry: WorkloadEntry;
  x: number;
  y: number;
  step: 'menu' | 'form' | 'schedule';
  position: 'before' | 'after';
}

// "HH:MM" ↔ minutes-from-midnight, zero-padded for the native <input type="time">.
function timeToMinutes(value: string): number {
  const [h, m] = value.split(':');
  return Number(h) * 60 + Number(m);
}
function minutesToTimeStr(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Polski dopisek do tooltipa bloku/karty opisujący status zadania. Pusty dla
 * zadania w toku — tooltip zostaje wtedy dokładnie taki jak wcześniej.
 */
function statusNoteFor(status: 'done' | 'overdue' | 'open', endDate: string): string {
  if (status === 'done') return ' Zadanie zakończone.';
  if (status !== 'overdue') return '';
  const termin = isValidDateStr(endDate)
    ? ` (termin: ${format(parseDate(endDate), 'd MMM yyyy', { locale: pl })})`
    : '';
  return ` Zadanie po terminie${termin}.`;
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
  // React state drives the preview, while this ref is the synchronous source of
  // truth for pointer handlers. A final pointermove and pointerup can arrive in
  // one render frame; reading only `drag` in finish() would then commit the
  // previous projection (or no-op), even though the preview already moved.
  const dragRef = useRef<DragState | null>(null);
  const moved = useRef(false);
  // Pointer-capture bookkeeping — released before any dispatch (a drop-to-bin
  // unmounts this block; releasing after would wedge document-wide pointer
  // delivery, matching the bin-card freeze fix).
  const captureRef = useRef<{ el: HTMLElement; pointerId: number } | null>(null);
  const releaseCapture = () => {
    const c = captureRef.current;
    if (c) {
      try {
        c.el.releasePointerCapture(c.pointerId);
      } catch {
        // Already released — ignore.
      }
      captureRef.current = null;
    }
  };

  // Revert an in-flight drag with no dispatch — the shared cancel path for
  // Escape, pointercancel, window blur, tab hide and a mouse released outside the
  // window. Releases pointer capture defensively, drops the synchronous ref and
  // the React preview, and clears the cross-column merge affordance.
  const cancelDrag = () => {
    releaseCapture();
    dragRef.current = null;
    setDrag(null);
    setMergeTargetId(null);
  };

  const baseStart = entry.startMinutes;
  const baseHours = entry.plannedHours;

  // While a drag is live, cancel it (revert, no dispatch) on Escape, on window
  // blur, or when the tab is hidden — mirroring BinCard's interruption guards so
  // a drop after focus loss cannot commit and a swallowed pointerup cannot leave
  // the block re-projecting under the cursor. Gate on the drag's truthiness, not
  // the per-frame `drag` object, so these listeners subscribe once at drag start
  // and unsubscribe once at drag end; each handler reverts via cancelDrag, which
  // reads the live drag through dragRef.
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelDrag();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') cancelDrag();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', cancelDrag);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', cancelDrag);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [dragging, setMergeTargetId]);

  // Odświeżenie w tle (Realtime) czeka na koniec przeciągania: autorytatywne
  // scalenie w locie podmieniłoby `entry` pod kursorem albo odmontowało ten
  // blok razem z przechwyceniem wskaźnika. Sprzątanie zdejmuje blokadę także
  // przy odmontowaniu w trakcie przeciągania.
  const holdKey = useRef({}).current;
  useEffect(() => {
    setLiveSyncHold(holdKey, dragging);
    return () => clearLiveSyncHold(holdKey);
  }, [dragging, holdKey]);

  const begin = (mode: DragMode) => (e: React.PointerEvent) => {
    if (e.button !== 0) return; // right/middle button → let the context menu open
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    try {
      el.setPointerCapture(e.pointerId);
      captureRef.current = { el, pointerId: e.pointerId };
    } catch {
      // No active pointer (synthetic events) — dragging still works within the block.
      captureRef.current = null;
    }
    moved.current = false;
    const rect = gridRef.current?.getBoundingClientRect();
    const colWidth = rect ? rect.width / DAY_COLS : 0;
    // Capture the grow allowance ONCE at drag start (state won't change mid-drag).
    // Always a number now: bin hours + headroom (0 for null-estimate tasks).
    const maxHours = baseHours + growAllowanceHours(state, entry.id);
    const nextDrag: DragState = {
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
    };
    dragRef.current = nextDrag;
    setDrag(nextDrag);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const activeDrag = dragRef.current;
    if (!activeDrag) return;
    // Interruption recovery, mirroring BinCard.move: a mouse released OUTSIDE the
    // window delivers its next real pointermove with no buttons pressed even
    // though this element never received a pointerup — treat that as a cancel
    // (revert). The `type === 'pointermove'` gate is load-bearing: finish()
    // re-invokes this handler with the pointerup event to project the final drop
    // synchronously, and that event's buttons are legitimately 0 — it must still
    // commit, so only a genuine pointermove may trigger the cancel.
    if (e.type === 'pointermove' && e.pointerType === 'mouse' && e.buttons === 0) {
      cancelDrag();
      return;
    }
    const dy = e.clientY - activeDrag.originY;
    const deltaMin = snapToStep((dy / HOUR_PX) * 60);
    const baseEnd = blockEndMinutes(baseStart, baseHours);

    let projStart = baseStart;
    let projHours = baseHours;
    let projDayIndex = dayIndex;
    let overBin = false;

    if (activeDrag.mode === 'move') {
      const dur = baseHours * 60;
      projStart = clampBlockStart(baseStart + deltaMin, dur);
      const dx = e.clientX - activeDrag.originX;
      const dayDelta = activeDrag.colWidth > 0 ? Math.round(dx / activeDrag.colWidth) : 0;
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
    } else if (activeDrag.mode === 'top') {
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
    if (activeDrag.mode !== 'move' && projHours > activeDrag.maxHours + 1e-9) {
      atCap = true;
      projHours = activeDrag.maxHours;
      if (activeDrag.mode === 'top') {
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

    const nextDrag: DragState = {
      ...activeDrag,
      projStart,
      projHours,
      projDayIndex,
      overBin,
      colliding,
      atCap,
      willMergeWithId,
      willMergeEdge,
    };
    dragRef.current = nextDrag;
    setDrag(nextDrag);
  };

  const finish = (e: React.PointerEvent) => {
    // Project the pointer-up coordinates synchronously. Browsers do not promise
    // a separate final pointermove, and React may batch that move with pointerup.
    onPointerMove(e);
    const finalDrag = dragRef.current;
    if (!finalDrag) return;
    const { projStart, projHours, projDayIndex, overBin, colliding, willMergeWithId } = finalDrag;
    // Release capture before dispatch — a drop-to-bin unmounts this block.
    releaseCapture();
    dragRef.current = null;
    setDrag(null);
    setMergeTargetId(null);
    if (!moved.current) return; // treated as a click by onClick
    if (overBin) {
      dispatch({ type: 'MOVE_BLOCK_TO_BIN', entryId: entry.id });
      announceCalendarPractice('move');
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
    announceCalendarPractice(finalDrag.mode === 'move' ? 'move' : 'resize');
  };

  const start = drag ? drag.projStart : baseStart;
  const hours = drag ? drag.projHours : baseHours;
  const end = blockEndMinutes(start, hours);
  const dayShift = drag ? drag.projDayIndex - dayIndex : 0;
  const tx = drag && dayShift !== 0 ? dayShift * drag.colWidth : 0;

  const top = (start / 60) * HOUR_PX;
  const height = Math.max(MIN_BLOCK_H, hours * HOUR_PX);

  const isMergeTarget = !drag && mergeTargetId === entry.id;
  // Status zadania jest czysto prezentacyjny: zielony odcień dla zakończonych,
  // czerwony akcent po terminie. Kolor osoby zostaje na lewej krawędzi (styl
  // inline), a klasy dragu/kolizji są w CSS PÓŹNIEJ, więc nadal wygrywają.
  const status = taskDisplayStatus(state, task, todayStr());
  // Per-block completion is INDEPENDENT of the task status: a block is done when
  // it carries its own flag OR the task status is done. Two blocks on the same
  // day render independent done state.
  const done = blockIsDone(state, task, entry);
  const statusNote = statusNoteFor(status, task.endDate);
  const className = [
    'week-block',
    done ? 'done' : '',
    status === 'overdue' && !done ? 'overdue' : '',
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
      data-tour="calendar.block"
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
          ? `${task.title} — ${person.name}: ${formatMinutes(start)}–${formatMinutes(end)} (${formatDuration(hours)}).${statusNote}`
          : drag?.atCap
            ? 'Limit czasu zadania — brak godzin w zasobniku'
            : `${task.title} — ${person.name}: ${formatMinutes(start)}–${formatMinutes(end)} (${formatDuration(hours)}).${statusNote} Przeciągnij, aby przenieść; przeciągnij krawędź, aby zmienić czas trwania; kliknij prawym przyciskiem, aby wstawić blok.`
      }
      onPointerDown={editable ? begin('move') : undefined}
      onPointerMove={editable ? onPointerMove : undefined}
      onPointerUp={editable ? finish : undefined}
      onPointerCancel={editable ? cancelDrag : undefined}
      onAnimationEnd={() => {
        if (fusedId === entry.id) setFusedId(null);
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (!moved.current) onOpen();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      onContextMenu={editable ? onContextMenu : undefined}
    >
      {editable && (
        <span className="week-block-handle top" onPointerDown={begin('top')} aria-hidden />
      )}
      <span className="week-block-title">
        {project && <Coin paid={project.paid} size={12} />}
        {task.title}
        {entry.done === true && (
          <span className="block-done-mark" title="Wykonane" aria-label="Wykonane">
            ✓
          </span>
        )}
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
  clientX: number; // current pointer position (drives the fixed ghost)
  clientY: number;
  grabX: number; // pointer offset within the card at drag begin (keeps the ghost aligned)
  grabY: number;
  width: number; // card offsetWidth captured at begin (ghost keeps its size out of flow)
  colIndex: number; // projected day column (0–6); -1 = not over a day column
  startMin: number; // projected startMinutes
  valid: boolean; // over a real day column
  colliding: boolean;
  hasMoved: boolean;
}

interface BinDragListeners {
  pointerId: number;
  move: (e: PointerEvent) => void;
  up: (e: PointerEvent) => void;
  mouseUp: (e: MouseEvent) => void;
  cancel: (e: PointerEvent) => void;
  blur: () => void;
  keydown: (e: KeyboardEvent) => void;
  visibilityChange: () => void;
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
  onSchedule: (anchor: HTMLElement) => void;
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
  onSchedule,
}: BinCardProps) {
  const { dispatch } = useStore();
  const [drag, setDrag] = useState<BinDragState | null>(null);
  // See TimedBlock.dragRef: the drop must commit the newest pointer projection,
  // even when pointermove and pointerup are delivered before React re-renders.
  const dragRef = useRef<BinDragState | null>(null);
  const moved = useRef(false);
  const cardRef = useRef<HTMLDivElement | null>(null);
  // Bin drags intentionally do not depend on element pointer capture. A valid
  // drop unmounts the source card, and browsers may also lose/reject capture at
  // viewport boundaries. Window listeners keep ownership of the gesture until
  // one idempotent finish/cancel path removes every listener and the ghost.
  const listenersRef = useRef<BinDragListeners | null>(null);
  const removeWindowListeners = () => {
    const listeners = listenersRef.current;
    if (!listeners) return;
    window.removeEventListener('pointermove', listeners.move, true);
    window.removeEventListener('pointerup', listeners.up, true);
    window.removeEventListener('mouseup', listeners.mouseUp, true);
    window.removeEventListener('pointercancel', listeners.cancel, true);
    window.removeEventListener('blur', listeners.blur);
    window.removeEventListener('keydown', listeners.keydown);
    document.removeEventListener('visibilitychange', listeners.visibilityChange);
    listenersRef.current = null;
  };

  // A bin row wider than a day (or off the 15-min/0.25h grid) can NEVER be
  // dropped — the reducer rejects it (SET_BLOCK_TIME > 24h / off-quarter). Flag
  // it so the drag shows the danger tint the whole time and reverts cleanly.
  const quarters = entry.plannedHours * 4;
  const unplaceable =
    !Number.isFinite(entry.plannedHours) ||
    entry.plannedHours < 0.25 ||
    entry.plannedHours > 24 ||
    Math.abs(quarters - Math.round(quarters)) > 1e-9;
  // The row can produce a valid part (≥ one quarter, finite) → the schedule
  // button/menu item is offered and the hints point at „Zaplanuj część”.
  const canSchedule =
    Number.isFinite(entry.plannedHours) && Math.round(entry.plannedHours / HOURS_STEP) >= 1;
  const unplaceableHint =
    entry.plannedHours > 24
      ? 'Blok jest dłuższy niż doba — użyj „Zaplanuj część”, aby zaplanować fragment.'
      : canSchedule
        ? 'Nieprawidłowy czas trwania — użyj „Zaplanuj część”, aby zaplanować poprawny fragment.'
        : 'Nieprawidłowy czas trwania — usuń blok albo popraw godziny w edytorze zadania.';

  // Unmount/navigation during a drag must never leave document-wide listeners.
  useEffect(() => {
    return () => {
      removeWindowListeners();
      dragRef.current = null;
    };
  }, []);

  // Jak w TimedBlock: odświeżenie w tle czeka na koniec przeciągania z zasobnika.
  const holdKey = useRef({}).current;
  const dragging = drag !== null;
  useEffect(() => {
    setLiveSyncHold(holdKey, dragging);
    return () => clearLiveSyncHold(holdKey);
  }, [dragging, holdKey]);

  const projectPointer = (clientX: number, clientY: number): BinDragState | null => {
    const activeDrag = dragRef.current;
    if (!activeDrag) return null;
    const grid = gridRef.current;
    const viewport = viewportRef.current;
    const gridRect = grid?.getBoundingClientRect();
    const viewRect = viewport?.getBoundingClientRect();
    const dx = clientX - activeDrag.originX;
    const dy = clientY - activeDrag.originY;
    const hasMoved = activeDrag.hasMoved || dx !== 0 || dy !== 0;
    if (hasMoved) moved.current = true;

    let colIndex = -1;
    let valid = false;
    let startMin = activeDrag.startMin;
    let colliding = false;

    if (grid && viewport && gridRect && viewRect) {
      // Hit-test the actual rendered column. Width division + Math.floor was
      // ambiguous on fractional-pixel separators and could pick the other day.
      const hit = document.elementFromPoint(clientX, clientY);
      let dayColumn = hit instanceof Element
        ? hit.closest<HTMLElement>('.week-day-col[data-day-index]')
        : null;
      // A one-device-pixel separator may hit the grid background rather than a
      // child. Fall back to the real column rectangles (not an averaged width),
      // using half-open ranges so the boundary belongs to the column on the right.
      if (!dayColumn) {
        const columns = Array.from(
          grid.querySelectorAll<HTMLElement>('.week-day-col[data-day-index]'),
        );
        dayColumn =
          columns.find((column, index) => {
            const rect = column.getBoundingClientRect();
            const withinX =
              clientX >= rect.left &&
              (clientX < rect.right || (index === columns.length - 1 && clientX <= rect.right));
            return withinX && clientY >= rect.top && clientY < rect.bottom;
          }) ?? null;
      }
      const hitIndex = Number(dayColumn?.dataset.dayIndex ?? NaN);
      // clientWidth/clientHeight exclude classic scrollbars; the outer rect
      // does not. A release on a scrollbar must cancel, never schedule work.
      const contentRight = viewRect.left + viewport.clientWidth;
      const contentBottom = viewRect.top + viewport.clientHeight;
      const inVisibleViewport =
        clientX >= viewRect.left &&
        clientX < contentRight &&
        clientY >= viewRect.top &&
        clientY < contentBottom;
      valid =
        inVisibleViewport &&
        dayColumn !== null &&
        grid.contains(dayColumn) &&
        Number.isInteger(hitIndex) &&
        hitIndex >= 0 &&
        hitIndex < DAY_COLS;
      colIndex = valid ? hitIndex : -1;

      const dur = entry.plannedHours * 60;
      const relY = clientY - gridRect.top;
      startMin = clampBlockStart(snapToStep((relY / HOUR_PX) * 60), dur);
      colliding = unplaceable
        ? true
        : valid
          ? blockCollides(state, person.id, days[colIndex], startMin, entry.plannedHours)
          : false;
    }

    const nextDrag: BinDragState = {
      ...activeDrag,
      clientX,
      clientY,
      colIndex,
      startMin,
      valid,
      colliding,
      hasMoved,
    };
    dragRef.current = nextDrag;
    setDrag(nextDrag);
    return nextDrag;
  };

  const cancelDrag = () => {
    if (!dragRef.current && !listenersRef.current) return;
    removeWindowListeners();
    dragRef.current = null;
    setDrag(null);
  };

  const finishDrag = (clientX: number, clientY: number) => {
    const finalDrag = projectPointer(clientX, clientY);
    if (!finalDrag) {
      removeWindowListeners();
      return;
    }
    // Cleanup happens before dispatch because a successful drop unmounts this
    // component. Invalid/colliding drops take the exact same guaranteed path.
    removeWindowListeners();
    dragRef.current = null;
    setDrag(null);
    if (!moved.current) return; // plain click → onClick opens the task
    if (!finalDrag.valid || finalDrag.colliding) return; // snap back to bin
    dispatch({
      type: 'SET_BLOCK_TIME',
      entryId: entry.id,
      date: days[finalDrag.colIndex],
      startMinutes: finalDrag.startMin,
      plannedHours: entry.plannedHours,
    });
    announceCalendarPractice('bin-drop');
  };

  const begin = (e: React.PointerEvent) => {
    if (e.button !== 0) return; // right button → context menu
    e.stopPropagation();
    removeWindowListeners();
    moved.current = false;
    // Capture the card geometry once so the fixed ghost keeps its size and stays
    // aligned under the cursor (the in-pane original stays put and dims).
    const rect = cardRef.current?.getBoundingClientRect();
    const nextDrag: BinDragState = {
      originX: e.clientX,
      originY: e.clientY,
      clientX: e.clientX,
      clientY: e.clientY,
      grabX: rect ? e.clientX - rect.left : 0,
      grabY: rect ? e.clientY - rect.top : 0,
      width: rect ? rect.width : 0,
      colIndex: -1,
      startMin: 0,
      valid: false,
      colliding: false,
      hasMoved: false,
    };
    dragRef.current = nextDrag;
    setDrag(nextDrag);

    const pointerId = e.pointerId;
    const pointerType = e.pointerType;
    const listeners: BinDragListeners = {
      pointerId,
      move: (event) => {
        if (event.pointerId !== pointerId) return;
        // Recovery for a mouse released outside the browser: the next move has
        // no pressed buttons even when pointerup never reached this window.
        if (pointerType === 'mouse' && event.buttons === 0) {
          cancelDrag();
          return;
        }
        event.preventDefault();
        projectPointer(event.clientX, event.clientY);
      },
      up: (event) => {
        if (event.pointerId !== pointerId) return;
        finishDrag(event.clientX, event.clientY);
      },
      mouseUp: (event) => {
        if (pointerType !== 'mouse') return;
        finishDrag(event.clientX, event.clientY);
      },
      cancel: (event) => {
        if (event.pointerId === pointerId) cancelDrag();
      },
      blur: cancelDrag,
      keydown: (event) => {
        if (event.key === 'Escape') cancelDrag();
      },
      visibilityChange: () => {
        if (document.visibilityState === 'hidden') cancelDrag();
      },
    };
    listenersRef.current = listeners;
    window.addEventListener('pointermove', listeners.move, { capture: true, passive: false });
    window.addEventListener('pointerup', listeners.up, true);
    window.addEventListener('mouseup', listeners.mouseUp, true);
    window.addEventListener('pointercancel', listeners.cancel, true);
    window.addEventListener('blur', listeners.blur);
    window.addEventListener('keydown', listeners.keydown);
    document.addEventListener('visibilitychange', listeners.visibilityChange);
  };

  // In-pane original stays mounted for click/context-menu semantics and dims
  // while window listeners own the drag. The visible card following the
  // pointer is a fixed portal ghost, so the bin pane cannot clip it.
  const status = taskDisplayStatus(state, task, todayStr());
  const done = blockIsDone(state, task, entry);
  const statusNote = statusNoteFor(status, task.endDate);
  const className = [
    'week-bin-block',
    done ? 'done' : '',
    status === 'overdue' && !done ? 'overdue' : '',
    editable ? '' : 'readonly',
    drag ? 'drag-source' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const content = (
    <>
      <span className="week-bin-block-title">
        {project && <Coin paid={project.paid} size={12} />}
        {task.title}
        {entry.done === true && (
          <span className="block-done-mark" title="Wykonane" aria-label="Wykonane">
            ✓
          </span>
        )}
      </span>
      <span className="week-bin-block-hours">{formatDuration(entry.plannedHours)}</span>
    </>
  );

  return (
    <>
      <div
        ref={cardRef}
        className={className}
        data-tour="calendar.bin-card"
        style={{ borderLeftColor: personColor(person.id) }}
        role="button"
        tabIndex={0}
        title={
          editable
            ? unplaceable
              ? `${task.title} — ${person.name}: ${formatDuration(entry.plannedHours)} bez terminu.${statusNote} ${unplaceableHint}`
              : `${task.title} — ${person.name}: ${formatDuration(entry.plannedHours)} bez terminu.${statusNote} Przeciągnij na siatkę albo użyj „Zaplanuj część”.`
            : `${task.title} — ${person.name}: ${formatDuration(entry.plannedHours)} bez terminu.${statusNote}`
        }
        onPointerDown={editable ? begin : undefined}
        onClick={(e) => {
          e.stopPropagation();
          if (!moved.current) onOpen();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen();
          }
        }}
        onContextMenu={editable ? onContextMenu : undefined}
      >
        {content}
        {editable && canSchedule && (
          <div className="week-bin-block-actions">
            <button
              type="button"
              className="week-bin-schedule-btn"
              title={`Zaplanuj część: ${task.title} — ${person.name}, ${formatDuration(entry.plannedHours)} w zasobniku`}
              aria-label={`Zaplanuj część: ${task.title} — ${person.name}, ${formatDuration(entry.plannedHours)} w zasobniku`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onSchedule(e.currentTarget);
              }}
              onKeyDown={(e) => e.stopPropagation()}
            >
              Zaplanuj część
            </button>
          </div>
        )}
      </div>
      {drag &&
        createPortal(
          <div
            className={[
              'week-bin-block',
              'week-bin-ghost',
              done ? 'done' : '',
              status === 'overdue' && !done ? 'overdue' : '',
              drag.colliding || (drag.hasMoved && !drag.valid) ? 'colliding' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{
              left: drag.clientX - drag.grabX,
              top: drag.clientY - drag.grabY,
              width: drag.width || undefined,
              borderLeftColor: personColor(person.id),
            }}
            aria-hidden
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}

// ---- Recurring-task occurrence overlay (presentational only) ----
// A recurring task's occurrence rendered as a visually distinct, purely
// presentational block. NO pointer/drag/resize handlers (invariant 1 + 7): it
// never enters packDayBlocks/collision/totals and never sits on top of a real
// block. Only click/keyboard opens the task and right-click opens the recurrence
// menu — no pointer lifecycle whatsoever.
interface RecurBlockProps {
  title: string;
  hue: string;
  occurrence: RecurrenceOccurrence;
  onOpen: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

function RecurBlock({ title, hue, occurrence, onOpen, onContextMenu }: RecurBlockProps) {
  const top = (occurrence.startMinutes / 60) * HOUR_PX;
  const height = Math.max((occurrence.durationMinutes / 60) * HOUR_PX, MIN_BLOCK_H);
  const end = occurrence.startMinutes + occurrence.durationMinutes;
  const className = ['week-recur-block', occurrence.overridden ? 'overridden' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <div
      className={className}
      style={{ top, height, borderColor: hue }}
      role="button"
      tabIndex={0}
      title={`⟳ ${title} — cykliczne: ${formatMinutes(occurrence.startMinutes)}–${formatMinutes(
        end,
      )} (${formatDuration(
        occurrence.durationMinutes / 60,
      )}). Kliknij, aby otworzyć zadanie; kliknij prawym przyciskiem, aby edytować wystąpienie.`}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      onContextMenu={onContextMenu}
    >
      <span className="week-recur-title">⟳ {title}</span>
      <span className="week-recur-time">
        {formatMinutes(occurrence.startMinutes)}–{formatMinutes(end)}
      </span>
    </div>
  );
}

// ---- Calendar-event block (presentational only) ----
// A calendar event / meeting rendered as a visually distinct, purely
// presentational block (inwariant 1 + 7): it never enters
// packDayBlocks/collision/totals and has NO pointer/drag handlers. Only
// click/keyboard opens the event modal; right-click is guarded upstream so it
// never opens the slot menu on top of it.
interface EventBlockProps {
  occ: CalendarEventOccurrence;
  onOpen: () => void;
}

function EventBlock({ occ, onOpen }: EventBlockProps) {
  const top = (occ.startMinutes / 60) * HOUR_PX;
  const height = Math.max((occ.durationMinutes / 60) * HOUR_PX, MIN_BLOCK_H);
  const end = occ.startMinutes + occ.durationMinutes;
  return (
    <div
      className="week-event-block"
      style={{ top, height }}
      role="button"
      tabIndex={0}
      title={`📅 ${occ.event.title} — ${formatMinutes(occ.startMinutes)}–${formatMinutes(
        end,
      )}. Kliknij, aby otworzyć wydarzenie.`}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <span className="week-event-title">📅 {occ.event.title}</span>
      <span className="week-event-time">
        {formatMinutes(occ.startMinutes)}–{formatMinutes(end)}
      </span>
    </div>
  );
}

export function WeekView({ state, anchor, filter }: Props) {
  const { openTask, openNewTask } = useOpenTask();
  const { openEvent, openNewEvent } = useOpenEvent();
  const { dispatch } = useStore();
  const can = useCan();
  const canEditAny = can('blocks.editAny');
  const canEditOwn = can('blocks.editOwn');
  // Empty-slot right-click offers "Dodaj zadanie"; task creation is gated by the
  // same permission the read-only TaskModal enforces, so we don't surface it to
  // users who can't create tasks.
  const canManageTasks = can('tasks.manage');
  // Wydarzenia (spotkania) dodaje rola z `events.manage`; menu slotu i blok są
  // czysto prezentacyjne (inwariant 7 — zero ścieżek pointer/drag).
  const canManageEvents = can('events.manage');
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
  // "Zaplanuj część" form fields (shared by the card button and the menu item).
  const [schedDate, setSchedDate] = useState(todayStr());
  const [schedStart, setSchedStart] = useState('08:00');
  const [schedHoursRaw, setSchedHoursRaw] = useState('1');
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Empty-slot context menu: right-clicking bare grid offers "Dodaj zadanie" at
  // the snapped 15-minute start under the cursor. Separate from the block/bin
  // `menu` above (which is keyed on a WorkloadEntry).
  const [slotMenu, setSlotMenu] = useState<{
    x: number;
    y: number;
    date: string;
    startMinutes: number;
  } | null>(null);
  const slotMenuRef = useRef<HTMLDivElement | null>(null);

  // Recurrence occurrence context menu — its own portal-free `.context-menu`
  // popover, keyed on a (taskId, date) occurrence rather than a WorkloadEntry.
  // Kept fully separate from `menu`/`slotMenu` so no pointer/drag path is touched.
  // Actions map only to SET_RECURRENCE_OVERRIDE / opening the task.
  const [recurMenu, setRecurMenu] = useState<{
    taskId: string;
    title: string;
    date: string;
    startMinutes: number;
    durationMinutes: number;
    overridden: boolean;
    x: number;
    y: number;
    step: 'menu' | 'edit';
  } | null>(null);
  const recurMenuRef = useRef<HTMLDivElement | null>(null);
  const [recurEditStart, setRecurEditStart] = useState('09:00');
  const [recurEditDurMin, setRecurEditDurMin] = useState(60);

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

  // Zegar „teraz”: napędza linię bieżącej godziny w dzisiejszej kolumnie oraz
  // narożną etykietę daty/zegara. Odświeżany co 30 s, żeby wskazanie nigdy nie
  // odstawało o więcej niż pół minuty; czysto prezentacyjny (invariant 7).
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

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

  // Same close discipline for the empty-slot menu, plus scroll: it is anchored to
  // viewport coordinates, so any grid scroll (capture:true catches the inner
  // viewport too) must dismiss it rather than leave it floating off its slot.
  // Listeners subscribe only while open and unsubscribe on close — no leaks.
  useEffect(() => {
    if (!slotMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSlotMenu(null);
    };
    const onDown = (e: MouseEvent) => {
      if (slotMenuRef.current && !slotMenuRef.current.contains(e.target as Node)) {
        setSlotMenu(null);
      }
    };
    const onScroll = () => setSlotMenu(null);
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [slotMenu]);

  // Same close discipline (Escape / outside-click / scroll) for the recurrence
  // occurrence menu, which is anchored to viewport coordinates like slotMenu.
  useEffect(() => {
    if (!recurMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setRecurMenu(null);
    };
    const onDown = (e: MouseEvent) => {
      if (recurMenuRef.current && !recurMenuRef.current.contains(e.target as Node)) {
        setRecurMenu(null);
      }
    };
    const onScroll = () => setRecurMenu(null);
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [recurMenu]);

  // Right-click on bare grid (not a block — those own their own menu and stop the
  // event) → offer "Dodaj zadanie" at the snapped start under the cursor.
  const openSlotMenu = (date: string, e: React.MouseEvent<HTMLDivElement>) => {
    if (!canManageTasks && !canManageEvents) return;
    if ((e.target as HTMLElement).closest('.week-block')) return; // block's own menu
    // Defense-in-depth: an occurrence overlay already stops its own contextmenu,
    // but never let a right-click on it fall through to the slot menu.
    if ((e.target as HTMLElement).closest('.week-recur-block')) return;
    // Same guard for the presentational event block (no pointer path of its own).
    if ((e.target as HTMLElement).closest('.week-event-block')) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const startMinutes = slotStartFromOffset(e.clientY - rect.top, HOUR_PX);
    setMenu(null);
    setSlotMenu({
      x: Math.min(e.clientX, window.innerWidth - 240),
      y: Math.min(e.clientY, window.innerHeight - 100),
      date,
      startMinutes,
    });
  };

  // Open task creation prefilled with the clicked day; when the week is filtered
  // to exactly one person, preselect them as the sole assignee.
  const addTaskInSlot = () => {
    if (!slotMenu) return;
    const personId = filter.size === 1 ? [...filter][0] : undefined;
    openNewTask(undefined, { date: slotMenu.date, personId });
    setSlotMenu(null);
  };

  // Open event creation prefilled with the clicked day + snapped start; when the
  // week is filtered to exactly one person, preselect them as sole attendee.
  const addEventInSlot = () => {
    if (!slotMenu) return;
    const personId = filter.size === 1 ? [...filter][0] : undefined;
    openNewEvent({ date: slotMenu.date, startMinutes: slotMenu.startMinutes, personId });
    setSlotMenu(null);
  };

  // Right-click an occurrence overlay → recurrence menu. Gate on permission
  // FIRST (mirrors openSlotMenu): non-managers return early WITHOUT
  // preventDefault/stopPropagation so their native browser menu still opens.
  // Managers suppress the native menu and stop propagation so the slot menu
  // never also opens (occurrence edits mirror TaskModal's tasks.manage gate).
  const openRecurMenu = (task: Task, occ: RecurrenceOccurrence, e: React.MouseEvent) => {
    if (!canManageTasks) return;
    e.preventDefault();
    e.stopPropagation();
    setMenu(null);
    setSlotMenu(null);
    setRecurEditStart(minutesToTimeStr(occ.startMinutes));
    setRecurEditDurMin(occ.durationMinutes);
    setRecurMenu({
      taskId: task.id,
      title: task.title,
      date: occ.date,
      startMinutes: occ.startMinutes,
      durationMinutes: occ.durationMinutes,
      overridden: occ.overridden,
      x: Math.min(e.clientX, window.innerWidth - 280),
      y: Math.min(e.clientY, window.innerHeight - 260),
      step: 'menu',
    });
  };

  const recurSkipDay = () => {
    if (!recurMenu) return;
    dispatch({
      type: 'SET_RECURRENCE_OVERRIDE',
      taskId: recurMenu.taskId,
      date: recurMenu.date,
      override: { skip: true },
    });
    setRecurMenu(null);
  };

  const recurRestore = () => {
    if (!recurMenu) return;
    dispatch({
      type: 'SET_RECURRENCE_OVERRIDE',
      taskId: recurMenu.taskId,
      date: recurMenu.date,
      override: null,
    });
    setRecurMenu(null);
  };

  // Inline client-side guard for the occurrence time-shift, mirroring the reducer
  // (on-grid start, end ≤ 24:00). NaN/off-grid values disable „Zapisz”.
  const recurEditStartMin = timeToMinutes(recurEditStart);
  const recurEditEnd = recurEditStartMin + recurEditDurMin;
  const recurEditError =
    !Number.isFinite(recurEditStartMin) || recurEditStartMin % MINUTE_STEP !== 0
      ? 'Start musi być w krokach co 15 minut.'
      : recurEditEnd > DAY_MINUTES
        ? 'Wystąpienie nie mieści się w dobie — koniec po 24:00.'
        : null;

  const confirmRecurEdit = () => {
    if (!recurMenu || recurMenu.step !== 'edit' || recurEditError) return;
    dispatch({
      type: 'SET_RECURRENCE_OVERRIDE',
      taskId: recurMenu.taskId,
      date: recurMenu.date,
      override: { startMinutes: recurEditStartMin, durationMinutes: recurEditDurMin },
    });
    setRecurMenu(null);
  };

  const openMenu = (entry: WorkloadEntry, e: React.MouseEvent) => {
    e.preventDefault();
    setSlotMenu(null);
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
    // insertDisabled (defined below) is the single source of truth — the same
    // value that disables the `Wstaw` button (snapped hours, budget, ripple fit,
    // 92-day cap) — so the Enter-key path can never dispatch what the button
    // would refuse.
    if (insertDisabled) return;
    dispatch({
      type: 'INSERT_BLOCK',
      payload: {
        refEntryId: menu.entry.id,
        position: menu.position,
        taskId: insertTaskId || menu.entry.taskId,
        hours: parsedHours,
      },
    });
    setMenu(null);
  };

  const doSplit = (parts: 2 | 4) => {
    if (!menu) return;
    dispatch({ type: 'SPLIT_BLOCK', entryId: menu.entry.id, parts });
    setMenu(null);
  };

  // Per-block „wykonane” from the calendar context menu. Toggles from the LIVE
  // entry, not the menu snapshot, so a flag merged in while the menu is open
  // isn't flipped backwards; SET_BLOCK_DONE no-ops on an unknown entryId.
  const doToggleDone = () => {
    if (!menu) return;
    const live = state.workload.find((w) => w.id === menu.entry.id);
    dispatch({ type: 'SET_BLOCK_DONE', entryId: menu.entry.id, done: live?.done !== true });
    setMenu(null);
  };

  const doDelete = () => {
    if (!menu) return;
    if (window.confirm(`Usunąć blok ${formatDuration(menu.entry.plannedHours)} z zasobnika?`)) {
      dispatch({ type: 'DELETE_BLOCK', entryId: menu.entry.id });
    }
    setMenu(null);
  };

  // ---- "Zaplanuj część" (partial bin scheduling) ----
  // Seed the form's three fields: today, capacity-/remainder-bounded hours, and a
  // nextFreeStart-derived start for that person on that day.
  const initScheduleForm = (entry: WorkloadEntry) => {
    const date = todayStr();
    const maxHours = Math.round(entry.plannedHours / HOURS_STEP) * HOURS_STEP;
    const defHours = Math.max(
      0.25,
      Math.min(maxHours, personCapacity(state, entry.personId), 24),
    );
    const blocks = blocksForPersonDate(state, entry.personId, date);
    const dur = hoursToMinutes(defHours);
    setSchedDate(date);
    setSchedHoursRaw(String(defHours));
    setSchedStart(minutesToTimeStr(findFreeStart(blocks, dur) ?? nextFreeStart(blocks, dur)));
  };

  // Entry point A: the card button. Anchor the menu to the button rect.
  const openSchedule = (entry: WorkloadEntry, btn: HTMLElement) => {
    const rect = btn.getBoundingClientRect();
    initScheduleForm(entry);
    setMenu({
      entry,
      x: Math.min(rect.left, window.innerWidth - 280),
      y: Math.min(rect.bottom + 4, window.innerHeight - 240),
      step: 'schedule',
      position: 'after',
    });
  };

  // Re-derive the start whenever the selected DATE changes; manual edits to the
  // start otherwise persist (they don't call this).
  const onSchedDateChange = (value: string) => {
    setSchedDate(value);
    if (!menu) return;
    const raw = Number(schedHoursRaw);
    const dur = hoursToMinutes(Number.isNaN(raw) ? 0.25 : snapHours(Math.min(24, raw)));
    const blocks = blocksForPersonDate(state, menu.entry.personId, value);
    setSchedStart(minutesToTimeStr(findFreeStart(blocks, dur) ?? nextFreeStart(blocks, dur)));
  };

  const confirmSchedule = () => {
    if (!menu || menu.step !== 'schedule') return;
    // schedDisabled (below) is the single source of truth — the same value that
    // disables the button — so Enter can never dispatch what the button refuses.
    if (schedDisabled) return;
    dispatch({
      type: 'SCHEDULE_BIN_PART',
      entryId: menu.entry.id,
      date: schedDate,
      startMinutes: timeToMinutes(schedStart),
      hours: schedHours,
    });
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
  // Live per-block done flag for the menu label (menu.entry is a snapshot).
  const menuEntryDone = menu
    ? state.workload.some((w) => w.id === menu.entry.id && w.done === true)
    : false;
  // Task picker options for the insert form. Users who can manage tasks pick any
  // task; users limited to their own blocks (blocks.editOwn) may only insert for
  // tasks the block's person is ALREADY assigned to — INSERT_BLOCK auto-assigns,
  // so an unrestricted list would let them self-allocate to arbitrary tasks and
  // bypass the read-only TaskModal. The clicked block's own task is always in
  // this set, so it stays available as the default.
  const insertTaskOptions = (() => {
    if (!menu) return [];
    // Szkice nie planują godzin (reduktor i tak odrzuca INSERT_BLOCK dla szkicu),
    // więc nie pokazujemy ich w wyborze zadania do wstawienia bloku.
    const publishable = state.tasks.filter((t) => t.isDraft !== true);
    if (can('tasks.manage')) return publishable;
    const allowed = new Set(taskIdsOfPerson(state, menu.entry.personId));
    return publishable.filter((t) => allowed.has(t.id));
  })();
  const menuDayHours = menu
    ? hoursForPersonOnDate(state, menu.entry.personId, menu.entry.date)
    : 0;
  // Day availability, not raw capacity: an insert on a zero-availability day
  // (e.g. outside the person's workdays) must warn, never look like free room.
  const menuAvailable = menu
    ? availableHoursOnDate(state, menu.entry.personId, menu.entry.date)
    : 0;
  // Snap/clamp the insert hours ONCE to exactly what INSERT_BLOCK will store
  // (Math.min(24, …) then 0.25-step snap). Reused for the overload preview, the
  // allowance check, the disabled state, and confirmInsert so the form can never
  // disagree with the reducer (e.g. 1.01 snaps to 1.0 and is accepted).
  const rawHours = Number(hoursRaw);
  const parsedHours = Number.isNaN(rawHours) ? NaN : snapHours(Math.min(24, rawHours));
  const projectedTotal =
    menuDayHours + (Number.isNaN(parsedHours) ? 0 : Math.max(parsedHours, 0));
  const wouldOverload = menu !== null && projectedTotal > menuAvailable;
  // Budget allowance for the picked task + this block's person (recomputed when
  // the task select changes). The reducer enforces the same cap on INSERT_BLOCK.
  const insertAllowance = menu
    ? taskGrowAllowance(state, insertTaskId || menu.entry.taskId, menu.entry.personId)
    : 0;
  const overAllowance =
    menu !== null && !Number.isNaN(parsedHours) && parsedHours > insertAllowance + 1e-9;
  // First-failing BLOCKING placement checks, in INSERT_BLOCK's own order AFTER
  // the budget (overAllowance) gate. Each disables `Wstaw`; NaN/≤0 hours stay
  // silently disabled. Mirrors the reducer one-for-one so the button can never
  // dispatch what INSERT_BLOCK would reject.
  const insertPickedTask = menu ? getTask(state, insertTaskId || menu.entry.taskId) : undefined;
  let insertWarning: string | null = null;
  if (menu && !Number.isNaN(parsedHours) && parsedHours > 0 && !overAllowance) {
    const dur = hoursToMinutes(parsedHours);
    const rawStart =
      menu.position === 'before'
        ? menu.entry.startMinutes
        : blockEndMinutes(menu.entry.startMinutes, menu.entry.plannedHours);
    const dayBlocks = blocksForPersonDate(state, menu.entry.personId, menu.entry.date);
    if (planRippleInsert(dayBlocks, rawStart, dur) === null) {
      insertWarning = '⚠ Wstawka nie mieści się w dobie — bloki za nią musiałyby wyjść poza 24:00.';
    } else if (insertPickedTask) {
      const startDate =
        menu.entry.date < insertPickedTask.startDate ? menu.entry.date : insertPickedTask.startDate;
      const endDate =
        menu.entry.date > insertPickedTask.endDate ? menu.entry.date : insertPickedTask.endDate;
      if (inclusiveDayCount(startDate, endDate) > MAX_TASK_PERIOD_DAYS) {
        insertWarning = '⚠ Termin zadania przekroczyłby limit 92 dni.';
      }
    }
  }
  // Single combined disabled flag driving both the button and confirmInsert.
  const insertDisabled =
    menu !== null &&
    (Number.isNaN(parsedHours) || parsedHours <= 0 || overAllowance || insertWarning !== null);

  // ---- "Zaplanuj część" derived values (snap once, share the predicate) ----
  const isSchedule = menu !== null && menu.step === 'schedule';
  const schedRawHours = Number(schedHoursRaw);
  const schedHours = Number.isNaN(schedRawHours) ? NaN : snapHours(Math.min(24, schedRawHours));
  const schedStartMin = timeToMinutes(schedStart);
  const schedDurMin = Number.isNaN(schedHours) ? 0 : hoursToMinutes(schedHours);
  const schedRemaining = menu ? menu.entry.plannedHours : 0;
  const schedTask = menu ? getTask(state, menu.entry.taskId) : undefined;
  const toQuartersLocal = (h: number) => Math.round(h / HOURS_STEP);
  // First-failing BLOCKING validation, in the reducer's own order. Each disables
  // `Zaplanuj`; NaN/≤0 hours disable silently (no warning line, like the insert form).
  let schedWarning: string | null = null;
  let schedDisabled = false;
  if (isSchedule && menu) {
    if (!isValidDateStr(schedDate)) {
      schedWarning = '⚠ Podaj prawidłową datę.';
      schedDisabled = true;
    } else if (Number.isNaN(schedHours) || schedHours <= 0) {
      schedDisabled = true; // silent, like the insert form
    } else if (toQuartersLocal(schedHours) > toQuartersLocal(schedRemaining)) {
      schedWarning = `⚠ W zasobniku pozostało tylko ${formatDuration(schedRemaining)}.`;
      schedDisabled = true;
    } else if (schedStartMin % MINUTE_STEP !== 0) {
      schedWarning = '⚠ Start musi być w krokach co 15 minut.';
      schedDisabled = true;
    } else if (schedStartMin + schedDurMin > DAY_MINUTES) {
      schedWarning =
        '⚠ Blok nie mieści się w dobie — wybierz wcześniejszy start albo mniej godzin.';
      schedDisabled = true;
    } else if (blockCollides(state, menu.entry.personId, schedDate, schedStartMin, schedHours)) {
      schedWarning = '⚠ Koliduje z innym blokiem tej osoby w tym dniu.';
      schedDisabled = true;
    } else if (schedTask) {
      const startDate = schedDate < schedTask.startDate ? schedDate : schedTask.startDate;
      const endDate = schedDate > schedTask.endDate ? schedDate : schedTask.endDate;
      if (inclusiveDayCount(startDate, endDate) > MAX_TASK_PERIOD_DAYS) {
        schedWarning = '⚠ Termin zadania przekroczyłby limit 92 dni.';
        schedDisabled = true;
      }
    }
  }
  // Non-blocking overload preview (invariant 3 — warns, never blocks). Uses the
  // target DAY's availability so scheduling onto a non-workday warns too.
  const schedAvailable =
    isSchedule && menu && isValidDateStr(schedDate)
      ? availableHoursOnDate(state, menu.entry.personId, schedDate)
      : 0;
  const schedProjected =
    isSchedule && menu && !Number.isNaN(schedHours) && schedHours > 0 && isValidDateStr(schedDate)
      ? hoursForPersonOnDate(state, menu.entry.personId, schedDate) + schedHours
      : 0;
  const schedOverload = isSchedule && schedProjected > schedAvailable;

  const hours = Array.from({ length: 24 }, (_, h) => h);

  return (
    <div className="week-cal" data-tour="calendar.week">
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
              // Znacznik urodzin (miesiąc+dzień) — czysto prezentacyjny, cały
              // zespół niezależnie od filtra. Tooltip po polsku z imionami.
              const birthdayNames = peopleWithBirthdayOnDate(state, d)
                .map((p) => p.name)
                .filter(Boolean);
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
                  {birthdayNames.length > 0 && (
                    <div
                      className="week-col-birthday"
                      title={`Urodziny: ${birthdayNames.join(', ')}`}
                    >
                      🎂 {birthdayNames.join(', ')}
                    </div>
                  )}
                  {overloadNames && (
                    <div
                      className="week-col-overload"
                      data-tour="calendar.overload"
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
                  data-day-index={dayIndex}
                  className={[
                    'week-day-col',
                    isTodayStr(d) ? 'today' : '',
                    isWeekend(d) ? 'weekend' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onContextMenu={
                    canManageTasks || canManageEvents ? (ev) => openSlotMenu(d, ev) : undefined
                  }
                >
                  {isTodayStr(d) && (
                    <div
                      className="week-now-line"
                      style={{ top: (nowMinutes / 60) * HOUR_PX }}
                      aria-hidden
                    />
                  )}
                  {/* Calendar events (spotkania): additive presentational overlay
                      rendered BEFORE the real blocks (and before recurrences) so
                      they always paint behind real task blocks — same paint step,
                      tree order — without touching the `.week-block` stacking
                      context or any pointer path (inwariant 1 + 7). */}
                  {calendarEventsForDate(state, d, filter).map((occ) => (
                    <EventBlock
                      key={`event-${occ.event.id}-${d}`}
                      occ={occ}
                      onOpen={() => openEvent(occ.event.id)}
                    />
                  ))}
                  {/* Recurring-task occurrences: additive presentational overlay
                      rendered BEFORE the real blocks so they always paint behind
                      them (same paint step, tree order) without touching the
                      `.week-block` stacking context or any pointer path. */}
                  {recurrenceOccurrencesForDate(state, d, filter).map(({ task, occurrence }) => (
                    <RecurBlock
                      key={`recur-${task.id}-${occurrence.date}`}
                      title={task.title}
                      hue={personColor(assigneeIdsOfTask(state, task.id)[0] ?? '')}
                      occurrence={occurrence}
                      onOpen={() => openTask(task.id)}
                      onContextMenu={(ev) => openRecurMenu(task, occurrence, ev)}
                    />
                  ))}
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
                        onOpen={() => openTask(task.id, e.id)}
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
        <div className="week-bin-pane" ref={binRef} data-tour="calendar.bin">
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
                          onOpen={() => openTask(task.id, e.id)}
                          onContextMenu={(ev) => openMenu(e, ev)}
                          onSchedule={(btn) => openSchedule(e, btn)}
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

      {/* Narożna plakietka: dzisiejsza data (z dniem tygodnia) + zegar HH:mm.
          pointer-events: none w CSS — nie może przechwycić dragu bloków. */}
      <div className="week-now-badge">
        <span className="week-now-badge-date">
          {format(now, 'EEEE, d MMMM', { locale: pl })}
        </span>
        <span className="week-now-badge-time">{format(now, 'HH:mm')}</span>
      </div>

      <AnimatePresence>
        {menu && (
          <motion.div
            className="context-menu"
            style={{ left: menu.x, top: menu.y, transformOrigin: 'top left' }}
            role="menu"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.12, ease: 'easeOut' }}
          >
            {/* menuRef wraps the ENTIRE popover (every step branch) so the
                outside-click check still covers all buttons/fields. It lives on a
                plain inner div, NOT on the AnimatePresence child (motion.div),
                because motion's PopChild reads children.props.ref and React 18.3
                warns on that. .context-menu is block flow, so this wrapper is
                layout-neutral. */}
            <div ref={menuRef}>
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
                  <div className="context-menu-sep" role="separator" />
                  {/* Per-block „wykonane” shortcut — same SET_BLOCK_DONE as the
                      TaskModal checkbox, task status untouched. */}
                  <button
                    type="button"
                    role="menuitem"
                    className="context-menu-item"
                    onClick={doToggleDone}
                  >
                    {menuEntryDone ? 'Odznacz „wykonane”' : '✓ Oznacz jako wykonane'}
                  </button>
                </>
              )}
              {isBinEntry(menu.entry) && (
                <>
                  {Number.isFinite(menu.entry.plannedHours) &&
                    Math.round(menu.entry.plannedHours / HOURS_STEP) >= 1 && (
                      <>
                        <button
                          type="button"
                          role="menuitem"
                          className="context-menu-item"
                          onClick={() => {
                            initScheduleForm(menu.entry);
                            setMenu({ ...menu, step: 'schedule' });
                          }}
                        >
                          Zaplanuj część…
                        </button>
                        <div className="context-menu-sep" role="separator" />
                      </>
                    )}
                  <button
                    type="button"
                    role="menuitem"
                    className="context-menu-item danger"
                    onClick={doDelete}
                  >
                    Usuń blok
                  </button>
                </>
              )}
            </>
          ) : menu.step === 'schedule' ? (
            <div className="context-insert-form context-schedule-form">
              <div className="context-menu-title">
                Zaplanuj część — {schedTask?.title} ({menuPerson?.name})
              </div>
              <p className="context-menu-sub">
                W zasobniku: {formatDuration(menu.entry.plannedHours)}
              </p>
              <label className="context-field">
                Dzień
                <input
                  type="date"
                  value={schedDate}
                  onChange={(e) => onSchedDateChange(e.target.value)}
                />
              </label>
              <label className="context-field">
                Start
                <input
                  type="time"
                  step={900}
                  value={schedStart}
                  onChange={(e) => setSchedStart(e.target.value)}
                />
              </label>
              <label className="context-field">
                Godziny
                <input
                  type="number"
                  min={0.25}
                  max={Math.round(menu.entry.plannedHours / HOURS_STEP) * HOURS_STEP}
                  step={0.25}
                  value={schedHoursRaw}
                  onChange={(e) => setSchedHoursRaw(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') confirmSchedule();
                  }}
                />
              </label>
              {schedWarning && <p className="context-warning">{schedWarning}</p>}
              {schedOverload && (
                <p className="context-warning">
                  ⚠ {menuPerson?.name} będzie mieć {formatDuration(schedProjected)} — powyżej
                  dostępności {formatDuration(schedAvailable)} w tym dniu.
                </p>
              )}
              <div className="context-actions">
                <button
                  type="button"
                  className="btn primary"
                  onClick={confirmSchedule}
                  disabled={schedDisabled}
                >
                  Zaplanuj
                </button>
                <button type="button" className="btn ghost" onClick={() => setMenu(null)}>
                  Anuluj
                </button>
              </div>
            </div>
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
                  {formatDuration(menuAvailable)} w tym dniu.
                </p>
              )}
              {overAllowance && (
                <p className="context-warning">
                  {insertAllowance <= 0
                    ? '⚠ Brak dostępnych godzin w budżecie zadania — zwiększ szacunek lub godziny w edytorze zadania.'
                    : `⚠ Budżet zadania pozwala dodać najwyżej ${formatDuration(insertAllowance)}.`}
                </p>
              )}
              {insertWarning && <p className="context-warning">{insertWarning}</p>}
              <div className="context-actions">
                <button
                  type="button"
                  className="btn primary"
                  onClick={confirmInsert}
                  disabled={insertDisabled}
                >
                  Wstaw
                </button>
                <button type="button" className="btn ghost" onClick={() => setMenu(null)}>
                  Anuluj
                </button>
              </div>
            </div>
          )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {slotMenu && (
          <motion.div
            className="context-menu"
            style={{ left: slotMenu.x, top: slotMenu.y, transformOrigin: 'top left' }}
            role="menu"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.12, ease: 'easeOut' }}
          >
            <div ref={slotMenuRef}>
              {canManageTasks && (
                <button
                  type="button"
                  role="menuitem"
                  className="context-menu-item"
                  onClick={addTaskInSlot}
                >
                  + Dodaj zadanie ({formatMinutes(slotMenu.startMinutes)})
                </button>
              )}
              {canManageEvents && (
                <button
                  type="button"
                  role="menuitem"
                  className="context-menu-item"
                  onClick={addEventInSlot}
                >
                  + Dodaj spotkanie ({formatMinutes(slotMenu.startMinutes)})
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {recurMenu && (
          <motion.div
            className="context-menu"
            style={{ left: recurMenu.x, top: recurMenu.y, transformOrigin: 'top left' }}
            role="menu"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.12, ease: 'easeOut' }}
          >
            <div ref={recurMenuRef}>
              {recurMenu.step === 'menu' ? (
                <>
                  <div className="context-menu-title">
                    ⟳ {recurMenu.title} —{' '}
                    {format(parseDate(recurMenu.date), 'd MMM yyyy', { locale: pl })}
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    className="context-menu-item"
                    onClick={() => setRecurMenu({ ...recurMenu, step: 'edit' })}
                  >
                    Edytuj to wystąpienie
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="context-menu-item"
                    onClick={() => {
                      openTask(recurMenu.taskId);
                      setRecurMenu(null);
                    }}
                  >
                    Edytuj wszystkie
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="context-menu-item"
                    onClick={recurSkipDay}
                  >
                    Pomiń ten dzień
                  </button>
                  {recurMenu.overridden && (
                    <>
                      <div className="context-menu-sep" role="separator" />
                      <button
                        type="button"
                        role="menuitem"
                        className="context-menu-item"
                        onClick={recurRestore}
                      >
                        Przywróć zgodnie z regułą
                      </button>
                    </>
                  )}
                </>
              ) : (
                <div className="context-insert-form">
                  <div className="context-menu-title">
                    Edytuj wystąpienie —{' '}
                    {format(parseDate(recurMenu.date), 'd MMM yyyy', { locale: pl })}
                  </div>
                  <label className="context-field">
                    Początek
                    <input
                      type="time"
                      step={900}
                      value={recurEditStart}
                      onChange={(e) => setRecurEditStart(e.target.value)}
                    />
                  </label>
                  <label className="context-field">
                    Czas trwania
                    <select
                      value={recurEditDurMin}
                      onChange={(e) => setRecurEditDurMin(Number(e.target.value))}
                    >
                      {RECUR_DURATION_OPTIONS.map((min) => (
                        <option key={min} value={min}>
                          {formatDuration(min / 60)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {recurEditError && <p className="context-warning">⚠ {recurEditError}</p>}
                  <div className="context-actions">
                    <button
                      type="button"
                      className="btn primary"
                      onClick={confirmRecurEdit}
                      disabled={recurEditError !== null}
                    >
                      Zapisz
                    </button>
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => setRecurMenu(null)}
                    >
                      Anuluj
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
