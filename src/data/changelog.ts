// Dziennik zmian („Changelog") pokazywany na Panelu. To zwykła, płaska tablica
// literałów — najnowszy wpis NA GÓRZE. Plik jest dopisywany ręcznie (albo przez
// automat), więc trzymamy go prosto i czytelnie.
//
// Jak dodać nowy wpis: skopiuj poniższy szablon na POCZĄTEK tablicy CHANGELOG,
// nadaj unikalne `id`, ustaw zakres dat `dateFrom`/`dateTo` w formacie
// 'yyyy-MM-dd', dopisz krótkie `summary` i pogrupuj zmiany w `items` po panelu
// (`area`). Cały tekst piszemy po polsku, prostym językiem dla nie-technicznego
// użytkownika (bez żargonu).
//
//   {
//     id: '2026-08-01-nazwa',
//     dateFrom: '2026-08-01',
//     dateTo: '2026-08-01',
//     summary: 'Krótkie jednozdaniowe podsumowanie.',
//     items: [
//       { area: 'Kalendarz', feature: 'Nazwa funkcji', description: 'Co daje użytkownikowi.' },
//     ],
//   },

import { format } from 'date-fns';
import { pl } from 'date-fns/locale/pl';
import type { DateStr } from '../types';
import { isValidDateStr, parseDate } from '../utils/dates';

/** Pojedyncza zmiana w obrębie jednego panelu aplikacji. */
export type ChangelogItem = {
  /** Panel, którego dotyczy zmiana (np. „Kalendarz", „Projekty", „Ogólne"). */
  area: string;
  /** Krótka nazwa funkcji/poprawki. */
  feature: string;
  /** 1–2 zdania prostym językiem: co to daje użytkownikowi. */
  description: string;
};

/** Jeden wpis dziennika zmian obejmujący zakres dat i listę zmian. */
export type ChangelogEntry = {
  /** Stabilny, unikalny identyfikator wpisu. */
  id: string;
  /** Początek zakresu dat, 'yyyy-MM-dd'. */
  dateFrom: DateStr;
  /** Koniec zakresu dat, 'yyyy-MM-dd'. */
  dateTo: DateStr;
  /** Jednozdaniowe podsumowanie całej serii zmian. */
  summary: string;
  /** Zmiany pogrupowane po panelu. */
  items: ChangelogItem[];
};

/**
 * Etykieta zakresu dat wpisu, np. „20–21.07". Dla jednego dnia zwraca pojedynczą
 * datę („21.07"). Różny miesiąc lub rok rozszerza obie strony zakresu. Puste albo
 * niepoprawne daty => '' (nigdy nie rzuca). Korzysta z `parseDate` z utils/dates,
 * żeby nie powielać logiki parsowania dat.
 */
export function changelogRangeLabel(dateFrom: DateStr, dateTo: DateStr): string {
  if (!isValidDateStr(dateFrom) || !isValidDateStr(dateTo)) return '';
  const from = parseDate(dateFrom);
  const to = parseDate(dateTo);
  if (dateFrom === dateTo) {
    return format(from, 'dd.MM', { locale: pl });
  }
  const sameYear = from.getFullYear() === to.getFullYear();
  const sameMonth = sameYear && from.getMonth() === to.getMonth();
  if (sameMonth) {
    return `${format(from, 'dd', { locale: pl })}–${format(to, 'dd.MM', { locale: pl })}`;
  }
  if (sameYear) {
    return `${format(from, 'dd.MM', { locale: pl })}–${format(to, 'dd.MM', { locale: pl })}`;
  }
  return `${format(from, 'dd.MM.yyyy', { locale: pl })}–${format(to, 'dd.MM.yyyy', { locale: pl })}`;
}

/**
 * Czy zakres obejmuje jeden dzień (dateFrom === dateTo, obie daty poprawne).
 * Pozwala dobrać poprawny polski przyimek: „w dniu" (jeden dzień) vs
 * „w dniach" (zakres). Niepoprawne daty => false.
 */
export function isSameDayRange(dateFrom: DateStr, dateTo: DateStr): boolean {
  if (!isValidDateStr(dateFrom) || !isValidDateStr(dateTo)) return false;
  return dateFrom === dateTo;
}

