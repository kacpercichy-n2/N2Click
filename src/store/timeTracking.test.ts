// Tracker czasu pracy (2026-08-19): wpisy wykonania osobno od planu.
// Czyste testy reduktora, selektorów i repairu — bez Reacta i localStorage.
import { describe, expect, it } from 'vitest';
import { reducer, type AddTimeEntryPayload } from './AppStore';
import { emptyData, repairTimeEntries } from './storage';
import {
  clientTimeSummary,
  dayPlanForPerson,
  loggedMinutesForPersonDate,
  loggedMinutesForTask,
  loggedMinutesForTaskPersonDate,
  portionLoggedMinutes,
  resolveTaskByTitle,
  settleCutoffMinutes,
  settleDueBlocks,
  taskTimeSummary,
  timeEntriesForPersonDate,
  trackerSuggestions,
  unsettledPlanBlocks,
  overrunIntervalsForPersonDate,
  overrunIntervalsOnDate,
  overrunMinutesOnDate,
  plannedMinutesForTaskPersonDate,
} from './timeTracking';
import { isValidTimeRange, findOverlappingEntry, formatMinutesDuration, frecencyScore, freeRemainderRange } from '../utils/timeTracking';
import { carveSpan, freeRangesWithin, uncoveredEntryGaps } from './timeTrackingSync';
import type { AppData, Client, Person, Project, Status, Task, TimeEntry, WorkloadEntry } from '../types';

const DAY = '2026-08-13';
const CLIENT_A: Client = { id: 'c-a', name: 'Wodociągi Słupsk', archived: false, contactName: '', contactEmail: '', contactPhone: '' };
const CLIENT_B: Client = { id: 'c-b', name: 'Yoshi', archived: false, contactName: '', contactEmail: '', contactPhone: '' };
const project = (id: string, clientId: string, name: string): Project => ({
  id, clientId, name, description: '', statusId: 'active', paid: false,
  startDate: '2026-08-01', endDate: '2026-08-31', departmentId: '', serviceTypeId: '', documents: [],
  createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
});
const ACTIVE: Status = { id: 'active', name: 'W toku', slug: 'w-toku', color: '#9aa7c4', order: 0, archived: false, isDone: false };
const DONE: Status = { id: 'done', name: 'Gotowe', slug: 'gotowe', color: '#7ee0c3', order: 1, archived: false, isDone: true };
const person = (id: string, name: string): Person => ({
  id, firstName: name, lastName: '', name, email: '', phone: '', role: '', departmentId: '', companyId: '',
  avatar: '', capacity: 8, accessRole: 'pelne', passwordHash: '', workDays: [1, 2, 3, 4, 5],
  workStartMinutes: 480, workEndMinutes: 960, supervisorId: '', birthDate: '',
});
const task = (id: string, projectId: string, title: string, over: Partial<Task> = {}): Task => ({
  id, projectId, statusId: 'active', title, description: '', startDate: DAY, endDate: DAY,
  estimatedHours: 3, priority: 'normal', workCategoryId: '', departmentId: '', checklist: [], orderIndex: 0,
  createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z', ...over,
});
const block = (id: string, taskId: string, personId: string, start: number, hours: number, sortIndex = 0): WorkloadEntry => ({
  id, taskId, personId, date: DAY, plannedHours: hours, startMinutes: start, sortIndex,
});
const entry = (id: string, taskId: string, start: number, end: number, over: Partial<TimeEntry> = {}): TimeEntry => ({
  id, personId: 'me', taskId, date: DAY, startMinutes: start, endMinutes: end, source: 'manual', createdAt: '', ...over,
});

function state(over: Partial<AppData> = {}): AppData {
  return {
    ...emptyData(),
    clients: [CLIENT_A, CLIENT_B],
    projects: [project('p-a', 'c-a', 'Strona www'), project('p-b', 'c-b', 'Obsługa bieżąca')],
    statuses: [ACTIVE, DONE],
    people: [person('me', 'Ja'), person('other', 'Ktoś')],
    tasks: [
      task('t-design', 'p-a', 'Design strony www'),
      task('t-call-a', 'p-a', 'Rozmowa z klientem', { estimatedHours: null }),
      task('t-call-b', 'p-b', 'Rozmowa z klientem', { estimatedHours: null }),
      task('t-done', 'p-b', 'Zrobione zadanie', { statusId: 'done' }),
      task('t-draft', 'p-b', 'Szkic', { isDraft: true }),
    ],
    currentUserId: 'me',
    ...over,
  };
}

describe('utils/timeTracking', () => {
  it('isValidTimeRange: siatka 15 min w dobie, start < koniec', () => {
    expect(isValidTimeRange(540, 570)).toBe(true);
    expect(isValidTimeRange(540, 540)).toBe(false);
    expect(isValidTimeRange(545, 600)).toBe(false);
    expect(isValidTimeRange(-15, 0)).toBe(false);
    expect(isValidTimeRange(1425, 1455)).toBe(false);
    expect(isValidTimeRange('540', 600)).toBe(false);
  });
  it('findOverlappingEntry: dotykające krawędzie nie kolidują, ten sam wpis pomijany', () => {
    const es = [entry('w1', 't-design', 600, 660)];
    expect(findOverlappingEntry(es, 'me', DAY, 660, 720)).toBeUndefined();
    expect(findOverlappingEntry(es, 'me', DAY, 630, 720)?.id).toBe('w1');
    expect(findOverlappingEntry(es, 'me', DAY, 630, 720, 'w1')).toBeUndefined();
    expect(findOverlappingEntry(es, 'other', DAY, 630, 720)).toBeUndefined();
  });
  it('freeRemainderRange: ogon przed głową, null gdy oba kawałki zajęte', () => {
    // blok 14:00-16:00, reszta 60 min
    const head = [entry('w1', 't-design', 840, 900)]; // wpis na głowie → ogon wolny
    expect(freeRemainderRange(head, 'me', DAY, 840, 960, 60)).toEqual([900, 960]);
    const tail = [entry('w1', 't-design', 900, 960)]; // wpis na ogonie → głowa
    expect(freeRemainderRange(tail, 'me', DAY, 840, 960, 60)).toEqual([840, 900]);
    const mid = [entry('w1', 't-design', 870, 930)]; // środek zajmuje oba → null
    expect(freeRemainderRange(mid, 'me', DAY, 840, 960, 60)).toBeNull();
    expect(freeRemainderRange([], 'me', DAY, 840, 960, 60)).toEqual([900, 960]);
  });
  it('uncoveredEntryGaps: unia wpisów minus bloki, rosnąco; scala nachodzące wpisy', () => {
    expect(uncoveredEntryGaps([{ startMinutes: 540, endMinutes: 630 }], [{ startMinutes: 570, endMinutes: 600 }])).toEqual([
      [540, 570],
      [600, 630],
    ]);
    expect(
      uncoveredEntryGaps(
        [
          { startMinutes: 600, endMinutes: 630 },
          { startMinutes: 570, endMinutes: 615 },
        ],
        [{ startMinutes: 600, endMinutes: 630 }],
      ),
    ).toEqual([[570, 600]]);
    expect(uncoveredEntryGaps([{ startMinutes: 540, endMinutes: 600 }], [{ startMinutes: 480, endMinutes: 720 }])).toEqual([]);
    expect(uncoveredEntryGaps([], [{ startMinutes: 480, endMinutes: 720 }])).toEqual([]);
  });
  it('formatMinutesDuration + frecencyScore', () => {
    expect(formatMinutesDuration(90)).toBe('1h 30m');
    expect(formatMinutesDuration(60)).toBe('1h');
    expect(formatMinutesDuration(15)).toBe('15m');
    expect(formatMinutesDuration(0)).toBe('0m');
    expect(frecencyScore(0, null)).toBe(0);
    expect(frecencyScore(5, 0)).toBeGreaterThan(frecencyScore(5, 7));
    expect(frecencyScore(9, 1)).toBeGreaterThan(frecencyScore(2, 1));
  });
});

