// Selektory trackera czasu pracy — POCHODNE odczyty nad `state.timeEntries`
// (wykonanie) i `state.workload` (plan). Czyste, bez Reacta; kolekcja wpisów
// jest mała (dni × kilka wpisów), więc zwykłe filtry bez indeksów.
//
// Granice:
//   * Plan i wykonanie to DWIE prawdy: nic tutaj nie zmienia `workload`, a suma
//     dnia liczy się WYŁĄCZNIE z wpisów (inwariant 1 dotyczy planu, nie trackera).
//   * Utajniona treść: tytuły przez `taskDisplayTitle`; zadania zamaskowane dla
//     widza nie trafiają do podpowiedzi.
//   * Zadanie „zrobione" (`Status.isDone`) i szkic nie podpowiadają się — status
//     jest jedynym znacznikiem zamknięcia (inwariant 5).
import type { AppData, DateStr, Task, TimeEntry, WorkloadEntry, CalendarEvent } from '../types';
import {
  blocksForPersonDate,
  calendarEventsForDate,
  getClient,
  getProject,
  getTask,
  isDoneStatus,
  isDraftTask,
  personAbsentFromEventOccurrence,
} from './selectors';
import { isTaskContentMasked, taskDisplayTitle, eventDisplayTitle, projectDisplayName } from './confidentiality';
import { DAY_MINUTES, hoursToMinutes, isBinEntry } from '../utils/time';
import { diffDays } from '../utils/dates';
import { SETTLE_GRACE_MINUTES, frecencyScore, timeEntryMinutes } from '../utils/timeTracking';
import { uncoveredEntryGaps } from './timeTrackingSync';

const sum = (xs: readonly TimeEntry[]): number => xs.reduce((s, e) => s + timeEntryMinutes(e), 0);

/** Wpisy osoby z danego dnia, rosnąco po starcie. */
export function timeEntriesForPersonDate(state: AppData, personId: string, date: DateStr): TimeEntry[] {
  return state.timeEntries
    .filter((e) => e.personId === personId && e.date === date)
    .sort((a, b) => a.startMinutes - b.startMinutes || a.id.localeCompare(b.id));
}

export function loggedMinutesForPersonDate(state: AppData, personId: string, date: DateStr): number {
  return sum(state.timeEntries.filter((e) => e.personId === personId && e.date === date));
}

export function loggedMinutesForPersonDates(state: AppData, personId: string, dates: readonly DateStr[]): number {
  const set = new Set(dates);
  return sum(state.timeEntries.filter((e) => e.personId === personId && set.has(e.date)));
}

/** Ile poszło na zadanie ze WSZYSTKICH osób i dni („zadanie 2h z 3h"). */
export function loggedMinutesForTask(state: AppData, taskId: string): number {
  return sum(state.timeEntries.filter((e) => e.taskId === taskId));
}

export function loggedMinutesForTaskPerson(state: AppData, taskId: string, personId: string): number {
  return sum(state.timeEntries.filter((e) => e.taskId === taskId && e.personId === personId));
}

export function loggedMinutesForTaskPersonDate(
  state: AppData,
  taskId: string,
  personId: string,
  date: DateStr,
): number {
  return sum(
    state.timeEntries.filter((e) => e.taskId === taskId && e.personId === personId && e.date === date),
  );
}

/** Zaplanowane minuty osoby w dniu: DATOWANE bloki (zasobnik nie wchodzi). */
export function plannedMinutesForPersonDate(state: AppData, personId: string, date: DateStr): number {
  return blocksForPersonDate(state, personId, date)
    .filter((b) => !isBinEntry(b))
    .reduce((s, b) => s + hoursToMinutes(b.plannedHours), 0);
}

/**
 * Ile zalogowanego czasu przypada na TĘ porcję planu. Zadanie może mieć tego
 * dnia kilka porcji (bloków) — zalogowany czas zadania z tego dnia wypełnia je
 * PO KOLEI, od najwcześniejszej (wpisy nie wiążą się z blokiem 1:1, bo plan i
 * wykonanie żyją osobno).
 */
