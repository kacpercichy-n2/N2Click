// Komunikaty kolizji terminu wydarzenia. Czysty moduł, więc testujemy samo
// BRZMIENIE — bez Reacta, bez DOM-u, bez store'u.
import { describe, expect, it } from 'vitest';
import {
  type ConflictLike,
  eventConflictBlockingMessage,
  eventConflictConfirmMessage,
  eventConflictWarningMessage,
  extraConflictsPhrase,
  namedConflictWarningMessage,
  peopleCountPhrase,
  plannedItemsPhrase,
  recurringConflictWarningMessage,
  vacationDraftWarningMessage,
} from './eventConflictMessage';

function conflict(overrides: Partial<ConflictLike> = {}): ConflictLike {
  return {
    kind: 'block',
    personId: 'p1',
    personName: 'Ola Nowak',
    title: 'Regresja QA',
    startMinutes: 630, // 10:30
    durationMinutes: 90, // do 12:00
    ...overrides,
  };
}

describe('peopleCountPhrase — odmiana przez liczebnik', () => {
  it('używa liczby pojedynczej dla 1', () => {
    expect(peopleCountPhrase(1)).toBe('1 osoba ma');
  });

  it('używa formy mnogiej „osoby mają" dla 2, 3 i 4', () => {
    expect(peopleCountPhrase(2)).toBe('2 osoby mają');
    expect(peopleCountPhrase(3)).toBe('3 osoby mają');
    expect(peopleCountPhrase(4)).toBe('4 osoby mają');
  });

  it('używa formy „osób ma" od 5 w górę', () => {
    expect(peopleCountPhrase(5)).toBe('5 osób ma');
    expect(peopleCountPhrase(9)).toBe('9 osób ma');
  });

  // Nastki są wyjątkiem: 12 to NIE „12 osoby mają".
  it('traktuje nastki jako formę dopełniaczową', () => {
    expect(peopleCountPhrase(11)).toBe('11 osób ma');
    expect(peopleCountPhrase(12)).toBe('12 osób ma');
    expect(peopleCountPhrase(13)).toBe('13 osób ma');
    expect(peopleCountPhrase(14)).toBe('14 osób ma');
  });

  // Setki wracają do zwykłej reguły: 22 to „22 osoby mają".
  it('wraca do formy mnogiej powyżej nastek', () => {
    expect(peopleCountPhrase(21)).toBe('21 osób ma');
    expect(peopleCountPhrase(22)).toBe('22 osoby mają');
    expect(peopleCountPhrase(25)).toBe('25 osób ma');
  });
});

describe('extraConflictsPhrase — odmiana „kolejna kolizja"', () => {
  it('odmienia przez liczebnik razem z wyjątkiem nastek', () => {
    expect(extraConflictsPhrase(1)).toBe('1 kolejna kolizja');
    expect(extraConflictsPhrase(3)).toBe('3 kolejne kolizje');
    expect(extraConflictsPhrase(7)).toBe('7 kolejnych kolizji');
    expect(extraConflictsPhrase(12)).toBe('12 kolejnych kolizji');
    expect(extraConflictsPhrase(21)).toBe('21 kolejnych kolizji');
    expect(extraConflictsPhrase(22)).toBe('22 kolejne kolizje');
  });
});

