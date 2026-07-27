// Testy czystego kontraktu pola formularza. Bez Reacta i bez DOM-u — wejściem są
// gotowe flagi („czy jest podpowiedź / błąd"), wyjściem atrybuty dostępności,
// pierwsze złe pole i jedno liczone podsumowanie błędów zapisu.
import { describe, expect, it } from 'vitest';
import { fieldAria, fieldIds, firstInvalidKey, saveErrorSummary } from './fieldContract';

describe('fieldIds', () => {
  it('wyprowadza identyfikatory deterministycznie z id kontrolki', () => {
    expect(fieldIds('t-title')).toEqual({ help: 't-title-help', error: 't-title-error' });
    expect(fieldIds('event-date')).toEqual({
      help: 'event-date-help',
      error: 'event-date-error',
    });
  });

  it('to samo id daje tę samą parę (błąd zakresu da się współdzielić)', () => {
    expect(fieldIds('t-start').error).toBe(fieldIds('t-start').error);
    expect(fieldIds('t-start').error).not.toBe(fieldIds('t-end').error);
  });
});

describe('fieldAria', () => {
  it('czyste pole nie wnosi żadnego atrybutu', () => {
    expect(fieldAria('t-title', { hasHelp: false, hasError: false })).toEqual({});
  });

  it('sama podpowiedź opisuje pole, ale nie czyni go niepoprawnym', () => {
    expect(fieldAria('t-start', { hasHelp: true, hasError: false })).toEqual({
      'aria-describedby': 't-start-help',
    });
  });

  it('błąd daje opis i `aria-invalid`', () => {
    expect(fieldAria('t-title', { hasHelp: false, hasError: true })).toEqual({
      'aria-describedby': 't-title-error',
      'aria-invalid': true,
    });
  });

  it('błąd stoi PRZED podpowiedzią, a dodatkowe id na końcu', () => {
    expect(
      fieldAria('t-start', {
        hasHelp: true,
        hasError: true,
        extraDescribedBy: 't-period-error',
      })['aria-describedby'],
    ).toBe('t-start-error t-start-help t-period-error');
  });

  it('wymuszone `invalid` działa bez własnego komunikatu (błąd zakresu)', () => {
    expect(
      fieldAria('t-end', { hasHelp: false, hasError: false, invalid: true, extraDescribedBy: 't-period-error' }),
    ).toEqual({ 'aria-describedby': 't-period-error', 'aria-invalid': true });
  });

  it('`invalid: false` zdejmuje `aria-invalid` mimo własnego błędu', () => {
    expect(fieldAria('t-end', { hasHelp: false, hasError: true, invalid: false })).toEqual({
      'aria-describedby': 't-end-error',
    });
  });

  it('puste i powtórzone dodatkowe id nie brudzą listy opisów', () => {
    expect(
      fieldAria('t-start', { hasHelp: false, hasError: false, extraDescribedBy: '   ' }),
    ).toEqual({});
    expect(
      fieldAria('t-start', {
        hasHelp: false,
        hasError: true,
        extraDescribedBy: 't-start-error t-period-error',
      })['aria-describedby'],
    ).toBe('t-start-error t-period-error');
  });

  it('`aria-invalid` nigdy nie jest zapisane jako `false`', () => {
    expect('aria-invalid' in fieldAria('t-title', { hasHelp: true, hasError: false })).toBe(false);
  });
});

describe('firstInvalidKey', () => {
  const ORDER = ['title', 'date', 'time', 'meetingUrl'] as const;

  it('czysty formularz nie ma pierwszego złego pola', () => {
    expect(firstInvalidKey(ORDER, {})).toBeNull();
    expect(firstInvalidKey(ORDER, { title: undefined, date: undefined })).toBeNull();
  });

  it('wybiera pierwsze pole w KOLEJNOŚCI FORMULARZA, nie w kolejności obiektu', () => {
    expect(firstInvalidKey(ORDER, { meetingUrl: 'zły adres', date: 'zła data' })).toBe('date');
    expect(firstInvalidKey(ORDER, { time: 'x', title: 'y' })).toBe('title');
  });

  it('pojedynczy błąd zwraca swój klucz', () => {
    expect(firstInvalidKey(ORDER, { meetingUrl: 'zły adres' })).toBe('meetingUrl');
  });

  it('klucze spoza kolejności są ignorowane', () => {
    expect(firstInvalidKey(ORDER, { form: 'globalny błąd' } as Record<string, unknown>)).toBeNull();
  });
});

describe('saveErrorSummary', () => {
  it('bez etykiet zostaje samo zdanie', () => {
    expect(saveErrorSummary('Nie można zapisać zadania', [])).toBe('Nie można zapisać zadania.');
  });

  it('jedno pole — liczba pojedyncza', () => {
    expect(saveErrorSummary('Nie można zapisać zadania', ['Tytuł'])).toBe(
      'Nie można zapisać zadania — popraw 1 pole: Tytuł.',
    );
  });

  it('dwa pola — forma „pola”', () => {
    expect(saveErrorSummary('Nie można zapisać zadania', ['Tytuł', 'Okres'])).toBe(
      'Nie można zapisać zadania — popraw 2 pola: Tytuł, Okres.',
    );
  });

  it('pięć pól — forma „pól”', () => {
    expect(
      saveErrorSummary('Nie można zapisać zadania', [
        'Tytuł',
        'Projekt',
        'Status',
        'Okres',
        'Osoby',
      ]),
    ).toBe('Nie można zapisać zadania — popraw 5 pól: Tytuł, Projekt, Status, Okres, Osoby.');
  });

  it('powtórzona etykieta liczy się raz (dwa błędy jednego pola)', () => {
    expect(saveErrorSummary('Nie można zapisać wydarzenia', ['Okres', 'Okres'])).toBe(
      'Nie można zapisać wydarzenia — popraw 1 pole: Okres.',
    );
  });

  it('prefiks jest wstawiany dosłownie (zgłoszenie ma dwa warianty)', () => {
    expect(saveErrorSummary('Nie można wysłać zgłoszenia', ['Opis'])).toBe(
      'Nie można wysłać zgłoszenia — popraw 1 pole: Opis.',
    );
  });
});