export function portionLoggedMinutes(state: AppData, block: WorkloadEntry): number {
  const portions = blocksForPersonDate(state, block.personId, block.date)
    .filter((b) => b.taskId === block.taskId && !isBinEntry(b))
    .sort((a, b) => a.startMinutes - b.startMinutes || a.sortIndex - b.sortIndex);
  let pool = loggedMinutesForTaskPersonDate(state, block.taskId, block.personId, block.date);
  for (const p of portions) {
    const take = Math.min(pool, hoursToMinutes(p.plannedHours));
    if (p.id === block.id) return take;
    pool -= take;
  }
  return 0;
}

// ---- Plan dnia (lewa kolumna widoku „Dzień") ----

export interface DayPlanBlock {
  kind: 'block';
  block: WorkloadEntry;
  task: Task;
  title: string; // display (maska utajnienia)
  projectName: string;
  clientName: string;
  startMinutes: number;
  endMinutes: number;
  plannedMinutes: number;
  portionLogged: number;
  taskLogged: number; // wszystkie osoby i dni
  estimateMinutes: number | null;
  /** Blok wykonany (per blok) LUB zadanie ze statusem „zrobione". */
  done: boolean;
  /** Sam znacznik bloku (`WorkloadEntry.done`) — cel kółka. */
  blockDone: boolean;
  taskDone: boolean;
}
export interface DayPlanEvent {
  kind: 'event';
  event: CalendarEvent;
  title: string;
  startMinutes: number;
  endMinutes: number;
  /** Wpis trackera powstały z tego wystąpienia (klik „byłem"), jeśli istnieje. */
  entry: TimeEntry | undefined;
}
export type DayPlanItem = DayPlanBlock | DayPlanEvent;

/** Plan osoby na dzień: datowane bloki + spotkania (bez urlopu i bez wystąpień z RSVP „nie"). */
export function dayPlanForPerson(state: AppData, personId: string, date: DateStr): DayPlanItem[] {
  const out: DayPlanItem[] = [];
  for (const block of blocksForPersonDate(state, personId, date)) {
    if (isBinEntry(block)) continue;
    const task = getTask(state, block.taskId);
    if (task === undefined) continue;
    const project = getProject(state, task.projectId);
    const client = project === undefined ? undefined : getClient(state, project.clientId);
    const plannedMinutes = hoursToMinutes(block.plannedHours);
    out.push({
      kind: 'block',
      block,
      task,
      title: taskDisplayTitle(state, task),
      projectName: project === undefined ? '' : projectDisplayName(state, project),
      clientName: client?.name ?? '',
      startMinutes: block.startMinutes,
      endMinutes: block.startMinutes + plannedMinutes,
      plannedMinutes,
      portionLogged: portionLoggedMinutes(state, block),
      taskLogged: loggedMinutesForTask(state, task.id),
      estimateMinutes: task.estimatedHours === null ? null : hoursToMinutes(task.estimatedHours),
      done: block.done === true || isDoneStatus(state, task.statusId),
      blockDone: block.done === true,
      taskDone: isDoneStatus(state, task.statusId),
    });
  }
  const forPerson = new Set([personId]);
  for (const occ of calendarEventsForDate(state, date, forPerson)) {
    if (occ.event.kind === 'urlop') continue;
    if (personAbsentFromEventOccurrence(occ.event, date, personId)) continue;
    out.push({
      kind: 'event',
      event: occ.event,
      title: eventDisplayTitle(state, occ.event),
      startMinutes: occ.startMinutes,
      endMinutes: occ.startMinutes + occ.durationMinutes,
      entry: state.timeEntries.find(
        (e) => e.personId === personId && e.date === date && e.eventId === occ.event.id,
      ),
    });
  }
  return out.sort((a, b) => a.startMinutes - b.startMinutes);
}