/** Dziennik zmian — NAJNOWSZY WPIS NA GÓRZE. */
export const CHANGELOG: ChangelogEntry[] = [
  {
    id: '2026-07-20-fixy-224-238',
    dateFrom: '2026-07-20',
    dateTo: '2026-07-21',
    summary: 'Duża porcja usprawnień w projektach, zadaniach, kalendarzu i zespole.',
    items: [
      // Ogólne / formularze
      {
        area: 'Ogólne',
        feature: 'Bezpieczniejsze pola liczbowe',
        description:
          'Pola z liczbami (np. godziny) nie zmieniają już przypadkowo wartości, gdy przewijasz stronę kółkiem myszy nad takim polem.',
      },
      {
        area: 'Ogólne',
        feature: 'Dzień tygodnia obok dat',
        description:
          'Przy datach w aplikacji widać teraz od razu dzień tygodnia, więc łatwiej ocenić, czy termin wypada np. w weekend.',
      },
      {
        area: 'Ogólne',
        feature: 'Pola wymagane wyraźnie oznaczone',
        description:
          'W formularzach widać, które pola trzeba wypełnić, a aplikacja przypomni o brakach, zanim spróbujesz zapisać.',
      },
      {
        area: 'Ogólne',
        feature: 'Drobne poprawki i domknięcia',
        description:
          'Zebraliśmy i domknęliśmy szereg drobnych usterek z powyższej serii, żeby całość działała spójniej i pewniej.',
      },
      // Klienci
      {
        area: 'Klienci',
        feature: 'Prostsze dodawanie klienta',
        description:
          'Usunęliśmy mylące pole wpisywane „w locie" — dodawanie nowego klienta jest teraz jaśniejsze i mniej pomyłkowe.',
      },
      // Projekty
      {
        area: 'Projekty',
        feature: 'Ręczna kolejność zadań w projekcie',
        description:
          'Możesz sam ustawić kolejność zadań w projekcie i przeciągnąć je tak, jak chcesz je widzieć.',
      },
      {
        area: 'Projekty',
        feature: 'Dokumenty i linki przy projekcie',
        description:
          'Do projektu podepniesz teraz ważne dokumenty i linki, żeby wszystko potrzebne było w jednym miejscu.',
      },
      // Zadania
      {
        area: 'Zadania',
        feature: 'Widok tablicy (kanban)',
        description:
          'Na stronie Zadania dostępny jest widok tablicy z kolumnami statusów — łatwiej ogarnąć, co jest do zrobienia, w toku i gotowe.',
      },
      {
        area: 'Zadania',
        feature: 'Szacowany czas zadania',
        description:
          'Przy zadaniu podasz przewidywany czas jego wykonania, co pomaga planować pracę.',
      },
      {
        area: 'Zadania',
        feature: 'Szkice zadań i publikacja',
        description:
          'Zadanie możesz zapisać jako szkic i dopracować w spokoju, a potem opublikować, gdy jest gotowe dla zespołu.',
      },
      // Kalendarz
      {
        area: 'Kalendarz',
        feature: 'Linia bieżącej godziny',
        description:
          'W kalendarzu widać poziomą linię pokazującą aktualną godzinę, więc od razu wiesz, na czym stoisz w ciągu dnia.',
      },
      {
        area: 'Kalendarz',
        feature: 'Status zadania na blokach',
        description:
          'Bloki w kalendarzu pokazują status zadania, dzięki czemu bez otwierania widać, co jest gotowe, a co jeszcze nie.',
      },
      {
        area: 'Kalendarz',
        feature: 'Dodawanie zadania z menu kontekstowego',
        description:
          'Klikając prawym przyciskiem w kalendarzu, dodasz nowe zadanie od razu w wybranym miejscu i czasie.',
      },
      // Zgłoszenia
      {
        area: 'Zgłoszenia',
        feature: 'Panel Zgłoszeń',
        description:
          'Pojawił się panel do zgłaszania błędów i pomysłów — możesz szybko przekazać, co poprawić w aplikacji.',
      },
      // Zespół
      {
        area: 'Zespół',
        feature: 'Kontakty i urodziny',
        description:
          'W panelu Zespół znajdziesz dane kontaktowe współpracowników oraz przypomnienia o urodzinach.',
      },
      {
        area: 'Zespół',
        feature: 'Drzewko struktury zespołu',
        description:
          'Zobaczysz strukturę zespołu w formie przejrzystego drzewka — kto komu podlega i jak ułożone są działy.',
      },
      // Panel
      {
        area: 'Panel',
        feature: 'Płynne odświeżanie danych',
        description:
          'Dane odświeżają się na bieżąco płynnie, bez irytującego migotania ekranu.',
      },
    ],
  },
];
