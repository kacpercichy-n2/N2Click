// Testy czystego automatu klawiaturowej edycji bloku kalendarza
// (PKG-20260728-calendar-blocks-keyboard): przesuwanie, rozciąganie, zmiana dnia,
// granice doby i tygodnia, limit budżetu, odrzucenie kolizji, pełne cofnięcie
// oraz brzmienie polskich komunikatów. Czyste — bez Reacta i DOM-u, w stylu
// `kanbanMove.test.ts`.
import { describe, expect, it } from 'vitest';
import {
  blockCapAnnouncement,
  blockCollisionAnnouncement,
  blockCommitAnnouncement,
  blockEditAnnouncement,
  blockKeyboardCommit,
  blockKeyboardReducer,
  blockRejectedAnnouncement,
  blockRevertAnnouncement,
  blockTargetAnnouncement,
  blockToBinAnnouncement,
  blockUnchangedAnnouncement,
  findBlockConflict,
  initialBlockKeyboardState,
  type BlockKeyboardContext,
  type BlockKeyboardNeighbor,
  type BlockKeyboardState,
} from './calendarBlockKeyboard';
import { hasCollision } from '../utils/time';

const SPOTKANIE: BlockKeyboardNeighbor = {
  id: 'w-other',
  startMinutes: 720, // 12:00
  plannedHours: 1,
  title: 'Przegląd kampanii',
};

/** Blok 9:00–11:00 w środę (indeks 2); w czwartek (3) stoi sąsiad 12:00–13:00. */
function ctx(overrides: Partial<BlockKeyboardContext> = {}): BlockKeyboardContext {
  return {
    entryId: 'w-1',
    baseStart: 540,
    baseHours: 2,
    baseDayIndex: 2,
    dayCount: 7,
    maxHours: 4,
    blocksOnDay: (dayIndex) => (dayIndex === 3 ? [SPOTKANIE] : []),
    ...overrides,
  };
}

const step = (
  state: BlockKeyboardState | null,
  event: Parameters<typeof blockKeyboardReducer>[1],
  c = ctx(),
): BlockKeyboardState | null => blockKeyboardReducer(state, event, c);

describe('blockKeyboardReducer — przesuwanie', () => {
  it('pierwsza strzałka WCHODZI w tryb i przesuwa start o krok siatki', () => {
    const next = step(null, { type: 'move', deltaMinutes: 15 });
    expect(next).toEqual({
      projStart: 555,
      projHours: 2,
      projDayIndex: 2,
      colliding: false,
      atCap: false,
    });
  });

  it('kolejne kroki kumulują się na wystawionej projekcji', () => {
    const c = ctx();
    let s = step(null, { type: 'move', deltaMinutes: -15 }, c);
    s = step(s, { type: 'move', deltaMinutes: -15 }, c);
    expect(s?.projStart).toBe(510); // 8:30
    expect(s?.projHours).toBe(2); // przesuwanie NIGDY nie zmienia długości
  });

  it('clampuje blok do doby zamiast wypchnąć go poza 24:00', () => {
    const c = ctx({ baseStart: 1380, baseHours: 1 }); // 23:00–24:00
    expect(step(null, { type: 'move', deltaMinutes: 15 }, c)).toBe(null); // już przy krawędzi
    const up = step(null, { type: 'move', deltaMinutes: -15 }, c);
    expect(up?.projStart).toBe(1365);
  });

  it('nie schodzi poniżej północy', () => {
    const c = ctx({ baseStart: 0, baseHours: 1 });
    expect(step(null, { type: 'move', deltaMinutes: -15 }, c)).toBe(null);
  });
});

