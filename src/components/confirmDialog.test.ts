// Testy czystej logiki okna potwierdzenia. Bez DOM-u i bez Reacta — kolejka
// żądań i budowniczy treści są zwykłymi funkcjami, więc działają w `node`.
import { describe, expect, it, vi } from 'vitest';
import {
  activeConfirm,
  buildDeleteConsequence,
  confirmIsBlocked,
  drainConfirms,
  emptyConfirmQueue,
  enqueueConfirm,
  joinPolishList,
  resolveConfirm,
  type ConfirmOptions,
} from './confirmDialog';

const ask = (title: string): ConfirmOptions => ({ title });

describe('buildDeleteConsequence', () => {
  it('brak liczników daje pusty łańcuch (pytanie zostaje jednoklikowe)', () => {
    expect(buildDeleteConsequence({})).toBe('');
    expect(buildDeleteConsequence({ tasks: 0, assignments: 0, plannedHours: 0 })).toBe('');
  });

  it('liczba pojedyncza', () => {
    expect(buildDeleteConsequence({ assignments: 1 })).toBe('To usunie 1 przypisanie.');
    expect(buildDeleteConsequence({ projects: 1 })).toBe('To usunie 1 projekt.');
    expect(buildDeleteConsequence({ tasks: 1 })).toBe('To usunie 1 zadanie.');
    expect(buildDeleteConsequence({ plannedHours: 1 })).toBe('To usunie 1 zaplanowaną godzinę.');
  });

  it('forma 2–4 i forma dopełniaczowa', () => {
    expect(buildDeleteConsequence({ projects: 3 })).toBe('To usunie 3 projekty.');
    expect(buildDeleteConsequence({ projects: 12 })).toBe('To usunie 12 projektów.');
    expect(buildDeleteConsequence({ tasks: 22 })).toBe('To usunie 22 zadania.');
    expect(buildDeleteConsequence({ tasks: 13 })).toBe('To usunie 13 zadań.');
    expect(buildDeleteConsequence({ assignments: 5 })).toBe('To usunie 5 przypisań.');
  });

  it('godziny ułamkowe biorą dopełniacz liczby pojedynczej i polski przecinek', () => {
    expect(buildDeleteConsequence({ plannedHours: 24.5 })).toBe(
      'To usunie 24,5 zaplanowanej godziny.',
    );
    expect(buildDeleteConsequence({ plannedHours: 2.5 })).toBe(
      'To usunie 2,5 zaplanowanej godziny.',
    );
    expect(buildDeleteConsequence({ plannedHours: 0.25 })).toBe(
      'To usunie 0,25 zaplanowanej godziny.',
    );
    expect(buildDeleteConsequence({ plannedHours: 12 })).toBe('To usunie 12 zaplanowanych godzin.');
  });

  it('kilka liczników wylicza się w stałej kolejności, bez przecinka przed „i”', () => {
    expect(buildDeleteConsequence({ assignments: 3, plannedHours: 12 })).toBe(
      'To usunie 3 przypisania i 12 zaplanowanych godzin.',
    );
    expect(buildDeleteConsequence({ projects: 3, tasks: 12, plannedHours: 24.5 })).toBe(
      'To usunie 3 projekty, 12 zadań i 24,5 zaplanowanej godziny.',
    );
  });

  it('wartości niepoprawne i ujemne są pomijane, nie wypisywane', () => {
    expect(buildDeleteConsequence({ tasks: Number.NaN, plannedHours: -3 })).toBe('');
    expect(buildDeleteConsequence({ tasks: 2, plannedHours: Number.POSITIVE_INFINITY })).toBe(
      'To usunie 2 zadania.',
    );
  });

  it('wyliczenie łączy elementy po polsku', () => {
    expect(joinPolishList([])).toBe('');
    expect(joinPolishList(['a'])).toBe('a');
    expect(joinPolishList(['a', 'b'])).toBe('a i b');
    expect(joinPolishList(['a', 'b', 'c'])).toBe('a, b i c');
  });
});

describe('confirmIsBlocked', () => {
  it('bez requireAck nic nie blokuje', () => {
    expect(confirmIsBlocked({ title: 'x' }, false)).toBe(false);
    expect(confirmIsBlocked({ title: 'x', requireAck: false }, false)).toBe(false);
  });

  it('requireAck blokuje do zaznaczenia', () => {
    expect(confirmIsBlocked({ title: 'x', requireAck: true }, false)).toBe(true);
    expect(confirmIsBlocked({ title: 'x', requireAck: true }, true)).toBe(false);
  });
});

