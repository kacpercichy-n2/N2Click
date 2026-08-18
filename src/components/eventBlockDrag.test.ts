import { describe, expect, it } from 'vitest';
import {
  EVENT_DRAG_GLOBAL_SENTENCE,
  EVENT_DRAG_SERIES_SENTENCE,
  eventBlockAriaLabel,
  eventDragConfirmCopy,
  eventDragDraftDate,
  eventDragKind,
  eventKeyboardReducer,
  eventProjectionChanged,
  projectEventDrag,
  type EventDragBase,
} from './eventBlockDrag';

const BASE: EventDragBase = { startMinutes: 600, durationMinutes: 60, dayIndex: 2 }; // 10:00-11:00

const move = (deltaMinutes: number, over: Partial<Parameters<typeof projectEventDrag>[1]> = {}) =>
  projectEventDrag(BASE, {
    mode: 'move',
    deltaMinutes,
    dayDelta: 0,
    dayCount: 7,
    recurring: false,
    ...over,
  });

describe('projectEventDrag — przeniesienie', () => {
  it('snapuje przesunięcie do 15 minut', () => {
    expect(move(7).startMinutes).toBe(600); // 7 min => 0 kroków
    expect(move(8).startMinutes).toBe(615); // 8 min => jeden krok
    expect(move(22).startMinutes).toBe(615);
    expect(move(23).startMinutes).toBe(630);
    expect(move(-8).startMinutes).toBe(585);
  });

  it('nie zmienia czasu trwania', () => {
    expect(move(90).durationMinutes).toBe(60);
    expect(move(-90).durationMinutes).toBe(60);
  });

  it('clampuje start do 0:00 i do końca doby', () => {
    expect(move(-5000).startMinutes).toBe(0);
    expect(move(5000)).toEqual({ startMinutes: 1380, durationMinutes: 60, dayIndex: 2 }); // 23:00
  });

  it('clampuje dzień do wyrenderowanych kolumn (jednorazowe)', () => {
    expect(move(0, { dayDelta: 2 }).dayIndex).toBe(4);
    expect(move(0, { dayDelta: 9 }).dayIndex).toBe(6);
    expect(move(0, { dayDelta: -9 }).dayIndex).toBe(0);
    // Widok dnia: jedna kolumna, więc dzień nigdy się nie rusza.
    expect(move(0, { dayDelta: 3, dayCount: 1, dayIndex: 0 } as never).dayIndex).toBe(0);
  });

  it('wydarzenie CYKLICZNE nigdy nie zmienia dnia', () => {
    expect(move(0, { dayDelta: 3, recurring: true }).dayIndex).toBe(2);
    expect(move(0, { dayDelta: -3, recurring: true }).dayIndex).toBe(2);
    // ...ale pionowo jedzie normalnie.
    expect(move(30, { dayDelta: 3, recurring: true })).toEqual({
      startMinutes: 630,
      durationMinutes: 60,
      dayIndex: 2,
    });
  });
});

describe('projectEventDrag — uchwyty krawędzi', () => {
  const handle = (mode: 'top' | 'bottom', deltaMinutes: number) =>
    projectEventDrag(BASE, { mode, deltaMinutes, dayDelta: 4, dayCount: 7, recurring: false });

  it('uchwyt górny trzyma KONIEC', () => {
    const up = handle('top', -30);
    expect(up).toEqual({ startMinutes: 570, durationMinutes: 90, dayIndex: 2 });
    expect(up.startMinutes + up.durationMinutes).toBe(660);
    const down = handle('top', 30);
    expect(down.startMinutes + down.durationMinutes).toBe(660);
  });

  it('uchwyt dolny trzyma START', () => {
    expect(handle('bottom', 45)).toEqual({ startMinutes: 600, durationMinutes: 105, dayIndex: 2 });
    expect(handle('bottom', -30)).toEqual({ startMinutes: 600, durationMinutes: 30, dayIndex: 2 });
  });

  it('minimum czasu trwania to 15 minut', () => {
    expect(handle('bottom', -600).durationMinutes).toBe(15);
    expect(handle('top', 600)).toEqual({ startMinutes: 645, durationMinutes: 15, dayIndex: 2 });
  });

  it('koniec nie przekracza 24:00, a start nie schodzi poniżej 0:00', () => {
    expect(handle('bottom', 5000).durationMinutes).toBe(1440 - 600);
    expect(handle('top', -5000)).toEqual({ startMinutes: 0, durationMinutes: 660, dayIndex: 2 });
  });

  it('uchwyty nigdy nie zmieniają dnia, nawet przy przesunięciu poziomym', () => {
    expect(handle('top', 30).dayIndex).toBe(2);
    expect(handle('bottom', 30).dayIndex).toBe(2);
  });
});