describe('ADD_TIME_ENTRY', () => {
  const add = (s: AppData, p: Partial<AddTimeEntryPayload>) =>
    reducer(s, {
      type: 'ADD_TIME_ENTRY',
      payload: { personId: 'me', taskId: 't-design', date: DAY, startMinutes: 600, endMinutes: 660, source: 'manual', ...p },
    });

  it('dodaje wpis na istniejące zadanie (bez wpisu w dzienniku aktywności)', () => {
    const s = state();
    const next = add(s, {});
    expect(next).not.toBe(s);
    expect(next.timeEntries).toHaveLength(1);
    expect(next.timeEntries[0]).toMatchObject({ personId: 'me', taskId: 't-design', date: DAY, startMinutes: 600, endMinutes: 660, source: 'manual' });
    expect(next.activity).toHaveLength(0);
    expect('eventId' in next.timeEntries[0]).toBe(false);
  });
  it('straże => ta sama referencja: osoba, zadanie, szkic, data, zakres, źródło, eventId', () => {
    const s = state();
    expect(add(s, { personId: 'ghost' })).toBe(s);
    expect(add(s, { taskId: 'ghost' })).toBe(s);
    expect(add(s, { taskId: 't-draft' })).toBe(s);
    expect(add(s, { date: '2026-13-40' })).toBe(s);
    expect(add(s, { startMinutes: 605 })).toBe(s);
    expect(add(s, { startMinutes: 660, endMinutes: 600 })).toBe(s);
    expect(add(s, { source: 'magic' as never })).toBe(s);
    expect(add(s, { eventId: 'k1' })).toBe(s); // eventId tylko przy source 'event'
    expect(add(s, { taskId: undefined })).toBe(s); // ani taskId, ani newTask
  });
  it('zadanie „zrobione” TEŻ przyjmuje czas (2026-09-02): wpis powstaje, status zostaje', () => {
    const s = state();
    const next = add(s, { taskId: 't-done' });
    expect(next).not.toBe(s);
    expect(next.timeEntries[0]).toMatchObject({ taskId: 't-done', startMinutes: 600, endMinutes: 660 });
    expect(next.tasks.find((t) => t.id === 't-done')?.statusId).toBe('done');
  });
  it('nachodzenie na wpis TEJ SAMEJ osoby tego dnia odrzuca; inna osoba / dzień wolno', () => {
    const s = state({ timeEntries: [entry('w1', 't-design', 600, 660)] });
    expect(add(s, { startMinutes: 630, endMinutes: 690 })).toBe(s);
    expect(add(s, { startMinutes: 660, endMinutes: 690 }).timeEntries).toHaveLength(2);
    expect(add(s, { personId: 'other', startMinutes: 630, endMinutes: 690 }).timeEntries).toHaveLength(2);
    expect(add(s, { date: '2026-08-14', startMinutes: 630, endMinutes: 690 }).timeEntries).toHaveLength(2);
  });
  it('newTask zakłada zadanie atomowo: projekt + tytuł, pierwszy aktywny status, przypisanie osoby', () => {
    const s = state();
    const next = add(s, { taskId: undefined, newTask: { title: 'Telefon do Yoshi', projectId: 'p-b' } });
    expect(next).not.toBe(s);
    const created = next.tasks[next.tasks.length - 1];
    expect(created).toMatchObject({ title: 'Telefon do Yoshi', projectId: 'p-b', statusId: 'active', estimatedHours: null, createdBy: 'me' });
    expect(next.assignments.some((a) => a.taskId === created.id && a.personId === 'me')).toBe(true);
    expect(next.timeEntries[0].taskId).toBe(created.id);
    // Kubełek (bez estymaty): wykonanie materializuje się w planie jako wykonany blok 1:1.
    expect(next.workload).toHaveLength(1);
    expect(next.workload[0]).toMatchObject({ taskId: created.id, personId: 'me', date: DAY, startMinutes: 600, plannedHours: 1, done: true });
    expect(next.tasks[next.tasks.length - 1].statusId).toBe('active'); // kubełek nigdy nie zamyka się sam
  });
  it('newTask z nieznanym projektem albo pustym tytułem => nic nie powstaje (atomowość)', () => {
    const s = state();
    expect(add(s, { taskId: undefined, newTask: { title: 'X', projectId: 'ghost' } })).toBe(s);
    expect(add(s, { taskId: undefined, newTask: { title: '   ', projectId: 'p-b' } })).toBe(s);
    expect(add(s, { taskId: 't-design', newTask: { title: 'X', projectId: 'p-b' } })).toBe(s);
  });
  it('nachodzenie z newTask: zadanie NIE powstaje', () => {
    const s = state({ timeEntries: [entry('w1', 't-design', 600, 660)] });
    expect(add(s, { taskId: undefined, newTask: { title: 'Nowe', projectId: 'p-b' } })).toBe(s);
  });
  it('source event z eventId przechodzi', () => {
    const next = add(state(), { source: 'event', eventId: 'k1' });
    expect(next.timeEntries[0]).toMatchObject({ source: 'event', eventId: 'k1' });
  });
});

describe('UPDATE_TIME_ENTRY / DELETE_TIME_ENTRY', () => {
  it('poprawka zmienia zakres i zadanie, zrywa więź ze spotkaniem', () => {
    const s = state({ timeEntries: [entry('w1', 't-design', 600, 660, { source: 'event', eventId: 'k1' })] });
    const next = reducer(s, { type: 'UPDATE_TIME_ENTRY', entryId: 'w1', taskId: 't-call-a', startMinutes: 615, endMinutes: 690 });
    expect(next.timeEntries[0]).toMatchObject({ taskId: 't-call-a', startMinutes: 615, endMinutes: 690, source: 'manual' });
    expect('eventId' in next.timeEntries[0]).toBe(false);
  });
  it('straże: nieznany wpis, zły zakres, szkic, kolizja z INNYM wpisem, brak zmiany; zamknięte zadanie przyjmuje', () => {
    const s = state({ timeEntries: [entry('w1', 't-design', 600, 660), entry('w2', 't-design', 720, 780)] });
    expect(reducer(s, { type: 'UPDATE_TIME_ENTRY', entryId: 'ghost', taskId: 't-design', startMinutes: 600, endMinutes: 660 })).toBe(s);
    expect(reducer(s, { type: 'UPDATE_TIME_ENTRY', entryId: 'w1', taskId: 't-design', startMinutes: 600, endMinutes: 605 })).toBe(s);
    expect(reducer(s, { type: 'UPDATE_TIME_ENTRY', entryId: 'w1', taskId: 't-draft', startMinutes: 600, endMinutes: 660 })).toBe(s);
    expect(reducer(s, { type: 'UPDATE_TIME_ENTRY', entryId: 'w1', taskId: 't-done', startMinutes: 600, endMinutes: 660 }).timeEntries[0].taskId).toBe('t-done');
    expect(reducer(s, { type: 'UPDATE_TIME_ENTRY', entryId: 'w1', taskId: 't-design', startMinutes: 600, endMinutes: 750 })).toBe(s);
    // wpis nie koliduje sam ze sobą
    expect(reducer(s, { type: 'UPDATE_TIME_ENTRY', entryId: 'w1', taskId: 't-design', startMinutes: 615, endMinutes: 705 })).not.toBe(s);
    expect(reducer(s, { type: 'UPDATE_TIME_ENTRY', entryId: 'w1', taskId: 't-design', startMinutes: 600, endMinutes: 660 })).toBe(s);
  });
  it('kasowanie: nieznany id => ta sama referencja', () => {
    const s = state({ timeEntries: [entry('w1', 't-design', 600, 660)] });
    expect(reducer(s, { type: 'DELETE_TIME_ENTRY', entryId: 'ghost' })).toBe(s);
    expect(reducer(s, { type: 'DELETE_TIME_ENTRY', entryId: 'w1' }).timeEntries).toEqual([]);
  });
});

describe('selektory trackera', () => {
  it('wpisy dnia rosnąco, sumy dnia i zadania', () => {
    const s = state({ timeEntries: [entry('w2', 't-design', 720, 780), entry('w1', 't-design', 600, 660), entry('w3', 't-design', 600, 660, { personId: 'other' })] });
    expect(timeEntriesForPersonDate(s, 'me', DAY).map((e) => e.id)).toEqual(['w1', 'w2']);
    expect(loggedMinutesForPersonDate(s, 'me', DAY)).toBe(120);
    expect(loggedMinutesForTask(s, 't-design')).toBe(180);
  });
  it('porcja: zalogowany czas zadania w dniu wypełnia bloki po kolei od najwcześniejszej', () => {
    const b1 = block('b1', 't-design', 'me', 600, 1, 0);   // 10:00-11:00
    const b2 = block('b2', 't-design', 'me', 840, 2, 1);   // 14:00-16:00
    const s = state({ workload: [b2, b1], timeEntries: [entry('w1', 't-design', 900, 990)] }); // 1h 30m
    expect(portionLoggedMinutes(s, b1)).toBe(60);
    expect(portionLoggedMinutes(s, b2)).toBe(30);
  });
  it('dayPlanForPerson: bloki z porcją/całością, spotkania bez urlopu, sortowane po starcie', () => {
    const s = state({
      workload: [block('b1', 't-design', 'me', 600, 2)],
      timeEntries: [entry('w1', 't-design', 600, 660), entry('w2', 't-design', 600, 660, { personId: 'other', date: '2026-08-12' })],
      events: [
        { id: 'k1', title: 'Odprawa', description: '', location: '', meetingUrl: '', date: DAY, startMinutes: 540, durationMinutes: 30, attendeeIds: [], createdAt: '', updatedAt: '' },
        { id: 'u1', title: 'Urlop', description: '', location: '', meetingUrl: '', date: DAY, startMinutes: 0, durationMinutes: 1440, attendeeIds: ['me'], kind: 'urlop', createdAt: '', updatedAt: '' },
      ],
    });
    const plan = dayPlanForPerson(s, 'me', DAY);
    expect(plan.map((p) => p.kind)).toEqual(['event', 'block']);
    const b = plan[1] as Extract<(typeof plan)[number], { kind: 'block' }>;
    expect(b).toMatchObject({ title: 'Design strony www', clientName: 'Wodociągi Słupsk', plannedMinutes: 120, portionLogged: 60, taskLogged: 120, estimateMinutes: 180, done: false });
  });
  it('unsettledPlanBlocks: kandydatem tylko blok bez wykonania — pokryte, odhaczone, zrobione zadania i spotkania wypadają', () => {
    const s = state({
      workload: [
        block('b1', 't-design', 'me', 600, 1),                          // w pełni pokryty wpisem
        { ...block('b2', 't-design', 'me', 720, 1, 1), done: true },    // odhaczony per blok
        block('b3', 't-call-a', 'me', 840, 2, 2),                       // bez wykonania → kandydat
        block('b4', 't-done', 'me', 1020, 1, 3),                        // zadanie ze statusem „zrobione"
      ],
      timeEntries: [entry('w1', 't-design', 600, 660)],
      events: [
        { id: 'k1', title: 'Odprawa', description: '', location: '', meetingUrl: '', date: DAY, startMinutes: 540, durationMinutes: 30, attendeeIds: [], createdAt: '', updatedAt: '' },
      ],
    });
    const due = unsettledPlanBlocks(dayPlanForPerson(s, 'me', DAY));
    expect(due.map((b) => b.block.id)).toEqual(['b3']);
    // Blok pokryty CZĘŚCIOWO zostaje kandydatem (rozliczenie odda resztę).
    const partial = state({ workload: [block('b5', 't-design', 'me', 600, 2)], timeEntries: [entry('w1', 't-design', 600, 660)] });
    expect(unsettledPlanBlocks(dayPlanForPerson(partial, 'me', DAY)).map((b) => b.block.id)).toEqual(['b5']);
  });
  it('„Zalicz jako wykonane" bloku częściowo pokrytego: wpis reszty domyka blok BEZ podwójnego liczenia', () => {
    // Blok 14:00-16:00 (2h); pokrycie 1h przychodzi pulą z wpisu 9:00-10:00,
    // więc godziny bloku są wolne — pełny wpis 1:1 policzyłby pokrytą część
    // drugi raz. Ścieżka popoutu dopisuje wyłącznie resztę (ogon bloku).
    const s = state({
      workload: [block('b1', 't-design', 'me', 840, 2)],
      timeEntries: [entry('w1', 't-design', 540, 600)],
    });
    const due = unsettledPlanBlocks(dayPlanForPerson(s, 'me', DAY));
    expect(due.map((b) => [b.block.id, b.portionLogged])).toEqual([['b1', 60]]);
    const range = freeRemainderRange(s.timeEntries, 'me', DAY, 840, 960, due[0].plannedMinutes - due[0].portionLogged);
    expect(range).toEqual([900, 960]);
    const next = reducer(s, {
      type: 'ADD_TIME_ENTRY',
      payload: { personId: 'me', taskId: 't-design', date: DAY, startMinutes: 900, endMinutes: 960, source: 'manual' },
    });
    expect(next.workload.find((w) => w.id === 'b1')?.done).toBe(true); // resyncBlockDone domyka
    expect(loggedMinutesForTaskPersonDate(next, 't-design', 'me', DAY)).toBe(120); // dokładnie plan, zero dubla
  });
  it('podpowiedzi: bez szkiców; zrobione na końcu z flagą closed; dziś w planie na górze; potem częstość × świeżość', () => {
    const s = state({
      workload: [block('b1', 't-call-a', 'me', 600, 1)],
      timeEntries: [entry('w1', 't-call-b', 540, 570, { date: '2026-08-12' }), entry('w2', 't-call-b', 540, 570, { date: '2026-08-11' }), entry('w3', 't-design', 540, 570, { date: '2026-08-01' })],
    });
    const all = trackerSuggestions(s, 'me', DAY, '');
    expect(all.map((x) => x.task.id)).toEqual(['t-call-a', 't-call-b', 't-design', 't-done']);
    expect(all[0].plannedToday).toBe(true);
    expect(all.map((x) => x.closed)).toEqual([false, false, false, true]);
    expect(all.some((x) => x.task.id === 't-draft')).toBe(false);
    // zamknięte, ale często logowane (frecency) wyprzedza aktywne bez wpisów
    const busy = state({
      timeEntries: [entry('w1', 't-done', 540, 570, { date: '2026-08-12' }), entry('w2', 't-done', 540, 570, { date: '2026-08-11' })],
    });
    expect(trackerSuggestions(busy, 'me', DAY, '')[0]).toMatchObject({ task: { id: 't-done' }, closed: true, plannedToday: false });
    // zapytanie po kliencie, bez ogonków
    expect(trackerSuggestions(s, 'me', DAY, 'wodociagi slupsk').map((x) => x.task.id)).toEqual(['t-call-a', 't-design']);
  });
  it('resolveTaskByTitle: one / ambiguous / closed / none', () => {
    const s = state();
    expect(resolveTaskByTitle(s, 'design strony WWW')).toMatchObject({ kind: 'one', task: { id: 't-design' } });
    expect(resolveTaskByTitle(s, 'Rozmowa z klientem').kind).toBe('ambiguous');
    expect(resolveTaskByTitle(s, 'Zrobione zadanie')).toMatchObject({ kind: 'closed', task: { id: 't-done' } });
    expect(resolveTaskByTitle(s, 'Szkic').kind).toBe('none'); // szkic nie przyjmuje czasu i nie jest widoczny
    expect(resolveTaskByTitle(s, 'Nic takiego').kind).toBe('none');
    expect(resolveTaskByTitle(s, '   ').kind).toBe('none');
  });
  it('clientTimeSummary: po łańcuchu zadanie → projekt → klient, malejąco po wykonaniu', () => {
    const s = state({
      workload: [block('b1', 't-design', 'me', 600, 3)],
      timeEntries: [entry('w1', 't-design', 600, 660), entry('w2', 't-call-b', 720, 840), entry('w3', 't-design', 600, 660, { personId: 'other' })],
    });
    const out = clientTimeSummary(s, 'me', [DAY]);
    expect(out.map((c) => [c.clientName, c.loggedMinutes, c.plannedMinutes])).toEqual([
      ['Yoshi', 120, 0],
      ['Wodociągi Słupsk', 60, 180],
    ]);
    expect(out[1].projects[0]).toMatchObject({ projectName: 'Strona www', loggedMinutes: 60, plannedMinutes: 180 });
  });
});

