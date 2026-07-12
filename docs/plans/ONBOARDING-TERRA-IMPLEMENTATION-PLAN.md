# N2Hub — plan wdrożenia onboardingu dla GPT-5.6 Terra

Status: gotowy do implementacji

Zakres: onboarding pierwszego logowania, samouczki kontekstowe i możliwość ponownego uruchomienia

Język interfejsu: wyłącznie polski

Docelowy stack: React 18, TypeScript, React Router, `motion/react`, plain CSS

## 0. Instrukcja wykonawcza dla modelu

GPT-5.6 Terra ma wdrożyć ten plan etapami, a nie reinterpretować go jako luźną sugestię.
Przed zmianami przeczytaj w całości `CLAUDE.md`, `src/App.tsx`,
`src/utils/uiPrefs.ts`, `src/store/permissions.ts` oraz pliki widoków wskazane niżej.

Najważniejsze ograniczenia:

1. Nie zmieniaj modelu domenowego, reducerów ani danych biznesowych tylko po to, aby obsłużyć onboarding.
2. Stan onboardingu jest preferencją urządzenia/użytkownika i ma pozostać w `src/utils/uiPrefs.ts`, poza `AppData` i `src/store/storage.ts`.
3. Nie zmieniaj matematyki ani lifecycle drag-and-drop kalendarza. W `WeekView` wolno dodać stabilne atrybuty `data-tour`, ale nie wolno przebudowywać obsługi pointerów, projekcji dnia, scrollbara, kolizji ani sprzątania ghosta.
4. Zachowaj obecny window-owned bin drag, synchroniczne refs, hit-testing po renderowanych kolumnach, invalid-target feedback i wszystkie scenariusze `scripts/browser-check-bin-drag.mjs`.
5. Onboarding nie może modyfikować projektów, zadań, godzin, statusów ani filtrów bez wyraźnej akcji użytkownika.
6. Nie ucz użytkownika funkcji, których jego rola nie może wykonać. Definicje kroków muszą być filtrowane przez `can(...)`.
7. Każdy tour musi dać się pominąć, zamknąć klawiszem Escape i uruchomić ponownie.
8. Nie wolno wymagać drag-and-drop do ukończenia samouczka. Gest można pokazać, ale musi istnieć opis alternatywy dostępnej bez precyzyjnego gestu.
9. Nie dodawaj ciężkiego frameworka UI ani biblioteki typu product-tour. Obecny stack wystarcza: portal, `getBoundingClientRect`, `ResizeObserver`, `MutationObserver` i `motion/react`.
10. Po każdym pakiecie uruchom typecheck i testy; przed zakończeniem także build oraz pełną macierz przeglądarkową.

## 1. Cel produktu i wynik dla użytkownika

N2Hub łączy strukturę `Klient → Projekt → Zadanie → Blok czasu` z planowaniem
zespołu. Onboarding ma doprowadzić nową osobę do czterech odpowiedzi:

- gdzie znajduje się jej własna praca,
- jak praca przechodzi od projektu i zadania do godzin w kalendarzu,
- jak rozpoznać brak planu, przekroczenie szacunku i przeciążenie pracownika,
- gdzie wrócić po pomoc bez resetowania danych.

Sukcesem nie jest „przeklikanie 40 dymków”. Sukcesem jest zrozumienie modelu
aplikacji i wykonanie pierwszej sensownej czynności właściwej dla roli.

## 2. Audyt istniejących widoków

| Widok | Faktyczne przeznaczenie | Najważniejsze pojęcia do wyjaśnienia |
| --- | --- | --- |
| Logowanie | Wybór lokalnej osoby i opcjonalne hasło | rola użytkownika, dostępne funkcje zależne od roli |
| Panel | Poranny skrót bieżącej osoby | zadania na dziś, obciążenie dziś/tydzień, pasek tygodnia; czat jest demonstracyjny |
| Moja praca | Osobisty pulpit pracownika | Dzisiaj, Zasobnik, po terminie, przeciążone dni, zadania bez planu |
| Projekty | Lista projektów grupowana po klientach | moneta płatności, status, okres, zaplanowane godziny, liczba osób i zadań, filtry/presety |
| Projekt | Edycja projektu i jego kontekst | dane projektu, płatność, kamienie milowe, zadania, dyskusja, status zapisu |
| Kanban | Lejek statusów projektów | kolumna = status, karta = projekt, przeciągnięcie zmienia status, archiwum nie jest celem dropu |
| Oś czasu | Daty projektów/zadań lub widok wg osób | szerokość paska = zakres dat, krawędzie zmieniają okres, diament = kamień milowy, konflikt = problem danego dnia |
| Zadania | Lista i stan planowania pracy | status zadania, status planowania, priorytet, kategoria, checklista, szacunek vs plan |
| Modal zadania | Główne miejsce konfiguracji zadania | szczegóły, okres, osoby, godziny bez terminu, dzienny przydział, dyskusja, zapis |
| Kalendarz tydzień | Dokładne godziny pracy | pion = pora dnia, wysokość bloku = długość pracy, blokada kolizji tej samej osoby, bin/zasobnik |
| Kalendarz miesiąc | Szybki obraz zajętości | intensywność = suma godzin, kropki = osoby, czerwone oznaczenie = przeciążenie |
| Zespół/profil | Dane, dostępność i rola osoby | capacity, dni robocze, godziny informacyjne, przełożony, uprawnienia, hasło |
| Obciążenie | Tygodniowa kontrola dostępności | komórka = godziny osoby w dniu, dostępne = capacity × dni robocze, pasek = procent, ⚠ = overwork |
| Administracja | Słowniki i logika lejka | statusy wspólne dla projektów/zadań, ukończenie niezależne od kolejności, archiwizacja vs usunięcie |
| Wyszukiwanie | Nawigacja do danych z dowolnego miejsca | projekty, zadania, osoby i klienci; skrót Ctrl/Cmd+K |

