// Testy czystej logiki dolnego paska zakładek (PKG-20260728-mobile-nav-day-view).
// Bez Reacta i bez DOM — sam dobór tras i dopasowanie etykiety trasy.
import { describe, expect, it } from 'vitest';
import {
  BIN_SHEET_PARAM,
  BIN_TAB_TARGET,
  BOTTOM_NAV_PRIMARY,
  CALENDAR_DAY_PARAM,
  activeTabPath,
  calendarDayTarget,
  moreNavPaths,
  topBarTitle,
} from './bottomNav';
import { NAV } from './navItems';
import { applyNavOrder } from '../utils/navOrder';

const DEFAULT_PATHS = NAV.map(([to]) => to);
const LABELS = new Map(NAV.map(([to, label]) => [to, label]));

describe('stałe zakładek', () => {
  it('trzy zakładki-trasy w kolejności wyświetlania', () => {
    expect(BOTTOM_NAV_PRIMARY).toEqual(['/dashboard', '/calendar', '/tasks']);
  });

  it('deep-link zasobnika używa zadeklarowanego parametru', () => {
    expect(BIN_TAB_TARGET).toBe(`/calendar?${BIN_SHEET_PARAM}=1`);
  });

  it('deep-link dnia („+N więcej" w pasku tygodnia) celuje w kalendarz', () => {
    expect(calendarDayTarget('2026-07-25')).toBe(`/calendar?${CALENDAR_DAY_PARAM}=2026-07-25`);
  });
});

describe('moreNavPaths', () => {
  it('kolejność zapisana przez użytkownika przetrwa', () => {
    const saved = ['/admin', '/kanban', '/timeline'];
    const ordered = applyNavOrder(DEFAULT_PATHS, saved);
    const more = moreNavPaths(ordered);
    expect(more.slice(0, 3)).toEqual(saved);
    // Reszta zostaje w kolejności z `applyNavOrder` (bez zakładek podstawowych).
    expect(more).toEqual(ordered.filter((p) => !BOTTOM_NAV_PRIMARY.includes(p)));
  });

  it('ścieżki podstawowe nie duplikują się w „Więcej”', () => {
    const more = moreNavPaths(applyNavOrder(DEFAULT_PATHS, undefined));
    for (const path of BOTTOM_NAV_PRIMARY) {
      expect(more).not.toContain(path);
    }
    expect(more.length).toBe(DEFAULT_PATHS.length - BOTTOM_NAV_PRIMARY.length);
  });

  it('lista po bramkach uprawnień nie odzyskuje ukrytych tras', () => {
    const gated = applyNavOrder(DEFAULT_PATHS, undefined).filter(
      (p) => p !== '/admin' && p !== '/team',
    );
    const more = moreNavPaths(gated);
    expect(more).not.toContain('/admin');
    expect(more).not.toContain('/team');
  });

  it('pusta lista wejściowa → pusta lista', () => {
    expect(moreNavPaths([])).toEqual([]);
  });
});

describe('topBarTitle', () => {
  it('zagnieżdżona trasa bierze etykietę rodzica', () => {
    expect(topBarTitle('/tasks/42', LABELS)).toBe('Zadania');
  });

  it('trasa dokładna', () => {
    expect(topBarTitle('/calendar', LABELS)).toBe('Kalendarz');
  });

  it('„/” i nieznane trasy → N2Hub', () => {
    expect(topBarTitle('/', LABELS)).toBe('N2Hub');
    expect(topBarTitle('/nieznane', LABELS)).toBe('N2Hub');
  });

  it('wygrywa NAJDŁUŻSZY pasujący prefiks', () => {
    const labels = new Map([
      ['/people', 'Zespół'],
      ['/people/settings', 'Ustawienia zespołu'],
    ]);
    expect(topBarTitle('/people/settings/2', labels)).toBe('Ustawienia zespołu');
    expect(topBarTitle('/people/7', labels)).toBe('Zespół');
  });

  it('wspólny przedrostek bez granicy segmentu nie łapie', () => {
    expect(topBarTitle('/tasksy', LABELS)).toBe('N2Hub');
  });
});

describe('activeTabPath', () => {
  it('zagnieżdżona trasa podświetla swoją zakładkę', () => {
    expect(activeTabPath('/tasks/42')).toBe('/tasks');
  });

  it('trasa spoza zakładek nie podświetla niczego', () => {
    expect(activeTabPath('/projects')).toBeNull();
    expect(activeTabPath('/')).toBeNull();
  });

  it('kalendarz z deep-linkiem zasobnika to nadal zakładka kalendarza', () => {
    // Ścieżka bez query — parametr `zasobnik` żyje w `search`, nie w `pathname`.
    expect(activeTabPath('/calendar')).toBe('/calendar');
  });
});
