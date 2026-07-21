// Task popout modal. Opening a task never leaves the current page — it renders
// as an overlay driven by the `?task=<id>` (or `?task=new[&project=<id>]`)
// search params. Rendered ONCE at App level. Closing removes the task/project
// params while keeping the rest of the URL (and the page's scroll) intact.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { useStore, usePersistence } from '../store/AppStore';
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
  isValidDateStr,
  formatShortWithWeekday,
} from '../utils/dates';
import { useSaveStatus } from '../utils/useSaveStatus';
import { useAutoSave } from '../utils/useAutoSave';
import { hasEntity, isValidTaskDraft } from '../store/commandValidation';
import {
  bypassNavGuardOnce,
  clearNavGuard,
  setNavGuard,
} from '../utils/dirtyRegistry';

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
  // Router navigation-guard registration is SYNCHRONOUS (not an effect):
  // the save path clears dirty and closes in one handler, and the guard reads
  // the registry during that very navigation.
  const navGuardKey = useRef<object>({});
  const handleDirtyChange = useCallback((d: boolean) => {
    dirtyRef.current = d;
    setDirty(d);
    setNavGuard(navGuardKey.current, 'task-modal', d);
  }, []);
  useEffect(() => {
    const key = navGuardKey.current;
    return () => clearNavGuard(key);
  }, []);
  const { saveError } = usePersistence();
  const { status, markSaved } = useSaveStatus(dirty, saveError !== null);

  // Deliberate close: the user already confirmed (or nothing needs asking), so
  // the closing navigation must not raise the router guard a second time.
  const closeDeliberately = useCallback(() => {
    bypassNavGuardOnce();
    onClose();
  }, [onClose]);

  // Any close path prompts when there are unsaved changes.
  const requestClose = useCallback(() => {
    if (
      dirtyRef.current &&
      !window.confirm('Masz niezapisane zmiany. Zamknąć bez zapisywania?')
    ) {
      return;
    }
    closeDeliberately();
  }, [closeDeliberately]);

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
      closeDeliberately();
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
  priority: TaskPriority;
  workCategoryId: string;
  departmentId: string;
  checklist: ChecklistItem[];
  startDate: string;
  endDate: string;
  assigneeIds: string[];
  allocations: AllocMap;
  soldRawByPerson: Record<string, string>;
}): string {
  return JSON.stringify({
    title: v.title,
    description: v.description,
    projectId: v.projectId,
    statusId: v.statusId,
    priority: v.priority,
    workCategoryId: v.workCategoryId,
    departmentId: v.departmentId,
    // Order-sensitive: item identity + text + done state all participate in dirty.
    checklist: v.checklist.map((c) => [c.id, c.text, c.done]),
    startDate: v.startDate,
    endDate: v.endDate,
    assigneeIds: [...v.assigneeIds].sort(),
    allocations: Object.entries(v.allocations)
      .filter(([, h]) => h > 0)
      .sort(([a], [b]) => a.localeCompare(b)),
    // Godziny sprzedane per osoba — tylko aktualnie przypisani (odpięcie osoby
    // nie zostawia widma w dirty-detekcji).
    sold: v.assigneeIds
      .map((pid) => [pid, (v.soldRawByPerson[pid] ?? '').trim()] as const)
      .sort(([a], [b]) => a.localeCompare(b)),
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
  const { external } = usePersistence();
  const canManage = useCan()('tasks.manage');
  const readOnly = !canManage;
  const roTitle = readOnly ? NO_PERM_TITLE : undefined;
  const existing = taskId ? state.tasks.find((t) => t.id === taskId) : undefined;
  const isEdit = Boolean(existing);
  // Szkic: NOWE zadanie otwarte Z WIDOKU PROJEKTU (initialProjectId ustawione)
  // startuje jako szkic; edycja zachowuje stan zadania. Bezpośrednie tworzenie
  // gdzie indziej (Zadania, kalendarz, kanban — bez projektu) pozostaje
  // publikacją natychmiastową. Szkic nie planuje godzin, więc chowamy sekcje
  // planowania (godziny osób, zasobnik, siatka) do czasu publikacji.
  const isDraft = existing ? existing.isDraft === true : Boolean(initialProjectId);

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
  const [priority, setPriority] = useState<TaskPriority>(existing?.priority ?? 'normal');
  const [workCategoryId, setWorkCategoryId] = useState<string>(existing?.workCategoryId ?? '');
  const [departmentId, setDepartmentId] = useState<string>(existing?.departmentId ?? '');
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

  // ---- Godziny sprzedane per osoba (personId -> surowy tekst pola) ----
  // Suma tych godzin JEST szacunkiem zadania; różnica ponad zaplanowane w
  // kalendarzu ląduje automatycznie w zasobniku osoby (binTotals w SAVE_TASK).
  // Seed: łączne godziny osoby na zadaniu (kalendarz + zasobnik).
  const [soldRawByPerson, setSoldRawByPerson] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    if (existing) {
      const totals = new Map<string, number>();
      for (const w of state.workload) {
        if (w.taskId !== existing.id) continue;
        totals.set(w.personId, (totals.get(w.personId) ?? 0) + w.plannedHours);
      }
      for (const pid of assigneeIdsOfTask(state, existing.id)) {
        const t = totals.get(pid) ?? 0;
        map[pid] = t > 0 ? String(t) : '';
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
    priority,
    workCategoryId,
    departmentId,
    checklist,
    startDate,
    endDate,
    assigneeIds,
    allocations,
    soldRawByPerson,
  });
  const snapshotRef = useRef<string | null>(null);
  if (snapshotRef.current === null) snapshotRef.current = currentSerialized;
  const dirty = snapshotRef.current !== currentSerialized;

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  // ---- Handlers ----

  const setCell = (personId: string, date: string, hours: number) => {
    // Snap to the 0.25 grid the store persists on. The grid cell input is
    // controlled directly by this numeric map (no separate raw-string field to
    // hold in-flight keystrokes), so snapping here — the setter that writes the
    // value the grid footer, header total AND SAVE_TASK all read — is the only
    // point that keeps every total on-grid. Off-grid entries like 0.1 (rendered
    // "6m") can no longer be counted and then silently change on save.
    const snapped = snapHours(hours);
    setAllocations((prev) => {
      const next = { ...prev };
      const key = allocKey(personId, date);
      if (snapped > 0) next[key] = snapped;
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
      // Bin hours saveTask drops when the person is unassigned.
      const existingBinForPerson = existing
        ? binEntriesForTask(state, existing.id)
            .filter((w) => w.personId === personId)
            .reduce((s, w) => s + w.plannedHours, 0)
        : 0;
      const droppedTotal = datedOnThisTask + existingBinForPerson;
      if (droppedTotal > 0) {
        const binSuffix =
          existingBinForPerson > 0
            ? ` (w tym ${formatDuration(existingBinForPerson)} w zasobniku)`
            : '';
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
      setSoldRawByPerson((prev) => {
        const next = { ...prev };
        delete next[personId];
        return next;
      });
    } else {
      setAssigneeIds((prev) => [...prev, personId]);
    }
  };

  const projectError = projectId === '' || !state.projects.some((p) => p.id === projectId);

  // Grid cells SAVE_TASK will actually persist: in-period days for currently
  // assigned people only. The header total, over-budget banner and planning
  // badge all read from THIS single source (not the raw allocations map) so the
  // displayed numbers can never diverge from what save writes — e.g. after
  // shrinking the period, out-of-range cells stop counting immediately instead
  // of only at save (previously header 10h vs grid 4h until save).
  const plannedCells = useMemo<AllocationCell[]>(() => {
    const cells: AllocationCell[] = [];
    for (const [key, hours] of Object.entries(allocations)) {
      if (hours <= 0) continue;
      const [personId, date] = key.split('|');
      if (!periodDaysSet.has(date)) continue;
      if (!assigneeIds.includes(personId)) continue;
      cells.push({ personId, date, plannedHours: hours });
    }
    return cells;
  }, [allocations, periodDaysSet, assigneeIds]);

  const plannedTotalAll = plannedCells.reduce((s, c) => s + c.plannedHours, 0);

  // ---- Godziny sprzedane => szacunek + cele zasobnika --------------------
  // Wartość pola osoby (snap 0,25h; puste/niepoprawne => 0). SUMA tych godzin
  // jest szacunkiem zadania (null przy 0 — brak szacunku). Cel zasobnika osoby
  // = sprzedane − zaplanowane w kalendarzu (nigdy poniżej zera): planowanie w
  // kalendarzu automatycznie "zjada" zasobnik, suma osoby zostaje stała.
  const soldByPerson = useMemo(() => {
    const map = new Map<string, number>();
    for (const pid of assigneeIds) {
      const raw = (soldRawByPerson[pid] ?? '').trim();
      const parsed = raw === '' ? 0 : Number(raw);
      map.set(pid, Number.isFinite(parsed) && parsed > 0 ? snapHours(parsed) : 0);
    }
    return map;
  }, [assigneeIds, soldRawByPerson]);
  const soldTotal = [...soldByPerson.values()].reduce((s, h) => s + h, 0);
  const normalizedEstimate = soldTotal > 0 ? soldTotal : null;

  const datedByPerson = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of plannedCells) {
      map.set(c.personId, (map.get(c.personId) ?? 0) + c.plannedHours);
    }
    return map;
  }, [plannedCells]);

  const binTargets = useMemo(
    () =>
      assigneeIds.map((personId) => ({
        personId,
        hours: Math.max(
          0,
          snapHours((soldByPerson.get(personId) ?? 0) - (datedByPerson.get(personId) ?? 0)),
        ),
      })),
    [assigneeIds, soldByPerson, datedByPerson],
  );
  const binTotal = binTargets.reduce((s, b) => s + b.hours, 0);

  // Kalendarz ponad sprzedane: zasobnik jest już pusty, a suma osoby rośnie
  // ponad wpisaną — ostrzeżenie zamiast dawnego "przekroczono szacunek".
  const overBudget = soldTotal > 0 && plannedTotalAll > soldTotal + 1e-9;

  // Poprzedni ręczny szacunek (sprzed przejścia na sumę godzin osób) — pokazany
  // raz jako kontekst, gdy różni się od wyliczonej sumy przy otwarciu.
  const legacyEstimateRef = useRef<number | null>(existing?.estimatedHours ?? null);
  const legacyEstimate = legacyEstimateRef.current;

  // ---- Ważność draftu (te same bramki co reduktor — fałszywe „Zapisano” jest
  // niemożliwe: zapis pada tylko, gdy SAVE_TASK go przyjmie) ----
  const draftForSave: TaskDraft = {
    projectId,
    statusId,
    title: title.trim(),
    description: description.trim(),
    startDate,
    endDate,
    estimatedHours: normalizedEstimate,
    priority,
    workCategoryId,
    departmentId,
    checklist,
    // Sygnał tworzenia szkicu (reduktor używa go tylko przy tworzeniu; przy
    // edycji zachowuje stan zadania). Brak wpływu na walidację draftu.
    isDraft,
  };
  const assigneesValid = assigneeIds.every((id) => hasEntity(state, 'person', id));
  const formValid =
    !titleError &&
    periodValid &&
    !projectError &&
    assigneesValid &&
    isValidTaskDraft(state, draftForSave);

  const doSave = (): boolean => {
    setTitleTouched(true);
    if (!formValid) return false;

    dispatch({
      type: 'SAVE_TASK',
      payload: {
        taskId: existing ? existing.id : null,
        draft: draftForSave,
        assigneeIds,
        allocations: plannedCells,
        binTotals: binTargets,
      },
    });
    // Rebase the snapshot so the close path fires no confirm, and show the
    // save feedback.
    snapshotRef.current = currentSerialized;
    onDirtyChange(false);
    markSaved();
    return true;
  };

  const handleSave = () => {
    if (doSave()) onSaved();
  };

  // Auto-zapis (tylko edycja istniejącego zadania — tworzenie zostaje jawne,
  // żeby pół-tytułu nie stawało się zadaniem). Ważny draft po 900 ms ciszy
  // zapisuje się w tle; modal zostaje otwarty, status w nagłówku pokazuje
  // „Zapisano”.
  useAutoSave({
    // Jawny konflikt kart wstrzymuje auto-zapis (decyzja należy do banera).
    enabled: isEdit && !readOnly && external !== 'conflict',
    dirty,
    valid: formValid,
    signature: currentSerialized,
    save: doSave,
  });

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
            <label htmlFor="t-status">Status *</label>
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
          <div className="field">
            <label htmlFor="t-department">Dział</label>
            <select
              id="t-department"
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              disabled={readOnly}
              title={roTitle}
            >
              <option value="">Bez działu</option>
              {state.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        </div>
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
            {isValidDateStr(startDate) && (
              <p className="field-hint">{formatShortWithWeekday(startDate)}</p>
            )}
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
            {isValidDateStr(endDate) && (
              <p className="field-hint">{formatShortWithWeekday(endDate)}</p>
            )}
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
        {!isDraft && assignedPeople.length > 0 && (
          <div className="sold-hours">
            <p className="field-hint">
              Edytujesz godziny każdej osoby na tym zadaniu (sprzedane). Szacunek
              zadania to ich suma — wylicza się sam, nie ma osobnego pola. Część
              niezaplanowana w kalendarzu trafia automatycznie do zasobnika osoby.
            </p>
            {assignedPeople.map((p) => {
              const sold = soldByPerson.get(p.id) ?? 0;
              const dated = datedByPerson.get(p.id) ?? 0;
              const bin = Math.max(0, snapHours(sold - dated));
              const clamped = dated > sold + 1e-9;
              return (
                <div key={p.id} className="sold-hours-row">
                  <span
                    className="person-dot"
                    style={{ background: personColor(p.id) }}
                    aria-hidden
                  />
                  <span className="sold-hours-name">{p.name}</span>
                  <input
                    type="number"
                    className="sold-hours-input"
                    min={0}
                    step={0.25}
                    value={soldRawByPerson[p.id] ?? ''}
                    onChange={(e) =>
                      setSoldRawByPerson((prev) => ({ ...prev, [p.id]: e.target.value }))
                    }
                    placeholder="0"
                    aria-label={`Godziny dla ${p.name}`}
                    disabled={readOnly}
                    title={roTitle}
                  />
                  <span className="sold-hours-meta muted">
                    w kalendarzu {formatDuration(dated)} • zasobnik {formatDuration(bin)}
                  </span>
                  {clamped && (
                    <span className="field-error sold-hours-warn">
                      w kalendarzu więcej niż godziny osoby
                    </span>
                  )}
                </div>
              );
            })}
            <div className="sold-hours-total">
              Szacunek zadania (suma godzin osób):{' '}
              <strong>{formatDuration(soldTotal)}</strong>{' '}
              <span className="muted">— wyliczany</span>
            </div>
          </div>
        )}
        {isDraft ? (
          <p className="field-hint task-draft-hint">
            <strong>Szkic.</strong> Po zapisaniu zadanie pozostaje szkicem, dopóki
            nie klikniesz „Zapisz i opublikuj” w projekcie. Osoby możesz przypisać
            już teraz; godziny (kalendarz i zasobnik) zaplanujesz po opublikowaniu.
          </p>
        ) : (
          <>
            {/* Podsumowanie planowania stoi tuż pod godzinami osób, bo porównuje
                dokładnie te liczby: co jest sprzedane vs co leży w kalendarzu. */}
            <div className="estimate-compare">
              <span>
                w kalendarzu{' '}
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
            {legacyEstimate != null && Math.abs(legacyEstimate - soldTotal) > 1e-9 && (
              <p className="field-hint">
                Poprzedni ręczny szacunek: {formatDuration(legacyEstimate)} — po zapisie
                szacunkiem stanie się suma godzin osób.
              </p>
            )}
            {overBudget && (
              <p className="estimate-over">
                ⚠ W kalendarzu zaplanowano {formatDuration(plannedTotalAll - soldTotal)} ponad godziny
                przypisane osobom. Zwiększ godziny osób lub ogranicz siatkę.
              </p>
            )}
          </>
        )}
      </div>

      {/* c2) Bin (zasobnik) — wyliczany z godzin osób, nie edytowany osobno.
          Szkic nie planuje godzin, więc sekcja pojawia się dopiero po publikacji. */}
      {!isDraft && (
      <div className="editor-section">
        <h2>Zasobnik (bez terminu)</h2>
        {assignedPeople.length === 0 ? (
          <p className="field-hint">
            Przypisz osoby i nadaj im godziny — niezaplanowana część trafi tu
            automatycznie.
          </p>
        ) : (
          <>
            {binTotal > 0 ? (
              <div className="bin-existing">
                {binTargets
                  .filter((b) => b.hours > 0)
                  .map((b) => {
                    const person = state.people.find((p) => p.id === b.personId);
                    return (
                      <div key={b.personId} className="bin-existing-row">
                        <span
                          className="person-dot"
                          style={{ background: personColor(b.personId) }}
                          aria-hidden
                        />
                        <span className="bin-existing-name">{person?.name ?? 'Osoba'}</span>
                        <span className="bin-chips">
                          <span className="bin-chip readonly">{formatDuration(b.hours)}</span>
                        </span>
                      </div>
                    );
                  })}
              </div>
            ) : (
              <p className="field-hint">
                Wszystkie godziny osób są rozplanowane w kalendarzu — zasobnik jest
                pusty.
              </p>
            )}
            <p className="field-hint">
              Zasobnik = godziny osoby minus godziny w kalendarzu. Bloki bez
              terminu przeciągniesz na siatkę w widoku tygodnia kalendarza.
            </p>
          </>
        )}
      </div>
      )}

      {/* d) Daily allocation grid. Szkic nie planuje godzin — siatka pojawia się
          dopiero po publikacji zadania w projekcie. */}
      {!isDraft && (
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
      )}

      {/* e) Discussion (existing tasks only) */}
      {existing && (
        <div className="editor-section">
          <h2>Dyskusja</h2>
          <CommentsPanel entityType="task" entityId={existing.id} />
        </div>
      )}

      {/* f) Save / Cancel — sticky: zawsze widoczne bez przewijania */}
      {projectError && state.projects.length > 0 && (
        <p className="field-error">Wybierz projekt dla tego zadania.</p>
      )}
      <div className="editor-actions editor-actions-sticky">
        {!readOnly && isEdit && (
          <span className="field-hint autosave-hint" role="status">
            Zmiany zapisują się automatycznie.
          </span>
        )}
        {!readOnly && (
          <button
            type="button"
            className="btn primary"
            onClick={handleSave}
            disabled={state.projects.length === 0}
            title={state.projects.length === 0 ? 'Najpierw utwórz projekt' : undefined}
          >
            {isEdit ? 'Zapisz i zamknij' : isDraft ? 'Utwórz szkic' : 'Utwórz zadanie'}
          </button>
        )}
        <button type="button" className="btn ghost" onClick={onCancel}>
          {readOnly || !dirty ? 'Zamknij' : 'Anuluj'}
        </button>
      </div>
    </div>
  );
}
