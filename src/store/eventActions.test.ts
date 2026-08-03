// Reduktor wydarzeń kalendarza: ADD_EVENT / SAVE_EVENT / DELETE_EVENT.
// Nacisk na inwariant 6 — każda odrzucona komenda musi zwrócić TĘ SAMĄ
// referencję stanu (nie kopię o równej wartości) — oraz na formę kanoniczną
// cykliczności (czasy reguły = czasy wydarzenia, dzień kotwicy w daysOfWeek).
// Inwariant 1: wydarzenia NIGDY nie zasilają `dayTotal`.
import { describe, expect, it } from 'vitest';
import { reducer, type EventDraft } from './AppStore';
import { emptyData } from './storage';
import { calendarEventsForDate, dayTotal } from './selectors';
import { isValidEventDraft } from './commandValidation';
import type { AppData, CalendarEvent, Person, Task, WorkloadEntry } from '../types';

const PA = '11111111-1111-4111-8111-111111111111';
const PB = '22222222-2222-4222-8222-222222222222';
// 2026-07-06 to poniedziałek (ISO 1).
const MON = '2026-07-06';
const WED = '2026-07-08';

function person(id: string, name: string): Person {
  return {
    id,
    firstName: name,
    lastName: '',
    name,
    email: `${name}@n2.pl`,
    phone: '',
    role: '',
    departmentId: '',
    companyId: '',
    avatar: '',
    capacity: 8,
    accessRole: 'pelne',
    passwordHash: '',
    workDays: [1, 2, 3, 4, 5],
    workStartMinutes: 480,
    workEndMinutes: 960,
    supervisorId: '',
    birthDate: '',
  };
}

function baseState(events: CalendarEvent[] = []): AppData {
  return { ...emptyData(), people: [person(PA, 'Ala'), person(PB, 'Bea')], events };
}

function draft(overrides: Partial<EventDraft> = {}): EventDraft {
  return {
    title: 'Spotkanie z klientem',
    description: 'Omówienie zakresu.',
    location: 'Sala A',
    meetingUrl: '',
    date: MON,
    startMinutes: 540,
    durationMinutes: 60,
    attendeeIds: [PA],
    recurrence: null,
    ...overrides,
  };
}

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    title: 'Istniejące wydarzenie',
    description: '',
    location: '',
    meetingUrl: '',
    date: MON,
    startMinutes: 600,
    durationMinutes: 30,
    attendeeIds: [],
    createdAt: '2026-07-01T10:00:00.000Z',
    updatedAt: '2026-07-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('ADD_EVENT', () => {
  it('dodaje jednorazowe wydarzenie, przycina i deduplikuje uczestników', () => {
    const state = baseState();
    const next = reducer(state, {
      type: 'ADD_EVENT',
      draft: draft({ title: '  Spotkanie  ', description: '  opis ', attendeeIds: [PA, PA] }),
    });
    expect(next).not.toBe(state);
    expect(next.events).toHaveLength(1);
    const e = next.events[0];
    expect(e.title).toBe('Spotkanie');
    expect(e.description).toBe('opis');
    expect(e.attendeeIds).toEqual([PA]);
    expect('recurrence' in e).toBe(false);
    expect(e.createdAt).toBe(e.updatedAt);
  });

  it('normalizuje adres spotkania bez schematu do https://', () => {
    const state = baseState();
    const next = reducer(state, {
      type: 'ADD_EVENT',
      draft: draft({ meetingUrl: 'meet.example.test/abc' }),
    });
    expect(next.events[0].meetingUrl).toBe('https://meet.example.test/abc');
  });

  it.each([
    ['pusty tytuł', draft({ title: '   ' })],
    ['zła data', draft({ date: 'not-a-date' })],
    ['start poza siatką 15 min', draft({ startMinutes: 545 })],
    ['start poza dobą', draft({ startMinutes: 1440 })],
    ['start+czas przekracza dobę', draft({ startMinutes: 1425, durationMinutes: 30 })],
    ['czas trwania 0', draft({ durationMinutes: 0 })],
    ['uczestnik spoza zespołu', draft({ attendeeIds: ['ghost'] })],
    ['adres javascript:', draft({ meetingUrl: 'javascript:alert(1)' })],
    ['cykliczność bez dnia kotwicy', draft({ recurrence: { daysOfWeek: [3], startMinutes: 0, durationMinutes: 15 } })],
    ['cykliczność strukturalnie zła', draft({ recurrence: { daysOfWeek: [], startMinutes: 0, durationMinutes: 0 } })],
  ])('odrzuca (%s) tą samą referencją stanu', (_label, bad) => {
    const state = baseState();
    const next = reducer(state, { type: 'ADD_EVENT', draft: bad });
    expect(next).toBe(state);
  });

  it('kanonikalizuje regułę: NADPISUJE czasy reguły czasami wydarzenia', () => {
    const state = baseState();
    const next = reducer(state, {
      type: 'ADD_EVENT',
      // Reguła podaje inne czasy niż wydarzenie — reduktor nadpisuje je czasami
      // wydarzenia. `daysOfWeek` już zawiera poniedziałek (dzień kotwicy).
      draft: draft({
        startMinutes: 540,
        durationMinutes: 60,
        recurrence: { daysOfWeek: [1, 3], startMinutes: 0, durationMinutes: 15 },
      }),
    });
    const rule = next.events[0].recurrence;
    expect(rule).toBeDefined();
    expect(rule!.startMinutes).toBe(540);
    expect(rule!.durationMinutes).toBe(60);
    expect(rule!.daysOfWeek).toEqual([1, 3]);
  });
});