describe('kaskady: usunięcie zadania / projektu / osoby zabiera wpisy czasu', () => {
  it('DELETE_TASK usuwa wpisy zadania, resztę zostawia tą samą referencją', () => {
    const s = state({ timeEntries: [entry('w1', 't-design', 600, 660), entry('w2', 't-call-a', 720, 780)] });
    const next = reducer(s, { type: 'DELETE_TASK', taskId: 't-design' });
    expect(next.timeEntries.map((e) => e.id)).toEqual(['w2']);
    const untouched = reducer(s, { type: 'DELETE_TASK', taskId: 't-done' });
    expect(untouched.timeEntries).toBe(s.timeEntries);
  });
  it('DELETE_PROJECT usuwa wpisy wszystkich zadań projektu', () => {
    const s = state({ timeEntries: [entry('w1', 't-design', 600, 660), entry('w2', 't-call-b', 720, 780)] });
    const next = reducer(s, { type: 'DELETE_PROJECT', projectId: 'p-a' });
    expect(next.timeEntries.map((e) => e.id)).toEqual(['w2']);
  });
  it('MERGE_CLOUD_PEOPLE: osoba bez konta chmury znika razem ze swoimi wpisami', () => {
    const s = state({
      people: [{ ...person('me', 'Ja'), email: 'ja@x.pl' }, { ...person('other', 'Ktoś'), email: 'ktos@x.pl' }],
      timeEntries: [entry('w1', 't-design', 600, 660), entry('w2', 't-design', 600, 660, { personId: 'other' })],
    });
    const row = {
      id: 'a1a1a1a1-0000-0000-0000-000000000001', email: 'ja@x.pl', firstName: 'Ja', lastName: '', role: '',
      departmentId: '', companyId: '', phone: '', avatar: '', capacity: 8, workDays: [1, 2, 3, 4, 5],
      workStartMinutes: 480, workEndMinutes: 960, accessRole: 'pelne' as const, supervisorEmail: '', birthDate: '',
    };
    const next = reducer(s, { type: 'MERGE_CLOUD_PEOPLE', payload: [row] });
    expect(next.people.map((p) => p.id)).toEqual(['me']);
    expect(next.timeEntries.map((e) => e.id)).toEqual(['w1']);
  });
  it('DELETE_PERSON usuwa wpisy osoby', () => {
    const s = state({ timeEntries: [entry('w1', 't-design', 600, 660), entry('w2', 't-design', 600, 660, { personId: 'other' })] });
    const next = reducer(s, { type: 'DELETE_PERSON', personId: 'other' });
    expect(next.timeEntries.map((e) => e.id)).toEqual(['w1']);
  });
});

describe('repairTimeEntries', () => {
  it('odrzuca wpis bez żywego zadania albo osoby', () => {
    const s = state({ timeEntries: [entry('w1', 't-design', 600, 660), entry('w2', 'ghost-task', 720, 780), entry('w3', 't-design', 800, 860, { personId: 'ghost' })] });
    expect(repairTimeEntries(s).timeEntries.map((e) => e.id)).toEqual(['w1']);
  });
  it('czysty zapis wychodzi TĄ SAMĄ referencją kolekcji', () => {
    const s = state({ timeEntries: [entry('w1', 't-design', 600, 660), entry('w2', 't-design', 720, 780, { source: 'event', eventId: 'k1' })] });
    expect(repairTimeEntries(s)).toBe(s);
  });
  it('odrzuca śmieci, duplikaty id i nachodzące wpisy tej samej osoby; czyści eventId poza source event', () => {
    const raw = state({
      timeEntries: [
        entry('w1', 't-design', 600, 660),
        entry('w1', 't-design', 900, 960),                       // duplikat id
        entry('w2', 't-design', 630, 690),                       // nachodzi na w1
        entry('w3', 't-design', 690, 705, { personId: '' }),     // brak osoby
        entry('w4', 't-design', 700, 760),                       // poza siatką
        entry('w5', 't-design', 780, 840, { eventId: 'k9' }),    // eventId przy manual => klucz znika
        { id: 'w6', personId: 'me', taskId: 't', date: 'zle', startMinutes: 0, endMinutes: 15, source: 'manual', createdAt: '' } as TimeEntry,
        null as unknown as TimeEntry,
      ],
    });
    const fixed = repairTimeEntries(raw);
    expect(fixed.timeEntries.map((e) => e.id)).toEqual(['w1', 'w5']);
    expect('eventId' in fixed.timeEntries[1]).toBe(false);
    expect(repairTimeEntries(fixed)).toBe(fixed);
  });
  it('brak kolekcji (stary zapis) => pusta lista', () => {
    const raw = { ...state(), timeEntries: undefined as unknown as TimeEntry[] };
    expect(repairTimeEntries(raw).timeEntries).toEqual([]);
  });
  it('planGrowth: zapis sprzed 2026-09-01 (pojedynczy obiekt) naprawia się do listy; śmieciowy kawałek zdejmuje całą księgowość', () => {
    const legacy = { blockId: 'b1', minutes: 30, fromBinMinutes: 0 } as unknown as TimeEntry['planGrowth'];
    const raw = state({
      timeEntries: [
        entry('w1', 't-design', 600, 660, { planGrowth: legacy }),
        entry('w2', 't-design', 720, 780, { planGrowth: [{ blockId: 'b1', minutes: 30, fromBinMinutes: 0 }] }),
        entry('w3', 't-design', 840, 900, { planGrowth: [{ blockId: '', minutes: 30, fromBinMinutes: 0 }] }),
      ],
    });
    const fixed = repairTimeEntries(raw);
    expect(fixed.timeEntries.find((e) => e.id === 'w1')?.planGrowth).toEqual([{ blockId: 'b1', minutes: 30, fromBinMinutes: 0 }]);
    expect(fixed.timeEntries.find((e) => e.id === 'w2')?.planGrowth).toEqual([{ blockId: 'b1', minutes: 30, fromBinMinutes: 0 }]);
    expect('planGrowth' in (fixed.timeEntries.find((e) => e.id === 'w3') ?? {})).toBe(false);
    expect(repairTimeEntries(fixed)).toBe(fixed);
  });
});

