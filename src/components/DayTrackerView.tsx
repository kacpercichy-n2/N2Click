// Widok „Dzień" kalendarza: PLAN obok WYKONANIA na wspólnej osi godzin.
//   * lewa kolumna — plan zalogowanej osoby (datowane bloki `workload` +
//     spotkania z kalendarza); tu się NIE wpisuje czasu. Kafel niesie dwie
//     prawdy naraz: porcję (ten blok) i całość zadania. Ptaszek przestawia
//     STATUS zadania (pierwszy status `isDone` / z powrotem pierwszy aktywny).
//     Spotkanie nie liczy się samo: klik wypełnia pasek (tytuł + godziny +
//     `eventId`), drugi klik na zaliczonym spotkaniu kasuje jego wpis.
//   * prawa kolumna — wpisy czasu (`timeEntries`). Przeciągnięcie po pustym
//     miejscu (albo klik = 30 min) wypełnia godziny w pasku; klik we wpis
//     otwiera go do poprawki; krzyżyk kasuje.
//   * pasek u góry (`TimeTrackerBar`) jest JEDYNYM formularzem.
//   * panel boczny: sumy dnia/tygodnia i „Ile na kogo" (tydzień).
// Plan jest tu TYLKO do odczytu — przeciąganie i zasobnik zostają w widoku
// „Tydzień" (inwariant 7: żadna ścieżka wskaźnika WeekView nie jest dotykana).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { AppData, DateStr, TimeEntry, WorkloadEntry } from '../types';
import { usePersistence, useStoreApi, type Action } from '../store/AppStore';
import { defaultWorkEndMinutes } from '../store/storage';
import { useSaveStatus } from '../utils/useSaveStatus';
import {
  blocksForPersonDate,
  calendarEventsForDate,
  getClient,
  getPerson,
  getProject,
  getTask,
  isDoneStatus,
} from '../store/selectors';
import { useCan } from '../store/useCan';
import { OverlayLayer, useOverlay } from './useOverlay';
import { projectDisplayName, taskDisplayTitle } from '../store/confidentiality';
import { useConfirm } from './ConfirmProvider';
import { useGoogleCalendar } from '../gcal/GoogleCalendarProvider';
import { useAuth } from '../auth/SessionProvider';
import { useCloudSync } from '../supabase/CloudSyncProvider';
import { dayTrackerOccurrences, gcalEntryKey, gcalLegacyEntryKey } from '../gcal/gcalData';
import type { GoogleEventOccurrence } from '../gcal/types';
import { planGrowth } from '../store/timeTrackingSync';
import {
  clientTimeSummary,
  dayPlanForPerson,
  overrunSummary,
  loggedMinutesForPersonDate,
  loggedMinutesForPersonDates,
  loggedMinutesForTask,
  loggedMinutesForTaskPersonDate,
  plannedMinutesForPersonDate,
  resolveTaskByTitle,
  settleCutoffMinutes,
  settleDueBlocks,
  taskTimeSummary,
  timeEntriesForPersonDate,
  type DayPlanItem,
} from '../store/timeTracking';
import {
  DAY_MINUTES,
  HOURS_STEP,
  MINUTE_STEP,
  findFreeStart,
  formatDuration,
  formatMinutes,
  hoursToMinutes,
  isBinEntry,
  nextFreeStart,
  snapHours,
} from '../utils/time';
import { findOverlappingEntry, formatMinutesDuration, freeRemainderRange, isValidTimeRange } from '../utils/timeTracking';
import { isTodayStr, todayStr, weekDays } from '../utils/dates';
import { useNowTick } from '../utils/useNowTick';
import { TimeTrackerBar, type TrackerFormState, type TrackerStatus } from './TimeTrackerBar';
import {
  TRACKER_PX_PER_HOUR,
  axisHourRange,
  layoutColumns,
  minuteToPx,
  pxToSnappedMinute,
  trackerDensityClass,
  type HourRange,
} from './dayTrackerLayout';

interface Props {
  state: AppData;
  dispatch: React.Dispatch<Action>;
  date: DateStr;
}

/** Wydarzenie Google w kolumnie planu (warstwa cieniowa providera, nie store). */
interface DayGcalItem {
  /** Klucz `TimeEntry.eventId` (`gcal:<id>`), zarazem id do układu kolumn. */
  key: string;
  occ: GoogleEventOccurrence;
  title: string;
  startMinutes: number;
  endMinutes: number;
  /** Wpis trackera powstały z tego spotkania (klik „byłem"), jeśli istnieje. */
  entry: TimeEntry | undefined;
}

/** Spotkanie (N2Hub albo Google) w ręku paska: to, co potrzebuje klik. */
interface MeetingClick {
  title: string;
  startMinutes: number;
  endMinutes: number;
  entry: TimeEntry | undefined;
  eventId: string;
}

/** Norma dnia do pierścienia: godziny pracy osoby z profilu (domyślnie 8h). */
const DEFAULT_DAY_NORM_MINUTES = 8 * 60;
const STATUS_TTL_MS = 7000;
const OFF_HOURS_START = 9 * 60;
const OFF_HOURS_END = 17 * 60;

