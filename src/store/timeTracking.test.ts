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
  timeEntriesForPersonDate,
  trackerSuggestions,
  unsettledPlanBlocks,
} from './timeTracking';
import { isValidTimeRange, findOverlappingEntry, formatMinutesDuration, frecencyScore, freeRemainderRange } from '../utils/timeTracking';
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
  it('straże => ta sama referencja: osoba, zadanie, szkic, zrobione, data, zakres, źródło, eventId', () => {
    const s = state();
    expect(add(s, { personId: 'ghost' })).toBe(s);
    expect(add(s, { taskId: 'ghost' })).toBe(s);
    expect(add(s, { taskId: 't-draft' })).toBe(s);
    expect(add(s, { taskId: 't-done' })).toBe(s);
    expect(add(s, { date: '2026-13-40' })).toBe(s);
    expect(add(s, { startMinutes: 605 })).toBe(s);
    expect(add(s, { startMinutes: 660, endMinutes: 600 })).toBe(s);
    expect(add(s, { source: 'magic' as never })).toBe(s);
    expect(add(s, { eventId: 'k1' })).toBe(s); // eventId tylko przy source 'event'
    expect(add(s, { taskId: undefined })).toBe(s); // ani taskId, ani newTask
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
  it('straże: nieznany wpis, zły zakres, zamknięte zadanie, kolizja z INNYM wpisem, brak zmiany', () => {
    const s = state({ timeEntries: [entry('w1', 't-design', 600, 660), entry('w2', 't-design', 720, 780)] });
    expect(reducer(s, { type: 'UPDATE_TIME_ENTRY', entryId: 'ghost', taskId: 't-design', startMinutes: 600, endMinutes: 660 })).toBe(s);
    expect(reducer(s, { type: 'UPDATE_TIME_ENTRY', entryId: 'w1', taskId: 't-design', startMinutes: 600, endMinutes: 605 })).toBe(s);
    expect(reducer(s, { type: 'UPDATE_TIME_ENTRY', entryId: 'w1', taskId: 't-done', startMinutes: 600, endMinutes: 660 })).toBe(s);
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
  it('podpowiedzi: bez szkiców i zrobionych; dziś w planie na górze; potem częstość × świeżość', () => {
    const s = state({
      workload: [block('b1', 't-call-a', 'me', 600, 1)],
      timeEntries: [entry('w1', 't-call-b', 540, 570, { date: '2026-08-12' }), entry('w2', 't-call-b', 540, 570, { date: '2026-08-11' }), entry('w3', 't-design', 540, 570, { date: '2026-08-01' })],
    });
    const all = trackerSuggestions(s, 'me', DAY, '');
    expect(all.map((x) => x.task.id)).toEqual(['t-call-a', 't-call-b', 't-design']);
    expect(all[0].plannedToday).toBe(true);
    expect(all.some((x) => x.task.id === 't-done' || x.task.id === 't-draft')).toBe(false);
    // zapytanie po kliencie, bez ogonków
    expect(trackerSuggestions(s, 'me', DAY, 'wodociagi slupsk').map((x) => x.task.id)).toEqual(['t-call-a', 't-design']);
  });
  it('resolveTaskByTitle: one / ambiguous / closed / none', () => {
    const s = state();
    expect(resolveTaskByTitle(s, 'design strony WWW')).toMatchObject({ kind: 'one', task: { id: 't-design' } });
    expect(resolveTaskByTitle(s, 'Rozmowa z klientem').kind).toBe('ambiguous');
    expect(resolveTaskByTitle(s, 'Zrobione zadanie')).toMatchObject({ kind: 'closed' });
    expect(resolveTaskByTitle(s, 'Szkic')).toMatchObject({ kind: 'closed' }); // szkic nie przyjmuje czasu
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
  it('godziny bloku zajęte innym wpisem: blok wykonany, ale bez wpisu (nic nie nachodzi)', () => {
    const s = state({ workload: [block('b1', 't-design', 'me', 600, 2)], timeEntries: [entry('w1', 't-call-a', 630, 690)] });
    const done = reducer(s, { type: 'SET_BLOCK_DONE', entryId: 'b1', done: true });
    expect(done.workload[0].done).toBe(true);
    expect(done.timeEntries).toHaveLength(1);
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
    expect(e.planGrowth).toEqual({ blockId: 'b1', minutes: 60, fromBinMinutes: 60 });
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
    expect(regrown.timeEntries[0].planGrowth).toEqual({ blockId: 'b1', minutes: 30, fromBinMinutes: 30 });
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