### Ważne rozróżnienia semantyczne

- Kalendarz: pionowe położenie oznacza godzinę rozpoczęcia, a wysokość bloku oznacza liczbę zaplanowanych godzin.
- Oś czasu: szerokość paska oznacza okres kalendarzowy projektu/zadania, nie liczbę roboczogodzin.
- Obciążenie: poziomy pasek oznacza procent wykorzystanej dostępności osoby.
- Czerwony/⚠ overwork jest ostrzeżeniem i nie blokuje planowania.
- Kolizja tej samej osoby w tym samym czasie blokuje wyłącznie drop/resize w kalendarzu.
- Zasobnik zawiera już przypisane godziny, ale jeszcze bez dnia i godziny w kalendarzu.
- „Bez planu” nie jest tym samym co „w zasobniku”: zadanie bez planu nie ma rozpisanych godzin, a zasobnik ma godziny bez daty.
- Moneta złota/brązowa oznacza odpowiednio projekt opłacony/nieopłacony; nie jest statusem realizacji.

## 3. Docelowy model onboardingu

Nie budować jednego długiego, liniowego touru. Zastosować cztery warstwy
progresywnego ujawniania informacji.

### Warstwa A — intro pierwszego logowania

Duży modal, maksymalnie trzy ekrany, bez kotwiczenia do DOM:

1. **„Witaj w N2Hub”** — „Połącz klientów, projekty, zadania i czas zespołu w jednym miejscu.”
2. **„Od zadania do kalendarza”** — prosty diagram tekstowo-ikonowy:
   `Klient → Projekt → Zadanie → Blok czasu`.
3. **„Widok dopasowany do Twojej roli”** — krótki opis roli i informacja, że
   samouczek można pominąć i uruchomić ponownie z „Pomoc i samouczki”.

Akcje: `Wstecz`, `Dalej`, `Pomiń`, a na końcu `Pokaż mi aplikację`.
Pominięcie nie może powodować automatycznego powrotu intro przy każdym reloadzie.

### Warstwa B — krótka orientacja w interfejsie

Po intro uruchomić 4–6 coachmarków na aktualnym widoku:

- nawigacja,
- globalne wyszukiwanie,
- główna powierzchnia startowa właściwa dla roli,
- wskaźniki obciążenia/alertów,
- przycisk `Pomoc i samouczki`.

To jedyna seria uruchamiana automatycznie. Nie prowadzić automatycznie przez
wszystkie route'y.

### Warstwa C — moduły kontekstowe

Przy pierwszej wizycie na złożonym widoku pokazać tylko małą, nieblokującą kartę:

> Pierwszy raz w Kalendarzu? Poznaj bloki czasu i Zasobnik w 2 minuty.

Akcje: `Rozpocznij`, `Nie teraz`, `Nie pokazuj ponownie`.
Pełny moduł uruchamia się dopiero po `Rozpocznij`. Dotyczy przede wszystkim:
Kalendarza, Osi czasu, Obciążenia, modalu zadania i Administracji.

### Warstwa D — centrum „Pomoc i samouczki”

Stały przycisk z ikoną Lucide `CircleHelp` w dolnej części sidebara, widoczny
dla każdej roli i na mobile. Nie nazywać go wyłącznie „Ustawienia”, ponieważ
obecnie aplikacja nie ma ogólnego widoku ustawień. Etykieta:
`Pomoc i samouczki`.

Otwiera dialog zawierający:

- `Uruchom krótkie wprowadzenie`,
- listę modułów z czasem (`2–4 min`) i statusem `Nowy / Rozpoczęty / Ukończony`,
- sekcję „Słownik oznaczeń”,
- `Zresetuj postęp samouczków` z potwierdzeniem.

## 4. Typy komponentów wizualnych

### 4.1 IntroDialog

- Wycentrowany modal, szerokość maks. 680 px.
- Scrim 50–60% czerni, zgodny z obecnym dark theme.
- Mała ilustracja z ikon Lucide i prostych kształtów CSS; bez emoji jako ikon.
- Progress `1 z 3` i trzy punkty, ale nie sam kolor.
- Jedno główne CTA na ekran.

### 4.2 Coachmark ze spotlightem

- Popover 320–380 px przy elemencie z `data-tour`.
- Cztery prostokąty scrimu wokół celu tworzą „otwór”; nie stosować kruchych
  selektorów `nth-child` ani pozycjonowania na sztywno.