describe('kolejka potwierdzeń', () => {
  it('pusta kolejka nie ma aktywnego pytania', () => {
    expect(activeConfirm(emptyConfirmQueue())).toBeNull();
  });

  it('drugie żądanie CZEKA — aktywne zostaje pierwsze', () => {
    const first = vi.fn();
    const second = vi.fn();
    let state = enqueueConfirm(emptyConfirmQueue(), ask('pierwsze'), first);
    state = enqueueConfirm(state, ask('drugie'), second);

    expect(state.entries).toHaveLength(2);
    expect(activeConfirm(state)?.options.title).toBe('pierwsze');
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });

  it('dwa potwierdzenia pod rząd rozstrzygają się niezależnie i po kolei', () => {
    const first = vi.fn();
    const second = vi.fn();
    let state = enqueueConfirm(emptyConfirmQueue(), ask('pierwsze'), first);
    state = enqueueConfirm(state, ask('drugie'), second);

    const firstEntry = activeConfirm(state);
    expect(firstEntry).not.toBeNull();
    const afterFirst = resolveConfirm(state, firstEntry!.id);
    afterFirst.resolved?.resolve(true);
    state = afterFirst.state;

    expect(first).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledWith(true);
    expect(second).not.toHaveBeenCalled();
    // Dopiero teraz drugie pytanie staje się widoczne.
    expect(activeConfirm(state)?.options.title).toBe('drugie');

    const secondEntry = activeConfirm(state)!;
    const afterSecond = resolveConfirm(state, secondEntry.id);
    afterSecond.resolved?.resolve(false);
    state = afterSecond.state;

    expect(second).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith(false);
    expect(first).toHaveBeenCalledTimes(1);
    expect(activeConfirm(state)).toBeNull();
  });

  it('identyfikatory są unikalne, więc żądanie nie może nadpisać poprzedniego', () => {
    let state = enqueueConfirm(emptyConfirmQueue(), ask('a'), vi.fn());
    state = enqueueConfirm(state, ask('b'), vi.fn());
    state = resolveConfirm(state, state.entries[0].id).state;
    state = enqueueConfirm(state, ask('c'), vi.fn());
    expect(state.entries.map((e) => e.id)).toEqual([2, 3]);
    expect(new Set(state.entries.map((e) => e.id)).size).toBe(2);
  });

  it('rozstrzygnięcie nieznanego id zwraca TĘ SAMĄ referencję stanu', () => {
    const state = enqueueConfirm(emptyConfirmQueue(), ask('a'), vi.fn());
    const again = resolveConfirm(state, 999);
    expect(again.state).toBe(state);
    expect(again.resolved).toBeNull();
  });

  it('podwójne rozstrzygnięcie tego samego id oddaje wpis tylko raz', () => {
    const spy = vi.fn();
    const state = enqueueConfirm(emptyConfirmQueue(), ask('a'), spy);
    const id = state.entries[0].id;
    const first = resolveConfirm(state, id);
    first.resolved?.resolve(true);
    const second = resolveConfirm(first.state, id);
    second.resolved?.resolve(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('anulowanie i potwierdzenie trafiają we WŁAŚCIWĄ obietnicę', () => {
    const first = vi.fn();
    const second = vi.fn();
    let state = enqueueConfirm(emptyConfirmQueue(), ask('pierwsze'), first);
    state = enqueueConfirm(state, ask('drugie'), second);
    // Rozstrzygamy DRUGIE (np. dostawca się odmontował) — pierwsze zostaje.
    const out = resolveConfirm(state, state.entries[1].id);
    out.resolved?.resolve(true);
    expect(second).toHaveBeenCalledWith(true);
    expect(first).not.toHaveBeenCalled();
    expect(activeConfirm(out.state)?.options.title).toBe('pierwsze');
  });

  it('opróżnienie kolejki oddaje wszystkie wiszące wpisy (do odrzucenia)', () => {
    const first = vi.fn();
    const second = vi.fn();
    let state = enqueueConfirm(emptyConfirmQueue(), ask('a'), first);
    state = enqueueConfirm(state, ask('b'), second);
    const { state: drainedState, drained } = drainConfirms(state);
    drained.forEach((entry) => entry.resolve(false));
    expect(first).toHaveBeenCalledWith(false);
    expect(second).toHaveBeenCalledWith(false);
    expect(activeConfirm(drainedState)).toBeNull();
    // Pusta kolejka zwraca tę samą referencję.
    expect(drainConfirms(drainedState).state).toBe(drainedState);
  });
});