// ---- Wykonanie ↔ plan (2026-08-19, reguły 1-5 ustalone z Kacprem) ------------
describe('para blok-wpis: SET_BLOCK_DONE', () => {
  const bin = (id: string, taskId: string, personId: string, hours: number): WorkloadEntry => ({
    id, taskId, personId, date: '', plannedHours: hours, startMinutes: 0, sortIndex: 0,
  });
  it('„wykonane” na bloku tworzy wpis 1:1 (source block, blockId); odznaczenie go kasuje', () => {
    const s = state({ workload: [block('b1', 't-design', 'me', 600, 2)] });
    const done = reducer(s, { type: 'SET_BLOCK_DONE', entryId: 'b1', done: true });
    expect(done.workload[0].done).toBe(true);
    expect(done.timeEntries).toHaveLength(1);
    expect(done.timeEntries[0]).toMatchObject({ taskId: 't-design', personId: 'me', date: DAY, startMinutes: 600, endMinutes: 720, source: 'block', blockId: 'b1' });
    const undone = reducer(done, { type: 'SET_BLOCK_DONE', entryId: 'b1', done: false });
    expect(undone.workload[0].done).toBe(false);
    expect(undone.timeEntries).toHaveLength(0);
  });
  it('godziny bloku CAŁE zajęte innym wpisem: blok wykonany, ale bez wpisu (nic nie nachodzi)', () => {
    const s = state({ workload: [block('b1', 't-design', 'me', 600, 2)], timeEntries: [entry('w1', 't-call-a', 600, 720)] });
    const done = reducer(s, { type: 'SET_BLOCK_DONE', entryId: 'b1', done: true });
    expect(done.workload[0].done).toBe(true);
    expect(done.timeEntries).toHaveLength(1);
  });
  it('godziny bloku CZĘŚCIOWO zajęte cudzym wpisem (2026-09-02): wcięcie + wpisy w wolnych kawałkach, reszta do zasobnika', () => {
    const s = state({ workload: [block('b1', 't-design', 'me', 600, 2)], timeEntries: [entry('w1', 't-call-a', 630, 690)] });
    const done = reducer(s, { type: 'SET_BLOCK_DONE', entryId: 'b1', done: true });
    const dated = done.workload.filter((w) => w.date === DAY && w.taskId === 't-design').sort((a, b) => a.startMinutes - b.startMinutes);
    expect(dated.map((w) => [w.startMinutes, w.plannedHours, w.done])).toEqual([[600, 0.5, true], [690, 0.5, true]]);
    expect(dated[0].id).toBe('b1'); // głowa zachowuje id
    const bin = done.workload.find((w) => w.taskId === 't-design' && w.date === '');
    expect(bin?.plannedHours).toBe(1); // wycięta godzina wraca do zasobnika
    const mine = done.timeEntries.filter((e) => e.taskId === 't-design').sort((a, b) => a.startMinutes - b.startMinutes);
    expect(mine.map((e) => [e.startMinutes, e.endMinutes, e.source, e.blockId])).toEqual([
      [600, 630, 'block', 'b1'],
      [690, 720, 'block', dated[1].id],
    ]);
    // odznaczenie głowy kasuje tylko jej wpis
    const undone = reducer(done, { type: 'SET_BLOCK_DONE', entryId: 'b1', done: false });
    expect(undone.timeEntries.filter((e) => e.taskId === 't-design')).toHaveLength(1);
  });
  it('blok częściowo pokryty WŁASNYM wpisem: kółko dopisuje resztę, bez wcięcia', () => {
    const s = state({ workload: [block('b1', 't-design', 'me', 600, 2)], timeEntries: [entry('w1', 't-design', 630, 690)] });
    const done = reducer(s, { type: 'SET_BLOCK_DONE', entryId: 'b1', done: true });
    expect(done.workload.filter((w) => w.date === DAY)).toHaveLength(1);
    expect(done.timeEntries.map((e) => [e.startMinutes, e.endMinutes]).sort((a, b) => a[0] - b[0])).toEqual([[600, 630], [630, 690], [690, 720]]);
  });
  it('ręcznie zmieniony wpis z bloku zostaje po odznaczeniu; skasowanie wpisu z bloku odznacza blok', () => {
    const s = state({ workload: [block('b1', 't-design', 'me', 600, 2)] });
    const done = reducer(s, { type: 'SET_BLOCK_DONE', entryId: 'b1', done: true });
    const id = done.timeEntries[0].id;
    const edited = reducer(done, { type: 'UPDATE_TIME_ENTRY', entryId: id, taskId: 't-design', startMinutes: 600, endMinutes: 690 });
    expect(edited.timeEntries[0].source).toBe('manual');
    const undone = reducer(edited, { type: 'SET_BLOCK_DONE', entryId: 'b1', done: false });
    expect(undone.timeEntries).toHaveLength(1); // zmieniony wpis zostaje
    const removed = reducer(done, { type: 'DELETE_TIME_ENTRY', entryId: id });
    expect(removed.workload[0].done).toBe(false);
  });
  it('wpis pokrywający blok w całości oznacza blok jako wykonany', () => {
    const s = state({ workload: [block('b1', 't-design', 'me', 600, 1), block('b2', 't-design', 'me', 840, 1, 1)] });
    const next = reducer(s, { type: 'ADD_TIME_ENTRY', payload: { personId: 'me', taskId: 't-design', date: DAY, startMinutes: 600, endMinutes: 660, source: 'manual' } });
    expect(next.workload.find((w) => w.id === 'b1')?.done).toBe(true);
    expect(next.workload.find((w) => w.id === 'b2')?.done).toBeUndefined();
  });
  it('zadanie ze sprzedanymi godzinami zamyka się samo, gdy nic nie zostało (bloki wykonane, zasobnik pusty, brak wolnych sprzedanych)', () => {
    // t-design: estymata 3h = blok 2h + zasobnik 1h → po wykonaniu 2h zostaje zasobnik → nie zamyka
    const s = state({ workload: [block('b1', 't-design', 'me', 600, 2), bin('bin1', 't-design', 'me', 1)] });
    const partial = reducer(s, { type: 'SET_BLOCK_DONE', entryId: 'b1', done: true });
    expect(partial.tasks.find((t) => t.id === 't-design')?.statusId).toBe('active');
    // estymata 2h = jeden blok 2h → wykonany → Gotowe
    const s2 = state({ tasks: [task('t-design', 'p-a', 'Design strony www', { estimatedHours: 2 })], workload: [block('b1', 't-design', 'me', 600, 2)] });
    const full = reducer(s2, { type: 'SET_BLOCK_DONE', entryId: 'b1', done: true });
    expect(full.tasks.find((t) => t.id === 't-design')?.statusId).toBe('done');
  });
  it('zadanie bez estymaty: wszystkie bloki wykonane → Gotowe (1 blok i kilka bloków)', () => {
    const one = state({ workload: [block('b1', 't-call-a', 'me', 600, 1)] });
    const oneDone = reducer(one, { type: 'SET_BLOCK_DONE', entryId: 'b1', done: true });
    expect(oneDone.tasks.find((t) => t.id === 't-call-a')?.statusId).toBe('done');
    const many = state({ workload: [block('b1', 't-call-a', 'me', 600, 1), block('b2', 't-call-a', 'me', 840, 1, 1)] });
    const first = reducer(many, { type: 'SET_BLOCK_DONE', entryId: 'b1', done: true });
    expect(first.tasks.find((t) => t.id === 't-call-a')?.statusId).toBe('active');
    const both = reducer(first, { type: 'SET_BLOCK_DONE', entryId: 'b2', done: true });
    expect(both.tasks.find((t) => t.id === 't-call-a')?.statusId).toBe('done');
  });
  it('ostatni blok zamyka zadanie także bez wpisu 1:1 (godziny bloku w całości zajęte innym wpisem)', () => {
    const s = state({
      tasks: [task('t-design', 'p-a', 'Design strony www', { estimatedHours: 2 }), task('t-call-a', 'p-a', 'Rozmowa z klientem', { estimatedHours: null })],
      workload: [block('b1', 't-design', 'me', 600, 2)],
      timeEntries: [entry('w1', 't-call-a', 600, 720)],
    });
    const done = reducer(s, { type: 'SET_BLOCK_DONE', entryId: 'b1', done: true });
    expect(done.timeEntries).toHaveLength(1); // wpis 1:1 nie powstał (kolizja)
    expect(done.tasks.find((t) => t.id === 't-design')?.statusId).toBe('done');
  });
  it('seria cykliczna nigdy nie zamyka się z bloków — statusem rządzi SET_TASK_STATUS', () => {
    const recurring = task('t-call-a', 'p-a', 'Rozmowa z klientem', {
      estimatedHours: null,
      recurrence: { daysOfWeek: [1, 2, 3, 4, 5], startMinutes: 600, durationMinutes: 60 },
    });
    const s = state({
      tasks: [task('t-design', 'p-a', 'Design strony www'), recurring],
      workload: [block('b1', 't-call-a', 'me', 600, 1)],
    });
    const done = reducer(s, { type: 'SET_BLOCK_DONE', entryId: 'b1', done: true });
    expect(done.workload[0].done).toBe(true);
    expect(done.tasks.find((t) => t.id === 't-call-a')?.statusId).toBe('active');
  });
});

