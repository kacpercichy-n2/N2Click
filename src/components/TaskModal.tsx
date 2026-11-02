// Task popout modal. Opening a task never leaves the current page — it renders
// as an overlay driven by the `?task=<id>` (or `?task=new[&project=<id>]`)
// search params. Rendered ONCE at App level. Closing removes the task/project
// params while keeping the rest of the URL (and the page's scroll) intact.
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, m } from 'motion/react';
import { useStore, usePersistence } from '../store/AppStore';
import { useCan } from '../store/useCan';
import { NO_PERM_TITLE } from '../store/permissions';
import { isBoardMember, isTaskContentMasked, maskedTaskLabel } from '../store/confidentiality';
import type { AllocationCell, TaskDraft } from '../store/AppStore';
import type { ChecklistItem, TaskPriority } from '../types';
import { PRIORITY_LABELS, TASK_PRIORITIES } from '../utils/priority';
import { archivedSuffix } from '../utils/archivedLabel';
import {
  activeStatuses,
  assigneeIdsOfTask,
  availableHoursOnDate,
  binEntriesForTask,
  commentsFor,
  getPerson,
  getStatus,
  planningStatusForTotals,
  rangeAvailabilityForPerson,
  taskPlannedTotal,
} from '../store/selectors';
import { PlanningBadge } from './PlanningBadge';
import { useModalShell } from './useModalShell';
import { useConfirm } from './ConfirmProvider';
import { buildDeleteConsequence } from './confirmDialog';
import { IconButton } from './IconButton';
import { OverflowMenu } from './OverflowMenu';
import { AlertTriangle, X } from './icons';
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  CalendarRange,
  ChevronRight,
  CircleDot,
  Clock,
  Flag,
  Folder,
  Maximize2,
  Tag,
  Users,
} from 'lucide-react';
import { TaskConversationPane } from '../chat/ui/TaskConversationPane';
import {
  CopyTaskLinkButton,
  HelpTip,
  HoursBar,
  TaskConversationEmpty,
  TaskTile,
} from './taskCard/TaskCardParts';
import {
  blockerTarget,
  compactHours,
  hoursTileSummary,
  peopleTileLabel,
  periodTileLabel,
  taskHoursRows,
  type TaskTileId,
} from './taskCard/taskCardModel';
import { StatusBadge } from './StatusBadge';
import { Avatar } from './Avatar';
import {
  AllocationGrid,
  allocKey,
  type AllocMap,
  type AllocStartMap,
} from './AllocationGrid';
import { AllocationDayList } from './AllocationDayList';
import {
  restorePersonColumn,
  snapshotPersonColumn,
  type PersonColumnSnapshot,
} from './allocationGridView';
import {
  assigneeHasNoHours,
  withAssigneeHoursDefault,
  withAssigneeHoursDefaults,
} from './assigneeHours';
import { MOBILE_NAV_QUERY, useMediaQuery } from '../utils/useMediaQuery';
import {
  clientPickerOptions,
  effectiveProjectClientId,
  projectsForClient,
} from './taskClientPicker';
import { sortByNamePl } from '../utils/collation';
import { SaveStatus } from './SaveStatus';
import { personColor } from '../utils/colors';
import {
  DAY_MINUTES,
  MINUTE_STEP,
  formatDuration,
  formatMinutes,
  isBinEntry,
  snapHours,
  snapToStep,
} from '../utils/time';
import { blockLabel } from '../utils/blockLabel';
import { blocksProgressLabel, itemsProgressLabel } from '../utils/progressLabel';
import {
  eachDayInclusive,
  inclusiveDayCount,
  todayStr,
  periodError,
  PERIOD_ERROR_LABELS,
  MAX_TASK_PERIOD_DAYS,
  isValidDateStr,
  formatShortWithWeekday,
  WEEKDAY_LABELS,
} from '../utils/dates';
import { INTERVAL_WEEKS_OPTIONS, intervalWeeksLabel } from '../utils/recurrence';
import { useSaveStatus } from '../utils/useSaveStatus';
import { useAutoSave } from '../utils/useAutoSave';
import { hasEntity, isValidTaskDraft } from '../store/commandValidation';
import {
  collectTaskSaveBlockers,
  periodInvalidTargets,
  type SaveBlocker,
  type SaveBlockerId,
} from './taskSaveBlockers';
import {
  opensAtTop,
  resolveTabNavKey,
  visibleSections,
  type SectionFlags,
  type TaskModalSectionId,
} from './taskModalSections';
import { Field, focusFieldById } from './Field';
import type { FieldControlProps } from './Field';
import { mergeDescribedBy } from './tooltipShell';
import { DisabledHint, Tooltip } from './Tooltip';
import { fieldAria, saveErrorSummary } from './fieldContract';
import {
  bypassNavGuardOnce,
  clearNavGuard,
  setNavGuard,
} from '../utils/dirtyRegistry';
import { taskFullViewPath } from '../pages/taskPageRoute';

// ---- Recurrence („Cykliczność") local helpers ----
// Duration choices for a recurrence rule: 0:15…8:00 on the 15-minute grid.
const RECUR_DURATION_OPTIONS = Array.from({ length: 32 }, (_, i) => (i + 1) * MINUTE_STEP);

// "HH:MM" ↔ minutes-from-midnight (same pattern as WeekView), for the native
// <input type="time" step={900}> used by the recurrence rule editor.
function recurTimeToMinutes(value: string): number {
  const [h, m] = value.split(':');
  return Number(h) * 60 + Number(m);
}
function recurMinutesToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
// Jedyna normalizacja przypiętej godziny startu: snap do siatki 15 min i clamp
// do doby. Używają jej ZARÓWNO seed z zapisanego stanu, JAK I edycja pola, żeby
// obie ścieżki nie mogły się rozjechać.
function normalizeStartMinutes(minutes: number): number {
  return Math.max(0, Math.min(snapToStep(minutes), DAY_MINUTES - MINUTE_STEP));
}