describe('eventProjectionChanged', () => {
  it('rozpoznaje powrót na pozycję wyjściową', () => {
    expect(eventProjectionChanged(BASE, move(0))).toBe(false);
    expect(eventProjectionChanged(BASE, move(15))).toBe(true);
    expect(eventProjectionChanged(BASE, move(0, { dayDelta: 1 }))).toBe(true);
  });
});

describe('eventDragDraftDate', () => {
  it('zachowuje kotwicę serii, ale jednorazowe zapisuje w docelowym dniu', () => {
    expect(eventDragDraftDate('2026-08-18', '2026-07-21', true)).toBe('2026-07-21');
    expect(eventDragDraftDate('2026-08-18', '2026-07-21', false)).toBe('2026-08-18');
  });
});

describe('eventKeyboardReducer', () => {
  const ctx = { base: BASE, dayCount: 7, recurring: false };

  it('pierwsze skuteczne zdarzenie wchodzi w tryb', () => {
    expect(eventKeyboardReducer(null, { type: 'move', deltaMinutes: 15 }, ctx)).toEqual({
      startMinutes: 615,
      durationMinutes: 60,
      dayIndex: 2,
    });
  });

  it('zdarzenie bez skutku zwraca TĘ SAMĄ referencję', () => {
    const staged = eventKeyboardReducer(null, { type: 'move', deltaMinutes: 15 }, ctx);
    expect(staged).not.toBeNull();
    // Na krawędzi doby ruch w górę już nic nie zmienia.
    const top = { startMinutes: 0, durationMinutes: 60, dayIndex: 2 };
    expect(eventKeyboardReducer(top, { type: 'move', deltaMinutes: -15 }, ctx)).toBe(top);
    // Bez wystawionej edycji brak skutku zostaje `null`.
    expect(
      eventKeyboardReducer(null, { type: 'day', delta: 0 }, ctx),
    ).toBeNull();
  });

  it('Shift + strzałka rozciąga od dołu (start stoi)', () => {
    const next = eventKeyboardReducer(null, { type: 'resize', deltaMinutes: 15 }, ctx);
    expect(next).toEqual({ startMinutes: 600, durationMinutes: 75, dayIndex: 2 });
    const min = eventKeyboardReducer(
      { startMinutes: 600, durationMinutes: 15, dayIndex: 2 },
      { type: 'resize', deltaMinutes: -15 },
      ctx,
    );
    expect(min).toEqual({ startMinutes: 600, durationMinutes: 15, dayIndex: 2 });
  });

  it('strzałki poziome zmieniają dzień tylko dla wydarzenia jednorazowego', () => {
    expect(eventKeyboardReducer(null, { type: 'day', delta: 1 }, ctx)).toEqual({
      startMinutes: 600,
      durationMinutes: 60,
      dayIndex: 3,
    });
    const staged = { startMinutes: 600, durationMinutes: 60, dayIndex: 2 };
    expect(
      eventKeyboardReducer(staged, { type: 'day', delta: 1 }, { ...ctx, recurring: true }),
    ).toBe(staged);
    expect(eventKeyboardReducer(null, { type: 'day', delta: 1 }, { ...ctx, recurring: true })).toBeNull();
  });
});

