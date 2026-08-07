// Sortowanie list Zadań/Projektów (zgłoszenie 9db56d5a): czysty komparator,
// koercja zapamiętanej wartości i fallback rozstrzygający '' oraz remisy.
import { describe, expect, it } from 'vitest';
import { coerceListSort, listSortComparator } from './listSort';

interface Row {
  title: string;
  startDate: string;
  createdAt: string;
}

const rows: Row[] = [
  { title: 'Żaba', startDate: '2026-07-10', createdAt: '2026-07-01T10:00:00.000Z' },
  { title: 'Ala', startDate: '2026-07-08', createdAt: '2026-07-03T10:00:00.000Z' },
  { title: 'Łoś', startDate: '2026-07-09', createdAt: '2026-07-02T10:00:00.000Z' },
];

const fallback = (a: Row, b: Row) => a.startDate.localeCompare(b.startDate);
const titles = (sorted: Row[]) => sorted.map((r) => r.title);

describe('coerceListSort', () => {
  it('przepuszcza dozwolone wartości, nieznane i undefined zwija do domyślnej', () => {
    expect(coerceListSort('title')).toBe('title');
    expect(coerceListSort('created-desc')).toBe('created-desc');
    expect(coerceListSort(undefined)).toBe('');
    expect(coerceListSort('garbage')).toBe('');
  });
});

describe('listSortComparator', () => {
  it("'' używa wyłącznie fallbacku (domyślny porządek widoku)", () => {
    const sorted = [...rows].sort(listSortComparator('', fallback));
    expect(titles(sorted)).toEqual(['Ala', 'Łoś', 'Żaba']);
  });

  it("'title' sortuje polską kolacją (Ł między L a M, Ż na końcu)", () => {
    const sorted = [...rows].sort(listSortComparator('title', fallback));
    expect(titles(sorted)).toEqual(['Ala', 'Łoś', 'Żaba']);
    const byStart = [...rows].sort(listSortComparator('start', fallback));
    expect(titles(byStart)).toEqual(['Ala', 'Łoś', 'Żaba']);
  });

  it("'created-desc'/'created-asc' porządkują po dacie dodania", () => {
    expect(titles([...rows].sort(listSortComparator('created-desc', fallback)))).toEqual([
      'Ala',
      'Łoś',
      'Żaba',
    ]);
    expect(titles([...rows].sort(listSortComparator('created-asc', fallback)))).toEqual([
      'Żaba',
      'Łoś',
      'Ala',
    ]);
  });

  it('remis rozstrzyga fallback', () => {
    const tie: Row[] = [
      { title: 'B', startDate: '2026-07-09', createdAt: '2026-07-01T10:00:00.000Z' },
      { title: 'A', startDate: '2026-07-08', createdAt: '2026-07-01T10:00:00.000Z' },
    ];
    const sorted = [...tie].sort(listSortComparator('created-desc', fallback));
    expect(titles(sorted)).toEqual(['A', 'B']);
  });

  it('nameOf pozwala sortować po nazwie wyświetlanej (maska utajnienia)', () => {
    // „Ala" wyświetla się jako „Zadanie #9" — sortuje się więc między
    // „Łoś" a „Żaba" (Z < Ż w polskiej kolacji), nie na początku listy.
    const masked = [...rows].sort(
      listSortComparator('title', fallback, (r) => (r.title === 'Ala' ? 'Zadanie #9' : r.title)),
    );
    expect(titles(masked)).toEqual(['Łoś', 'Ala', 'Żaba']);
  });
});
