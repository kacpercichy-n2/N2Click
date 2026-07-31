// Task popout modal. Opening a task never leaves the current page — it renders
// as an overlay driven by the `?task=<id>` (or `?task=new[&project=<id>]`)
// search params. Rendered ONCE at App level. Closing removes the task/project
// params while keeping the rest of the URL (and the page's scroll) intact.
import {
  Fragment,
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
import { X } from './icons';
import { CommentsPanel } from './CommentsPanel';
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
  initialTab,
  opensAtTop,
  resolveTabNavKey,
  visibleSections,
  visibleTabs,
  type SectionFlags,
  type TaskModalSectionId,
  type TaskModalTab,
  type TaskModalTabId,
} from './taskModalSections';
import { Field, focusFieldById } from './Field';
import type { FieldControlProps } from './Field';
import { mergeDescribedBy } from './tooltipShell';
import { DisabledHint } from './Tooltip';
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
  // Skok do przyczyny musi najpierw przełączyć zakładkę edytora (kotwice pól
  // żyją w panelu „Zadanie"), więc handler przychodzi Z edytora razem z listą.
  // Nagłówek nie zna stanu zakładek i znać go nie musi.
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

  const heading = notFound ? 'Nie znaleziono zadania' : isNew ? 'Nowe zadanie' : 'Edytuj zadanie';

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
          className="task-modal-card"
          {...cardProps}
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="task-modal-head">
            <h1 className="task-modal-title" id={titleId}>
              {heading}
            </h1>
            <div className="task-modal-head-actions">
              {!notFound && (
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
              )}
              {/* IA-15 — wyjście z ciasnego modala do pełnej strony zadania.
                  Zwykły `<Link>`: nawigacja zmienia ŚCIEŻKĘ, więc parametr
                  `?task=` znika sam, a przy niezapisanych zmianach pyta
                  strażnik routera (zakres `task-modal`). */}
              {existing && (
                <Link className="link-btn" to={taskFullViewPath(existing.id)}>
                  Otwórz pełny widok ↗
                </Link>
              )}
              {/* AT-08 — akcja niszcząca zeszła z nagłówka do menu „⋯": czerwony
                  przycisk stał tuż obok „Zamknij" i był pierwszą rzeczą, w którą
                  wpadało oko. Sam przepływ potwierdzenia (skutki + `requireAck`)
                  jest BEZ ZMIAN. */}
              {existing && canManageTasks && (
                <OverflowMenu
                  label="Więcej działań"
                  items={[
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
            </div>
          </div>
          <div className="task-modal-body" ref={bodyRef}>
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
                initialDate={dateParam ?? undefined}
                initialPersonId={assigneeParam ?? undefined}
                focusBlockId={blockParam ?? undefined}
                onSaved={onClose}
                onCancel={requestClose}
                onDirtyChange={handleDirtyChange}
                onBlockersChange={handleBlockersChange}
                markSaved={markSaved}
              />
            )}
          </div>
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
  const readOnly = !canManage;
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
  const [departmentId, setDepartmentId] = useState<string>(existing?.departmentId ?? '');
  const [checklist, setChecklist] = useState<ChecklistItem[]>(existing?.checklist ?? []);
  const [checklistInput, setChecklistInput] = useState('');

  // ---- Zakładki + sekcje zwijane (PKG-20260728-taskmodal-structure) ----
  // Kolejność i widoczność sekcji liczy CZYSTY `taskModalSections.ts`; tutaj
  // zostaje wyłącznie stan wyboru zakładki i dwa przełączniki zwijania.
  const [activeTab, setActiveTab] = useState<TaskModalTabId>(() =>
    initialTab({ hasFocusBlock: Boolean(focusBlockId), isEdit: Boolean(existing) }),
  );
  // Cykliczność rozwija się sama tylko wtedy, gdy zadanie NAPRAWDĘ ma regułę.
  const [recurOpen, setRecurOpen] = useState(() => existing?.recurrence != null);
  // Klasyfikacja rozwija się, gdy któraś wartość jest ustawiona.
  const [classificationOpen, setClassificationOpen] = useState(
    () => (existing?.workCategoryId ?? '') !== '' || (existing?.departmentId ?? '') !== '',
  );
  // IA-08 — „Wykonane bloki" startuje zwinięte; wejście z konkretnego bloku
  // (`?task=<id>&block=<id>`) rozwija sekcję, bo inaczej podświetlany wiersz
  // byłby ukryty i `scrollIntoView` nie miałoby do czego skoczyć.
  const [doneBlocksOpen, setDoneBlocksOpen] = useState(() => Boolean(focusBlockId));
  const tabsBaseId = useId();
  const tabDomId = (id: TaskModalTabId) => `${tabsBaseId}-tab-${id}`;
  const panelDomId = (id: TaskModalTabId) => `${tabsBaseId}-panel-${id}`;
  const recurBodyId = `${tabsBaseId}-recur-body`;
  const classificationBodyId = `${tabsBaseId}-classification-body`;
  const doneBlocksBodyId = `${tabsBaseId}-done-blocks-body`;
  const tabRefs = useRef<Partial<Record<TaskModalTabId, HTMLButtonElement | null>>>({});
  // Skok z listy blokad zapisu: WSZYSTKIE kotwice pól (`t-title`…`t-assignees`)
  // mieszkają w panelu „Zadanie", a ukryty panel nie przyjmuje fokusa — więc
  // najpierw przełączamy zakładkę, a fokus ustawiamy po commicie Reacta.
  const jumpToBlocker = useCallback((blocker: SaveBlocker) => {
    setActiveTab('zadanie');
    setTimeout(() => focusSaveBlocker(blocker), 0);
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
  // single entry — the task status is never touched.
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

  // ---- Model sekcji/zakładek — JEDYNE źródło kolejności i widoczności ----
  const commentCount = existing ? commentsFor(state, 'task', existing.id).length : 0;
  const sectionFlags: SectionFlags = {
    isEdit,
    isDraft,
    hasValidPeriod: periodValid,
    hasAssignees: assignedPeople.length > 0,
    hasBlocks: taskBlocks.length > 0,
    commentCount,
  };
  const sections = visibleSections(sectionFlags);
  const tabs = visibleTabs(sectionFlags);
  // Zakładka mogła zniknąć w trakcie edycji (np. okres przestał być poprawny w
  // trybie tworzenia) — wtedy widok wraca na „Zadanie" bez efektu i bez skoku
  // stanu (`activeTab` zostaje, więc powrót poprawnego okresu go przywraca).
  const currentTab: TaskModalTabId = tabs.some((t) => t.id === activeTab) ? activeTab : 'zadanie';
  const showTabs = tabs.length > 1;

  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const next = resolveTabNavKey(
      event.key,
      tabs.findIndex((t) => t.id === currentTab),
      tabs.length,
    );
    if (next === null) return;
    event.preventDefault();
    // Zaznaczenie PODĄŻA ZA FOKUSEM (wzorzec poziomego tablisty).
    setActiveTab(tabs[next].id);
    tabRefs.current[tabs[next].id]?.focus();
  };

  /** Wspólny nagłówek sekcji zwijanej — `aria-expanded` + `aria-controls`. */
  const collapseToggle = (label: string, open: boolean, bodyId: string, onToggle: () => void) => (
    <button
      type="button"
      className="section-toggle"
      aria-expanded={open}
      aria-controls={bodyId}
      onClick={onToggle}
    >
      <span className="section-toggle-label">{label}</span>
      <span className="section-toggle-mark" aria-hidden>
        {open ? '−' : '+'}
      </span>
    </button>
  );

  // Treść każdej sekcji. Kolejność i widoczność NIE żyją tutaj — bierze je
  // `visibleSections` — więc dopisanie sekcji to jeden wpis w czystym modelu.
  const sectionContent: Record<TaskModalSectionId, ReactNode> = {
    // 1) Kontekst — przyklejona głowa: co, gdzie, w jakim stanie.
    context: (
      <div className="task-context-header">
        <Field
          id="t-title"
          label="Tytuł *"
          error={showError('title') ? 'Tytuł jest wymagany' : undefined}
        >
          {(control) => (
            <input
              {...control}
              data-autofocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => markTouched('title')}
              className={showError('title') ? 'invalid' : undefined}
              placeholder="Co trzeba zrobić?"
              disabled={readOnly}
              aria-describedby={roDescWith(control)}
            />
          )}
        </Field>
        <div className="field-row">
          {state.projects.length > 0 && state.clients.length > 0 && (
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
                  Nie ma jeszcze projektów — najpierw <Link to="/projects">utwórz projekt</Link>.
                  Każde zadanie musi należeć do projektu.
                </p>
              ) : clientProjects.length === 0 ? (
                <p className="field-hint">
                  Ten klient nie ma jeszcze projektów — wybierz innego klienta albo{' '}
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
        </div>
      </div>
    ),

    // 2) Szczegóły — opis i priorytet (kategoria/dział przeniosły się do
    //    zwijanej „Klasyfikacji").
    details: (
      <div className="editor-section">
        <h2>Szczegóły</h2>
        <Field id="t-desc" label="Opis">
          {(control) => (
            <textarea
              {...control}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Opcjonalne szczegóły"
              disabled={readOnly}
              aria-describedby={roDescWith(control)}
            />
          )}
        </Field>
        <div className="field-row">
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
        </div>
      </div>
    ),

    // 3) Okres — NAD godzinami: najpierw „kiedy", potem „ile".
    period: (
      <div className="editor-section">
        <h2>Okres</h2>
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
        {periodValid && (
          <p className="field-hint">
            Liczba dni w okresie: {periodDays}.
          </p>
        )}
      </div>
    ),

    // 4) Osoby i ich godziny (sprzedane) + informacyjna dostępność.
    'people-hours': (
      <div className="editor-section">
        <h2>Przypisane osoby</h2>
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
                <label
                  key={p.id}
                  className={checked ? 'assignee-chip checked' : 'assignee-chip'}
                >
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
          <div className="sold-hours">
            <p className="field-hint">
              {isDraft
                ? 'Edytujesz godziny każdej osoby na tym szkicu (sprzedane). Zapisują się ze szkicem, a po publikacji trafią do zasobnika osoby. Szacunek zadania to ich suma — wylicza się sam.'
                : 'Edytujesz godziny każdej osoby na tym zadaniu (sprzedane). Szacunek zadania to ich suma — wylicza się sam, nie ma osobnego pola. Część niezaplanowana w kalendarzu trafia automatycznie do zasobnika osoby.'}
            </p>
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
              Szacunek zadania (suma godzin osób):{' '}
              <strong>{formatDuration(soldTotal)}</strong>{' '}
              <span className="muted">— wyliczany</span>
            </div>
            {/* Panel dostępności (informacyjny) — dostępne vs zajęte w okresie
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
          </div>
        )}
        {isDraft && (
          <p className="field-hint task-draft-hint">
            <strong>Szkic.</strong> Godziny osób zapisują się ze szkicem i po
            publikacji trafią do zasobnika. Zadanie pozostaje szkicem, dopóki go
            nie opublikujesz.
          </p>
        )}
      </div>
    ),

    // 5) Scalony pasek podsumowania planowania. Zastąpił osobną sekcję
    //    „Zasobnik (bez terminu)": liczby per osoba stoją w wierszach wyżej
    //    („w kalendarzu X • zasobnik Y"), więc nic nie ginie.
    summary: (
      <div className="editor-section editor-section-summary">
        <div className="estimate-compare">
          <span>
            w kalendarzu{' '}
            <strong className={overBudget ? 'over-budget' : undefined}>
              {formatDuration(plannedTotalAll)}
            </strong>
          </span>
          <span className="muted" aria-hidden>
            ·
          </span>
          <span>
            zasobnik <strong>{formatDuration(binTotal)}</strong>
          </span>
          <span className="muted" aria-hidden>
            ·
          </span>
          <span>
            sprzedane <strong>{formatDuration(soldTotal)}</strong>
          </span>
          <PlanningBadge
            status={planningStatusForTotals(normalizedEstimate, plannedTotalAll, binTotal)}
          />
        </div>
        {binTotal > 0 && (
          <p className="field-hint">
            Zasobnik = godziny osoby minus godziny w kalendarzu. Bloki bez terminu
            przeciągniesz na siatkę w widoku tygodnia kalendarza.
          </p>
        )}
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
      </div>
    ),

    // 6) Checklista — „jak sprawdzę, że zrobione".
    checklist: (
      <div className="editor-section">
        <h2>Checklista</h2>
        {/* SY-20 — jeden wzór postępu, bez czasownika. */}
        {checklist.length > 0 && (
          <p className="checklist-count">{itemsProgressLabel(checklistDone, checklist.length)}</p>
        )}
        {checklist.length > 0 && (
          <ul className="checklist-list">
            {checklist.map((item) => (
              <li key={item.id} className={item.done ? 'checklist-row done' : 'checklist-row'}>
                {/* AT-13 — `id` + `<label htmlFor>`: klik w treść pozycji
                    przełącza pole wyboru, więc cel trafienia to cały tekst, a
                    nie 20-pikselowy kwadrat. Przycisk „Usuń" zostaje POZA
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
      </div>
    ),

    // 7) Cykliczność — ZWINIĘTA za przełącznikiem. Wystąpienia są wyłącznie
    //    podglądem (invariant 1); sekcja dispatchuje SET_TASK_RECURRENCE /
    //    SET_RECURRENCE_OVERRIDE i NIGDY nie rusza draftu SAVE_TASK ani
    //    auto-zapisu. Samo zwinięcie niczego nie wysyła — „Usuń cykliczność"
    //    zostaje jedyną drogą kasowania reguły.
    recurrence: (
      <div className="editor-section editor-section-collapsible">
        {collapseToggle('Powtarzaj to zadanie', recurOpen, recurBodyId, () =>
          setRecurOpen((v) => !v),
        )}
        <div id={recurBodyId} className="section-collapse-body" hidden={!recurOpen}>
          {!isValidDateStr(startDate) ? (
            <p className="field-hint">Ustaw datę rozpoczęcia, aby dodać cykliczność.</p>
          ) : (
            <>
              <p className="field-hint">
                Wystąpienia są tylko podglądem w kalendarzu — nie tworzą zaplanowanych
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
              {recurTouched && recurApplyError && (
                <p className="field-error">{recurApplyError}</p>
              )}
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
                              (czasy z reguły — bez artefaktu „00:00, 0 h") oraz
                              przesunięcie czasu z ewentualnym sufiksem wykonania. */}
                          {ov.skip === true
                            ? `${recurDateLabel(ov.date)} — pominięto`
                            : ov.startMinutes === undefined
                              ? `${recurDateLabel(ov.date)} — zrobione`
                              : `${recurDateLabel(ov.date)} — ${formatMinutes(
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
    ),

    // 8) Klasyfikacja — ZWINIĘTA: kategoria + dział (dawniej w „Szczegółach").
    classification: (
      <div className="editor-section editor-section-collapsible">
        {collapseToggle('Klasyfikacja', classificationOpen, classificationBodyId, () =>
          setClassificationOpen((v) => !v),
        )}
        <div
          id={classificationBodyId}
          className="section-collapse-body"
          hidden={!classificationOpen}
        >
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
        </div>
      </div>
    ),

    // 9) Dzienny przydział godzin (zakładka „Planowanie").
    allocation: (
      <div className="editor-section">
        <h2>Dzienny przydział godzin</h2>
        {/* Podpowiedź dotyczy pola godziny startu, a siatka pokazuje je tylko w
            trybie edycji — w podglądzie bez uprawnień byłaby myląca. */}
        {!readOnly && (
          <p className="field-hint" id={startHintId}>
            Godzina startu jest opcjonalna — puste pole planuje blok w pierwszym wolnym oknie dnia.
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
      </div>
    ),

    // 10) Wykonane bloki — per-block completion (PKG-per-block-done). One row
    //     per WorkloadEntry (NOT per day): each block's portion of hours has its
    //     own tick. Toggling a block dispatches SET_BLOCK_DONE and NEVER changes
    //     the task status.
    'done-blocks': (
      <div className="editor-section editor-section-collapsible">
        {/* IA-08 — sekcja jest ZWINIĘTA: ✓ na kafelku kalendarza jest szybszą
            drogą do tej samej akcji `SET_BLOCK_DONE`. Wejście z konkretnego
            bloku (`?task=<id>&block=<id>`) rozwija ją SAMO, bo inaczej nie dałoby
            się przewinąć do podświetlanego wiersza. */}
        {collapseToggle(
          `Wykonane bloki (${blocksProgressLabel(blocksDoneCount, taskBlocks.length)})`,
          doneBlocksOpen,
          doneBlocksBodyId,
          () => setDoneBlocksOpen((v) => !v),
        )}
        <div id={doneBlocksBodyId} className="section-collapse-body" hidden={!doneBlocksOpen}>
        <p className="field-hint">
          Każdy blok w kalendarzu można oznaczyć jako wykonany niezależnie — status
          zadania pozostaje bez zmian.
        </p>
        <ul className="checklist-list block-done-list">
          {taskBlocks.map((entry) => {
            const focused = focusBlockId === entry.id;
            return (
              <li
                key={entry.id}
                ref={focused ? focusRowRef : undefined}
                className={[
                  'checklist-row',
                  entry.done === true ? 'done' : '',
                  focused ? 'focused' : '',
                ]
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
    ),

    // 11) Dyskusja — POZA formularzem zadania (CommentsPanel ma własny `<form>`).
    //     `existing` to strażnik TYPU (widoczność liczy model: `isEdit`).
    discussion: existing ? (
      <div className="editor-section">
        <CommentsPanel entityType="task" entityId={existing.id} />
      </div>
    ) : null,
  };

  /** Panel zakładki. Sekcje idą WYŁĄCZNIE z modelu — bez własnej kolejności. */
  const renderPanel = (tab: TaskModalTab) => (
    <div
      key={tab.id}
      className={`task-tabpanel task-tabpanel-${tab.id}`}
      hidden={currentTab !== tab.id}
      {...(showTabs
        ? { role: 'tabpanel', id: panelDomId(tab.id), 'aria-labelledby': tabDomId(tab.id) }
        : {})}
    >
      {sections
        .filter((section) => section.tab === tab.id)
        .map((section) => (
          <Fragment key={section.id}>{sectionContent[section.id]}</Fragment>
        ))}
    </div>
  );

  return (
    <div className="editor task-editor">
      {readOnly && (
        <span id={roDescId} className="sr-only">
          {NO_PERM_TITLE} do edycji zadań.
        </span>
      )}
      {/* Pasek zakładek renderuje się DOPIERO przy drugiej widocznej zakładce —
          nowe zadanie bez okresu ma jedną i nie pokazuje pustego przełącznika.
          Zaznaczenie podąża za fokusem (`resolveTabNavKey`). */}
      {showTabs && (
        <div className="task-editor-tabs" role="tablist" aria-label="Sekcje zadania">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={tabDomId(tab.id)}
              ref={(el) => {
                tabRefs.current[tab.id] = el;
              }}
              className={
                tab.id === currentTab ? 'task-editor-tab active' : 'task-editor-tab'
              }
              aria-selected={tab.id === currentTab}
              aria-controls={panelDomId(tab.id)}
              tabIndex={tab.id === currentTab ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={onTabKeyDown}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}
      {/* Formularz obejmuje panele „Zadanie" i „Planowanie". „Dyskusja" i sticky
          pasek akcji zostają POZA nim: CommentsPanel ma własny `<form>`
          (zagnieżdżenie jest nielegalne w HTML i „Skomentuj" zapisywałoby
          zadanie). */}
      <form
        className="task-editor-form"
        onSubmit={(e) => {
          e.preventDefault();
          handleSave();
        }}
        noValidate
      >
        {tabs.filter((tab) => tab.id !== 'dyskusja').map(renderPanel)}

        {/* Domyślny przycisk formularza. Bez niego Enter w polu tekstowym NIE
            wysyła formularza z wieloma polami (HTML: implicit submission wymaga
            przycisku wysyłki). Ukryty — prawdziwe akcje stoją w sticky stopce
            POZA formularzem, żeby nie zagnieżdżać ich w nim. */}
        {!readOnly && (
          <button type="submit" hidden aria-hidden tabIndex={-1}>
            Zapisz zadanie
          </button>
        )}
      </form>

      {/* Dyskusja jest SIOSTRĄ formularza, nigdy jego dzieckiem: CommentsPanel
          ma własny `<form>`, a zagnieżdżenie jest nielegalne w HTML i
          „Skomentuj" zapisywałoby zadanie. */}
      {tabs.filter((tab) => tab.id === 'dyskusja').map(renderPanel)}

      {/* f) Save / Cancel — sticky: zawsze widoczne bez przewijania */}
      <div className="editor-actions editor-actions-sticky">
        {/* IA-12 — powody, przez które zapis nie przejdzie, stoją PRZY przycisku
            (przyczyna bywa kilka tysięcy pikseli wyżej). Każdy powód z kotwicą
            jest klikalny i przenosi do swojego pola. */}
        {!readOnly && blockers.length > 0 && (saveAttempted || (isEdit && dirty)) && (
          <div className="save-blockers" role="alert">
            {/* JEDYNY `role="alert"` w modalu: liczone podsumowanie („popraw 2
                pola: Tytuł, Okres."). Etykiety idą z `SaveBlocker.fieldLabel`,
                więc nie ma drugiej, ręcznie utrzymywanej listy nazw pól. */}
            <p className="save-blockers-title">
              {saveErrorSummary(
                'Nie można zapisać zadania',
                blockers
                  .map((b) => b.fieldLabel)
                  .filter((label): label is string => label !== null),
              )}
            </p>
            <ul className="save-blockers-list">
              {blockers.map((b) => (
                <li key={b.id}>
                  {b.focusId === null ? (
                    b.message
                  ) : (
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => jumpToBlocker(b)}
                    >
                      {b.message}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {/* Statyczny hint „Zmiany zapisują się automatycznie.” ZNIKŁ: stan zapisu
            niesie trzystanowy wskaźnik w nagłówku (SY-15/16), a stopka mówi
            wyłącznie o akcjach. */}
        {!readOnly &&
          (isDraft ? (
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
            <DisabledHint reason={noProjectReason} id="task-no-project-save">
              <button
                type="button"
                className="btn primary"
                onClick={handleSave}
                disabled={state.projects.length === 0}
              >
                {/* Edycja jest auto-zapisywana, więc główny przycisk KOŃCZY pracę
                    („Gotowe”), a nie zapisuje po raz drugi — ten sam handler. */}
                {isEdit ? 'Gotowe' : 'Utwórz zadanie'}
              </button>
            </DisabledHint>
          ))}
        {/* W trybie edycji NIE ma „Anuluj”: nie da się anulować czegoś, co już
            zostało zapisane w tle. Zostaje uczciwe „Zamknij”. */}
        <button type="button" className="btn ghost" onClick={onCancel}>
          {readOnly || isEdit || !dirty ? 'Zamknij' : 'Anuluj'}
        </button>
      </div>
    </div>
  );
}