describe('SAVE_EVENT', () => {
  it('zapisuje zmiany, zachowuje createdAt i odświeża updatedAt', () => {
    const state = baseState([event()]);
    const next = reducer(state, {
      type: 'SAVE_EVENT',
      eventId: event().id,
      draft: draft({ title: 'Nowy tytuł' }),
    });
    expect(next).not.toBe(state);
    const e = next.events[0];
    expect(e.title).toBe('Nowy tytuł');
    expect(e.createdAt).toBe('2026-07-01T10:00:00.000Z');
    expect(e.updatedAt).not.toBe('2026-07-01T10:00:00.000Z');
  });

  it('nieznane id => ta sama referencja', () => {
    const state = baseState([event()]);
    const next = reducer(state, { type: 'SAVE_EVENT', eventId: 'brak', draft: draft() });
    expect(next).toBe(state);
  });

  it('niepoprawny draft => ta sama referencja', () => {
    const state = baseState([event()]);
    const next = reducer(state, {
      type: 'SAVE_EVENT',
      eventId: event().id,
      draft: draft({ title: '' }),
    });
    expect(next).toBe(state);
  });
});

describe('DELETE_EVENT', () => {
  it('usuwa wydarzenie', () => {
    const state = baseState([event()]);
    const next = reducer(state, { type: 'DELETE_EVENT', eventId: event().id });
    expect(next.events).toEqual([]);
  });

  it('nieznane id => ta sama referencja', () => {
    const state = baseState([event()]);
    const next = reducer(state, { type: 'DELETE_EVENT', eventId: 'brak' });
    expect(next).toBe(state);
  });
});

// Bramka „Zapisz" w EventModal (jedno źródło prawdy z reduktorem). Modal używa
// isValidEventDraft PRZED dispatch/zamknięciem — draft odrzucony NIE może
// zamknąć modala jak po sukcesie (zasada: nieudany zapis nigdy nie raportuje
// sukcesu). Te testy pilnują właśnie tej bramki (ścieżka odrzucenia).
describe('isValidEventDraft — bramka modala', () => {
  it('poprawny draft => true', () => {
    expect(isValidEventDraft(baseState(), draft())).toBe(true);
  });

  it('cykliczne „Do" wcześniejsze niż data wydarzenia => false (regresja cichego zapisu)', () => {
    const bad = draft({
      recurrence: { daysOfWeek: [1], startMinutes: 540, durationMinutes: 60, until: '2026-07-01' },
    });
    expect(isValidEventDraft(baseState(), bad)).toBe(false);
  });

  it('czas poza siatką 15 min => false (modal snapuje przed zapisem)', () => {
    expect(isValidEventDraft(baseState(), draft({ startMinutes: 550 }))).toBe(false);
  });

  it('poprawne cykliczne „Do" == data => true', () => {
    const ok = draft({
      recurrence: { daysOfWeek: [1], startMinutes: 540, durationMinutes: 60, until: MON },
    });
    expect(isValidEventDraft(baseState(), ok)).toBe(true);
  });
});