// 'yyyy-MM-dd' → 'dd.MM.yyyy' for the read-only override list.
function recurDateLabel(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}.${m}.${y}`;
}

// IA-12 — nieudany zapis musi mieć widoczny skutek. Skacze do pola, które
// blokuje zapis (i ustawia na nim fokus), zamiast po cichu nic nie robić.
// Modal jest jednym DOM-em, więc korzysta z tego zarówno stopka edytora, jak i
// klikalna odznaka zapisu w nagłówku.
function focusSaveBlocker(blocker: SaveBlocker): void {
  if (blocker.focusId === null) return;
  // Sam skok (fokus + JEDNO przewinięcie na środek) jest wspólny dla trzech
  // modali i mieszka w `Field.tsx` jako `focusFieldById`.
  focusFieldById(blocker.focusId);
}

/**
 * Shared opener hook. Merges the task/project search params onto the CURRENT
 * location so the page underneath never changes.
 */
export function useOpenTask() {
  const navigate = useNavigate();
  const location = useLocation();

  const openTask = useCallback(
    (id: string, blockId?: string) => {
      const params = new URLSearchParams(location.search);
      params.set('task', id);
      params.delete('project');
      // Prefill hints only apply to new-task creation — never leak onto an
      // existing task opened afterwards.
      params.delete('date');
      params.delete('assignee');
      // Opening FROM a specific calendar/bin block highlights + scrolls to that
      // block's row in the per-block „Wykonane bloki” list (PKG-per-block-done).
      if (blockId) params.set('block', blockId);
      else params.delete('block');
      navigate({ pathname: location.pathname, search: params.toString() });
    },
    [navigate, location.pathname, location.search],
  );

  const openNewTask = useCallback(
    (projectId?: string, prefill?: { date?: string; personId?: string }) => {
      const params = new URLSearchParams(location.search);
      params.set('task', 'new');
      if (projectId) params.set('project', projectId);
      else params.delete('project');
      // Optional creation prefill (e.g. right-clicking an empty calendar slot):
      // a start date and/or a person to preselect as the sole assignee.
      if (prefill?.date) params.set('date', prefill.date);
      else params.delete('date');
      if (prefill?.personId) params.set('assignee', prefill.personId);
      else params.delete('assignee');
      params.delete('block');
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
  const dateParam = searchParams.get('date');
  const assigneeParam = searchParams.get('assignee');
  const blockParam = searchParams.get('block');

  const close = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('task');
        next.delete('project');
        next.delete('date');
        next.delete('assignee');
        next.delete('block');
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
          dateParam={dateParam}
          assigneeParam={assigneeParam}
          blockParam={blockParam}
          onClose={close}
        />
      )}
    </AnimatePresence>
  );
}

/**
 * JEDEN przepływ usuwania zadania dla modala i pełnej strony `/tasks/:id`
 * (IA-15). Wcześniej mieszkał w ciele `TaskModalShell`; wyjęty tutaj, żeby
 * strona nie dorobiła się drugiej, rozjeżdżającej się kopii pytania.
 * Zwraca `true`, gdy zadanie NAPRAWDĘ zostało usunięte — nawigacja po
 * usunięciu należy do wywołującego (modal się zamyka, strona wraca na listę).
 */
export function useDeleteTaskConfirm(taskId: string | null): () => Promise<boolean> {
  const { state, dispatch } = useStore();
  const confirm = useConfirm();
  return useCallback(async () => {
    const task = taskId === null ? undefined : state.tasks.find((t) => t.id === taskId);
    if (!task) return false;
    // Prawdziwe liczby z selektorów zamiast ogólnika; godziny są derywowane z
    // `WorkloadEntry` (inwariant 1). Cel zapamiętany PRZED `await`.
    const id = task.id;
    const consequences = buildDeleteConsequence({
      assignments: assigneeIdsOfTask(state, id).length,
      plannedHours: taskPlannedTotal(state, id),
    });
    if (
      await confirm({
        title: `Usunąć „${task.title}”?`,
        consequences,
        confirmLabel: 'Usuń zadanie',
        tone: 'danger',
        requireAck: consequences !== '',
      })
    ) {
      dispatch({ type: 'DELETE_TASK', taskId: id });
      return true;
    }
    return false;
  }, [state, dispatch, confirm, taskId]);
}

/**
 * JEDEN przepływ duplikowania zadania dla modala i pełnej strony `/tasks/:id`
 * (zgłoszenie 2026-08-06) — lustro wzorca `useDeleteTaskConfirm`. Generuje id
 * kopii PO STRONIE UI (reduktor go waliduje), żeby wywołujący mógł od razu
 * otworzyć kopię do edycji. Zwraca id kopii albo `null` (nieznane zadanie).
 */
export function useDuplicateTask(): (taskId: string) => string | null {
  const { state, dispatch } = useStore();
  // `taskId` przychodzi w wywołaniu (nie w hooku), żeby lista zadań mogła użyć
  // JEDNEJ instancji dla wszystkich kafelków (hooka nie wolno wołać w pętli).
  return useCallback(
    (taskId: string) => {
      const task = state.tasks.find((t) => t.id === taskId);
      if (!task) return null;
      const newTaskId = crypto.randomUUID();
      dispatch({ type: 'DUPLICATE_TASK', taskId: task.id, newTaskId });
      return newTaskId;
    },
    [state, dispatch],
  );
}

interface ShellProps {
  taskParam: string;
  projectParam: string | null;
  dateParam: string | null;
  assigneeParam: string | null;
  blockParam: string | null;
  onClose: () => void;
}

function TaskModalShell({
  taskParam,
  projectParam,
  dateParam,
  assigneeParam,
  blockParam,
  onClose,
}: ShellProps) {
  const { state } = useStore();
  const confirm = useConfirm();
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
  const { status, savedAtLabel, markSaved } = useSaveStatus(dirty, saveError !== null);
  // IA-12 — powody, dla których zapis nie przejdzie. Edytor je liczy, nagłówek
  // pokazuje je na odznace zapisu (klik = skok do przyczyny).
  const [blockers, setBlockers] = useState<SaveBlocker[]>([]);
  // Skok do przyczyny musi najpierw otworzyć edytor pola (kotwice pól żyją w
  // kafelkach i edytorach otwieranych na żądanie), więc handler przychodzi Z
  // edytora razem z listą. Nagłówek nie zna stanu kafelków i znać go nie musi.
  const jumpRef = useRef<(blocker: SaveBlocker) => void>(focusSaveBlocker);
  const handleBlockersChange = useCallback(
    (next: SaveBlocker[], jump: (blocker: SaveBlocker) => void) => {
      jumpRef.current = jump;
      setBlockers(next);
    },
    [],
  );

  // Deliberate close: the user already confirmed (or nothing needs asking), so
  // the closing navigation must not raise the router guard a second time.
  const closeDeliberately = useCallback(() => {
    bypassNavGuardOnce();
    onClose();
  }, [onClose]);

  // Any close path prompts when there are unsaved changes. Pytanie jest teraz
  // ASYNCHRONICZNE, więc drugie Escape/kliknięcie w trakcie nie może dołożyć
  // drugiego pytania do kolejki. `closeDeliberately` (bypass strażnika +
  // nawigacja) nadal biegnie w JEDNEJ, nieprzerwanej parze.
  const askingRef = useRef(false);
  const requestClose = useCallback(async () => {
    if (askingRef.current) return;
    if (dirtyRef.current) {
      askingRef.current = true;
      const leave = await confirm({
        title: 'Masz niezapisane zmiany.',
        description: 'Zamknąć bez zapisywania?',
        confirmLabel: 'Zamknij bez zapisywania',
        cancelLabel: 'Wróć do edycji',
        // Bez `requireAck`: to porzucenie SZKICU, nie utrata zapisanych danych.
      });
      askingRef.current = false;
      if (!leave) return;
    }
    closeDeliberately();
  }, [closeDeliberately, confirm]);

  // Escape (z pytaniem o niezapisane zmiany), pułapka fokusa, powrót fokusa po
  // zamknięciu i blokada scrolla — wszystko we wspólnej powłoce modala.
  const titleId = useId();
  const { cardRef, cardProps, viewportProps } = useModalShell({
    onRequestClose: requestClose,
    labelledBy: titleId,
    // Modal z formularzem: klik obok karty NIGDY nie zamyka (Escape i przyciski
    // zostają — ze strażnikiem niezapisanych zmian).
    closeOnBackdrop: false,
  });

  const deleteTask = useDeleteTaskConfirm(existing ? existing.id : null);
  const handleDelete = async () => {
    if (await deleteTask()) closeDeliberately();
  };

  // Duplikat otwiera się od razu w TYM SAMYM modalu (zmiana `?task=` remontuje
  // edytor przez `key`), żeby można było z miejsca modyfikować treści kopii.
  const duplicateTask = useDuplicateTask();
  const { openTask } = useOpenTask();
  const handleDuplicate = () => {
    if (!existing) return;
    const newId = duplicateTask(existing.id);
    if (newId !== null) openTask(newId);
  };

  // Otwarcie karty ZAWSZE zaczyna na górze treści. Sam montaż daje `scrollTop`
  // 0, ale `.task-modal-body` PRZEŻYWA zmianę `?task=` (remontuje się tylko
  // `TaskEditor`, przez `key`), więc przejście na inne zadanie przy przewiniętym
  // modalu wpadało w środek nowego formularza. Efekt układu (przed malowaniem)
  // — żeby nie było widocznego skoku. Deep-link do bloku jest wyłączony z tej
  // reguły: tam wygrywa `scrollIntoView` podświetlanego wiersza.
  const bodyRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!opensAtTop({ hasFocusBlock: blockParam !== null })) return;
    const body = bodyRef.current;
    if (body !== null) body.scrollTop = 0;
  }, [taskParam, blockParam]);

  // Utajniona treść bez wglądu: edytor sam pokazuje etykietę maskującą zamiast
  // tytułu (edycja i tak jest wyłączona w TaskEditor).
  const masked = existing !== undefined && isTaskContentMasked(state, existing);

  // Karta v2: nagłówek (ścieżka Klient > Projekt) renderuje EDYTOR, bo to on
  // trzyma wybór klienta i projektu. Powłoka podaje tylko swoje akcje.
  const headerActions = (
    <>
      <SaveStatus
        status={status}
        savedAtLabel={savedAtLabel}
        announceId="save:task-modal"
        blocked={
          blockers.length > 0
            ? {
                message: blockers[0].message,
                onJump: () => jumpRef.current(blockers[0]),
              }
            : undefined
        }
      />
      {existing && <CopyTaskLinkButton path={taskFullViewPath(existing.id)} />}
      {/* IA-15 — wyjście z ciasnego modala do pełnej strony zadania.
          Zwykły `<Link>`: nawigacja zmienia ŚCIEŻKĘ, więc parametr
          `?task=` znika sam, a przy niezapisanych zmianach pyta
          strażnik routera (zakres `task-modal`). */}
      {existing && (
        <Tooltip text="Otwórz pełny widok">
          <Link
            className="icon-btn task-sheet-head-link"
            to={taskFullViewPath(existing.id)}
            aria-label="Otwórz pełny widok"
          >
            <Maximize2 size={18} aria-hidden />
          </Link>
        </Tooltip>
      )}
      {/* AT-08 — akcja niszcząca siedzi w menu „⋯". Sam przepływ potwierdzenia
          (skutki + `requireAck`) jest BEZ ZMIAN. */}
      {existing && canManageTasks && !masked && (
        <OverflowMenu
          label="Więcej działań"
          items={[
            {
              id: 'duplicate',
              label: 'Duplikuj zadanie',
              onSelect: handleDuplicate,
            },
            {
              id: 'delete',
              label: 'Usuń zadanie',
              danger: true,
              onSelect: () => {
                void handleDelete();
              },
            },
          ]}
        />
      )}
      <IconButton
        className="task-modal-close"
        icon={<X size={18} aria-hidden />}
        onClick={requestClose}
        label="Zamknij"
      />
    </>
  );

  return (
    <>
      <m.div
        className="task-modal-scrim"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
      />
      <div className="task-modal-viewport" {...viewportProps}>
        <m.div
          ref={cardRef}
          className={notFound ? 'task-modal-card' : 'task-modal-card task-sheet-modal'}
          {...cardProps}
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          {notFound ? (
            <>
              <div className="task-modal-head">
                <h1 className="task-modal-title" id={titleId}>
                  Nie znaleziono zadania
                </h1>
                <div className="task-modal-head-actions">
                  <IconButton
                    className="task-modal-close"
                    icon={<X size={18} aria-hidden />}
                    onClick={requestClose}
                    label="Zamknij"
                  />
                </div>
              </div>
              <div className="task-modal-body">
                <div className="empty-state">
                  <p className="empty-title">Nie znaleziono zadania</p>
                  <p className="empty-hint">
                    Zadanie mogło zostać usunięte albo link jest nieaktualny.
                  </p>
                  <button type="button" className="btn primary" onClick={onClose}>
                    Zamknij
                  </button>
                </div>
              </div>
            </>
          ) : (
            // Karta v2 ma DWA przewijane obszary (lewa kolumna i rozmowa, a w
            // układzie piętrowym `.task-sheet-split`), więc ciało świadomie NIE
            // nosi klasy `.task-modal-body` (jedyny scroller starej karty i jej
            // reguły pól). `bodyRef` zostaje: zerowanie pozycji jest tanie.
            <div className="task-sheet-modal-body" ref={bodyRef}>
              <TaskEditor
                key={taskParam}
                taskId={existing ? existing.id : null}
                initialProjectId={projectParam ?? undefined}
                initialDate={dateParam ?? undefined}
                initialPersonId={assigneeParam ?? undefined}
                focusBlockId={blockParam ?? undefined}
                titleId={titleId}
                headerActions={headerActions}
                onSaved={onClose}
                onCancel={requestClose}
                onDirtyChange={handleDirtyChange}
                onBlockersChange={handleBlockersChange}
                markSaved={markSaved}
              />
            </div>
          )}
        </m.div>
      </div>
    </>
  );
}

export interface EditorProps {
  taskId: string | null;
  initialProjectId?: string;
  initialDate?: string;
  initialPersonId?: string;
  focusBlockId?: string;
  /** `id` widocznego nagłówka karty (nazwa dialogu przez `aria-labelledby`). */
  titleId: string;
  /** Akcje powłoki w prawym rogu nagłówka (zapis, link, menu, zamknij). */
  headerActions: ReactNode;
  onSaved: () => void;
  onCancel: () => void;
  onDirtyChange: (dirty: boolean) => void;
  /** IA-12 — aktualne powody blokujące zapis (dla odznaki w nagłówku) razem ze
   *  skokiem do przyczyny: ten przełącza zakładkę PRZED ustawieniem fokusa. */
  onBlockersChange: (blockers: SaveBlocker[], jump: (blocker: SaveBlocker) => void) => void;
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
  startTimes: AllocStartMap;
  soldRawByPerson: Record<string, string>;
  confidential: boolean;
}): string {
  return JSON.stringify({
    title: v.title,
    description: v.description,
    projectId: v.projectId,
    statusId: v.statusId,
    priority: v.priority,
    workCategoryId: v.workCategoryId,
    departmentId: v.departmentId,
    confidential: v.confidential,
    // Order-sensitive: item identity + text + done state all participate in dirty.
    checklist: v.checklist.map((c) => [c.id, c.text, c.done]),
    startDate: v.startDate,
    endDate: v.endDate,
    assigneeIds: [...v.assigneeIds].sort(),
    allocations: Object.entries(v.allocations)
      .filter(([, h]) => h > 0)
      .sort(([a], [b]) => a.localeCompare(b)),
    // Przypięte godziny startu — tylko dla komórek z godzinami > 0 (pin bez
    // godzin nie jedzie w ładunku, więc nie może brudzić edytora).
    startTimes: Object.entries(v.startTimes)
      .filter(([key]) => (v.allocations[key] ?? 0) > 0)
      .sort(([a], [b]) => a.localeCompare(b)),
    // Godziny sprzedane per osoba — tylko aktualnie przypisani (odpięcie osoby
    // nie zostawia widma w dirty-detekcji).
    sold: v.assigneeIds
      .map((pid) => [pid, (v.soldRawByPerson[pid] ?? '').trim()] as const)
      .sort(([a], [b]) => a.localeCompare(b)),
  });
}

/**
 * The full task editor form (moved out of the old TaskEditorPage). Eksportowany
 * (IA-15), bo pełna strona `/tasks/:id` renderuje DOKŁADNIE ten sam edytor —
 * bez kopii, bez przenoszenia pliku.
 */
export function TaskEditor({
  taskId,
  initialProjectId,
  initialDate,
  initialPersonId,
  focusBlockId,
  titleId,
  headerActions,
  onSaved,
  onCancel,
  onDirtyChange,
  onBlockersChange,
  markSaved,
}: EditorProps) {
  const { state, dispatch } = useStore();
  const { external } = usePersistence();
  const confirm = useConfirm();
  const canManage = useCan()('tasks.manage');
  const existingForMask = taskId ? state.tasks.find((t) => t.id === taskId) : undefined;
  // Utajniona treść bez wglądu widza: edytor przechodzi w tryb tylko-do-odczytu
  // z maską sekcji (model w taskModalSections). Zarząd i przypisani widzą pełny
  // formularz.
  const contentMasked =
    existingForMask !== undefined && isTaskContentMasked(state, existingForMask);
  const isBoard = isBoardMember(state);
  const readOnly = !canManage || contentMasked;
  // Telefon (≤ 760 px) dostaje pionową LISTĘ dni zamiast 480-pikselowej tabeli
  // przydziału — ten sam breakpoint, co dolny pasek zakładek i widok dnia.
  // Hook stoi wśród pozostałych, PRZED jakimkolwiek wcześniejszym wyjściem.
  const isMobileNav = useMediaQuery(MOBILE_NAV_QUERY);
  // Brak uprawnień: JEDEN ukryty opis na modal zamiast kilkunastu natywnych
  // `title` (te są niewidoczne na dotyku, nieostylowane i w czytniku ekranu
  // doklejają się do KAŻDEJ kontrolki osobno). Kontrolki tylko-do-odczytu
  // wskazują go przez `aria-describedby`.
  const roDescId = 'task-ro-reason';
  /** Zapis/publikacja bez ani jednego projektu jest niemożliwa — powód musi być
   *  czytelny także wtedy, gdy przycisk jest wyłączony natywnie. */
  const noProjectReason = state.projects.length === 0 ? 'Najpierw utwórz projekt' : null;
  /** WIDOCZNA podpowiedź o godzinie startu opisuje pola godziny w siatce —
   *  dawny `title` na każdym polu z osobna był tą samą treścią, tyle że
   *  niewidoczną na dotyku. */
  const startHintId = 'task-alloc-start-hint';
  const roDesc = readOnly ? roDescId : undefined;
  const roDescWith = (control: FieldControlProps): string | undefined =>
    readOnly
      ? mergeDescribedBy(control['aria-describedby'], roDescId)
      : control['aria-describedby'];
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
  // Klient + Projekt: dropdown „Klient" stoi PRZED „Projekt" i zawęża jego
  // listę. Zadanie NIE ma własnego clientId (klient wynika z projektu), więc
  // „przepisanie" klienta = wybór projektu u innego klienta; sam wybór klienta
  // niczego nie zapisuje. Stan startowy wynika z projektu zadania (fallback:
  // pierwszy projekt alfabetycznie — listy sortuje kolacja pl).
  const [projectId, setProjectId] = useState(
    () => existing?.projectId ?? initialProjectId ?? sortByNamePl(state.projects)[0]?.id ?? '',
  );
  const [pickedClientId, setPickedClientId] = useState(() => {
    const seededId =
      existing?.projectId ?? initialProjectId ?? sortByNamePl(state.projects)[0]?.id ?? '';
    const seeded = state.projects.find((p) => p.id === seededId);
    return seeded
      ? effectiveProjectClientId(seeded, new Set(state.clients.map((c) => c.id)))
      : '';
  });
  const clientOptions = useMemo(
    () => clientPickerOptions(state.clients, state.projects),
    [state.clients, state.projects],
  );
  const clientProjects = useMemo(
    () => projectsForClient(state.projects, state.clients, pickedClientId),
    [state.projects, state.clients, pickedClientId],
  );
  /** Zmiana klienta zawęża listę projektów; projekt spoza nowego klienta
   *  przeskakuje na pierwszy (alfabetycznie) projekt tego klienta, a '' gdy
   *  klient nie ma projektów (zapis blokuje istniejący strażnik projektu). */
  const changePickedClient = (nextClientId: string) => {
    setPickedClientId(nextClientId);
    const inClient = projectsForClient(state.projects, state.clients, nextClientId);
    if (!inClient.some((p) => p.id === projectId)) {
      setProjectId(inClient[0]?.id ?? '');
    }
  };
  const [statusId, setStatusId] = useState(
    existing?.statusId ?? statuses[0]?.id ?? state.statuses[0]?.id ?? '',
  );
  const [priority, setPriority] = useState<TaskPriority>(existing?.priority ?? 'normal');
  const [workCategoryId, setWorkCategoryId] = useState<string>(existing?.workCategoryId ?? '');
  const [departmentId, setDepartmentId] = useState<string>(() => {
    if (existing) return existing.departmentId;
    // Nowe zadanie z osobą podpowiedzianą filtrem kalendarza dziedziczy jej
    // dział od razu (ten sam sygnał, co auto-dział w toggleAssignee).
    if (initialPersonId) {
      const person = state.people.find((p) => p.id === initialPersonId);
      if (person !== undefined && person.departmentId !== '') return person.departmentId;
    }
    return '';
  });
  const [checklist, setChecklist] = useState<ChecklistItem[]>(existing?.checklist ?? []);
  const [checklistInput, setChecklistInput] = useState('');
  // Utajnij treść (zarząd): checkbox widoczny tylko dla zarządu; wartość idzie
  // w draftcie WYŁĄCZNIE od zarządu (reduktor i tak ignoruje ją od innych).
  const [confidential, setConfidential] = useState(existing?.isConfidential === true);

  // ---- Stan WIDOKU karty v2 (bez zakładek) ----
  // Kafelki, tytuł, opis, ścieżka Klient > Projekt i siatka dni to wyłącznie
  // przełączniki prezentacji: nie ma tu żadnej wartości zadania. Edytory pod
  // spodem piszą tymi samymi setterami, co wcześniej, więc auto-zapis,
  // walidacja i SAVE_TASK widzą DOKŁADNIE te same dane.
  const [openTile, setOpenTile] = useState<TaskTileId | null>(null);
  const [crumbsOpen, setCrumbsOpen] = useState(false);
  const [titleEditing, setTitleEditing] = useState(false);
  const [descEditing, setDescEditing] = useState(false);
  // „Siatka dni" to jawny podwidok lewej kolumny z przyciskiem powrotu.
  const [allocationView, setAllocationView] = useState(false);
  // Telefon: przełącznik „Szczegóły | Rozmowa".
  const [mobilePane, setMobilePane] = useState<'details' | 'conversation'>('details');
  // Powtarzanie startuje ZWINIĘTE (wiersz z podsumowaniem), także gdy reguła jest.
  const [recurOpen, setRecurOpen] = useState(false);
  // IA-08 — „Wykonane bloki" startuje zwinięte; wejście z konkretnego bloku
  // (`?task=<id>&block=<id>`) rozwija sekcję, bo inaczej podświetlany wiersz
  // byłby ukryty i `scrollIntoView` nie miałoby do czego skoczyć.
  const [doneBlocksOpen, setDoneBlocksOpen] = useState(() => Boolean(focusBlockId));
  const tabsBaseId = useId();
  const recurBodyId = `${tabsBaseId}-recur-body`;
  const doneBlocksBodyId = `${tabsBaseId}-done-blocks-body`;
  const tileEditorId = `${tabsBaseId}-tile-editor`;
  const crumbsEditorId = `${tabsBaseId}-crumbs-editor`;
  const detailsPaneId = `${tabsBaseId}-pane-details`;
  const conversationPaneId = `${tabsBaseId}-pane-conversation`;
  const tileDomId = (tile: TaskTileId) => `${tabsBaseId}-tile-${tile}`;
  // Escape w otwartym edytorze COFA zmiany z tej sesji edycji. Migawkę bierze
  // otwarcie edytora; to zwykłe wywołania tych samych setterów, nic więcej.
  const revertRef = useRef<(() => void) | null>(null);
  // Fokus po commicie Reacta (nowo otwarty edytor albo powrót na wyzwalacz).
  const [pendingFocus, setPendingFocus] = useState<{ id: string; nonce: number } | null>(null);
  const focusAfterCommit = useCallback((id: string) => {
    setPendingFocus((prev) => ({ id, nonce: (prev?.nonce ?? 0) + 1 }));
  }, []);
  useEffect(() => {
    if (pendingFocus === null) return;
    const el = document.getElementById(pendingFocus.id);
    if (el === null) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest' });
  }, [pendingFocus]);
  // Skok z listy blokad zapisu: kotwice pól mieszkają w edytorach otwieranych
  // na żądanie, więc NAJPIERW otwieramy właściwy edytor, a fokus ustawiamy po
  // commicie (`focusSaveBlocker` przewija pole na środek widoku).
  const [pendingBlocker, setPendingBlocker] = useState<{ blocker: SaveBlocker; nonce: number } | null>(
    null,
  );
  useEffect(() => {
    if (pendingBlocker !== null) focusSaveBlocker(pendingBlocker.blocker);
  }, [pendingBlocker]);
  const jumpToBlocker = useCallback((blocker: SaveBlocker) => {
    setMobilePane('details');
    setAllocationView(false);
    const target = blockerTarget(blocker.focusId);
    if (target.kind === 'title') setTitleEditing(true);
    if (target.kind === 'crumbs') setCrumbsOpen(true);
    if (target.kind === 'tile') {
      // Skok nie jest sesją edycji: Escape po nim tylko zwija edytor.
      revertRef.current = null;
      setOpenTile(target.tile);
    }
    setPendingBlocker((prev) => ({ blocker, nonce: (prev?.nonce ?? 0) + 1 }));
  }, []);

  // ---- Cykliczność (recurrence) — LOCAL draft only, seeded once from the task's
  // canonical rule. Never part of TaskDraft/auto-save: apply/clear/restore
  // dispatch SET_TASK_RECURRENCE / SET_RECURRENCE_OVERRIDE explicitly so the
  // delicate SAVE_TASK reconciliation path stays untouched (invariant 6). ----
  const seedRule = existing?.recurrence;
  const [recurDays, setRecurDays] = useState<number[]>(seedRule?.daysOfWeek ?? []);
  const [recurStart, setRecurStart] = useState(
    seedRule ? recurMinutesToTime(seedRule.startMinutes) : '09:00',
  );
  const [recurDurMin, setRecurDurMin] = useState(seedRule?.durationMinutes ?? 60);
  // Interwał „co X tygodni": brak klucza w regule ≡ 1 (co tydzień). Wartość 1
  // NIE trafia z powrotem do modelu (forma kanoniczna zdejmuje ten klucz).
  const [recurInterval, setRecurInterval] = useState(seedRule?.intervalWeeks ?? 1);
  const [recurUntil, setRecurUntil] = useState(seedRule?.until ?? '');
  // AT-07 — walidacja cykliczności startuje dopiero, gdy użytkownik ruszy tę
  // sekcję. Zadanie bez reguły otwierało się z czerwonym „Wybierz przynajmniej
  // jeden dzień tygodnia", choć nikt cykliczności nie włączał.
  const [recurTouched, setRecurTouched] = useState(false);

  // ---- Period ----
  // A calendar empty-slot right-click seeds the clicked day (validated — a
  // tampered URL param falls back to today). Editing an existing task ignores it.
  const seededDate =
    !existing && initialDate && isValidDateStr(initialDate) ? initialDate : todayStr();
  const [startDate, setStartDate] = useState(existing?.startDate ?? seededDate);
  const [endDate, setEndDate] = useState(existing?.endDate ?? seededDate);

  // ---- Assignees ----
  // A person-filtered calendar preselects that person as the sole assignee for a
  // brand-new task (only when they still exist in state).
  const [assigneeIds, setAssigneeIds] = useState<string[]>(() => {
    if (existing) return assigneeIdsOfTask(state, existing.id);
    if (initialPersonId && state.people.some((p) => p.id === initialPersonId)) {
      return [initialPersonId];
    }
    return [];
  });

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

  // ---- OPCJONALNE przypięte godziny startu (allocKey -> minuty od północy).
  // Seed tylko dla par rozwiązywanych do JEDNEGO bloku: dzień wielo-blokowy
  // zachowuje swoje upakowanie i nie dostaje pola w siatce. ----
  const [startTimes, setStartTimes] = useState<AllocStartMap>(() => {
    const map: AllocStartMap = {};
    if (existing) {
      const byPair = new Map<string, number[]>();
      for (const w of state.workload) {
        if (w.taskId !== existing.id || isBinEntry(w)) continue;
        const key = allocKey(w.personId, w.date);
        const list = byPair.get(key);
        if (list) list.push(w.startMinutes);
        else byPair.set(key, [w.startMinutes]);
      }
      // Seed też przechodzi przez normalizację: wartość spoza siatki 15 min
      // wróciłaby w SAVE_TASK i strażnik reducera odrzuciłby CAŁY zapis po
      // cichu (niezmiennik 6 zwraca tę samą referencję stanu).
      for (const [key, starts] of byPair) {
        if (starts.length === 1 && Number.isFinite(starts[0])) {
          map[key] = normalizeStartMinutes(starts[0]);
        }
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
    if (existing && existing.isDraft === true) {
      // Szkic: godziny żyją w `draftHours` (workload jest pusty do publikacji).
      for (const entry of existing.draftHours ?? []) {
        map[entry.personId] = entry.hours > 0 ? String(entry.hours) : '';
      }
    } else if (existing) {
      const totals = new Map<string, number>();
      for (const w of state.workload) {
        if (w.taskId !== existing.id) continue;
        totals.set(w.personId, (totals.get(w.personId) ?? 0) + w.plannedHours);
      }
      for (const pid of assigneeIdsOfTask(state, existing.id)) {
        const t = totals.get(pid) ?? 0;
        map[pid] = t > 0 ? String(t) : '';
      }
    } else {
      // Nowe zadanie z osobą podpowiedzianą przez filtr kalendarza: to też jest
      // przypisanie, więc startuje z minimalnym krokiem (15 min), nie z zerem —
      // inaczej zapis nie utworzyłby żadnego wiersza `WorkloadEntry` i zadanie
      // nie pokazałoby się ani w kalendarzu, ani w zasobniku osoby.
      return withAssigneeHoursDefaults(map, assigneeIds);
    }
    return map;
  });

  // Timing walidacji: pole „krzyczy" dopiero po opuszczeniu go (blur) albo po
  // nieudanej próbie zapisu (`saveAttempted` odsłania wszystko). Blokady liczą
  // się co render, więc widoczny błąd waliduje się na żywo i znika w chwili
  // poprawienia, a nietknięte pole nie czerwieni się przy pisaniu.
  const [touched, setTouched] = useState<ReadonlySet<SaveBlockerId>>(new Set());
  const markTouched = (id: SaveBlockerId) => {
    setTouched((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  };

  // Pole startowe modala: `data-autofocus` na tytule (fokus ustawia powłoka
  // `useModalShell`, żeby nie było dwóch konkurencyjnych `.focus()`).

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

  // Dostępność każdej przypisanej osoby w okresie zadania — CZYSTO INFORMACYJNA
  // (nigdy nie blokuje zapisu). `bookedHours` liczy istniejący workload INNYCH
  // zadań (szkic nie ma własnego), więc panel pokazuje realne obłożenie.
  // Dependency narrowed from the whole `state` to only the slices
  // `rangeAvailabilityForPerson` actually reads (people → workdays/capacity,
  // workload → booked hours), so unrelated store changes don't recompute it.
  // Result is byte-identical; `state` is still passed to the pure selector.
  const availabilityByPerson = useMemo(() => {
    const map = new Map<string, ReturnType<typeof rangeAvailabilityForPerson>>();
    if (!periodValid) return map;
    const days = eachDayInclusive(startDate, endDate);
    for (const id of assigneeIds) {
      map.set(id, rangeAvailabilityForPerson(state, id, days));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.people, state.workload, assigneeIds, startDate, endDate, periodValid]);

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
    startTimes,
    soldRawByPerson,
    confidential,
  });
  const snapshotRef = useRef<string | null>(null);
  if (snapshotRef.current === null) snapshotRef.current = currentSerialized;
  const dirty = snapshotRef.current !== currentSerialized;

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  // ---- Handlers ----

  // AT-13 — „Cofnij" po „Wyczyść kolumnę". Migawka żyje w STANIE EDYTORA, a nie
  // w store: przydziały są szkicem, a SAVE_TASK i tak uzgadnia je delta po
  // delcie, więc akcja cofania w reduktorze byłaby w złej warstwie (i mogłaby
  // wskrzesić bloki, których użytkownik już nie ma na ekranie).
  const [clearUndo, setClearUndo] = useState<{
    personId: string;
    snapshot: PersonColumnSnapshot;
  } | null>(null);
  const clearUndoRef = useRef(clearUndo);
  clearUndoRef.current = clearUndo;
  // Bieżące mapy czytane przez ref, żeby `clearPerson`/`undoClear` zostały
  // stabilne (kontrakt memoizacji siatki) mimo czytania stanu.
  const allocationsRef = useRef(allocations);
  allocationsRef.current = allocations;
  const startTimesRef = useRef(startTimes);
  startTimesRef.current = startTimes;
  // Każda ręczna edycja siatki (`setCell`/`fillWeekdays`) unieważnia migawkę:
  // „Cofnij" po dziesięciu wpisach cofałoby też te wpisy, a tego nikt się nie
  // spodziewa. Zmiana okresu przestawia zestaw dni, więc też ją unieważnia.
  useEffect(() => {
    setClearUndo(null);
  }, [startDate, endDate]);

  // Stable handlers (useCallback) so the memoized AllocationGrid — which runs
  // per-cell availability/overload scans — is not re-rendered/rescanned when the
  // user types in an unrelated editor field.
  const setCell = useCallback((personId: string, date: string, hours: number) => {
    setClearUndo(null);
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
    // Wyzerowana komórka traci też przypiętą godzinę, żeby nie wskrzesić
    // nieaktualnego startu przy ponownym wpisaniu godzin.
    if (snapped <= 0) {
      setStartTimes((prev) => {
        const key = allocKey(personId, date);
        if (prev[key] === undefined) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }, []);

  // Przypięta godzina startu komórki: `null` czyści pin (powrót do
  // automatycznego umiejscowienia), liczba jest snapowana do siatki 15 min i
  // clampowana do doby. NaN (nieparsowalne pole) nigdy nie trafia do stanu.
  const setCellStart = useCallback(
    (personId: string, date: string, minutes: number | null) => {
      const key = allocKey(personId, date);
      setStartTimes((prev) => {
        if (minutes === null) {
          if (prev[key] === undefined) return prev;
          const next = { ...prev };
          delete next[key];
          return next;
        }
        if (!Number.isFinite(minutes)) return prev;
        const value = normalizeStartMinutes(minutes);
        if (prev[key] === value) return prev;
        return { ...prev, [key]: value };
      });
    },
    [],
  );

  const fillWeekdays = useCallback(
    (personId: string) => {
      setClearUndo(null);
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
    },
    [state, startDate, endDate],
  );

  const clearPerson = useCallback(
    (personId: string) => {
      // Migawka SPRZED kasowania — kolejne „Wyczyść" po prostu ją zastępuje.
      setClearUndo({
        personId,
        snapshot: snapshotPersonColumn(
          allocationsRef.current,
          startTimesRef.current,
          eachDayInclusive(startDate, endDate),
          personId,
        ),
      });
      setAllocations((prev) => {
        const next = { ...prev };
        for (const d of eachDayInclusive(startDate, endDate)) {
          delete next[allocKey(personId, d)];
        }
        return next;
      });
      // Wyczyszczone komórki tracą też przypięte godziny startu.
      setStartTimes((prev) => {
        const next = { ...prev };
        for (const d of eachDayInclusive(startDate, endDate)) {
          delete next[allocKey(personId, d)];
        }
        return next;
      });
    },
    [startDate, endDate],
  );

  /** Przywrócenie godzin I przypiętych startów wyczyszczonej kolumny. */
  const undoClear = useCallback((personId: string) => {
    const pending = clearUndoRef.current;
    if (pending === null || pending.personId !== personId) return;
    const restored = restorePersonColumn(
      allocationsRef.current,
      startTimesRef.current,
      pending.snapshot,
    );
    setAllocations(restored.allocations);
    setStartTimes(restored.startTimes);
    setClearUndo(null);
  }, []);

  const toggleAssignee = async (personId: string) => {
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
        // Wszystkie settery poniżej są funkcyjne (`prev => …`), więc przejście
        // na `await` nie może zapisać nieaktualnego stanu.
        const ok = await confirm({
          title: `Usunąć ${person?.name ?? 'tę osobę'} z tego zadania?`,
          consequences: `To usunie ${formatDuration(droppedTotal)} zaplanowanej pracy${binSuffix}.`,
          confirmLabel: 'Usuń osobę',
          tone: 'danger',
        });
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
      setStartTimes((prev) => {
        const next: AllocStartMap = {};
        for (const [key, m] of Object.entries(prev)) {
          if (!key.startsWith(`${personId}|`)) next[key] = m;
        }
        return next;
      });
      setSoldRawByPerson((prev) => {
        const next = { ...prev };
        delete next[personId];
        return next;
      });
      // Odpięta osoba nie ma już kolumny, więc nie ma czego cofać.
      setClearUndo((current) => (current?.personId === personId ? null : current));
    } else {
      setAssigneeIds((prev) => [...prev, personId]);
      // Świeżo przypisana osoba dostaje bazowo MINIMALNY krok planowania
      // (15 min). Zero nie tworzyłoby żadnego wiersza `WorkloadEntry`, więc
      // zapomniane godziny znaczyłyby zadanie niewidoczne i w kalendarzu,
      // i w zasobniku. Wpisana już wartość (np. powrót do osoby, która ma
      // godziny na tym zadaniu) zostaje nietknięta.
      setSoldRawByPerson((prev) => withAssigneeHoursDefault(prev, personId));
      // Dział zadania dopisuje się SAM z profilu zaznaczonej osoby (zgłoszenie
      // 2026-08-07) — ale wyłącznie w puste pole: raz wybrany (ręcznie albo
      // przez wcześniejszą osobę) dział nigdy nie jest nadpisywany, bo zadanie
      // niesie JEDEN dział, a wybór usera jest świadomy. Odpięcie osoby
      // celowo niczego nie cofa (dział mógł być już zaakceptowany).
      const person = state.people.find((p) => p.id === personId);
      if (person !== undefined && person.departmentId !== '') {
        setDepartmentId((prev) => (prev === '' ? person.departmentId : prev));
      }
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
      // Spread WARUNKOWY: jawne `startMinutes: undefined` zmieniłoby kształt
      // ładunku bez powodu (brak klucza = automatyczne umiejscowienie).
      cells.push({
        personId,
        date,
        plannedHours: hours,
        ...(startTimes[key] !== undefined ? { startMinutes: startTimes[key] } : {}),
      });
    }
    return cells;
  }, [allocations, startTimes, periodDaysSet, assigneeIds]);

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
    // Utajnienie: pole idzie w draftcie tylko od zarządu — brak klucza znaczy
    // „zachowaj stan zadania", więc edycja przez nie-zarząd niczego nie zmienia.
    ...(isBoard ? { isConfidential: confidential } : {}),
  };
  const assigneesValid = assigneeIds.every((id) => hasEntity(state, 'person', id));
  // IA-12 — jedna lista zamiast anonimowego boolean-a: te same bramki, ale z
  // powodem i kotwicą fokusa. `formValid` (auto-zapis + ręczny zapis) to nadal
  // dokładnie „nic nie blokuje”, więc reduktor nigdy nie dostaje złego payloadu
  // (invariant 6).
  const blockers = collectTaskSaveBlockers({
    title,
    projectValid: !projectError,
    hasProjects: state.projects.length > 0,
    statusValid: hasEntity(state, 'status', statusId),
    period: perErr,
    assigneesValid,
    draftValid: isValidTaskDraft(state, draftForSave),
  });
  const formValid = blockers.length === 0;

  // Raport do powłoki modala (odznaka zapisu). Sygnatura tekstowa trzyma efekt
  // przy jednym wywołaniu na REALNĄ zmianę listy, nie na każdy render.
  const blockerSignature = blockers.map((b) => `${b.id}:${b.message}`).join('|');
  const blockersRef = useRef(blockers);
  blockersRef.current = blockers;
  useEffect(() => {
    onBlockersChange(blockersRef.current, jumpToBlocker);
  }, [blockerSignature, onBlockersChange, jumpToBlocker]);

  // Nieudana próba zapisu odsłania listę powodów przy przycisku (przed pierwszą
  // próbą pusty formularz nowego zadania nie krzyczy).
  const [saveAttempted, setSaveAttempted] = useState(false);

  // Widoczność błędu przy polu: przyczyna ISTNIEJE i pole było już opuszczone
  // albo zapis się nie udał. To samo bramkuje `aria-invalid`.
  const blockerById = new Map(blockers.map((b) => [b.id, b] as const));
  const showError = (id: SaveBlockerId): boolean =>
    blockerById.has(id) && (touched.has(id) || saveAttempted);
  // Okres to JEDNA przyczyna na DWÓCH polach: widoczność wspólna, a oznaczenie
  // `aria-invalid` zależy od wariantu błędu.
  const periodErrorVisible = showError('period');
  const periodTargets =
    perErr !== null ? periodInvalidTargets(perErr) : { start: false, end: false };

  const doSave = ({ publishNew = false }: { publishNew?: boolean } = {}): boolean => {
    if (!formValid) {
      // Przycisk nigdy nie jest jednocześnie aktywny i martwy: pokazujemy powody
      // i przenosimy użytkownika do pierwszego z nich.
      setSaveAttempted(true);
      jumpToBlocker(blockers[0]);
      return false;
    }
    setSaveAttempted(false);

    // NOWY szkic „Utwórz i opublikuj”: jeden SAVE_TASK z `isDraft: false` —
    // standardowa ścieżka opublikowana materializuje binTotals sama, bez rundy
    // po id (edycja istniejącego szkicu idzie osobno przez PUBLISH_TASK).
    const draftToSave = publishNew ? { ...draftForSave, isDraft: false } : draftForSave;
    dispatch({
      type: 'SAVE_TASK',
      payload: {
        taskId: existing ? existing.id : null,
        draft: draftToSave,
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

  // Publikacja ISTNIEJĄCEGO szkicu z karty zadania: najpierw zapis (żeby
  // PUBLISH_TASK zobaczył świeże `draftHours`), potem publikacja i zamknięcie.
  // Dwa kolejne dispatche są bezpieczne — React stosuje je po kolei.
  const handlePublishExisting = () => {
    if (!existing) return;
    if (doSave()) {
      dispatch({ type: 'PUBLISH_TASK', taskId: existing.id });
      onSaved();
    }
  };

  // Nowy szkic od razu opublikowany (jeden SAVE_TASK z isDraft:false).
  const handleCreateAndPublish = () => {
    if (doSave({ publishNew: true })) onSaved();
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

  // ---- Cykliczność derived values + explicit dispatch handlers ----
  // Live rule/overrides read from the store each render (not the one-time seed),
  // so the „Usuń" button and the override list reflect applied changes at once.
  const liveRule = existing?.recurrence;
  const recurStartMin = recurTimeToMinutes(recurStart);
  const recurUntilInvalid = recurUntil !== '' && (!isValidDateStr(recurUntil) || recurUntil < startDate);
  const recurApplyError =
    recurDays.length === 0
      ? 'Wybierz przynajmniej jeden dzień tygodnia.'
      : !Number.isFinite(recurStartMin) || recurStartMin % MINUTE_STEP !== 0
        ? 'Początek musi być w krokach co 15 minut.'
        : recurUntilInvalid
          ? 'Data „do dnia” nie może być wcześniejsza niż data rozpoczęcia.'
          : recurStartMin + recurDurMin > DAY_MINUTES
            ? 'Wystąpienie nie mieści się w dobie — koniec po 24:00.'
            : null;

  // Każda edycja sekcji „Cykliczność” odsłania jej walidację (AT-07).
  const recurEdited = () => setRecurTouched(true);
  const toggleRecurDay = (iso: number) => {
    recurEdited();
    setRecurDays((prev) =>
      prev.includes(iso) ? prev.filter((d) => d !== iso) : [...prev, iso].sort((a, b) => a - b),
    );
  };
  const applyRecurrence = () => {
    if (!existing || recurApplyError) return;
    dispatch({
      type: 'SET_TASK_RECURRENCE',
      taskId: existing.id,
      recurrence: {
        daysOfWeek: recurDays,
        startMinutes: recurStartMin,
        durationMinutes: recurDurMin,
        ...(recurInterval > 1 ? { intervalWeeks: recurInterval } : {}),
        ...(recurUntil !== '' ? { until: recurUntil } : {}),
      },
    });
  };
  const clearRecurrence = () => {
    if (!existing) return;
    dispatch({ type: 'SET_TASK_RECURRENCE', taskId: existing.id, recurrence: null });
  };
  const restoreOverride = (date: string) => {
    if (!existing) return;
    dispatch({ type: 'SET_RECURRENCE_OVERRIDE', taskId: existing.id, date, override: null });
  };

  // ---- Per-block „Wykonane bloki” (PKG-per-block-done) ----
  // One row per WorkloadEntry (NOT aggregated per day): a task with two blocks on
  // the same day shows two rows, each with its own tick. Dated blocks first
  // (chronological by date, then start), bin rows last. SET_BLOCK_DONE toggles a
  // single entry; when the tick leaves nothing to do (all blocks done, empty
  // bin, no free sold hours) the reducer auto-closes a NON-recurring task
  // (autoCompleteTask, 2026-08-24) — unticking never reopens it.
  const taskBlocks = useMemo(() => {
    if (!existing) return [];
    return state.workload
      .filter((w) => w.taskId === existing.id)
      .slice()
      .sort((a, b) => {
        const aBin = isBinEntry(a);
        const bBin = isBinEntry(b);
        if (aBin !== bBin) return aBin ? 1 : -1;
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        if (a.startMinutes !== b.startMinutes) return a.startMinutes - b.startMinutes;
        return a.sortIndex - b.sortIndex;
      });
  }, [state.workload, existing]);

  // Highlight + scroll to the block the user clicked, once the section renders.
  const focusRowRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (focusBlockId && focusRowRef.current) {
      focusRowRef.current.scrollIntoView({ block: 'nearest' });
    }
  }, [focusBlockId, taskBlocks.length]);

  // Zdanie opisujące blok mieszka teraz w czystym `utils/blockLabel.ts` —
  // kalendarz używa go jako nazwy dostępnej kafelka (z tytułem zadania), a tu
  // zostaje DOKŁADNIE ten sam tekst, co wcześniej (bez tytułu: nagłówek modala
  // już go niesie).
  const blockRowLabel = (entry: (typeof taskBlocks)[number]): string =>
    blockLabel({
      personName: getPerson(state, entry.personId)?.name,
      date: entry.date,
      startMinutes: entry.startMinutes,
      plannedHours: entry.plannedHours,
    });
  const blocksDoneCount = taskBlocks.filter((b) => b.done === true).length;

  // ---- Model sekcji — JEDYNE źródło widoczności (kafelki, sekcje, podwidok) ----
  const commentCount = existing ? commentsFor(state, 'task', existing.id).length : 0;
  const sectionFlags: SectionFlags = {
    isEdit,
    isDraft,
    hasValidPeriod: periodValid,
    hasAssignees: assignedPeople.length > 0,
    hasBlocks: taskBlocks.length > 0,
    commentCount,
    contentMasked,
  };
  const visibleIds = new Set<TaskModalSectionId>(visibleSections(sectionFlags).map((s) => s.id));
  const show = (id: TaskModalSectionId): boolean => visibleIds.has(id);

  /** Powód blokady edycji (dymek kafelka). `null` = edycja dozwolona. */
  const roReason = readOnly
    ? contentMasked
      ? 'Treść zadania utajniona.'
      : `${NO_PERM_TITLE} do edycji zadań.`
    : null;

  /** Wspólny nagłówek sekcji zwijanej — `aria-expanded` + `aria-controls`. */
  const collapseToggle = (
    label: string,
    open: boolean,
    bodyId: string,
    onToggle: () => void,
    summary?: string,
  ) => (
    <button
      type="button"
      className="section-toggle"
      aria-expanded={open}
      aria-controls={bodyId}
      onClick={onToggle}
    >
      <span className="section-toggle-label">{label}</span>
      {summary !== undefined && <span className="task-sheet-toggle-summary">{summary}</span>}
      <span className="section-toggle-mark" aria-hidden>
        {open ? '−' : '+'}
      </span>
    </button>
  );

  // ---- Edytory otwierane z kafelków, ścieżki i tekstów ----
  /** Migawka pól kafelka na wejściu w edycję; Escape ją przywraca. */
  const tileRevert = (tile: TaskTileId): (() => void) => {
    switch (tile) {
      case 'status': {
        const prev = statusId;
        return () => setStatusId(prev);
      }
      case 'priority': {
        const prev = priority;
        return () => setPriority(prev);
      }
      case 'period': {
        const prevStart = startDate;
        const prevEnd = endDate;
        return () => {
          setStartDate(prevStart);
          setEndDate(prevEnd);
        };
      }
      case 'people': {
        const prevIds = assigneeIds;
        const prevSold = soldRawByPerson;
        const prevAlloc = allocations;
        const prevStarts = startTimes;
        const prevDept = departmentId;
        return () => {
          setAssigneeIds(prevIds);
          setSoldRawByPerson(prevSold);
          setAllocations(prevAlloc);
          setStartTimes(prevStarts);
          setDepartmentId(prevDept);
          setClearUndo(null);
        };
      }
      case 'hours': {
        const prevSold = soldRawByPerson;
        return () => setSoldRawByPerson(prevSold);
      }
      case 'classification': {
        const prevCategory = workCategoryId;
        const prevDept = departmentId;
        return () => {
          setWorkCategoryId(prevCategory);
          setDepartmentId(prevDept);
        };
      }
    }
  };
  const crumbTriggerRef = useRef<'client' | 'project'>('project');
  const crumbDomId = (which: 'client' | 'project') => `${tabsBaseId}-crumb-${which}`;
  const closeTile = (revert: boolean) => {
    if (openTile === null) return;
    if (revert) revertRef.current?.();
    revertRef.current = null;
    setOpenTile(null);
    focusAfterCommit(tileDomId(openTile));
  };
  const closeCrumbs = (revert: boolean) => {
    if (!crumbsOpen) return;
    if (revert) revertRef.current?.();
    revertRef.current = null;
    setCrumbsOpen(false);
    focusAfterCommit(crumbDomId(crumbTriggerRef.current));
  };
  const toggleTile = (tile: TaskTileId) => {
    if (openTile === tile) {
      closeTile(false);
      return;
    }
    // Jeden edytor naraz: poprzedni zwija się z zachowaniem zmian.
    setCrumbsOpen(false);
    revertRef.current = tileRevert(tile);
    setOpenTile(tile);
    focusAfterCommit(tileEditorId);
  };
  const toggleCrumbs = (which: 'client' | 'project') => {
    if (crumbsOpen) {
      closeCrumbs(false);
      return;
    }
    crumbTriggerRef.current = which;
    setOpenTile(null);
    const prevProject = projectId;
    const prevClient = pickedClientId;
    revertRef.current = () => {
      setPickedClientId(prevClient);
      setProjectId(prevProject);
    };
    setCrumbsOpen(true);
    focusAfterCommit(which === 'client' ? 't-client' : 't-project');
  };
  /** Escape w otwartym edytorze: cofnij, zwiń, fokus na wyzwalacz. Klawisz nie
   *  dochodzi do modala (inaczej zamknąłby całą kartę). */
  const escapeCancels = (close: (revert: boolean) => void) => (event: React.KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    close(true);
  };

  // Tytuł i opis: tekst do odczytu, klik albo Enter przełącza na pole. Pola
  // piszą tymi samymi setterami (`setTitle`/`setDescription`), więc auto-zapis
  // i walidacja działają jak wcześniej; Escape przywraca wartość sprzed edycji.
  const titleBeforeEdit = useRef(title);
  const descBeforeEdit = useRef(description);
  const titleReadId = `${tabsBaseId}-title-read`;
  const descReadId = `${tabsBaseId}-desc-read`;
  const startTitleEdit = () => {
    titleBeforeEdit.current = title;
    setTitleEditing(true);
    focusAfterCommit('t-title');
  };
  const finishTitleEdit = (revert: boolean) => {
    if (revert) setTitle(titleBeforeEdit.current);
    setTitleEditing(false);
    focusAfterCommit(titleReadId);
  };
  const startDescEdit = () => {
    descBeforeEdit.current = description;
    setDescEditing(true);
    focusAfterCommit('t-desc');
  };
  const finishDescEdit = (revert: boolean) => {
    if (revert) setDescription(descBeforeEdit.current);
    setDescEditing(false);
    focusAfterCommit(descReadId);
  };
  const descRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = descRef.current;
    if (el === null) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [description, descEditing]);

  // „Siatka dni": jawny podwidok z powrotem na wyzwalacz.
  const gridButtonId = `${tabsBaseId}-grid-open`;
  const openAllocation = () => {
    setOpenTile(null);
    setCrumbsOpen(false);
    revertRef.current = null;
    setAllocationView(true);
    focusAfterCommit(`${tabsBaseId}-grid-back`);
  };
  const closeAllocation = () => {
    setAllocationView(false);
    focusAfterCommit(gridButtonId);
  };

  // ---- Wartości kafelków (tryb odczytu) ----
  const pickedStatus = getStatus(state, statusId);
  const pickedProject = state.projects.find((p) => p.id === projectId);
  const pickedClientName = clientOptions.find((c) => c.id === pickedClientId)?.name;
  const showClientCrumb = state.projects.length > 0 && state.clients.length > 0;
  const hoursRows = taskHoursRows(assignedPeople, soldByPerson, datedByPerson);
  const hoursSummary = hoursTileSummary({
    calendar: plannedTotalAll,
    bin: binTotal,
    sold: soldTotal,
  });
  const categoryName = state.workCategories.find((c) => c.id === workCategoryId)?.name;
  const departmentName = state.departments.find((d) => d.id === departmentId)?.name;
  const TILE_LABELS: Record<TaskTileId, string> = {
    status: 'Status',
    priority: 'Priorytet',
    period: 'Okres',
    people: 'Osoby',
    hours: 'Godziny',
    classification: 'Kategoria i dział',
  };
  const tileVisible: Record<TaskTileId, boolean> = {
    status: show('context'),
    priority: show('details'),
    period: show('period'),
    people: show('people-hours'),
    hours: show('people-hours'),
    classification: show('classification'),
  };
  const tileError = (tile: TaskTileId): { id: string; message: string } | null => {
    if (openTile === tile) return null;
    if (tile === 'status' && showError('status')) {
      return { id: 't-status-tile-error', message: 'Wybierz istniejący status.' };
    }
    if (tile === 'period' && periodErrorVisible && perErr) {
      return { id: 't-period-tile-error', message: PERIOD_ERROR_LABELS[perErr] };
    }
    if (tile === 'people' && showError('assignees')) {
      return { id: 't-assignees-tile-error', message: blockerById.get('assignees')?.message ?? '' };
    }
    return null;
  };
  const tileContent: Record<TaskTileId, { icon: ReactNode; value: ReactNode }> = {
    status: {
      icon: <CircleDot size={14} />,
      value: pickedStatus ? <StatusBadge status={pickedStatus} /> : 'Brak statusu',
    },
    priority: {
      icon: <Flag size={14} />,
      value: (
        <span className={`priority-badge priority-${priority}`}>{PRIORITY_LABELS[priority]}</span>
      ),
    },
    period: {
      icon: <CalendarRange size={14} />,
      value: periodTileLabel({ startDate, endDate, valid: periodValid, days: periodDays }),
    },
    people: {
      icon: <Users size={14} />,
      value: (
        <span className="task-tile-people">
          {assignedPeople.length > 0 && (
            <span className="task-tile-avatars" aria-hidden>
              {assignedPeople.slice(0, 3).map((p) => (
                <Avatar key={p.id} person={p} size={24} />
              ))}
            </span>
          )}
          <span>{peopleTileLabel(assignedPeople.map((p) => p.name))}</span>
        </span>
      ),
    },
    hours: {
      icon: <Clock size={14} />,
      value: isDraft ? `${compactHours(soldTotal)}h po publikacji` : <HoursBar summary={hoursSummary} />,
    },
    classification: {
      icon: <Tag size={14} />,
      value:
        categoryName || departmentName ? (
          <span className="task-tile-classification">
            {categoryName && <span className="task-tile-chip">{categoryName}</span>}
            {departmentName && <span>{departmentName}</span>}
          </span>
        ) : (
          'Bez kategorii i działu'
        ),
    },
  };

  // ---- Edytory pól: TA SAMA treść, co w dawnych sekcjach (id, walidacja,
  // handlery bez zmian), tylko przeniesiona pod kafelki. ----
  const tileEditors: Record<TaskTileId, ReactNode> = {
    status: (
      <Field
        id="t-status"
        label="Status *"
        error={showError('status') ? 'Wybierz istniejący status.' : undefined}
      >
        {(control) => (
          <select
            {...control}
            value={statusId}
            onChange={(e) => setStatusId(e.target.value)}
            onBlur={() => markTouched('status')}
            disabled={readOnly}
            aria-describedby={roDescWith(control)}
          >
            {pickableStatuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {archivedSuffix(s.archived)}
              </option>
            ))}
          </select>
        )}
      </Field>
    ),
    priority: (
      <Field id="t-priority" label="Priorytet">
        {(control) => (
          <select
            {...control}
            value={priority}
            onChange={(e) => setPriority(e.target.value as TaskPriority)}
            disabled={readOnly}
            aria-describedby={roDescWith(control)}
          >
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
        )}
      </Field>
    ),
    period: (
      <>
        <div className="field-row">
          {/* Błąd okresu opisuje OBA pola jednym akapitem (`t-period-error`).
              Błąd pojedynczej daty oznacza swoje pole, a błąd ZAKRESU
              (`reversed`/`too-long`) oba — żadna data nie jest sama zła. */}
          <Field
            id="t-start"
            label="Data startu"
            help={isValidDateStr(startDate) ? formatShortWithWeekday(startDate) : undefined}
            invalid={periodErrorVisible && periodTargets.start}
            {...(periodErrorVisible ? { describedByExtra: 't-period-error' } : {})}
          >
            {(control) => (
              <input
                {...control}
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                onBlur={() => markTouched('period')}
                disabled={readOnly}
                aria-describedby={roDescWith(control)}
              />
            )}
          </Field>
          <Field
            id="t-end"
            label="Data końca"
            help={isValidDateStr(endDate) ? formatShortWithWeekday(endDate) : undefined}
            invalid={periodErrorVisible && periodTargets.end}
            {...(periodErrorVisible ? { describedByExtra: 't-period-error' } : {})}
          >
            {(control) => (
              <input
                {...control}
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                onBlur={() => markTouched('period')}
                disabled={readOnly}
                aria-describedby={roDescWith(control)}
              />
            )}
          </Field>
        </div>
        {periodErrorVisible && perErr && (
          <p className="field-error" id="t-period-error">
            {PERIOD_ERROR_LABELS[perErr]}
          </p>
        )}
        {periodValid && <p className="field-hint">Liczba dni w okresie: {periodDays}.</p>}
      </>
    ),
    people: (
      <>
        {state.people.length === 0 ? (
          <p className="field-hint">
            Nie ma jeszcze osób. <Link to="/people">Dodaj osoby</Link>, aby przypisać pracę.
          </p>
        ) : (
          // `id` + `tabIndex` to kotwica skoku z listy blokad zapisu (IA-12).
          // Grupa (nie pojedyncza kontrolka), więc wiązanie opisu/`aria-invalid`
          // jest ręczne — `fieldAria` jest tu jedynym źródłem tych atrybutów.
          <div
            className="assignee-picker"
            id="t-assignees"
            tabIndex={-1}
            role="group"
            aria-label="Przypisane osoby"
            {...fieldAria('t-assignees', { hasHelp: false, hasError: showError('assignees') })}
          >
            {state.people.map((p) => {
              const checked = assigneeIds.includes(p.id);
              return (
                <label key={p.id} className={checked ? 'assignee-chip checked' : 'assignee-chip'}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      markTouched('assignees');
                      toggleAssignee(p.id);
                    }}
                    disabled={readOnly}
                    aria-describedby={roDesc}
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
        {showError('assignees') && (
          <p className="field-error" id="t-assignees-error">
            {blockerById.get('assignees')?.message}
          </p>
        )}
        {assignedPeople.length > 0 && (
          <p className="field-hint">
            Godziny każdej osoby ustawisz w kafelku „Godziny”.
          </p>
        )}
        {isDraft && (
          <p className="field-hint task-draft-hint">
            <strong>Szkic.</strong> Godziny osób zapisują się ze szkicem i po
            publikacji trafią do zasobnika. Zadanie pozostaje szkicem, dopóki go
            nie opublikujesz.
          </p>
        )}
      </>
    ),
    hours:
      assignedPeople.length === 0 ? (
        <p className="field-hint">Przypisz co najmniej jedną osobę, aby ustawić godziny.</p>
      ) : (
        <div className="sold-hours">
          <div className="task-tile-editor-note">
            <span className="field-hint">Godziny sprzedane każdej osoby</span>
            <HelpTip
              label="Jak liczą się godziny"
              text={
                isDraft
                  ? 'Edytujesz godziny każdej osoby na tym szkicu (sprzedane). Zapisują się ze szkicem, a po publikacji trafią do zasobnika osoby. Szacunek zadania to ich suma i wylicza się sam.'
                  : 'Edytujesz godziny każdej osoby na tym zadaniu (sprzedane). Szacunek zadania to ich suma i wylicza się sam. Część niezaplanowana w kalendarzu trafia automatycznie do zasobnika osoby.'
              }
            />
          </div>
          {assignedPeople.map((p) => {
            const sold = soldByPerson.get(p.id) ?? 0;
            const dated = datedByPerson.get(p.id) ?? 0;
            const bin = Math.max(0, snapHours(sold - dated));
            const clamped = dated > sold + 1e-9;
            // Osoba bez ani jednej godziny nie dostanie wiersza `WorkloadEntry`,
            // więc zadanie nie pojawi się u niej ani w kalendarzu, ani
            // w zasobniku. Domyślne 15 min chroni przed zapomnieniem; tu
            // zostaje świadome wyzerowanie i dane sprzed tej zmiany.
            const noHours = assigneeHasNoHours(sold, dated);
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
                  aria-describedby={roDesc}
                />
                {isDraft ? (
                  <span className="sold-hours-meta muted">
                    po publikacji do zasobnika: {formatDuration(sold)}
                  </span>
                ) : (
                  <span className="sold-hours-meta muted">
                    w kalendarzu {formatDuration(dated)} • zasobnik {formatDuration(bin)}
                  </span>
                )}
                {clamped && (
                  <span className="field-error sold-hours-warn">
                    w kalendarzu więcej niż godziny osoby
                  </span>
                )}
                {noHours && (
                  <span className="field-error sold-hours-warn">
                    {isDraft
                      ? 'bez godzin, po publikacji nie trafi do zasobnika'
                      : 'bez godzin, zadanie nie trafi do zasobnika tej osoby'}
                  </span>
                )}
              </div>
            );
          })}
          <div className="sold-hours-total">
            Szacunek zadania (suma godzin osób): <strong>{formatDuration(soldTotal)}</strong>{' '}
            <span className="muted">wyliczany</span>
          </div>
          {/* Panel dostępności (informacyjny): dostępne vs zajęte w okresie
              zadania, z podświetleniem przeciążonych dni. Nie blokuje zapisu. */}
          {periodValid && (
            <div className="availability-panel">
              {assignedPeople.map((p) => {
                const avail = availabilityByPerson.get(p.id);
                if (!avail) return null;
                const overbooked = avail.overbookedDates.length > 0;
                return (
                  <div key={p.id} className="availability-row">
                    <span
                      className="person-dot"
                      style={{ background: personColor(p.id) }}
                      aria-hidden
                    />
                    <span className="availability-name">{p.name}</span>
                    <span className="availability-meta muted">
                      Dostępność w okresie: dostępne {formatDuration(avail.availableHours)} /
                      zajęte {formatDuration(avail.bookedHours)}
                    </span>
                    {overbooked && (
                      <span className="field-error sold-hours-warn">
                        przeciążenie: {avail.overbookedDates.length} dn.
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {show('summary') && legacyEstimate != null && Math.abs(legacyEstimate - soldTotal) > 1e-9 && (
            <p className="field-hint">
              Poprzedni ręczny szacunek: {formatDuration(legacyEstimate)}. Po zapisie
              szacunkiem stanie się suma godzin osób.
            </p>
          )}
        </div>
      ),
    classification: (
      <div className="field-row">
        <div className="field">
          <label htmlFor="t-category">Kategoria</label>
          <select
            id="t-category"
            value={workCategoryId}
            onChange={(e) => setWorkCategoryId(e.target.value)}
            disabled={readOnly}
            aria-describedby={roDesc}
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
            aria-describedby={roDesc}
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
    ),
  };

  // ---- Podwidok „Siatka dni" (dawna sekcja „Dzienny przydział godzin") ----
  const allocationContent = (
    <>
      {/* Podpowiedź dotyczy pola godziny startu, a siatka pokazuje je tylko w
          trybie edycji — w podglądzie bez uprawnień byłaby myląca. */}
      {!readOnly && (
        <p className="field-hint" id={startHintId}>
          Godzina startu jest opcjonalna. Puste pole planuje blok w pierwszym wolnym oknie dnia.
        </p>
      )}
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
          {/* Ta sama edycja w dwóch postaciach: tabela na desktopie, lista dni
              na telefonie. Oba warianty dostają TE SAME (memoizowane) propsy i
              zapisują przez TE SAME handlery — druga ścieżka mutacji nie
              powstaje (inwariant 1). */}
          {isMobileNav ? (
            <AllocationDayList
              state={state}
              currentTaskId={existing ? existing.id : null}
              startDate={startDate}
              endDate={endDate}
              people={assignedPeople}
              allocations={allocations}
              startTimes={startTimes}
              blockCounts={multiBlockCounts}
              onChange={setCell}
              onChangeStart={setCellStart}
              onFillWeekdays={fillWeekdays}
              onClearPerson={clearPerson}
              undoPersonId={clearUndo === null ? null : clearUndo.personId}
              onUndoClear={undoClear}
              readOnly={readOnly}
              startHintId={readOnly ? undefined : startHintId}
            />
          ) : (
            <AllocationGrid
              state={state}
              currentTaskId={existing ? existing.id : null}
              startDate={startDate}
              endDate={endDate}
              people={assignedPeople}
              allocations={allocations}
              startTimes={startTimes}
              blockCounts={multiBlockCounts}
              onChange={setCell}
              onChangeStart={setCellStart}
              onFillWeekdays={fillWeekdays}
              onClearPerson={clearPerson}
              undoPersonId={clearUndo === null ? null : clearUndo.personId}
              onUndoClear={undoClear}
              readOnly={readOnly}
              startHintId={readOnly ? undefined : startHintId}
            />
          )}
        </>
      )}
    </>
  );

  const titleError = showError('title');
  const titleBlock = contentMasked && existing ? (
    <h1 className="task-sheet-title" id={titleId}>
      {maskedTaskLabel(state, existing.id)}
    </h1>
  ) : !isEdit ? (
    <>
      <h1 className="sr-only" id={titleId}>
        Nowe zadanie
      </h1>
      <Field id="t-title" label="Tytuł *" error={titleError ? 'Tytuł jest wymagany' : undefined}>
        {(control) => (
          <input
            {...control}
            data-autofocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => markTouched('title')}
            className={titleError ? 'invalid task-sheet-title-input' : 'task-sheet-title-input'}
            placeholder="Co trzeba zrobić?"
            disabled={readOnly}
            aria-describedby={roDescWith(control)}
          />
        )}
      </Field>
    </>
  ) : (
    <>
      <h1 className="task-sheet-title" id={titleId}>
        {titleEditing && !readOnly ? (
          <input
            id="t-title"
            className={titleError ? 'invalid task-sheet-title-input' : 'task-sheet-title-input'}
            aria-label="Tytuł zadania"
            {...fieldAria('t-title', { hasHelp: false, hasError: titleError })}
            value={title}
            placeholder="Co trzeba zrobić?"
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              markTouched('title');
              setTitleEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                finishTitleEdit(true);
              } else if (e.key === 'Enter') {
                // Enter kończy edycję tytułu i NIE wysyła formularza (zapis i
                // tak robi auto-zapis).
                e.preventDefault();
                finishTitleEdit(false);
              }
            }}
          />
        ) : readOnly ? (
          title
        ) : (
          <button
            type="button"
            id={titleReadId}
            className="task-sheet-title-read"
            data-autofocus
            aria-describedby={titleError ? 't-title-error' : undefined}
            onClick={startTitleEdit}
          >
            {title.trim() === '' ? <span className="task-sheet-placeholder">Dodaj tytuł</span> : title}
          </button>
        )}
      </h1>
      {titleError && (
        <p className="field-error" id="t-title-error">
          Tytuł jest wymagany
        </p>
      )}
    </>
  );

  const tilesToRender = (Object.keys(tileVisible) as TaskTileId[]).filter((t) => tileVisible[t]);

  const details = (
    <>
      {titleBlock}

      {tilesToRender.length > 0 && (
        <div className="task-tiles" data-count={tilesToRender.length}>
          {tilesToRender.map((tile) => (
            <TaskTile
              key={tile}
              id={tileDomId(tile)}
              icon={tileContent[tile].icon}
              label={TILE_LABELS[tile]}
              value={tileContent[tile].value}
              expanded={openTile === tile}
              controls={tileEditorId}
              disabledReason={roReason}
              disabledDescId={roDescId}
              error={tileError(tile)}
              onToggle={() => toggleTile(tile)}
            />
          ))}
        </div>
      )}
      {openTile !== null && tileVisible[openTile] && (
        <div
          id={tileEditorId}
          className="task-tile-editor"
          role="group"
          aria-label={`Edycja: ${TILE_LABELS[openTile]}`}
          tabIndex={-1}
          onKeyDown={escapeCancels(closeTile)}
        >
          <div className="task-tile-editor-head">
            <span className="task-tile-editor-title">{TILE_LABELS[openTile]}</span>
            <span className="task-tile-editor-hint">Escape cofa zmiany</span>
            <button type="button" className="btn ghost" onClick={() => closeTile(false)}>
              Zwiń
            </button>
          </div>
          {tileEditors[openTile]}
        </div>
      )}

      {show('details') && (
        <section className="task-sheet-section" aria-labelledby={`${tabsBaseId}-desc-h`}>
          <h2 id={`${tabsBaseId}-desc-h`}>Opis</h2>
          {descEditing && !readOnly ? (
            <textarea
              ref={descRef}
              id="t-desc"
              className="task-sheet-desc-input"
              aria-label="Opis zadania"
              value={description}
              rows={3}
              placeholder="Opcjonalne szczegóły"
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() => setDescEditing(false)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  finishDescEdit(true);
                } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  finishDescEdit(false);
                }
              }}
            />
          ) : readOnly ? (
            <p className="task-sheet-desc-text">
              {description.trim() === '' ? <span className="task-sheet-placeholder">Brak opisu</span> : description}
            </p>
          ) : (
            <button
              type="button"
              id={descReadId}
              className="task-sheet-desc-read"
              aria-label={description.trim() === '' ? 'Dodaj opis' : 'Edytuj opis'}
              onClick={startDescEdit}
            >
              <span className="task-sheet-desc-text" aria-hidden={description.trim() !== '' ? undefined : true}>
                {description.trim() === '' ? (
                  <span className="task-sheet-placeholder">Dodaj opis</span>
                ) : (
                  description
                )}
              </span>
            </button>
          )}
          {/* Utajnij treść — wyłącznie dla zarządu (reguły wglądu:
              src/store/confidentiality.ts). Reduktor i tak ignoruje pole od
              innych, więc checkbox to bramka UX, nie zabezpieczenie. */}
          {isBoard && (
            <div className="field task-sheet-confidential">
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={confidential}
                  onChange={(e) => setConfidential(e.target.checked)}
                  disabled={readOnly}
                  aria-describedby={roDesc}
                />
                <span>Utajnij treść</span>
              </label>
              <p className="field-hint">Treść zobaczy tylko zarząd i osoby przypisane.</p>
            </div>
          )}
        </section>
      )}

      {show('checklist') && (
        <section className="task-sheet-section" aria-labelledby={`${tabsBaseId}-checklist-h`}>
          <div className="task-sheet-section-head">
            <h2 id={`${tabsBaseId}-checklist-h`}>Checklista</h2>
            {/* SY-20 — jeden wzór postępu, bez czasownika. */}
            {checklist.length > 0 && (
              <span className="checklist-count">{itemsProgressLabel(checklistDone, checklist.length)}</span>
            )}
          </div>
          {checklist.length > 0 && (
            <ul className="checklist-list">
              {checklist.map((item) => (
                <li key={item.id} className={item.done ? 'checklist-row done' : 'checklist-row'}>
                  {/* AT-13 — `id` + `<label htmlFor>`: klik w treść pozycji
                      przełącza pole wyboru. Przycisk „Usuń" zostaje POZA
                      etykietą, żeby nie przełączał pozycji przy okazji. */}
                  <input
                    id={`chk-${item.id}`}
                    type="checkbox"
                    checked={item.done}
                    onChange={() => toggleChecklistItem(item.id)}
                    disabled={readOnly}
                    aria-describedby={roDesc}
                    aria-label={`Oznacz „${item.text}” jako ukończone`}
                  />
                  <label className="checklist-text" htmlFor={`chk-${item.id}`}>
                    {item.text}
                  </label>
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
        </section>
      )}

      {show('people-hours') && (
        <section className="task-sheet-section" aria-labelledby={`${tabsBaseId}-hours-h`}>
          <div className="task-sheet-section-head">
            <h2 id={`${tabsBaseId}-hours-h`}>Godziny osób</h2>
            <span className="task-sheet-section-meta">
              {isDraft ? 'szkic' : `sprzedane ${formatDuration(soldTotal)}`}
            </span>
            {show('summary') && (
              <PlanningBadge
                status={planningStatusForTotals(normalizedEstimate, plannedTotalAll, binTotal)}
              />
            )}
            {show('summary') && binTotal > 0 && (
              <HelpTip
                label="Czym jest zasobnik"
                text="Zasobnik to godziny osoby minus godziny w kalendarzu. Bloki bez terminu przeciągniesz na siatkę w widoku tygodnia kalendarza."
              />
            )}
            {show('allocation') && (
              <button
                type="button"
                id={gridButtonId}
                className="task-sheet-grid-link"
                onClick={openAllocation}
              >
                <CalendarDays size={16} aria-hidden />
                Siatka dni
              </button>
            )}
          </div>
          {assignedPeople.length === 0 ? (
            <p className="field-hint">Nikt nie jest przypisany. Dodaj osoby w kafelku „Osoby”.</p>
          ) : (
            <div className="task-hours-table-wrap">
              <table className="task-hours-table">
                <thead>
                  <tr>
                    <th scope="col">Osoba</th>
                    {isDraft ? (
                      <th scope="col">Godziny po publikacji</th>
                    ) : (
                      <>
                        <th scope="col">W kalendarzu</th>
                        <th scope="col">W zasobniku</th>
                        <th scope="col">Razem</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {hoursRows.map((row) => {
                    const person = assignedPeople.find((p) => p.id === row.id);
                    const noHours = assigneeHasNoHours(soldByPerson.get(row.id) ?? 0, row.calendar);
                    const warning = row.over
                      ? 'W kalendarzu więcej niż godziny osoby.'
                      : noHours
                        ? isDraft
                          ? 'Bez godzin, po publikacji nie trafi do zasobnika.'
                          : 'Bez godzin, zadanie nie trafi do zasobnika tej osoby.'
                        : null;
                    return (
                      <tr key={row.id} data-warn={warning ? 'true' : undefined}>
                        <th scope="row">
                          <span className="task-hours-person">
                            {person && <Avatar person={person} size={24} />}
                            <span>{row.name}</span>
                            {warning && (
                              <Tooltip text={warning}>
                                <span className="task-hours-warn" tabIndex={0} aria-label={warning}>
                                  <AlertTriangle size={14} aria-hidden />
                                </span>
                              </Tooltip>
                            )}
                          </span>
                        </th>
                        {isDraft ? (
                          <td>{formatDuration(soldByPerson.get(row.id) ?? 0)}</td>
                        ) : (
                          <>
                            <td>{formatDuration(row.calendar)}</td>
                            <td className={row.bin > 0 ? 'task-hours-bin' : 'muted'}>
                              {formatDuration(row.bin)}
                            </td>
                            <td>{formatDuration(row.total)}</td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {show('summary') && overBudget && (
            <p className="estimate-over">
              ⚠ W kalendarzu zaplanowano {formatDuration(plannedTotalAll - soldTotal)} ponad godziny
              przypisane osobom. Zwiększ godziny osób lub ogranicz siatkę.
            </p>
          )}
        </section>
      )}

      {show('done-blocks') && (
        <div className="task-sheet-section task-sheet-collapsible">
          {/* IA-08 — sekcja jest ZWINIĘTA: ✓ na kafelku kalendarza jest szybszą
              drogą do tej samej akcji `SET_BLOCK_DONE`. Wejście z konkretnego
              bloku (`?task=<id>&block=<id>`) rozwija ją SAMO. */}
          {collapseToggle(
            'Wykonane bloki',
            doneBlocksOpen,
            doneBlocksBodyId,
            () => setDoneBlocksOpen((v) => !v),
            blocksProgressLabel(blocksDoneCount, taskBlocks.length),
          )}
          <div id={doneBlocksBodyId} className="section-collapse-body" hidden={!doneBlocksOpen}>
            <p className="field-hint">
              {existing?.recurrence !== undefined
                ? 'Każdy blok w kalendarzu można oznaczyć jako wykonany niezależnie. Status całej serii cyklicznej zmieniasz ręcznie.'
                : 'Każdy blok w kalendarzu można oznaczyć jako wykonany niezależnie. Gdy wykonasz ostatni i nic nie zostaje do zrobienia, zadanie samo przejdzie na „Gotowe”.'}
            </p>
            <ul className="checklist-list block-done-list">
              {taskBlocks.map((entry) => {
                const focused = focusBlockId === entry.id;
                return (
                  <li
                    key={entry.id}
                    ref={focused ? focusRowRef : undefined}
                    className={['checklist-row', entry.done === true ? 'done' : '', focused ? 'focused' : '']
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <input
                      id={`blk-${entry.id}`}
                      type="checkbox"
                      checked={entry.done === true}
                      onChange={() =>
                        dispatch({
                          type: 'SET_BLOCK_DONE',
                          entryId: entry.id,
                          done: !(entry.done === true),
                        })
                      }
                      disabled={readOnly}
                      aria-describedby={roDesc}
                      aria-label={`Oznacz blok „${blockRowLabel(entry)}” jako wykonany`}
                    />
                    <label className="checklist-text" htmlFor={`blk-${entry.id}`}>
                      {blockRowLabel(entry)}
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      {show('recurrence') && (
        <div className="task-sheet-section task-sheet-collapsible">
          {/* Cykliczność — ZWINIĘTY wiersz. Wystąpienia są wyłącznie podglądem
              (invariant 1); sekcja dispatchuje SET_TASK_RECURRENCE /
              SET_RECURRENCE_OVERRIDE i NIGDY nie rusza draftu SAVE_TASK ani
              auto-zapisu. Samo zwinięcie niczego nie wysyła. */}
          {collapseToggle(
            'Powtarzanie',
            recurOpen,
            recurBodyId,
            () => setRecurOpen((v) => !v),
            liveRule ? 'włączone' : 'wyłączone',
          )}
          <div id={recurBodyId} className="section-collapse-body" hidden={!recurOpen}>
            {!isValidDateStr(startDate) ? (
              <p className="field-hint">Ustaw datę rozpoczęcia, aby dodać cykliczność.</p>
            ) : (
              <>
                <p className="field-hint">
                  Wystąpienia są tylko podglądem w kalendarzu. Nie tworzą zaplanowanych
                  godzin ani nie wpływają na sumy i przeciążenie.
                </p>
                <div className="field">
                  <label>Dni tygodnia</label>
                  <div className="recur-weekday-picker">
                    {WEEKDAY_LABELS.map((label, i) => {
                      const iso = i + 1;
                      const active = recurDays.includes(iso);
                      return (
                        <button
                          key={iso}
                          type="button"
                          className={active ? 'recur-day-chip active' : 'recur-day-chip'}
                          aria-pressed={active}
                          disabled={readOnly}
                          aria-describedby={roDesc}
                          onClick={() => toggleRecurDay(iso)}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="recur-interval">Powtarzaj</label>
                  <select
                    id="recur-interval"
                    value={recurInterval}
                    onChange={(e) => {
                      recurEdited();
                      setRecurInterval(Number(e.target.value));
                    }}
                    disabled={readOnly}
                    aria-describedby={roDesc}
                  >
                    {INTERVAL_WEEKS_OPTIONS.map((weeks) => (
                      <option key={weeks} value={weeks}>
                        {intervalWeeksLabel(weeks)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field-row">
                  <div className="field">
                    <label htmlFor="recur-start">Początek</label>
                    <input
                      id="recur-start"
                      type="time"
                      step={900}
                      value={recurStart}
                      onChange={(e) => {
                        recurEdited();
                        setRecurStart(e.target.value);
                      }}
                      disabled={readOnly}
                      aria-describedby={roDesc}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="recur-dur">Czas trwania</label>
                    <select
                      id="recur-dur"
                      value={recurDurMin}
                      onChange={(e) => {
                        recurEdited();
                        setRecurDurMin(Number(e.target.value));
                      }}
                      disabled={readOnly}
                      aria-describedby={roDesc}
                    >
                      {RECUR_DURATION_OPTIONS.map((min) => (
                        <option key={min} value={min}>
                          {formatDuration(min / 60)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="recur-until">Do dnia (opcjonalnie)</label>
                    <input
                      id="recur-until"
                      type="date"
                      value={recurUntil}
                      min={startDate}
                      onChange={(e) => {
                        recurEdited();
                        setRecurUntil(e.target.value);
                      }}
                      disabled={readOnly}
                      aria-describedby={roDesc}
                    />
                  </div>
                </div>
                {recurTouched && recurApplyError && <p className="field-error">{recurApplyError}</p>}
                {!readOnly && (
                  <div className="recur-actions">
                    {/* Nietknięta sekcja nie pokazuje czerwonego błędu, więc powód
                        wyłączenia przycisku niesie dymek + ukryty opis (AT-07). */}
                    <DisabledHint reason={recurApplyError} id="task-recur-blocked">
                      <button
                        type="button"
                        className="btn primary"
                        onClick={applyRecurrence}
                        disabled={recurApplyError !== null}
                      >
                        Zastosuj cykliczność
                      </button>
                    </DisabledHint>
                    {liveRule && (
                      <button type="button" className="btn danger-ghost" onClick={clearRecurrence}>
                        Usuń cykliczność
                      </button>
                    )}
                  </div>
                )}
                {liveRule && (liveRule.overrides?.length ?? 0) > 0 && (
                  <div className="recur-overrides">
                    <p className="field-hint">Wyjątki:</p>
                    <ul className="recur-override-list">
                      {liveRule.overrides!.map((ov) => (
                        <li key={ov.date} className="recur-override-row">
                          <span className="recur-override-text">
                            {/* Trzy warianty wyjątku: pominięcie, samo wykonanie
                                (czasy z reguły) oraz przesunięcie czasu z
                                ewentualnym sufiksem wykonania. */}
                            {ov.skip === true
                              ? `${recurDateLabel(ov.date)}: pominięto`
                              : ov.startMinutes === undefined
                                ? `${recurDateLabel(ov.date)}: zrobione`
                                : `${recurDateLabel(ov.date)}: ${formatMinutes(
                                    ov.startMinutes,
                                  )}, ${formatDuration((ov.durationMinutes ?? 0) / 60)}${
                                    ov.done === true ? ' · zrobione' : ''
                                  }`}
                          </span>
                          {!readOnly && (
                            <button
                              type="button"
                              className="btn ghost"
                              onClick={() => restoreOverride(ov.date)}
                            >
                              Przywróć zgodnie z regułą
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );

  const allocationSubview = (
    <div className="task-sheet-subview" onKeyDown={escapeCancels(() => closeAllocation())}>
      <div className="task-sheet-subview-head">
        <button
          type="button"
          id={`${tabsBaseId}-grid-back`}
          className="btn ghost task-sheet-back"
          onClick={closeAllocation}
        >
          <ArrowLeft size={16} aria-hidden />
          Wróć do szczegółów
        </button>
        <h2>Siatka dni</h2>
      </div>
      {allocationContent}
    </div>
  );

  // Stopka: TYLKO tryb tworzenia i szkic (jawne „Utwórz”/„Opublikuj”) oraz
  // lista powodów blokujących zapis. Edycja zapisuje się sama, więc bez
  // „Gotowe / Zamknij” (zamknięcie jest w nagłówku).
  const blockersVisible = !readOnly && blockers.length > 0 && (saveAttempted || (isEdit && dirty));
  const showFooter = !readOnly && (blockersVisible || !isEdit || isDraft);
  const footer = showFooter ? (
    <div className="editor-actions editor-actions-sticky task-sheet-footer">
      {/* IA-12 — powody, przez które zapis nie przejdzie, stoją PRZY przyciskach.
          Każdy powód z kotwicą jest klikalny i otwiera swój edytor. */}
      {blockersVisible && (
        <div className="save-blockers" role="alert">
          {/* JEDYNY `role="alert"` w karcie: liczone podsumowanie („popraw 2
              pola: Tytuł, Okres."). Etykiety idą z `SaveBlocker.fieldLabel`. */}
          <p className="save-blockers-title">
            {saveErrorSummary(
              'Nie można zapisać zadania',
              blockers.map((b) => b.fieldLabel).filter((label): label is string => label !== null),
            )}
          </p>
          <ul className="save-blockers-list">
            {blockers.map((b) => (
              <li key={b.id}>
                {b.focusId === null ? (
                  b.message
                ) : (
                  <button type="button" className="link-btn" onClick={() => jumpToBlocker(b)}>
                    {b.message}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {isDraft ? (
        <>
          {/* Szkic: rozdzielone akcje — zapis szkicu vs publikacja. */}
          <DisabledHint reason={noProjectReason} id="task-no-project-draft">
            <button
              type="button"
              className="btn"
              onClick={handleSave}
              disabled={state.projects.length === 0}
            >
              {isEdit ? 'Zapisz szkic' : 'Utwórz szkic'}
            </button>
          </DisabledHint>
          <DisabledHint reason={noProjectReason} id="task-no-project-publish">
            <button
              type="button"
              className="btn primary"
              onClick={isEdit ? handlePublishExisting : handleCreateAndPublish}
              disabled={state.projects.length === 0}
            >
              {isEdit ? 'Opublikuj' : 'Utwórz i opublikuj'}
            </button>
          </DisabledHint>
        </>
      ) : (
        !isEdit && (
          <DisabledHint reason={noProjectReason} id="task-no-project-save">
            <button
              type="button"
              className="btn primary"
              onClick={handleSave}
              disabled={state.projects.length === 0}
            >
              Utwórz zadanie
            </button>
          </DisabledHint>
        )
      )}
      {!isEdit && (
        <button type="button" className="btn ghost" onClick={onCancel}>
          {dirty ? 'Anuluj' : 'Zamknij'}
        </button>
      )}
    </div>
  ) : null;

  const conversationAvailable = existing !== undefined && !isDraft && show('discussion');
  const conversationEmptyText = contentMasked
    ? 'Rozmowa jest ukryta, bo treść zadania jest utajniona.'
    : isEdit && isDraft
      ? 'Rozmowa pojawi się po opublikowaniu zadania'
      : 'Rozmowa pojawi się po utworzeniu zadania';
  const PANES = ['details', 'conversation'] as const;
  const paneTabId = (pane: (typeof PANES)[number]) => `${tabsBaseId}-pane-tab-${pane}`;
  const onPaneKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const next = resolveTabNavKey(event.key, PANES.indexOf(mobilePane), PANES.length);
    if (next === null) return;
    event.preventDefault();
    // Zaznaczenie PODĄŻA ZA FOKUSEM (wzorzec poziomego tablisty).
    setMobilePane(PANES[next]);
    focusAfterCommit(paneTabId(PANES[next]));
  };

  return (
    <div className="editor task-editor task-sheet">
      {readOnly && (
        <span id={roDescId} className="sr-only">
          {roReason}
        </span>
      )}
      <header className="task-sheet-head">
        <nav className="task-sheet-crumbs" aria-label="Klient i projekt">
          {showClientCrumb && (
            <>
              <Tooltip text={readOnly ? (roReason ?? '') : ''}>
                <button
                  type="button"
                  id={crumbDomId('client')}
                  className="task-sheet-crumb"
                  aria-expanded={readOnly ? undefined : crumbsOpen}
                  aria-controls={readOnly ? undefined : crumbsEditorId}
                  aria-disabled={readOnly || undefined}
                  aria-label={`Klient: ${pickedClientName ?? 'Bez klienta'}`}
                  onClick={() => {
                    if (!readOnly) toggleCrumbs('client');
                  }}
                >
                  <Building2 size={14} aria-hidden />
                  <span className="task-sheet-crumb-text">{pickedClientName ?? 'Bez klienta'}</span>
                </button>
              </Tooltip>
              <ChevronRight size={14} className="task-sheet-crumb-sep" aria-hidden />
            </>
          )}
          <Tooltip text={readOnly ? (roReason ?? '') : ''}>
            <button
              type="button"
              id={crumbDomId('project')}
              className="task-sheet-crumb"
              data-invalid={showError('project') ? 'true' : undefined}
              aria-expanded={readOnly ? undefined : crumbsOpen}
              aria-controls={readOnly ? undefined : crumbsEditorId}
              aria-disabled={readOnly || undefined}
              aria-label={`Projekt: ${pickedProject?.name ?? 'nie wybrano'}`}
              onClick={() => {
                if (!readOnly) toggleCrumbs('project');
              }}
            >
              <Folder size={14} aria-hidden />
              <span className="task-sheet-crumb-text">{pickedProject?.name ?? 'Wybierz projekt'}</span>
            </button>
          </Tooltip>
        </nav>
        <div className="task-sheet-head-actions">{headerActions}</div>
      </header>
      {!crumbsOpen && showError('project') && state.projects.length > 0 && (
        <p className="field-error task-sheet-crumb-error">Wybierz projekt dla tego zadania.</p>
      )}
      {crumbsOpen && (
        <div
          id={crumbsEditorId}
          className="task-sheet-crumbs-editor"
          role="group"
          aria-label="Edycja: klient i projekt"
          onKeyDown={escapeCancels(closeCrumbs)}
        >
          <div className="field-row">
            {showClientCrumb && (
              <Field id="t-client" label="Klient">
                {(control) => (
                  <select
                    {...control}
                    value={pickedClientId}
                    onChange={(e) => changePickedClient(e.target.value)}
                    disabled={readOnly}
                    aria-describedby={roDescWith(control)}
                  >
                    {clientOptions.map((c) => (
                      <option key={c.id || 'bez-klienta'} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            )}
            <Field
              id="t-project"
              label="Projekt *"
              // Pusta baza projektów ma własną podpowiedź („najpierw utwórz
              // projekt"), więc inline'owy błąd wyboru jej nie dubluje.
              error={
                showError('project') && state.projects.length > 0 && clientProjects.length > 0
                  ? 'Wybierz projekt dla tego zadania.'
                  : undefined
              }
            >
              {(control) =>
                state.projects.length === 0 ? (
                  <p className="field-hint">
                    Nie ma jeszcze projektów. Najpierw <Link to="/projects">utwórz projekt</Link>.
                    Każde zadanie musi należeć do projektu.
                  </p>
                ) : clientProjects.length === 0 ? (
                  <p className="field-hint">
                    Ten klient nie ma jeszcze projektów. Wybierz innego klienta albo{' '}
                    <Link to="/projects">utwórz projekt</Link>.
                  </p>
                ) : (
                  <select
                    {...control}
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                    onBlur={() => markTouched('project')}
                    disabled={readOnly}
                    aria-describedby={roDescWith(control)}
                  >
                    {clientProjects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                )
              }
            </Field>
          </div>
          <div className="task-tile-editor-head task-sheet-crumbs-actions">
            <span className="task-tile-editor-hint">Escape cofa zmiany</span>
            <button type="button" className="btn ghost" onClick={() => closeCrumbs(false)}>
              Zwiń
            </button>
          </div>
        </div>
      )}
      {isMobileNav && (
        <div className="task-sheet-segmented" role="tablist" aria-label="Widok karty zadania">
          {PANES.map((pane) => (
            <button
              key={pane}
              type="button"
              role="tab"
              id={paneTabId(pane)}
              aria-selected={mobilePane === pane}
              aria-controls={pane === 'details' ? detailsPaneId : conversationPaneId}
              tabIndex={mobilePane === pane ? 0 : -1}
              className="task-sheet-segment"
              onClick={() => setMobilePane(pane)}
              onKeyDown={onPaneKeyDown}
            >
              {pane === 'details' ? 'Szczegóły' : 'Rozmowa'}
            </button>
          ))}
        </div>
      )}
      <div className="task-sheet-split">
        <div
          id={detailsPaneId}
          className="task-sheet-main"
          hidden={isMobileNav && mobilePane !== 'details'}
          {...(isMobileNav ? { role: 'tabpanel', 'aria-labelledby': paneTabId('details') } : {})}
        >
          {/* Utajniona treść bez wglądu: bursztynowa (nie czerwona — to
              informacja, nie błąd) plansza nad sekcjami; niżej zostają
              wyłącznie fakty planistyczne z modelu sekcji (`contentMasked`). */}
          {contentMasked && (
            <p className="confidential-notice" role="note">
              Treść zadania utajniona. Widoczne są tylko dane planowania: terminy, godziny i osoby.
            </p>
          )}
          {/* Formularz obejmuje szczegóły i podwidok siatki. Rozmowa (prawy
              panel) jest jego SIOSTRĄ: ma własny `<form>`, a zagnieżdżenie
              jest nielegalne w HTML i wysłanie wiadomości zapisywałoby zadanie. */}
          <form
            className="task-editor-form"
            onSubmit={(e) => {
              e.preventDefault();
              // Edycja opublikowanego zadania zapisuje się sama, więc Enter w
              // polu tylko zapisuje TERAZ (ten sam `doSave`) i zwija edytor
              // kafelka, zamiast zamykać kartę. Tworzenie i szkic bez zmian.
              if (isEdit && !isDraft) {
                if (doSave()) closeTile(false);
                return;
              }
              handleSave();
            }}
            noValidate
          >
            {allocationView && show('allocation') ? allocationSubview : details}
            {/* Domyślny przycisk formularza. Bez niego Enter w polu tekstowym
                NIE wysyła formularza z wieloma polami (implicit submission). */}
            {!readOnly && (
              <button type="submit" hidden aria-hidden tabIndex={-1}>
                Zapisz zadanie
              </button>
            )}
          </form>
          {footer}
        </div>
        <div
          id={conversationPaneId}
          className="task-sheet-side"
          hidden={isMobileNav && mobilePane !== 'conversation'}
          {...(isMobileNav
            ? { role: 'tabpanel', 'aria-labelledby': paneTabId('conversation') }
            : {})}
        >
          {conversationAvailable && existing ? (
            <TaskConversationPane taskId={existing.id} />
          ) : (
            <TaskConversationEmpty text={conversationEmptyText} />
          )}
        </div>
      </div>
    </div>
  );
}
