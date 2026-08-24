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

// ---- Okno renderu bloku urlopu PEŁNODNIOWEGO ----
// Urlop pełnodniowy jest przechowywany jako wydarzenie 0/1440, bo tylko takie
// czasy dają pełnodniową kolizję bez żadnej równoległej mechaniki. Rysowanie go
// przez całą dobę zalałoby jednak kolumnę, więc RENDER świadomie ignoruje
// zapisane czasy i używa godzin pracy z profilu osoby. Urlop GODZINOWY
// (jednodniowy, od 2026-08-24) tu NIE wchodzi — jego zapisane okno jest prawdą
// i weekViewModel podaje je wprost. To wyłącznie prezentacja (inwariant 1 + 7):
// nic tutaj nie wchodzi do kolizji ani sum.

/** Godziny pracy potrzebne do wyznaczenia okna — strukturalny podzbiór `Person`,
 *  żeby ten moduł został wolny od importów store'u. */
export interface VacationWindowPerson {
  workStartMinutes: number;
  workEndMinutes: number;
}

/**
 * Okno renderu bloku urlopu: godziny pracy z profilu, gdy oba końce są skończone
 * i tworzą sensowny przedział `0 <= start < end <= 1440`. Zdegenerowane okno
 * (brak osoby, start >= koniec, wartości nieskończone) spada na 9:00-17:00 —
 * ten sam zakres, co prezentacyjne okno robocze siatki.
 */
export function vacationRenderWindow(
  person: VacationWindowPerson | undefined | null,
): { start: number; end: number } {
  const fallback = { start: WORK_START_HOUR * 60, end: WORK_END_HOUR * 60 };
  if (!person) return fallback;
  const { workStartMinutes: start, workEndMinutes: end } = person;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return fallback;
  if (start < 0 || start >= end || end > DAY_HOURS * 60) return fallback;
  return { start, end };
}

// ---- Znacznik ✓ ukończenia na kafelku ----
// Też PREZENTACJA (inwariant 1 + 7): liczy wyłącznie piksele rogu, w którym
// stoi ✓. Wcześniej ✓ siedziało w prawym GÓRNYM rogu i nachodziło na tytuł —
// teraz idzie do prawego DOLNEGO rogu, gdzie kafelek jest zwykle pusty.

/** Bok kwadratowego ✓ (lustro `width`/`height` w `.week-block-done-btn`).
 *  16 px (dawniej 20): przycisk ma być drobniejszy niż wiersz treści kafelka
 *  i stać z marginesem od krawędzi, nie licować się z nią. */
export const DONE_TICK_SIZE_PX = 16;

/**
 * Prześwit między ✓ a dolną krawędzią kafelka: 6 px uchwytu zmiany rozmiaru
 * (`.week-block-handle.bottom`) + 2 px luzu. Dzięki niemu ✓ NIE leży na
 * uchwycie, więc chwyt za dolną krawędź zostaje w całości trafialny
 * (inwariant 7 — żadna ścieżka wskaźnika przeciągania się nie zmienia).
 * Ta sama wartość stoi w `.block-done-mark.corner` (`bottom`) w CSS.
 */
export const DONE_TICK_BOTTOM_PX = 8;

/**
 * `top` przycisku ✓ (rodzeństwa kafelka, liczonego od góry kolumny dnia) dla
 * kafelka o danym `top`/`height`. Dotyczy bloków ≥45 min (63 px) — kompaktowe
 * kafelki 15/30 min (.h-quarter/.h-half) stawiają ✓ przy tytule z pominięciem
 * tej funkcji. Dolna bariera `blockTop` trzyma znacznik wewnątrz własnego
 * kafelka; niepoprawna geometria daje `blockTop`, nie NaN.
 */
export function doneTickTopPx(blockTop: number, blockHeight: number): number {
  if (!Number.isFinite(blockTop)) return 0;
  if (!Number.isFinite(blockHeight)) return blockTop;
  const rested = blockTop + blockHeight - DONE_TICK_SIZE_PX - DONE_TICK_BOTTOM_PX;
  return Math.max(blockTop, rested);
}
