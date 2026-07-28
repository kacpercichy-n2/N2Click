import { describe, expect, it } from 'vitest';
import {
  AXIS_LABEL_LEAD_PX,
  DONE_TICK_BOTTOM_PX,
  DONE_TICK_SIZE_PX,
  WORK_END_HOUR,
  WORK_START_HOUR,
  dayBodyHeightPx,
  doneTickTopPx,
  isOffHour,
  workWindowBottomPx,
  workWindowCssVars,
  workWindowScrollTop,
  workWindowTopPx,
} from './weekViewLayout';

// HOUR_PX używany przez WeekView (84px = 1 h). Testy trzymają się tej samej
// geometrii co siatka, żeby zmiana stałej okna roboczego była widoczna od razu.
const HOUR_PX = 84;
// Minimalna wysokość kafelka w WeekView (MIN_BLOCK_H) — najciaśniejszy przypadek
// dla znacznika ✓ w prawym dolnym rogu.
const MIN_BLOCK_H = 50;
// Wysokość uchwytu zmiany rozmiaru (`.week-block-handle`) w CSS.
const HANDLE_H = 6;

describe('okno robocze widoku tygodnia', () => {
  it('domyślnie obejmuje godziny agencji 9–17', () => {
    expect(WORK_START_HOUR).toBe(9);
    expect(WORK_END_HOUR).toBe(17);
    expect(WORK_START_HOUR).toBeLessThan(WORK_END_HOUR);
  });

  it('przewija siatkę tak, żeby 9:00 było na górze widoku', () => {
    // 9 * 84 = 756 minus zapas na wyśrodkowaną etykietę osi „9:00”.
    expect(workWindowScrollTop(HOUR_PX)).toBe(9 * HOUR_PX - AXIS_LABEL_LEAD_PX);
    expect(workWindowScrollTop(HOUR_PX)).toBe(748);
    expect(workWindowScrollTop(HOUR_PX)).toBeLessThan(workWindowTopPx(HOUR_PX));
    expect(workWindowTopPx(HOUR_PX) - workWindowScrollTop(HOUR_PX)).toBeLessThan(HOUR_PX);
  });

  it('skaluje przewinięcie razem z wysokością godziny', () => {
    expect(workWindowScrollTop(60)).toBe(540 - AXIS_LABEL_LEAD_PX);
    expect(workWindowScrollTop(40)).toBe(360 - AXIS_LABEL_LEAD_PX);
  });

  it('nigdy nie schodzi poniżej zera przy mikroskopijnej godzinie', () => {
    expect(workWindowScrollTop(0.5)).toBe(0);
  });

  it('zwraca 0 dla niepoprawnej geometrii zamiast NaN', () => {
    expect(workWindowScrollTop(Number.NaN)).toBe(0);
    expect(workWindowScrollTop(0)).toBe(0);
    expect(workWindowScrollTop(-84)).toBe(0);
    expect(workWindowScrollTop(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('wyznacza granice przygaszonego tła wewnątrz doby', () => {
    expect(workWindowTopPx(HOUR_PX)).toBe(756);
    expect(workWindowBottomPx(HOUR_PX)).toBe(1428);
    expect(workWindowTopPx(HOUR_PX)).toBeLessThan(workWindowBottomPx(HOUR_PX));
    expect(workWindowBottomPx(HOUR_PX)).toBeLessThan(dayBodyHeightPx(HOUR_PX));
  });

  it('pełna wysokość kolumny to dokładnie 24 godziny', () => {
    expect(dayBodyHeightPx(HOUR_PX)).toBe(24 * HOUR_PX);
    expect(dayBodyHeightPx(Number.NaN)).toBe(0);
  });

  it('oznacza godziny osi poza oknem roboczym', () => {
    expect(isOffHour(0)).toBe(true);
    expect(isOffHour(8)).toBe(true);
    expect(isOffHour(9)).toBe(false);
    expect(isOffHour(16)).toBe(false);
    expect(isOffHour(17)).toBe(true);
    expect(isOffHour(23)).toBe(true);
    expect(isOffHour(Number.NaN)).toBe(true);
  });

  it('kładzie ✓ w prawym DOLNYM rogu kafelka, nie w górnym', () => {
    const top = 3 * HOUR_PX;
    const height = 2 * HOUR_PX;
    const tick = doneTickTopPx(top, height);
    // Bliżej dołu kafelka niż jego góry — to jest cała istota zmiany.
    expect(tick).toBeGreaterThan(top);
    expect(tick).toBe(top + height - DONE_TICK_SIZE_PX - DONE_TICK_BOTTOM_PX);
    expect(tick + DONE_TICK_SIZE_PX).toBeLessThan(top + height);
  });

  it('zostawia dolny uchwyt zmiany rozmiaru w całości odsłonięty', () => {
    const top = 0;
    const height = MIN_BLOCK_H;
    const tickBottom = doneTickTopPx(top, height) + DONE_TICK_SIZE_PX;
    // Dolna krawędź ✓ kończy się NAD pasem uchwytu (ostatnie 6 px kafelka).
    expect(tickBottom).toBeLessThanOrEqual(top + height - HANDLE_H);
    expect(DONE_TICK_BOTTOM_PX).toBeGreaterThanOrEqual(HANDLE_H);
  });

  it('trzyma ✓ wewnątrz kafelka nawet przy skrajnie niskim bloku', () => {
    expect(doneTickTopPx(100, MIN_BLOCK_H)).toBe(122);
    expect(doneTickTopPx(100, 10)).toBe(100);
    expect(doneTickTopPx(100, 0)).toBe(100);
  });

  it('nie produkuje NaN przy niepoprawnej geometrii', () => {
    expect(doneTickTopPx(Number.NaN, 100)).toBe(0);
    expect(doneTickTopPx(40, Number.NaN)).toBe(40);
    expect(doneTickTopPx(40, Number.POSITIVE_INFINITY)).toBe(40);
  });

  it('podaje granice okna jako zmienne CSS w pikselach', () => {
    expect(workWindowCssVars(HOUR_PX)).toEqual({
      '--week-work-top': '756px',
      '--week-work-bottom': '1428px',
    });
    expect(workWindowCssVars(0)).toEqual({
      '--week-work-top': '0px',
      '--week-work-bottom': '0px',
    });
  });
});