/**
 * Bloki planu dnia bez pełnego wykonania — kandydaci do rozliczenia w widoku
 * „Dzień" dla dnia MINIONEGO. Blok wykonany (per blok albo statusem zadania)
 * i blok w pełni pokryty wpisami wypadają; kolejność planu zostaje.
 */
export function unsettledPlanBlocks(plan: DayPlanItem[]): DayPlanBlock[] {
  return plan.filter(
    (p): p is DayPlanBlock => p.kind === 'block' && !p.done && p.portionLogged < p.plannedMinutes,
  );
}

// ---- Rozliczenie dnia: do kiedy plan zostaje nietknięty, co pyta popout ----

/**
 * Bezwzględne odcięcie rozliczenia w minutach od północy OGLĄDANEGO dnia albo
 * `null`, gdy dzień jeszcze nie podlega rozliczeniu (decyzja usera 2026-09-02:
 * rozliczenie zawsze pyta, dzisiaj dopiero po końcu dnia pracy).
 *   * przyszłość: null;
 *   * dzień MINIONY: `dni różnicy × 1440 + zegar` — wczoraj tuż po północy blok
 *     kończący się o 24:00 ma jeszcze karencję (zmiana daty jej nie zabiera);
 *   * DZISIAJ: zegar, ale dopiero od końca dnia pracy + karencja; koniec pracy
 *     tak późny, że karencja nie mieści się w dobie (np. 24:00), oznacza „nie
 *     dzisiaj" — zapyta jako dzień miniony.
 */
export function settleCutoffMinutes(
  date: DateStr,
  today: DateStr,
  clockMinutes: number,
  workEndMinutes: number,
): number | null {
  const daysAgo = diffDays(date, today);
  if (daysAgo < 0) return null;
  if (daysAgo > 0) return daysAgo * DAY_MINUTES + clockMinutes;
  const dayEnd = workEndMinutes + SETTLE_GRACE_MINUTES;
  if (dayEnd >= DAY_MINUTES || clockMinutes < dayEnd) return null;
  return clockMinutes;
}

/** Bloki do rozliczenia przy danym odcięciu: niewykonane, bez pełnego pokrycia
 *  i zakończone co najmniej karencję przed odcięciem. `null` = nic. */
export function settleDueBlocks(plan: DayPlanItem[], cutoff: number | null): DayPlanBlock[] {
  if (cutoff === null) return [];
  return unsettledPlanBlocks(plan).filter((b) => b.endMinutes + SETTLE_GRACE_MINUTES <= cutoff);
}

// ---- Podpowiedzi paska ----

export interface TrackerSuggestion {
  task: Task;
  title: string;
  projectName: string;
  clientName: string;
  plannedToday: boolean;
  loggedMinutes: number; // wszystkie osoby i dni
  estimateMinutes: number | null;
  /** Zadanie ze statusem „zrobione": nadal przyjmuje czas, ale pasek to mówi. */
  closed: boolean;
}

/** Zadanie widoczne dla trackera: nie szkic, nie zamaskowane utajnieniem. */
function taskVisibleForTracker(state: AppData, task: Task): boolean {
  return !isDraftTask(task) && !isTaskContentMasked(state, task);
}
/** Aktywne = widoczne i bez statusu „zrobione". */
function taskLoggable(state: AppData, task: Task): boolean {
  return taskVisibleForTracker(state, task) && !isDoneStatus(state, task.statusId);
}

const fold = (s: string): string =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');

/**
 * Zadania do paska „Nad czym pracowałeś?": NIE szkice, NIE zamaskowane.
 * Zadania „zrobione" TEŻ (2026-09-02, zgłoszenie „Odhaczanie tasków w widoku
 * dnia"): drobne, powtarzalne zadania („Rozmowa z klientem") bywają zamknięte
 * ptaszkiem, a nazajutrz znów potrzebne — wracają w podpowiedziach z rankingu
 * „częstość × świeżość", z flagą `closed` i bez premii „dziś w planie".
 * Kolejność: zaplanowane tego dnia u tej osoby na górze, potem ranking
 * frecency z WŁASNYCH wpisów tej osoby (zamknięte z lekką karą), potem tytuł.
 * `query` filtruje po tytule, projekcie i kliencie (bez rozróżniania ogonków).
 */