describe('eventDragKind', () => {
  const from = { date: '2026-08-18', startMinutes: 600, durationMinutes: 60 };
  it('rozróżnia przeniesienie od zmiany czasu trwania', () => {
    expect(eventDragKind(from, { ...from, startMinutes: 630 })).toBe('move');
    expect(eventDragKind(from, { ...from, durationMinutes: 90 })).toBe('resize');
    // Uchwyt górny rusza start ORAZ długość — to nadal zmiana czasu trwania.
    expect(eventDragKind(from, { date: from.date, startMinutes: 570, durationMinutes: 90 })).toBe(
      'resize',
    );
  });
});

describe('eventDragConfirmCopy', () => {
  const from = { date: '2026-08-18', startMinutes: 600, durationMinutes: 60 };

  it('zawsze mówi o skutku GLOBALNYM', () => {
    const copy = eventDragConfirmCopy({
      title: 'Standup',
      from,
      to: { ...from, startMinutes: 630 },
      recurring: false,
    });
    expect(copy.title).toBe('Przenieść wydarzenie?');
    expect(copy.consequences).toContain(EVENT_DRAG_GLOBAL_SENTENCE);
    expect(copy.consequences).not.toContain(EVENT_DRAG_SERIES_SENTENCE);
    expect(copy.confirmLabel).toBe('Zmień dla wszystkich');
    expect(copy.cancelLabel).toBe('Anuluj');
  });

  it('dokłada zdanie o serii dla wydarzenia cyklicznego', () => {
    const copy = eventDragConfirmCopy({
      title: 'Standup',
      from,
      to: { ...from, durationMinutes: 90 },
      recurring: true,
    });
    expect(copy.title).toBe('Zmienić czas trwania wydarzenia?');
    expect(copy.consequences).toContain(EVENT_DRAG_GLOBAL_SENTENCE);
    expect(copy.consequences).toContain(EVENT_DRAG_SERIES_SENTENCE);
  });

  it('opis pokazuje stary i nowy termin, a zakresy godzin idą ŁĄCZNIKIEM', () => {
    const copy = eventDragConfirmCopy({
      title: 'Standup',
      from,
      to: { date: '2026-08-19', startMinutes: 630, durationMinutes: 60 },
      recurring: false,
    });
    expect(copy.description).toContain('„Standup”');
    expect(copy.description).toContain('10:00-11:00');
    expect(copy.description).toContain('11:30');
    expect(copy.description).toMatch(/ z .* na .*\.$/);
    expect(copy.description).not.toMatch(/[—–]/);
    expect(copy.consequences).not.toMatch(/[—–]/);
  });

  it('składa JEDNO zdanie o kolizjach do tego samego okna', () => {
    const copy = eventDragConfirmCopy({
      title: 'Standup',
      from,
      to: { ...from, startMinutes: 630 },
      recurring: false,
      conflictSentence: 'Termin koliduje: Ola ma już zadanie „QA” 10:30-12:00.',
    });
    expect(copy.consequences).toContain(EVENT_DRAG_GLOBAL_SENTENCE);
    expect(copy.consequences).toContain('Termin koliduje');
    // Pusty/biały łańcuch nie dokłada wiszącej spacji.
    const clean = eventDragConfirmCopy({
      title: 'Standup',
      from,
      to: { ...from, startMinutes: 630 },
      recurring: false,
      conflictSentence: '   ',
    });
    expect(clean.consequences).toBe(EVENT_DRAG_GLOBAL_SENTENCE);
  });
});

describe('eventBlockAriaLabel', () => {
  it('opisuje termin i dodaje podpowiedź tylko dla edytowalnego kafelka', () => {
    const at = { date: '2026-08-18', startMinutes: 600, durationMinutes: 60 };
    expect(eventBlockAriaLabel('Standup', at, false)).toBe(
      'Wydarzenie: Standup, 18 sie (wto) 10:00-11:00.',
    );
    expect(eventBlockAriaLabel('Standup', at, true)).toContain('Przeciągnij');
  });
});
