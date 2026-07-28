// Testy czystej geometrii paska rozplanowania. Bez Reacta i bez store'a.
import { describe, expect, it } from 'vitest';
import {
  PROGRESS_EPS,
  planningProgress,
  planningProgressLabel,
} from './planningProgress';

describe('planningProgress — brak szacunku', () => {
  it('null szacunek nie daje procentu, tylko jawne `ratio: null`', () => {
    const out = planningProgress(45, null);
    expect(out.ratio).toBeNull();
    expect(out.percent).toBe(0);
    expect(out.tone).toBe('full');
  });

  it('szacunek 0 (i ujemny) liczy się jako brak celu', () => {
    expect(planningProgress(4, 0).ratio).toBeNull();
    expect(planningProgress(4, -8).ratio).toBeNull();
  });

  it('bez szacunku i bez godzin ton jest pusty', () => {
    expect(planningProgress(0, null).tone).toBe('none');
    expect(planningProgress(undefined, undefined).tone).toBe('none');
  });
});

describe('planningProgress — tony', () => {
  it('0 zaplanowanych godzin przy szacunku daje ton `none` i zerową szerokość', () => {
    const out = planningProgress(0, 8);
    expect(out.ratio).toBe(0);
    expect(out.percent).toBe(0);
    expect(out.tone).toBe('none');
  });

  it('częściowe rozplanowanie daje `under` i przycięty procent', () => {
    const out = planningProgress(2, 8);
    expect(out.ratio).toBe(0.25);
    expect(out.percent).toBe(25);
    expect(out.tone).toBe('under');
  });

  it('dokładnie 100% daje `full`', () => {
    const out = planningProgress(8, 8);
    expect(out.percent).toBe(100);
    expect(out.tone).toBe('full');
  });

  it('dryf zmiennoprzecinkowy (0.1 + 0.2) NIE robi z pełnego przekroczenia', () => {
    const planned = 0.1 + 0.2; // 0.30000000000000004
    expect(planned).not.toBe(0.3);
    const out = planningProgress(planned, 0.3);
    expect(out.ratio).toBeGreaterThan(1);
    expect(out.ratio! - 1).toBeLessThan(PROGRESS_EPS);
    expect(out.tone).toBe('full');
    expect(out.percent).toBe(100);
  });

  it('powyżej 100% ostrzega i PRZYCINA szerokość do 100', () => {
    const out = planningProgress(45, 40);
    expect(out.ratio).toBeCloseTo(1.125, 10);
    expect(out.percent).toBe(100);
    expect(out.tone).toBe('over');
  });
});

describe('planningProgress — wejścia śmieciowe', () => {
  it('ujemne godziny degradują do zera', () => {
    const out = planningProgress(-5, 8);
    expect(out.ratio).toBe(0);
    expect(out.percent).toBe(0);
    expect(out.tone).toBe('none');
  });

  it('NaN i Infinity nigdy nie wychodzą do stylu', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const out = planningProgress(bad, 8);
      expect(Number.isFinite(out.percent)).toBe(true);
      expect(out.percent).toBe(0);
      expect(out.tone).toBe('none');
    }
    const badTarget = planningProgress(4, Number.NaN);
    expect(badTarget.ratio).toBeNull();
    expect(Number.isFinite(badTarget.percent)).toBe(true);
  });
});

describe('planningProgressLabel', () => {
  it('podaje obie liczby i NIEPRZYCIĘTY procent', () => {
    expect(planningProgressLabel(45, 40)).toBe('Zaplanowano 45h z 40h (113%)');
  });

  it('bez szacunku mówi o tym wprost', () => {
    expect(planningProgressLabel(45, null)).toBe('Zaplanowano 45h, brak szacunku');
    expect(planningProgressLabel(0, 0)).toBe('Zaplanowano 0h, brak szacunku');
  });

  it('zero godzin przy szacunku to 0%', () => {
    expect(planningProgressLabel(0, 8)).toBe('Zaplanowano 0h z 8h (0%)');
  });

  it('kwadranse idą przez formatDuration', () => {
    expect(planningProgressLabel(2.5, 8)).toBe('Zaplanowano 2h 30m z 8h (31%)');
  });

  it('etykieta w widoku jest tą samą etykietą', () => {
    expect(planningProgress(45, 40).label).toBe(planningProgressLabel(45, 40));
  });
});
