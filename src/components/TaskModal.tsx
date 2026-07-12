// Task popout modal. Opening a task never leaves the current page — it renders
// as an overlay driven by the `?task=<id>` (or `?task=new[&project=<id>]`)
// search params. Rendered ONCE at App level. Closing removes the task/project
// params while keeping the rest of the URL (and the page's scroll) intact.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { useStore } from '../store/AppStore';
import { useCan } from '../store/useCan';
import { NO_PERM_TITLE } from '../store/permissions';
import type { AllocationCell, TaskDraft } from '../store/AppStore';
import type { ChecklistItem, TaskPriority } from '../types';
import { PRIORITY_LABELS, TASK_PRIORITIES } from '../utils/priority';
import {
  activeStatuses,
  assigneeIdsOfTask,
  availableHoursOnDate,
  binEntriesForTask,
  getClient,
  getStatus,
  planningStatusForTotals,
} from '../store/selectors';
import { PlanningBadge } from './PlanningBadge';
import { CommentsPanel } from './CommentsPanel';
import { AllocationGrid, allocKey, type AllocMap } from './AllocationGrid';
import { SaveStatus } from './SaveStatus';
import { personColor } from '../utils/colors';
import { formatDuration, isBinEntry, snapHours } from '../utils/time';
import {
  eachDayInclusive,
  inclusiveDayCount,
  todayStr,
  periodError,
  PERIOD_ERROR_LABELS,
  MAX_TASK_PERIOD_DAYS,
} from '../utils/dates';
import { useSaveStatus } from '../utils/useSaveStatus';

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
  const canManageTasks = useCan()('tasks.manage');
  const isNew = taskParam === 'new';
  const existing = isNew ? undefined : state.tasks.find((t) => t.id === taskParam);
  const notFound = !isNew && !existing;

  // Dirty state lives in the TaskEditor; it reports up here so every close path
  // can guard. A ref backs the Escape handler (which registers once), and the
  // state drives the save-status badge + beforeunload prompt.
  const dirtyRef = useRef(false);
  const [dirty, setDirty] = useState(false);
  const handleDirtyChange = useCallback((d: boolean) => {
    dirtyRef.current = d;
    setDirty(d);
  }, []);
  const { status, markSaved } = useSaveStatus(dirty);

  // Any close path prompts when there are unsaved changes.
  const requestClose = useCallback(() => {
    if (
      dirtyRef.current &&
      !window.confirm('Masz niezapisane zmiany. Zamknąć bez zapisywania?')
    ) {
      return;
    }
    onClose();
  }, [onClose]);

  // Escape closes (with guard); body scroll locked while the modal is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [requestClose]);

  const handleDelete = () => {
    if (!existing) return;
    if (
      window.confirm(
        `Usunąć „${existing.title}”? To usunie przypisania i zaplanowane godziny.`,
      )
    ) {
      dispatch({ type: 'DELETE_TASK', taskId: existing.id });
      onClose();
    }
  };

  const heading = notFound ? 'Nie znaleziono zadania' : isNew ? 'Nowe zadanie' : 'Edytuj zadanie';

  return (
    <>
      <motion.div
        className="task-modal-scrim"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
      />
      <div className="task-modal-viewport" onClick={requestClose}>
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
              {!notFound && <SaveStatus status={status} />}
              {existing && canManageTasks && (
                <button type="button" className="btn danger-ghost" onClick={handleDelete}>
                  Usuń
                </button>
              )}
              <button
                type="button"
                className="task-modal-close"
                onClick={requestClose}
                aria-label="Zamknij"
              >
                ×
              </button>
            </div>
          </div>
          <div className="task-modal-body">
            {notFound ? (
              <div className="empty-state">
                <p className="empty-title">Nie znaleziono zadania</p>
                <p className="empty-hint">
                  Zadanie mogło zostać usunięte albo link jest nieaktualny.
                </p>
                <button type="button" className="btn primary" onClick={onClose}>
                  Zamknij
                </button>
              </div>
            ) : (
              <TaskEditor
                key={taskParam}
                taskId={existing ? existing.id : null}
                initialProjectId={projectParam ?? undefined}
                onSaved={onClose}
                onCancel={requestClose}
                onDirtyChange={handleDirtyChange}
                markSaved={markSaved}
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
  onDirtyChange: (dirty: boolean) => void;
  markSaved: () => void;
}

/** Stable serialization of all form state, used for dirty detection. */
function serializeDraft(v: {
  title: string;
  description: string;
  projectId: string;
  statusId: string;
  estimatedRaw: string;
  priority: TaskPriority;
  workCategoryId: string;
  checklist: ChecklistItem[];
  startDate: string;
  endDate: string;
  assigneeIds: string[];
  allocations: AllocMap;
  pendingUnassigned: Array<{ personId: string; hours: number }>;
}): string {
  return JSON.stringify({
    title: v.title,
    description: v.description,
    projectId: v.projectId,
    statusId: v.statusId,
    estimatedRaw: v.estimatedRaw,
    priority: v.priority,
    workCategoryId: v.workCategoryId,
    // Order-sensitive: item identity + text + done state all participate in dirty.
    checklist: v.checklist.map((c) => [c.id, c.text, c.done]),
    startDate: v.startDate,
    endDate: v.endDate,
    assigneeIds: [...v.assigneeIds].sort(),
    allocations: Object.entries(v.allocations)
      .filter(([, h]) => h > 0)
      .sort(([a], [b]) => a.localeCompare(b)),
    pendingUnassigned: v.pendingUnassigned.map((u) => [u.personId, u.hours]),
  });
}

/** The full task editor form (moved out of the old TaskEditorPage). */
function TaskEditor({
  taskId,
  initialProjectId,
  onSaved,
  onCancel,
  onDirtyChange,
  markSaved,
}: EditorProps) {
  const { state, dispatch } = useStore();
  const canManage = useCan()('tasks.manage');
  const readOnly = !canManage;
  const roTitle = readOnly ? NO_PERM_TITLE : undefined;
  const existing = taskId ? state.tasks.find((t) => t.id === taskId) : undefined;
  const isEdit = Boolean(existing);

  const statuses = activeStatuses(state);
  // Keep the edited task's own archived status pickable so the select isn't
  // lying (only that one status, appended at the end).
  const currentStatus = existing ? getStatus(state, existing.statusId) : undefined;
  const pickableStatuses =
    currentStatus && currentStatus.archived ? [...statuses, currentStatus] : statuses;

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
  const [priority, setPriority] = useState<TaskPriority>(existing?.priority ?? 'normal');
  const [workCategoryId, setWorkCategoryId] = useState<string>(existing?.workCategoryId ?? '');
  const [checklist, setChecklist] = useState<ChecklistItem[]>(existing?.checklist ?? []);
  const [checklistInput, setChecklistInput] = useState('');

  // ---- Period ----
  const [startDate, setStartDate] = useState(existing?.startDate ?? todayStr());
  const [endDate, setEndDate] = useState(existing?.endDate ?? todayStr());

  // ---- Assignees ----
  const [assigneeIds, setAssigneeIds] = useState<string[]>(() =>
    existing ? assigneeIdsOfTask(state, existing.id) : [],
  );

  // ---- Allocation map (personId|date -> hours), seeded from existing DATED
  // entries only. Bin entries (date === '') are shown in a separate section and
  // never enter the allocation grid. A cell is the person's DAY TOTAL, so when a
  // day has several blocks their hours SUM into one cell (0.25-multiples add
  // exactly in floats). saveTask reconciles that total back onto the blocks. ----
  const [allocations, setAllocations] = useState<AllocMap>(() => {
    const map: AllocMap = {};
    if (existing) {
      for (const w of state.workload.filter(
        (w) => w.taskId === existing.id && !isBinEntry(w),
      )) {
        const key = allocKey(w.personId, w.date);
        map[key] = (map[key] ?? 0) + w.plannedHours;
      }
    }
    return map;
  });

  // How many dated blocks back each cell (allocKey -> count). Cells with ≥2
  // blocks get a ×N badge + explanatory tooltip in the grid, since editing the
  // total there reshapes several calendar blocks.
  const multiBlockCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    if (existing) {
      for (const w of state.workload) {
        if (w.taskId === existing.id && !isBinEntry(w)) {
          const key = allocKey(w.personId, w.date);
          counts[key] = (counts[key] ?? 0) + 1;
        }
      }
    }
    return counts;
  }, [state.workload, existing]);

  // ---- Bin (zasobnik): hours queued to be appended as dateless blocks ----
  const [pendingUnassigned, setPendingUnassigned] = useState<
    Array<{ personId: string; hours: number }>
  >([]);
  const [binPersonId, setBinPersonId] = useState('');
  const [binHoursRaw, setBinHoursRaw] = useState('1');

  const [titleTouched, setTitleTouched] = useState(false);

  // Focus the title input when the editor opens.
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const titleError = title.trim() === '';
  const perErr = periodError(startDate, endDate, { maxDays: MAX_TASK_PERIOD_DAYS });
  const periodValid = perErr === null;
  // Only computed for display below, and only rendered when periodValid — so a
  // NaN from an empty/invalid endpoint can never reach the DOM.
  const periodDays = periodValid ? inclusiveDayCount(startDate, endDate) : 0;

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

  // ---- Dirty tracking ----
  // Serialize the current form state; the first render's value is the baseline
  // snapshot (state is initialized to the existing task / new-task defaults).
  const currentSerialized = serializeDraft({
    title,
    description,
    projectId,
    statusId,
    estimatedRaw,
    priority,
    workCategoryId,
    checklist,
    startDate,
    endDate,
    assigneeIds,
    allocations,
    pendingUnassigned,
  });
  const snapshotRef = useRef<string | null>(null);
  if (snapshotRef.current === null) snapshotRef.current = currentSerialized;
  const dirty = snapshotRef.current !== currentSerialized;

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

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
        // Fill the person's own workdays with their daily availability
        // (capacity on a workday, 0 otherwise) instead of hardcoded Mon–Fri/8h.
        const hours = availableHoursOnDate(state, personId, d);
        if (hours > 0) next[allocKey(personId, d)] = hours;
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
      // Dated allocation hours for this person on this task.
      const datedOnThisTask = Object.entries(allocations)
        .filter(([key, h]) => h > 0 && key.startsWith(`${personId}|`))
        .reduce((s, [, h]) => s + h, 0);
      // Bin hours saveTask would silently drop when the person is unassigned:
      // existing dateless entries + any pending (unsaved) additions.
      const existingBinForPerson = existing
        ? binEntriesForTask(state, existing.id)
            .filter((w) => w.personId === personId)
            .reduce((s, w) => s + w.plannedHours, 0)
        : 0;
      const pendingBinForPerson = pendingUnassigned
        .filter((u) => u.personId === personId && u.hours > 0)
        .reduce((s, u) => s + u.hours, 0);
      const binForPerson = existingBinForPerson + pendingBinForPerson;
      const droppedTotal = datedOnThisTask + binForPerson;
      if (droppedTotal > 0) {
        const binSuffix = binForPerson > 0 ? ` (w tym ${formatDuration(binForPerson)} w zasobniku)` : '';
        const ok = window.confirm(
          `Usunąć ${person?.name ?? 'tę osobę'} oraz ${formatDuration(
            droppedTotal,
          )} zaplanowanej pracy z tego zadania${binSuffix}?`,
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
      // Drop this person's queued bin chips too (saveTask would ignore them).
      setPendingUnassigned((prev) => prev.filter((u) => u.personId !== personId));
    } else {
      setAssigneeIds((prev) => [...prev, personId]);
    }
  };

  const projectError = projectId === '' || !state.projects.some((p) => p.id === projectId);

  // Normalize the estimate ONCE and reuse it for save, the over-budget banner,
  // and the display so they can never disagree. Snap to a 0.25 step first (no
  // clamp — a 40h estimate stays 40h), then clear to null when the input is
  // empty, invalid, or non-positive AFTER snapping (so e.g. 0.1 snaps to 0 and
  // clears, instead of persisting a 0-budget task that blocks all calendar
  // inserts/grows).
  const estParsed = estimatedRaw.trim() === '' ? NaN : Number(estimatedRaw);
  const estSnapped = Number.isNaN(estParsed) ? NaN : snapHours(estParsed);
  const normalizedEstimate = Number.isNaN(estSnapped) || estSnapped <= 0 ? null : estSnapped;

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
      estimatedHours: normalizedEstimate,
      priority,
      workCategoryId,
      checklist,
    };

    dispatch({
      type: 'SAVE_TASK',
      payload: {
        taskId: existing ? existing.id : null,
        draft,
        assigneeIds,
        allocations: cells,
        newUnassigned: pendingUnassigned.filter((u) => u.hours > 0),
      },
    });
    // Rebase the snapshot so the close path fires no confirm, and show the
    // save feedback before the modal dismisses.
    snapshotRef.current = currentSerialized;
    onDirtyChange(false);
    markSaved();
    onSaved();
  };

  const plannedTotalAll = Object.values(allocations).reduce(
    (s, h) => s + (h > 0 ? h : 0),
    0,
  );

  // Existing bin blocks of this task belonging to still-assigned people.
  const existingBin = useMemo(
    () =>
      existing
        ? binEntriesForTask(state, existing.id).filter((w) =>
            assigneeIds.includes(w.personId),
          )
        : [],
    [state, existing, assigneeIds],
  );
  const existingBinTotal = existingBin.reduce((s, w) => s + w.plannedHours, 0);
  const pendingBinTotal = pendingUnassigned
    .filter((u) => assigneeIds.includes(u.personId))
    .reduce((s, u) => s + (u.hours > 0 ? u.hours : 0), 0);
  const binTotal = existingBinTotal + pendingBinTotal;

  // Draft total = post-save task total (grid cells + bin). When the estimate
  // parses to a number and the draft exceeds it, show a live, non-blocking
  // over-budget banner — TaskModal is the deliberate re-planning surface.
  const draftTotal = plannedTotalAll + binTotal;
  const overBudget = normalizedEstimate != null && draftTotal > normalizedEstimate + 1e-9;

  // Existing bin blocks grouped per still-assigned person (read-only chips).
  const existingBinByPerson = useMemo(() => {
    const groups: Array<{ person: (typeof state.people)[number]; hours: number[] }> = [];
    for (const p of assignedPeople) {
      const hours = existingBin
        .filter((w) => w.personId === p.id)
        .map((w) => w.plannedHours);
      if (hours.length > 0) groups.push({ person: p, hours });
    }
    return groups;
  }, [assignedPeople, existingBin, state.people]);

  const addBinHours = () => {
    const personId = binPersonId || assignedPeople[0]?.id || '';
    const hours = Number(binHoursRaw);
    if (personId === '' || Number.isNaN(hours) || hours <= 0) return;
    setPendingUnassigned((prev) => [...prev, { personId, hours: Math.min(24, hours) }]);
  };

  // ---- Checklist (draft-only; persisted wholesale by SAVE_TASK) ----
  const addChecklistItem = () => {
    const text = checklistInput.trim();
    if (!text) return;
    setChecklist((prev) => [...prev, { id: crypto.randomUUID(), text, done: false }]);
    setChecklistInput('');
  };
  const toggleChecklistItem = (id: string) => {
    setChecklist((prev) => prev.map((c) => (c.id === id ? { ...c, done: !c.done } : c)));
  };
  const removeChecklistItem = (id: string) => {
    setChecklist((prev) => prev.filter((c) => c.id !== id));
  };
  const checklistDone = checklist.filter((c) => c.done).length;

  return (
    <div className="editor task-editor">
      {/* a) Details */}
      <div className="editor-section">
        <h2>Szczegóły</h2>
        <div className="field">
          <label htmlFor="t-title">Tytuł *</label>
          <input
            id="t-title"
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => setTitleTouched(true)}
            className={titleTouched && titleError ? 'invalid' : undefined}
            placeholder="Co trzeba zrobić?"
            disabled={readOnly}
            title={roTitle}
          />
          {titleTouched && titleError && <p className="field-error">Tytuł jest wymagany</p>}
        </div>
        <div className="field">
          <label htmlFor="t-desc">Opis</label>
          <textarea
            id="t-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Opcjonalne szczegóły"
            disabled={readOnly}
            title={roTitle}
          />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="t-project">Projekt *</label>
            {state.projects.length === 0 ? (
              <p className="field-hint">
                Nie ma jeszcze projektów — najpierw <Link to="/projects">utwórz projekt</Link>.
                Każde zadanie musi należeć do projektu.
              </p>
            ) : (
              <select
                id="t-project"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                disabled={readOnly}
                title={roTitle}
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
              disabled={readOnly}
              title={roTitle}
            >
              {pickableStatuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.archived ? ' (zarchiwizowany)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="t-est">Szacowane godziny</label>
            <input
              id="t-est"
              type="number"
              min={0}
              step={0.25}
              value={estimatedRaw}
              onChange={(e) => setEstimatedRaw(e.target.value)}
              placeholder="Opcjonalnie"
              disabled={readOnly}
              title={roTitle}
            />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="t-priority">Priorytet</label>
            <select
              id="t-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
              disabled={readOnly}
              title={roTitle}
            >
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="t-category">Kategoria</label>
            <select
              id="t-category"
              value={workCategoryId}
              onChange={(e) => setWorkCategoryId(e.target.value)}
              disabled={readOnly}
              title={roTitle}
            >
              <option value="">Brak kategorii</option>
              {state.workCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="estimate-compare">
          <span>
            zaplanowano{' '}
            <strong className={overBudget ? 'over-budget' : undefined}>
              {formatDuration(plannedTotalAll)}
            </strong>
            {binTotal > 0 && (
              <span className="muted"> (+ {formatDuration(binTotal)} w zasobniku)</span>
            )}
          </span>
          <span className="muted">vs</span>
          <span>
            {normalizedEstimate != null ? (
              <>
                szacunek <strong>{formatDuration(normalizedEstimate)}</strong>
              </>
            ) : (
              <span className="muted">brak szacunku</span>
            )}
          </span>
          <PlanningBadge
            status={planningStatusForTotals(normalizedEstimate, plannedTotalAll, binTotal)}
          />
        </div>
        {overBudget && (
          <p className="estimate-over">
            ⚠ Przekroczono szacunek o {formatDuration(draftTotal - (normalizedEstimate ?? 0))}. Zwiększ
            szacunek lub ogranicz godziny.
          </p>
        )}
      </div>

      {/* a2) Checklist */}
      <div className="editor-section">
        <h2>Checklista</h2>
        {checklist.length > 0 && (
          <p className="checklist-count">
            ukończono {checklistDone}/{checklist.length}
          </p>
        )}
        {checklist.length > 0 && (
          <ul className="checklist-list">
            {checklist.map((item) => (
              <li key={item.id} className={item.done ? 'checklist-row done' : 'checklist-row'}>
                <input
                  type="checkbox"
                  checked={item.done}
                  onChange={() => toggleChecklistItem(item.id)}
                  disabled={readOnly}
                  title={roTitle}
                  aria-label={`Oznacz „${item.text}” jako ukończone`}
                />
                <span className="checklist-text">{item.text}</span>
                {!readOnly && (
                  <button
                    type="button"
                    className="btn danger-ghost"
                    onClick={() => removeChecklistItem(item.id)}
                    aria-label={`Usuń „${item.text}”`}
                  >
                    Usuń
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {!readOnly && (
          <div className="checklist-add-row">
            <input
              type="text"
              value={checklistInput}
              onChange={(e) => setChecklistInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addChecklistItem();
                }
              }}
              placeholder="Nowy element checklisty"
              aria-label="Nowy element checklisty"
            />
            <button
              type="button"
              className="btn ghost"
              onClick={addChecklistItem}
              disabled={checklistInput.trim() === ''}
            >
              Dodaj
            </button>
          </div>
        )}
        {readOnly && checklist.length === 0 && <p className="field-hint">Brak elementów.</p>}
      </div>

      {/* b) Period */}
      <div className="editor-section">
        <h2>Okres</h2>
        <div className="field-row">
          <div className="field">
            <label htmlFor="t-start">Data startu</label>
            <input
              id="t-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              disabled={readOnly}
              title={roTitle}
            />
          </div>
          <div className="field">
            <label htmlFor="t-end">Data końca</label>
            <input
              id="t-end"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              disabled={readOnly}
              title={roTitle}
            />
          </div>
        </div>
        {perErr && <p className="field-error">{PERIOD_ERROR_LABELS[perErr]}</p>}
        {periodValid && (
          <p className="field-hint">
            Liczba dni w okresie: {periodDays}.
          </p>
        )}
      </div>

      {/* c) Assignees */}
      <div className="editor-section">
        <h2>Przypisane osoby</h2>
        {state.people.length === 0 ? (
          <p className="field-hint">
            Nie ma jeszcze osób. <Link to="/people">Dodaj osoby</Link>, aby przypisać pracę.
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
                    disabled={readOnly}
                    title={roTitle}
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

      {/* c2) Bin (zasobnik) — dateless hours */}
      <div className="editor-section">
        <h2>Zasobnik (bez terminu)</h2>
        {existingBinByPerson.length > 0 && (
          <div className="bin-existing">
            {existingBinByPerson.map(({ person, hours }) => (
              <div key={person.id} className="bin-existing-row">
                <span
                  className="person-dot"
                  style={{ background: personColor(person.id) }}
                  aria-hidden
                />
                <span className="bin-existing-name">{person.name}</span>
                <span className="bin-chips">
                  {hours.map((h, i) => (
                    <span key={i} className="bin-chip readonly">
                      {formatDuration(h)}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        )}
        <p className="field-hint">
          Bloki bez terminu przeciągniesz na siatkę w widoku tygodnia kalendarza.
        </p>
        {readOnly ? null : assignedPeople.length === 0 ? (
          <p className="field-hint">
            Przypisz co najmniej jedną osobę, aby dodać godziny do zasobnika.
          </p>
        ) : (
          <>
            <div className="bin-add-row">
              <select
                aria-label="Osoba"
                value={binPersonId || assignedPeople[0]?.id || ''}
                onChange={(e) => setBinPersonId(e.target.value)}
              >
                {assignedPeople.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <input
                type="number"
                aria-label="Godziny"
                min={0.25}
                step={0.25}
                max={24}
                value={binHoursRaw}
                onChange={(e) => setBinHoursRaw(e.target.value)}
              />
              <button type="button" className="btn ghost" onClick={addBinHours}>
                Dodaj do zasobnika
              </button>
            </div>
            {pendingUnassigned.length > 0 && (
              <div className="bin-pending">
                {pendingUnassigned.map((u, i) => {
                  const person = state.people.find((p) => p.id === u.personId);
                  return (
                    <span key={i} className="bin-chip">
                      <span
                        className="person-dot"
                        style={{ background: personColor(u.personId) }}
                        aria-hidden
                      />
                      {person?.name ?? 'Osoba'}: {formatDuration(u.hours)}
                      <button
                        type="button"
                        className="bin-chip-remove"
                        aria-label="Usuń"
                        onClick={() =>
                          setPendingUnassigned((prev) => prev.filter((_, j) => j !== i))
                        }
                      >
                        ×
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* d) Daily allocation grid */}
      <div className="editor-section">
        <h2>Dzienny przydział godzin</h2>
        {!periodValid ? (
          <p className="field-hint">Ustaw prawidłowy okres, aby planować godziny.</p>
        ) : assignedPeople.length === 0 ? (
          <p className="field-hint">Przypisz co najmniej jedną osobę, aby planować godziny.</p>
        ) : (
          <>
            {outOfRangeCount > 0 && (
              <p className="field-notice">
                Przy zapisie zostanie usunięta liczba wpisów poza nowym okresem: {outOfRangeCount}.
              </p>
            )}
            <AllocationGrid
              state={state}
              currentTaskId={existing ? existing.id : null}
              startDate={startDate}
              endDate={endDate}
              people={assignedPeople}
              allocations={allocations}
              blockCounts={multiBlockCounts}
              onChange={setCell}
              onFillWeekdays={fillWeekdays}
              onClearPerson={clearPerson}
              readOnly={readOnly}
            />
          </>
        )}
      </div>

      {/* e) Discussion (existing tasks only) */}
      {existing && (
        <div className="editor-section">
          <h2>Dyskusja</h2>
          <CommentsPanel entityType="task" entityId={existing.id} />
        </div>
      )}

      {/* f) Save / Cancel */}
      {projectError && state.projects.length > 0 && (
        <p className="field-error">Wybierz projekt dla tego zadania.</p>
      )}
      <div className="editor-actions">
        {!readOnly && (
          <button
            type="button"
            className="btn primary"
            onClick={handleSave}
            disabled={state.projects.length === 0}
            title={state.projects.length === 0 ? 'Najpierw utwórz projekt' : undefined}
          >
            {isEdit ? 'Zapisz zmiany' : 'Utwórz zadanie'}
          </button>
        )}
        <button type="button" className="btn ghost" onClick={onCancel}>
          {readOnly ? 'Zamknij' : 'Anuluj'}
        </button>
      </div>
    </div>
  );
}
