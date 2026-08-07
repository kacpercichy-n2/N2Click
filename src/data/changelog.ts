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
 * Ile wpisów jest NOWSZYCH niż ostatnio potwierdzony (`seenId`) — licznik na
 * przycisku „Changelog" (jedyne wejście do dziennika; dawna belka „Nowości"
 * dublowała tę informację i została usunięta 2026-08-06). Liczymy wpisy od
 * początku tablicy (najnowsze) do pierwszego wystąpienia `seenId`. Brak
 * `seenId` albo id spoza dziennika (np. po usunięciu wpisu) => wszystko jest
 * nieprzeczytane; pusty dziennik => 0.
 */
export function changelogUnreadCount(
  entries: readonly ChangelogEntry[],
  seenId: string | undefined,
): number {
  const seenAt = seenId ? entries.findIndex((entry) => entry.id === seenId) : -1;
  return seenAt === -1 ? entries.length : seenAt;
}

/** Dziennik zmian — NAJNOWSZY WPIS NA GÓRZE. */
export const CHANGELOG: ChangelogEntry[] = [
  {
    id: '2026-08-07-godziny-sortowanie-szlif',
    dateFrom: '2026-08-07',
    dateTo: '2026-08-07',
    summary:
      'Spotkania i zadania cykliczne liczą się do godzin w kalendarzu, listy zadań i projektów mają sortowanie, a drobne elementy interfejsu zostały wyrównane.',
    items: [
      {
        area: 'Kalendarz',
        feature: 'Spotkania i cykliczne w sumie godzin',
        description:
          'Suma godzin nad każdym dniem (i w komórkach widoku miesiąca) obejmuje teraz także spotkania oraz zadania cykliczne — liczone per osoba. Urlopy celowo nie wchodzą do sumy, bo nieobecność to nie praca.',
      },
      {
        area: 'Kalendarz',
        feature: 'Status „gotowe” = zielone ptaszki',
        description:
          'Zadanie ze statusem „gotowe” — także utworzone od razu jako gotowe — pokazuje zielony ✓ na wszystkich swoich blokach w kalendarzu i zasobniku, bez ręcznego odhaczania. Odhaczanie pojedynczych bloków działa jak dotąd przy statusach aktywnych.',
      },
      {
        area: 'Zadania',
        feature: 'Sortowanie listy',
        description:
          'Obok filtrów jest wybór „Sortuj": po dacie rozpoczęcia (jak dotąd), alfabetycznie po nazwie albo po dacie dodania. Wybór zapamiętuje się tak samo jak filtry.',
      },
      {
        area: 'Projekty',
        feature: 'Sortowanie w grupach klientów',
        description:
          'Projekty wewnątrz grupy klienta można ułożyć po nazwie, dacie rozpoczęcia albo dacie dodania. Kolejność samych klientów pozostaje alfabetyczna.',
      },
      {
        area: 'Panel',
        feature: 'Powiadomienia bez przeskoków',
        description:
          'Znacznik ✓ i kropka nieprzeczytania mają stałe miejsce w wierszu — oznaczenie powiadomienia jako przeczytane wyszarza je bez przesuwania treści. Sam ptaszek stoi teraz dokładnie na środku kółka.',
      },
      {
        area: 'Ogólne',
        feature: 'Wyrównany interfejs',
        description:
          'Rozwijane listy w całej aplikacji mają czytelną strzałkę z odstępem od krawędzi, wybór sortowania trzyma wysokość sąsiednich przycisków, a inicjały w awatarach siedzą w optycznym środku kółka.',
      },
    ],
  },
  {
    id: '2026-08-06-dzwonek-powiadomien-i-porzadki',
    dateFrom: '2026-08-06',
    dateTo: '2026-08-06',
    summary:
      'Dzwonek powiadomień w menu bocznym, kalendarz bez nakładających się kafelków i jedno wejście do dziennika zmian.',
    items: [
      {
        area: 'Ogólne',
        feature: 'Dzwonek powiadomień',
        description:
          'Obok przycisku zwijania menu jest dzwonek z licznikiem nieprzeczytanych powiadomień. Kliknięcie otwiera listę — a kliknięcie powiadomienia od razu otwiera zadanie lub projekt, którego dotyczy. Tak samo działa teraz kafelek Powiadomienia na Panelu.',
      },
      {
        area: 'Ogólne',
        feature: 'Nowe logo i ikona karty',
        description:
          'Logo N2Hub jest czysto typograficzne (bez kółka), a karta przeglądarki ma własną ikonę. Licznik na ikonie karty znika teraz poprawnie po przeczytaniu wszystkich powiadomień.',
      },
      {
        area: 'Kalendarz',
        feature: 'Nakładające się kafelki obok siebie',
        description:
          'Gdy spotkanie, zadanie cykliczne i zwykły blok wypadają w tym samym czasie, kolumna dnia dzieli się między nie — kafelki stoją obok siebie zamiast się przykrywać.',
      },
      {
        area: 'Panel',
        feature: 'Jedno wejście do dziennika zmian',
        description:
          'Belka „Nowości" pod powitaniem zniknęła — historię zmian otwiera wyłącznie przycisk Changelog w rogu Panelu, z licznikiem nowych wpisów.',
      },
      {
        area: 'Wydarzenia',
        feature: 'Kolizja terminu nie blokuje już spotkania',
        description:
          'Spotkanie z wybranymi osobami, które nachodzi na ich zadania lub inne wydarzenia, można teraz zapisać — aplikacja pokaże, z czym koliduje, i poprosi o potwierdzenie „Dodaj mimo kolizji". Twardo blokuje tylko czyjś urlop.',
      },
    ],
  },
  {
    id: '2026-08-05-szybkie-przeciaganie-bez-cofania',
    dateFrom: '2026-08-05',
    dateTo: '2026-08-05',
    summary:
      'Szybko przeciągane karty w kalendarzu nie odskakują już na poprzednie miejsce: odświeżanie danych w tle czeka, aż zmiana zdąży się zapisać.',
    items: [
      {
        area: 'Kalendarz',
        feature: 'Pewne upuszczanie przy szybkich ruchach',
        description:
          'Przy dynamicznym przerzucaniu kart ciche odświeżenie danych z serwera potrafiło wygrać wyścig z zapisem i odkładało kartę na stare miejsce. Teraz aplikacja tuż przed takim odświeżeniem sprawdza, czy nie trwa przeciąganie albo świeży zapis, i w razie potrzeby chwilę czeka. Karta zostaje tam, gdzie ją upuścisz, bez przytrzymywania jej nad celem.',
      },
    ],
  },
  {
    id: '2026-08-05-kafelki-krotkich-blokow',
    dateFrom: '2026-08-05',
    dateTo: '2026-08-05',
    summary:
      'Kafelki w kalendarzu są wierne czasowi: blok 15 minut jest naprawdę o połowę niższy od półgodzinnego, krótkie bloki dostały zwięzły układ treści, a znacznik wykonania jest drobniejszy i nie zasłania tekstu.',
    items: [
      {
        area: 'Kalendarz',
        feature: 'Wysokość kafelka wierna czasowi',
        description:
          'Blok 15-minutowy nie udaje już półgodzinnego — każdy kafelek ma wysokość dokładnie proporcjonalną do czasu trwania, więc dziury i bloki na siatce można porównywać na oko. Dotyczy też wystąpień cyklicznych i spotkań.',
      },
      {
        area: 'Kalendarz',
        feature: 'Zwięzły układ krótkich bloków',
        description:
          'Kafelek 15-minutowy mieści się w jednej linii (tytuł i godziny), a półgodzinny w dwóch: tytuł na całą szerokość, pod nim godziny razem z osobą i czasem trwania w jednym, wyrównanym wierszu. Odstęp między tytułem a godzinami jest taki sam na wszystkich blokach.',
      },
      {
        area: 'Kalendarz',
        feature: 'Drobniejszy znacznik wykonania',
        description:
          'Kółko „✓” na kafelku jest mniejsze i stoi z marginesem od krawędzi. Na krótkich blokach wysuwa się przy tytule (nie nad godzinami), a tytuł grzecznie skraca się wielokropkiem, żeby zrobić mu miejsce — nic już nie zasłania godzin ani czasu trwania.',
      },
      {
        area: 'Kalendarz',
        feature: 'Tytuły kończą się wielokropkiem',
        description:
          'Za długi tytuł zadania na kafelku kończy się teraz „…” zamiast ucinać się w pół litery.',
      },
    ],
  },
  {
    id: '2026-08-03-urlopy-cyklicznosc-powiadomienia',
    dateFrom: '2026-08-03',
    dateTo: '2026-08-03',
    summary:
      'Kalendarz zna urlopy: dodasz sobie urlop z zakresem dat, a w te dni nikt nie zaplanuje Ci pracy. Do tego cykliczność co 2–8 tygodni, powiadomienia odhaczane pojedynczo, szersze okna na dużych monitorach i poprawka prześwitującego nagłówka tabeli planowania.',
    items: [
      {
        area: 'Kalendarz',
        feature: 'Urlopy w kalendarzu',
        description:
          'Nowy rodzaj wydarzenia „Urlop” — dodajesz go sobie z zakresem od–do (także wielodniowy), a na kalendarzu pojawia się czerwony blok z palemką w Twoich godzinach pracy. W dni urlopu nie da się zaplanować pracy: przeciąganie bloków, „Zaplanuj część” i automatyczne rozmieszczanie są blokowane z komunikatem „Ta osoba ma w tym dniu urlop.”. W Obciążeniu, na profilu osoby i w nagłówku dnia zamiast wykrzyknika przeciążenia stoi wtedy palemka.',
      },
      {
        area: 'Kalendarz',
        feature: 'Powtarzanie co 2–8 tygodni',
        description:
          'Cykliczne zadania i wydarzenia mogą powtarzać się co kilka tygodni, nie tylko co tydzień. W edytorze cykliczności doszło pole „Powtarzaj” z wyborem 1–8 tygodni, a lista wydarzeń dopisuje np. „(co 2 tygodnie)” przy nazwie.',
      },
      {
        area: 'Panel',
        feature: 'Powiadomienia odhaczane pojedynczo',
        description:
          'Każde powiadomienie ma teraz własny znacznik „Oznacz jako przeczytane” — przeczytany wpis zostaje na liście wyszarzony zamiast znikać, a otwarcie zadania lub komentarza z podglądu odhacza tylko ten jeden wpis. Licznik na kafelku i cyferka na karcie przeglądarki pokazują odtąd to samo: wyłącznie nieprzeczytane. Zbiorcze „Oznacz jako przeczytane” działa jak dotąd.',
      },
      {
        area: 'Ogólne',
        feature: 'Okna lepiej wykorzystują duże ekrany',
        description:
          'Karty zadania, wydarzenia, zgłoszenia i dziennika zmian rosną na szerokich monitorach zamiast stać wąską kolumną na środku, a pola opisu i dyskusji powiększają się razem z wpisywaną treścią. Na laptopach i telefonach wszystko wygląda dokładnie tak jak dotychczas.',
      },
      {
        area: 'Zadania',
        feature: 'Nagłówek tabeli planowania już nie prześwituje',
        description:
          'Przy przewijaniu siatki przydziału godzin w karcie zadania wiersze nie prześwitują już pod przyklejonym nagłówkiem — nagłówek dostał kryjące tło i wyraźną dolną krawędź.',
      },
    ],
  },
  {
    id: '2026-07-29-sortowanie-klient-w-zadaniu-odstepy',
    dateFrom: '2026-07-28',
    dateTo: '2026-07-29',
    summary:
      'Listy wyboru w całej aplikacji są posortowane alfabetycznie, w zadaniu można od razu wybrać klienta, a cała aplikacja dostała drobny lifting odstępów — plakietki, przyciski i tabele mają więcej powietrza. Do tego paczka poprawek z poniedziałku: duch przeciągania na Kanbanie, pełnoekranowa wyszukiwarka i żywe tło pod oknami.',
    items: [
      {
        area: 'Zespół',
        feature: 'Struktura zespołu jako schemat organizacyjny',
        description:
          'Zakładka „Struktura zespołu” otwiera się od razu na schemacie, a sam schemat wygląda jak firmowy org chart: karty ze zdjęciem lub inicjałami, ułożone kaskadowo i połączone liniami z przełożonym. Wiersz zależy od stanowiska — zarząd stoi po bokach tuż pod prezesem, menedżerowie rząd niżej, a specjaliści na dole, nawet jeśli raportują wprost do zarządu (ich podległość rysuje wtedy linia poprowadzona bokiem). Główna księgowa stoi obok kaskady, bo nie jest częścią linii decyzyjnej. Lista działów została jako drugi widok pod przyciskiem „Lista”.',
      },
      {
        area: 'Ogólne',
        feature: 'Listy wyboru posortowane A–Z',
        description:
          'Wszystkie rozwijane listy klientów, projektów i osób (filtry, formularze, karta zadania) są teraz posortowane alfabetycznie — z poprawną kolejnością polskich znaków (Ł, Ś, Ż…). Koniec szukania klienta w losowej kolejności.',
      },
      {
        area: 'Zadania',
        feature: 'Wybór klienta w karcie zadania',
        description:
          'Karta zadania ma nowe pole „Klient” przed polem „Projekt”. Wybór klienta zawęża listę projektów tylko do jego projektów, więc przypisanie zadania — także przeniesienie go do innego klienta — to dwa kliknięcia zamiast szukania po wszystkich projektach.',
      },
      {
        area: 'Ogólne',
        feature: 'Więcej powietrza w całej aplikacji',
        description:
          'Po audycie odstępów wyrównaliśmy je do wspólnej siatki: plakietki statusu i priorytetu, przyciski drugorzędne, pole wyszukiwania, wiersze list na Panelu, chipy filtrów i tabele godzin (Obciążenie, przydział w zadaniu) nie są już ściśnięte. Aplikacja wygląda spójniej i lżej.',
      },
      {
        area: 'Kanban',
        feature: 'Karta widocznie „leci” z kursorem',
        description:
          'Podczas przeciągania karty na tablicy znów widać jej ducha podążającego za kursorem lub palcem — wcześniej karta tylko blakła w miejscu i łatwo było zgubić, co się właściwie przenosi.',
      },
      {
        area: 'Wyszukiwarka',
        feature: 'Wyszukiwarka na pełnym ekranie',
        description:
          'Paleta wyszukiwania (Ctrl+K) otwiera się nad całą aplikacją. Wcześniej przez usterkę potrafiła przyciąć się do lewego panelu bocznego.',
      },
      {
        area: 'Zadania',
        feature: 'Karta zadania otwiera się od początku',
        description:
          'Okno zadania zawsze startuje przewinięte na górę — nagłówek i zakładki są od razu widoczne, bez ręcznego przewijania w górę po otwarciu.',
      },
      {
        area: 'Kalendarz',
        feature: 'Czytelniejszy pasek sterowania',
        description:
          'Plakietka z datą i zegarem nie odjeżdża już na prawy skraj paska, a znacznik ukończenia ✓ na kafelku dnia stoi we właściwym miejscu.',
      },
      {
        area: 'Konto',
        feature: 'Awatary z emoji wróciły',
        description:
          'Profil znów pokazuje wybraną emotkę jako awatar, a w formularzu profilu można ją ustawić. Inicjały pozostają automatycznym zastępnikiem.',
      },
      {
        area: 'Ogólne',
        feature: 'Żywe tło pod oknami i przywrócona stopka menu',
        description:
          'Okna (dziennik zmian, szybkie dodawanie) mają z powrotem żywe, przyciemnione tło zamiast „zamrożonego” zrzutu ekranu, a na dole menu bocznego znów stoją obok siebie „Zgłoszenia” i przycisk pomocy.',
      },
    ],
  },
  {
    id: '2026-07-28-wielka-paczka-ux-mobile-wydajnosc',
    dateFrom: '2026-07-27',
    dateTo: '2026-07-28',
    summary:
      'Największa paczka zmian do tej pory: aplikacja działa wygodnie na telefonie, kalendarz nie gubi już planu przy przewijaniu palcem, zadania cykliczne można odhaczać pojedynczo, modal zadania ma nowy przejrzysty układ, a całość ładuje się wyraźnie szybciej.',
    items: [
      {
        area: 'Kalendarz',
        feature: 'Koniec przypadkowego przesuwania bloków palcem',
        description:
          'Na telefonie i tablecie przewijanie kalendarza palcem po bloku pracy już go nie przesuwa. Żeby przeciągnąć blok, przytrzymaj go chwilę (ok. pół sekundy) — dopiero wtedy „odklei się” i pojedzie z palcem. Zwykłe dotknięcie normalnie otwiera zadanie.',
      },
      {
        area: 'Kalendarz',
        feature: 'Widok godzin roboczych 9–17',
        description:
          'Kalendarz otwiera się wycentrowany na godzinach pracy — sloty przed 9 i po 17 są przygaszone, ale nadal w pełni działają. Zegar przeniósł się z rogu siatki na pasek sterowania, a trzy rzędy kontrolek scaliły się w jeden — siatka jest przez to wyraźnie wyższa.',
      },
      {
        area: 'Kalendarz',
        feature: 'Odhaczanie pojedynczego wystąpienia zadania cyklicznego',
        description:
          'W menu wystąpienia zadania cyklicznego znajdziesz teraz osobno „Oznacz to wystąpienie jako zrobione” i „Oznacz całą serię”. Odhaczone wystąpienie dostaje ✓ na kaflu, a reszta serii zostaje bez zmian.',
      },
      {
        area: 'Kalendarz',
        feature: 'Odhaczanie bloku wprost z kafla i obsługa klawiaturą',
        description:
          'Blok pracy odhaczysz jednym kliknięciem ✓ bez otwierania zadania. Bloki można też przesuwać klawiaturą: strzałki zmieniają godzinę i dzień, Enter zatwierdza, Escape cofa — z komunikatami o kolizjach.',
      },
      {
        area: 'Zadania',
        feature: 'Nowy układ okna zadania',
        description:
          'Okno zadania podzielone jest na zakładki Zadanie | Planowanie | Dyskusja, z przyklejonym u góry tytułem i statusem. Okres zadania jest teraz NAD siatką godzin (bo to on decyduje, które dni widać), pole komentarza jest nad wątkiem, a rzadko używane sekcje (Cykliczność, Klasyfikacja) są zwinięte. Każde zadanie ma też pełną stronę pod własnym adresem — link „Otwórz pełny widok ↗”.',
      },
      {
        area: 'Zadania',
        feature: 'Wygodniejsza siatka godzin',
        description:
          'Ciągi pustych dni w siatce zwijają się do jednej linii („14 pustych dni — pokaż”), zera pokazują się jako „—”, a „Wyczyść kolumnę” ma przycisk „Cofnij”. Enter w polach formularza zapisuje zadanie, a zablokowany zapis tłumaczy się listą klikalnych powodów i wskazuje pierwsze błędne pole.',
      },
      {
        area: 'Zadania',
        feature: '@-wzmianki w komentarzach i planowanie z godziną startu',
        description:
          'W komentarzach napisz „@”, aby podpowiedziała się lista osób (działa też bez polskich znaków). Planując pracę z zakładki Zadania, możesz opcjonalnie wpisać godzinę startu — puste pole działa jak dotąd, automatycznie.',
      },
      {
        area: 'Zadania',
        feature: 'Czytelniejsze listy zadań',
        description:
          'Wiersz zadania ma teraz maksymalnie dwa kolorowe akcenty: priorytet to dyskretny pasek przy krawędzi (tylko Pilny/Wysoki), stan rozplanowania to cienki pasek postępu, checklista to „◍◍◌ 2/3”, a klient i projekt są wszędzie zapisane jednolicie jako „Klient › Projekt”.',
      },
      {
        area: 'Kanban',
        feature: 'Kanban na dotyku i klawiaturze',
        description:
          'Karty Kanbanu przeciągniesz palcem (przytrzymaj chwilę, żeby podnieść) albo przeniesiesz bez myszy: Spacja podnosi kartę, strzałki wybierają kolumnę, Enter upuszcza. Jest też menu „Przenieś do statusu →” dla pojedynczego kliknięcia.',
      },
      {
        area: 'Panel',
        feature: 'Podgląd powiadomienia zamiast edytora',
        description:
          'Klik w powiadomienie na Panelu rozwija podgląd „Kto / Co / Gdzie” zamiast od razu otwierać okno edycji — do zadania przejdziesz jawnym przyciskiem „Otwórz zadanie”.',
      },
      {
        area: 'Panel',
        feature: 'Porządek na Panelu',
        description:
          'Puste kafle (np. „Alerty — czysto ✓”) zwijają się do wąskich belek, a odzyskane miejsce dostają „Zadania na dziś” i „Twój tydzień”. Pasek nowości to jedna cicha linia, która znika po przeczytaniu. Zasobnik podpowiada konkretny przycisk „Zaplanuj 2h — nazwa zadania →”.',
      },
      {
        area: 'Obciążenie',
        feature: 'Szczegóły dnia w dymku',
        description:
          'Klik w komórkę dnia otwiera dymek z listą bloków („8:00–14:00 — nazwa”), akcjami (przypisz innej osobie, przesuń ±1 dzień) i przyciskiem „Otwórz w kalendarzu”. Kolor paska % ma teraz logiczną skalę, a przekroczenie dostępności to osobna ikona ⚠ przy nazwisku.',
      },
      {
        area: 'Wyszukiwarka',
        feature: 'Szybkie akcje i ostatnio otwarte',
        description:
          'Paleta (Ctrl/Cmd+K) obsługuje „Szybkie akcje” (wpisz „>”, np. Nowe zadanie), pokazuje ostatnio otwarte przy pustym polu, podświetla dopasowania (również bez polskich znaków — „zolty” trafi „Żółty”) i doładowuje więcej wyników bez zamykania.',
      },
      {
        area: 'Telefon',
        feature: 'Nowa nawigacja i kalendarz dzienny',
        description:
          'Na telefonie aplikacja ma dolny pasek pięciu zakładek (Panel · Kalendarz · Zadania · Zasobnik · Więcej) zamiast menu-hamburgera. Kalendarz pokazuje jeden dzień z paskiem 7 dat u góry, a zasobnik jest arkuszem wysuwanym od dołu, który sam się uchyla podczas przeciągania.',
      },
      {
        area: 'Telefon',
        feature: 'Formularze i Panel skrojone pod ekran telefonu',
        description:
          'Siatka godzin w zadaniu to na telefonie lista dni z przyciskami −/+ (co 15 min) — koniec przewijania na boki. Okno unika klawiatury ekranowej, pola nie powodują przybliżania ekranu na iPhonie, a Panel układa się w priorytetowy stos: najpierw zadania na dziś, potem alerty i zasobnik.',
      },
      {
        area: 'Ogólne',
        feature: 'Bezpieczniejsze potwierdzenia',
        description:
          'Zamiast surowych okienek przeglądarki pytania „czy na pewno?” pokazują teraz realne skutki z liczbami (np. „To usunie 3 przypisania i 12 zaplanowanych godzin”), a najgroźniejsze operacje wymagają dodatkowego zaznaczenia świadomej zgody.',
      },
      {
        area: 'Ogólne',
        feature: 'Status zapisu zawsze widoczny',
        description:
          'Wskaźnik zapisu ma trzy czytelne stany: „• Niezapisane” → „Zapisywanie…” → „✓ Zapisano 20:51” i nie znika po chwili. Kliknięcie tła nie zamyka już okien z formularzem, więc nie stracisz wpisanych zmian.',
      },
      {
        area: 'Ogólne',
        feature: 'Aplikacja ładuje się szybciej',
        description:
          'Pierwsze wejście pobiera o dwie trzecie mniej kodu (ekrany doładowują się w tle w miarę potrzeby), a czcionki są serwowane z naszej domeny zamiast z Google — szybszy start i żadnych zapytań do zewnętrznych serwerów.',
      },
      {
        area: 'Ogólne',
        feature: 'Licznik nieprzeczytanych na karcie przeglądarki',
        description:
          'Liczba nieprzeczytanych powiadomień jest widoczna w tytule karty przeglądarki — wystarczy zerknąć na pasek kart, żeby wiedzieć, czy coś czeka.',
      },
      {
        area: 'Ogólne',
        feature: 'Dostępność i spójne teksty',
        description:
          'Wszystkie dymki podpowiedzi, okna i menu działają z klawiatury i czytników ekranu, przygaszone teksty mają wyższy kontrast, preferencja „ogranicz animacje” naprawdę wyłącza animacje, daty mają wszędzie te same formaty, a liczniki poprawną polską odmianę („1 z 2 projektów”).',
      },
    ],
  },
  {
    id: '2026-07-23-powiadomienia-kalendarz-filtry',
    dateFrom: '2026-07-23',
    dateTo: '2026-07-23',
    summary:
      'Powiadomienia w aplikacji (z opcją kopii na maila), naprawione planowanie zadań w kilku blokach, spokojniejszy kalendarz i ekran bez wyskakującego banera, posortowane projekty i odchudzona belka filtrów.',
    items: [
      {
        area: 'Panel',
        feature: 'Powiadomienia w aplikacji',
        description:
          'Karta „Powiadomienia” na Panelu w końcu działa: dostaniesz znać, gdy ktoś przypisze Ci zadanie, doda komentarz w Twoim projekcie albo wrzuci pracę do Twojego zasobnika. Widzisz maksymalnie 3 najnowsze nieprzeczytane, a każde możesz odhaczyć pojedynczo lub wszystkie naraz.',
      },
      {
        area: 'Panel',
        feature: 'Kopia powiadomień na maila (opcjonalnie)',
        description:
          'W swoim profilu możesz włączyć „Powiadomienia mailowe” — wtedy zbiorczy mail z nowymi powiadomieniami przyjdzie też na Twoją skrzynkę. Domyślnie ta opcja jest wyłączona, więc nikt nie dostaje maili bez własnej zgody.',
      },
      {
        area: 'Kalendarz',
        feature: 'To samo zadanie w kilku blokach jednego dnia',
        description:
          'Możesz rozplanować jedno zadanie na dwa osobne bloki (np. przed i po spotkaniu) — system nie sklei ich już samoczynnie w jeden długi blok nachodzący na spotkanie. Łączenie bloków działa tylko wtedy, gdy sam upuścisz je dokładnie na styk i nie zasłoni to żadnego wydarzenia.',
      },
      {
        area: 'Kalendarz',
        feature: 'Lepsza podpowiedź godziny przy „Zaplanuj część”',
        description:
          'Planując kolejną część zadania, dostaniesz sensowną propozycję startu (np. kwadrans po istniejącym bloku) zamiast północy.',
      },
      {
        area: 'Kalendarz',
        feature: 'Zadania cykliczne bez migotania',
        description:
          'Wystąpienia zadań cyklicznych są stabilne — nie znikają i nie pojawiają się ponownie podczas odświeżania danych w tle.',
      },
      {
        area: 'Ogólne',
        feature: 'Koniec wyskakującego niebieskiego banera',
        description:
          'Pasek o odświeżaniu danych nie pojawia się już co pół minuty przy normalnej pracy. Zobaczysz go tylko wtedy, gdy połączenie na żywo faktycznie padnie i dane mogą być nieaktualne.',
      },
      {
        area: 'Projekty',
        feature: 'Lista projektów posortowana po kliencie',
        description:
          'Projekty na liście są ułożone alfabetycznie według nazwy klienta, a w obrębie klienta — według nazwy projektu. Koniec szukania po „losowej” kolejności.',
      },
      {
        area: 'Filtry',
        feature: 'Wybór osób schowany w panelu „Filtry”',
        description:
          'Przyciski z osobami nie zajmują już całej belki nad listami. Osoby wybierasz w panelu „Filtry”, a na belce zostają tylko chipy aktualnie wybranych (z możliwością szybkiego zdjęcia) i licznik na przycisku.',
      },
    ],
  },
  {
    id: '2026-07-22-role-spolki-i-porzadki',
    dateFrom: '2026-07-22',
    dateTo: '2026-07-22',
    summary:
      'Wielka aktualizacja: pełne uprawnienia dla każdego, spółki przy projektach, nowy Panel-kokpit, czytelniejsze karty projektów i profili, rozwijane karty klientów, precyzyjne przeciąganie w kalendarzu i wyraźnie szybsza aplikacja.',
    items: [
      // Uprawnienia / zespół
      {
        area: 'Zespół',
        feature: 'Każdy może planować i widzi wszystko',
        description:
          'Koniec podziału na role PM / handlowiec / pracownik. Teraz każda osoba w firmie może tworzyć i edytować projekty, zadania i wydarzenia oraz widzi cały zespół i dostępność wszystkich — także z innych działów. To, co widzisz na listach, zawężasz filtrami, a nie uprawnieniami. Pole „Uprawnienia” zniknęło z profili (wszyscy mają pełne).',
      },
      {
        area: 'Zespół',
        feature: 'Profil osoby w jednym widoku, edycja od razu',
        description:
          'Strona profilu nie ma już osobnego trybu „Edytuj profil” — dane podstawowe (zdjęcie, imię, stanowisko, dział, spółka) są w pierwszej karcie, a każde pole zmieniasz bezpośrednio na stronie. Zdjęcie podmienisz małym ołówkiem na awatarze.',
      },
      {
        area: 'Zespół',
        feature: 'Nowe stanowisko, dział lub spółka prosto z profilu',
        description:
          'W listach „Stanowisko”, „Dział” i „Spółka” w profilu osoby jest opcja „+ Nowe…” — otwiera małe okno, w którym wpisujesz nazwę, a nowy wpis od razu zostaje wybrany. Nie trzeba chodzić do Ustawień.',
      },
      {
        area: 'Zespół',
        feature: 'Koniec funkcji „Występuj jako”',
        description:
          'Podszywanie się pod innego użytkownika zostało usunięte — każdy pracuje na własnym koncie, a awatar w stopce menu prowadzi do Twojego profilu.',
      },
      // Projekty / spółki
      {
        area: 'Projekty',
        feature: 'Spółka wykonawcza projektu',
        description:
          'W karcie projektu wybierzesz, która spółka go realizuje. Na listach Projekty, Zadania i Kanban jest filtr „Spółka” — domyślnie ustawiony na Twoją spółkę, więc widzisz przede wszystkim swoje tematy, ale jednym kliknięciem możesz zobaczyć projekty pozostałych spółek. Projekt bez przypisanej spółki jest widoczny dla wszystkich.',
      },
      {
        area: 'Projekty',
        feature: 'Czytelniejsza karta projektu',
        description:
          'Zadania są zaraz pod szczegółami, pole opisu jest dwa razy większe, sekcja „Dyskusja” wyraźnie wyróżniona, a na liście projektów nazwa klienta stała się widoczną etykietą. Sekcja „Kamienie milowe” zniknęła z karty (daty nadal widać na osi czasu).',
      },
      // Panel
      {
        area: 'Panel',
        feature: 'Panel-kokpit i pożegnanie „Mojej pracy”',
        description:
          'Strona główna to teraz uporządkowany kokpit z kaflami: powiadomienia, obciążenie, zadania na dziś, zespół i Twój tydzień. Wszystko z dawnej zakładki „Moja praca” (nierozplanowane godziny, alerty) też jest na Panelu — osobna zakładka zniknęła, a stare linki dalej działają.',
      },
      // Filtry
      {
        area: 'Filtry',
        feature: 'Jeden wspólny pasek filtrów',
        description:
          'Na Projektach, Zadaniach i Kanbanie filtry, zapisane zestawy i licznik wyników są zebrane w jednym pasku nad listą — wszędzie wyglądają i działają tak samo.',
      },
      // Klienci
      {
        area: 'Klienci',
        feature: 'Rozwijane karty i wiele osób kontaktowych',
        description:
          'Karta klienta pokazuje na skróconej wersji nazwę i głównego kontakta, a po rozwinięciu opis i dodatkowe osoby kontaktowe — możesz ich dopisać dowolnie wiele (imię, nazwisko, telefon, e-mail). Nowy klient wymaga teraz kompletu danych kontaktowych.',
      },
      // Kalendarz
      {
        area: 'Kalendarz',
        feature: 'Precyzyjne przeciąganie bloków',
        description:
          'Przeciągany blok ląduje dokładnie tam, gdzie pokazuje podgląd, przyciąga się do pełnych kwadransów, a przy kolizji z innym blokiem podgląd robi się czerwony. Blok nie znika już przy przenoszeniu do zasobnika.',
      },
      // Oś czasu
      {
        area: 'Oś czasu',
        feature: 'Powiększenie: tydzień, dwa tygodnie, miesiąc',
        description:
          'Zamiast zakładek zakresu są przyciski Powiększ/Pomniejsz (trzy poziomy), strzałki do przewijania i „Dzisiaj”, a filtry (klient, projekt, osoby) mieszczą się w jednym panelu „Filtry”.',
      },
      // Wydarzenia
      {
        area: 'Wydarzenia',
        feature: 'Dopracowane okno wydarzenia',
        description:
          'Pola godzin „Początek” i „Koniec” wyglądają jak reszta formularza, a uczestników wybiera się czytelnymi „pigułkami” z kolorami osób — jak w karcie zadania.',
      },
      // Zadania
      {
        area: 'Zadania',
        feature: 'Spójne ikony i lepszy układ karty zadania',
        description:
          'Przyciski ikonowe na kafelkach zadań (usuń, dodaj, płatność) są równe i wyśrodkowane, a w karcie zadania sekcje „Przypisane osoby” i „Dzienny przydział godzin” przeniosły się wyżej — bliżej tego, czego szukasz najczęściej.',
      },
      // Ustawienia
      {
        area: 'Ustawienia',
        feature: 'Własna kolejność menu bocznego',
        description:
          'W Ustawieniach (sekcja „Kolejność menu”) ustawisz strzałkami własną kolejność pozycji w menu bocznym — każdy użytkownik na swoim komputerze widzi menu tak, jak lubi.',
      },
      // Zgłoszenia
      {
        area: 'Zgłoszenia',
        feature: 'Wykonane zgłoszenia świecą się na zielono',
        description:
          'Zgłoszenia oznaczone jako „zrobione” mają na liście zielone tło i zielony tytuł — od razu widać, co już załatwione, a filtr statusu pozwala je schować.',
      },
      // Ogólne / wydajność
      {
        area: 'Ogólne',
        feature: 'Aplikacja działa szybciej',
        description:
          'Trzy porcje optymalizacji: zapisywanie danych nie spowalnia już pracy (zapis raz na sekundę zamiast przy każdej zmianie), kalendarz tygodniowy jest płynniejszy przy przeciąganiu, a wyszukiwarka i karta zadania reagują szybciej przy pisaniu.',
      },
    ],
  },
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
