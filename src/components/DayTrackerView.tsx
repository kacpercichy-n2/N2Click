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
import type { AppData, DateStr, TimeEntry } from '../types';
import { usePersistence, useStoreApi, type Action } from '../store/AppStore';
import { useSaveStatus } from '../utils/useSaveStatus';
import { activeStatuses, getClient, getPerson, getProject, getTask } from '../store/selectors';
import { projectDisplayName, taskDisplayTitle } from '../store/confidentiality';
import {
  clientTimeSummary,
  dayPlanForPerson,
  loggedMinutesForPersonDate,
  loggedMinutesForPersonDates,
  loggedMinutesForTask,
  loggedMinutesForTaskPersonDate,
  plannedMinutesForPersonDate,
  resolveTaskByTitle,
  timeEntriesForPersonDate,
  type DayPlanItem,
} from '../store/timeTracking';
import { formatMinutes, hoursToMinutes } from '../utils/time';
import { findOverlappingEntry, formatMinutesDuration, isValidTimeRange } from '../utils/timeTracking';
import { isTodayStr, weekDays } from '../utils/dates';
import { useNowTick } from '../utils/useNowTick';
import { TimeTrackerBar, type TrackerFormState, type TrackerStatus } from './TimeTrackerBar';
import {
  TRACKER_PX_PER_HOUR,
  axisHourRange,
  layoutColumns,
  minuteToPx,
  pxToSnappedMinute,
  type HourRange,
} from './dayTrackerLayout';

interface Props {
  state: AppData;
  dispatch: React.Dispatch<Action>;
  date: DateStr;
}

