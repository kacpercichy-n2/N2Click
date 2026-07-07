// Task popout modal. Opening a task never leaves the current page — it renders
// as an overlay driven by the `?task=<id>` (or `?task=new[&project=<id>]`)
// search params. Rendered ONCE at App level. Closing removes the task/project
// params while keeping the rest of the URL (and the page's scroll) intact.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { useStore } from '../store/AppStore';
import type { AllocationCell, TaskDraft } from '../store/AppStore';
import { activeStatuses, assigneeIdsOfTask, getClient } from '../store/selectors';
import { CommentsPanel } from './CommentsPanel';
import { AllocationGrid, allocKey, isWeekdayDate, type AllocMap } from './AllocationGrid';
import { personColor } from '../utils/colors';
import { eachDayInclusive, inclusiveDayCount, todayStr } from '../utils/dates';

const MAX_PERIOD_DAYS = 92;

function fmtHours(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/**
 * Shared opener hook. Merges the task/project search params onto the CURRENT
 * location so the page underneath never changes.
 */
export function useOpenTask() {
  const navigate = useNavigate();
  const location = useLocation();

  const openTask = useCallback(
    (id: string) => {
      const params = new URLSearchParams(location.search);
      params.set('task', id);
      params.delete('project');
      navigate({ pathname: location.pathname, search: params.toString() });
    },
    [navigate, location.pathname, location.search],
  );

  const openNewTask = useCallback(
    (projectId?: string) => {
      const params = new URLSearchParams(location.search);
      params.set('task', 'new');
      if (projectId) params.set('project', projectId);
      else params.delete('project');
      navigate({ pathname: location.pathname, search: params.toString() });
    },
    [navigate, location.pathname, location.search],
  );

  return { openTask, openNewTask };
}

/** App-level mount point. Present on every route; only visible when `?task=` is set. */
export function TaskModal() {
  const [searchParams, setSearchParams] = useSearchParams();
  const taskParam = searchParams.get('task');
  const projectParam = searchParams.get('project');

  const close = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('task');
        next.delete('project');
        return next;
      },
      { replace: false },
    );
  }, [setSearchParams]);

  return (
    <AnimatePresence>
      {taskParam !== null && (
        <TaskModalShell
          key="task-modal"
          taskParam={taskParam}
          projectParam={projectParam}
          onClose={close}
        />
      )}
    </AnimatePresence>
  );
}

interface ShellProps {
  taskParam: string;
  projectParam: string | null;
  onClose: () => void;
}

function TaskModalShell({ taskParam, projectParam, onClose }: ShellProps) {
  const { state, dispatch } = useStore();
  const isNew = taskParam === 'new';
  const existing = isNew ? undefined : state.tasks.find((t) => t.id === taskParam);
  const notFound = !isNew && !existing;

  // Escape closes; body scroll locked while the modal is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const handleDelete = () => {
    if (!existing) return;
    if (
      window.confirm(
        `Delete "${existing.title}"? This removes its assignments and planned hours.`,
      )
    ) {
      dispatch({ type: 'DELETE_TASK', taskId: existing.id });
      onClose();
    }
  };

  const heading = notFound ? 'Task not found' : isNew ? 'New task' : 'Edit task';

  return (
    <>
      <motion.div
        className="task-modal-scrim"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
      />
      <div className="task-modal-viewport" onClick={onClose}>
        <motion.div
          className="task-modal-card"
          role="dialog"
          aria-modal="true"
          aria-label={heading}
          onClick={(e) => e.stopPropagation()}
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="task-modal-head">
            <h1 className="task-modal-title">{heading}</h1>
            <div className="task-modal-head-actions">
              {existing && (
                <button type="button" className="btn danger-ghost" onClick={handleDelete}>
                  Delete
                </button>
              )}
              <button
                type="button"
                className="task-modal-close"
                onClick={onClose}
                aria-label="Close"
              >
                ×
              </button>
            </div>
          </div>
          <div className="task-modal-body">
            {notFound ? (
              <div className="empty-state">
                <p className="empty-title">Task not found</p>
                <p className="empty-hint">
                  This task may have been deleted, or the link is out of date.
                </p>
                <button type="button" className="btn primary" onClick={onClose}>
                  Close
                </button>
              </div>
            ) : (
              <TaskEditor
                key={taskParam}
                taskId={existing ? existing.id : null}
                initialProjectId={projectParam ?? undefined}
                onSaved={onClose}
                onCancel={onClose}
              />
            )}
          </div>
        </motion.div>
      </div>
    </>
  );
}

interface EditorProps {
  taskId: string | null;
  initialProjectId?: string;
  onSaved: () => void;
  onCancel: () => void;
}