export function trackerSuggestions(
  state: AppData,
  personId: string,
  date: DateStr,
  query: string,
  limit = 8,
): TrackerSuggestion[] {
  const q = fold(query.trim());
  const planned = new Set(
    blocksForPersonDate(state, personId, date)
      .filter((b) => !isBinEntry(b))
      .map((b) => b.taskId),
  );
  const uses = new Map<string, { n: number; last: DateStr }>();
  for (const e of state.timeEntries) {
    if (e.personId !== personId) continue;
    const u = uses.get(e.taskId);
    if (u === undefined) uses.set(e.taskId, { n: 1, last: e.date });
    else {
      u.n += 1;
      if (e.date > u.last) u.last = e.date;
    }
  }
  const rows = state.tasks
    .filter((t) => taskVisibleForTracker(state, t))
    .map((task) => {
      const project = getProject(state, task.projectId);
      const client = project === undefined ? undefined : getClient(state, project.clientId);
      const title = taskDisplayTitle(state, task);
      const projectName = project === undefined ? '' : projectDisplayName(state, project);
      const clientName = client?.name ?? '';
      const hay = fold(`${title} ${projectName} ${clientName}`);
      if (q !== '' && !hay.includes(q)) return null;
      const closed = isDoneStatus(state, task.statusId);
      const u = uses.get(task.id);
      const daysSince = u === undefined ? null : Math.max(0, diffDays(u.last, date));
      const score =
        (planned.has(task.id) && !closed ? 100 : 0) +
        frecencyScore(u?.n ?? 0, daysSince) * 10 +
        (q !== '' && fold(title).startsWith(q) ? 2 : 0) -
        (closed ? 5 : 0);
      return {
        row: {
          task,
          title,
          projectName,
          clientName,
          plannedToday: planned.has(task.id) && !closed,
          loggedMinutes: loggedMinutesForTask(state, task.id),
          estimateMinutes: task.estimatedHours === null ? null : hoursToMinutes(task.estimatedHours),
          closed,
        } satisfies TrackerSuggestion,
        score,
      };
    })
    .filter((x): x is { row: TrackerSuggestion; score: number } => x !== null)
    .sort((a, b) => b.score - a.score || a.row.title.localeCompare(b.row.title, 'pl'));
  return rows.slice(0, limit).map((x) => x.row);
}

export type TitleResolution =
  | { kind: 'none' }
  | { kind: 'one'; task: Task }
  | { kind: 'ambiguous'; tasks: Task[] }
  | { kind: 'closed'; task: Task };

/**
 * Co oznacza wpisany tytuł bez jawnego wyboru z listy. Porównanie bez ogonków i
 * wielkości liter. „Aktywne" = nie szkic, nie zrobione, nie zamaskowane.
 *   one        — dokładnie jedno aktywne zadanie: czas idzie tam,
 *   ambiguous  — kilka pasujących (ten sam tytuł w kilku projektach): wybierz z listy,
 *   closed     — dokładnie jedno, zamknięte: czas idzie tam (status bez zmian),
 *                pasek mówi o tym i nadal proponuje założenie nowego,
 *   none       — nic nie pasuje: nowe zadanie po wskazaniu projektu.
 */
export function resolveTaskByTitle(state: AppData, title: string): TitleResolution {
  const q = fold(title.trim());
  if (q === '') return { kind: 'none' };
  const matches = state.tasks.filter((t) => fold(t.title) === q && taskVisibleForTracker(state, t));
  const active = matches.filter((t) => taskLoggable(state, t));
  if (active.length === 1) return { kind: 'one', task: active[0] };
  if (active.length > 1) return { kind: 'ambiguous', tasks: active };
  if (matches.length === 1) return { kind: 'closed', task: matches[0] };
  if (matches.length > 1) return { kind: 'ambiguous', tasks: matches };
  return { kind: 'none' };
}

