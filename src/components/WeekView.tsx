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
import { useOpenTask } from './TaskModal';
import { personColor } from '../utils/colors';
import { isTodayStr, isWeekend, parseDate, weekDays } from '../utils/dates';
import { format } from 'date-fns';
import { pl } from 'date-fns/locale/pl';
import {
  blockCollides,
  dayTotal,
  entriesForDate,
  getClient,
  getPerson,
  getProject,
  getTask,
  hoursForPersonOnDate,
  overloadedPeopleOnDate,
  personCapacity,
} from '../store/selectors';
import {
  DAY_MINUTES,
  MINUTE_STEP,
  blockEndMinutes,
  clampBlockStart,
  formatMinutes,
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
const AXIS_W = 52; // left time-axis column width (px)
const DAY_BODY_H = 24 * HOUR_PX; // 1152px full-day column height
const MIN_BLOCK_H = 14; // keep 0.25h blocks clickable
const SCROLL_TO_MIN = 7 * 60; // open scrolled to 07:00

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

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
  colliding: boolean;
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
      if (e.key === 'Escape') setDrag(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drag]);

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
    const colWidth = rect ? (rect.width - AXIS_W) / 7 : 0;
    setDrag({
      mode,
      originX: e.clientX,
      originY: e.clientY,
      colWidth,
      projStart: baseStart,
      projHours: baseHours,
      projDayIndex: dayIndex,
      colliding: false,
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

    if (drag.mode === 'move') {
      const dur = baseHours * 60;
      projStart = clampBlockStart(baseStart + deltaMin, dur);
      const dx = e.clientX - drag.originX;
      const dayDelta = drag.colWidth > 0 ? Math.round(dx / drag.colWidth) : 0;
      projDayIndex = Math.max(0, Math.min(6, dayIndex + dayDelta));
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

    if (projStart !== baseStart || projHours !== baseHours || projDayIndex !== dayIndex) {
      moved.current = true;
    }

    const projDate = days[projDayIndex];
    const colliding = blockCollides(state, person.id, projDate, projStart, projHours, entry.id);

    setDrag((d) => (d ? { ...d, projStart, projHours, projDayIndex, colliding } : d));
  };

  const finish = () => {
    if (!drag) return;
    const { projStart, projHours, projDayIndex, colliding } = drag;
    setDrag(null);
    if (!moved.current) return; // treated as a click by onClick
    if (colliding) return; // invalid drop → snap back (re-render restores it)
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

  const className = [
    'week-block',
    drag ? 'dragging' : '',
    drag?.colliding ? 'colliding' : '',
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
      title={`${task.title} — ${person.name}: ${formatMinutes(start)}–${formatMinutes(end)} (${fmt(hours)}h). Przeciągnij, aby przenieść; przeciągnij krawędź, aby zmienić czas trwania; kliknij prawym przyciskiem, aby wstawić blok.`}
      onPointerDown={begin('move')}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={() => setDrag(null)}
      onClick={(e) => {
        e.stopPropagation();
        if (!moved.current) onOpen();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen();
      }}
      onContextMenu={onContextMenu}
    >
      <span className="week-block-handle top" onPointerDown={begin('top')} aria-hidden />
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
        <span className="week-block-hours">{fmt(hours)}h</span>
      </span>
      <span className="week-block-handle bottom" onPointerDown={begin('bottom')} aria-hidden />
    </div>
  );
}

export function WeekView({ state, anchor, filter }: Props) {
  const { openTask } = useOpenTask();
  const { dispatch } = useStore();
  const days = weekDays(anchor);

  const gridRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const [menu, setMenu] = useState<MenuState | null>(null);
  const [hoursRaw, setHoursRaw] = useState('1');
  const [insertTaskId, setInsertTaskId] = useState('');
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Open the grid scrolled to ~07:00 (once, on mount).
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = (SCROLL_TO_MIN / 60) * HOUR_PX;
  }, []);

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

  // Overload preview for the insert form.
  const menuPerson = menu ? getPerson(state, menu.entry.personId) : undefined;
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
      <div className="week-cal-scroll" ref={scrollRef}>
        <div
          className="week-cal-grid"
          ref={gridRef}
          style={{
            gridTemplateColumns: `${AXIS_W}px repeat(7, minmax(0, 1fr))`,
            gridTemplateRows: `auto ${DAY_BODY_H}px`,
          }}
        >
          {/* Header row: corner + 7 day headers (sticky). */}
          <div className="week-axis-head" />
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
                <div className="week-col-date">{format(parseDate(d), 'd MMM', { locale: pl })}</div>
                <div className="week-col-total">{empty ? '—' : `${fmt(total)}h`}</div>
                {overloadNames && (
                  <div className="week-col-overload" title={`Powyżej dostępności: ${overloadNames}`}>
                    ⚠ {overloadNames}
                  </div>
                )}
              </div>
            );
          })}

          {/* Body row: hour axis + 7 day columns. */}
          <div className="week-axis">
            {hours.map((h) => (
              <span key={h} className="week-axis-label" style={{ top: h * HOUR_PX }}>
                {h}:00
              </span>
            ))}
          </div>
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
                {fmt(menu.entry.plannedHours)}h
              </div>
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
                  {state.tasks.map((t) => {
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
                  ⚠ {menuPerson?.name} będzie mieć {fmt(projectedTotal)}h — powyżej dostępności{' '}
                  {fmt(menuCapacity)}h/dzień.
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
