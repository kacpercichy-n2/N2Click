// Testy czystego stackowania bloków widoku dnia (PKG-20260728-mobile-nav-day-view).
import { describe, expect, it } from 'vitest';
import { MAX_STACK_INSET_STEPS, stackDayBlocks, type StackInput } from './dayStack';

/** Skrót: blok od HH:MM o podanej długości w minutach. */
function block(id: string, startMinutes: number, durationMinutes: number): StackInput {
  return { id, startMinutes, durationMinutes };
}

/** Slot po `id` — wynik wraca w kolejności posortowanej, nie wejściowej. */
function byId(slots: ReturnType<typeof stackDayBlocks>, id: string) {
  const found = slots.find((s) => s.id === id);
  if (!found) throw new Error(`brak slotu ${id}`);
  return found;
}

describe('stackDayBlocks', () => {
  it('pusta lista → pusta lista', () => {
    expect(stackDayBlocks([])).toEqual([]);
  });

  it('brak nakładania → każdy blok samodzielny', () => {
    const slots = stackDayBlocks([block('a', 540, 60), block('b', 720, 60)]);
    expect(slots).toEqual([
      { id: 'a', stackIndex: 0, stackSize: 1, insetSteps: 0 },
      { id: 'b', stackIndex: 0, stackSize: 1, insetSteps: 0 },
    ]);
  });

  it('dwa nakładające się → klaster o rozmiarze 2 i indeksy 0/1', () => {
    const slots = stackDayBlocks([block('a', 540, 60), block('b', 570, 60)]);
    expect(byId(slots, 'a')).toEqual({ id: 'a', stackIndex: 0, stackSize: 2, insetSteps: 0 });
    expect(byId(slots, 'b')).toEqual({ id: 'b', stackIndex: 1, stackSize: 2, insetSteps: 1 });
  });

  it('łańcuch A∩B, B∩C, A∌C → JEDEN klaster o rozmiarze 3 (przechodniość)', () => {
    // A 9:00–10:00, B 9:45–10:45, C 10:30–11:30 — A i C się nie stykają.
    const slots = stackDayBlocks([block('a', 540, 60), block('b', 585, 60), block('c', 630, 60)]);
    expect(slots.map((s) => s.stackSize)).toEqual([3, 3, 3]);
    expect(slots.map((s) => s.stackIndex)).toEqual([0, 1, 2]);
  });

  it('dokładny styk 10:00–11:00 i 11:00–12:00 → dwa osobne klastry', () => {
    const slots = stackDayBlocks([block('a', 600, 60), block('b', 660, 60)]);
    expect(slots.map((s) => s.stackSize)).toEqual([1, 1]);
    expect(slots.map((s) => s.stackIndex)).toEqual([0, 0]);
  });

  it('insetSteps przycięte do MAX_STACK_INSET_STEPS przy 5 blokach', () => {
    const slots = stackDayBlocks([
      block('a', 540, 240),
      block('b', 550, 60),
      block('c', 560, 60),
      block('d', 570, 60),
      block('e', 580, 60),
    ]);
    expect(slots.map((s) => s.stackIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(slots.map((s) => s.insetSteps)).toEqual([0, 1, 2, 3, MAX_STACK_INSET_STEPS]);
    expect(slots.every((s) => s.stackSize === 5)).toBe(true);
  });

  it('wynik jest deterministyczny niezależnie od kolejności wejścia', () => {
    const blocks = [block('a', 540, 60), block('b', 570, 60), block('c', 900, 30)];
    const forward = stackDayBlocks(blocks);
    const reversed = stackDayBlocks([...blocks].reverse());
    expect(reversed).toEqual(forward);
  });

  it('ten sam start: dłuższy blok idzie pierwszy, remis rozstrzyga id', () => {
    const slots = stackDayBlocks([
      block('z', 540, 60),
      block('a', 540, 60),
      block('m', 540, 120),
    ]);
    expect(slots.map((s) => s.id)).toEqual(['m', 'a', 'z']);
  });

  it('nie mutuje wejścia', () => {
    const blocks = [block('b', 570, 60), block('a', 540, 60)];
    const snapshot = blocks.map((b) => b.id);
    stackDayBlocks(blocks);
    expect(blocks.map((b) => b.id)).toEqual(snapshot);
  });

  it('blok zawierający się w innym trafia do tego samego klastra', () => {
    const slots = stackDayBlocks([block('long', 540, 480), block('short', 900, 15)]);
    expect(slots.map((s) => s.stackSize)).toEqual([2, 2]);
  });
});
