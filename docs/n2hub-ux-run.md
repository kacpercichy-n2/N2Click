# N2Hub — brief UX run (zmiany po widokach)

Zestawienie zmian do wykonania w N2Hub, uporządkowane po widokach. Stringi
user-facing po polsku. Panel i większość zmian to warstwa UX/layout; pozycje
oznaczone **[Nowa funkcja]** wymagają backendu/danych, a **[Decyzja]** —
potwierdzenia przed wdrożeniem.

Legenda tagów: **[Layout]** układ/CSS · **[Fix]** poprawka istniejącego ·
**[Nowa funkcja]** wymaga danych/backendu · **[Decyzja]** czeka na decyzję.

---

## 1. Panel (Dashboard) — `src/pages/DashboardPage.tsx`

Docelowy układ (2 kolumny, góra → dół):

```
RZĄD 1 · Pasek hotfixów / changelog            [pełna szerokość]   (istnieje)
RZĄD 2 · Powiadomienia (max 3)  |  Obciążenie (kompakt)            (~2fr | ~1fr)
RZĄD 3 · Zadania na dziś        |  Zespół (4 widoczne + scroll)    (2 kafle)
RZĄD 4 · Twój tydzień                          [pełna szerokość]
RZĄD 5 · Pozostałe kategorie                   [pełna szerokość]   (placeholder)
```

- **[Layout]** Przebudować siatkę Panelu wg układu powyżej.
- **[Fix]** Kafelek „Zespół": max **4 osoby widoczne**, reszta pod scrollem
  **wewnątrz kafelka** (stała max-wysokość + `overflow-y:auto`), żeby nie
  wydłużał viewportu. Licznik w nagłówku, np. „Zespół (8)".
- **[Layout]** „Zadania na dziś" i „Zespół" — **równa wysokość** w rzędzie.
- **[Fix]** „Obciążenie": tekst (`31h 45m / 40h`) nachodzi na pierścień —
  zmniejszyć font i/lub dopasować/powiększyć kółko; czytelnie, bez ucinania;
  wersja kompaktowa (mieści się w węższej kolumnie).
- **[Layout]** „Twój tydzień" na **pełną szerokość** (było pół), żeby podgląd
  7 dni był czytelny.
- **[Nowa funkcja]** Powiadomienia: pasek na max **3** wpisy — komentarz w
  projekcie, nowy projekt/zadanie w Twoim zasobniku, interakcje dotyczące
  Ciebie. Wymaga tabeli + RLS + źródła zdarzeń. W tym runie **zostawić tylko
  slot** (pusty stan / ukryty gdy brak).
- **[Decyzja]** Scalenie „Panel" + „Moja praca" (+ zasobnik) — zmienia „role
  homes" (workerzy → `/my-work`, reszta → `/dashboard`) i routing. Nie łączyć
  na ślepo.

---

## 2. Klienci — `src/pages/ClientsPage.tsx`

- **[Fix]** Kafelek klienta ma być **klikalny** (teraz nie jest) i rozwijać się
  po kliknięciu z pełnym opisem i dodatkowymi informacjami. Długi opis (jak
  Telediagnosis) **nie jest widoczny od razu** ani wyciągany na zewnątrz —
  schowany w kafelku, rozwijany na klik.
- **[Nowa funkcja]** Pola wymagane przy tworzeniu klienta (muszą być wypełnione):
  nazwa klienta, główna osoba kontaktowa (imię + nazwisko), numer telefonu,
  mail. Dodatkowo: plusik do dodania **kolejnych osób kontaktowych** oraz pole
  **opisu klienta**.
- **[Layout]** Widok kafelka zostaje szeroki jak teraz: imię i nazwisko głównej
  osoby kontaktowej, jej mail i telefon; opis schowany (rozwijany na klik).

---

## 3. Projekty — `src/pages/ProjectsPage.tsx`, `src/pages/ProjectDetailPage.tsx`

**Belka filtrów (góra):**
- **[Nowa funkcja]** Dodać **filtr po osobach** (projekty przypisane do danych
  osób) — obok istniejącego filtra po kliencie.