describe('eventConflictBlockingMessage', () => {
  it('zwraca puste zdanie dla braku kolizji (wywołujący nie pokazuje nic)', () => {
    expect(eventConflictBlockingMessage([])).toBe('');
  });

  it('nazywa osobę, rodzaj, tytuł i zakres godzin', () => {
    expect(eventConflictBlockingMessage([conflict()])).toBe(
      'Nie da się ustawić wydarzenia w tych godzinach. Ola Nowak ma już zadanie „Regresja QA" 10:30-12:00.',
    );
  });

  it('rozróżnia rodzaj kolidującej pozycji', () => {
    expect(eventConflictBlockingMessage([conflict({ kind: 'event', title: 'Standup' })])).toContain(
      'ma już wydarzenie „Standup"',
    );
    expect(
      eventConflictBlockingMessage([conflict({ kind: 'recurrence', title: 'Przegląd' })]),
    ).toContain('ma już zadanie cykliczne „Przegląd"');
  });

  it('wymienia dwie kolizje z nazwy, a resztę zbiera licznikiem', () => {
    const many = [
      conflict({ personName: 'Ola Nowak' }),
      conflict({ personName: 'Marek Wiśniewski' }),
      conflict({ personName: 'Kasia Kowalska' }),
      conflict({ personName: 'Jan Nowak' }),
    ];
    const msg = eventConflictBlockingMessage(many);
    expect(msg).toContain('Ola Nowak');
    expect(msg).toContain('Marek Wiśniewski');
    expect(msg).not.toContain('Kasia Kowalska');
    expect(msg).toContain('(i 2 kolejne kolizje)');
  });

  // Łagodna degradacja: brak nazwy/tytułu nie może dać „ ma już  ".
  it('znosi brak nazwy osoby i brak tytułu', () => {
    expect(eventConflictBlockingMessage([conflict({ personName: '', title: '' })])).toBe(
      'Nie da się ustawić wydarzenia w tych godzinach. Ta osoba ma już zadanie 10:30-12:00.',
    );
  });

  // Zakresy godzin piszemy łącznikiem — myślnik i półpauza są zabronione
  // w tekstach widocznych dla użytkownika.
  it('nie używa myślnika ani półpauzy', () => {
    const msg = eventConflictBlockingMessage([conflict()]);
    expect(msg).not.toContain('—');
    expect(msg).not.toContain('–');
  });
});

describe('eventConflictWarningMessage', () => {
  it('zwraca puste zdanie dla braku kolizji', () => {
    expect(eventConflictWarningMessage([])).toBe('');
  });

  it('liczy RÓŻNE osoby, nie kolizje', () => {
    const sameTwice = [
      conflict({ personId: 'p1', title: 'Zadanie A' }),
      conflict({ personId: 'p1', title: 'Zadanie B' }),
      conflict({ personId: 'p1', kind: 'event', title: 'Spotkanie C' }),
    ];
    expect(eventConflictWarningMessage(sameTwice)).toBe(
      'Wydarzenie ogólnofirmowe: 1 osoba ma już coś zaplanowane w tych godzinach.',
    );
  });

  it('odmienia komunikat przez liczbę zajętych osób', () => {
    const three = ['p1', 'p2', 'p3'].map((personId) => conflict({ personId }));
    expect(eventConflictWarningMessage(three)).toBe(
      'Wydarzenie ogólnofirmowe: 3 osoby mają już coś zaplanowane w tych godzinach.',
    );
  });
});

// URLOP pełnodniowy NIE niesie zakresu godzin („0:00-24:00" nic by nie
// mówiło); godzinowy (jednodniowy, od 2026-08-24) wymienia swoje okno.
// Ostrzeżenie przy zapisie liczy pracę do przeplanowania.
describe('urlop w komunikatach', () => {
  const vacation = (overrides: Partial<ConflictLike> = {}) =>
    conflict({ kind: 'urlop', title: 'Urlop', startMinutes: 0, durationMinutes: 1440, ...overrides });

  it('opisuje urlop pełnodniowy bez zakresu godzin', () => {
    expect(eventConflictBlockingMessage([vacation()])).toBe(
      'Nie da się ustawić wydarzenia w tych godzinach. Ola Nowak ma w tym dniu urlop.',
    );
  });

  it('urlop godzinowy wymienia swoje okno', () => {
    expect(
      eventConflictBlockingMessage([vacation({ startMinutes: 600, durationMinutes: 120 })]),
    ).toBe('Nie da się ustawić wydarzenia w tych godzinach. Ola Nowak ma urlop 10:00-12:00.');
  });

  it('bez nazwiska mówi „Ta osoba"', () => {
    expect(eventConflictBlockingMessage([vacation({ personName: '  ' })])).toBe(
      'Nie da się ustawić wydarzenia w tych godzinach. Ta osoba ma w tym dniu urlop.',
    );
  });

  it('miesza się z innymi rodzajami bez zmiany ich brzmienia', () => {
    expect(eventConflictBlockingMessage([conflict(), vacation()])).toBe(
      'Nie da się ustawić wydarzenia w tych godzinach. Ola Nowak ma już zadanie „Regresja QA" 10:30-12:00; Ola Nowak ma w tym dniu urlop.',
    );
  });

  it('plannedItemsPhrase odmienia się jak reszta liczebników', () => {
    expect(plannedItemsPhrase(1)).toBe('1 zaplanowana pozycja');
    expect(plannedItemsPhrase(3)).toBe('3 zaplanowane pozycje');
    expect(plannedItemsPhrase(5)).toBe('5 zaplanowanych pozycji');
    expect(plannedItemsPhrase(12)).toBe('12 zaplanowanych pozycji');
    expect(plannedItemsPhrase(22)).toBe('22 zaplanowane pozycje');
  });

  it('ostrzeżenie zapisu urlopu jest puste bez kolizji i liczy POZYCJE, nie osoby', () => {
    expect(vacationDraftWarningMessage([])).toBe('');
    expect(vacationDraftWarningMessage([conflict(), conflict({ title: 'Inne' })])).toBe(
      'W tym okresie masz już 2 zaplanowane pozycje. Urlop zapisze się mimo to, pamiętaj o przeplanowaniu.',
    );
  });
});

