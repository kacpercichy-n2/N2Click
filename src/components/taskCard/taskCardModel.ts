// Karta zadania v2 („Praca i rozmowa obok siebie", 2026-11-02): czyste
// wyliczenia warstwy odczytu. Komponent liczy z nich etykiety kafelków, wiersze
// tabeli „Godziny osób" i to, który edytor otworzyć przy skoku do powodu
// blokującego zapis. Żadna funkcja nie zapisuje: liczby przychodzą z tych samych
// map, które TaskEditor i tak przekazuje do SAVE_TASK (inwariant 1: sumy są
// derywowane, nie przechowywane).
import { snapHours } from '../../utils/time';
import { formatShort } from '../../utils/dates';

/** Kafelki siatki 3 x 2 w kolejności czytania. */
export type TaskTileId = 'status' | 'priority' | 'period' | 'people' | 'hours' | 'classification';

export const TASK_TILE_ORDER: readonly TaskTileId[] = [
  'status',
  'priority',
  'period',
  'people',
  'hours',
  'classification',
];

/** Gdzie mieszka pole wskazane przez `SaveBlocker.focusId`. */
export type BlockerTarget =
  | { kind: 'title' }
  | { kind: 'crumbs' }
  | { kind: 'tile'; tile: TaskTileId }
  | { kind: 'none' };

/**
 * Kotwice pól (`t-title`, `t-project`, ...) żyją teraz w edytorach otwieranych
 * na żądanie (tytuł w trybie odczytu jest tekstem, okres siedzi w kafelku).
 * Skok do przyczyny musi więc NAJPIERW otworzyć właściwy edytor, a dopiero po
 * commicie Reacta ustawić fokus. Nieznana kotwica nie otwiera niczego.
 */
export function blockerTarget(focusId: string | null): BlockerTarget {
  switch (focusId) {
    case 't-title':
      return { kind: 'title' };
    case 't-client':
    case 't-project':
      return { kind: 'crumbs' };
    case 't-status':
      return { kind: 'tile', tile: 'status' };
    case 't-priority':
      return { kind: 'tile', tile: 'priority' };
    case 't-start':
    case 't-end':
      return { kind: 'tile', tile: 'period' };
    case 't-assignees':
      return { kind: 'tile', tile: 'people' };
    case 't-category':
    case 't-department':
      return { kind: 'tile', tile: 'classification' };
    default:
      return { kind: 'none' };
  }
}

/** Liczba godzin bez jednostki, polski przecinek: 9, 9,5, 0,25. */
export function compactHours(hours: number): string {
  const snapped = snapHours(Math.max(0, hours));
  return Number.isInteger(snapped)
    ? String(snapped)
    : String(Number(snapped.toFixed(2))).replace('.', ',');
}

export interface HoursTileSummary {
  /** Tekst wartości, np. „9/11h" albo „4h" bez sprzedanych. */
  label: string;
  /** Pełne zdanie dla czytnika ekranu. */
  spoken: string;
  /** Udział godzin w kalendarzu w pasku (0..1). */
  calendarRatio: number;
  /** Udział zasobnika w pasku (0..1), zawsze za kalendarzem. */
  binRatio: number;
  /** Kalendarz ponad sprzedane (ten sam warunek, co ostrzeżenie edytora). */
  over: boolean;
}

/**
 * Kafelek „Godziny": kalendarz wobec sprzedanych, z zasobnikiem jako drugim
 * odcinkiem paska. Warunek `over` jest kopią `overBudget` z TaskEditor
 * (`sold > 0 && calendar > sold`), żeby kafelek i ostrzeżenie nie mogły się
 * rozjechać.
 */
export function hoursTileSummary(args: {
  calendar: number;
  bin: number;
  sold: number;
}): HoursTileSummary {
  const calendar = Math.max(0, args.calendar);
  const bin = Math.max(0, args.bin);
  const sold = Math.max(0, args.sold);
  const over = sold > 0 && calendar > sold + 1e-9;
  const scale = Math.max(sold, calendar + bin);
  const calendarRatio = scale > 0 ? Math.min(1, calendar / scale) : 0;
  const binRatio = scale > 0 ? Math.min(1 - calendarRatio, bin / scale) : 0;
  if (sold <= 0) {
    return {
      label: `${compactHours(calendar)}h`,
      spoken: `W kalendarzu ${compactHours(calendar)} h, bez godzin sprzedanych`,
      calendarRatio,
      binRatio,
      over,
    };
  }
  return {
    label: `${compactHours(calendar)}/${compactHours(sold)}h`,
    spoken: `W kalendarzu ${compactHours(calendar)} z ${compactHours(sold)} h, w zasobniku ${compactHours(bin)} h`,
    calendarRatio,
    binRatio,
    over,
  };
}

export interface TaskHoursRow {
  id: string;
  name: string;
  /** Godziny w kalendarzu (dni okresu, tylko przypisani). */
  calendar: number;
  /** Zasobnik = sprzedane minus kalendarz, nigdy poniżej zera. */
  bin: number;
  /** Razem = kalendarz + zasobnik (czyli sprzedane, albo więcej przy nadmiarze). */
  total: number;
  /** Kalendarz ponad godziny osoby (ostrzeżenie wiersza). */
  over: boolean;
}

/**
 * Wiersze tabeli „Godziny osób". Zasobnik liczy się DOKŁADNIE jak `binTargets`
 * w TaskEditor (`max(0, snap(sold - dated))`), więc tabela pokazuje to, co
 * SAVE_TASK zapisze jako `binTotals`.
 */
export function taskHoursRows(
  people: readonly { id: string; name: string }[],
  soldByPerson: ReadonlyMap<string, number>,
  datedByPerson: ReadonlyMap<string, number>,
): TaskHoursRow[] {
  return people.map((person) => {
    const sold = soldByPerson.get(person.id) ?? 0;
    const calendar = datedByPerson.get(person.id) ?? 0;
    const bin = Math.max(0, snapHours(sold - calendar));
    return {
      id: person.id,
      name: person.name,
      calendar,
      bin,
      total: snapHours(calendar + bin),
      over: calendar > sold + 1e-9,
    };
  });
}

/** Kafelek „Okres": „2 lis → 16 lis · 15 dni"; zły okres mówi to wprost. */
export function periodTileLabel(args: {
  startDate: string;
  endDate: string;
  valid: boolean;
  days: number;
}): string {
  if (!args.valid) return 'Popraw okres';
  const start = formatShort(args.startDate);
  if (args.startDate === args.endDate) return `${start} · 1 dzień`;
  return `${start} → ${formatShort(args.endDate)} · ${args.days} dni`;
}

/** Kafelek „Osoby": imiona dwóch pierwszych osób i licznik reszty. */
export function peopleTileLabel(names: readonly string[]): string {
  if (names.length === 0) return 'Nikt nie jest przypisany';
  const first = names.map((name) => name.split(' ')[0] || name);
  if (first.length <= 2) return first.join(', ');
  return `${first.slice(0, 2).join(', ')} +${first.length - 2}`;
}