describe('blockKeyboardReducer — rozciąganie', () => {
  it('zmienia długość od dołu, start stoi w miejscu', () => {
    const s = step(null, { type: 'resize', deltaMinutes: 15 });
    expect(s).toMatchObject({ projStart: 540, projHours: 2.25, atCap: false });
  });

  it('nie schodzi poniżej jednego kroku (15 minut)', () => {
    const c = ctx({ baseHours: 0.25 });
    expect(step(null, { type: 'resize', deltaMinutes: -15 }, c)).toBe(null);
  });

  it('przycina wzrost do limitu godzin zadania i zapala `atCap`', () => {
    const c = ctx({ maxHours: 2.25 });
    let s = step(null, { type: 'resize', deltaMinutes: 15 }, c);
    expect(s).toMatchObject({ projHours: 2.25, atCap: false });
    s = step(s, { type: 'resize', deltaMinutes: 15 }, c);
    expect(s).toMatchObject({ projHours: 2.25, atCap: true });
  });

  it('sam limit budżetu też WCHODZI w tryb (ostrzeżenie musi być widoczne)', () => {
    const c = ctx({ maxHours: 2 }); // zero zapasu: wzrost od razu odbija się od sufitu
    expect(step(null, { type: 'resize', deltaMinutes: 15 }, c)).toMatchObject({
      projHours: 2,
      atCap: true,
    });
  });

  it('nie przekracza granicy doby', () => {
    const c = ctx({ baseStart: 1380, baseHours: 1, maxHours: 8 }); // 23:00–24:00
    expect(step(null, { type: 'resize', deltaMinutes: 15 }, c)).toBe(null);
  });
});

describe('blockKeyboardReducer — zmiana dnia', () => {
  it('przesuwa kolumnę o jeden dzień', () => {
    expect(step(null, { type: 'day', delta: 1 })?.projDayIndex).toBe(3);
  });

  it('NIE zawija na krawędziach tygodnia', () => {
    const start = ctx({ baseDayIndex: 0 });
    expect(step(null, { type: 'day', delta: -1 }, start)).toBe(null);
    const end = ctx({ baseDayIndex: 6 });
    expect(step(null, { type: 'day', delta: 1 }, end)).toBe(null);
  });

  it('zdarzenie bez skutku zwraca TĘ SAMĄ referencję stanu', () => {
    const c = ctx({ baseDayIndex: 6 });
    const s = step(null, { type: 'move', deltaMinutes: 15 }, c);
    expect(step(s, { type: 'day', delta: 1 }, c)).toBe(s);
  });
});

describe('blockKeyboardReducer — kolizja i cofnięcie', () => {
  it('zapala `colliding`, gdy projekcja wchodzi na inną pracę tej osoby', () => {
    const c = ctx({ baseStart: 690, baseHours: 1 }); // 11:30–12:30 w środę (wolno)
    const s = step(null, { type: 'day', delta: 1 }, c); // czwartek: sąsiad 12:00–13:00
    expect(s?.colliding).toBe(true);
  });

  it('stykające się krawędzie NIE kolidują (ten sam predykat co `hasCollision`)', () => {
    const c = ctx({ baseStart: 645, baseHours: 1.25 }); // 10:45–12:00
    const s = step(null, { type: 'day', delta: 1 }, c);
    expect(s?.colliding).toBe(false);
    expect(hasCollision([SPOTKANIE], 645, 75, 'w-1')).toBe(false);
  });

  it('`findBlockConflict` zgadza się z `hasCollision` i wskazuje winowajcę', () => {
    expect(findBlockConflict([SPOTKANIE], 700, 60, 'w-1')).toBe(SPOTKANIE);
    expect(hasCollision([SPOTKANIE], 700, 60, 'w-1')).toBe(true);
    expect(findBlockConflict([SPOTKANIE], 700, 60, 'w-other')).toBe(null);
  });

  it('`cancel` kasuje CAŁĄ wystawioną edycję (bez śladu po krokach)', () => {
    const c = ctx();
    let s = step(null, { type: 'move', deltaMinutes: 15 }, c);
    s = step(s, { type: 'resize', deltaMinutes: 15 }, c);
    s = step(s, { type: 'day', delta: 1 }, c);
    expect(s).not.toBe(null);
    expect(step(s, { type: 'cancel' }, c)).toBe(null);
    // Cofnięcie bez trybu jest bez skutku (ta sama referencja: `null`).
    expect(step(null, { type: 'cancel' }, c)).toBe(null);
  });
});

