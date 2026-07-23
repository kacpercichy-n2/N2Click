// Timeline: project start/end bars, task blocks, milestones, and deadlines on a
// horizontal day axis. Bars drag to reschedule (move) and resize from either
// edge. Moving a TASK also shifts its planned time blocks; resizing drops
// blocks that fall outside the new period (same rule as the editor).
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/AppStore';
import { useCan } from '../store/useCan';
import { DEFAULT_FILTER_CRITERIA } from '../store/storage';
import { useOpenTask } from '../components/TaskModal';
import { ActivePersonChips, PersonFilterSection } from '../components/PersonFilter';
import { FilterPanel, type FilterChip, type FilterGroup } from '../components/FilterPanel';
import { ZoomIn, ZoomOut } from '../components/icons';
import type { Milestone, Person, Project, SavedFilterCriteria, Task } from '../types';
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
  todayStr,
  weekStart,
} from '../utils/dates';
import {
  DEFAULT_ZOOM_LEVEL,
  canZoomIn as canZoomInLevel,
  canZoomOut as canZoomOutLevel,
  shiftAnchor,
  zoomIn as zoomInLevel,
  zoomOut as zoomOutLevel,
  zoomView,
  type ZoomLevel,
} from './timelineZoom';

// Stabilna pusta lista chipów osób (referencja) na czas braku zapamiętanego filtra.
const EMPTY_PERSON_IDS: string[] = [];

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
  const [level, setLevel] = useState<ZoomLevel>(DEFAULT_ZOOM_LEVEL);

  // Stan filtrów ZAPAMIĘTANY w store (`lastFilters.timeline`): chipy osób w
  // `personIds`, klient w `criteria.clientId`, projekt w `criteria.projectId`.
  // Setter wysyła pełny snapshot (no-op zapisu identycznego). Set osób jest
  // wyłącznie POCHODNY (inwariant 7).
  const rememberedTimeline = state.lastFilters.timeline;
  const timelineCriteria: SavedFilterCriteria = rememberedTimeline?.criteria ?? DEFAULT_FILTER_CRITERIA;
  const clientFilter = timelineCriteria.clientId;
  const projectFilter = timelineCriteria.projectId;
  const ownerIds = rememberedTimeline?.personIds ?? EMPTY_PERSON_IDS;
  const ownerFilter = useMemo(() => new Set(ownerIds), [ownerIds]);

  const commitTimeline = (patch: {
    clientId?: string;
    projectId?: string;
    personIds?: string[];
  }) =>
    dispatch({
      type: 'SET_LAST_FILTER',
      view: 'timeline',
      filter: {
        criteria: {
          ...timelineCriteria,
          clientId: patch.clientId ?? clientFilter,
          projectId: patch.projectId ?? projectFilter,
        },
        personIds: patch.personIds ?? ownerIds,
        departmentId: '',
        serviceTypeId: '',
        planning: '',
      },
    });

  const setOwnerIds = (ids: string[]) => commitTimeline({ personIds: ids });
  const toggleOwner = (id: string) => {
    const next = new Set(ownerFilter);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOwnerIds([...next]);
  };
  const setClientFilter = (v: string) => commitTimeline({ clientId: v });
  const setProjectFilter = (v: string) => commitTimeline({ projectId: v });
  const clearFilters = () =>
    commitTimeline({ clientId: '', projectId: '', personIds: [] });

  const canZoomIn = canZoomInLevel(level);
  const canZoomOut = canZoomOutLevel(level);

  // Visible range + geometry for the current zoom level, anchored at `anchor`.
  const { rangeStart, totalDays, dayW } = zoomView(level, anchor);
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
    const matchesProject = (p: Project) => !projectFilter || p.id === projectFilter;
    const out: Array<{ name: string; projects: Project[] }> = [];
    for (const c of state.clients) {
      if (clientFilter && c.id !== clientFilter) continue;
      const own = state.projects.filter((p) => p.clientId === c.id && matchesProject(p));
      if (own.length > 0) out.push({ name: c.name, projects: own });
    }
    if (!clientFilter) {
      const known = new Set(state.clients.map((c) => c.id));
      const orphans = state.projects.filter(
        (p) => !known.has(p.clientId) && matchesProject(p),
      );
      if (orphans.length > 0) out.push({ name: 'Bez klienta', projects: orphans });
    }
    return out;
  }, [state.clients, state.projects, clientFilter, projectFilter]);

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
        .filter((t) => !projectFilter || t.projectId === projectFilter)
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
    projectFilter,
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

  // Filtry (domyślnie zwinięty popover): Klient + Projekt jako grupy radio, Osoby
  // jako multi-select przez `extra`. Lista projektów zawężona do wybranego klienta.
  const projectOptions = state.projects
    .filter((p) => !clientFilter || p.clientId === clientFilter)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  const selectedProject = state.projects.find((p) => p.id === projectFilter);
  const selectedClient = state.clients.find((c) => c.id === clientFilter);
  const filterGroups: FilterGroup[] = [
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
        { value: '', label: 'Wszystkie projekty' },
        ...projectOptions.map((p) => ({ value: p.id, label: p.name })),
      ],
    },
  ];
  const activeCount =
    (clientFilter ? 1 : 0) + (projectFilter ? 1 : 0) + (ownerFilter.size > 0 ? 1 : 0);
  const chips: FilterChip[] = [];
  if (clientFilter)
    chips.push({
      key: 'client',
      label: `Klient: ${selectedClient?.name ?? '—'}`,
      onRemove: () => setClientFilter(''),
    });
  if (projectFilter)
    chips.push({
      key: 'project',
      label: `Projekt: ${selectedProject?.name ?? '—'}`,
      onRemove: () => setProjectFilter(''),
    });
  // Zaznaczone osoby renderują się jako kompaktowe chipy obok popovera
  // (ActivePersonChips), a nie jako pojedynczy zbiorczy chip.

  return (
    <section className="page page-wide">
      <div className="page-head">
        <h1>Oś czasu</h1>
        <div className="cal-nav" data-tour="timeline.toolbar">
          <button
            type="button"
            className="nav-btn"
            onClick={() => setAnchor((a) => shiftAnchor(level, a, -1))}
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
            onClick={() => setAnchor((a) => shiftAnchor(level, a, 1))}
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
              onClick={() => canZoomOut && setLevel((l) => zoomOutLevel(l))}
              disabled={!canZoomOut}
              aria-label="Pomniejsz"
            >
              <ZoomOut size={16} aria-hidden />
            </button>
            <button
              type="button"
              className="nav-btn"
              onClick={() => canZoomIn && setLevel((l) => zoomInLevel(l))}
              disabled={!canZoomIn}
              aria-label="Powiększ"
            >
              <ZoomIn size={16} aria-hidden />
            </button>
          </div>
        </div>
      </div>
      <div className="timeline-hint-row">
        <p className="field-hint">
          {mode === 'projects'
            ? 'Przeciągnij pasek, aby zmienić termin; przeciągnij krawędzie, aby zmienić start lub koniec. Przesunięcie zadania przesuwa razem z nim zaplanowane godziny. ◆ kamienie milowe też można przeciągać.'
            : 'Widok według osób: każdy wiersz to zadanie danej osoby. Kliknij pasek, aby otworzyć zadanie. Paski są tylko do odczytu — terminy zmieniasz w trybie Projekty.'}
        </p>
        <FilterPanel
          groups={filterGroups}
          activeCount={activeCount}
          onClearAll={clearFilters}
          chips={chips}
          extra={
            <PersonFilterSection
              people={state.people}
              selected={ownerFilter}
              onToggle={toggleOwner}
              onAll={() => setOwnerIds([])}
            />
          }
        />
        <ActivePersonChips
          people={state.people}
          selected={ownerFilter}
          onRemove={toggleOwner}
        />
      </div>

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
                  // Label every Monday (the range may not start on one, e.g. the
                  // month view) plus day 0 so the first column is always labelled.
                  weekStart(d) === d || i === 0 ? (
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
