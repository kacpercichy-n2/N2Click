import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../store/AppStore';
import type { AllocationCell, TaskDraft } from '../store/AppStore';
import { assigneeIdsOfTask } from '../store/selectors';
import {
  AllocationGrid,
  allocKey,
  isWeekdayDate,
  type AllocMap,
} from '../components/AllocationGrid';
import { personColor } from '../utils/colors';
import { eachDayInclusive, inclusiveDayCount, todayStr } from '../utils/dates';

const MAX_PERIOD_DAYS = 92;

function fmtHours(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

export function TaskEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { state, dispatch } = useStore();

  const existing = id ? state.tasks.find((t) => t.id === id) : undefined;
  const isEdit = Boolean(existing);
  // Guard: an :id route that doesn't resolve to a task.
  const notFound = Boolean(id && !existing);

  // ---- Details ----
  const [title, setTitle] = useState(existing?.title ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [project, setProject] = useState(existing?.project ?? '');
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

  const titleError = title.trim() === '';
  const periodDays = inclusiveDayCount(startDate, endDate);
  const endBeforeStart = endDate < startDate;
  const periodTooLong = !endBeforeStart && periodDays > MAX_PERIOD_DAYS;
  const periodValid = !endBeforeStart && !periodTooLong;

  const assignedPeople = useMemo(
    () => state.people.filter((p) => assigneeIds.includes(p.id)),
    [state.people, assigneeIds],
  );

  // Days currently inside the period, for the out-of-range notice + save filter.
  const periodDaysSet = useMemo(
    () => new Set(periodValid ? eachDayInclusive(startDate, endDate) : []),
    [periodValid, startDate, endDate],
  );

  // Count allocations (hours>0) that fall outside the current period — these are
  // dropped on save. Shown as a one-line notice before saving.
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
      else delete next[key]; // editing to 0 removes the entry
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
      // Removing: if this person has planned hours on this task, confirm.
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
      // Drop their allocations for this task.
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

  const handleSave = () => {
    setTitleTouched(true);
    if (titleError) return;
    if (!periodValid) return;

    // Build the allocation list, keeping only in-period cells with hours>0.
    const cells: AllocationCell[] = [];
    for (const [key, hours] of Object.entries(allocations)) {
      if (hours <= 0) continue;
      const [personId, date] = key.split('|');
      if (!periodDaysSet.has(date)) continue; // drop out-of-range
      if (!assigneeIds.includes(personId)) continue; // drop unassigned
      cells.push({ personId, date, plannedHours: hours });
    }

    const draft: TaskDraft = {
      title: title.trim(),
      description: description.trim(),
      project: project.trim(),
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
    navigate('/tasks');
  };

  if (notFound) {
    return (
      <section className="page">
        <div className="empty-state">
          <p className="empty-title">Task not found</p>
          <Link to="/tasks" className="btn primary">
            Back to tasks
          </Link>
        </div>
      </section>
    );
  }

  // Live per-person planned totals for the details vs allocation comparison.
  const plannedTotalAll = Object.values(allocations).reduce(
    (s, h) => s + (h > 0 ? h : 0),
    0,
  );
  const estNum = estimatedRaw.trim() === '' ? null : Number(estimatedRaw);

  return (
    <section className="page editor">
      <div className="page-head">
        <h1>{isEdit ? 'Edit task' : 'New task'}</h1>
      </div>

      {/* a) Details */}
      <div className="editor-section">
        <h2>Details</h2>
        <div className="field">
          <label htmlFor="t-title">Title *</label>
          <input
            id="t-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => setTitleTouched(true)}
            className={titleTouched && titleError ? 'invalid' : undefined}
            placeholder="What needs doing?"
          />
          {titleTouched && titleError && (
            <p className="field-error">Title is required</p>
          )}
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
            <label htmlFor="t-project">Project</label>
            <input
              id="t-project"
              value={project}
              onChange={(e) => setProject(e.target.value)}
              placeholder="Optional category"
            />
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
            Period is {periodDays} days — the maximum is {MAX_PERIOD_DAYS} days.
            Shorten the range.
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
                {outOfRangeCount} allocation{outOfRangeCount === 1 ? '' : 's'} outside
                the new period will be removed on save.
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

      {/* e) Save / Cancel */}
      <div className="editor-actions">
        <button type="button" className="btn primary" onClick={handleSave}>
          {isEdit ? 'Save changes' : 'Create task'}
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={() => navigate('/tasks')}
        >
          Cancel
        </button>
      </div>
    </section>
  );
}