- **[Layout]** Zamiast długiego drop-downu: jedna **szeroka belka filtrów** z
  sekcjami (np. płatność / klienci / osoby), każda z własnymi drop-downami.
- **[Fix]** Przycisk **„Zapisz filtry" w belce filtrów**, nie pod nią. Filtry i
  tak zapisują się automatycznie po skonfigurowaniu (zachować logikę aplikacji).

**Lista projektów:**
- **[Layout]** Nazwa klienta lepiej wyszczególniona — w kafelku/blobie —
  i **większa**, żeby łatwiej ją znaleźć.

**Panel projektu (szczegóły):**
- **[Layout]** Pole opisu **×2 wyższe**.
- **[Fix]** **Kamienie milowe — usunąć** (na teraz niepotrzebne).
- System dokumentów — do opracowania później, zostaje jak jest.
- **[Layout]** **Zadania podnieść w miejsce kamieni milowych** (zaraz po
  szczegółach).
- **[Layout]** Dyskusja lepiej widoczna, pole tekstowe **×2** wysokości.

---

## 4. Zadania — `src/pages/TasksPage.tsx`, `src/components/TaskModal.tsx`

**Filtry:**
- **[Nowa funkcja / Layout]** Ta sama logika co w projektach: filtr po osobach,
  **jeden wspólny bar**, zapis automatyczny lub przycisk „Zapisz filtr" — w
  jednym rzędzie.

**Kafelki zadań (lista):**
- **[Fix]** „Usuń" **wycentrowany** (teraz ucieka do góry) i jako **ikona X w
  kółku**, nie tekst „usuń".
- **[Fix]** Bąbel projektu: **brak spacji przy ikonce monetki** (jest tuż obok
  tekstu), a **ikonka monetki ma offset (obniżona)** — poprawić.
- **[Fix]** „Nowe zadanie": plusik nie jest w jednej linii / nie wyśrodkowany
  względem tekstu (tekst vs ikona z line-heightem) — poprawić.

