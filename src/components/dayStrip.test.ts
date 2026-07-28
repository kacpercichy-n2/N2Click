// Testy czystego paska dat widoku dnia (PKG-20260728-mobile-nav-day-view).
import { describe, expect, it } from 'vitest';
import { DAY_STRIP_LENGTH, dayStripEntries, todayPillVisible } from './dayStrip';

describe('dayStripEntries', () => {
  it('zawsze DAY_STRIP_LENGTH pozycji, rosnąco, kotwica w środku', () => {
    const entries = dayStripEntries('2026-07-28', '2026-07-28');
    expect(entries).toHaveLength(DAY_STRIP_LENGTH);
    expect(entries.map((e) => e.date)).toEqual([
      '2026-07-25',
      '2026-07-26',
      '2026-07-27',
      '2026-07-28',
      '2026-07-29',
      '2026-07-30',
      '2026-07-31',
    ]);
    expect(entries[3].date).toBe('2026-07-28');
  });

  it('dokładnie jedna pozycja `active` i jest nią kotwica', () => {
    const entries = dayStripEntries('2026-07-28', '2026-01-01');
    const active = entries.filter((e) => e.active);
    expect(active).toHaveLength(1);
    expect(active[0].date).toBe('2026-07-28');
  });

  it('przy kotwicy = dziś „today” stoi w środku', () => {
    const entries = dayStripEntries('2026-07-28', '2026-07-28');
    expect(entries.findIndex((e) => e.today)).toBe(3);
  });

  it('kotwica odległa od dziś → żadnej pozycji `today`', () => {
    const entries = dayStripEntries('2026-07-28', '2025-01-01');
    expect(entries.some((e) => e.today)).toBe(false);
  });

  it('dziś tuż obok kotwicy trafia na właściwą pozycję', () => {
    const entries = dayStripEntries('2026-07-28', '2026-07-30');
    expect(entries.findIndex((e) => e.today)).toBe(5);
  });

  it('weekend oznaczony na sobocie i niedzieli', () => {
    // Kotwica 2026-08-01 (sobota) → pasek 07-29…08-04; weekend to 08-01 i 08-02.
    const entries = dayStripEntries('2026-08-01', '2026-08-01');
    const weekend = entries.filter((e) => e.weekend).map((e) => e.date);
    expect(weekend).toEqual(['2026-08-01', '2026-08-02']);
  });

  it('przełom miesiąca', () => {
    const entries = dayStripEntries('2026-07-31', '2026-07-31');
    expect(entries.map((e) => e.date)).toEqual([
      '2026-07-28',
      '2026-07-29',
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
    ]);
  });

  it('przełom roku', () => {
    const entries = dayStripEntries('2026-01-01', '2026-01-01');
    expect(entries.map((e) => e.date)).toEqual([
      '2025-12-29',
      '2025-12-30',
      '2025-12-31',
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
      '2026-01-04',
    ]);
  });

  it('rok przestępny: 29 lutego istnieje w pasku', () => {
    const entries = dayStripEntries('2028-03-01', '2028-03-01');
    expect(entries[2].date).toBe('2028-02-29');
  });
});

describe('todayPillVisible', () => {
  it('tryb dnia: kotwica = dziś → pigułki nie ma', () => {
    expect(todayPillVisible('day', '2026-07-28', '2026-07-28')).toBe(false);
  });

  it('tryb dnia: inny dzień → pigułka widoczna (także dzień obok)', () => {
    expect(todayPillVisible('day', '2026-07-29', '2026-07-28')).toBe(true);
    expect(todayPillVisible('day', '2026-09-01', '2026-07-28')).toBe(true);
  });

  it('tryb miesiąca: ten sam miesiąc → pigułki nie ma', () => {
    expect(todayPillVisible('month', '2026-07-01', '2026-07-28')).toBe(false);
    expect(todayPillVisible('month', '2026-07-31', '2026-07-28')).toBe(false);
  });

  it('tryb miesiąca: inny miesiąc → pigułka widoczna', () => {
    expect(todayPillVisible('month', '2026-08-10', '2026-07-28')).toBe(true);
  });

  it('tryb miesiąca: ten sam miesiąc INNEGO roku → pigułka widoczna', () => {
    expect(todayPillVisible('month', '2027-07-10', '2026-07-28')).toBe(true);
  });
});
