// Testy czystego automatu trybu przenoszenia karty Kanban
// (PKG-20260728-kanban-touch-keyboard): podniesienie z kolumny aktywnej i z
// archiwum, clamp na obu krawędziach, zdarzenia bez skutku zwracające TĘ SAMĄ
// referencję (kontrakt jak w `touchHoldReducer`), intencja upuszczenia, pusta
// lista kolumn oraz wyliczanie „pozycja N z M". Czyste — bez Reacta i DOM-u,
// w stylu fixture'ów `kanbanBoard.test.ts`.
import { describe, expect, it } from 'vitest';
import {
  cancelAnnouncement,
  dropAnnouncement,
  kanbanDropIntent,
  kanbanDropPosition,
  kanbanMoveReducer,
  pickupAnnouncement,
  targetAnnouncement,
  type KanbanMoveColumn,
  type KanbanMoveState,
} from './kanbanMove';
import type { Task } from '../types';

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    projectId: 'projA', statusId: 's1', title: 'Zadanie', description: '',
    startDate: '2026-07-06', endDate: '2026-07-08', estimatedHours: null, priority: 'normal',
    workCategoryId: '', departmentId: '', checklist: [], orderIndex: 0,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...overrides,
  };
}

const CARD = makeTask({ id: 't-card', statusId: 's1', orderIndex: 5, title: 'Montaż filmu' });

/** Trzy kolumny-cele; „W toku" celowo ma sąsiadów po obu stronach karty. */
function columns(): KanbanMoveColumn[] {
  return [
    { statusId: 's1', name: 'Do zrobienia', tasks: [CARD] },
    {
      statusId: 's2',
      name: 'W toku',
      tasks: [
        makeTask({ id: 't-a', statusId: 's2', orderIndex: 1 }),
        makeTask({ id: 't-b', statusId: 's2', orderIndex: 9 }),
      ],
    },
    { statusId: 's3', name: 'Gotowe', tasks: [] },
  ];
}

const pickup = (sourceStatusId: string, cols = columns()): KanbanMoveState => {
  const state = kanbanMoveReducer(null, { type: 'pickup', taskId: CARD.id, sourceStatusId }, cols);
  if (state === null) throw new Error('pickup nie włączył trybu');
  return state;
};

describe('kanbanMoveReducer — podniesienie', () => {
  it('startuje w kolumnie źródłowej, gdy status jest aktywny', () => {
    expect(pickup('s2')).toEqual({ taskId: CARD.id, sourceStatusId: 's2', targetIndex: 1 });
  });

  it('startuje od pierwszej kolumny, gdy karta wisi w archiwum', () => {
    // Status archiwalny nie ma swojej kolumny wśród celów — indeks -1 z findIndex
    // nie może przeciec do stanu.
    expect(pickup('s-archiwum')).toEqual({
      taskId: CARD.id,
      sourceStatusId: 's-archiwum',
      targetIndex: 0,
    });
  });

  it('bez kolumn-celów NIE włącza trybu (ta sama referencja stanu)', () => {
    const idle = null;
    expect(kanbanMoveReducer(idle, { type: 'pickup', taskId: CARD.id, sourceStatusId: 's1' }, []))
      .toBe(idle);
  });

  it('podniesienie w trakcie przenoszenia jest bez skutku', () => {
    const state = pickup('s1');
    expect(
      kanbanMoveReducer(state, { type: 'pickup', taskId: 'inne', sourceStatusId: 's3' }, columns()),
    ).toBe(state);
  });
});

describe('kanbanMoveReducer — zmiana kolumny celu', () => {
  it('przesuwa cel w obie strony', () => {
    const cols = columns();
    const state = pickup('s1', cols);
    const right = kanbanMoveReducer(state, { type: 'move', delta: 1 }, cols);
    expect(right?.targetIndex).toBe(1);
    expect(kanbanMoveReducer(right, { type: 'move', delta: -1 }, cols)?.targetIndex).toBe(0);
  });

  it('nie zawija się na LEWEJ krawędzi (ta sama referencja)', () => {
    const cols = columns();
    const state = pickup('s1', cols);
    expect(kanbanMoveReducer(state, { type: 'move', delta: -1 }, cols)).toBe(state);
  });

  it('nie zawija się na PRAWEJ krawędzi (ta sama referencja)', () => {
    const cols = columns();
    const state = pickup('s3', cols);
    expect(state.targetIndex).toBe(2);
    expect(kanbanMoveReducer(state, { type: 'move', delta: 1 }, cols)).toBe(state);
  });

  it('Home/End skaczą na krańce, a powtórzenie jest no-opem', () => {
    const cols = columns();
    const state = pickup('s2', cols);
    const first = kanbanMoveReducer(state, { type: 'first' }, cols);
    expect(first?.targetIndex).toBe(0);
    expect(kanbanMoveReducer(first, { type: 'first' }, cols)).toBe(first);
    const last = kanbanMoveReducer(state, { type: 'last' }, cols);
    expect(last?.targetIndex).toBe(2);
    expect(kanbanMoveReducer(last, { type: 'last' }, cols)).toBe(last);
  });

  it('zachowuje taskId i źródło przy każdej zmianie celu', () => {
    const cols = columns();
    const state = pickup('s-archiwum', cols);
    const moved = kanbanMoveReducer(state, { type: 'last' }, cols);
    expect(moved).toEqual({ taskId: CARD.id, sourceStatusId: 's-archiwum', targetIndex: 2 });
  });
});