**Karta edycji zadania:**
- Opis i checklista — OK.
- **[Layout]** **Przypisane osoby** zaraz po szczegółach, **nad checklistą**.
- **[Layout]** **Dzienny przedział godzin** zaraz pod osobami, jako 3. pozycja.
- **[Fix]** Przycisk zamknięcia karty: **X nie wycentrowany w kółku (obniżony)**
  — poprawić. („Usuń zadanie" może zostać.)

---

## 5. Kanban — `src/pages/KanbanPage.tsx`

- **[Fix]** Filtr po osobach siedzi **pod napisem „Kanban"**, a ma być
  **w filtrach**.
- **[Layout]** Jedna **szeroka belka filtrów** z pozycjami: płatność, klient,
  projekt, osoba przypisana. Uspójnić z resztą widoków.

---

## 6. Kalendarz — `src/components/WeekView.tsx`, `src/pages/CalendarPage.tsx`

> Obszar wrażliwy na stabilność (kontekst schedulingu) — ruszać ostrożnie.

- **[Fix]** UX przeciągania/umieszczania kart: brak **magnetycznego
  przyciągania** do slotu; karta bywa **niepodświetlana na czerwono**, a i tak
  się nie przyczepia. Prawdopodobnie łapie tam, **gdzie jest kursor na karcie**,
  a nie względem **góry przesuwanej karty**, i przepisuje się tylko do **górnej
  linii** odstępu czasowego. Efekt: trafienie udaje się dopiero za którymś razem.
  **Przeanalizować punkt przyczepienia karty** i co go psuje.
- **[Fix]** Karta ściągana do zasobnika **chowa się pod zasobnikiem** —
  nie widać jej, jak wjeżdża.

---

## 7. Wydarzenia — `src/pages/` (widok wydarzeń)

- Podgląd wydarzenia — OK.
- **[Fix]** W edycji pola **„początek" / „koniec"** mają inny input niż data/
  tytuł (twarde rogi, mniejsze) — ostylować równo.
- **[Fix]** **Osoby** — ujednolicić z resztą interfejsu (nie wiadomo, czy
  check-marki, czy kliknięcie na pill z osobą).

---

## 8. Oś czasu — `src/pages/TimelinePage.tsx`

- **[Fix]** Bazowo widok **najbliższych 5 dni** (nie tygodni/miesięcy). Na
  największym (wyjściowym) zoomie: **pon–pt tego tygodnia** i widoczne taski.
  Odzoomowanie: **2 tygodnie** → **cały miesiąc**. Teraz na max zoomie nie widać,
  czy trwający task kończy się wt czy śr — trzeba się domyślać.
- **[Fix]** Wywalić input z zakładkami **2 / 6 / 10 / 26 tygodni**.
- **[Layout]** Podział na projekt/osoby **w filtrach, domyślnie zamknięty** —
  mały **przycisk filtrów** (w tej samej kolumnie co „przeciągnij pasek, aby
  zmienić termin"); po kliknięciu filtrowanie: projekty, osoby (możliwość
  zaznaczenia konkretnych).

---

## 9. Profil / Zespół — `src/pages/PersonProfilePage.tsx`, `src/pages/TeamPage.tsx`

- **[Layout/Fix]** **Zintegrować edycję z wejściem w profil** — profil i edycja
  w jednym panelu (bez osobnego „Edytuj profil" przenoszącego do innej zakładki
  ani rozwijanej zakładki).
- **[Fix]** Uprawnienia wg hierarchii:
  - **Admin** — widzi wszystko o osobie (obłożenie, zadania, projekty), może
    przypisać do innego działu, zmienić imię/nazwisko; edycja i profil w jednym
    panelu.
  - **Specjalista** — tylko informacje ogólne, bez edycji cudzego profilu.
  - **Manager / szef działu** — edytuje tylko specjalistów w swoim dziale.
- **[Fix]** „Zmień zdjęcie / usuń zdjęcie" jest **przesadnie duże**. Kompaktowo:
  imię, nazwisko, stanowisko, zdjęcie jak teraz, ale ze **małym kółeczkiem z
  ikoną edycji (ołówek)** — klik = wybór zdjęcia. **Bubble** sygnalizujący
  edytowalność.
- **[Layout]** Pierwsza karta = dane podstawowe (imię, nazwisko, stanowisko,
  dział, spółka) sensowniej ułożone + klikalne kółko ze zdjęciem.

---

## 10. Ustawienia (dawne „Konto") — `src/pages/AccountPage.tsx`, `src/App.tsx`

- **[Fix]** Zmienić nazwę **„Konto" → „Ustawienia"** + ikona **trybika**.
- Zawartość: ustawienia interfejsu (**kolejność menu**), **„Zmień hasło"**,
  w przyszłości inne funkcje.
- **[Fix]** **Usunąć „Profil w chmurze" i „Mój profil"** — powielają informacje
  z zakładki „Zespół".
- **[Layout]** Bar boczny: **węższy przycisk „Wyloguj"**; obok **bąbelek z
  awatarem** → klik wchodzi we **własny profil** (ten z „Zespół"). Zamarkowane
  i logiczne.

---

## Przekrojowe (cała aplikacja)

- **[Fix]** Usunąć **„występuj jako"** z nawigacji i funkcjonalności — brak
  podszywania się / podglądu innej osoby. Występujesz jako zalogowane konto z
  jego uprawnieniami.
- **[Fix]** Naprawić **optyczne wyśrodkowanie ikon w całej aplikacji** (X-y w
  kółkach, plusiki, ikonka monetki) — raz jako tekst, raz jako ikona z
  line-heightem; misalignment wraca w wielu widokach.
- **[Layout]** Ujednolicić **wzorzec belki filtrów** w Projektach, Zadaniach,
  Kanbanie i Osi czasu: jedna szeroka belka, sekcje z drop-downami, przycisk
  zapisu w belce, autozapis filtrów.
