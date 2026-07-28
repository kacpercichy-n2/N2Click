// Pure, React-free geometry for the WeekView "working window" (godziny agencji).
// PREZENTACJA ONLY (inwariant 1 + 7): nic tutaj nie dotyka snapowania, kolizji,
// dragu ani danych — liczy wyłącznie piksele startowego przewinięcia siatki i
// zakres przygaszonego tła poza oknem roboczym.
//
// Okno robocze jest sterowane DWIEMA nazwanymi stałymi poniżej; zmiana ich
// wartości przesuwa zarówno domyślne przewinięcie, jak i przygaszenie tła oraz
// etykiety osi godzin. Sloty poza oknem pozostają w pełni funkcjonalne.

/** Pierwsza godzina okna roboczego (siatka otwiera się na jej wysokości). */
export const WORK_START_HOUR = 9;
/** Pierwsza godzina PO oknie roboczym (17:00 = koniec dnia agencji). */
export const WORK_END_HOUR = 17;

const DAY_HOURS = 24;

/**
 * Zapas nad linią 9:00 przy otwarciu widoku. Etykiety osi są wyśrodkowane
 * względem swojej linii (`translateY(-50%)`), więc bez tego zapasu górna
 * połowa napisu „9:00” jest przycięta krawędzią widoku.
 */
export const AXIS_LABEL_LEAD_PX = 8;

/** Zaokrągla do pełnego piksela i odrzuca wartości niepoprawne/ujemne. */
function safePx(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value);
}

/**
 * Domyślne `scrollTop` widoku tygodnia: górna krawędź WORK_START_HOUR minus
 * zapas na etykietę osi. Zwraca 0 dla niepoprawnej geometrii (brak wysokości
 * godziny) — widok po prostu zostaje na 0:00 zamiast dostać NaN.
 */
export function workWindowScrollTop(hourPx: number): number {
  const top = safePx(WORK_START_HOUR * hourPx);
  if (top === 0) return 0;
  return Math.max(0, top - AXIS_LABEL_LEAD_PX);
}

/** Odległość od 0:00 do początku okna roboczego, w pikselach. */
export function workWindowTopPx(hourPx: number): number {
  return safePx(WORK_START_HOUR * hourPx);
}

/** Odległość od 0:00 do końca okna roboczego, w pikselach. */
export function workWindowBottomPx(hourPx: number): number {
  return safePx(WORK_END_HOUR * hourPx);
}

/** Czy dana pełna godzina leży POZA oknem roboczym (przygaszona na osi). */
export function isOffHour(hour: number): boolean {
  if (!Number.isFinite(hour)) return true;
  return hour < WORK_START_HOUR || hour >= WORK_END_HOUR;
}

/**
 * Zmienne CSS dla siatki dni: granice okna roboczego w pikselach. Konsumuje je
 * warstwa `linear-gradient` w `.week-day-col` (tylko tło — żadnych węzłów DOM,
 * żadnego hit-testingu), dzięki czemu stałe żyją w jednym miejscu w TS.
 */
export function workWindowCssVars(hourPx: number): Record<string, string> {
  return {
    '--week-work-top': `${workWindowTopPx(hourPx)}px`,
    '--week-work-bottom': `${workWindowBottomPx(hourPx)}px`,
  };
}

/** Pełna wysokość kolumny dnia (24 h) — wspólna z DAY_BODY_H w WeekView. */
export function dayBodyHeightPx(hourPx: number): number {
  return safePx(DAY_HOURS * hourPx);
}