// ---- Wykonanie ponad plan (warstwa „nadgodzin" kalendarza) ----

/**
 * Minuty ZAPLANOWANE pary (zadanie, osoba, dzień) — datowane bloki, zasobnik
 * nie wchodzi. Lustro `trackingBalance.plannedMinutes`, tyle że jako odczyt dla
 * warstwy prezentacji (kalendarz), nie dla arytmetyki wzrostu planu.
 */
export function plannedMinutesForTaskPersonDate(
  state: AppData,
  taskId: string,
  personId: string,
  date: DateStr,
): number {
  return blocksForPersonDate(state, personId, date)
    .filter((b) => b.taskId === taskId && !isBinEntry(b))
    .reduce((s, b) => s + hoursToMinutes(b.plannedHours), 0);
}

/** Kawałek wykonania, którego NIE pokrywa plan tej pary — geometria kafelka. */
export interface OverrunInterval {
  personId: string;
  taskId: string;
  startMinutes: number;
  endMinutes: number;
}

/**
 * Wykonanie osoby z danego dnia NIEPOKRYTE planem, jako przedziały zegarowe.
 *
 * ILE: plan pary (zadanie, osoba, dzień) to pula minut, więc ponad plan jest
 * `wykonanie − plan` (ta sama arytmetyka, co `portionFill`; w normalnym
 * przebiegu równa się sumie `overrunMinutes` wpisów pary, bo nadwyżka z
 * pokryciem najpierw ROŚNIE w planie przez `planGrowth`). Liczymy z arytmetyki
 * plan↔wykonanie, nie z zapisanego pola, żeby ręczne skasowanie bloku po
 * fakcie też było widać.
 *
 * GDZIE (2026-09-02, zgłoszenie Kacpra: kafelek „ponad plan" stawał obok bloku
 * pokrytego co do minuty): nadwyżka siada w minutach wpisów NIEpokrytych
 * zegarowo blokami pary (`uncoveredEntryGaps`, ta sama geometria, co wzrost
 * planu), od najpóźniejszych — wpis 13:00-14:30 na bloku 13:00-14:30 zostaje
 * czysty, a osobne 15 min o 11:00 dostaje znacznik u siebie. Minut
 * niepokrytych nigdy nie brakuje (wpisy pary się nie nakładają, a pokryte ≤
 * plan); ogon ostatniego wpisu zostaje tylko jako zabezpieczenie.
 *
 * Czysto PREZENTACYJNE (inwariant 1): nic tu nie wchodzi do `dayTotal`,
 * `calendarDayVolume`, kolizji ani przeciążenia.
 */
export function overrunIntervalsForPersonDate(
  state: AppData,
  personId: string,
  date: DateStr,
): OverrunInterval[] {
  const byTask = new Map<string, TimeEntry[]>();
  for (const e of state.timeEntries) {
    if (e.personId !== personId || e.date !== date) continue;
    const list = byTask.get(e.taskId);
    if (list) list.push(e);
    else byTask.set(e.taskId, [e]);
  }
  const out: OverrunInterval[] = [];
  for (const [taskId, rows] of byTask) {
    const entries = [...rows].sort(
      (a, b) => a.startMinutes - b.startMinutes || a.id.localeCompare(b.id),
    );
    let over = sum(entries) - plannedMinutesForTaskPersonDate(state, taskId, personId, date);
    if (over <= 0) continue;
    const blockSpans = blocksForPersonDate(state, personId, date)
      .filter((b) => b.taskId === taskId && !isBinEntry(b))
      .map((b) => ({ startMinutes: b.startMinutes, endMinutes: b.startMinutes + hoursToMinutes(b.plannedHours) }));
    const gaps = uncoveredEntryGaps(entries, blockSpans);
    for (let i = gaps.length - 1; i >= 0 && over > 0; i--) {
      const [gapStart, gapEnd] = gaps[i];
      const take = Math.min(over, gapEnd - gapStart);
      out.push({ personId, taskId, startMinutes: gapEnd - take, endMinutes: gapEnd });
      over -= take;
    }
    for (let i = entries.length - 1; i >= 0 && over > 0; i--) {
      const e = entries[i];
      const take = Math.min(over, timeEntryMinutes(e));
      out.push({ personId, taskId, startMinutes: e.endMinutes - take, endMinutes: e.endMinutes });
      over -= take;
    }
  }
  return out.sort(
    (a, b) => a.startMinutes - b.startMinutes || a.taskId.localeCompare(b.taskId),
  );
}