describe('blockKeyboardCommit — intencja zapisu', () => {
  it('zwraca ładunek `SET_BLOCK_TIME` dla poprawnej projekcji', () => {
    const c = ctx();
    let s = step(null, { type: 'move', deltaMinutes: 30 }, c);
    s = step(s, { type: 'day', delta: -1 }, c);
    expect(blockKeyboardCommit(s, c)).toEqual({
      entryId: 'w-1',
      dayIndex: 1,
      startMinutes: 570,
      plannedHours: 2,
    });
  });

  it('ODMAWIA zapisu na kolizji (inwariant 3)', () => {
    const c = ctx({ baseStart: 690, baseHours: 1 });
    const s = step(null, { type: 'day', delta: 1 }, c);
    expect(s?.colliding).toBe(true);
    expect(blockKeyboardCommit(s, c)).toBe(null);
  });

  it('nie wysyła no-opa: powrót na zapisaną pozycję to brak intencji', () => {
    const c = ctx();
    let s = step(null, { type: 'move', deltaMinutes: 15 }, c);
    s = step(s, { type: 'move', deltaMinutes: -15 }, c);
    expect(s).not.toBe(null);
    expect(blockKeyboardCommit(s, c)).toBe(null);
    expect(blockKeyboardCommit(null, c)).toBe(null);
  });

  it('projekcja startowa to dokładnie zapisana pozycja bloku', () => {
    const c = ctx();
    expect(initialBlockKeyboardState(c)).toEqual({
      projStart: 540,
      projHours: 2,
      projDayIndex: 2,
      colliding: false,
      atCap: false,
    });
    expect(blockKeyboardCommit(initialBlockKeyboardState(c), c)).toBe(null);
  });
});

describe('komunikaty po polsku', () => {
  const target = { date: '2026-07-30', startMinutes: 540, plannedHours: 2 };

  it('wejście w tryb i kolejny cel', () => {
    expect(blockEditAnnouncement('Montaż filmu', target)).toBe(
      'Edycja bloku: Montaż filmu. Cel: 30 lip (czw), 9:00–11:00 (2h).',
    );
    expect(blockTargetAnnouncement(target)).toBe('Cel: 30 lip (czw), 9:00–11:00 (2h).');
  });

  it('kolizja jest ZDANIEM z nazwą i godzinami winowajcy', () => {
    expect(blockCollisionAnnouncement(target, 'Przegląd kampanii', SPOTKANIE)).toBe(
      'Cel: 30 lip (czw), 9:00–11:00 (2h). Koliduje z „Przegląd kampanii” 12:00–13:00.',
    );
    expect(blockCollisionAnnouncement(target, '', SPOTKANIE)).toBe(
      'Cel: 30 lip (czw), 9:00–11:00 (2h). Koliduje z inną pracą 12:00–13:00.',
    );
  });

  it('zapis, odrzucenie, brak zmian, cofnięcie, zasobnik i limit', () => {
    expect(blockCommitAnnouncement('Montaż filmu', target)).toBe(
      'Zapisano: Montaż filmu — 30 lip (czw), 9:00–11:00 (2h).',
    );
    expect(blockRejectedAnnouncement('Przegląd kampanii', SPOTKANIE)).toBe(
      'Nie zapisano. Koliduje z „Przegląd kampanii” 12:00–13:00.',
    );
    expect(blockUnchangedAnnouncement('Montaż filmu')).toBe(
      'Bez zmian: Montaż filmu zostaje na swoim miejscu.',
    );
    expect(blockRevertAnnouncement('Montaż filmu', target)).toBe(
      'Anulowano edycję. Montaż filmu wraca na 30 lip (czw), 9:00–11:00 (2h).',
    );
    expect(blockToBinAnnouncement('Montaż filmu')).toBe('Przeniesiono do zasobnika: Montaż filmu.');
    expect(blockCapAnnouncement()).toBe('Limit czasu zadania — brak godzin w zasobniku.');
  });
});