describe('calendarEventsForDate', () => {
  it('zwraca wydarzenie jednorazowe w jego dniu i nic w innym', () => {
    const state = baseState([event({ date: MON })]);
    expect(calendarEventsForDate(state, MON)).toHaveLength(1);
    expect(calendarEventsForDate(state, WED)).toHaveLength(0);
  });

  it('rozwija cykliczne wydarzenie w oknie', () => {
    const state = baseState([
      event({
        date: MON,
        attendeeIds: [PA],
        recurrence: { daysOfWeek: [1, 3], startMinutes: 600, durationMinutes: 30 },
      }),
    ]);
    expect(calendarEventsForDate(state, MON)).toHaveLength(1); // poniedziałek
    expect(calendarEventsForDate(state, WED)).toHaveLength(1); // środa
    expect(calendarEventsForDate(state, '2026-07-07')).toHaveLength(0); // wtorek
  });

  it('filtr osób: przecięcie z uczestnikami', () => {
    const state = baseState([event({ date: MON, attendeeIds: [PB] })]);
    expect(calendarEventsForDate(state, MON, new Set([PA]))).toHaveLength(0);
    expect(calendarEventsForDate(state, MON, new Set([PB]))).toHaveLength(1);
  });

  it('wydarzenie ogólnofirmowe (bez uczestników) widać przy filtrze', () => {
    const state = baseState([event({ date: MON, attendeeIds: [] })]);
    expect(calendarEventsForDate(state, MON, new Set([PA]))).toHaveLength(1);
  });

  it('wydarzenia NIE zwiększają dayTotal (inwariant 1)', () => {
    const state = baseState([event({ date: MON, startMinutes: 600, durationMinutes: 120 })]);
    expect(dayTotal(state, MON)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Kolizja terminu (kierunek „wydarzenie -> zajęty czas osoby").
//
// Próg jest RÓŻNY zależnie od listy uczestników i to jest sedno tych testów:
// uczestnik IMIENNY blokuje zapis, wydarzenie OGÓLNOFIRMOWE przechodzi (inaczej
// spotkania całofirmowego nie dałoby się wstawić w godzinach pracy). Odrzucenie
// zawsze zwraca TĘ SAMĄ referencję stanu (inwariant 6).
// ---------------------------------------------------------------------------

const TASK_ID = '44444444-4444-4444-8444-444444444444';

function taskFor(): Task {
  return {
    id: TASK_ID,
    projectId: 'proj1',
    statusId: 'status1',
    title: 'Regresja QA',
    description: '',
    startDate: MON,
    endDate: MON,
    estimatedHours: null,
    priority: 'normal',
    workCategoryId: '',
    departmentId: '',
    checklist: [],
    orderIndex: 0,
    createdAt: '2026-07-01T08:00:00.000Z',
    updatedAt: '2026-07-01T08:00:00.000Z',
  };
}

/** Blok osoby `personId` w dniu `MON`, 10:00-11:00 (600-660). */
function blockFor(personId: string): WorkloadEntry {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    taskId: TASK_ID,
    personId,
    date: MON,
    plannedHours: 1,
    startMinutes: 600,
    sortIndex: 0,
  };
}

function stateWithBlock(personId: string, events: CalendarEvent[] = []): AppData {
  return { ...baseState(events), tasks: [taskFor()], workload: [blockFor(personId)] };
}

describe('ADD_EVENT — kolizja terminu', () => {
  it('ODRZUCA wydarzenie nachodzące na blok imiennego uczestnika (ta sama referencja)', () => {
    const state = stateWithBlock(PA);
    // Blok PA: 600-660. Wydarzenie 630-690 nachodzi.
    const next = reducer(state, {
      type: 'ADD_EVENT',
      draft: draft({ attendeeIds: [PA], startMinutes: 630, durationMinutes: 60 }),
    });
    expect(next).toBe(state);
    expect(next.events).toHaveLength(0);
  });

  it('PRZEPUSZCZA wydarzenie, gdy zajęta jest INNA osoba niż uczestnik', () => {
    const state = stateWithBlock(PB); // zajęty jest PB
    const next = reducer(state, {
      type: 'ADD_EVENT',
      draft: draft({ attendeeIds: [PA], startMinutes: 630, durationMinutes: 60 }),
    });
    expect(next.events).toHaveLength(1);
  });

  it('PRZEPUSZCZA wydarzenie stykające się krawędzią z blokiem', () => {
    const state = stateWithBlock(PA); // blok 600-660
    const next = reducer(state, {
      type: 'ADD_EVENT',
      draft: draft({ attendeeIds: [PA], startMinutes: 660, durationMinutes: 60 }), // 660-720
    });
    expect(next.events).toHaveLength(1);
  });

  it('PRZEPUSZCZA wydarzenie OGÓLNOFIRMOWE, nawet gdy wszyscy są zajęci', () => {
    const state = stateWithBlock(PA);
    const next = reducer(state, {
      type: 'ADD_EVENT',
      draft: draft({ attendeeIds: [], startMinutes: 630, durationMinutes: 60 }),
    });
    expect(next.events).toHaveLength(1);
  });

  it('ODRZUCA wydarzenie nachodzące na INNE wydarzenie tego uczestnika', () => {
    const existing = event({ id: 'ev-existing', date: MON, startMinutes: 600, durationMinutes: 60, attendeeIds: [PA] });
    const state = baseState([existing]);
    const next = reducer(state, {
      type: 'ADD_EVENT',
      draft: draft({ attendeeIds: [PA], startMinutes: 630, durationMinutes: 60 }),
    });
    expect(next).toBe(state);
    expect(next.events).toHaveLength(1);
  });

  // Wydarzenie ogólnofirmowe ZAJMUJE każdą osobę, więc imienne wydarzenie na tych
  // samych godzinach musi zostać odrzucone.
  it('ODRZUCA imienne wydarzenie nachodzące na wydarzenie OGÓLNOFIRMOWE', () => {
    const allHands = event({ id: 'ev-all', date: MON, startMinutes: 600, durationMinutes: 60, attendeeIds: [] });
    const state = baseState([allHands]);
    const next = reducer(state, {
      type: 'ADD_EVENT',
      draft: draft({ attendeeIds: [PA], startMinutes: 630, durationMinutes: 60 }),
    });
    expect(next).toBe(state);
  });
});

describe('SAVE_EVENT — kolizja terminu', () => {
  it('NIE traktuje edytowanego wydarzenia jako kolizji z samym sobą', () => {
    const existing = event({ id: 'ev-self', date: MON, startMinutes: 600, durationMinutes: 60, attendeeIds: [PA] });
    const state = baseState([existing]);
    // Zapis tych samych godzin ze zmienionym tytułem musi przejść.
    const next = reducer(state, {
      type: 'SAVE_EVENT',
      eventId: 'ev-self',
      draft: draft({ title: 'Nowy tytuł', attendeeIds: [PA], startMinutes: 600, durationMinutes: 60 }),
    });
    expect(next).not.toBe(state);
    expect(next.events[0].title).toBe('Nowy tytuł');
  });

  it('ODRZUCA przesunięcie edytowanego wydarzenia na blok uczestnika', () => {
    const existing = event({ id: 'ev-self', date: MON, startMinutes: 60, durationMinutes: 60, attendeeIds: [PA] });
    const state = { ...stateWithBlock(PA), events: [existing] };
    const next = reducer(state, {
      type: 'SAVE_EVENT',
      eventId: 'ev-self',
      draft: draft({ attendeeIds: [PA], startMinutes: 630, durationMinutes: 60 }), // na blok 600-660
    });
    expect(next).toBe(state);
    expect(next.events[0].startMinutes).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// URLOP (2026-08-03) — ten sam byt `CalendarEvent` z dyskryminatorem
// `kind: 'urlop'`. Sedno tych testów to FORMA KANONICZNA (czasy 0/1440, klucz
// `endDate` tylko przy zakresie > 1 dnia, brak cykliczności, dokładnie jeden
// uczestnik) oraz PRÓG kolizji: przy zapisie urlopu konflikt jest wyłącznie
// ostrzeżeniem, w kierunku odwrotnym twardo blokuje.
// ---------------------------------------------------------------------------

const TUE = '2026-07-07';
const FRI = '2026-07-10';

function vacationDraft(overrides: Partial<EventDraft> = {}): EventDraft {
  return draft({
    title: 'Urlop',
    description: '',
    location: '',
    meetingUrl: '',
    date: MON,
    // Modal i tak ich nie zbiera — reduktor je NADPISUJE.
    startMinutes: 540,
    durationMinutes: 60,
    attendeeIds: [PA],
    recurrence: null,
    kind: 'urlop',
    endDate: null,
    ...overrides,
  });
}

describe('ADD_EVENT — urlop', () => {
  it('zapisuje formę kanoniczną: czasy 0/1440, brak `endDate` przy jednym dniu', () => {
    const state = baseState();
    const next = reducer(state, { type: 'ADD_EVENT', draft: vacationDraft() });
    expect(next).not.toBe(state);
    const e = next.events[0];
    expect(e.kind).toBe('urlop');
    expect(e.startMinutes).toBe(0);
    expect(e.durationMinutes).toBe(1440);
    expect(e.attendeeIds).toEqual([PA]);
    expect('endDate' in e).toBe(false);
    expect('recurrence' in e).toBe(false);
  });

  it('zakres wielodniowy zachowuje `endDate`, a `endDate === date` ZDEJMUJE klucz', () => {
    const state = baseState();
    const wide = reducer(state, {
      type: 'ADD_EVENT',
      draft: vacationDraft({ endDate: FRI }),
    });
    expect(wide.events[0].endDate).toBe(FRI);

    const oneDay = reducer(state, {
      type: 'ADD_EVENT',
      draft: vacationDraft({ endDate: MON }),
    });
    expect('endDate' in oneDay.events[0]).toBe(false);
  });

  it('zeruje lokalizację i adres spotkania (urlop ich nie ma)', () => {
    const state = baseState();
    const next = reducer(state, {
      type: 'ADD_EVENT',
      draft: vacationDraft({ location: 'Sala A', meetingUrl: 'https://meet.example.test/x' }),
    });
    expect(next.events[0].location).toBe('');
    expect(next.events[0].meetingUrl).toBe('');
  });

  it.each([
    ['cykliczność', vacationDraft({ recurrence: { daysOfWeek: [1], startMinutes: 0, durationMinutes: 1440 } })],
    ['`endDate` przed datą', vacationDraft({ date: FRI, endDate: MON })],
    ['`endDate` ponad 92 dni', vacationDraft({ date: MON, endDate: '2026-12-31' })],
    ['`endDate` śmieciowe', vacationDraft({ endDate: 'kiedyś' })],
    ['zero uczestników', vacationDraft({ attendeeIds: [] })],
    ['dwóch uczestników', vacationDraft({ attendeeIds: [PA, PB] })],
    ['uczestnik spoza zespołu', vacationDraft({ attendeeIds: ['ghost'] })],
    ['zła data', vacationDraft({ date: 'not-a-date' })],
  ])('odrzuca (%s) tą samą referencją stanu', (_label, bad) => {
    const state = baseState();
    expect(reducer(state, { type: 'ADD_EVENT', draft: bad })).toBe(state);
  });

  it('SPOTKANIE z kluczem `endDate` jest odrzucane (dyskryminator nie wchodzi bokiem)', () => {
    const state = baseState();
    expect(reducer(state, { type: 'ADD_EVENT', draft: draft({ endDate: FRI }) })).toBe(state);
  });

  it('zapisuje się MIMO istniejącego bloku w zakresie (próg ostrzeżenia, nie blokady)', () => {
    const state = { ...stateWithBlock(PA), events: [] };
    const next = reducer(state, {
      type: 'ADD_EVENT',
      draft: vacationDraft({ date: MON, endDate: FRI }),
    });
    expect(next).not.toBe(state);
    expect(next.events).toHaveLength(1);
    // Blok zostaje na miejscu — urlop go nie kasuje (inwariant 1).
    expect(next.workload).toHaveLength(1);
  });

  it('SPOTKANIE z imiennym uczestnikiem w jego dzień urlopu jest ODRZUCANE (kierunek odwrotny twardy)', () => {
    const withVacation = reducer(baseState(), {
      type: 'ADD_EVENT',
      draft: vacationDraft({ date: MON, endDate: FRI }),
    });
    const next = reducer(withVacation, {
      type: 'ADD_EVENT',
      // Środkowy dzień zakresu.
      draft: draft({ date: TUE, attendeeIds: [PA], startMinutes: 600, durationMinutes: 60 }),
    });
    expect(next).toBe(withVacation);
  });
});

describe('SAVE_EVENT — urlop', () => {
  it('zmiana zakresu zachowuje kanoniczne czasy i createdAt', () => {
    const added = reducer(baseState(), { type: 'ADD_EVENT', draft: vacationDraft() });
    const id = added.events[0].id;
    const next = reducer(added, {
      type: 'SAVE_EVENT',
      eventId: id,
      draft: vacationDraft({ endDate: FRI }),
    });
    expect(next.events[0].endDate).toBe(FRI);
    expect(next.events[0].startMinutes).toBe(0);
    expect(next.events[0].durationMinutes).toBe(1440);
    expect(next.events[0].createdAt).toBe(added.events[0].createdAt);
  });

  it('NIE koliduje sam ze sobą (zapis bez zmian przechodzi)', () => {
    const added = reducer(baseState(), { type: 'ADD_EVENT', draft: vacationDraft({ endDate: FRI }) });
    const id = added.events[0].id;
    const next = reducer(added, {
      type: 'SAVE_EVENT',
      eventId: id,
      draft: vacationDraft({ endDate: FRI, description: 'Wyjazd' }),
    });
    expect(next).not.toBe(added);
    expect(next.events[0].description).toBe('Wyjazd');
  });
});

describe('calendarEventsForDate — urlop wielodniowy', () => {
  function stateWithVacation(from: string, to: string | null): AppData {
    return reducer(baseState(), {
      type: 'ADD_EVENT',
      draft: vacationDraft({ date: from, endDate: to }),
    });
  }

  it('zwraca wystąpienie dla KAŻDEGO dnia zakresu włącznie i dla żadnego poza nim', () => {
    const state = stateWithVacation(TUE, '2026-07-09'); // wt..czw
    expect(calendarEventsForDate(state, MON)).toHaveLength(0);
    for (const d of [TUE, WED, '2026-07-09']) {
      expect(calendarEventsForDate(state, d)).toHaveLength(1);
    }
    expect(calendarEventsForDate(state, FRI)).toHaveLength(0);
  });

  it('wystąpienie niesie czasy 0/1440 i nie zwiększa dayTotal (inwariant 1)', () => {
    const state = stateWithVacation(MON, null);
    const [occ] = calendarEventsForDate(state, MON);
    expect(occ.startMinutes).toBe(0);
    expect(occ.durationMinutes).toBe(1440);
    expect(dayTotal(state, MON)).toBe(0);
  });

  it('urlop pokazuje się także w dzień wolny osoby (sobota poza `workDays`)', () => {
    const state = stateWithVacation(FRI, '2026-07-11'); // pt..nd
    expect(calendarEventsForDate(state, '2026-07-11')).toHaveLength(1); // sobota
  });
});
