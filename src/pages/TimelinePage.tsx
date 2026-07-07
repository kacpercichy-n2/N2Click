// Timeline: project start/end bars, task blocks, milestones, and deadlines on a
// horizontal day axis. Bars drag to reschedule (move) and resize from either
// edge. Moving a TASK also shifts its planned time blocks; resizing drops
// blocks that fall outside the new period (same rule as the editor).
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/AppStore';
import { useOpenTask } from '../components/TaskModal';
import type { Milestone, Project, Task } from '../types';
import {
  activeStatuses,
  getStatus,
  milestonesOfProject,
  tasksOfProject,
} from '../store/selectors';
import { Coin } from '../components/Coin';
import {
  addDaysStr,
  diffDays,
  formatShort,
  isWeekend,
  shiftWeek,
  todayStr,
  weekStart,
} from '../utils/dates';

const DAY_W = 26; // px per day
const WEEKS = 10; // visible range

type DragMode = 'move' | 'start' | 'end';

interface BarProps {
  startIdx: number; // day index of bar start within the range
  span: number; // days (>= 1)
  totalDays: number;
  color: string;
  className: string;
  title: string;
  resizable: boolean;
  onCommit: (mode: DragMode, deltaDays: number) => void;
  onOpen: () => void;
  children?: React.ReactNode;
}