- Cel dostaje wizualny ring overlay, bez zmiany layoutu i bez dopisywania
  `z-index` do komponentu biznesowego.
- Placement automatycznie wybiera `top/bottom/left/right` i jest clampowany do viewportu.
- Treść: tytuł do 45 znaków, opis do 240 znaków, opcjonalny blok „Warto wiedzieć”.
- Stopka: `Wstecz`, `Dalej`, `Pomiń`, `3 z 6`.

### 4.3 ContextHintCard

- Mała karta w prawym dolnym rogu widoku lub pod nagłówkiem strony.
- Nie zakrywa danych ani przycisków.
- Może zostać zamknięta i zapamiętuje `nie teraz` tylko dla bieżącej sesji;
  `nie pokazuj ponownie` zapisuje decyzję.

### 4.4 InlineLegend / słownik

Nie każdy szczegół wymaga popoutu. Przy złożonych widokach dodać dostępne
z przycisku `Co oznaczają symbole?` legendy:

- Kalendarz: kolor osoby, wysokość bloku, ⚠, Zasobnik, kolizja.
- Zadania: cztery wartości statusu planowania i priorytety.
- Projekty: moneta płatności, status, kamień milowy.
- Obciążenie: przypisane, dostępne, procent, przeciążenie.

### 4.5 CompletionToast

Po module: `Samouczek ukończony. Możesz wrócić do niego w Pomoc i samouczki.`
Toast ma `aria-live="polite"`, nie przejmuje focusu i znika po 4–5 sekundach.

## 5. Ścieżki dopasowane do roli

### Pracownik

Start: `/my-work`.

1. Cel N2Hub i model danych.
2. `Dzisiaj` — co jest faktycznie zaplanowane na dziś.
3. `Zasobnik` — godziny czekające na konkretny termin.
4. `Alerty` — po terminie, przeciążone dni, bez planu.
5. Nawigacja do Kalendarza.
6. W Kalendarzu tylko własne bloki są edytowalne; inne mogą być widoczne.
7. Profil i hasło.

Nie pokazywać kroków tworzenia projektu, zarządzania statusami ani edycji cudzych bloków.

### PM

Start: `/dashboard`.

1. Skrót dnia i obciążenie.
2. Projekty i zadania.
3. Modal zadania: osoby, szacunek, okres, przydział.
4. Kalendarz: Zasobnik, bloki i kolizje.
5. Obciążenie: overwork i możliwość reorganizacji.
6. Oś czasu: terminy i kamienie milowe.

### Handlowiec

Start: `/dashboard`.

1. Panel i nawigacja.
2. Projekty grupowane po klientach.
3. Moneta płatności oraz podstawowe dane projektu.
4. Kanban jako obraz etapu projektu.
5. Własny kalendarz i własne bloki.

Nie sugerować zarządzania zadaniami ani administracją, jeśli kontrolki są read-only.

### Administrator

Start: `/dashboard`.

1. Orientacja ogólna.
2. Struktura Klient → Projekt → Zadanie → Blok czasu.
3. Zespół, role i dostępność.
4. Administracja: statusy i słowniki.
5. Kalendarz i Obciążenie.
6. `Występuj jako` — wyłącznie jako podgląd zachowania roli, nie jako produkcyjne bezpieczeństwo.

### Tryb konfiguracji bez osób

Jeżeli `state.people.length === 0`, nie zapisuj postępu pod pustym ID użytkownika.
Użyj specjalnego klucza `setup` i pokaż checklistę:

1. dodaj pierwszą osobę/administratora,
2. uzupełnij statusy i słowniki,
3. utwórz klienta i projekt,
4. utwórz zadanie i przypisz godziny.

Po utworzeniu osoby jej osobisty onboarding nadal powinien być dostępny.

## 6. Katalog modułów i treści

Definicje kroków mają mieszkać w jednym katalogu TypeScript, nie w komponentach stron.

### M00 — Wprowadzenie (`intro`, wszyscy, 3 kroki)

Treści z warstwy A. Automatyczne tylko raz na osobę i wersję onboardingu.

### M01 — Poruszanie się (`shell`, wszyscy, 5 kroków)

| Cel | Tytuł | Treść |
| --- | --- | --- |
| `shell.nav` | Wszystko pod ręką | „Menu prowadzi do danych, planowania czasu i widoków zespołu. Widzisz funkcje zgodne z Twoją rolą.” |
| `shell.search` | Znajdź bez przeklikiwania | „Wyszukuj projekty, zadania, osoby i klientów. Użyj też Ctrl/Cmd+K.” |
| `shell.home` | Twój punkt startowy | Tekst zależny od roli: Panel albo Moja praca. |
| `shell.save-status` | Stan zapisu | „Przy edycji zobaczysz, czy zmiany są niezapisane lub zapisane. Nie zamykaj formularza z ostrzeżeniem.” |
| `shell.help` | Wróć tu w dowolnym momencie | „W Pomoc i samouczki uruchomisz ponownie całe intro albo wybrany moduł.” |

Krok `shell.save-status` pokazuj dopiero w module projektu/zadania, jeśli na
aktualnym ekranie nie ma targetu. Nie twórz sztucznego niewidocznego celu.