/** Norma dnia do pierścienia: godziny pracy osoby z profilu (domyślnie 8h). */
const DEFAULT_DAY_NORM_MINUTES = 8 * 60;
const STATUS_TTL_MS = 7000;
const OFF_HOURS_START = 9 * 60;
const OFF_HOURS_END = 17 * 60;

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
  const range: HourRange = useMemo(
    () => axisHourRange([...plan, ...entries]),
    [plan, entries],
  );
  const planLayout = useMemo(
    () =>
      layoutColumns(
        plan.map((p) => ({
          id: p.kind === 'block' ? p.block.id : `ev-${p.event.id}-${p.startMinutes}`,
          startMinutes: p.startMinutes,
          endMinutes: p.endMinutes,
        })),
      ),
    [plan],
  );
  const axisHeight = (range.endHour - range.startHour) * TRACKER_PX_PER_HOUR;

  const loggedToday = loggedMinutesForPersonDate(state, personId, date);
  const plannedToday = plannedMinutesForPersonDate(state, personId, date);
  const week = useMemo(() => weekDays(date), [date]);
  const loggedWeek = loggedMinutesForPersonDates(state, personId, week);
  const clientSums = useMemo(() => clientTimeSummary(state, personId, week), [state, personId, week]);
  const dayNorm = person ? Math.max(60, Math.round(person.capacity * 60)) : DEFAULT_DAY_NORM_MINUTES;

  // ---- zapis ----
  const submit = () => {
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
      if (res.kind === 'one') taskId = res.task.id;
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
        say(
          res.kind === 'closed'
            ? `Zadanie „${res.task.title}” jest zamknięte i nie przyjmuje czasu. Otwórz je ptaszkiem na kaflu albo wybierz „+ nowe zadanie” z listy.`
            : `Nie ma takiego zadania. Wybierz je z listy albo „+ nowe zadanie”, żeby je założyć.`,
          'error',
        );
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
      const ok = commit(
        { type: 'UPDATE_TIME_ENTRY', entryId: editingId, taskId, startMinutes, endMinutes },
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
      say(
        `Dodane: „${t ? taskDisplayTitle(after, t) : ''}” ma tego dnia ${formatMinutesDuration(today)}, razem ${formatMinutesDuration(total)}${est}.`,
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

  // ---- plan: ptaszek i spotkania ----
  const toggleDone = (taskId: string, done: boolean) => {
    const statuses = activeStatuses(state);
    const target = done
      ? statuses.find((s) => !s.isDone) ?? state.statuses.find((s) => !s.isDone)
      : statuses.find((s) => s.isDone) ?? state.statuses.find((s) => s.isDone);
    if (target === undefined) return;
    const t = getTask(state, taskId);
    if (
      !commit(
        { type: 'SET_TASK_STATUS', taskId, statusId: target.id },
        (after) => after.tasks.some((x) => x.id === taskId && x.statusId === target.id),
      )
    ) {
      say('Nie udało się zmienić statusu zadania. Odśwież widok i spróbuj ponownie.', 'error');
      return;
    }
    say(
      done
        ? `„${t ? taskDisplayTitle(state, t) : ''}” wraca do statusu „${target.name}”.`
        : `„${t ? taskDisplayTitle(state, t) : ''}” dostało status „${target.name}”. Znika z podpowiedzi i nie przyjmuje czasu.`,
      'info',
    );
  };
  const clickEvent = (item: Extract<DayPlanItem, { kind: 'event' }>) => {
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
      eventId: item.event.id,
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

  // ---- „teraz" ----
  const now = useNowTick(60_000);
  const nowMinutes = isTodayStr(date) ? now.getHours() * 60 + now.getMinutes() : null;

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

      <div className="tt-body">
        <div className="tt-grid">
          <div className="tt-col-head tt-col-head-plan">
            <h2>Plan</h2>
            <span>{plannedToday > 0 ? `${formatMinutesDuration(plannedToday)} zaplanowane` : 'nic nie zaplanowano'}</span>
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
            {plan.map((item) => {
              if (item.kind === 'event') {
                const slot = planLayout.get(`ev-${item.event.id}-${item.startMinutes}`);
                const counted = item.entry !== undefined;
                return (
                  <button
                    key={`ev-${item.event.id}-${item.startMinutes}`}
                    type="button"
                    className={`tt-plan-item tt-event${counted ? ' counted' : ''}`}
                    style={columnStyle(item.startMinutes, item.endMinutes, slot)}
                    onClick={() => clickEvent(item)}
                    title={counted ? 'Liczy się jako czas pracy. Kliknij, żeby cofnąć' : 'Byłeś naprawdę? Kliknij, a spotkanie wpadnie do paska'}
                  >
                    <span className="tt-item-title">{item.title}</span>
                    <span className="tt-item-time">
                      {formatMinutes(item.startMinutes)}-{formatMinutes(item.endMinutes)} · {formatMinutesDuration(item.endMinutes - item.startMinutes)}
                    </span>
                    <span className="tt-item-meta">{counted ? '✓ liczy się' : 'spotkanie, nie liczy się samo'}</span>
                  </button>
                );
              }
              const slot = planLayout.get(item.block.id);
              const pct = Math.min(100, (item.portionLogged / item.plannedMinutes) * 100);
              const leftPortion = Math.max(0, item.plannedMinutes - item.portionLogged);
              const leftTask = item.estimateMinutes === null ? null : Math.max(0, item.estimateMinutes - item.taskLogged);
              const over = item.estimateMinutes !== null && item.taskLogged > item.estimateMinutes;
              const short = item.plannedMinutes <= 30;
              return (
                <div
                  key={item.block.id}
                  className={`tt-plan-item tt-block${item.done ? ' done' : ''}${short ? ' short' : ''}`}
                  style={columnStyle(item.startMinutes, item.endMinutes, slot)}
                  title={`${item.title} · ${item.clientName}${item.clientName && item.projectName ? ' · ' : ''}${item.projectName}`}
                >
                  <div className="tt-item-head">
                    <button
                      type="button"
                      className={`tt-tick${item.done ? ' on' : ''}`}
                      aria-pressed={item.done}
                      aria-label={item.done ? `Cofnij status zrobione: ${item.title}` : `Oznacz jako zrobione: ${item.title}`}
                      title={item.done ? 'Status „zrobione”. Kliknij, żeby wrócić do aktywnego' : 'Skończone? Klik ustawia status „zrobione”: znika z podpowiedzi i nie przyjmuje czasu'}
                      onClick={() => toggleDone(item.task.id, item.done)}
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
                  </div>
                  {!short ? (
                    <>
                      <div className="tt-item-meta">
                        {item.clientName}
                        {item.clientName && item.projectName ? ' · ' : ''}
                        {item.projectName}
                      </div>
                      <div className="tt-item-time">
                        {formatMinutes(item.startMinutes)}-{formatMinutes(item.endMinutes)} · {formatMinutesDuration(item.plannedMinutes)}
                      </div>
                      <div className="tt-progress">
                        <div className="tt-progress-bar">
                          <i style={{ width: `${pct}%` }} />
                        </div>
                        <div className="tt-progress-text">
                          <span>
                            porcja <b>{formatMinutesDuration(item.portionLogged)}</b> z {formatMinutesDuration(item.plannedMinutes)} · zadanie{' '}
                            <b>{formatMinutesDuration(item.taskLogged)}</b>
                            {item.estimateMinutes === null ? ' (bez estymaty)' : ` z ${formatMinutesDuration(item.estimateMinutes)}`}
                          </span>
                          <span className={`tt-rest${item.done || (leftPortion === 0 && leftTask === 0) ? ' ok' : ''}`}>
                            {item.done
                              ? '✓ zrobione'
                              : leftPortion > 0
                                ? `zostało ${formatMinutesDuration(leftPortion)}`
                                : leftTask !== null && leftTask > 0
                                  ? `w zadaniu jeszcze ${formatMinutesDuration(leftTask)}`
                                  : leftTask === 0
                                    ? '✓ wyrobione'
                                    : ''}
                          </span>
                        </div>
                      </div>
                    </>
                  ) : null}
                </div>
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
              return (
                <div
                  key={entry.id}
                  className={`tt-entry${editing ? ' editing' : ''}${entry.source === 'event' ? ' from-event' : ''}${minutes <= 30 ? ' short' : ''}`}
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
                  {minutes > 30 ? (
                    <span className="tt-item-meta">
                      {client?.name ?? ''}
                      {client && project ? ' · ' : ''}
                      {project ? projectDisplayName(state, project) : ''}
                      {entry.source === 'event' ? ' · ze spotkania' : ''}
                    </span>
                  ) : null}
                  <span className="tt-item-time">
                    {formatMinutes(entry.startMinutes)}-{formatMinutes(entry.endMinutes)} · {formatMinutesDuration(minutes)}
                  </span>
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
          <h3 className="tt-side-title">Ile na kogo (tydzień)</h3>
          {clientSums.length === 0 ? (
            <p className="tt-side-empty">Nic jeszcze nie zalogowano w tym tygodniu.</p>
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
    </section>
  );
}