/** A draggable/resizable bar. Click (without drag) opens the entity. */
function Bar({
  startIdx,
  span,
  totalDays,
  color,
  className,
  title,
  resizable,
  onCommit,
  onOpen,
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
    let delta = Math.round((e.clientX - drag.originX) / DAY_W);
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

  let left = startIdx * DAY_W;
  let width = span * DAY_W;
  if (drag) {
    if (drag.mode === 'move') left += drag.delta * DAY_W;
    if (drag.mode === 'start') {
      left += drag.delta * DAY_W;
      width -= drag.delta * DAY_W;
    }
    if (drag.mode === 'end') width += drag.delta * DAY_W;
  }
  // Cull bars fully outside the range.
  if (left + width < 0 || left > totalDays * DAY_W) return null;

  return (
    <div
      className={drag ? `${className} dragging` : className}
      style={{ left, width, borderColor: color }}
      title={title}
      onPointerDown={begin('move')}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
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
      {resizable && (
        <span className="bar-handle left" onPointerDown={begin('start')} aria-hidden />
      )}
      <span className="bar-label">{children}</span>
      {resizable && (
        <span className="bar-handle right" onPointerDown={begin('end')} aria-hidden />
      )}
    </div>
  );
}

/** Draggable milestone diamond. */
function MilestoneMark({
  milestone,
  dayIdx,
  onCommit,
}: {
  milestone: Milestone;
  dayIdx: number;
  onCommit: (deltaDays: number) => void;
}) {
  const [drag, setDrag] = useState<{ originX: number; delta: number } | null>(null);
  return (
    <span
      className={drag ? 'timeline-milestone dragging' : 'timeline-milestone'}
      style={{ left: (dayIdx + (drag?.delta ?? 0)) * DAY_W + DAY_W / 2 }}
      title={`◆ ${milestone.name} — ${formatShort(milestone.date)} (przeciągnij, aby przesunąć)`}
      onPointerDown={(e) => {
        e.stopPropagation();
        try {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          // No active pointer (synthetic events) — see Bar.begin.
        }
        setDrag({ originX: e.clientX, delta: 0 });
      }}
      onPointerMove={(e) => {
        if (!drag) return;
        const delta = Math.round((e.clientX - drag.originX) / DAY_W);
        setDrag((d) => (d ? { ...d, delta } : d));
      }}
      onPointerUp={() => {
        if (!drag) return;
        const { delta } = drag;
        setDrag(null);
        if (delta !== 0) onCommit(delta);
      }}
    >
      ◆
    </span>
  );
}

export function TimelinePage() {
  const { state, dispatch } = useStore();
  const navigate = useNavigate();
  const { openTask } = useOpenTask();
  const [anchor, setAnchor] = useState(() => todayStr());

  // Visible range: from one week before the anchor's Monday, WEEKS weeks long.
  const rangeStart = shiftWeek(weekStart(anchor), -1);
  const totalDays = WEEKS * 7;
  const days = useMemo(
    () => Array.from({ length: totalDays }, (_, i) => addDaysStr(rangeStart, i)),
    [rangeStart, totalDays],
  );
  const today = todayStr();
  const todayIdx = diffDays(rangeStart, today);
  const dayIdx = (d: string) => diffDays(rangeStart, d);

  const doneStatusId = activeStatuses(state).slice(-1)[0]?.id;

  // Group projects by client, in client-list order.
  const groups = useMemo(() => {
    const out: Array<{ name: string; projects: Project[] }> = [];
    for (const c of state.clients) {
      const own = state.projects.filter((p) => p.clientId === c.id);
      if (own.length > 0) out.push({ name: c.name, projects: own });
    }
    const known = new Set(state.clients.map((c) => c.id));
    const orphans = state.projects.filter((p) => !known.has(p.clientId));
    if (orphans.length > 0) out.push({ name: 'Bez klienta', projects: orphans });
    return out;
  }, [state.clients, state.projects]);

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
        <div className="cal-nav">
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
        </div>
      </div>
      <p className="field-hint">
        Przeciągnij pasek, aby zmienić termin; przeciągnij krawędzie, aby zmienić start lub koniec.
        Przesunięcie zadania przesuwa razem z nim zaplanowane godziny. ◆ kamienie milowe też można przeciągać.
      </p>

      {state.projects.length === 0 ? (
        <div className="empty-state">
          <p className="empty-title">Brak elementów do zaplanowania</p>
          <p className="empty-hint">Utwórz projekt, aby zobaczyć go na osi czasu.</p>
        </div>
      ) : (
        <div className="timeline-scroll">
          <div className="timeline" style={{ width: 240 + totalDays * DAY_W }}>
            {/* Header: week labels + day stripes */}
            <div className="timeline-row timeline-head">
              <div className="timeline-label" />
              <div className="timeline-track">
                {days.map((d, i) =>
                  i % 7 === 0 ? (
                    <span key={d} className="timeline-week-label" style={{ left: i * DAY_W }}>
                      {formatShort(d)}
                    </span>
                  ) : null,
                )}
              </div>
            </div>

            {groups.map((g) => (
              <div key={g.name} className="timeline-group">
                <div className="timeline-row timeline-client-row">
                  <div className="timeline-label timeline-client">{g.name}</div>
                  <div className="timeline-track" />
                </div>
                {g.projects.map((p) => {
                  const status = getStatus(state, p.statusId);
                  const overdue = p.endDate < today && p.statusId !== doneStatusId;
                  const tasks = tasksOfProject(state, p.id).sort((a, b) =>
                    a.startDate.localeCompare(b.startDate),
                  );
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
                          <DayStripes days={days} todayIdx={todayIdx} />
                          <Bar
                            startIdx={dayIdx(p.startDate)}
                            span={diffDays(p.startDate, p.endDate) + 1}
                            totalDays={totalDays}
                            color={status?.color ?? '#64748b'}
                            className={
                              overdue ? 'timeline-bar project overdue' : 'timeline-bar project'
                            }
                            title={`${p.name}: ${formatShort(p.startDate)} – ${formatShort(p.endDate)}${overdue ? ' (po terminie)' : ''}`}
                            resizable
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
                      {tasks.map((t) => (
                        <div key={t.id} className="timeline-row timeline-task-row">
                          <div className="timeline-label timeline-task-label" title={t.title}>
                            {t.title}
                          </div>
                          <div className="timeline-track">
                            <DayStripes days={days} todayIdx={todayIdx} />
                            <Bar
                              startIdx={dayIdx(t.startDate)}
                              span={diffDays(t.startDate, t.endDate) + 1}
                              totalDays={totalDays}
                              color={getStatus(state, t.statusId)?.color ?? '#94a3b8'}
                              className="timeline-bar task"
                              title={`${t.title}: ${formatShort(t.startDate)} – ${formatShort(t.endDate)}`}
                              resizable
                              onCommit={commitTask(t)}
                              onOpen={() => openTask(t.id)}
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
          </div>
        </div>
      )}
    </section>
  );
}

/** Weekend shading + today line, shared by every track. */
function DayStripes({ days, todayIdx }: { days: string[]; todayIdx: number }) {
  return (
    <>
      {days.map((d, i) =>
        isWeekend(d) ? (
          <span
            key={d}
            className="timeline-weekend"
            style={{ left: i * DAY_W, width: DAY_W }}
            aria-hidden
          />
        ) : null,
      )}
      {todayIdx >= 0 && todayIdx < days.length && (
        <span
          className="timeline-today"
          style={{ left: todayIdx * DAY_W + DAY_W / 2 }}
          aria-hidden
        />
      )}
    </>
  );
}
