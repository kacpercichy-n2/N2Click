import { describe, expect, it } from 'vitest';
import { copyTitle, stripCopySuffix } from './taskCopyName';

describe('stripCopySuffix', () => {
  it('zdejmuje goły dopisek', () => {
    expect(stripCopySuffix('Baner FB - kopia')).toBe('Baner FB');
  });

  it('zdejmuje dopisek z numerem', () => {
    expect(stripCopySuffix('Baner FB - kopia 3')).toBe('Baner FB');
  });

  it('toleruje różne odstępy wokół myślnika i wielkość liter', () => {
    expect(stripCopySuffix('Baner FB -kopia')).toBe('Baner FB');
    expect(stripCopySuffix('Baner FB  -  Kopia 12')).toBe('Baner FB');
  });

  it('bez dopisku zwraca tytuł nietknięty', () => {
    expect(stripCopySuffix('Kopia zapasowa serwera')).toBe('Kopia zapasowa serwera');
  });

  it('tytuł będący samym dopiskiem zostaje (brak sensownej bazy)', () => {
    expect(stripCopySuffix('- kopia')).toBe('- kopia');
  });
});

describe('copyTitle', () => {
  it('pierwsza kopia dostaje goły dopisek', () => {
    expect(copyTitle(['Baner FB'], 'Baner FB')).toBe('Baner FB - kopia');
  });

  it('zajęty dopisek eskaluje do numeru 2, potem dalej', () => {
    expect(copyTitle(['Baner FB', 'Baner FB - kopia'], 'Baner FB')).toBe('Baner FB - kopia 2');
    expect(
      copyTitle(['Baner FB', 'Baner FB - kopia', 'Baner FB - kopia 2'], 'Baner FB'),
    ).toBe('Baner FB - kopia 3');
  });

  it('duplikowanie kopii nie piętrzy dopisków', () => {
    expect(copyTitle(['Baner FB', 'Baner FB - kopia'], 'Baner FB - kopia')).toBe(
      'Baner FB - kopia 2',
    );
  });

  it('luka w numeracji jest wykorzystywana (najmniejszy wolny)', () => {
    expect(
      copyTitle(['Baner FB - kopia', 'Baner FB - kopia 3'], 'Baner FB'),
    ).toBe('Baner FB - kopia 2');
  });

  it('porównanie ignoruje otaczające spacje', () => {
    expect(copyTitle(['  Baner FB - kopia  '], ' Baner FB ')).toBe('Baner FB - kopia 2');
  });
});
