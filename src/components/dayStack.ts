// Czyste grupowanie nakładających się bloków JEDNEGO dnia w kaskadę kart
// (widok dnia na telefonie). Zero Reacta i zero typów store'a — wejściem jest
// goły `{ id, startMinutes, durationMinutes }`, więc moduł testuje się w node.
//
// Po co osobny model zamiast dzisiejszego `packDayBlocks`: pakowanie w kolumny
// dzieli szerokość dnia przez liczbę równoległych bloków, co na 390 px daje
// paski nie do trafienia palcem. Tutaj każdy blok zostaje PEŁNEJ szerokości i
// tylko wcina się od lewej, więc kolejne karty widać jedna spod drugiej.

/** Maksymalne wcięcie karty w stosie (dalsze karty nie wcinają się głębiej). */
export const MAX_STACK_INSET_STEPS = 3;

export interface StackInput {
  id: string;
  startMinutes: number;
  durationMinutes: number;
}

export interface StackSlot {
  id: string;
  /** Pozycja w klastrze (0 = pierwsza). */
  stackIndex: number;
  /** Ile bloków liczy klaster (1 = brak nakładania). */
  stackSize: number;
  /** `min(stackIndex, MAX_STACK_INSET_STEPS)`. */
  insetSteps: number;
}

/**
 * Grupuje bloki jednego dnia w klastry PRZECHODNIEGO nakładania czasowego
 * (`aStart < bEnd && bStart < aEnd`; sam styk krawędzi NIE nakłada się) i nadaje
 * im pozycję w stosie. Sortowanie deterministyczne: `(startMinutes, dłuższy
 * pierwszy, id)`, więc wynik nie zależy od kolejności wejścia. Wynik wraca w
 * kolejności POSORTOWANEJ — konsument mapuje po `id`. Pusta lista → pusta lista.
 */
export function stackDayBlocks(blocks: StackInput[]): StackSlot[] {
  const sorted = [...blocks].sort(
    (a, b) =>
      a.startMinutes - b.startMinutes ||
      b.durationMinutes - a.durationMinutes ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const slots: StackSlot[] = [];
  // Klaster domykamy dopiero, gdy kolejny blok zaczyna się NIE WCZEŚNIEJ niż
  // najdalszy koniec dotychczasowych — to daje przechodniość (A∩B, B∩C, A∌C
  // zostają jednym klastrem) przy jednym przejściu po posortowanej liście.
  let clusterStart = 0;
  let clusterEnd = Number.NEGATIVE_INFINITY;
  const closeCluster = (endIndex: number) => {
    const size = endIndex - clusterStart;
    for (let i = clusterStart; i < endIndex; i += 1) {
      slots[i] = { ...slots[i], stackSize: size };
    }
  };
  sorted.forEach((block, index) => {
    if (index > clusterStart && block.startMinutes >= clusterEnd) {
      closeCluster(index);
      clusterStart = index;
      clusterEnd = Number.NEGATIVE_INFINITY;
    }
    const stackIndex = index - clusterStart;
    slots.push({
      id: block.id,
      stackIndex,
      stackSize: 1, // domknięcie klastra nadpisze właściwy rozmiar
      insetSteps: Math.min(stackIndex, MAX_STACK_INSET_STEPS),
    });
    clusterEnd = Math.max(clusterEnd, block.startMinutes + block.durationMinutes);
  });
  closeCluster(sorted.length);
  return slots;
}