describe('nadwyżka wykonania: zasobnik → wolne sprzedane → ponad sprzedane', () => {
  const bin = (id: string, taskId: string, personId: string, hours: number): WorkloadEntry => ({
    id, taskId, personId, date: '', plannedHours: hours, startMinutes: 0, sortIndex: 0,
  });
  const add = (s: AppData, start: number, end: number, accept?: boolean) =>
    reducer(s, { type: 'ADD_TIME_ENTRY', payload: { personId: 'me', taskId: 't-design', date: DAY, startMinutes: start, endMinutes: end, source: 'manual', ...(accept ? { acceptOverrun: true } : {}) } });

  it('plan 2h, wykonane 3h, zasobnik 1h: zasobnik znika, blok rośnie do 3h (jak rozciągnięcie)', () => {
    const s = state({ workload: [block('b1', 't-design', 'me', 600, 2), bin('bin1', 't-design', 'me', 1)] });
    const next = add(s, 600, 780);
    expect(next.workload.find((w) => w.id === 'bin1')).toBeUndefined();
    expect(next.workload.find((w) => w.id === 'b1')).toMatchObject({ plannedHours: 3, done: true });
    expect(next.timeEntries[0].overrunMinutes).toBeUndefined();
  });
  it('zasobnik 30 min, nadwyżka 1h: 30 min z zasobnika, reszta z wolnych sprzedanych; bez pokrycia → odrzucenie bez zgody', () => {
    // estymata 3h: blok 2h + zasobnik 0.5h → wolne sprzedane 0.5h
    const s = state({ workload: [block('b1', 't-design', 'me', 600, 2), bin('bin1', 't-design', 'me', 0.5)] });
    const ok = add(s, 600, 780); // 3h = 2h + 0.5 (zasobnik) + 0.5 (wolne)
    expect(ok.workload.find((w) => w.id === 'bin1')).toBeUndefined();
    expect(ok.workload.find((w) => w.id === 'b1')?.plannedHours).toBe(3);
    // 3h 30m: brakuje 30 min pokrycia → bez zgody ta sama referencja
    const rejected = add(s, 600, 810);
    expect(rejected).toBe(s);
    const accepted = add(s, 600, 810, true);
    expect(accepted.timeEntries[0].overrunMinutes).toBe(30);
    expect(accepted.workload.find((w) => w.id === 'b1')?.plannedHours).toBe(3); // sprzedanych nie ruszamy
  });
  it('powrót do zadania po bloku innego zadania: nadwyżka dostaje NOWY blok w godzinach wpisu, stary nie rośnie w poprzek', () => {
    // Lustro zgłoszenia z 2026-09-01: plan Agencyjne 9:00-9:30 + Analiza
    // 9:30-10:15 (inne zadanie). Wpisy: 9:00-9:30 Agencyjne, 9:30-10:15
    // Analiza, 10:15-10:30 znowu Agencyjne. Stary blok Agencyjne NIE może
    // urosnąć do 9:00-9:45 (nachodziłby na Analizę) — powstaje nowy blok
    // 10:15-10:30 (wykonany).
    const s = state({
      workload: [
        block('b-agency', 't-design', 'me', 540, 0.5),
        block('b-analiza', 't-call-a', 'me', 570, 0.75, 1),
      ],
    });
    let next = add(s, 540, 570);
    next = reducer(next, { type: 'ADD_TIME_ENTRY', payload: { personId: 'me', taskId: 't-call-a', date: DAY, startMinutes: 570, endMinutes: 615, source: 'manual' } });
    next = add(next, 615, 630);
    expect(next.workload.find((w) => w.id === 'b-agency')).toMatchObject({ plannedHours: 0.5, done: true });
    const created = next.workload.find((w) => w.taskId === 't-design' && w.date === DAY && w.startMinutes === 615);
    expect(created).toMatchObject({ plannedHours: 0.25, startMinutes: 615, done: true });
    const lastEntry = next.timeEntries[next.timeEntries.length - 1];
    expect(lastEntry.planGrowth).toEqual([{ blockId: created?.id, minutes: 15, fromBinMinutes: 0 }]);
    // Skasowanie wpisu zabiera świeży blok w całości (odwrót księgowości).
    const back = reducer(next, { type: 'DELETE_TIME_ENTRY', entryId: lastEntry.id });
    expect(back.workload.find((w) => w.id === created?.id)).toBeUndefined();
  });
  it('wpis przylegający do końca bloku pary nadal rozciąga TEN blok', () => {
    const s = state({ workload: [block('b1', 't-design', 'me', 540, 0.5)] });
    const first = add(s, 540, 570);
    const next = add(first, 570, 600);
    expect(next.workload.find((w) => w.id === 'b1')).toMatchObject({ plannedHours: 1, done: true });
    expect(next.workload.filter((w) => w.taskId === 't-design' && w.date === DAY)).toHaveLength(1);
  });
  it('wpis przed blokiem (przylega do POCZĄTKU) nie wydłuża jego końca: nadwyżka dostaje nowy blok w godzinach wpisu', () => {
    // Wzrost zawsze wydłuża koniec bloku — praca wykonana PRZED blokiem nie
    // może więc urosnąć na nim (kłamałaby o godzinach i nachodziła na to, co
    // stoi w planie za blokiem). Plan 10:00-10:30, wpisy 10:00-10:30 i 9:30-10:00.
    const s = state({ workload: [block('b1', 't-design', 'me', 600, 0.5)] });
    const first = add(s, 600, 630);
    const next = add(first, 570, 600);
    expect(next.workload.find((w) => w.id === 'b1')).toMatchObject({ plannedHours: 0.5, startMinutes: 600 });
    const created = next.workload.find((w) => w.taskId === 't-design' && w.date === DAY && w.startMinutes === 570);
    expect(created).toMatchObject({ plannedHours: 0.5, done: true });
    const lastEntry = next.timeEntries[next.timeEntries.length - 1];
    expect(lastEntry.planGrowth).toEqual([{ blockId: created?.id, minutes: 30, fromBinMinutes: 0 }]);
  });
  it('umiejscowienie wzrostu NIE zależy od kolejności dodawania wpisów', () => {
    // Te same dwa wpisy (9:30-10:00 i 10:00-10:30) na plan 10:00-10:30 dają
    // ten sam plan niezależnie od tego, który wszedł pierwszy: nowy blok
    // 9:30-10:00, stary nietknięty. Geometria luk, nie „kto przelał plan".
    const s = state({ workload: [block('b1', 't-design', 'me', 600, 0.5)] });
    const shape = (d: AppData) =>
      d.workload
        .filter((w) => w.taskId === 't-design' && w.date === DAY)
        .map((w) => ({ startMinutes: w.startMinutes, plannedHours: w.plannedHours }))
        .sort((a, b) => a.startMinutes - b.startMinutes);
    const orderA = add(add(s, 600, 630), 570, 600);
    const orderB = add(add(s, 570, 600), 600, 630);
    const expected = [
      { startMinutes: 570, plannedHours: 0.5 },
      { startMinutes: 600, plannedHours: 0.5 },
    ];
    expect(shape(orderA)).toEqual(expected);
    expect(shape(orderB)).toEqual(expected);
    // Księgowość wzrostu siedzi na wpisie, KTÓREGO GODZINY wzrost pokrył
    // (9:30-10:00), niezależnie od tego, który wpis przelał plan — skasowanie
    // tego wpisu zabiera świeży blok, stary plan zostaje nietknięty.
    for (const grown of [orderA, orderB]) {
      const backfill = grown.timeEntries.find((e) => e.startMinutes === 570);
      expect(backfill?.planGrowth).toEqual([expect.objectContaining({ minutes: 30 })]);
      const back = reducer(grown, { type: 'DELETE_TIME_ENTRY', entryId: backfill!.id });
      expect(shape(back)).toEqual([{ startMinutes: 600, plannedHours: 0.5 }]);
    }
    // Skasowanie wpisu WYZWALAJĄCEGO (10:00-10:30, bez własnej księgowości)
    // też przycina dorośnięty plan: kawałek na wpisie 9:30-10:00 znika, plan
    // wraca do wykonania, zero osieroconego wzrostu.
    for (const grown of [orderA, orderB]) {
      const trigger = grown.timeEntries.find((e) => e.startMinutes === 600);
      expect(trigger?.planGrowth).toBeUndefined();
      const back = reducer(grown, { type: 'DELETE_TIME_ENTRY', entryId: trigger!.id });
      expect(shape(back)).toEqual([{ startMinutes: 600, plannedHours: 0.5 }]);
      expect(back.timeEntries[0].planGrowth).toBeUndefined();
    }
    // Wpis „ponad sprzedane" nie maskuje nadmiaru: jego minuty z definicji
    // nie mają pokrycia w planie, więc przycięcie po skasowaniu wyzwalającego
    // dalej zdejmuje dorośnięty kawałek.
    const withOverrun = {
      ...orderA,
      timeEntries: [...orderA.timeEntries, entry('w-over', 't-design', 900, 930, { overrunMinutes: 30 })],
    };
    const trigger = withOverrun.timeEntries.find((e) => e.startMinutes === 600)!;
    const back = reducer(withOverrun, { type: 'DELETE_TIME_ENTRY', entryId: trigger.id });
    expect(shape(back)).toEqual([{ startMinutes: 600, plannedHours: 0.5 }]);
  });
  it('luka obejmująca DWA wpisy: każdy dostaje własny blok i własny rekord — skasowanie jednego nie cofa cudzego planu', () => {
    // Plan 10:30-11:00. Wpisy 9:30-10:00 i 10:00-10:30 (backfill), potem
    // 10:30-11:00 przelewa plan o 1h. Luka 9:30-10:30 dzieli się po granicach
    // wpisów: dwa bloki po 30 min, księgowość osobno. Skasowanie wpisu
    // 9:30-10:00 zabiera tylko JEGO blok.
    const s = state({ workload: [block('b1', 't-design', 'me', 630, 0.5)] });
    let next = add(add(s, 570, 600), 600, 630);
    next = add(next, 630, 660);
    const blocks = next.workload.filter((w) => w.taskId === 't-design' && w.date === DAY).sort((a, b) => a.startMinutes - b.startMinutes);
    expect(blocks.map((w) => ({ startMinutes: w.startMinutes, plannedHours: w.plannedHours }))).toEqual([
      { startMinutes: 570, plannedHours: 0.5 },
      { startMinutes: 600, plannedHours: 0.5 },
      { startMinutes: 630, plannedHours: 0.5 },
    ]);
    const e1 = next.timeEntries.find((e) => e.startMinutes === 570)!;
    const e2 = next.timeEntries.find((e) => e.startMinutes === 600)!;
    expect(e1.planGrowth).toEqual([expect.objectContaining({ minutes: 30 })]);
    expect(e2.planGrowth).toEqual([expect.objectContaining({ minutes: 30 })]);
    expect(e1.planGrowth?.[0].blockId).not.toBe(e2.planGrowth?.[0].blockId);
    const back = reducer(next, { type: 'DELETE_TIME_ENTRY', entryId: e1.id });
    const left = back.workload.filter((w) => w.taskId === 't-design' && w.date === DAY).sort((a, b) => a.startMinutes - b.startMinutes);
    expect(left.map((w) => w.startMinutes)).toEqual([600, 630]);
  });
  it('wzrost większy niż pojedyncza luka konsumuje luki po kolei, fallback tylko na resztkę bez wolnych minut', () => {
    // Wpis 9:30-11:00 oplata własny blok 10:00-10:30: luki 9:30-10:00 i
    // 10:30-11:00 (po 30 min), wzrost 1h. Rozłączne kawałki jednego wpisu to
    // OSOBNE pozycje listy `planGrowth`: nowy blok 9:30-10:00 plus b1
    // rozciągnięty do 11:00 — plan pokrywa wykonanie 1:1, zero nakładek, a
    // skasowanie wpisu cofa dokładnie 1h.
    const s = state({ workload: [block('b1', 't-design', 'me', 600, 0.5)] });
    const next = add(s, 570, 660);
    const blocks = next.workload
      .filter((w) => w.taskId === 't-design' && w.date === DAY)
      .sort((a, b) => a.startMinutes - b.startMinutes);
    expect(blocks.map((w) => ({ startMinutes: w.startMinutes, plannedHours: w.plannedHours }))).toEqual([
      { startMinutes: 570, plannedHours: 0.5 },
      { startMinutes: 600, plannedHours: 1 },
    ]);
    const e = next.timeEntries[0];
    expect(e.planGrowth).toEqual([
      { blockId: blocks[0].id, minutes: 30, fromBinMinutes: 0 },
      { blockId: 'b1', minutes: 30, fromBinMinutes: 0 },
    ]);
    const back = reducer(next, { type: 'DELETE_TIME_ENTRY', entryId: e.id });
    const left = back.workload.filter((w) => w.taskId === 't-design' && w.date === DAY);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ id: 'b1', plannedHours: 0.5 });
  });
  it('powtórny wzrost na wpisie z księgowością: rekord akumuluje na tym samym bloku, sierota nie powstaje', () => {
    // Wpis 10:00-12:00 urósł kiedyś o 30 min (rekord na b1) i niesie 60 min
    // nadwyżki. Po podniesieniu estymaty kolejny wpis wyzwala wzrost, którego
    // segment ląduje w niepokrytych godzinach PIERWSZEGO wpisu: b1 rośnie
    // dalej, rekord sumuje się do 60 min — skasowanie wpisu cofa całość.
    const s = state({
      workload: [{ ...block('b1', 't-design', 'me', 600, 1), done: true }],
      timeEntries: [
        entry('w1', 't-design', 600, 720, { planGrowth: [{ blockId: 'b1', minutes: 30, fromBinMinutes: 0 }], overrunMinutes: 60 }),
      ],
    });
    const next = reducer(s, { type: 'ADD_TIME_ENTRY', payload: { personId: 'me', taskId: 't-design', date: DAY, startMinutes: 840, endMinutes: 870, source: 'manual' } });
    expect(next.workload.find((w) => w.id === 'b1')?.plannedHours).toBe(1.5);
    expect(next.workload.filter((w) => w.taskId === 't-design' && w.date === DAY)).toHaveLength(1);
    const w1 = next.timeEntries.find((e) => e.id === 'w1');
    expect(w1?.planGrowth).toEqual([{ blockId: 'b1', minutes: 60, fromBinMinutes: 0 }]);
    const back = reducer(next, { type: 'DELETE_TIME_ENTRY', entryId: 'w1' });
    expect(back.workload.find((w) => w.id === 'b1')?.plannedHours).toBe(0.5);
  });
  it('backfill rana przy pokrytym popołudniu: nowy blok w godzinach rannego wpisu, nie duplikat na bloku', () => {
    const s = state({ workload: [block('b1', 't-design', 'me', 840, 0.5)] });
    const next = add(add(s, 840, 870), 540, 570);
    expect(next.workload.find((w) => w.id === 'b1')).toMatchObject({ plannedHours: 0.5, startMinutes: 840 });
    const created = next.workload.find((w) => w.taskId === 't-design' && w.date === DAY && w.startMinutes === 540);
    expect(created).toMatchObject({ plannedHours: 0.5, done: true });
  });
  it('kubełek (bez estymaty) nigdy nie przekracza: blok dopisuje się w godzinach wpisu', () => {
    const s = state();
    const next = reducer(s, { type: 'ADD_TIME_ENTRY', payload: { personId: 'me', taskId: 't-call-a', date: DAY, startMinutes: 900, endMinutes: 945, source: 'manual' } });
    expect(next.workload).toHaveLength(1);
    expect(next.workload[0]).toMatchObject({ taskId: 't-call-a', date: DAY, startMinutes: 900, plannedHours: 0.75, done: true });
    expect(next.timeEntries[0].overrunMinutes).toBeUndefined();
  });
  it('poprawka wydłużająca wpis liczy nadwyżkę bez starej długości tego wpisu', () => {
    const s = state({ workload: [block('b1', 't-design', 'me', 600, 2), bin('bin1', 't-design', 'me', 1)], timeEntries: [entry('w1', 't-design', 600, 720)] });
    const next = reducer(s, { type: 'UPDATE_TIME_ENTRY', entryId: 'w1', taskId: 't-design', startMinutes: 600, endMinutes: 780 });
    expect(next.workload.find((w) => w.id === 'b1')?.plannedHours).toBe(3);
    expect(next.workload.find((w) => w.id === 'bin1')).toBeUndefined();
  });
});