/** The full task editor form (moved out of the old TaskEditorPage). */
function TaskEditor({ taskId, initialProjectId, onSaved, onCancel }: EditorProps) {
  const { state, dispatch } = useStore();
  const existing = taskId ? state.tasks.find((t) => t.id === taskId) : undefined;
  const isEdit = Boolean(existing);

  const statuses = activeStatuses(state);

  // ---- Details ----
  const [title, setTitle] = useState(existing?.title ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [projectId, setProjectId] = useState(
    existing?.projectId ?? initialProjectId ?? state.projects[0]?.id ?? '',
  );
  const [statusId, setStatusId] = useState(
    existing?.statusId ?? statuses[0]?.id ?? state.statuses[0]?.id ?? '',
  );
  const [estimatedRaw, setEstimatedRaw] = useState(
    existing?.estimatedHours != null ? String(existing.estimatedHours) : '',
  );

  // ---- Period ----
  const [startDate, setStartDate] = useState(existing?.startDate ?? todayStr());
  const [endDate, setEndDate] = useState(existing?.endDate ?? todayStr());

  // ---- Assignees ----
  const [assigneeIds, setAssigneeIds] = useState<string[]>(() =>
    existing ? assigneeIdsOfTask(state, existing.id) : [],
  );

  // ---- Allocation map (personId|date -> hours), seeded from existing entries ----
  const [allocations, setAllocations] = useState<AllocMap>(() => {
    const map: AllocMap = {};
    if (existing) {
      for (const w of state.workload.filter((w) => w.taskId === existing.id)) {
        map[allocKey(w.personId, w.date)] = w.plannedHours;
      }
    }
    return map;
  });

  const [titleTouched, setTitleTouched] = useState(false);

  // Focus the title input when the editor opens.
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const titleError = title.trim() === '';
  const periodDays = inclusiveDayCount(startDate, endDate);
  const endBeforeStart = endDate < startDate;
  const periodTooLong = !endBeforeStart && periodDays > MAX_PERIOD_DAYS;
  const periodValid = !endBeforeStart && !periodTooLong;

  const assignedPeople = useMemo(
    () => state.people.filter((p) => assigneeIds.includes(p.id)),
    [state.people, assigneeIds],
  );

  const periodDaysSet = useMemo(
    () => new Set(periodValid ? eachDayInclusive(startDate, endDate) : []),
    [periodValid, startDate, endDate],
  );

  const outOfRangeCount = useMemo(() => {
    let n = 0;
    for (const [key, hours] of Object.entries(allocations)) {
      if (hours > 0) {
        const date = key.split('|')[1];
        if (!periodDaysSet.has(date)) n += 1;
      }
    }
    return n;
  }, [allocations, periodDaysSet]);

  // ---- Handlers ----

  const setCell = (personId: string, date: string, hours: number) => {
    setAllocations((prev) => {
      const next = { ...prev };
      const key = allocKey(personId, date);
      if (hours > 0) next[key] = hours;
      else delete next[key];
      return next;
    });
  };

  const fillWeekdays = (personId: string) => {
    setAllocations((prev) => {
      const next = { ...prev };
      for (const d of eachDayInclusive(startDate, endDate)) {
        if (isWeekdayDate(d)) next[allocKey(personId, d)] = 8;
      }
      return next;
    });
  };

  const clearPerson = (personId: string) => {
    setAllocations((prev) => {
      const next = { ...prev };
      for (const d of eachDayInclusive(startDate, endDate)) {
        delete next[allocKey(personId, d)];
      }
      return next;
    });
  };

  const toggleAssignee = (personId: string) => {
    const isAssigned = assigneeIds.includes(personId);
    if (isAssigned) {
      const person = state.people.find((p) => p.id === personId);
      const plannedOnThisTask = Object.entries(allocations)
        .filter(([key, h]) => h > 0 && key.startsWith(`${personId}|`))
        .reduce((s, [, h]) => s + h, 0);
      if (plannedOnThisTask > 0) {
        const ok = window.confirm(
          `Remove ${person?.name ?? 'this person'} and their ${fmtHours(
            plannedOnThisTask,
          )}h of planned work on this task?`,
        );
        if (!ok) return;
      }
      setAssigneeIds((prev) => prev.filter((pid) => pid !== personId));
      setAllocations((prev) => {
        const next: AllocMap = {};
        for (const [key, h] of Object.entries(prev)) {
          if (!key.startsWith(`${personId}|`)) next[key] = h;
        }
        return next;
      });
    } else {
      setAssigneeIds((prev) => [...prev, personId]);
    }
  };

  const projectError = projectId === '' || !state.projects.some((p) => p.id === projectId);

  const handleSave = () => {
    setTitleTouched(true);
    if (titleError) return;
    if (!periodValid) return;
    if (projectError) return;

    const cells: AllocationCell[] = [];
    for (const [key, hours] of Object.entries(allocations)) {
      if (hours <= 0) continue;
      const [personId, date] = key.split('|');
      if (!periodDaysSet.has(date)) continue;
      if (!assigneeIds.includes(personId)) continue;
      cells.push({ personId, date, plannedHours: hours });
    }

    const draft: TaskDraft = {
      projectId,
      statusId,
      title: title.trim(),
      description: description.trim(),
      startDate,
      endDate,
      estimatedHours: estimatedRaw.trim() === '' ? null : Number(estimatedRaw),
    };

    dispatch({
      type: 'SAVE_TASK',
      payload: {
        taskId: existing ? existing.id : null,
        draft,
        assigneeIds,
        allocations: cells,
      },
    });
    onSaved();
  };

  const plannedTotalAll = Object.values(allocations).reduce(
    (s, h) => s + (h > 0 ? h : 0),
    0,
  );
  const estNum = estimatedRaw.trim() === '' ? null : Number(estimatedRaw);

  return (
    <div className="editor task-editor">
      {/* a) Details */}
      <div className="editor-section">
        <h2>Details</h2>
        <div className="field">
          <label htmlFor="t-title">Title *</label>
          <input
            id="t-title"
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => setTitleTouched(true)}
            className={titleTouched && titleError ? 'invalid' : undefined}
            placeholder="What needs doing?"
          />
          {titleTouched && titleError && <p className="field-error">Title is required</p>}
        </div>
        <div className="field">
          <label htmlFor="t-desc">Description</label>
          <textarea
            id="t-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Optional details"
          />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="t-project">Project *</label>
            {state.projects.length === 0 ? (
              <p className="field-hint">
                No projects yet — <Link to="/projects">create a project</Link> first. Every
                task belongs to a project.
              </p>
            ) : (
              <select
                id="t-project"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                {state.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {getClient(state, p.clientId)
                      ? ` — ${getClient(state, p.clientId)?.name}`
                      : ''}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="field">
            <label htmlFor="t-status">Status</label>
            <select
              id="t-status"
              value={statusId}
              onChange={(e) => setStatusId(e.target.value)}
            >
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="t-est">Estimated hours</label>
            <input
              id="t-est"
              type="number"
              min={0}
              step={0.5}
              value={estimatedRaw}
              onChange={(e) => setEstimatedRaw(e.target.value)}
              placeholder="Optional"
            />
          </div>
        </div>
        <div className="estimate-compare">
          <span>
            <strong>{fmtHours(plannedTotalAll)}h</strong> planned
          </span>
          <span className="muted">vs</span>
          <span>
            {estNum != null && !Number.isNaN(estNum) ? (
              <>
                <strong>{fmtHours(estNum)}h</strong> estimated
              </>
            ) : (
              <span className="muted">no estimate</span>
            )}
          </span>
        </div>
      </div>

      {/* b) Period */}
      <div className="editor-section">
        <h2>Period</h2>
        <div className="field-row">
          <div className="field">
            <label htmlFor="t-start">Start date</label>
            <input
              id="t-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="t-end">End date</label>
            <input
              id="t-end"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        </div>
        {endBeforeStart && (
          <p className="field-error">End date must be on or after the start date.</p>
        )}
        {periodTooLong && (
          <p className="field-error">
            Period is {periodDays} days — the maximum is {MAX_PERIOD_DAYS} days. Shorten the
            range.
          </p>
        )}
        {periodValid && (
          <p className="field-hint">
            {periodDays} day{periodDays === 1 ? '' : 's'} in this period.
          </p>
        )}
      </div>

      {/* c) Assignees */}
      <div className="editor-section">
        <h2>Assignees</h2>
        {state.people.length === 0 ? (
          <p className="field-hint">
            No people yet. <Link to="/people">Add people</Link> to assign work.
          </p>
        ) : (
          <div className="assignee-picker">
            {state.people.map((p) => {
              const checked = assigneeIds.includes(p.id);
              return (
                <label
                  key={p.id}
                  className={checked ? 'assignee-chip checked' : 'assignee-chip'}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleAssignee(p.id)}
                  />
                  <span
                    className="person-dot"
                    style={{ background: personColor(p.id) }}
                    aria-hidden
                  />
                  {p.name}
                </label>
              );
            })}
          </div>
        )}
      </div>

      {/* d) Daily allocation grid */}
      <div className="editor-section">
        <h2>Daily allocation</h2>
        {!periodValid ? (
          <p className="field-hint">Set a valid period to plan hours.</p>
        ) : assignedPeople.length === 0 ? (
          <p className="field-hint">Assign at least one person to plan hours.</p>
        ) : (
          <>
            {outOfRangeCount > 0 && (
              <p className="field-notice">
                {outOfRangeCount} allocation{outOfRangeCount === 1 ? '' : 's'} outside the
                new period will be removed on save.
              </p>
            )}
            <AllocationGrid
              state={state}
              currentTaskId={existing ? existing.id : null}
              startDate={startDate}
              endDate={endDate}
              people={assignedPeople}
              allocations={allocations}
              onChange={setCell}
              onFillWeekdays={fillWeekdays}
              onClearPerson={clearPerson}
            />
          </>
        )}
      </div>

      {/* e) Discussion (existing tasks only) */}
      {existing && (
        <div className="editor-section">
          <h2>Discussion</h2>
          <CommentsPanel entityType="task" entityId={existing.id} />
        </div>
      )}

      {/* f) Save / Cancel */}
      {projectError && state.projects.length > 0 && (
        <p className="field-error">Pick a project for this task.</p>
      )}
      <div className="editor-actions">
        <button
          type="button"
          className="btn primary"
          onClick={handleSave}
          disabled={state.projects.length === 0}
          title={state.projects.length === 0 ? 'Create a project first' : undefined}
        >
          {isEdit ? 'Save changes' : 'Create task'}
        </button>
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
