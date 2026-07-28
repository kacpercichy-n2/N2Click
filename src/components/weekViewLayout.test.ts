import { describe, expect, it } from 'vitest';
import {
  AXIS_LABEL_LEAD_PX,
  WORK_END_HOUR,
  WORK_START_HOUR,
  dayBodyHeightPx,
  isOffHour,
  workWindowBottomPx,
  workWindowCssVars,
  workWindowScrollTop,
  workWindowTopPx,
} from './weekViewLayout';

// HOUR_PX używany przez WeekView (84px = 1 h). Testy trzymają się tej samej
// geometrii co siatka, żeby zmiana stałej okna roboczego była widoczna od razu.
const HOUR_PX = 84;

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