/** To samo dla WSZYSTKICH osób w filtrze (pusty/brak filtra = cały zespół). */
export function overrunIntervalsOnDate(
  state: AppData,
  date: DateStr,
  personFilter?: Set<string>,
): OverrunInterval[] {
  const people = new Set<string>();
  for (const e of state.timeEntries) {
    if (e.date !== date) continue;
    if (personFilter !== undefined && personFilter.size > 0 && !personFilter.has(e.personId)) continue;
    people.add(e.personId);
  }
  const out: OverrunInterval[] = [];
  for (const personId of people) out.push(...overrunIntervalsForPersonDate(state, personId, date));
  return out.sort(
    (a, b) => a.startMinutes - b.startMinutes || a.taskId.localeCompare(b.taskId),
  );
}

/** Suma minut ponad plan w dniu (plakietka nagłówka tygodnia i komórki miesiąca). */
export function overrunMinutesOnDate(
  state: AppData,
  date: DateStr,
  personFilter?: Set<string>,
): number {
  return overrunIntervalsOnDate(state, date, personFilter).reduce(
    (s, i) => s + (i.endMinutes - i.startMinutes),
    0,
  );
}

// ---- „Ponad sprzedane" (kto i ile) ----

export interface OverrunSummaryRow {
  taskId: string;
  title: string;
  projectName: string;
  clientName: string;
  overrunMinutes: number;
}

/** Minuty ponad sprzedane osoby w podanych dniach, per zadanie, malejąco. */
export function overrunSummary(state: AppData, personId: string, dates: readonly DateStr[]): OverrunSummaryRow[] {
  const set = new Set(dates);
  const byTask = new Map<string, number>();
  for (const e of state.timeEntries) {
    if (e.personId !== personId || !set.has(e.date) || !e.overrunMinutes) continue;
    byTask.set(e.taskId, (byTask.get(e.taskId) ?? 0) + e.overrunMinutes);
  }
  const out: OverrunSummaryRow[] = [];
  for (const [taskId, overrunMinutes] of byTask) {
    const task = getTask(state, taskId);
    if (task === undefined) continue;
    const project = getProject(state, task.projectId);
    const client = project === undefined ? undefined : getClient(state, project.clientId);
    out.push({
      taskId,
      title: taskDisplayTitle(state, task),
      projectName: project === undefined ? '' : projectDisplayName(state, project),
      clientName: client?.name ?? '',
      overrunMinutes,
    });
  }
  return out.sort((a, b) => b.overrunMinutes - a.overrunMinutes || a.title.localeCompare(b.title, 'pl'));
}

// ---- „Ile na kogo" ----

export interface ClientTimeSummary {
  clientId: string;
  clientName: string;
  loggedMinutes: number;
  plannedMinutes: number;
  projects: Array<{ projectId: string; projectName: string; loggedMinutes: number; plannedMinutes: number }>;
}

