// Testy czystych pomocników telefonowej karty zadania: limit awatarów („+N”).
// Ścieżka adresowa („Klient › Projekt”) wyprowadziła się do
// `src/utils/entityPath.ts` — jej testy stoją obok tamtego modułu.
// Bez Reacta i bez localStorage.
import { describe, expect, it } from 'vitest';
import { MAX_CARD_AVATARS, visibleAssignees } from './taskCardMobile';

function people(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `osoba-${i}`);
}

describe('visibleAssignees', () => {
  it('pusta lista nie pokazuje nikogo i nie ma reszty', () => {
    expect(visibleAssignees([])).toEqual({ shown: [], extra: 0 });
  });

  it('dokładnie limit (3) pokazuje wszystkich bez „+N”', () => {
    const list = people(3);
    const out = visibleAssignees(list);
    expect(out.shown).toEqual(list);
    expect(out.shown).toHaveLength(MAX_CARD_AVATARS);
    expect(out.extra).toBe(0);
  });

  it('pięć osób pokazuje pierwsze trzy i zwija dwie do „+N”', () => {
    const out = visibleAssignees(people(5));
    expect(out.shown).toEqual(['osoba-0', 'osoba-1', 'osoba-2']);
    expect(out.extra).toBe(2);
  });

  it('krótsza lista niż limit nie ma reszty', () => {
    expect(visibleAssignees(people(1))).toEqual({ shown: ['osoba-0'], extra: 0 });
  });

  it('własny limit zawęża listę', () => {
    expect(visibleAssignees(people(4), 2)).toEqual({ shown: ['osoba-0', 'osoba-1'], extra: 2 });
  });

  it('limit 0 (i ujemny) zwija wszystkich do „+N”', () => {
    expect(visibleAssignees(people(3), 0)).toEqual({ shown: [], extra: 3 });
    expect(visibleAssignees(people(3), -1)).toEqual({ shown: [], extra: 3 });
  });

  it('nie mutuje wejścia', () => {
    const list = people(5);
    visibleAssignees(list);
    expect(list).toHaveLength(5);
  });
});
