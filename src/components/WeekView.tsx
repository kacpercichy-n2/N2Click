// Week view: 7 columns Mon–Sun. Under each header, the filtered day total and
// an overload marker naming anyone over capacity. The day body shows each
// person's ordered time blocks; clicking a block opens its task editor.
// Right-clicking a block opens "Add before / Add after": a small form asking
// for hours (and task) inserts a new block into that person's day at that
// position, pushing their later blocks down — other people are unaffected.
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { AppData, WorkloadEntry } from '../types';
import { useStore } from '../store/AppStore';
import { useOpenTask } from './TaskModal';
import { personColor } from '../utils/colors';
import { isTodayStr, isWeekend, parseDate, weekDays } from '../utils/dates';
import { format } from 'date-fns';
import {
  blocksForPersonDate,
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
import { Coin } from './Coin';

interface Props {
  state: AppData;
  anchor: string; // any date within the week to render
  filter: Set<string>;
}

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

export function WeekView({ state, anchor, filter }: Props) {
  const { openTask } = useOpenTask();
  const { dispatch } = useStore();
  const days = weekDays(anchor);

  const [menu, setMenu] = useState<MenuState | null>(null);
  const [hoursRaw, setHoursRaw] = useState('1');
  const [insertTaskId, setInsertTaskId] = useState('');
  const menuRef = useRef<HTMLDivElement | null>(null);

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

  return (
    <div className="week-grid">
      {days.map((d) => {
        const total = dayTotal(state, d, filter);
        const overloadedIds = overloadedPeopleOnDate(state, d, filter);
        const entries = entriesForDate(state, d, filter);
        const today = isTodayStr(d);
        const weekend = isWeekend(d);
        const empty = entries.length === 0;

        const overloadNames = overloadedIds
          .map((id) => getPerson(state, id)?.name)
          .filter(Boolean)
          .join(', ');

        // People with blocks that day (people-list order), each with their
        // ordered per-day schedule.
        const peopleIds = state.people
          .map((p) => p.id)
          .filter((pid) => entries.some((e) => e.personId === pid));

        return (
          <div
            key={d}
            className={[
              'week-col',
              today ? 'today' : '',
              weekend ? 'weekend' : '',
              empty ? 'empty' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <div className="week-col-head">
              <div className="week-col-weekday">{format(parseDate(d), 'EEE')}</div>
              <div className="week-col-date">{format(parseDate(d), 'd MMM')}</div>
              <div className="week-col-total">{empty ? '—' : `${fmt(total)}h`}</div>
              {overloadNames && (
                <div className="week-col-overload" title={`Over capacity: ${overloadNames}`}>
                  ⚠ {overloadNames}
                </div>
              )}
            </div>
            <div className="week-col-body">
              {empty && <div className="week-free">—</div>}
              {peopleIds.map((pid) =>
                blocksForPersonDate(state, pid, d)
                  .filter((e) => filter.size === 0 || filter.has(e.personId))
                  .map((e) => {
                    const task = getTask(state, e.taskId);
                    const person = getPerson(state, e.personId);
                    if (!task || !person) return null;
                    const project = getProject(state, task.projectId);
                    return (
                      <button
                        key={e.id}
                        type="button"
                        className="week-block"
                        style={{ borderLeftColor: personColor(person.id) }}
                        onClick={() => openTask(task.id)}
                        onContextMenu={(ev) => openMenu(e, ev)}
                        title={`${task.title} — ${person.name}: ${e.plannedHours}h. Right-click to insert a block before/after.`}
                      >
                        <span className="week-block-title">
                          {project && <Coin paid={project.paid} size={12} />}
                          {task.title}
                        </span>
                        <span className="week-block-meta">
                          <span
                            className="person-dot"
                            style={{ background: personColor(person.id) }}
                            aria-hidden
                          />
                          {person.name}
                          <span className="week-block-hours">{e.plannedHours}h</span>
                        </span>
                      </button>
                    );
                  }),
              )}
            </div>
          </div>
        );
      })}

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
                ↑ Add before
              </button>
              <button
                type="button"
                role="menuitem"
                className="context-menu-item"
                onClick={() => setMenu({ ...menu, step: 'form', position: 'after' })}
              >
                ↓ Add after
              </button>
            </>
          ) : (
            <div className="context-insert-form">
              <div className="context-menu-title">
                Insert {menu.position} for {menuPerson?.name}
              </div>
              <label className="context-field">
                Task
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
                Hours
                <input
                  type="number"
                  min={0.5}
                  max={24}
                  step={0.5}
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
                  ⚠ {menuPerson?.name} would be at {fmt(projectedTotal)}h — over their{' '}
                  {fmt(menuCapacity)}h/day capacity.
                </p>
              )}
              <div className="context-actions">
                <button
                  type="button"
                  className="btn primary"
                  onClick={confirmInsert}
                  disabled={Number.isNaN(parsedHours) || parsedHours <= 0}
                >
                  Insert
                </button>
                <button type="button" className="btn ghost" onClick={() => setMenu(null)}>
                  Cancel
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