describe('recurringConflictWarningMessage — seria cykliczna', () => {
  it('puste kolizje => pusty komunikat', () => {
    expect(recurringConflictWarningMessage([])).toBe('');
  });

  it('wymienia terminy z datą i mówi, że zapis przechodzi', () => {
    expect(
      recurringConflictWarningMessage([
        conflict({
          kind: 'urlop',
          personName: 'Jarek Nowak',
          date: '2026-07-08',
          startMinutes: 0,
          durationMinutes: 1440,
        }),
      ]),
    ).toBe(
      'Seria koliduje w pojedynczych terminach: 8 lip (śro): Jarek Nowak ma w tym dniu urlop. Wydarzenie zapisze się mimo to.',
    );
  });

  it('powyżej trzech kolizji zbiera resztę licznikiem', () => {
    const four = [
      conflict({ date: '2026-07-08' }),
      conflict({ date: '2026-07-15' }),
      conflict({ date: '2026-07-22' }),
      conflict({ date: '2026-07-29' }),
    ];
    const msg = recurringConflictWarningMessage(four);
    expect(msg).toContain('8 lip (śro): Ola Nowak ma już zadanie „Regresja QA" 10:30-12:00');
    expect(msg).toContain('(i 1 kolejna kolizja)');
    expect(msg).not.toContain('29 lip');
  });
});

// Kolizje imienne po zmianie 2026-08-06: zapis możliwy po potwierdzeniu, więc
// żywa linia zapowiada dialog, a treść dialogu jest samą listą zajęć.
describe('namedConflictWarningMessage — imienna kolizja (żywa linia)', () => {
  it('pusta lista => pusty tekst', () => {
    expect(namedConflictWarningMessage([])).toBe('');
  });

  it('wymienia zajęcie i zapowiada potwierdzenie', () => {
    expect(namedConflictWarningMessage([conflict()])).toBe(
      'Termin koliduje: Ola Nowak ma już zadanie „Regresja QA" 10:30-12:00. Zapis poprosi o potwierdzenie.',
    );
  });

  it('powyżej dwóch kolizji zbiera resztę licznikiem', () => {
    const msg = namedConflictWarningMessage([
      conflict(),
      conflict({ kind: 'event', title: 'Brainstorm', startMinutes: 600, durationMinutes: 60 }),
      conflict({ personName: 'Jan Kowalski' }),
    ]);
    expect(msg).toContain('Termin koliduje: ');
    expect(msg).toContain('wydarzenie „Brainstorm" 10:00-11:00');
    expect(msg).toContain('(i 1 kolejna kolizja)');
    expect(msg).toContain('Zapis poprosi o potwierdzenie.');
  });
});

describe('eventConflictConfirmMessage — treść dialogu potwierdzenia', () => {
  it('pusta lista => pusty tekst', () => {
    expect(eventConflictConfirmMessage([])).toBe('');
  });

  it('jest samą listą zajęć, bez zdania „nie da się"', () => {
    expect(eventConflictConfirmMessage([conflict()])).toBe(
      'Ola Nowak ma już zadanie „Regresja QA" 10:30-12:00.',
    );
  });

  it('wydarzenie cykliczne uczestnika nazywa się zadaniem cyklicznym', () => {
    expect(
      eventConflictConfirmMessage([
        conflict({ kind: 'recurrence', title: 'Przegląd tygodnia', startMinutes: 540, durationMinutes: 30 }),
      ]),
    ).toBe('Ola Nowak ma już zadanie cykliczne „Przegląd tygodnia" 9:00-9:30.');
  });
});
