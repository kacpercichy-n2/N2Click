// Timeline: project start/end bars, task blocks, milestones, and deadlines on a
// horizontal day axis. Bars drag to reschedule (move) and resize from either
// edge. Moving a TASK also shifts its planned time blocks; resizing drops
// blocks that fall outside the new period (same rule as the editor).
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/AppStore';
import { useCan } from '../store/useCan';
import { useOpenTask } from '../components/TaskModal';
import { PersonFilter } from '../components/PersonFilter';
import { ZoomIn, ZoomOut } from '../components/icons';
import type { Milestone, Person, Project, Task } from '../types';
import {
  assigneeIdsOfTask,
  conflictDatesForTask,
  conflictDatesForTaskPerson,
  doneStatusIds,
  entriesForTaskPerson,
  getProject,
  getStatus,
  milestonesOfProject,
  tasksOfProject,
} from '../store/selectors';
import { Coin } from '../components/Coin';
import { personColor } from '../utils/colors';
import { formatDuration } from '../utils/time';
import {
  addDaysStr,
  diffDays,
  formatShort,
  isWeekend,
  shiftWeek,
  todayStr,
  weekStart,
} from '../utils/dates';

const DEFAULT_DAY_W = 26; // px per day
const ZOOM_LEVELS = [14, 26, 40] as const; // px per day
const WEEK_PRESETS: Array<[number, string]> = [
  [2, '2 tyg.'],
  [6, '6 tyg.'],
  [10, '10 tyg.'],
  [26, '26 tyg.'],
];

type DragMode = 'move' | 'start' | 'end';

interface BarProps {
  startIdx: number; // day index of bar start within the range
  span: number; // days (>= 1)
  totalDays: number;
  dayW: number; // px per day (zoom level)
  color: string;
  className: string;
  title: string;
  resizable: boolean;
  editable: boolean; // false ⇒ static bar (click opens, but no drag/resize)
  onCommit: (mode: DragMode, deltaDays: number) => void;
  onOpen: () => void;
  conflictOffsets?: number[]; // day offsets from bar start with an overload
  children?: React.ReactNode;
}

/** A draggable/resizable bar. Click (without drag) opens the entity. */
function Bar({
  startIdx,
  span,
  totalDays,
  dayW,
  color,
  className,
  title,
  resizable,
  editable,
  onCommit,
  onOpen,
  conflictOffsets,
  children,
}: BarProps) {
  const [drag, setDrag] = useState<{ mode: DragMode; originX: number; delta: number } | null>(
    null,
  );
  const moved = useRef(false);

  const begin = (mode: DragMode) => (e: React.PointerEvent) => {
    e.stopPropagation();
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // No active pointer (synthetic events) — dragging still works within the bar.
    }
    moved.current = false;
    setDrag({ mode, originX: e.clientX, delta: 0 });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    let delta = Math.round((e.clientX - drag.originX) / dayW);
    // Keep at least 1 day of bar while resizing.
    if (drag.mode === 'start') delta = Math.min(delta, span - 1);
    if (drag.mode === 'end') delta = Math.max(delta, 1 - span);
    if (delta !== 0) moved.current = true;
    setDrag((d) => (d ? { ...d, delta } : d));
  };

  const onPointerUp = () => {
    if (!drag) return;
    const { mode, delta } = drag;
    setDrag(null);
    if (delta !== 0) onCommit(mode, delta);
  };

  let left = startIdx * dayW;
  let width = span * dayW;
  if (drag) {
    if (drag.mode === 'move') left += drag.delta * dayW;
    if (drag.mode === 'start') {
      left += drag.delta * dayW;
      width -= drag.delta * dayW;
    }
    if (drag.mode === 'end') width += drag.delta * dayW;
  }
  // Cull bars fully outside the range.
  if (left + width < 0 || left > totalDays * dayW) return null;

  return (
    <div
      className={[className, drag ? 'dragging' : '', editable ? '' : 'static']
        .filter(Boolean)
        .join(' ')}
      style={{ left, width, borderColor: color }}
      title={title}
      onPointerDown={editable ? begin('move') : undefined}
      onPointerMove={editable ? onPointerMove : undefined}
      onPointerUp={editable ? onPointerUp : undefined}
      onClick={(e) => {
        e.stopPropagation();
        if (!moved.current) onOpen();
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen();
      }}
    >
      {resizable && editable && (
        <span className="bar-handle left" onPointerDown={begin('start')} aria-hidden />
      )}
      <span className="bar-label">{children}</span>
      {resizable && editable && (
        <span className="bar-handle right" onPointerDown={begin('end')} aria-hidden />
      )}
      {conflictOffsets?.map((off) => (
        <span
          key={off}
          className="timeline-conflict"
          style={{ left: off * dayW }}
          aria-hidden
        />
      ))}
    </div>
  );
}