### M02 — Panel i Moja praca (`home`, wszyscy, role-specific)

- Zadania na dziś/Dzisiaj: pozycje wynikają z bloków zaplanowanych na bieżący dzień.
- Zasobnik: ma już osobę i liczbę godzin, ale nie konkretny dzień/godzinę.
- Alert „Bez planu”: zadanie bez rozpisanych godzin.
- Alert „Przeciążone dni”: suma godzin przekracza dostępność osoby; to ostrzeżenie.
- Donut: `zaplanowane / dostępne`; czerwony stan oznacza przekroczenie.
- `Twój tydzień`: szybki podgląd godzin; pełna edycja jest w Kalendarzu.
- Czat posiada etykietę demonstracyjną; nie przedstawiać go jako realnej komunikacji.

### M03 — Projekty (`projects`, role z podglądem; edycja tylko wg permissions)

1. Klienci grupują projekty.
2. Karta pokazuje status, okres, liczbę zadań, godzin i osób.
3. Moneta: złota = opłacony, brązowa = nieopłacony.
4. Filtry i zapisane presety służą do powtarzalnych zestawów.
5. `+ Nowy projekt` wyłącznie dla `projects.manage`.
6. W szczególe: dane, płatność, kamienie milowe, zadania, dyskusja.
7. Diament `◆` oznacza kamień milowy, nie zadanie.

### M04 — Kanban (`kanban`)

1. Kolumna oznacza status lejka, karta oznacza projekt.
2. Przeciągnięcie karty zmienia status, jeśli rola ma uprawnienie.
3. Kliknięcie karty otwiera projekt i jest podstawową alternatywą bez drag-and-drop.
4. `Zarchiwizowane` jest widokiem projektów ze starym statusem; można przeciągnąć z niego do aktywnej kolumny, ale nie upuszczać do niego.
5. Szybkie tworzenie statusu pokazywać wyłącznie administratorowi.

### M05 — Oś czasu (`timeline`)

1. **Najważniejsze:** „Długość paska pokazuje zakres dat, nie liczbę godzin pracy.”
2. W trybie Projekty środek paska przesuwa okres, a krawędzie zmieniają początek/koniec.
3. Przesunięcie zadania przesuwa jego bloki czasu; przesunięcie projektu nie przesuwa automatycznie zadań.
4. `◆` to kamień milowy i może być przesuwany przez uprawnione role.
5. Oznaczenie konfliktu informuje o problemie w konkretnych dniach.
6. Tryb Osoby jest podglądem zadań i zaplanowanych godzin, a paski są read-only.
7. Zakres 2/6/10 tygodni i zoom zmieniają czytelność, nie dane.

### M06 — Zadania i modal (`tasks`, wszyscy; edycja zależna od roli)

1. Zadanie zawsze należy do projektu.
2. Status realizacji i status planowania są osobnymi pojęciami.
3. Status planowania:
   - `nie rozplanowano` — brak godzin,
   - `częściowo` — część godzin nadal w Zasobniku,
   - `rozplanowano` — godziny znajdują się na dniach kalendarza,
   - `przekroczono` — plan przewyższa szacunek.
4. Szacunek mówi „ile powinno zająć”, a zaplanowane godziny mówią „ile wpisano ludziom”.
5. Priorytet, kategoria i checklista opisują sposób wykonania, ale nie zastępują statusu.
6. Osoby przypisane do zadania mogą dostać godziny w Zasobniku lub na konkretne dni.
7. Dzienny przydział jest sumą bloków tej osoby w danym dniu; `×N` oznacza kilka bloków składających się na jedną komórkę.
8. Dyskusja i @wzmianki dotyczą otwartego zadania.

### M07 — Kalendarz podstawowy (`calendar-basics`, wszyscy, 7 kroków)

1. Toolbar: tydzień/miesiąc, dziś, poprzedni/następny okres, filtr osób.
2. Nagłówek dnia: suma wszystkich widocznych godzin danego dnia.
3. Blok: pionowe położenie = godzina startu; wysokość i etykieta = czas trwania.
4. Kolor/kropka osoby identyfikuje właściciela bloku.
5. Zasobnik: godziny bez terminu, pogrupowane według osoby.
6. Przeciągnięcie z Zasobnika na siatkę nadaje datę i godzinę. Nie wymagać wykonania gestu w tourze.
7. Kliknięcie bloku/karty otwiera zadanie; to bezpieczna alternatywa do sprawdzenia i edycji danych.

### M08 — Kalendarz zaawansowany (`calendar-advanced`, role edytujące bloki)

1. Przeciągnięcie środka przesuwa blok; uchwyty góra/dół zmieniają czas co 15 minut.
2. Przeciągnięcie datowanego bloku do Zasobnika usuwa termin, ale zachowuje godziny.
3. Nakładanie różnych osób może być pokazane obok siebie. Kolizja tej samej osoby blokuje drop i przywraca blok.
4. ⚠/czerwony alert oznacza sumę powyżej dostępności; ostrzega, ale sam nie blokuje zapisu.
5. Prawy przycisk daje `Dodaj przed`, `Dodaj po` i podział datowanego bloku.
6. Widok miesiąca: mocniejsze tło = więcej godzin, kropki = osoby, czerwone obramowanie = co najmniej jedna przeciążona osoba; kliknięcie dnia wraca do tygodnia.
7. Jeśli gest nie jest dostępny, użytkownik może otworzyć zadanie i użyć dziennego przydziału godzin.

