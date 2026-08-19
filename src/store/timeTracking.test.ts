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
  portionLoggedMinutes,
  resolveTaskByTitle,
  timeEntriesForPersonDate,
  trackerSuggestions,
} from './timeTracking';
import { isValidTimeRange, findOverlappingEntry, formatMinutesDuration, frecencyScore } from '../utils/timeTracking';
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
    expect(next.workload).toHaveLength(0); // tracker nie planuje
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