/** Draggable milestone diamond. */
function MilestoneMark({
  milestone,
  dayIdx,
  dayW,
  editable,
  onCommit,
}: {
  milestone: Milestone;
  dayIdx: number;
  dayW: number;
  editable: boolean;
  onCommit: (deltaDays: number) => void;
}) {
  const [drag, setDrag] = useState<{ originX: number; delta: number } | null>(null);
  return (
    <span
      className={[
        'timeline-milestone',
        drag ? 'dragging' : '',
        editable ? '' : 'static',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ left: (dayIdx + (drag?.delta ?? 0)) * dayW + dayW / 2 }}
      title={
        editable
          ? `◆ ${milestone.name} — ${formatShort(milestone.date)} (przeciągnij, aby przesunąć)`
          : `◆ ${milestone.name} — ${formatShort(milestone.date)}`
      }
      onPointerDown={
        editable
          ? (e) => {
              e.stopPropagation();
              try {
                (e.target as HTMLElement).setPointerCapture(e.pointerId);
              } catch {
                // No active pointer (synthetic events) — see Bar.begin.
              }
              setDrag({ originX: e.clientX, delta: 0 });
            }
          : undefined
      }
      onPointerMove={
        editable
          ? (e) => {
              if (!drag) return;
              const delta = Math.round((e.clientX - drag.originX) / dayW);
              setDrag((d) => (d ? { ...d, delta } : d));
            }
          : undefined
      }
      onPointerUp={
        editable
          ? () => {
              if (!drag) return;
              const { delta } = drag;
              setDrag(null);
              if (delta !== 0) onCommit(delta);
            }
          : undefined
      }
    >
      ◆
    </span>
  );
}