### M09 — Obciążenie (`workload`, PM/admin oraz read-only dla pozostałych)

1. Wiersz to osoba, kolumna to dzień.
2. Komórka pokazuje liczbę zaplanowanych godzin.
3. `Dostępne` wynika z dziennej dostępności i dni roboczych osoby.
4. Pasek pokazuje procent `przypisane / dostępne` w tygodniu.
5. Czerwony stan i ⚠ oznaczają overwork; nie oznaczają automatycznego błędu danych.
6. Kliknięcie niepustej komórki rozwija składowe bloki.
7. Reassign/przesunięcie pokazywać wyłącznie rolom z odpowiednimi permissions.
8. Filtry klienta/usługi zmieniają podsumowanie, ale panel szczegółu pokazuje wszystkie bloki danego dnia.

### M10 — Zespół i profil (`people`)

1. Lista pokazuje osoby, role, działy i łączną liczbę przypisanych godzin.
2. Capacity/godziny na dzień są progiem dostępności i overwork.
3. Dni robocze wpływają na tygodniową dostępność.
4. `Praca od/do` ma charakter informacyjny; nie zastępuje capacity.
5. Uprawnienia decydują o edycji, a stanowisko jest tylko opisem.
6. Profil pokazuje tydzień, projekty, zadania, informacje i ustawienie hasła.
7. Zarządzanie zespołem pokazywać tylko `people.manage`; własny profil tylko `profile.editOwn`.

### M11 — Administracja (`admin`, tylko administrator/setup)

1. Statusy są wspólne dla projektów i zadań oraz tworzą kolumny Kanbana.
2. Kolejność statusów ustawia lejek.
3. `Ukończenie` określa zakończoną pracę niezależnie od pozycji statusu.
4. Archiwizacja ukrywa status z wyboru, ale zachowuje historię.
5. Usunięcie jest dozwolone tylko dla nieużywanego statusu i nie może usunąć ostatniego aktywnego/ukończeniowego statusu.
6. Klienci, działy, typy usług i kategorie prac są wspólnymi słownikami.
7. Usunięcia kaskadowe mają konsekwencje; tour nie może automatycznie klikać akcji destrukcyjnych.

## 7. Stan i wersjonowanie

Rozszerzyć `UiPrefs`, zachowując kompatybilność z istniejącym
`{ sidebarCollapsed: boolean }`.

Proponowany model:

```ts
export type TutorialModuleId =
  | 'intro'
  | 'shell'
  | 'home'
  | 'projects'
  | 'kanban'
  | 'timeline'
  | 'tasks'
  | 'calendar-basics'
  | 'calendar-advanced'
  | 'workload'
  | 'people'
  | 'admin';

export type TutorialModuleProgress = {
  status: 'not-started' | 'in-progress' | 'completed' | 'dismissed';
  lastStep: number;
  completedVersion: number | null;
};

export type UserOnboardingProgress = {
  introVersionSeen: number;
  autoTourHandled: boolean;
  modules: Partial<Record<TutorialModuleId, TutorialModuleProgress>>;
};

export type UiPrefs = {
  sidebarCollapsed: boolean;
  onboardingByUser: Record<string, UserOnboardingProgress>;
};
```

Zasady:

- stała `ONBOARDING_VERSION = 1`,
- klucz użytkownika to ID realnie zalogowanej osoby, nie osoby impersonowanej,
- impersonacja nigdy automatycznie nie uruchamia intro dla celu impersonacji,
- ręczne uruchomienie modułu podczas impersonacji jest dozwolone i filtruje kroki wg aktualnie działającej roli,
- `setup` jest oddzielnym kluczem dla trybu bez osób,
- `loadUiPrefs` normalizuje brakujące/uszkodzone pola,
- dodać `updateUiPrefs(patchOrUpdater)`, aby zmiana `sidebarCollapsed` nie kasowała postępu i odwrotnie,
- błędy localStorage nie mogą blokować zamknięcia touru; utrzymać stan sesyjny w React,
- `dismissed` nie oznacza `completed`, ale nie uruchamia ponownie automatycznie,
- reset dotyczy tylko bieżącego realnego użytkownika i wymaga potwierdzenia.

## 8. Architektura komponentów i pliki

Proponowany układ:

```text
src/onboarding/
  types.ts
  catalog.ts
  rolePaths.ts
  target.ts
  OnboardingProvider.tsx
  OnboardingRoot.tsx
  IntroDialog.tsx
  CoachmarkOverlay.tsx
  ContextHintCard.tsx
  TutorialCenter.tsx
  InlineLegend.tsx
  onboarding.test.ts
src/utils/uiPrefs.test.ts
scripts/browser-check-onboarding.mjs
```

Odpowiedzialności:

