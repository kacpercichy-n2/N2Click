// Czysta logika adresu trasy /content-plan: stan pagera miesięcy żyje w URL
// (`?m=YYYY-MM`), a nie w stanie komponentu — dzięki temu miesiąc przeżywa
// odświeżenie, wraca z przycisku Wstecz i daje się wysłać linkiem.
//
// Zero Reacta i zero dat liczonych na miejscu: klucz miesiąca, jego etykieta i
// przesunięcie biorą się z `contentplan/domain.ts`, które stoi na
// `utils/dates.ts` (jedyne źródło arytmetyki dat w repo).
import { isMonthKey, monthKeyLabel, monthKeyOf, shiftMonthKey } from '../contentplan/domain';

/** Nazwa parametru URL trzymającego miesiąc modułu. */
export const MONTH_PARAM = 'm';

/** Adres modułu dla danego miesiąca (linki i przyciski pagera). */
export function contentPlanMonthHref(monthKeyValue: string): string {
  return `/content-plan?${MONTH_PARAM}=${monthKeyValue}`;
}

/**
 * Miesiąc z parametru URL. Brak, śmieci albo niepoprawny klucz (np. `2026-13`)
 * => miesiąc dnia `today` — trasa nigdy nie ląduje na pustym widoku przez zły
 * link.
 */
export function resolveMonthParam(raw: string | null | undefined, today: string): string {
  if (isMonthKey(raw)) return raw;
  return monthKeyOf(today);
}

/** Kompletny stan pagera: bieżący klucz, polska etykieta i sąsiednie miesiące. */
export interface ContentPlanMonthPager {
  key: string;
  label: string;
  prev: string;
  next: string;
}

/**
 * Pager miesięcy dla surowego parametru URL. Jedna funkcja zamiast trzech
 * wywołań w komponencie — cały krok „parametr → co pokazać i dokąd prowadzą
 * strzałki" jest testowalny w node.
 */
export function monthPagerFromParam(
  raw: string | null | undefined,
  today: string,
): ContentPlanMonthPager {
  const key = resolveMonthParam(raw, today);
  return {
    key,
    label: monthKeyLabel(key),
    prev: shiftMonthKey(key, -1),
    next: shiftMonthKey(key, 1),
  };
}