describe('kanbanMoveReducer — stan spoczynku i zakończenie', () => {
  it('każde zdarzenie w spoczynku zwraca ten sam (pusty) stan', () => {
    const idle = null;
    const cols = columns();
    expect(kanbanMoveReducer(idle, { type: 'move', delta: 1 }, cols)).toBe(idle);
    expect(kanbanMoveReducer(idle, { type: 'move', delta: -1 }, cols)).toBe(idle);
    expect(kanbanMoveReducer(idle, { type: 'first' }, cols)).toBe(idle);
    expect(kanbanMoveReducer(idle, { type: 'last' }, cols)).toBe(idle);
    expect(kanbanMoveReducer(idle, { type: 'drop' }, cols)).toBe(idle);
    expect(kanbanMoveReducer(idle, { type: 'cancel' }, cols)).toBe(idle);
  });

  it('drop i cancel gaszą tryb', () => {
    const cols = columns();
    const state = pickup('s1', cols);
    expect(kanbanMoveReducer(state, { type: 'drop' }, cols)).toBeNull();
    expect(kanbanMoveReducer(state, { type: 'cancel' }, cols)).toBeNull();
  });

  it('pusta lista kolumn nie wywraca zdarzeń ruchu', () => {
    const state: KanbanMoveState = { taskId: CARD.id, sourceStatusId: 's1', targetIndex: 0 };
    expect(kanbanMoveReducer(state, { type: 'move', delta: 1 }, [])).toBe(state);
    expect(kanbanMoveReducer(state, { type: 'first' }, [])).toBe(state);
    expect(kanbanMoveReducer(state, { type: 'last' }, [])).toBe(state);
  });
});

describe('kanbanDropIntent', () => {
  it('zwraca ładunek SET_TASK_STATUS dla kolumny innej niż źródłowa', () => {
    const cols = columns();
    const state = kanbanMoveReducer(pickup('s1', cols), { type: 'move', delta: 1 }, cols);
    expect(kanbanDropIntent(state, cols)).toEqual({ taskId: CARD.id, statusId: 's2' });
  });

  it('upuszczenie na kolumnie źródłowej to null (żadnego no-opa w store)', () => {
    const cols = columns();
    expect(kanbanDropIntent(pickup('s2', cols), cols)).toBeNull();
  });

  it('wyciągnięcie z archiwum zawsze coś wysyła', () => {
    const cols = columns();
    expect(kanbanDropIntent(pickup('s-archiwum', cols), cols)).toEqual({
      taskId: CARD.id,
      statusId: 's1',
    });
  });

  it('brak trybu albo cel poza listą → null', () => {
    const cols = columns();
    expect(kanbanDropIntent(null, cols)).toBeNull();
    // Filtry przycięły tablicę w trakcie przenoszenia — indeks wypadł z zakresu.
    expect(kanbanDropIntent({ taskId: CARD.id, sourceStatusId: 's1', targetIndex: 7 }, cols))
      .toBeNull();
  });
});

describe('kanbanDropPosition', () => {
  it('liczy miejsce między sąsiadami wg (orderIndex, startDate, id)', () => {
    // CARD.orderIndex = 5, więc ląduje między t-a (1) a t-b (9).
    expect(kanbanDropPosition(columns()[1], CARD)).toEqual({ index: 1, total: 3 });
  });

  it('pusta kolumna to zawsze „pozycja 1 z 1"', () => {
    expect(kanbanDropPosition(columns()[2], CARD)).toEqual({ index: 0, total: 1 });
  });

  it('karta obecna w kolumnie NIE liczy się dwa razy', () => {
    expect(kanbanDropPosition(columns()[0], CARD)).toEqual({ index: 0, total: 1 });
  });

  it('karta wchodzi PRZED sąsiadów o wyższym kluczu sortowania', () => {
    const column: KanbanMoveColumn = {
      statusId: 's2',
      name: 'W toku',
      tasks: [makeTask({ id: 't-x', orderIndex: 9 }), makeTask({ id: 't-y', orderIndex: 12 })],
    };
    expect(kanbanDropPosition(column, CARD)).toEqual({ index: 0, total: 3 });
  });
});

describe('komunikaty', () => {
  it('brzmią po polsku i podają „pozycja N z M"', () => {
    const position = { index: 1, total: 4 };
    expect(pickupAnnouncement('Montaż filmu', 'W toku', position)).toBe(
      'Podniesiono: Montaż filmu. Kolumna W toku, pozycja 2 z 4.',
    );
    expect(targetAnnouncement('Gotowe', { index: 0, total: 3 })).toBe(
      'Cel: kolumna Gotowe, pozycja 1 z 3.',
    );
    expect(dropAnnouncement('Montaż filmu', 'Gotowe')).toBe(
      'Przeniesiono: Montaż filmu do kolumny Gotowe.',
    );
    expect(cancelAnnouncement('Montaż filmu', 'W toku')).toBe(
      'Anulowano przenoszenie. Montaż filmu zostaje w kolumnie W toku.',
    );
  });
});