- `catalog.ts`: teksty, route, target ID, wymagane permission i warianty roli.
- `rolePaths.ts`: rekomendowana kolejność modułów, bez komponentów React.
- `target.ts`: wyszukiwanie targetu, oczekiwanie na DOM, pomiar i placement.
- `OnboardingProvider`: aktywny użytkownik, progress, nawigacja, wybór kroków.
- `OnboardingRoot`: portal i wybór aktualnej powierzchni UI.
- `TutorialCenter`: restart i lista modułów.
- strony biznesowe: tylko `data-tour="..."`, ewentualnie przycisk legendy; żadnych tekstów touru.

Provider może być zamontowany nad authenticated app shell. Nie może otwierać intro
na ekranie logowania. Auto-start następuje po ustaleniu realnego użytkownika,
wyrenderowaniu docelowego route'u i zakończeniu pierwszej klatki.

## 9. Stabilne kotwice DOM

Nie używać klas CSS jako API touru. Dodać semantyczne atrybuty:

| Target ID | Miejsce |
| --- | --- |
| `shell.nav` | `<nav className="app-nav">` |
| `shell.search` | trigger `GlobalSearch` |
| `shell.help` | nowy przycisk Pomoc i samouczki |
| `home.today` | karta Dzisiaj/Zadania na dziś |
| `home.bin` | karta Zasobnik |
| `home.alerts` | karta Alerty |
| `home.workload` | karta donutów |
| `projects.filters` | FilterPanel + presets |
| `projects.card` | pierwsza dostępna karta projektu |
| `projects.coin` | moneta pierwszej karty |
| `project.milestones` | sekcja kamieni milowych |
| `kanban.board` | board |
| `kanban.column` | pierwsza aktywna kolumna |
| `timeline.toolbar` | przełączniki/zoom |
| `timeline.bar` | pierwszy pasek |
| `timeline.milestone` | pierwszy milestone; krok warunkowy |
| `tasks.card` | pierwsze zadanie |
| `task.estimate` | estimate compare w TaskModal |
| `task.assignees` | picker osób |
| `task.bin` | sekcja zasobnika |
| `task.allocation` | AllocationGrid |
| `task.save-status` | SaveStatus w nagłówku |
| `calendar.toolbar` | toolbar |
| `calendar.day-header` | pierwszy widoczny dzień |
| `calendar.block` | pierwszy blok; krok warunkowy |
| `calendar.bin` | pane Zasobnika |
| `calendar.bin-card` | pierwsza karta; krok warunkowy |
| `calendar.overload` | pierwszy alert; krok warunkowy |
| `workload.table` | tabela |
| `workload.load-bar` | pierwszy pasek |
| `workload.overload` | pierwszy alert; krok warunkowy |
| `people.list` | lista osób |
| `people.capacity` | pole capacity lub informacja profilu |
| `admin.statuses` | sekcja statusów |
| `admin.done-flag` | checkbox Ukończenie |

Jeśli target warunkowy nie istnieje, krok ma zostać pominięty i licznik ma się
przeliczyć. Nie wolno zostawić użytkownika na pustym spotlightcie. Dla kroku
niezależnego od danych użyć popoveru wycentrowanego zamiast tworzyć sample data.

## 10. Silnik przejść i pozycjonowanie

1. Każdy krok deklaruje `route`, `target`, `placement`, `permission?`, `roles?`,
   `optionalTarget?` i opcjonalny `prepareView` ze skończonego enumu.
2. Przy zmianie route'u poczekać na target maks. 2 sekundy przez MutationObserver.
3. Przed pomiarem wykonać `scrollIntoView({ block: 'center', inline: 'nearest' })`.
4. Przeliczać rect przy resize, scrollu głównego okna, scrollu kontenera i ResizeObserver.
5. Na desktopie spotlight padding 8 px; na mobile 6 px.
6. Popover clampować co najmniej 12 px od krawędzi/safe area.
7. Jeśli viewport ma mniej niż 760 px, preferować bottom sheet zamiast małego
   dymka obok ciasnego targetu. Target nadal otrzymuje ring.
8. Zmiana orientacji nie resetuje kroku.
9. Kliknięcie scrimu nie zamyka automatycznie touru; pokazuje delikatny feedback
   na przycisku `Pomiń`. Escape otwiera małe potwierdzenie tylko wtedy, gdy użytkownik wykonał więcej niż jeden krok; na pierwszym kroku zamyka bez tarcia.
10. Nie uruchamiać dwóch warstw naraz: GlobalSearch, TaskModal, context menu i
    TutorialCenter muszą być jawnie otwierane/zamykane przez sekwencję kroku.

## 11. Accessibility i interakcje

