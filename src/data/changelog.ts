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
    id: '2026-07-21-funkcje-239-247',
    dateFrom: '2026-07-21',
    dateTo: '2026-07-21',
    summary:
      'Duża aktualizacja: wydarzenia i spotkania, zadania cykliczne, odhaczanie bloków w kalendarzu, lepsze szkice, trwałe filtry, stanowiska i spółki.',
    items: [
      // Wydarzenia — zupełnie nowy panel
      {
        area: 'Wydarzenia',
        feature: 'Nowy panel „Wydarzenia” — spotkania w firmie',
        description:
          'W menu bocznym pojawiła się nowa pozycja „Wydarzenia”. To lista wszystkich spotkań i wydarzeń firmowych: każde ma nazwę, opis, miejsce, link do spotkania (np. Meet/Zoom), datę, godzinę rozpoczęcia, czas trwania i listę uczestników z zespołu. Kliknięcie wydarzenia otwiera okno edycji.',
      },
      {
        area: 'Wydarzenia',
        feature: 'Dodawanie spotkania prosto z kalendarza',
        description:
          'W Kalendarzu kliknij prawym przyciskiem na wolnym miejscu w wybranym dniu i godzinie i wybierz „+ Dodaj spotkanie” — otworzy się okno nowego wydarzenia z już ustawioną datą i godziną.',
      },
      {
        area: 'Wydarzenia',
        feature: 'Wydarzenia widoczne w kalendarzu',
        description:
          'Spotkania pokazują się w widoku tygodnia jako bloki w osobnym, niebieskim kolorze (innym niż bloki zadań), a w widoku miesiąca jako znacznik przy dniu — od razu widać, kiedy coś jest zaplanowane. Wydarzenia mogą też się powtarzać co tydzień w wybrane dni.',
      },
      // Kalendarz
      {
        area: 'Kalendarz',
        feature: 'Zadania cykliczne (powtarzające się)',
        description:
          'W karcie zadania jest nowa sekcja „Cykliczność”: wybierasz dni tygodnia, godzinę rozpoczęcia, czas trwania i opcjonalnie datę końca. Powtórzenia pokazują się w kalendarzu jako kreskowane bloki ze znaczkiem ⟳. Prawym przyciskiem na takim bloku wybierzesz „Edytuj to wystąpienie” (przesunięcie tylko tego dnia), „Edytuj wszystkie” albo „Pomiń ten dzień”.',
      },
      {
        area: 'Kalendarz',
        feature: 'Odhaczanie pojedynczych bloków pracy',
        description:
          'Każdy blok w kalendarzu można teraz osobno oznaczyć jako wykonany — zrobiony blok dostaje znaczek ✓. Najszybciej zrobisz to prosto z kalendarza: kliknij blok prawym przyciskiem i wybierz „Oznacz jako wykonane” (albo „Odznacz”, jeśli się pomylisz). Oprócz tego w karcie zadania jest nowa sekcja „Wykonane bloki” z listą wszystkich bloków (osoba, dzień, godziny) i checkboxami. Gdy całe zadanie ma status „zrobione”, wszystkie jego bloki świecą się jako wykonane tak jak dotąd.',
      },
      // Zadania / szkice
      {
        area: 'Zadania',
        feature: 'Godziny można wpisać już przy szkicu',
        description:
          'W szkicu zadania widać sekcję „Przypisane osoby” i można od razu wpisać planowane godziny dla każdej osoby. Godziny zapisują się razem ze szkicem, a przy publikacji automatycznie zamieniają się w normalne pozycje do zaplanowania w kalendarzu.',
      },
      {
        area: 'Zadania',
        feature: 'Podgląd dostępności przypisanych osób',
        description:
          'W karcie zadania, pod sumą godzin, widać dla każdej przypisanej osoby, ile ma wolnych, a ile zajętych godzin w okresie zadania — z wyraźnym ostrzeżeniem, jeśli byłaby przeciążona. Dzięki temu jeszcze przed zapisem wiadomo, czy ktoś ma miejsce na tę pracę.',
      },
      {
        area: 'Zadania',
        feature: 'Publikacja szkicu prosto z karty zadania',
        description:
          'W pasku na dole karty szkicu są teraz osobne przyciski: „Zapisz szkic” i „Opublikuj” (dla nowego szkicu: „Utwórz szkic” i „Utwórz i opublikuj”). Nie trzeba już wracać do strony projektu, żeby opublikować pojedyncze zadanie.',
      },
      // Filtry
      {
        area: 'Filtry',
        feature: 'Filtr po projekcie i osobie w kolejnych widokach',
        description:
          'Na stronach Zadania i Kanban doszedł filtr „Projekt”, a na stronie Projekty filtr „Osoba”. Kanban obsługuje też zapisane zestawy filtrów, tak jak pozostałe widoki.',
      },
      {
        area: 'Filtry',
        feature: 'Aplikacja pamięta ostatnio użyte filtry',
        description:
          'Ustawione filtry w widokach Zadania, Projekty, Kanban, Obciążenie, Kalendarz i Oś czasu nie znikają już przy przejściu na inną stronę ani po odświeżeniu — po powrocie zastaniesz je dokładnie tak, jak je zostawiłeś.',
      },
      // Moja praca
      {
        area: 'Moja praca',
        feature: 'Karta „Dzisiaj” bez zadań z innych dni',
        description:
          'Zadania bez zaplanowanych godzin pokazują się w „Dzisiaj” tylko w dniu swojego terminu, a nie każdego dnia trwania — lista naprawdę pokazuje to, co jest na dziś.',
      },
      // Ustawienia
      {
        area: 'Ustawienia',
        feature: 'Słownik stanowisk',
        description:
          'W Ustawieniach (obok „Działów”) jest nowa sekcja „Stanowiska”: administrator dodaje, zmienia i usuwa nazwy stanowisk. W profilu osoby pole „Stanowisko” to teraz lista rozwijana z tego słownika, więc nazwy są spójne w całej firmie.',
      },
      {
        area: 'Ustawienia',
        feature: 'Spółki i zawężanie widoczności',
        description:
          'Nowa sekcja „Spółki” w Ustawieniach: administrator tworzy spółki i przypisuje do nich osoby w ich profilach. Osoba przypisana do spółki widzi projekty tylko swojej spółki; osoby bez spółki i administratorzy widzą wszystko jak dotąd.',
      },
      // Panel / ogólne
      {
        area: 'Panel',
        feature: 'Pełna historia zmian',
        description:
          'W banerze „Co nowego” na Panelu obok „Czytaj całość” jest link „Zobacz pełną historię” — otwiera stronę ze wszystkimi dotychczasowymi wpisami dziennika zmian, od najnowszego.',
      },
      {
        area: 'Ogólne',
        feature: 'Pasek „Zapisz” już nie prześwituje',
        description:
          'Dolny, przyklejony pasek z przyciskami zapisu w karcie zadania i na stronie projektu dostał solidne tło — przewijana treść nie przebija już spod przycisków.',
      },
    ],
  },
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
