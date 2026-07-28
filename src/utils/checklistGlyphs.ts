// Wzór glifów listy kontrolnej („◍◍◌ 2/3”) zamiast kolorowej pigułki z ikoną.
// Czysty moduł: wejściem są dwie liczby, wyjściem gotowy wzór, tekst i etykieta
// dla czytnika ekranu. Same glify są ozdobą (`aria-hidden` po stronie widoku) —
// liczby niesie tekst obok.

/** Ile glifów wolno narysować. Dłuższa lista jest SKALOWANA do tylu pozycji —
 * 40 kółek w wierszu listy to nie informacja, tylko szum. */
export const CHECKLIST_GLYPH_LIMIT = 5;

/** Pozycja odhaczona / jeszcze otwarta. */
export const GLYPH_DONE = '◍';
export const GLYPH_TODO = '◌';

export interface ChecklistGlyphs {
  /** Sam wzór, np. „◍◍◌”. */
  pattern: string;
  /** Czytelny licznik, np. „2/3”. */
  text: string;
  /** Pełne zdanie dla czytnika ekranu, np. „Lista kontrolna: 2 z 3”. */
  label: string;
}

/** Liczba całkowita, nieujemna; NaN/Infinity/ujemne degradują do 0. */
function safeCount(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return value > 0 ? Math.floor(value) : 0;
}

/**
 * Wzór dla pary (odhaczone, wszystkie). Pusta lista (`total <= 0`) NIE MA
 * reprezentacji — zwraca `null`, żeby widok nie renderował pustego wiersza.
 *
 * Przy liście dłuższej niż `limit` wzór jest proporcjonalny, ale nigdy nie
 * kłamie na krawędziach: co najmniej jeden glif zapełniony, gdy coś odhaczono,
 * i co najmniej jeden pusty, dopóki lista nie jest skończona.
 */
export function checklistGlyphs(
  done: number | null | undefined,
  total: number | null | undefined,
  limit: number = CHECKLIST_GLYPH_LIMIT,
): ChecklistGlyphs | null {
  const all = safeCount(total);
  if (all === 0) return null;
  const doneCount = Math.min(all, safeCount(done));
  const slots = Math.max(1, Math.min(safeCount(limit) || CHECKLIST_GLYPH_LIMIT, all));

  let filled: number;
  if (all <= slots) {
    filled = doneCount;
  } else {
    filled = Math.round((doneCount / all) * slots);
    if (doneCount > 0) filled = Math.max(1, filled);
    if (doneCount < all) filled = Math.min(slots - 1, filled);
    filled = Math.min(slots, Math.max(0, filled));
  }

  return {
    pattern: GLYPH_DONE.repeat(filled) + GLYPH_TODO.repeat(slots - filled),
    text: `${doneCount}/${all}`,
    label: `Lista kontrolna: ${doneCount} z ${all}`,
  };
}