describe('wykonanie ponad plan: przedziały dla kalendarza', () => {
  it('plan 1h, wykonane 8h bez pokrycia: ogon to godziny 10:00-17:00', () => {
    // Lustro zgłoszenia z 2026-08-20: zadanie sprzedane co do minuty, więc
    // nadwyżka nie ma z czego urosnąć w planie i zostaje ponad sprzedane.
    const s = state({
      workload: [block('b1', 't-design', 'me', 540, 1)],
      timeEntries: [entry('w1', 't-design', 540, 1020, { overrunMinutes: 420 })],
    });
    expect(plannedMinutesForTaskPersonDate(s, 't-design', 'me', DAY)).toBe(60);
    expect(overrunIntervalsForPersonDate(s, 'me', DAY)).toEqual([
      { personId: 'me', taskId: 't-design', startMinutes: 600, endMinutes: 1020 },
    ]);
    expect(overrunMinutesOnDate(s, DAY)).toBe(420);
  });
  it('wykonanie w granicach planu nie daje ogona — także gdy godziny się rozjeżdżają', () => {
    const s = state({
      workload: [block('b1', 't-design', 'me', 540, 2)],
      timeEntries: [entry('w1', 't-design', 840, 900)], // 1h po południu z 2h planu
    });
    expect(overrunIntervalsForPersonDate(s, 'me', DAY)).toEqual([]);
    expect(overrunMinutesOnDate(s, DAY)).toBe(0);
  });
  it('plan wypełnia się PO KOLEI: pierwszy wpis pokryty, ogon zostaje na drugim', () => {
    const s = state({
      workload: [block('b1', 't-design', 'me', 540, 1)],
      timeEntries: [entry('w1', 't-design', 540, 600), entry('w2', 't-design', 660, 780)],
    });
    expect(overrunIntervalsForPersonDate(s, 'me', DAY)).toEqual([
      { personId: 'me', taskId: 't-design', startMinutes: 660, endMinutes: 780 },
    ]);
  });
  it('nadwyżka siada tam, gdzie wykonanie nie ma planu na zegarze, nie na końcu pokrytego bloku (2026-09-02)', () => {
    // Zgłoszenie Kacpra: blok 13:00-14:30 i wpis 13:00-14:30 + osobne 15 min o 11:00.
    // Dawny ogon rysował 14:15-14:30 obok pokrytego bloku; teraz 11:00-11:15.
    const s = state({
      workload: [block('b1', 't-design', 'me', 780, 1.5)],
      timeEntries: [entry('w1', 't-design', 660, 675), entry('w2', 't-design', 780, 870)],
    });
    expect(overrunIntervalsForPersonDate(s, 'me', DAY)).toEqual([
      { personId: 'me', taskId: 't-design', startMinutes: 660, endMinutes: 675 },
    ]);
    expect(overrunMinutesOnDate(s, DAY)).toBe(15);
    // Więcej minut bez planu niż nadwyżki: znacznik dostają NAJPÓŹNIEJSZE z nich.
    const shifted = state({
      workload: [block('b1', 't-design', 'me', 540, 1)],
      timeEntries: [entry('w1', 't-design', 660, 720), entry('w2', 't-design', 780, 840)],
    });
    expect(overrunIntervalsForPersonDate(shifted, 'me', DAY)).toEqual([
      { personId: 'me', taskId: 't-design', startMinutes: 780, endMinutes: 840 },
    ]);
  });
  it('zasobnik NIE liczy się jako pokrycie dnia (plan dnia to bloki datowane)', () => {
    const s = state({
      workload: [
        block('b1', 't-design', 'me', 540, 1),
        { id: 'bin1', taskId: 't-design', personId: 'me', date: '', plannedHours: 2, startMinutes: 0, sortIndex: 0 },
      ],
      timeEntries: [entry('w1', 't-design', 540, 720)],
    });
    expect(overrunMinutesOnDate(s, DAY)).toBe(120);
  });
  it('filtr osób zawęża warstwę; pusty filtr to cały zespół', () => {
    const s = state({
      workload: [],
      timeEntries: [
        entry('w1', 't-call-a', 540, 600),
        entry('w2', 't-call-a', 600, 660, { personId: 'other' }),
      ],
    });
    expect(overrunMinutesOnDate(s, DAY)).toBe(120);
    expect(overrunMinutesOnDate(s, DAY, new Set())).toBe(120);
    expect(overrunIntervalsOnDate(s, DAY, new Set(['other']))).toEqual([
      { personId: 'other', taskId: 't-call-a', startMinutes: 600, endMinutes: 660 },
    ]);
  });
  it('inny dzień nie wchodzi do przedziałów dnia', () => {
    const s = state({
      workload: [],
      timeEntries: [entry('w1', 't-call-a', 540, 600, { date: '2026-08-14' })],
    });
    expect(overrunMinutesOnDate(s, DAY)).toBe(0);
  });
});