// "HH:MM" ↔ minuty od północy, z zerami dla natywnego <input type="time">.
function timeToMinutes(value: string): number {
  const [h, m] = value.split(':');
  return Number(h) * 60 + Number(m);
}
function minutesToTimeStr(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function emptyForm(date: DateStr, state: AppData, personId: string): TrackerFormState {
  // Start = za ostatnim wpisem dnia (albo 9:00); dziś: nie później niż teraz.
  const entries = timeEntriesForPersonDate(state, personId, date);
  let start = entries.length > 0 ? entries[entries.length - 1].endMinutes : OFF_HOURS_START;
  if (isTodayStr(date)) {
    const now = new Date();
    const nowSnapped = Math.floor((now.getHours() * 60 + now.getMinutes()) / 15) * 15;
    if (entries.length === 0 || nowSnapped - 30 > start) start = Math.max(0, nowSnapped - 30);
  }
  start = Math.min(start, 24 * 60 - 30);
  return {
    text: '',
    taskId: null,
    creatingNew: false,
    newProjectId: '',
    newCategoryId: '',
    startMinutes: start,
    endMinutes: start + 30,
    editingId: null,
    eventId: null,
  };
}

export function DayTrackerView({ state, dispatch, date }: Props) {
  // `getState()` czyta stan ZATWIERDZONY tuż po dispatchu: komunikat „Zapisane”
  // pada tylko wtedy, gdy reduktor naprawdę przyjął komendę (inwariant 6 zwraca
  // tę samą referencję przy odrzuceniu — nie zgadujemy z walidacji po stronie UI).
  const storeApi = useStoreApi();
  const confirm = useConfirm();
  // Utrwalenie (localStorage, zapis koalescowany) to OSOBNA prawda od stanu w
  // pamięci: odznaka `SaveStatus` (ten sam wzorzec co TaskModal) pokazuje
  // „Zapisywanie… / Zapisano HH:mm", a nieudany zapis trwale „Nie zapisano”.
  // Linia statusu pod paskiem opisuje więc SKUTEK W DANYCH („Dodane…"), nigdy
  // nie twierdzi, że coś zostało utrwalone.
  const { saveError, persistSeq, requestImmediatePersist } = usePersistence();
  const { status: saveState, savedAtLabel, markSaved } = useSaveStatus(false, saveError !== null);
  // Udany commit NIE ogłasza zapisu od razu: prosi provider o zapis
  // natychmiastowy (jeden zapis w jego efekcie persist, bez zaległego duplikatu
  // w koalescerze) i zapamiętuje licznik udanych zapisów. Odznaka „Zapisano”
  // rusza dopiero, gdy licznik wzrośnie; nieudany zapis zostawia `saveError`,
  // więc odznaka pokazuje trwale „Nie zapisano”.
  // Nieudany zapis NIE zdejmuje oczekiwania: każdy późniejszy udany zapis (np.
  // „Ponów” z banera pamięci) utrwala także naszą zmianę, więc dopiero on
  // zamyka pętlę odznaką „Zapisano”; do tego czasu odznaka mówi „Nie zapisano”.
  const [awaitingSeq, setAwaitingSeq] = useState<number | null>(null);
  useEffect(() => {
    if (awaitingSeq === null) return;
    if (persistSeq > awaitingSeq) {
      setAwaitingSeq(null);
      markSaved();
    }
  }, [awaitingSeq, persistSeq, markSaved]);
  /** Dispatch + sprawdzenie KONKRETNEGO skutku na zatwierdzonym stanie (nie sama
   *  zmiana referencji): `verify(after)` mówi, czy stało się to, co obiecujemy.
   *  Udany commit zamawia natychmiastowe utrwalenie (patrz wyżej). */
  const commit = (action: Action, verify: (after: AppData, before: AppData) => boolean): boolean => {
    const before = storeApi.getState();
    dispatch(action);
    const after = storeApi.getState();
    const ok = after !== before && verify(after, before);
    if (ok) {
      requestImmediatePersist();
      setAwaitingSeq(persistSeq);
    }
    return ok;
  };
  const personId = state.currentUserId;
  const person = getPerson(state, personId);
  const [form, setForm] = useState<TrackerFormState>(() => emptyForm(date, state, personId));
  const [status, setStatus] = useState<TrackerStatus | null>(null);
  const [focusSignal, setFocusSignal] = useState(0);
  const statusTimer = useRef<number | null>(null);
  const lastDateRef = useRef(date);

  // Zmiana dnia: formularz startuje od nowa (poprawka nie przenosi się między dniami).
  useEffect(() => {
    if (lastDateRef.current === date) return;
    lastDateRef.current = date;
    setForm(emptyForm(date, state, personId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  // Otwarcie dnia doprowadza jego dane do zasad wcięcia (dane sprzed
  // 2026-09-02: cudzy wpis w środku bloku bez wcięcia, blok odhaczony bez
  // wpisu). Reduktor jest idempotentny i zwraca tę samą referencję, gdy nie ma
  // nic do zrobienia, więc bez pętli. W trybie chmury DOPIERO po hydracji
  // (`status === 'ready'`; przegląd Codex 2026-09-02): rozliczenie na stanie
  // sprzed hydracji zostałoby nadpisane przez chmurę, a lokalne wpisy „z bloku"
  // wskazywałyby kawałki, których już nie ma. Przy błędzie hydracji nic nie
  // robimy — stan jest nieświeży. Po przejściu w 'ready' efekt rusza sam.
  // Zależność od kolekcji: odświeżenie w tle (hydracja bez krawędzi statusu)
  // podmienia `workload`/`timeEntries`, więc efekt biegnie ponownie i wcina
  // od nowa; więzi wpisów „z bloku" zostają jak są (patrz reduktor). Po
  // własnej zmianie reduktor odpowiada tą samą referencją, więc nie ma pętli.
  const auth = useAuth();
  const cloud = useCloudSync();
  const dataReady = auth.mode !== 'supabase' || cloud.status === 'ready';
  const workloadRef = state.workload;
  const timeEntriesRef = state.timeEntries;
  useEffect(() => {
    if (personId === '' || !dataReady) return;
    dispatch({ type: 'RECONCILE_TRACKED_DAY', personId, date });
  }, [dispatch, personId, date, dataReady, workloadRef, timeEntriesRef]);

  const say = useCallback((text: string, tone: TrackerStatus['tone']) => {
    setStatus({ text, tone });
    if (statusTimer.current !== null) window.clearTimeout(statusTimer.current);
    statusTimer.current = window.setTimeout(() => setStatus(null), STATUS_TTL_MS);
  }, []);
  useEffect(
    () => () => {
      if (statusTimer.current !== null) window.clearTimeout(statusTimer.current);
    },
    [],
  );

  const patch = useCallback((p: Partial<TrackerFormState>) => setForm((f) => ({ ...f, ...p })), []);
  const resetForm = useCallback(
    () => setForm(emptyForm(date, state, personId)),
    [date, state, personId],
  );

  const plan = useMemo(() => dayPlanForPerson(state, personId, date), [state, personId, date]);
  const entries = useMemo(() => timeEntriesForPersonDate(state, personId, date), [state, personId, date]);
  // Wydarzenia Google zalogowanej osoby (2026-09-02, zgłoszenie Kacpra: bez
  // nich w planie była dziura, a meeta nie dało się odhaczyć): warstwa cieniowa
  // providera, NIE store — stoją w kolumnie planu jak spotkania N2Hub i klikają
  // się tak samo (wpis z `eventId: gcal:<kalendarz>:<id Google>` — klucz
  // stabilny między syncami; klucz po id wiersza sprzed migracji widoku nadal
  // liczy się jako zaliczony). Nadal poza kolizjami, sumami dnia i wzrostem
  // planu (inwariant 1): czas liczy się dopiero z wpisu.
  const gcal = useGoogleCalendar();
  const gcalEnabled = gcal.enabled;
  const gcalOccurrencesFor = gcal.occurrencesFor;
  const gcalFilter = useMemo(() => new Set([personId]), [personId]);
  const gcalItems = useMemo<DayGcalItem[]>(() => {
    if (!gcalEnabled) return [];
    return dayTrackerOccurrences(gcalOccurrencesFor(date, gcalFilter)).map((occ) => {
      const key = gcalEntryKey(occ.event);
      const legacyKey = gcalLegacyEntryKey(occ.event);
      return {
        key,
        occ,
        title: occ.event.title.trim() !== '' ? occ.event.title : 'Wydarzenie Google',
        startMinutes: occ.startMinutes,
        endMinutes: Math.min(DAY_MINUTES, occ.startMinutes + occ.durationMinutes),
        entry: entries.find((e) => e.eventId === key || e.eventId === legacyKey),
      };
    });
  }, [gcalEnabled, gcalOccurrencesFor, date, gcalFilter, entries]);
  const range: HourRange = useMemo(
    () => axisHourRange([...plan, ...gcalItems, ...entries]),
    [plan, gcalItems, entries],
  );
  const planLayout = useMemo(
    () =>
      layoutColumns([
        ...plan.map((p) => ({
          id: p.kind === 'block' ? p.block.id : `ev-${p.event.id}-${p.startMinutes}`,
          startMinutes: p.startMinutes,
          endMinutes: p.endMinutes,
        })),
        ...gcalItems.map((g) => ({ id: g.key, startMinutes: g.startMinutes, endMinutes: g.endMinutes })),
      ]),
    [plan, gcalItems],
  );
  const axisHeight = (range.endHour - range.startHour) * TRACKER_PX_PER_HOUR;

  // Tik minutowy stoi PRZED pochodnymi „miniony dzień": `today` musi być
  // zależnością memo, żeby po północy oglądany „dzisiaj" stał się dniem
  // minionym bez czekania na zmianę danych (re-render gwarantuje tik).
  const now = useNowTick(60_000);
  const nowMinutes = isTodayStr(date) ? now.getHours() * 60 + now.getMinutes() : null;
  const today = todayStr();

  // Rozliczenie ZAWSZE pyta, nigdy nie działa samo (decyzja usera
  // 2026-09-02): dzień MINIONY — wszystkie niewykonane bloki czekają w
  // popoucie; DZISIAJ — popout dopiero po końcu dnia pracy osoby
  // (`workEndMinutes` + karencja) i tylko dla bloków, które już się skończyły.
  // Do końca dnia pracy plan zostaje nietknięty, nawet gdy wpisy już są —
  // wcięta głowa 9-15 nie ucieka do zasobnika minutę po zalogowaniu rozmowy.
  // Bez bramki „dzień śledzony": blok dodany wstecz na pusty dzień też ma
  // dostać pytanie (jawne rozliczenie działa bez wpisów).
  // Koniec dnia pracy z profilu (domyślnie 8:00 + etat, czyli 16:00 przy 8h —
  // `defaultWorkEndMinutes`); odcięcie liczy czysta `settleCutoffMinutes`
  // (dzisiaj po końcu pracy, dzień miniony z karencją przez północ).
  const clockMinutes = now.getHours() * 60 + now.getMinutes();
  const workEnd =
    person !== undefined && Number.isFinite(person.workEndMinutes) && person.workEndMinutes > 0
      ? person.workEndMinutes
      : defaultWorkEndMinutes(person?.capacity ?? 8);
  const settleCutoff = useMemo(
    () => settleCutoffMinutes(date, today, clockMinutes, workEnd),
    [date, today, clockMinutes, workEnd],
  );
  const pastDue = useMemo(() => settleDueBlocks(plan, settleCutoff), [plan, settleCutoff]);
  const settleKey = `${personId}|${date}`;
  const [settleDismissed, setSettleDismissed] = useState<string | null>(null);

  // ---- „+ Z zasobnika": planowanie na oglądany dzień (formularz, zero
  // ścieżek wskaźnika — przeciąganie zostaje w WeekView, inwariant 7) ----
  const can = useCan();
  const canPlanFromBin = personId !== '' && (can('blocks.editAny') || can('blocks.editOwn'));
  // Wiersze zasobnika zalogowanej osoby; szkice i zadania „zrobione" nie
  // planują godzin, wiersz musi unieść co najmniej kwadrans.
  const binRows = useMemo(() => {
    const rows: Array<{ entry: WorkloadEntry; title: string; clientName: string }> = [];
    for (const w of state.workload) {
      if (w.personId !== personId || !isBinEntry(w)) continue;
      if (!Number.isFinite(w.plannedHours) || Math.round(w.plannedHours / HOURS_STEP) < 1) continue;
      const t = getTask(state, w.taskId);
      if (t === undefined || t.isDraft === true || isDoneStatus(state, t.statusId)) continue;
      const project = getProject(state, t.projectId);
      const client = project ? getClient(state, project.clientId) : undefined;
      rows.push({ entry: w, title: taskDisplayTitle(state, t), clientName: client?.name ?? '' });
    }
    return rows.sort((a, b) => a.title.localeCompare(b.title, 'pl'));
  }, [state, personId]);
  const [binOpen, setBinOpen] = useState(false);
  const [binEntryId, setBinEntryId] = useState('');
  const [binHoursRaw, setBinHoursRaw] = useState('1');
  const [binStart, setBinStart] = useState('09:00');
  const binPopRef = useRef<HTMLDivElement | null>(null);
  // Dwa przyciski otwierające (nagłówek Planu i pusty stan) — kotwicą jest ten
  // faktycznie kliknięty, zapamiętany przy otwarciu.
  const binAnchorRef = useRef<HTMLElement | null>(null);
  const binOverlay = useOverlay({
    open: binOpen,
    onClose: () => setBinOpen(false),
    overlayRef: binPopRef,
    getAnchorRect: () => {
      const el = binAnchorRef.current;
      return el !== null && el.isConnected ? el.getBoundingClientRect() : null;
    },
    triggerRef: binAnchorRef,
    closeOnAnchorOutOfView: true,
    offset: 4,
  });

  const loggedToday = loggedMinutesForPersonDate(state, personId, date);
  const plannedToday = plannedMinutesForPersonDate(state, personId, date);
  const week = useMemo(() => weekDays(date), [date]);
  const loggedWeek = loggedMinutesForPersonDates(state, personId, week);
  // Podsumowanie boczne (2026-09-02, zgłoszenie „Podsumowanie w widoku dnia"):
  // grupowanie Projekty | Zadania i zakres Dzień | Tydzień — stan sesyjny,
  // domyślnie jak dotąd (klienci i projekty, tydzień).
  const [sideBy, setSideBy] = useState<'projects' | 'tasks'>('projects');
  const [sideScope, setSideScope] = useState<'day' | 'week'>('week');
  const scopeDates = useMemo(() => (sideScope === 'day' ? [date] : week), [sideScope, date, week]);
  const clientSums = useMemo(() => clientTimeSummary(state, personId, scopeDates), [state, personId, scopeDates]);
  const taskSums = useMemo(() => taskTimeSummary(state, personId, scopeDates), [state, personId, scopeDates]);
  const overruns = useMemo(() => overrunSummary(state, personId, week), [state, personId, week]);
  const dayNorm = person ? Math.max(60, Math.round(person.capacity * 60)) : DEFAULT_DAY_NORM_MINUTES;

  // ---- zapis ----
  /** Pytanie o „ponad sprzedane" dokładnie wtedy, gdy reduktor by je odrzucił bez zgody. */
  const confirmOverrun = async (taskId: string, minutes: number, excludeEntryId?: string): Promise<boolean | null> => {
    const growth = planGrowth(state, taskId, personId, date, minutes, excludeEntryId);
    if (growth.overrunMinutes === 0) return false;
    const t = getTask(state, taskId);
    const ok = await confirm({
      title: `Przekroczysz godziny sprzedane zadania o ${formatMinutesDuration(growth.overrunMinutes)}.`,
      description: `„${t ? taskDisplayTitle(state, t) : ''}”: zasobnik i wolne sprzedane godziny są wyczerpane.`,
      consequences: `Te ${formatMinutesDuration(growth.overrunMinutes)} zapiszą się jako „ponad sprzedane” przy Twoim nazwisku; sprzedanych godzin zadania to nie zmienia.`,
      confirmLabel: 'Zapisz mimo to',
      cancelLabel: 'Wróć',
    });
    return ok ? true : null;
  };
  const submit = async () => {
    const { startMinutes, endMinutes } = form;
    if (!isValidTimeRange(startMinutes, endMinutes)) {
      say('Godzina „do” musi być późniejsza niż „od”, obie na siatce 15 minut.', 'error');
      return;
    }
    const clash = findOverlappingEntry(
      state.timeEntries,
      personId,
      date,
      startMinutes,
      endMinutes,
      form.editingId ?? undefined,
    );
    if (clash !== undefined) {
      const t = getTask(state, clash.taskId);
      say(
        `Te godziny zajmuje już „${t ? taskDisplayTitle(state, t) : 'inny wpis'}” (${formatMinutes(clash.startMinutes)}-${formatMinutes(clash.endMinutes)}). W wykonaniu jedna minuta to jedno zajęcie.`,
        'error',
      );
      return;
    }

    // Rozstrzygnięcie zadania: jawny wybór > jednoznaczny tytuł > nowe zadanie.
    let taskId: string | null = form.taskId;
    let newTask: { title: string; projectId: string; workCategoryId?: string } | undefined;
    const trimmed = form.text.trim();
    if (taskId === null) {
      const res = resolveTaskByTitle(state, trimmed);
      if (trimmed === '') {
        say('Napisz, nad czym pracowałeś. Zacznij pisać, hub podpowie z zadań.', 'error');
        return;
      }
      if (res.kind === 'one' || res.kind === 'closed') taskId = res.task.id;
      else if (res.kind === 'ambiguous') {
        const names = res.tasks
          .map((t) => getClient(state, getProject(state, t.projectId)?.clientId ?? '')?.name ?? '?')
          .join(', ');
        say(
          `Kilka zadań nazywa się „${trimmed}” (${names}). Wybierz właściwe z listy podpowiedzi, żeby czas trafił do dobrego projektu.`,
          'error',
        );
        return;
      } else if (!form.creatingNew) {
        say('Nie ma takiego zadania. Wybierz je z listy albo „+ nowe zadanie”, żeby je założyć.', 'error');
        return;
      } else {
        if (form.newProjectId === '' || getProject(state, form.newProjectId) === undefined) {
          say('Nowe zadanie potrzebuje projektu, bo bez niego nie ma klienta. Wybierz go w wierszu „Nowe zadanie”.', 'error');
          return;
        }
        newTask = {
          title: trimmed,
          projectId: form.newProjectId,
          ...(form.newCategoryId !== '' ? { workCategoryId: form.newCategoryId } : {}),
        };
      }
    }

    if (form.editingId !== null) {
      if (taskId === null) {
        say('W poprawce wybierz istniejące zadanie z listy (nowe zadanie zakłada się nowym wpisem).', 'error');
        return;
      }
      const t = getTask(state, taskId);
      const editingId = form.editingId;
      const accept = await confirmOverrun(taskId, endMinutes - startMinutes, editingId);
      if (accept === null) return; // użytkownik wrócił do poprawki
      const ok = commit(
        {
          type: 'UPDATE_TIME_ENTRY',
          entryId: editingId,
          taskId,
          startMinutes,
          endMinutes,
          ...(accept ? { acceptOverrun: true } : {}),
        },
        (after) =>
          after.timeEntries.some(
            (e) => e.id === editingId && e.taskId === taskId && e.startMinutes === startMinutes && e.endMinutes === endMinutes,
          ),
      );
      if (!ok) {
        say('Nie udało się wprowadzić poprawki: wpis już nie istnieje, zadanie nie przyjmuje czasu albo godziny nachodzą na inny wpis. Odśwież widok i spróbuj ponownie.', 'error');
        return;
      }
      say(`Poprawione: „${t ? taskDisplayTitle(state, t) : ''}” ${formatMinutes(startMinutes)}-${formatMinutes(endMinutes)}.`, 'ok');
      resetForm();
      return;
    }

    let savedEntry: TimeEntry | undefined;
    const accept = taskId !== null ? await confirmOverrun(taskId, endMinutes - startMinutes) : false;
    if (accept === null) return;
    const added = commit(
      {
        type: 'ADD_TIME_ENTRY',
        payload: {
          personId,
          ...(taskId !== null ? { taskId } : {}),
          ...(newTask !== undefined ? { newTask } : {}),
          date,
          startMinutes,
          endMinutes,
          source: form.eventId !== null ? 'event' : 'manual',
          ...(form.eventId !== null ? { eventId: form.eventId } : {}),
          ...(accept ? { acceptOverrun: true } : {}),
        },
      },
      (after, before) => {
        if (after.timeEntries.length !== before.timeEntries.length + 1) return false;
        const fresh = after.timeEntries[after.timeEntries.length - 1];
        if (fresh.personId !== personId || fresh.date !== date || fresh.startMinutes !== startMinutes || fresh.endMinutes !== endMinutes) return false;
        if (taskId !== null && fresh.taskId !== taskId) return false;
        savedEntry = fresh;
        return true;
      },
    );
    if (!added || savedEntry === undefined) {
      say(
        newTask !== undefined
          ? 'Nie udało się założyć zadania i dodać czasu: sprawdź projekt i tytuł. Nic się nie zmieniło.'
          : 'Nie udało się dodać wpisu: zadanie nie przyjmuje już czasu (zamknięte albo usunięte) albo godziny nachodzą na inny wpis. Nic się nie zmieniło.',
        'error',
      );
      return;
    }
    // Komunikat liczymy ze stanu ZATWIERDZONEGO (po zapisie), nie z propsów renderu.
    const after = storeApi.getState();
    const savedTaskId = savedEntry.taskId;
    const t = getTask(after, savedTaskId);
    const today = loggedMinutesForTaskPersonDate(after, savedTaskId, personId, date);
    const total = loggedMinutesForTask(after, savedTaskId);
    const est = t === undefined || t.estimatedHours === null ? '' : ` z ${formatMinutesDuration(hoursToMinutes(t.estimatedHours))}`;
    if (newTask !== undefined) {
      const project = t ? getProject(after, t.projectId) : undefined;
      say(
        `Powstało nowe zadanie „${t ? taskDisplayTitle(after, t) : newTask.title}” w projekcie ${project ? projectDisplayName(after, project) : ''}, dodane ${formatMinutesDuration(endMinutes - startMinutes)}.`,
        'ok',
      );
    } else {
      const ov = savedEntry.overrunMinutes ? ` Ponad sprzedane: ${formatMinutesDuration(savedEntry.overrunMinutes)}.` : '';
      const closedNote = t !== undefined && isDoneStatus(after, t.statusId) ? ' Zadanie jest zamknięte, status bez zmian.' : '';
      say(
        `Dodane: „${t ? taskDisplayTitle(after, t) : ''}” ma tego dnia ${formatMinutesDuration(today)}, razem ${formatMinutesDuration(total)}${est}.${ov}${closedNote}`,
        'ok',
      );
    }
    // Następny wpis zaczyna się tam, gdzie skończył ten.
    setForm({
      ...emptyForm(date, state, personId),
      startMinutes: endMinutes,
      endMinutes: Math.min(24 * 60, endMinutes + 30),
    });
  };

  const startEdit = (entry: TimeEntry) => {
    const t = getTask(state, entry.taskId);
    setForm({
      text: t ? taskDisplayTitle(state, t) : '',
      taskId: entry.taskId,
      creatingNew: false,
      newProjectId: '',
      newCategoryId: '',
      startMinutes: entry.startMinutes,
      endMinutes: entry.endMinutes,
      editingId: entry.id,
      eventId: null,
    });
    setFocusSignal((n) => n + 1);
  };
  const remove = (entry: TimeEntry) => {
    const ok = commit(
      { type: 'DELETE_TIME_ENTRY', entryId: entry.id },
      (after) => !after.timeEntries.some((e) => e.id === entry.id),
    );
    if (form.editingId === entry.id) resetForm();
    const t = getTask(state, entry.taskId);
    say(
      ok
        ? `Wpis „${t ? taskDisplayTitle(state, t) : ''}” skasowany. Liczniki przeliczone.`
        : 'Tego wpisu już nie ma (skasowany w innym miejscu). Widok jest aktualny.',
      ok ? 'info' : 'error',
    );
  };

  // ---- plan: kółko = blok wykonany + wpis 1:1 (para blok-wpis) ----
  const toggleBlockDone = (item: Extract<DayPlanItem, { kind: 'block' }>) => {
    const blockId = item.block.id;
    const next = !item.blockDone;
    const ok = commit(
      { type: 'SET_BLOCK_DONE', entryId: blockId, done: next },
      (after) => after.workload.some((w) => w.id === blockId && (w.done === true) === next),
    );
    if (!ok) {
      say('Nie udało się zmienić bloku. Odśwież widok i spróbuj ponownie.', 'error');
      return;
    }
    const after = storeApi.getState();
    // Wpisy „z bloku" powstałe TYM kliknięciem: 1:1 z blokiem albo kawałki w
    // wolnych godzinach (blok częściowo zajęty cudzym wpisem został wcięty).
    const linked = after.timeEntries
      .filter(
        (e) =>
          e.source === 'block' &&
          e.date === date &&
          e.personId === personId &&
          e.taskId === item.task.id &&
          e.startMinutes >= item.startMinutes &&
          e.endMinutes <= item.endMinutes,
      )
      .sort((a, b) => a.startMinutes - b.startMinutes);
    const taskNow = getTask(after, item.task.id);
    const closed = taskNow !== undefined && taskNow.statusId !== item.task.statusId;
    if (next) {
      const ranges = linked.map((e) => `${formatMinutes(e.startMinutes)}-${formatMinutes(e.endMinutes)}`).join(', ');
      const carved = linked.length > 0 && (linked.length > 1 || linked[0].startMinutes !== item.startMinutes || linked[0].endMinutes !== item.endMinutes);
      say(
        linked.length === 0
          ? `„${item.title}” oznaczone jako wykonane, ale te godziny zajmuje już inny wpis, więc wpisu nie dodano.`
          : carved
            ? `„${item.title}” wykonane w wolnych godzinach: wpisy ${ranges}. Plan wcięty wokół innego wpisu, wycięte minuty wróciły do zasobnika.${closed ? ' Zadanie zamknięte: wszystko wykonane.' : ''}`
            : `„${item.title}” wykonane: wpis ${ranges} dodany do wykonania.${closed ? ' Zadanie zamknięte: wszystko wykonane.' : ''}`,
        'info',
      );
    } else {
      say(`„${item.title}”: blok odznaczony, wpis z tego bloku usunięty.`, 'info');
    }
  };
  // ---- popout rozliczenia minionego dnia (decyzja zamiast automatu) ----
  /** Odmiana „N bloków": 1 blok, 2-4 bloki, 5+ bloków (z wyjątkiem 12-14). */
  const blocksNoun = (n: number): string => {
    if (n === 1) return 'blok';
    const d = n % 10;
    const h = n % 100;
    return d >= 2 && d <= 4 && (h < 12 || h > 14) ? 'bloki' : 'bloków';
  };
  const settlePastAsDone = () => {
    const due = pastDue;
    let doneCount = 0;
    for (const item of due) {
      if (item.portionLogged === 0) {
        // Blok bez pokrycia: pełny wpis 1:1 w jego godzinach (o ile wolne).
        const ok = commit(
          { type: 'SET_BLOCK_DONE', entryId: item.block.id, done: true },
          (after) => after.workload.some((w) => w.id === item.block.id && w.done === true),
        );
        if (ok) doneCount++;
        continue;
      }
      // Blok CZĘŚCIOWO pokryty: pełny wpis 1:1 zdublowałby pokrytą część
      // (pokrycie liczy się pulą zadania z dnia, nie nakładką godzin, więc
      // godziny bloku bywają wolne mimo pokrycia). Dopisujemy WYŁĄCZNIE
      // brakującą resztę w wolnym kawałku godzin bloku; pełne pokrycie
      // odhacza blok samo (resyncBlockDone w ADD_TIME_ENTRY).
      const remaining = item.plannedMinutes - item.portionLogged;
      const free = freeRemainderRange(
        storeApi.getState().timeEntries,
        personId,
        date,
        item.startMinutes,
        item.endMinutes,
        remaining,
      );
      const ok =
        free !== null &&
        commit(
          {
            type: 'ADD_TIME_ENTRY',
            payload: {
              personId,
              taskId: item.task.id,
              date,
              startMinutes: free[0],
              endMinutes: free[1],
              source: 'manual',
            },
          },
          (after) => after.workload.some((w) => w.id === item.block.id && w.done === true),
        );
      if (ok) doneCount++;
    }
    if (doneCount === 0) {
      say('Nie udało się zaliczyć bloków: ich godziny zajmują już inne wpisy. Popraw wykonanie obok i spróbuj ponownie.', 'error');
      return;
    }
    say(
      doneCount === due.length
        ? `Zaliczone do przeszłości: ${doneCount} ${blocksNoun(doneCount)} wykonane, wykonanie uzupełnione wpisami tam, gdzie godziny były wolne.`
        : `Zaliczone ${doneCount} z ${due.length} bloków — pozostałym godziny zajmują inne wpisy. Popraw wykonanie obok i ponów.`,
      'ok',
    );
  };
  const settlePastToBin = () => {
    const minutes = pastDue.reduce((s, item) => s + (item.plannedMinutes - item.portionLogged), 0);
    // To samo odcięcie, które wyliczyło listę: tylko bloki, które już minęły.
    if (settleCutoff === null) return;
    const ok = commit(
      { type: 'SETTLE_TRACKED_DAY', personId, date, nowMinutes: settleCutoff, explicit: true },
      (after, before) => after.workload !== before.workload,
    );
    say(
      ok
        ? `Niewykonane ${formatMinutesDuration(minutes)} wróciło do zasobnika. Znajdziesz je w widoku „Tydzień”.`
        : 'Nie było już nic do rozliczenia. Widok jest aktualny.',
      ok ? 'info' : 'error',
    );
  };

  // ---- „+ Z zasobnika": sugestia startu, walidacja i zapis (reduktor
  // `SCHEDULE_BIN_PART` pozostaje autorytatywny — UI tylko podpowiada) ----
  const suggestBinStart = (taskId: string, hours: number): string => {
    const dur = hoursToMinutes(hours);
    const blocks = blocksForPersonDate(state, personId, date);
    const sameTask = blocks.filter((b) => b.taskId === taskId);
    // Spotkania imienne i urlop jako pseudo-bloki podpowiedzi (wzór „Zaplanuj
    // część" z WeekView); ogólnofirmowe nie blokują zapisu, więc nie wchodzą.
    const events = calendarEventsForDate(state, date, new Set([personId]))
      .filter((occ) => occ.event.attendeeIds.length > 0)
      .map((occ) => ({ startMinutes: occ.startMinutes, plannedHours: occ.durationMinutes / 60 }));
    const occupied = [...blocks, ...events];
    return minutesToTimeStr(findFreeStart(occupied, dur, sameTask) ?? nextFreeStart(occupied, dur));
  };
  const defaultBinHours = (row: { entry: WorkloadEntry }): number =>
    Math.max(
      HOURS_STEP,
      Math.min(
        snapHours(row.entry.plannedHours),
        person !== undefined && person.capacity > 0 ? snapHours(person.capacity) : 8,
        24,
      ),
    );
  const openBinAdd = (btn: HTMLElement) => {
    const row = binRows.find((r) => r.entry.id === binEntryId) ?? binRows[0];
    if (row === undefined) return;
    binAnchorRef.current = btn;
    const hours = defaultBinHours(row);
    setBinEntryId(row.entry.id);
    setBinHoursRaw(String(hours));
    setBinStart(suggestBinStart(row.entry.taskId, hours));
    setBinOpen(true);
  };
  const onBinTaskChange = (id: string) => {
    setBinEntryId(id);
    const row = binRows.find((r) => r.entry.id === id);
    if (row === undefined) return;
    const hours = defaultBinHours(row);
    setBinHoursRaw(String(hours));
    setBinStart(suggestBinStart(row.entry.taskId, hours));
  };
  const binRow = binRows.find((r) => r.entry.id === binEntryId);
  const binRawHours = Number(binHoursRaw);
  const binHours = Number.isNaN(binRawHours) ? NaN : snapHours(Math.min(24, binRawHours));
  const binStartMin = timeToMinutes(binStart);
  const binDurMin = Number.isNaN(binHours) ? 0 : hoursToMinutes(binHours);
  let binWarning: string | null = null;
  let binDisabled = binRow === undefined;
  if (binOpen && binRow !== undefined) {
    if (Number.isNaN(binHours) || binHours <= 0) {
      binDisabled = true; // cicho, jak formularze WeekView
    } else if (Math.round(binHours / HOURS_STEP) > Math.round(binRow.entry.plannedHours / HOURS_STEP)) {
      binWarning = `⚠ W zasobniku pozostało tylko ${formatDuration(binRow.entry.plannedHours)}.`;
      binDisabled = true;
    } else if (!Number.isFinite(binStartMin) || binStartMin % MINUTE_STEP !== 0) {
      binWarning = '⚠ Start musi być w krokach co 15 minut.';
      binDisabled = true;
    } else if (binStartMin + binDurMin > 24 * 60) {
      binWarning = '⚠ Blok nie mieści się w dobie — wybierz wcześniejszy start albo mniej godzin.';
      binDisabled = true;
    }
  }
  const submitBinAdd = () => {
    if (binRow === undefined || binDisabled) return;
    const row = binRow;
    const ok = commit(
      { type: 'SCHEDULE_BIN_PART', entryId: row.entry.id, date, startMinutes: binStartMin, hours: binHours },
      (after) =>
        after.workload.some(
          (w) =>
            w.taskId === row.entry.taskId &&
            w.personId === personId &&
            w.date === date &&
            w.startMinutes === binStartMin &&
            !isBinEntry(w),
        ),
    );
    if (!ok) {
      say(
        'Nie udało się dodać do planu: godziny kolidują z blokiem albo spotkaniem, albo masz w tym dniu urlop. Zmień start i spróbuj ponownie.',
        'error',
      );
      return;
    }
    setBinOpen(false);
    // Świeży blok minionego dnia ma od razu trafić do popoutu rozliczenia,
    // nawet jeśli wcześniejszy popout został odłożony przyciskiem „Zostaw plan".
    setSettleDismissed(null);
    say(
      `Dodane do planu: „${row.title}” ${formatMinutes(binStartMin)}-${formatMinutes(binStartMin + binDurMin)}.` +
        (date < todayStr() ? ' Zalicz blok kółkiem na kaflu albo w popoucie rozliczenia.' : ''),
      'ok',
    );
  };

  // Jedno kliknięcie dla spotkań N2Hub i Google: zaliczone → kasuje wpis;
  // wolne godziny → spotkanie ląduje w pasku (tytuł, godziny, `eventId`).
  const clickMeeting = (item: MeetingClick) => {
    if (item.entry !== undefined) {
      const entryId = item.entry.id;
      const ok = commit(
        { type: 'DELETE_TIME_ENTRY', entryId },
        (after) => !after.timeEntries.some((e) => e.id === entryId),
      );
      say(
        ok
          ? `„${item.title}” nie liczy się już jako czas pracy. Te godziny są znowu wolne.`
          : 'Tego wpisu już nie ma. Widok jest aktualny.',
        ok ? 'info' : 'error',
      );
      return;
    }
    const clash = findOverlappingEntry(state.timeEntries, personId, date, item.startMinutes, item.endMinutes);
    if (clash !== undefined) {
      const t = getTask(state, clash.taskId);
      say(
        `W tych godzinach masz już wpis „${t ? taskDisplayTitle(state, t) : ''}” (${formatMinutes(clash.startMinutes)}-${formatMinutes(clash.endMinutes)}). Spotkanie nie liczy się samo: popraw tamten wpis, jeśli naprawdę byłeś.`,
        'error',
      );
      return;
    }
    setForm({
      ...emptyForm(date, state, personId),
      text: item.title,
      startMinutes: item.startMinutes,
      endMinutes: item.endMinutes,
      eventId: item.eventId,
    });
    setFocusSignal((n) => n + 1);
    say(`Spotkanie „${item.title}” czeka w pasku. Wskaż zadanie (albo załóż nowe) i zapisz, żeby się liczyło.`, 'info');
  };

  // ---- rysowanie po osi wykonania ----
  const workColRef = useRef<HTMLDivElement | null>(null);
  // Gest żyje w refie (handlery czytają ŚWIEŻY stan niezależnie od batchowania
  // Reacta); `draw` w stanie służy wyłącznie renderowi ducha.
  type DrawGesture = { anchor: number; start: number; end: number; moved: boolean };
  const drawRef = useRef<DrawGesture | null>(null);
  const [draw, setDrawState] = useState<DrawGesture | null>(null);
  const setDraw = (g: DrawGesture | null) => {
    drawRef.current = g;
    setDrawState(g);
  };
  const onWorkPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.tt-entry')) return;
    const col = workColRef.current;
    if (col === null) return;
    const rect = col.getBoundingClientRect();
    const m = pxToSnappedMinute(e.clientY - rect.top, range);
    // Przechwycenie wskaźnika trzyma gest także poza kolumną; syntetyczne
    // zdarzenia (testy) nie mają aktywnego wskaźnika, więc bez wyjątku.
    try {
      col.setPointerCapture(e.pointerId);
    } catch {
      /* brak aktywnego wskaźnika — gest i tak działa w obrębie kolumny */
    }
    setDraw({ anchor: m, start: m, end: Math.min(range.endHour * 60, m + 15), moved: false });
  };
  const onWorkPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = drawRef.current;
    if (g === null) return;
    const col = workColRef.current;
    if (col === null) return;
    const rect = col.getBoundingClientRect();
    const m = pxToSnappedMinute(e.clientY - rect.top, range);
    const moved = g.moved || Math.abs(m - g.anchor) >= 15;
    const start = Math.min(g.anchor, m);
    const end = Math.max(start + 15, Math.max(g.anchor, m));
    setDraw({ ...g, start, end, moved });
  };
  const onWorkPointerUp = () => {
    const g = drawRef.current;
    if (g === null) return;
    const start = g.start;
    const end = g.moved ? g.end : Math.min(range.endHour * 60, start + 30);
    setDraw(null);
    if (form.editingId !== null) {
      say('Trwa poprawka wpisu. Zapisz ją albo anuluj, zanim zaczniesz nowy.', 'info');
      return;
    }
    patch({ startMinutes: start, endMinutes: end });
    setFocusSignal((n) => n + 1);
  };

  if (person === undefined) {
    return (
      <section className="tt-empty-state">
        Wybierz osobę w nagłówku (albo zaloguj się), żeby wpisywać czas pracy.
      </section>
    );
  }

  const hours: number[] = [];
  for (let h = range.startHour; h <= range.endHour; h++) hours.push(h);

  const offTop = minuteToPx(Math.min(OFF_HOURS_START, range.endHour * 60), range);
  const offBottomFrom = minuteToPx(Math.max(OFF_HOURS_END, range.startHour * 60), range);

  const columnStyle = (startMinutes: number, endMinutes: number, slot?: { col: number; cols: number }) => {
    const top = minuteToPx(startMinutes, range);
    const height = Math.max(18, minuteToPx(endMinutes, range) - top - 2);
    const style: React.CSSProperties = { top, height };
    if (slot && slot.cols > 1) {
      const w = 100 / slot.cols;
      style.left = `calc(${slot.col * w}% + 6px)`;
      style.width = `calc(${w}% - 9px)`;
      style.right = 'auto';
    }
    return style;
  };

  return (
    <section className="tt" aria-label="Czas pracy: plan obok wykonania">
      <TimeTrackerBar
        state={state}
        personId={personId}
        date={date}
        form={form}
        status={status}
        saveState={saveState}
        savedAtLabel={savedAtLabel}
        onChange={patch}
        onSubmit={submit}
        onCancel={resetForm}
        focusSignal={focusSignal}
      />

      {pastDue.length > 0 && settleDismissed !== settleKey ? (
        <div className="tt-settle" role="region" aria-label="Rozliczenie dnia">
          <div className="tt-settle-text">
            <b>
              {(date < today ? 'Ten miniony dzień ma' : 'Dzień pracy się skończył:')}{' '}
              {pastDue.length === 1
                ? '1 zaplanowany blok bez wykonania.'
                : blocksNoun(pastDue.length) === 'bloki'
                  ? `${pastDue.length} zaplanowane bloki bez wykonania.`
                  : `${pastDue.length} zaplanowanych bloków bez wykonania.`}
            </b>
            <span className="tt-settle-list">
              {pastDue
                .map((item) => `„${item.title}” ${formatMinutes(item.startMinutes)}-${formatMinutes(item.endMinutes)}`)
                .join(' · ')}
            </span>
            <span>Zaliczyć jako wykonane (wpis 1:1 w godzinach bloku), czy oddać godziny do zasobnika?</span>
          </div>
          <div className="tt-settle-actions">
            <button type="button" className="tt-settle-btn primary" onClick={settlePastAsDone}>
              Zalicz jako wykonane
            </button>
            <button type="button" className="tt-settle-btn" onClick={settlePastToBin}>
              Oddaj do zasobnika
            </button>
            <button type="button" className="tt-settle-btn ghost" onClick={() => setSettleDismissed(settleKey)}>
              Zostaw plan
            </button>
          </div>
        </div>
      ) : null}

      <div className="tt-body">
        <div className="tt-grid">
          <div className="tt-col-head tt-col-head-plan">
            <h2>Plan</h2>
            <span>{plannedToday > 0 ? `${formatMinutesDuration(plannedToday)} zaplanowane` : 'nic nie zaplanowano'}</span>
            {canPlanFromBin && binRows.length > 0 ? (
              <button
                type="button"
                className="tt-bin-add"
                aria-haspopup="dialog"
                aria-expanded={binOpen}
                onClick={(e) => openBinAdd(e.currentTarget)}
              >
                + Z zasobnika
              </button>
            ) : null}
          </div>
          <div className="tt-axis-head" aria-hidden />
          <div className="tt-col-head tt-col-head-work">
            <h2>Wykonanie</h2>
            <span>{loggedToday > 0 ? `${formatMinutesDuration(loggedToday)} zalogowane` : 'jeszcze nic'}</span>
          </div>

          <div className="tt-col tt-col-plan" style={{ height: axisHeight }}>
            <div className="tt-grid-bg" style={{ '--tt-hour': `${TRACKER_PX_PER_HOUR}px` } as React.CSSProperties} />
            <div className="tt-offhours" style={{ top: 0, height: Math.max(0, offTop) }} />
            <div className="tt-offhours" style={{ top: offBottomFrom, bottom: 0 }} />
            {plan.length === 0 && gcalItems.length === 0 && canPlanFromBin && binRows.length > 0 ? (
              <div className="tt-plan-empty">
                <span>Nic nie zaplanowano na ten dzień.</span>
                <button type="button" className="tt-settle-btn" onClick={(e) => openBinAdd(e.currentTarget)}>
                  + Dodaj z zasobnika
                </button>
              </div>
            ) : null}
            {plan.map((item) => {
              if (item.kind === 'event') {
                const slot = planLayout.get(`ev-${item.event.id}-${item.startMinutes}`);
                const counted = item.entry !== undefined;
                const density = trackerDensityClass(item.endMinutes - item.startMinutes);
                return (
                  <button
                    key={`ev-${item.event.id}-${item.startMinutes}`}
                    type="button"
                    className={`tt-plan-item tt-event${counted ? ' counted' : ''}${density ? ` ${density}` : ''}`}
                    style={columnStyle(item.startMinutes, item.endMinutes, slot)}
                    onClick={() =>
                      clickMeeting({
                        title: item.title,
                        startMinutes: item.startMinutes,
                        endMinutes: item.endMinutes,
                        entry: item.entry,
                        eventId: item.event.id,
                      })
                    }
                    title={counted ? 'Liczy się jako czas pracy. Kliknij, żeby cofnąć' : 'Byłeś naprawdę? Kliknij, a spotkanie wpadnie do paska'}
                  >
                    <span className="tt-item-title">{item.title}</span>
                    {density === 'h-quarter' ? (
                      <span className="tt-item-time inline">
                        {formatMinutes(item.startMinutes)}-{formatMinutes(item.endMinutes)}
                      </span>
                    ) : (
                      <span className="tt-item-time">
                        {formatMinutes(item.startMinutes)}-{formatMinutes(item.endMinutes)} · {formatMinutesDuration(item.endMinutes - item.startMinutes)}
                      </span>
                    )}
                    {density !== 'h-quarter' && density !== 'h-half' ? (
                      <span className="tt-item-meta">{counted ? '✓ liczy się' : 'spotkanie, nie liczy się samo'}</span>
                    ) : null}
                  </button>
                );
              }
              const slot = planLayout.get(item.block.id);
              const pct = Math.min(100, (item.portionLogged / item.plannedMinutes) * 100);
              const leftPortion = Math.max(0, item.plannedMinutes - item.portionLogged);
              const leftTask = item.estimateMinutes === null ? null : Math.max(0, item.estimateMinutes - item.taskLogged);
              const over = item.estimateMinutes !== null && item.taskLogged > item.estimateMinutes;
              // Gęstość treści z minut bloku (21 px na kwadrans): kwadrans = jedna
              // linia, pół godziny = tytuł + godziny, 45 min = + klient/projekt,
              // godzina = + pasek postępu, dłuższe = pełna treść z tekstem postępu.
              const density = trackerDensityClass(item.plannedMinutes);
              const compact = density === 'h-quarter' || density === 'h-half';
              return (
                <div
                  key={item.block.id}
                  className={`tt-plan-item tt-block${item.done ? ' done' : ''}${item.taskDone ? ' task-done' : ''}${density ? ` ${density}` : ''}`}
                  style={columnStyle(item.startMinutes, item.endMinutes, slot)}
                  title={`${item.title} · ${item.clientName}${item.clientName && item.projectName ? ' · ' : ''}${item.projectName}`}
                >
                  <div className="tt-item-head">
                    <button
                      type="button"
                      className={`tt-tick${item.done ? ' on' : ''}`}
                      aria-pressed={item.blockDone}
                      aria-label={item.blockDone ? `Cofnij wykonanie bloku: ${item.title}` : `Oznacz blok jako wykonany: ${item.title}`}
                      title={
                        item.blockDone
                          ? 'Blok wykonany (wpis 1:1 po prawej). Kliknij, żeby cofnąć'
                          : 'Zrobione zgodnie z planem? Klik dodaje wpis 1:1 w godzinach bloku'
                      }
                      disabled={item.taskDone}
                      onClick={() => toggleBlockDone(item)}
                    >
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M5 12l5 5L20 7" />
                      </svg>
                    </button>
                    <span className="tt-item-title">{item.title}</span>
                    {over && item.estimateMinutes !== null ? (
                      <span className="tt-over" title="Ponad estymatę zadania">
                        +{formatMinutesDuration(item.taskLogged - item.estimateMinutes)}
                      </span>
                    ) : null}
                    {density === 'h-quarter' ? (
                      <span className="tt-item-time inline">
                        {formatMinutes(item.startMinutes)}-{formatMinutes(item.endMinutes)}
                      </span>
                    ) : null}
                  </div>
                  {!compact ? (
                    <div className="tt-item-meta">
                      {item.clientName}
                      {item.clientName && item.projectName ? ' · ' : ''}
                      {item.projectName}
                    </div>
                  ) : null}
                  {density !== 'h-quarter' ? (
                    <div className="tt-item-time">
                      {formatMinutes(item.startMinutes)}-{formatMinutes(item.endMinutes)} · {formatMinutesDuration(item.plannedMinutes)}
                    </div>
                  ) : null}
                  {density === '' || density === 'h-hour' ? (
                    <div className="tt-progress">
                      <div className="tt-progress-bar">
                        <i style={{ width: `${pct}%` }} />
                      </div>
                      {density === '' ? (
                        <div className="tt-progress-text">
                          <span>
                            porcja <b>{formatMinutesDuration(item.portionLogged)}</b> z {formatMinutesDuration(item.plannedMinutes)} · zadanie{' '}
                            <b>{formatMinutesDuration(item.taskLogged)}</b>
                            {item.estimateMinutes === null ? ' (bez estymaty)' : ` z ${formatMinutesDuration(item.estimateMinutes)}`}
                          </span>
                          <span className={`tt-rest${item.done || (leftPortion === 0 && leftTask === 0) ? ' ok' : ''}`}>
                            {item.taskDone
                              ? '✓ zadanie zrobione'
                              : item.done
                                ? '✓ wykonane'
                                : leftPortion > 0
                                ? `zostało ${formatMinutesDuration(leftPortion)}`
                                : leftTask !== null && leftTask > 0
                                  ? `w zadaniu jeszcze ${formatMinutesDuration(leftTask)}`
                                  : leftTask === 0
                                    ? '✓ wyrobione'
                                    : ''}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {gcalItems.map((item) => {
              const slot = planLayout.get(item.key);
              const counted = item.entry !== undefined;
              const density = trackerDensityClass(item.endMinutes - item.startMinutes);
              return (
                <button
                  key={item.key}
                  type="button"
                  className={`tt-plan-item tt-event gcal${counted ? ' counted' : ''}${density ? ` ${density}` : ''}`}
                  style={columnStyle(item.startMinutes, item.endMinutes, slot)}
                  onClick={() =>
                    clickMeeting({
                      title: item.title,
                      startMinutes: item.startMinutes,
                      endMinutes: item.endMinutes,
                      entry: item.entry,
                      eventId: item.key,
                    })
                  }
                  title={
                    counted
                      ? 'Spotkanie z Google liczy się jako czas pracy. Kliknij, żeby cofnąć'
                      : 'Spotkanie z Kalendarza Google. Byłeś naprawdę? Kliknij, a wpadnie do paska'
                  }
                >
                  <span className="tt-item-title">
                    <span className="gcal-badge" aria-hidden>
                      G
                    </span>
                    {item.title}
                  </span>
                  {density === 'h-quarter' ? (
                    <span className="tt-item-time inline">
                      {formatMinutes(item.startMinutes)}-{formatMinutes(item.endMinutes)}
                    </span>
                  ) : (
                    <span className="tt-item-time">
                      {formatMinutes(item.startMinutes)}-{formatMinutes(item.endMinutes)} · {formatMinutesDuration(item.endMinutes - item.startMinutes)}
                    </span>
                  )}
                  {density !== 'h-quarter' && density !== 'h-half' ? (
                    <span className="tt-item-meta">{counted ? '✓ liczy się' : 'Google, nie liczy się samo'}</span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="tt-axis" style={{ height: axisHeight }} aria-hidden>
            {hours.map((h) => (
              <span
                key={h}
                className={`tt-hour${nowMinutes !== null && Math.abs(h * 60 - nowMinutes) < 30 ? ' now' : ''}`}
                style={{ top: minuteToPx(h * 60, range) }}
              >
                {String(h).padStart(2, '0')}:00
              </span>
            ))}
          </div>

          <div
            ref={workColRef}
            className={`tt-col tt-col-work${draw !== null ? ' drawing' : ''}`}
            style={{ height: axisHeight }}
            onPointerDown={onWorkPointerDown}
            onPointerMove={onWorkPointerMove}
            onPointerUp={onWorkPointerUp}
            onPointerCancel={() => setDraw(null)}
            aria-label="Oś wykonania: przeciągnij, żeby zaznaczyć zakres, kliknij, żeby wstawić 30 minut"
          >
            <div className="tt-grid-bg" style={{ '--tt-hour': `${TRACKER_PX_PER_HOUR}px` } as React.CSSProperties} />
            <div className="tt-offhours" style={{ top: 0, height: Math.max(0, offTop) }} />
            <div className="tt-offhours" style={{ top: offBottomFrom, bottom: 0 }} />
            {entries.map((entry) => {
              const t = getTask(state, entry.taskId);
              const project = t ? getProject(state, t.projectId) : undefined;
              const client = project ? getClient(state, project.clientId) : undefined;
              const editing = form.editingId === entry.id;
              const minutes = entry.endMinutes - entry.startMinutes;
              const density = trackerDensityClass(minutes);
              return (
                <div
                  key={entry.id}
                  className={`tt-entry${editing ? ' editing' : ''}${entry.source === 'event' ? ' from-event' : ''}${density ? ` ${density}` : ''}`}
                  style={columnStyle(entry.startMinutes, entry.endMinutes)}
                  role="button"
                  tabIndex={0}
                  title="Kliknij, żeby poprawić godziny albo zadanie"
                  onClick={() => startEdit(entry)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      startEdit(entry);
                    }
                  }}
                >
                  <button
                    type="button"
                    className="tt-entry-delete"
                    aria-label="Skasuj wpis"
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(entry);
                    }}
                  >
                    ×
                  </button>
                  <span className="tt-item-title">{t ? taskDisplayTitle(state, t) : 'Zadanie'}</span>
                  {density === 'h-quarter' ? (
                    <span className="tt-item-time inline">
                      {formatMinutes(entry.startMinutes)}-{formatMinutes(entry.endMinutes)}
                    </span>
                  ) : null}
                  {density !== 'h-quarter' && density !== 'h-half' ? (
                    <span className="tt-item-meta">
                      {client?.name ?? ''}
                      {client && project ? ' · ' : ''}
                      {project ? projectDisplayName(state, project) : ''}
                      {entry.source === 'event' ? ' · ze spotkania' : ''}
                    </span>
                  ) : null}
                  {density !== 'h-quarter' ? (
                    <span className="tt-item-time">
                      {formatMinutes(entry.startMinutes)}-{formatMinutes(entry.endMinutes)} · {formatMinutesDuration(minutes)}
                    </span>
                  ) : null}
                </div>
              );
            })}
            {draw !== null ? (
              <div className="tt-draw-ghost" style={columnStyle(draw.start, draw.end)} aria-hidden>
                {formatMinutes(draw.start)}-{formatMinutes(draw.end)} · {formatMinutesDuration(draw.end - draw.start)}
              </div>
            ) : null}
            {nowMinutes !== null && nowMinutes >= range.startHour * 60 && nowMinutes <= range.endHour * 60 ? (
              <div className="tt-nowline" style={{ top: minuteToPx(nowMinutes, range) }} aria-hidden />
            ) : null}
          </div>
        </div>

        <aside className="tt-side" aria-label="Podsumowanie czasu">
          <div className="tt-kpi">
            <div className="tt-ring" style={{ '--tt-p': Math.min(100, (loggedToday / dayNorm) * 100) } as React.CSSProperties} aria-hidden />
            <div>
              <div className="tt-kpi-label">Zalogowane tego dnia</div>
              <div className="tt-kpi-value">
                {formatMinutesDuration(loggedToday)}
                <small> z {formatMinutesDuration(plannedToday)} zaplanowanych</small>
              </div>
              {loggedToday > dayNorm ? (
                <div className="tt-kpi-warn">ponad normę dnia o {formatMinutesDuration(loggedToday - dayNorm)}</div>
              ) : null}
            </div>
          </div>
          <div className="tt-kpi-row">
            <span>Tydzień</span>
            <b>{formatMinutesDuration(loggedWeek)}</b>
            <small>z {formatMinutesDuration(Math.round(person.capacity * 60 * person.workDays.length))} normy</small>
          </div>
          {overruns.length > 0 ? (
            <>
              <h3 className="tt-side-title tt-side-title-warn">Ponad sprzedane (tydzień)</h3>
              {overruns.map((o) => (
                <div className="tt-client-project tt-overrun-row" key={o.taskId}>
                  <span title={`${o.clientName}${o.clientName && o.projectName ? ' · ' : ''}${o.projectName}`}>{o.title}</span>
                  <span>+{formatMinutesDuration(o.overrunMinutes)}</span>
                </div>
              ))}
            </>
          ) : null}
          <div className="tt-side-head">
            <h3 className="tt-side-title">{sideBy === 'projects' ? 'Ile na kogo' : 'Ile na co'}</h3>
            <div className="tt-side-segs">
              <div className="tt-seg" role="group" aria-label="Grupowanie podsumowania">
                <button
                  type="button"
                  className={sideBy === 'projects' ? 'active' : ''}
                  aria-pressed={sideBy === 'projects'}
                  onClick={() => setSideBy('projects')}
                >
                  Projekty
                </button>
                <button
                  type="button"
                  className={sideBy === 'tasks' ? 'active' : ''}
                  aria-pressed={sideBy === 'tasks'}
                  onClick={() => setSideBy('tasks')}
                >
                  Zadania
                </button>
              </div>
              <div className="tt-seg" role="group" aria-label="Zakres podsumowania">
                <button
                  type="button"
                  className={sideScope === 'day' ? 'active' : ''}
                  aria-pressed={sideScope === 'day'}
                  onClick={() => setSideScope('day')}
                >
                  Dzień
                </button>
                <button
                  type="button"
                  className={sideScope === 'week' ? 'active' : ''}
                  aria-pressed={sideScope === 'week'}
                  onClick={() => setSideScope('week')}
                >
                  Tydzień
                </button>
              </div>
            </div>
          </div>
          {sideBy === 'tasks' ? (
            taskSums.length === 0 ? (
              <p className="tt-side-empty">
                {sideScope === 'day' ? 'Nic jeszcze nie zalogowano tego dnia.' : 'Nic jeszcze nie zalogowano w tym tygodniu.'}
              </p>
            ) : (
              taskSums.map((row) => {
                const max = taskSums[0].loggedMinutes || 1;
                const where = `${row.clientName}${row.clientName && row.projectName ? ' · ' : ''}${row.projectName}`;
                return (
                  <div className="tt-task-row" key={row.taskId}>
                    <div className="tt-client-head">
                      <span title={where}>
                        <span className="tt-task-row-title">{row.title}</span>
                        {row.closed ? <span className="tt-tag closed">zamknięte</span> : null}
                      </span>
                      <b>{formatMinutesDuration(row.loggedMinutes)}</b>
                    </div>
                    <div className="tt-client-bar">
                      <i style={{ width: `${(row.loggedMinutes / max) * 100}%` }} />
                    </div>
                    <div className="tt-client-project">
                      <span>{where}</span>
                      <span>{row.plannedMinutes > 0 ? <small>plan {formatMinutesDuration(row.plannedMinutes)}</small> : null}</span>
                    </div>
                  </div>
                );
              })
            )
          ) : clientSums.length === 0 ? (
            <p className="tt-side-empty">
              {sideScope === 'day' ? 'Nic jeszcze nie zalogowano tego dnia.' : 'Nic jeszcze nie zalogowano w tym tygodniu.'}
            </p>
          ) : (
            clientSums.map((c) => {
              const max = clientSums[0].loggedMinutes || 1;
              return (
                <div className="tt-client" key={c.clientId}>
                  <div className="tt-client-head">
                    <span>{c.clientName}</span>
                    <b>{formatMinutesDuration(c.loggedMinutes)}</b>
                  </div>
                  <div className="tt-client-bar">
                    <i style={{ width: `${(c.loggedMinutes / max) * 100}%` }} />
                  </div>
                  {c.projects.map((p) => (
                    <div className="tt-client-project" key={p.projectId}>
                      <span>{p.projectName}</span>
                      <span>
                        {formatMinutesDuration(p.loggedMinutes)}
                        {p.plannedMinutes > 0 ? <small> z {formatMinutesDuration(p.plannedMinutes)}</small> : null}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })
          )}
          <p className="tt-side-foot">
            Plan zostaje zapisem tego, co miało być. Wykonanie liczy się wyłącznie z wpisów; nic nie dolicza się samo.
          </p>
        </aside>
      </div>

      {binOpen && binRow !== undefined ? (
        <OverlayLayer>
          <div
            ref={binPopRef}
            className="tt-bin-popover"
            style={binOverlay.style}
            role="dialog"
            aria-label="Dodaj do planu z zasobnika"
          >
            <div className="tt-bin-pop-title">Dodaj do planu z zasobnika</div>
            <label className="tt-bin-field">
              Zadanie
              <select value={binEntryId} onChange={(e) => onBinTaskChange(e.target.value)}>
                {binRows.map((r) => (
                  <option key={r.entry.id} value={r.entry.id}>
                    {r.title}
                    {r.clientName !== '' ? ` · ${r.clientName}` : ''} — {formatDuration(r.entry.plannedHours)} w zasobniku
                  </option>
                ))}
              </select>
            </label>
            <div className="tt-bin-row">
              <label className="tt-bin-field">
                Start
                <input type="time" step={900} value={binStart} onChange={(e) => setBinStart(e.target.value)} />
              </label>
              <label className="tt-bin-field">
                Godziny
                <input
                  type="number"
                  min={0.25}
                  max={snapHours(binRow.entry.plannedHours)}
                  step={0.25}
                  value={binHoursRaw}
                  onChange={(e) => setBinHoursRaw(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitBinAdd();
                  }}
                />
              </label>
            </div>
            {binWarning !== null ? <p className="tt-bin-warning">{binWarning}</p> : null}
            <div className="tt-settle-actions">
              <button type="button" className="tt-settle-btn primary" onClick={submitBinAdd} disabled={binDisabled}>
                Dodaj do planu
              </button>
              <button type="button" className="tt-settle-btn ghost" onClick={() => setBinOpen(false)}>
                Anuluj
              </button>
            </div>
          </div>
        </OverlayLayer>
      ) : null}
    </section>
  );
}