/** Sumy osoby za podane dni po łańcuchu wpis → zadanie → projekt → klient, malejąco po wykonaniu. */
export function clientTimeSummary(state: AppData, personId: string, dates: readonly DateStr[]): ClientTimeSummary[] {
  const set = new Set(dates);
  const byProject = new Map<string, { logged: number; planned: number }>();
  const bump = (projectId: string, logged: number, planned: number) => {
    const cur = byProject.get(projectId) ?? { logged: 0, planned: 0 };
    cur.logged += logged;
    cur.planned += planned;
    byProject.set(projectId, cur);
  };
  for (const e of state.timeEntries) {
    if (e.personId !== personId || !set.has(e.date)) continue;
    const task = getTask(state, e.taskId);
    if (task !== undefined) bump(task.projectId, timeEntryMinutes(e), 0);
  }
  for (const w of state.workload) {
    if (w.personId !== personId || isBinEntry(w) || !set.has(w.date)) continue;
    const task = getTask(state, w.taskId);
    if (task !== undefined) bump(task.projectId, 0, hoursToMinutes(w.plannedHours));
  }
  const byClient = new Map<string, ClientTimeSummary>();
  for (const [projectId, s] of byProject) {
    const project = getProject(state, projectId);
    if (project === undefined) continue;
    const client = getClient(state, project.clientId);
    const clientId = project.clientId;
    const entry = byClient.get(clientId) ?? {
      clientId,
      clientName: client?.name ?? 'Klient',
      loggedMinutes: 0,
      plannedMinutes: 0,
      projects: [],
    };
    entry.loggedMinutes += s.logged;
    entry.plannedMinutes += s.planned;
    entry.projects.push({
      projectId,
      projectName: projectDisplayName(state, project),
      loggedMinutes: s.logged,
      plannedMinutes: s.planned,
    });
    byClient.set(clientId, entry);
  }
  return [...byClient.values()]
    .map((c) => ({ ...c, projects: c.projects.sort((a, b) => b.loggedMinutes - a.loggedMinutes) }))
    .sort((a, b) => b.loggedMinutes - a.loggedMinutes || a.clientName.localeCompare(b.clientName, 'pl'));
}

// ---- „Ile na co" (per zadanie) ----

export interface TaskTimeSummaryRow {
  taskId: string;
  title: string;
  projectName: string;
  clientName: string;
  loggedMinutes: number;
  plannedMinutes: number;
  closed: boolean;
}

/**
 * Sumy osoby za podane dni PER ZADANIE (2026-09-02, zgłoszenie „Podsumowanie
 * w widoku dnia"): „Agencyjne" logowane trzy razy w ciągu dnia pokazuje się
 * jako jedna pozycja z sumą. Malejąco po wykonaniu, potem po planie, potem tytuł.
 */
export function taskTimeSummary(state: AppData, personId: string, dates: readonly DateStr[]): TaskTimeSummaryRow[] {
  const set = new Set(dates);
  const byTask = new Map<string, { logged: number; planned: number }>();
  const bump = (taskId: string, logged: number, planned: number) => {
    const cur = byTask.get(taskId) ?? { logged: 0, planned: 0 };
    cur.logged += logged;
    cur.planned += planned;
    byTask.set(taskId, cur);
  };
  for (const e of state.timeEntries) {
    if (e.personId === personId && set.has(e.date)) bump(e.taskId, timeEntryMinutes(e), 0);
  }
  for (const w of state.workload) {
    if (w.personId === personId && !isBinEntry(w) && set.has(w.date)) bump(w.taskId, 0, hoursToMinutes(w.plannedHours));
  }
  const out: TaskTimeSummaryRow[] = [];
  for (const [taskId, s] of byTask) {
    const task = getTask(state, taskId);
    if (task === undefined) continue;
    const project = getProject(state, task.projectId);
    const client = project === undefined ? undefined : getClient(state, project.clientId);
    out.push({
      taskId,
      title: taskDisplayTitle(state, task),
      projectName: project === undefined ? '' : projectDisplayName(state, project),
      clientName: client?.name ?? '',
      loggedMinutes: s.logged,
      plannedMinutes: s.planned,
      closed: isDoneStatus(state, task.statusId),
    });
  }
  return out.sort(
    (a, b) => b.loggedMinutes - a.loggedMinutes || b.plannedMinutes - a.plannedMinutes || a.title.localeCompare(b.title, 'pl'),
  );
}
