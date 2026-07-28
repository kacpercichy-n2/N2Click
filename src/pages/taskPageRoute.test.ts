// Testy czystej trasy pełnego widoku zadania (IA-15). Stoją ZAMIAST testów
// renderujących — vitest jest w środowisku `node` i bierze tylko `*.test.ts`.
import { describe, expect, it } from 'vitest';
import { normalizeTaskRouteParam, taskFullViewPath } from './taskPageRoute';

describe('taskFullViewPath', () => {
  it('buduje ścieżkę pod zwykły identyfikator', () => {
    expect(taskFullViewPath('t1')).toBe('/tasks/t1');
  });

  it('koduje identyfikatory ze znakami trasy i spacjami', () => {
    expect(taskFullViewPath('a/b')).toBe('/tasks/a%2Fb');
    expect(taskFullViewPath('zadanie 1')).toBe('/tasks/zadanie%201');
    expect(taskFullViewPath('a?b=1&c')).toBe('/tasks/a%3Fb%3D1%26c');
    expect(taskFullViewPath('#hash')).toBe('/tasks/%23hash');
  });

  it('runda: zakodowany segment wraca do oryginału po zdekodowaniu', () => {
    for (const id of ['t1', 'a/b', 'zadanie 1', 'ą ę/ż', 'a?b=1&c', '#hash']) {
      const segment = taskFullViewPath(id).slice('/tasks/'.length);
      expect(decodeURIComponent(segment)).toBe(id);
    }
  });
});

describe('normalizeTaskRouteParam', () => {
  it('zwraca przycięty identyfikator', () => {
    expect(normalizeTaskRouteParam('t1')).toBe('t1');
    expect(normalizeTaskRouteParam('  t1  ')).toBe('t1');
  });

  it('brak parametru i pusty parametr dają `null` (stan „nie znaleziono")', () => {
    expect(normalizeTaskRouteParam(undefined)).toBeNull();
    expect(normalizeTaskRouteParam('')).toBeNull();
    expect(normalizeTaskRouteParam('   ')).toBeNull();
  });

  it('identyfikator zdekodowany przez router przechodzi bez zmian', () => {
    const id = 'a/b';
    const segment = taskFullViewPath(id).slice('/tasks/'.length);
    expect(normalizeTaskRouteParam(decodeURIComponent(segment))).toBe(id);
  });
});