describe('SETTLE_TRACKED_DAY: przeszłość = fakty', () => {
  it('niewykonany blok po 15 min od końca oddaje niepokrytą część do zasobnika; dzień bez wpisów nietknięty', () => {
    const s = state({
      workload: [block('b1', 't-design', 'me', 600, 2), block('b2', 't-call-a', 'me', 780, 1, 1)],
      timeEntries: [entry('w1', 't-design', 600, 660)], // 1h z 2h designu
    });
    // 12:10 — blok designu skończył się 12:00, minęło tylko 10 min → nic
    expect(reducer(s, { type: 'SETTLE_TRACKED_DAY', personId: 'me', date: DAY, nowMinutes: 730 })).toBe(s);
    // 12:15 — design rozliczony: 1h pokryta zostaje (wykonana), 1h do zasobnika; call 13-14 jeszcze nie minął
    const next = reducer(s, { type: 'SETTLE_TRACKED_DAY', personId: 'me', date: DAY, nowMinutes: 735 });
    expect(next.workload.find((w) => w.id === 'b1')).toMatchObject({ plannedHours: 1, done: true });
    expect(next.workload.find((w) => w.taskId === 't-design' && w.date === '')?.plannedHours).toBe(1);
    expect(next.workload.find((w) => w.id === 'b2')).toMatchObject({ plannedHours: 1 });
    // dzień miniony w całości (nowMinutes null): call bez wpisów znika w całości do zasobnika
    const later = reducer(next, { type: 'SETTLE_TRACKED_DAY', personId: 'me', date: DAY, nowMinutes: null });
    expect(later.workload.find((w) => w.id === 'b2')).toBeUndefined();
    expect(later.workload.find((w) => w.taskId === 't-call-a' && w.date === '')?.plannedHours).toBe(1);
    // AUTOMAT (nowMinutes podane) na dniu bez wpisów: nic — dzień nieśledzony
    const other = state({ workload: [block('b9', 't-design', 'other', 600, 2)] });
    expect(reducer(other, { type: 'SETTLE_TRACKED_DAY', personId: 'other', date: DAY, nowMinutes: 1439 })).toBe(other);
    // JAWNE rozliczenie (nowMinutes null) działa też bez wpisów: blok dodany
    // wstecz na pusty miniony dzień wraca w całości do zasobnika
    const explicit = reducer(other, { type: 'SETTLE_TRACKED_DAY', personId: 'other', date: DAY, nowMinutes: null });
    expect(explicit.workload.find((w) => w.id === 'b9')).toBeUndefined();
    expect(explicit.workload.find((w) => w.taskId === 't-design' && w.date === '')?.plannedHours).toBe(2);
  });
  it('jawne rozliczenie DZISIAJ (explicit + nowMinutes): działa bez wpisów, ale tylko bloki, które się skończyły', () => {
    const s = state({ workload: [block('b1', 't-design', 'me', 600, 2), block('b2', 't-call-a', 'me', 1080, 1, 1)] }); // 10-12, 18-19
    // automat bez wpisów: nic (dzień nieśledzony) — i nikt go już nie wysyła
    expect(reducer(s, { type: 'SETTLE_TRACKED_DAY', personId: 'me', date: DAY, nowMinutes: 1035 })).toBe(s);
    const next = reducer(s, { type: 'SETTLE_TRACKED_DAY', personId: 'me', date: DAY, nowMinutes: 1035, explicit: true });
    expect(next.workload.find((w) => w.id === 'b1')).toBeUndefined();
    expect(next.workload.find((w) => w.id === 'b2')).toMatchObject({ plannedHours: 1 });
    expect(next.workload.find((w) => w.taskId === 't-design' && w.date === '')?.plannedHours).toBe(2);
  });
});

describe('odwrót „wykonanie → plan” (kasowanie / poprawka wpisu)', () => {
  const bin = (id: string, taskId: string, personId: string, hours: number): WorkloadEntry => ({
    id, taskId, personId, date: '', plannedHours: hours, startMinutes: 0, sortIndex: 0,
  });
  const add = (s: AppData, start: number, end: number) =>
    reducer(s, { type: 'ADD_TIME_ENTRY', payload: { personId: 'me', taskId: 't-design', date: DAY, startMinutes: start, endMinutes: end, source: 'manual' } });

  it('wpis niesie księgowość wzrostu; skasowanie cofa blok i oddaje zasobnik', () => {
    const s = state({ workload: [block('b1', 't-design', 'me', 600, 2), bin('bin1', 't-design', 'me', 1)] });
    const grown = add(s, 600, 780); // 3h: blok 2h→3h, zasobnik 1h→0
    const e = grown.timeEntries[0];
    expect(e.planGrowth).toEqual([{ blockId: 'b1', minutes: 60, fromBinMinutes: 60 }]);
    const back = reducer(grown, { type: 'DELETE_TIME_ENTRY', entryId: e.id });
    expect(back.workload.find((w) => w.id === 'b1')).toMatchObject({ plannedHours: 2, done: false });
    expect(back.workload.find((w) => w.taskId === 't-design' && w.date === '')?.plannedHours).toBe(1);
    expect(back.timeEntries).toHaveLength(0);
  });
  it('pomyłkowy wpis na kubełek: blok powstał i znika bez śladu po skasowaniu', () => {
    const s = state();
    const grown = reducer(s, { type: 'ADD_TIME_ENTRY', payload: { personId: 'me', taskId: 't-call-a', date: DAY, startMinutes: 900, endMinutes: 960, source: 'manual' } });
    expect(grown.workload).toHaveLength(1);
    const back = reducer(grown, { type: 'DELETE_TIME_ENTRY', entryId: grown.timeEntries[0].id });
    expect(back.workload).toHaveLength(0);
  });
  it('poprawka skracająca wpis cofa stary wzrost i liczy nowy od zera', () => {
    const s = state({ workload: [block('b1', 't-design', 'me', 600, 2), bin('bin1', 't-design', 'me', 1)] });
    const grown = add(s, 600, 780); // 3h
    const id = grown.timeEntries[0].id;
    const shrunk = reducer(grown, { type: 'UPDATE_TIME_ENTRY', entryId: id, taskId: 't-design', startMinutes: 600, endMinutes: 720 }); // 2h
    expect(shrunk.workload.find((w) => w.id === 'b1')).toMatchObject({ plannedHours: 2, done: true });
    expect(shrunk.workload.find((w) => w.taskId === 't-design' && w.date === '')?.plannedHours).toBe(1);
    expect(shrunk.timeEntries[0].planGrowth).toBeUndefined();
    // wydłużenie z powrotem: znowu z zasobnika
    const regrown = reducer(shrunk, { type: 'UPDATE_TIME_ENTRY', entryId: id, taskId: 't-design', startMinutes: 600, endMinutes: 750 }); // 2h 30m
    expect(regrown.workload.find((w) => w.id === 'b1')?.plannedHours).toBe(2.5);
    expect(regrown.workload.find((w) => w.taskId === 't-design' && w.date === '')?.plannedHours).toBe(0.5);
    expect(regrown.timeEntries[0].planGrowth).toEqual([{ blockId: 'b1', minutes: 30, fromBinMinutes: 30 }]);
  });
  it('skasowanie wpisu odznacza blok pokryty wyłącznie tym wpisem', () => {
    const s = state({ workload: [block('b1', 't-design', 'me', 600, 1)] });
    const done = add(s, 600, 660);
    expect(done.workload[0].done).toBe(true);
    const back = reducer(done, { type: 'DELETE_TIME_ENTRY', entryId: done.timeEntries[0].id });
    expect(back.workload[0].done).toBe(false);
  });
  it('blok z wzrostem usunięty ręcznie: odwrót nie mintuje godzin (brak zmian w planie)', () => {
    const s = state({ workload: [block('b1', 't-design', 'me', 600, 2), bin('bin1', 't-design', 'me', 1)] });
    const grown = add(s, 600, 780);
    const noBlock = { ...grown, workload: grown.workload.filter((w) => w.id !== 'b1') };
    const back = reducer(noBlock, { type: 'DELETE_TIME_ENTRY', entryId: grown.timeEntries[0].id });
    expect(back.workload.find((w) => w.taskId === 't-design' && w.date === '')).toBeUndefined();
    expect(back.timeEntries).toHaveLength(0);
  });
});

describe('odcięcie rozliczenia: dzisiaj po końcu dnia pracy, karencja przez północ', () => {
  it('settleCutoffMinutes: przyszłość null; dzisiaj od końca pracy + 15 min; koniec o 24:00 nie dzisiaj', () => {
    expect(settleCutoffMinutes('2026-08-14', DAY, 1439, 960)).toBeNull(); // jutro
    expect(settleCutoffMinutes(DAY, DAY, 970, 960)).toBeNull(); // 16:10, koniec pracy 16:00
    expect(settleCutoffMinutes(DAY, DAY, 975, 960)).toBe(975); // 16:15
    expect(settleCutoffMinutes(DAY, DAY, 1439, 1440)).toBeNull(); // koniec pracy 24:00
    expect(settleCutoffMinutes(DAY, DAY, 1439, 1430)).toBeNull(); // 23:50 + 15 nie mieści się w dobie
  });
  it('settleCutoffMinutes: wczoraj tuż po północy odcięcie idzie przez północ, starsze dni bez ograniczeń', () => {
    expect(settleCutoffMinutes('2026-08-12', '2026-08-13', 5, 960)).toBe(1445);
    expect(settleCutoffMinutes('2026-08-12', '2026-08-13', 15, 960)).toBe(1455);
    expect(settleCutoffMinutes('2026-08-11', '2026-08-13', 0, 960)).toBe(2880);
  });
  it('settleDueBlocks: tylko bloki zakończone ≥ 15 min przed odcięciem; null = nic', () => {
    const s = state({ workload: [block('b1', 't-design', 'me', 840, 1), block('b2', 't-call-a', 'me', 960, 0.5, 1), block('b3', 't-call-b', 'me', 1380, 1, 2)] }); // 14-15, 16-16:30, 23-24
    const plan = dayPlanForPerson(s, 'me', DAY);
    expect(settleDueBlocks(plan, null)).toEqual([]);
    expect(settleDueBlocks(plan, 975).map((b) => b.block.id)).toEqual(['b1']); // 16:15: 16:30 jeszcze trwa
    expect(settleDueBlocks(plan, 1005).map((b) => b.block.id)).toEqual(['b1', 'b2']);
    expect(settleDueBlocks(plan, 1445).map((b) => b.block.id)).toEqual(['b1', 'b2']); // 00:05 nazajutrz: blok do 24:00 ma karencję
    expect(settleDueBlocks(plan, 1455).map((b) => b.block.id)).toEqual(['b1', 'b2', 'b3']);
  });
});