export function TimelinePage() {
  const { state, dispatch } = useStore();
  const navigate = useNavigate();
  const { openTask } = useOpenTask();
  const can = useCan();
  const canManageProjects = can('projects.manage');
  const canManageTasks = can('tasks.manage');
  const [mode, setMode] = useState<'projects' | 'people'>('projects');
  const [anchor, setAnchor] = useState(() => todayStr());
  const [dayW, setDayW] = useState<number>(DEFAULT_DAY_W);
  const [weeks, setWeeks] = useState(10);
  const [ownerFilter, setOwnerFilter] = useState<Set<string>>(new Set());
  const [clientFilter, setClientFilter] = useState('');

  const zoomIdx = ZOOM_LEVELS.indexOf(dayW as (typeof ZOOM_LEVELS)[number]);
  const canZoomIn = zoomIdx < ZOOM_LEVELS.length - 1;
  const canZoomOut = zoomIdx > 0;

  // Visible range: from one week before the anchor's Monday, `weeks` weeks long.
  const rangeStart = shiftWeek(weekStart(anchor), -1);
  const totalDays = weeks * 7;
  const days = useMemo(
    () => Array.from({ length: totalDays }, (_, i) => addDaysStr(rangeStart, i)),
    [rangeStart, totalDays],
  );
  const today = todayStr();
  const todayIdx = diffDays(rangeStart, today);
  const dayIdx = (d: string) => diffDays(rangeStart, d);

  const doneIds = doneStatusIds(state);

  // Group projects by client, in client-list order, narrowed by the client filter.
  const groups = useMemo(() => {
    const out: Array<{ name: string; projects: Project[] }> = [];
    for (const c of state.clients) {
      if (clientFilter && c.id !== clientFilter) continue;
      const own = state.projects.filter((p) => p.clientId === c.id);
      if (own.length > 0) out.push({ name: c.name, projects: own });
    }
    if (!clientFilter) {
      const known = new Set(state.clients.map((c) => c.id));
      const orphans = state.projects.filter((p) => !known.has(p.clientId));
      if (orphans.length > 0) out.push({ name: 'Bez klienta', projects: orphans });
    }
    return out;
  }, [state.clients, state.projects, clientFilter]);

  // Apply the owner filter and precompute per-task conflict day offsets. Offsets
  // are relative to each task's start (range-independent) so this memo survives
  // navigation and drag frames — it only recomputes on workload/people/task edits.
  const ownerKey = [...ownerFilter].sort().join(',');
  const view = useMemo(() => {
    const result: Array<{
      name: string;
      projects: Array<{
        project: Project;
        tasks: Array<{ task: Task; conflictOffsets: number[] }>;
      }>;
    }> = [];
    for (const g of groups) {
      const projects: (typeof result)[number]['projects'] = [];
      for (const p of g.projects) {
        const all = tasksOfProject(state, p.id).sort((a, b) =>
          a.startDate.localeCompare(b.startDate),
        );
        const tasks =
          ownerFilter.size === 0
            ? all
            : all.filter((t) =>
                assigneeIdsOfTask(state, t.id).some((id) => ownerFilter.has(id)),
              );
        // Project bars have no owner: hide a project only when the owner filter
        // is active and none of its tasks match.
        if (ownerFilter.size > 0 && tasks.length === 0) continue;
        projects.push({
          project: p,
          tasks: tasks.map((t) => ({
            task: t,
            conflictOffsets: conflictDatesForTask(state, t.id).map((d) =>
              diffDays(t.startDate, d),
            ),
          })),
        });
      }
      if (projects.length > 0) result.push({ name: g.name, projects });
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, ownerKey, state.tasks, state.assignments, state.workload, state.people]);

  // People mode: one group per person (people-list order), narrowed by the
  // owner filter (empty = everyone). Each group lists the tasks the person is
  // involved in — an assignment OR at least one workload entry (dated or bin) —
  // narrowed by the client filter, sorted by startDate then title. A person
  // with no matching tasks is omitted entirely. Conflict markers here are
  // PERSON-SCOPED: a row shows only days where THIS person is overbooked, so a
  // co-assignee's overload never bleeds onto it.
  const peopleView = useMemo(() => {
    const out: Array<{
      person: Person;
      tasks: Array<{ task: Task; hours: number; conflictOffsets: number[] }>;
    }> = [];
    for (const person of state.people) {
      if (ownerFilter.size > 0 && !ownerFilter.has(person.id)) continue;
      const involvedIds = new Set<string>();
      for (const a of state.assignments) {
        if (a.personId === person.id) involvedIds.add(a.taskId);
      }
      for (const w of state.workload) {
        if (w.personId === person.id) involvedIds.add(w.taskId);
      }
      const tasks = state.tasks
        // Szkice nie trafiają na oś czasu (widok planowania) — dopiero po publikacji.
        .filter((t) => involvedIds.has(t.id) && t.isDraft !== true)
        .filter((t) => {
          if (!clientFilter) return true;
          const proj = getProject(state, t.projectId);
          return proj?.clientId === clientFilter;
        })
        .sort(
          (a, b) =>
            a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title),
        );
      if (tasks.length === 0) continue;
      out.push({
        person,
        tasks: tasks.map((t) => ({
          task: t,
          hours: entriesForTaskPerson(state, t.id, person.id).reduce(
            (sum, w) => sum + w.plannedHours,
            0,
          ),
          conflictOffsets: conflictDatesForTaskPerson(state, t.id, person.id).map((d) =>
            diffDays(t.startDate, d),
          ),
        })),
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    ownerKey,
    clientFilter,
    state.people,
    state.tasks,
    state.assignments,
    state.workload,
    state.projects,
  ]);

  const commitProject = (p: Project) => (mode: DragMode, delta: number) => {
    const startDate =
      mode === 'end' ? p.startDate : addDaysStr(p.startDate, delta);
    const endDate = mode === 'start' ? p.endDate : addDaysStr(p.endDate, delta);
    dispatch({ type: 'SET_PROJECT_DATES', projectId: p.id, startDate, endDate });
  };

  const commitTask = (t: Task) => (mode: DragMode, delta: number) => {
    if (mode === 'move') {
      dispatch({ type: 'MOVE_TASK', taskId: t.id, dayDelta: delta });
    } else {
      const startDate = mode === 'start' ? addDaysStr(t.startDate, delta) : t.startDate;
      const endDate = mode === 'end' ? addDaysStr(t.endDate, delta) : t.endDate;
      dispatch({ type: 'SET_TASK_DATES', taskId: t.id, startDate, endDate });
    }
  };

  return (
    <section className="page page-wide">
      <div className="page-head">
        <h1>Oś czasu</h1>
        <div className="cal-nav" data-tour="timeline.toolbar">
          <button
            type="button"
            className="nav-btn"
            onClick={() => setAnchor((a) => shiftWeek(a, -2))}
            aria-label="Wcześniej"
          >
            ‹
          </button>
          <button type="button" className="btn ghost" onClick={() => setAnchor(todayStr())}>
            Dzisiaj
          </button>
          <button
            type="button"
            className="nav-btn"
            onClick={() => setAnchor((a) => shiftWeek(a, 2))}
            aria-label="Później"
          >
            ›
          </button>
          <span className="cal-range-label">
            {formatShort(days[0])} – {formatShort(days[totalDays - 1])}
          </span>
          <div className="timeline-zoom" role="group" aria-label="Powiększenie">
            <button
              type="button"
              className="nav-btn"
              onClick={() => canZoomOut && setDayW(ZOOM_LEVELS[zoomIdx - 1])}
              disabled={!canZoomOut}
              aria-label="Pomniejsz"
            >
              <ZoomOut size={16} aria-hidden />
            </button>
            <button
              type="button"
              className="nav-btn"
              onClick={() => canZoomIn && setDayW(ZOOM_LEVELS[zoomIdx + 1])}
              disabled={!canZoomIn}
              aria-label="Powiększ"
            >
              <ZoomIn size={16} aria-hidden />
            </button>
          </div>
        </div>
      </div>
      <p className="field-hint">
        {mode === 'projects'
          ? 'Przeciągnij pasek, aby zmienić termin; przeciągnij krawędzie, aby zmienić start lub koniec. Przesunięcie zadania przesuwa razem z nim zaplanowane godziny. ◆ kamienie milowe też można przeciągać.'
          : 'Widok według osób: każdy wiersz to zadanie danej osoby. Kliknij pasek, aby otworzyć zadanie. Paski są tylko do odczytu — terminy zmieniasz w trybie Projekty.'}
      </p>

      <div className="cal-toolbar">
        <div className="cal-view-toggle" role="group" aria-label="Tryb widoku">
          <button
            type="button"
            className={mode === 'projects' ? 'toggle-btn active' : 'toggle-btn'}
            onClick={() => setMode('projects')}
          >
            Projekty
          </button>
          <button
            type="button"
            className={mode === 'people' ? 'toggle-btn active' : 'toggle-btn'}
            onClick={() => setMode('people')}
          >
            Osoby
          </button>
        </div>
        <div className="cal-view-toggle" role="group" aria-label="Zakres widoku">
          {WEEK_PRESETS.map(([w, label]) => (
            <button
              key={w}
              type="button"
              className={weeks === w ? 'toggle-btn active' : 'toggle-btn'}
              onClick={() => setWeeks(w)}
            >
              {label}
            </button>
          ))}
        </div>
        <PersonFilter
          people={state.people}
          selected={ownerFilter}
          onToggle={(id) =>
            setOwnerFilter((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
          onAll={() => setOwnerFilter(new Set())}
        />
        <select
          value={clientFilter}
          onChange={(e) => setClientFilter(e.target.value)}
          aria-label="Filtruj po kliencie"
        >
          <option value="">Wszyscy klienci</option>
          {state.clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {(mode === 'projects' ? state.projects.length === 0 : peopleView.length === 0) ? (
        <div className="empty-state">
          {mode === 'projects' ? (
            <>
              <p className="empty-title">Brak elementów do zaplanowania</p>
              <p className="empty-hint">Utwórz projekt, aby zobaczyć go na osi czasu.</p>
            </>
          ) : (
            <>
              <p className="empty-title">Brak zadań do wyświetlenia</p>
              <p className="empty-hint">Przypisz osoby do zadań, aby zobaczyć oś czasu zespołu.</p>
            </>
          )}
        </div>
      ) : (
        <div className="timeline-scroll" data-tour="timeline.chart">
          <div className="timeline" style={{ width: 240 + totalDays * dayW }}>
            {/* Header: week labels + day stripes */}
            <div className="timeline-row timeline-head">
              <div className="timeline-label" />
              <div className="timeline-track">
                {days.map((d, i) =>
                  i % 7 === 0 ? (
                    <span key={d} className="timeline-week-label" style={{ left: i * dayW }}>
                      {formatShort(d)}
                    </span>
                  ) : null,
                )}
              </div>
            </div>

            {mode === 'projects' &&
              view.map((g) => (
              <div key={g.name} className="timeline-group">
                <div className="timeline-row timeline-client-row">
                  <div className="timeline-label timeline-client">{g.name}</div>
                  <div className="timeline-track" />
                </div>
                {g.projects.map(({ project: p, tasks }) => {
                  const status = getStatus(state, p.statusId);
                  const overdue = p.endDate < today && !doneIds.has(p.statusId);
                  return (
                    <div key={p.id} className="timeline-project">
                      <div className="timeline-row">
                        <div className="timeline-label">
                          <button
                            type="button"
                            className="timeline-label-btn"
                            onClick={() => navigate(`/projects/${p.id}`)}
                            title={p.name}
                          >
                            <Coin paid={p.paid} size={14} />
                            <span className="timeline-label-text">{p.name}</span>
                          </button>
                        </div>
                        <div className="timeline-track">
                          <DayStripes days={days} todayIdx={todayIdx} dayW={dayW} />
                          <Bar
                            startIdx={dayIdx(p.startDate)}
                            span={diffDays(p.startDate, p.endDate) + 1}
                            totalDays={totalDays}
                            dayW={dayW}
                            color={status?.color ?? '#64748b'}
                            className={
                              overdue ? 'timeline-bar project overdue' : 'timeline-bar project'
                            }
                            title={`${p.name}: ${formatShort(p.startDate)} – ${formatShort(p.endDate)}${overdue ? ' (po terminie)' : ''}`}
                            resizable
                            editable={canManageProjects}
                            onCommit={commitProject(p)}
                            onOpen={() => navigate(`/projects/${p.id}`)}
                          >
                            {p.name}
                          </Bar>
                          {milestonesOfProject(state, p.id).map((m) => (
                            <MilestoneMark
                              key={m.id}
                              milestone={m}
                              dayIdx={dayIdx(m.date)}
                              dayW={dayW}
                              editable={canManageProjects}
                              onCommit={(delta) =>
                                dispatch({
                                  type: 'MOVE_MILESTONE',
                                  milestoneId: m.id,
                                  date: addDaysStr(m.date, delta),
                                })
                              }
                            />
                          ))}
                        </div>
                      </div>
                      {tasks.map(({ task: t, conflictOffsets }) => (
                        <div key={t.id} className="timeline-row timeline-task-row">
                          <div className="timeline-label timeline-task-label" title={t.title}>
                            {t.title}
                          </div>
                          <div className="timeline-track">
                            <DayStripes days={days} todayIdx={todayIdx} dayW={dayW} />
                            <Bar
                              startIdx={dayIdx(t.startDate)}
                              span={diffDays(t.startDate, t.endDate) + 1}
                              totalDays={totalDays}
                              dayW={dayW}
                              color={getStatus(state, t.statusId)?.color ?? '#94a3b8'}
                              className="timeline-bar task"
                              title={`${t.title}: ${formatShort(t.startDate)} – ${formatShort(t.endDate)}${conflictOffsets.length > 0 ? ` — ⚠ konflikty: ${conflictOffsets.length === 1 ? '1 dzień' : `${conflictOffsets.length} dni`}` : ''}`}
                              resizable
                              editable={canManageTasks}
                              onCommit={commitTask(t)}
                              onOpen={() => openTask(t.id)}
                              conflictOffsets={conflictOffsets}
                            >
                              {t.title}
                            </Bar>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            ))}

            {mode === 'people' &&
              peopleView.map(({ person, tasks }) => (
                <div key={person.id} className="timeline-group">
                  <div className="timeline-row timeline-person-row">
                    <div className="timeline-label timeline-person-label">
                      <span
                        className="timeline-person-dot"
                        style={{ background: personColor(person.id) }}
                        aria-hidden
                      />
                      <span className="timeline-label-text">{person.name}</span>
                    </div>
                    <div className="timeline-track" />
                  </div>
                  {tasks.map(({ task: t, hours, conflictOffsets }) => (
                    <div key={t.id} className="timeline-row timeline-task-row">
                      <div className="timeline-label timeline-task-label" title={t.title}>
                        {t.title}
                      </div>
                      <div className="timeline-track">
                        <DayStripes days={days} todayIdx={todayIdx} dayW={dayW} />
                        <Bar
                          startIdx={dayIdx(t.startDate)}
                          span={diffDays(t.startDate, t.endDate) + 1}
                          totalDays={totalDays}
                          dayW={dayW}
                          color={getStatus(state, t.statusId)?.color ?? '#94a3b8'}
                          className="timeline-bar task"
                          title={`${t.title}: ${formatShort(t.startDate)} – ${formatShort(t.endDate)} — ${person.name}: ${formatDuration(hours)} zaplanowane`}
                          resizable={false}
                          editable={false}
                          onCommit={() => {}}
                          onOpen={() => openTask(t.id)}
                          conflictOffsets={conflictOffsets}
                        >
                          {t.title}
                        </Bar>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
          </div>
        </div>
      )}
    </section>
  );
}

/** Weekend shading + today line, shared by every track. */
function DayStripes({
  days,
  todayIdx,
  dayW,
}: {
  days: string[];
  todayIdx: number;
  dayW: number;
}) {
  return (
    <>
      {days.map((d, i) =>
        isWeekend(d) ? (
          <span
            key={d}
            className="timeline-weekend"
            style={{ left: i * dayW, width: dayW }}
            aria-hidden
          />
        ) : null,
      )}
      {todayIdx >= 0 && todayIdx < days.length && (
        <span
          className="timeline-today"
          style={{ left: todayIdx * dayW + dayW / 2 }}
          aria-hidden
        />
      )}
    </>
  );
}