- `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, `aria-describedby` dla intro/centrum/coachmarka blokującego.
- Focus po otwarciu na nagłówku lub pierwszym przycisku; focus trap; po zamknięciu powrót do triggera.
- Tab order zgodny z kolejnością przycisków; Shift+Tab działa.
- Escape działa zawsze, z wyjątkiem gdy otwarte jest bardziej wewnętrzne potwierdzenie.
- Screen reader dostaje `Krok 3 z 6` i nazwę podświetlonego elementu.
- Kolor nigdy nie jest jedynym nośnikiem znaczenia; zawsze ikona/tekst.
- Kontrast tekstu min. 4.5:1, elementów graficznych min. 3:1.
- Min. 44×44 px dla działań na touch.
- `prefers-reduced-motion`: brak scale/slide; tylko szybki crossfade lub zmiana natychmiastowa.
- Animacje 150–250 ms i tylko `transform/opacity`.
- Tour nie przechwytuje klawiszy używanych przez formularz, jeśli nie jest aktywny.
- Nie opierać żadnej instrukcji wyłącznie na hoverze lub prawym przycisku.
- Dla gestów zawsze opisać alternatywę: otwarcie zadania i edycję dziennego przydziału.

## 12. Styl wizualny

Skill UI/UX wskazuje prosty, czytelny onboarding dla B2B productivity. Nie
przenosić jego jasnej niebieskiej palety do produktu. Źródłem prawdy pozostają
tokeny N2Hub w `src/styles.css`:

- powierzchnia: `--n2-surface-strong`,
- obramowanie: `--n2-border-strong`,
- główne CTA/ring: `--n2-lavender`,
- tło aktywne: `--n2-violet`/istniejące gradienty,
- ostrzeżenia: `--n2-warning`,
- błędy/overwork: `--n2-danger`,
- sukces ukończenia: `--n2-success`,
- tekst: `--n2-text`, `--n2-text-soft`.

Użyć obecnego Plus Jakarta Sans, promieni i rytmu 4/8 px. Zdefiniować spójną
skalę warstw; onboarding powinien być ponad GlobalSearch, TaskModal i context menu,
np. `--z-onboarding: 1100`, ale bez losowych dodatkowych wartości.

## 13. Integracja z istniejącymi modalami i nawigacją

- Intro i TutorialCenter są niezależne od URL.
- Aktywny moduł może przechowywać ID w stanie React, ale nie musi dopisywać
  parametrów do publicznego URL.
- Kroki modalu zadania otwierają istniejący `?task=<id>` wyłącznie po zgodzie
  użytkownika albo korzystają z już otwartego zadania. Nie otwierać przypadkowego
  edytowalnego zadania tylko po to, żeby znaleźć target; w braku danych pokazać
  wycentrowany przykład opisowy.
- Zmiana route'u przez użytkownika w trakcie modułu: pauza z wyborem
  `Kontynuuj tutaj` lub `Zakończ samouczek`, nie wymuszać powrotu.
- Mobile drawer: krok nawigacji może go otworzyć, ale po zakończeniu przywraca
  poprzedni stan i focus hamburgera.
- Collapsed sidebar: podczas kroku `shell.nav` tymczasowo rozwinąć, a po tourze
  przywrócić preferencję. Nie zapisywać tego tymczasowego rozwinięcia jako nowej preferencji.

## 14. Plan wdrożenia w pakietach

### Pakiet 1 — fundament i stan

- rozszerzenie `uiPrefs` + migracja/defaulty/update API,
- typy, katalog, role paths,
- czysty reducer/state machine onboardingu,
- testy pure logic i persistence,
- brak widocznego UI poza opcjonalnym dev harness.

### Pakiet 2 — intro i centrum samouczków

- `OnboardingProvider`, `IntroDialog`, `TutorialCenter`, trigger w sidebarze,
- auto-start po pierwszym realnym logowaniu/otwarciu istniejącej sesji bez progressu,
- skip/replay/reset,
- focus management, mobile bottom sheet, reduced motion,
- testy przeglądarkowe intro/persistence/replay.

### Pakiet 3 — shell i widoki startowe

- stabilne `data-tour` w App, Panel i Moja praca,
- `CoachmarkOverlay`, spotlight, placement, brakujące targety,
- ścieżki role-specific dla administratora, PM, handlowca i pracownika.

### Pakiet 4 — projekty, zadania i administracja

- targety i moduły M03, M04, M06, M10, M11,
- conditional permissions,
- legendy statusu planowania, płatności i statusów.

### Pakiet 5 — planowanie czasu

- targety i moduły M05, M07, M08, M09,
- tylko atrybuty/legendy w WeekView — bez zmiany logiki drag,
- pełne rozróżnienie trzech rodzajów pasków,
- alternatywy bez gestów.

### Pakiet 6 — hardening

- Chromium + WebKit + mobile widths,
- keyboard/screen reader semantics/reduced motion,
- aktualizacja dokumentacji i browser harness,
- pełna regresja obecnych funkcji.

Każdy pakiet ma być oddzielnym, małym commitem. Nie łączyć wdrożenia całego
systemu z przypadkowymi refactorami stron.

## 15. Testy i ochrona regresji

### Testy jednostkowe

- stary payload `n2hub.ui.v1` z samym `sidebarCollapsed` ładuje się poprawnie,
- uszkodzone onboarding fields wracają do bezpiecznych defaultów,
- aktualizacja sidebar nie kasuje progressu,
- aktualizacja progressu nie kasuje sidebar,
- auto-start tylko dla użytkownika bez obsłużonego intro,
- skipped/dismissed nie uruchamia się ponownie automatycznie,
- ręczny replay zawsze działa,
- progress jest osobny dla dwóch realnych osób,
- impersonacja używa realnego ownera zapisu i nie odpala auto-touru,
- role filtrują niedozwolone kroki,
- brak targetu opcjonalnego pomija krok i aktualizuje licznik,
- setup progress nie miesza się z user progress.

### Browser check `scripts/browser-check-onboarding.mjs`

Chromium i WebKit:

1. czysty uiPrefs → intro otwiera się raz,
2. Pomiń → reload → brak auto intro,
3. ukończenie → reload → brak auto intro,
4. Pomoc i samouczki → replay intro,
5. restart pojedynczego modułu,
6. pracownik nie widzi admin-only kroków,
7. administrator widzi moduł Administracja,
8. target nieistniejący nie zawiesza touru,
9. route change i Back nie zostawiają scrimu/scroll locka,
10. Escape, Tab, Shift+Tab i powrót focusu,
11. 375, 760, 1180 i 1440 px,
12. reduced-motion,
13. otwieranie/zamykanie mobile drawer,
14. TaskModal i GlobalSearch nie zderzają się warstwami,
15. po zakończeniu nie zostają listenerzy ani `overflow: hidden`.

### Krytyczne istniejące regresje

Nowy auto-onboarding domyślnie zasłoni świeże konteksty browser testów. Dlatego:

- dodać wspólny helper do browser scripts, który zapisuje ukończony onboarding
  dla testowego użytkownika,
- istniejące skrypty uruchamiają aplikację z onboardingiem wyłączonym przez stan
  uiPrefs, nie przez produkcyjny magiczny query param,
- dedykowany onboarding check jako jedyny czyści ten progress.

Po wdrożeniu nadal muszą przechodzić bez zmian semantycznych:

- `scripts/browser-check-bin-drag.mjs` w Chromium i WebKit,
- date hardening,
- multi-block SAVE_TASK,
- status semantics,
- wszystkie testy Vitest,
- `npm run build`.

Szczególna macierz kalendarza: free drop, window fallback, collision, separator,
invalid target, ghost cleanup, Escape, narrow layout i WebKit. Żaden overlay nie
może pozostawić globalnego listenera blokującego kolejny drag.

## 16. Kryteria akceptacji

- Nowy realny użytkownik widzi intro tylko raz dla bieżącej wersji.
- Może pominąć całość w maksymalnie jednym kliknięciu z każdego kroku.
- Może ponownie uruchomić intro lub dowolny moduł z `Pomoc i samouczki`.
- Cztery role dostają różne, zgodne z permissions ścieżki.
- Onboarding poprawnie wyjaśnia trzy rodzaje pasków i nie miesza zakresu dat z godzinami.
- Kalendarz jasno wyjaśnia Zasobnik, blok, resize, kolizję i overwork.
- Overwork jest opisany jako ostrzeżenie, a kolizja tej samej osoby jako blokada kalendarzowego dropu.
- Żaden krok nie wymaga istniejących danych; kroki warunkowe są pomijane albo mają bezpieczny przykład.
- Brak targetu, zmiana route'u, resize i zmiana orientacji nie powodują zawieszonego scrimu.
- Pełna obsługa klawiatury, focus return, reduced motion i dostępne nazwy.
- 375–1440 px bez poziomego overflow powodowanego onboardingiem.
- Progress nie trafia do danych biznesowych i nie jest eksportowany jako dane firmy.
- Onboarding nie zmienia żadnego projektu, zadania, bloku ani filtra.
- Wszystkie stare testy i browser checks pozostają zielone.

## 17. Czego nie robić w tym wdrożeniu

- Nie budować osobnego systemu CMS dla treści.
- Nie dodawać analityki zewnętrznej ani telemetrii bez zgody.
- Nie generować sample data przez onboarding.
- Nie przebudowywać autoryzacji, localStorage ani API przy okazji.
- Nie tworzyć 30–50-krokowego obowiązkowego touru.
- Nie zakładać, że tooltip hover jest onboardingiem.
- Nie blokować korzystania z aplikacji do czasu ukończenia samouczka.
- Nie wprowadzać emoji jako ikon strukturalnych.
- Nie pokazywać administratorowi, że impersonacja jest produkcyjnym zabezpieczeniem.
- Nie dotykać logiki bin drag/resize, aby „ułatwić” targetowanie spotlightu.

## 18. Definition of Done dla GPT-5.6 Terra

Praca jest zakończona dopiero wtedy, gdy:

1. wszystkie pakiety są zaimplementowane zgodnie z katalogiem i permissions,
2. `CLAUDE.md` opisuje onboarding, uiPrefs i sposób dodawania nowych kroków,
3. istnieje dokument dla copy/target IDs i nie ma tekstów touru rozsianych po stronach,
4. typecheck, Vitest i produkcyjny build przechodzą,
5. dedykowany browser check przechodzi w Chromium i WebKit,
6. wszystkie dotychczasowe browser checks przechodzą,
7. wykonano ręczny walkthrough dla czterech ról oraz szerokości 375/760/1180/1440,
8. końcowy raport wymienia pliki, scenariusze i wszelkie świadomie odłożone elementy,
9. zmiany są wypchnięte wyłącznie na wskazany branch review, chyba że człowiek jawnie zleci inaczej.