describe('wcięcie planu pod fakt (2026-09-02, „duży task w planie a krótki”)', () => {
  const BIG = task('t-big', 'p-a', 'Wdrożenie sklepu', { estimatedHours: 40 });
  const base = () =>
    state({
      tasks: [BIG, task('t-call-a', 'p-a', 'Rozmowa z klientem', { estimatedHours: null })],
      workload: [block('b1', 't-big', 'me', 540, 8)], // 9:00-17:00
    });
  const dated = (s: AppData, taskId: string) =>
    s.workload.filter((w) => w.date === DAY && w.taskId === taskId).sort((a, b) => a.startMinutes - b.startMinutes);

  it('carveSpan / freeRangesWithin: czysta geometria', () => {
    expect(carveSpan({ startMinutes: 540, endMinutes: 1020 }, { startMinutes: 900, endMinutes: 915 })).toEqual({ head: [540, 900], tail: [915, 1020], cutMinutes: 15 });
    expect(carveSpan({ startMinutes: 540, endMinutes: 1020 }, { startMinutes: 540, endMinutes: 600 })).toEqual({ head: null, tail: [600, 1020], cutMinutes: 60 });
    expect(carveSpan({ startMinutes: 540, endMinutes: 600 }, { startMinutes: 500, endMinutes: 700 })).toEqual({ head: null, tail: null, cutMinutes: 60 });
    expect(carveSpan({ startMinutes: 540, endMinutes: 600 }, { startMinutes: 600, endMinutes: 660 })).toEqual({ head: null, tail: null, cutMinutes: 0 });
    expect(freeRangesWithin(600, 720, [{ startMinutes: 630, endMinutes: 690 }])).toEqual([[600, 630], [690, 720]]);
    expect(freeRangesWithin(600, 720, [{ startMinutes: 500, endMinutes: 800 }])).toEqual([]);
    expect(freeRangesWithin(600, 720, [])).toEqual([[600, 720]]);
  });
  it('15 min rozmowy w środku bloku 9-17: trzy bloki (9-15, rozmowa, 15:15-17), 15 min do zasobnika', () => {
    const s = base();
    const next = reducer(s, {
      type: 'ADD_TIME_ENTRY',
      payload: { personId: 'me', taskId: 't-call-a', date: DAY, startMinutes: 900, endMinutes: 915, source: 'manual' },
    });
    expect(dated(next, 't-big').map((w) => [w.id, w.startMinutes, w.plannedHours, w.done === true])).toEqual([
      ['b1', 540, 6, false],
      [expect.any(String), 915, 1.75, false],
    ]);
    expect(dated(next, 't-call-a').map((w) => [w.startMinutes, w.plannedHours, w.done])).toEqual([[900, 0.25, true]]);
    expect(next.workload.find((w) => w.taskId === 't-big' && w.date === '')?.plannedHours).toBe(0.25);
    // kolejność dnia po czasie
    const day = next.workload.filter((w) => w.date === DAY).sort((a, b) => a.sortIndex - b.sortIndex);
    expect(day.map((w) => w.startMinutes)).toEqual([540, 900, 915]);
    // kółka na głowie i ogonie dają wpisy w wolnych godzinach: 9-15 i 15:15-17
    const tail = dated(next, 't-big')[1];
    const both = reducer(reducer(next, { type: 'SET_BLOCK_DONE', entryId: 'b1', done: true }), { type: 'SET_BLOCK_DONE', entryId: tail.id, done: true });
    expect(
      both.timeEntries.filter((e) => e.taskId === 't-big').map((e) => [e.startMinutes, e.endMinutes]).sort((a, b) => a[0] - b[0]),
    ).toEqual([[540, 900], [915, 1020]]);
    expect(loggedMinutesForPersonDate(both, 'me', DAY)).toBe(480);
  });
  it('wpis na początku bloku: bez głowy, blok przesuwa start i zachowuje id; wpis na cały blok: blok znika do zasobnika', () => {
    const s = base();
    const atStart = reducer(s, {
      type: 'ADD_TIME_ENTRY',
      payload: { personId: 'me', taskId: 't-call-a', date: DAY, startMinutes: 540, endMinutes: 600, source: 'manual' },
    });
    expect(dated(atStart, 't-big').map((w) => [w.id, w.startMinutes, w.plannedHours])).toEqual([['b1', 600, 7]]);
    const whole = reducer(s, {
      type: 'ADD_TIME_ENTRY',
      payload: { personId: 'me', taskId: 't-call-a', date: DAY, startMinutes: 540, endMinutes: 1020, source: 'manual' },
    });
    expect(dated(whole, 't-big')).toHaveLength(0);
    expect(whole.workload.find((w) => w.taskId === 't-big' && w.date === '')?.plannedHours).toBe(8);
  });
  it('wpis TEGO SAMEGO zadania nie wcina; wpis innej osoby nie wcina', () => {
    const s = base();
    const own = reducer(s, {
      type: 'ADD_TIME_ENTRY',
      payload: { personId: 'me', taskId: 't-big', date: DAY, startMinutes: 900, endMinutes: 915, source: 'manual' },
    });
    expect(dated(own, 't-big').map((w) => [w.id, w.plannedHours])).toEqual([['b1', 8]]);
    const other = reducer(s, {
      type: 'ADD_TIME_ENTRY',
      payload: { personId: 'other', taskId: 't-call-a', date: DAY, startMinutes: 900, endMinutes: 915, source: 'manual' },
    });
    expect(dated(other, 't-big').filter((w) => w.personId === 'me').map((w) => [w.id, w.plannedHours])).toEqual([['b1', 8]]);
  });
  it('wzrost planu zaksięgowany na bloku przechodzi po wcięciu na ogon; odwrót kurczy ogon, głowa zostaje (review Codex)', () => {
    const s = state({
      tasks: [BIG, task('t-call-a', 'p-a', 'Rozmowa z klientem', { estimatedHours: null })],
      workload: [block('b1', 't-big', 'me', 540, 1)], // 9:00-10:00 ręcznie
    });
    // 2h wykonania 10-12 dokleja się do końca b1 (blok 9-12, rekord na wpisie)
    const grown = reducer(s, {
      type: 'ADD_TIME_ENTRY',
      payload: { personId: 'me', taskId: 't-big', date: DAY, startMinutes: 600, endMinutes: 720, source: 'manual' },
    });
    const growthEntry = grown.timeEntries.find((e) => e.taskId === 't-big');
    // pula: pierwsza godzina wpisu pokrywa plan 1h, nadwyżka 1h rośnie na końcu b1 (blok 9-11)
    expect(grown.workload.find((w) => w.id === 'b1')?.plannedHours).toBe(2);
    expect(growthEntry?.planGrowth).toEqual([{ blockId: 'b1', minutes: 60, fromBinMinutes: 0 }]);
    // rozmowa 9:30-9:45 wcina ręczną część: głowa b1 9:00-9:30, ogon 9:45-11:00
    const carved = reducer(grown, {
      type: 'ADD_TIME_ENTRY',
      payload: { personId: 'me', taskId: 't-call-a', date: DAY, startMinutes: 570, endMinutes: 585, source: 'manual' },
    });
    const tail = dated(carved, 't-big')[1];
    expect(dated(carved, 't-big').map((w) => [w.id, w.startMinutes, w.plannedHours])).toEqual([['b1', 540, 0.5], [tail.id, 585, 1.25]]);
    // rekord wzrostu wskazuje OGON (wzrost siedzi na końcu bloku), nie głowę
    expect(carved.timeEntries.find((e) => e.taskId === 't-big')?.planGrowth).toEqual([{ blockId: tail.id, minutes: 60, fromBinMinutes: 0 }]);
    // kasowanie wpisu 10-12 zdejmuje wzrost z OGONA; głowa (ręczne 30 min) zostaje
    const gone = reducer(carved, { type: 'DELETE_TIME_ENTRY', entryId: growthEntry!.id });
    expect(dated(gone, 't-big').map((w) => [w.id, w.startMinutes, w.plannedHours])).toEqual([['b1', 540, 0.5], [tail.id, 585, 0.25]]);
    expect(gone.workload.find((w) => w.taskId === 't-big' && w.date === '')?.plannedHours).toBe(0.25);
  });
  it('poprawka wpisu wcina ponownie w nowych godzinach (wcięcie jest jednokierunkowe)', () => {
    const s = base();
    const added = reducer(s, {
      type: 'ADD_TIME_ENTRY',
      payload: { personId: 'me', taskId: 't-call-a', date: DAY, startMinutes: 900, endMinutes: 915, source: 'manual' },
    });
    const id = added.timeEntries[0].id;
    const moved = reducer(added, { type: 'UPDATE_TIME_ENTRY', entryId: id, taskId: 't-call-a', startMinutes: 960, endMinutes: 975 });
    expect(dated(moved, 't-big').map((w) => [w.startMinutes, w.plannedHours])).toEqual([[540, 6], [915, 0.75], [975, 0.75]]);
    expect(dated(moved, 't-call-a').map((w) => [w.startMinutes, w.plannedHours])).toEqual([[960, 0.25]]);
  });
});

describe('taskTimeSummary („Ile na co”)', () => {
  it('sumuje wpisy i plan per zadanie w podanych dniach, malejąco po wykonaniu', () => {
    const s = state({
      workload: [block('b1', 't-design', 'me', 600, 2)],
      timeEntries: [
        entry('w1', 't-call-a', 540, 570),
        entry('w2', 't-call-a', 720, 750),
        entry('w3', 't-design', 600, 660),
        entry('w4', 't-done', 900, 930),
        entry('w5', 't-call-a', 540, 600, { date: '2026-08-14' }),
        entry('w6', 't-call-a', 540, 600, { personId: 'other' }),
      ],
    });
    const rows = taskTimeSummary(s, 'me', [DAY]);
    // remis wykonania (60 = 60) rozstrzyga plan malejąco
    expect(rows.map((r) => [r.taskId, r.loggedMinutes, r.plannedMinutes, r.closed])).toEqual([
      ['t-design', 60, 120, false],
      ['t-call-a', 60, 0, false],
      ['t-done', 30, 0, true],
    ]);
    expect(taskTimeSummary(s, 'me', [DAY, '2026-08-14'])[0]).toMatchObject({ taskId: 't-call-a', loggedMinutes: 120 });
    expect(rows[1]).toMatchObject({ title: 'Rozmowa z klientem', clientName: 'Wodociągi Słupsk', projectName: 'Strona www' });
  });
});
