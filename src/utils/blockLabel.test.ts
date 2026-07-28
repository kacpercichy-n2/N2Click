// Testy wspólnego budowniczego zdania o bloku (PKG-20260728-calendar-blocks-keyboard).
// Najważniejszy jest kontrakt zgodności: bez `taskTitle`/`done` zdanie musi być
// DOKŁADNIE tym, co renderowała lista bloków w TaskModal (`blockRowLabel`).
import { describe, expect, it } from 'vitest';
import { blockLabel } from './blockLabel';

describe('blockLabel — wiersz TaskModal (zgodność bajt w bajt)', () => {
  it('blok z terminem: osoba, data z dniem tygodnia, zakres i długość', () => {
    expect(
      blockLabel({ personName: 'Anna', date: '2026-07-30', startMinutes: 540, plannedHours: 2 }),
    ).toBe('Anna — 30 lip (czw), 9:00–11:00 (2h)');
  });

  it('blok w zasobniku: bez daty i bez zakresu godzin', () => {
    expect(
      blockLabel({ personName: 'Anna', date: '', startMinutes: 0, plannedHours: 2 }),
    ).toBe('Anna — zasobnik (bez terminu), 2h');
  });

  it('bez osoby (usunięta z zespołu) zdanie nie ma przedrostka z myślnikiem', () => {
    expect(blockLabel({ date: '', startMinutes: 0, plannedHours: 1.5 })).toBe(
      'zasobnik (bez terminu), 1h 30m',
    );
    expect(blockLabel({ personName: '', date: '2026-07-30', startMinutes: 615, plannedHours: 0.25 })).toBe(
      '30 lip (czw), 10:15–10:30 (15m)',
    );
  });
});

describe('blockLabel — kafelek kalendarza', () => {
  it('dokłada tytuł zadania przed opisem osoby i terminu', () => {
    expect(
      blockLabel({
        taskTitle: 'Montaż filmu',
        personName: 'Anna',
        date: '2026-07-30',
        startMinutes: 540,
        plannedHours: 2,
      }),
    ).toBe('Montaż filmu: Anna — 30 lip (czw), 9:00–11:00 (2h)');
  });

  it('dokłada informację o wykonaniu na końcu zdania', () => {
    expect(
      blockLabel({
        taskTitle: 'Montaż filmu',
        personName: 'Anna',
        date: '2026-07-30',
        startMinutes: 540,
        plannedHours: 2,
        done: true,
      }),
    ).toBe('Montaż filmu: Anna — 30 lip (czw), 9:00–11:00 (2h), wykonane');
    // `done: false` to ten sam tekst co brak pola — żadnego „, niewykonane”.
    expect(
      blockLabel({ personName: 'Anna', date: '2026-07-30', startMinutes: 540, plannedHours: 2, done: false }),
    ).toBe(blockLabel({ personName: 'Anna', date: '2026-07-30', startMinutes: 540, plannedHours: 2 }));
  });

  it('blok przez północ opisuje koniec zgodnie z `blockEndMinutes`', () => {
    expect(
      blockLabel({ personName: 'Ola', date: '2026-07-30', startMinutes: 1380, plannedHours: 1 }),
    ).toBe('Ola — 30 lip (czw), 23:00–24:00 (1h)');
  });
});
