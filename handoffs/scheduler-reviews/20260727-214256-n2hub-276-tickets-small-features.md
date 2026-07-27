# Raport workflow: 20260727-214256-n2hub-276-tickets-small-features

## Wykonane

Cztery zgłoszenia zespołu. Najpierw analiza (tier `architect`, read-only), czy
któraś funkcja już istnieje w bieżącym worktree — **żadna z czterech nie była
zaimplementowana**, więc żadnej nie pominięto. Dowody z analizy:

| # | Funkcja | Stan przed | Dowód |
| --- | --- | --- | --- |
| 1 | Godziny przy planowaniu z Zadań | brak | `AllocationCell` miał 3 pola; start zawsze automatyczny (`AppStore.tsx:804`) |
| 2 | Podział na dni w osi czasu | brak | nagłówek etykietował tylko poniedziałki (`TimelinePage.tsx:642-655`) |
| 3 | Podgląd powiadomienia | brak | `openNotification` otwierał edytor (`DashboardPage.tsx:190-195`) |
| 4 | @-wzmianki (autocomplete) | brak | `onChange` textarei to samo `setBody`; działały tylko chipsy pod polem |

Każdy punkt dostał osobny pakiet handoff (`handoffs/packages/PKG-20260727-*.md`)
i osobny, izolowany kontekst developera.

### 1. Opcjonalna godzina startu przy planowaniu z zakładki Zadania

`AllocationCell` zyskał opcjonalne `startMinutes`. Puste pole = dotychczasowe
automatyczne umiejscowienie (`findFreeStart` → `nextFreeStart`) — bez zmian.
Kluczowa decyzja: „zakres godzin” to **przypięty start**; czas trwania jest już
wartością godzinową komórki (siatka 0,25 h).

Umiejscowienie zrealizowane jako **jeden post-pass** między pętlą `pairKeys`
a blokiem zasobnika, bramkowany `wantStartByPair.size > 0` — cztery gałęzie
rekoncyliacji `SAVE_TASK` pozostały nietknięte, dzięki czemu identyczność
bajtowa przy payloadzie bez `startMinutes` jest dowiedziona testem
(`toBe(e3)` na referencji wpisu). Pin działa tylko, gdy para (osoba, dzień) daje
dokładnie jeden blok; dni wieloblokowe zachowują dotychczasowe upakowanie i nie
pokazują pola godziny. Wartości poza siatką 15 min / poza dobą są odrzucane
przez guard payloadu (ta sama referencja stanu, inwariant 6), a edytor snapuje
przed wysyłką, więc użytkownik tam nie trafia. `clampBlockStart` gwarantuje
`start + czas trwania ≤ 1440`.

Pliki: `src/store/AppStore.tsx`, `src/components/AllocationGrid.tsx`,
`src/components/TaskModal.tsx`, `src/styles.css`,
`src/store/saveTaskWorkload.test.ts`.

### 2. Oś czasu — kolumny dni przy bliskim zbliżeniu

Nowe czyste, testowalne helpery `showDayColumns` / `dayHeaders` /
`TimelineDayHeader` w `src/pages/timelineZoom.ts` oraz `weekdayAbbr` /
`dayOfMonthLabel` w `src/utils/dates.ts`. Przy `week` (160 px/dzień) i
`twoWeeks` (64 px/dzień) każdy dzień ma własny nagłówek (numer dnia + skrót dnia
tygodnia, weekend wyszarzony) i pionową linię siatki; `month` (30 px/dzień)
zostaje bez zmian — byłby nieczytelny.

Wyłącznie prezentacja: `zoomView`, `shiftAnchor`, `zoomIn/zoomOut`, stałe
szerokości dnia i cała matematyka `Math.round(deltaX / dayW)` są bajtowo
nietknięte. Nowe warstwy mają `pointer-events: none` i `aria-hidden`, więc nie
przechwytują przeciągania (inwariant 7). Nagłówek nie wymagał zmiany wysokości.

Pliki: `src/pages/timelineZoom.ts`, `src/pages/TimelinePage.tsx`,
`src/utils/dates.ts`, `src/styles.css` + testy obu modułów.

### 3. Powiadomienia — podgląd zamiast edycji

Kliknięcie wiersza rozwija teraz podgląd „Kto / Co / Gdzie” (dla powiadomień
o komentarzu także treść komentarza, rozwiązywana ze `state.comments` po
`payload.commentId`) i **nie dispatchuje niczego** ani nie otwiera edytora.
Otwarcie obiektu przeniesiono do jawnego przycisku `Otwórz zadanie` /
`Otwórz projekt`, który zachowuje dotychczasowe zachowanie `openNotification`
(oznacz przeczytane + otwórz). Per-wiersz `✓` i „Oznacz wszystkie” bez zmian.

Rozwinięcie celowo **nie** oznacza jako przeczytane — kafelek pokazuje tylko
nieprzeczytane, więc wiersz znikałby w trakcie czytania. `notificationEntry`
pozostał czysty (nazwy i treść komentarza wstrzykuje strona).

Pliki: `src/pages/dashboardPanels.ts`, `src/pages/DashboardPage.tsx`,
`src/styles.css`, `src/pages/dashboardPanels.test.ts`.

### 4. @-wzmianki — podpowiedzi wyzwalane pisaniem

Nowy czysty moduł `src/components/mentionAutocomplete.ts`
(`mentionQueryAt` / `filterMentionPeople` / `applyMention`). Wpisanie `@`
otwiera listę osób filtrowaną na bieżąco; ArrowUp/ArrowDown przewijają,
Enter wstawia, Escape zamyka, klik w opcję nie zabiera fokusu z pola.
`mail@domena` i token przerwany spacją nie otwierają listy.

`parseMentions`, `MentionBody` i chipsy pod polem działają dokładnie jak dotąd —
wstawiany tekst to nadal `@Imię `, więc `ADD_COMMENT.mentionIds` ma niezmienioną
semantykę (osobny test round-trip tego dowodzi). Przy zamkniętej liście Enter
nadal wstawia nową linię i nigdy nie wysyła formularza.

Dopasowanie jest nieczułe na wielkość liter i diakrytyki. Uwaga implementacyjna:
`Ł`/`ł` (U+0141/U+0142) to litera z kreską, nie baza + znak łączący, więc NFD jej
nie rozkłada — dodano jeden jawny fold `ł → l` po `toLowerCase()`. Pozostałe
polskie znaki (ą ć ę ń ó ś ź ż) rozkładają się normalnie. Bez nowej zależności.

Pliki: `src/components/mentionAutocomplete.ts` (nowy),
`src/components/mentionAutocomplete.test.ts` (nowy),
`src/components/CommentsPanel.tsx`, `src/styles.css`.

### 5. Przebieg po review

Reviewer (read-only) wydał werdykt **`approved-with-nits`, bez blokerów**.
Trzy nity poprawiono osobnym, wąskim przebiegiem:

- nieaktualny komentarz CSS przy wierszu powiadomienia (mówił, że klik „otwiera
  obiekt”);
- podpowiedź o godzinie startu renderowała się też w trybie `readOnly`, gdzie
  pole godziny i tak nie istnieje;
- **istotny defensywnie**: seed `startTimes` w `TaskModal` kopiował
  `w.startMinutes` z persystencji bez `snapToStep`. Dziś bezpieczne (storage
  naprawia wartości spoza siatki przy wczytaniu, a każda obecna ścieżka zapisu
  pilnuje siatki 15 min), ale gdyby przyszła ścieżka zapisu ten guard pominęła,
  seed spoza siatki wróciłby w payloadzie `SAVE_TASK` i nowy guard odrzuciłby
  **cały** zapis po cichu (inwariant 6 → ta sama referencja stanu, użytkownik
  nie widzi nic). Normalizacja seeda i edycji korzysta teraz ze wspólnego
  helpera `normalizeStartMinutes`, więc obie ścieżki nie mogą się rozjechać.

## Zmiany

Zmodyfikowane: `src/store/AppStore.tsx`, `src/store/saveTaskWorkload.test.ts`,
`src/components/AllocationGrid.tsx`, `src/components/TaskModal.tsx`,
`src/components/CommentsPanel.tsx`, `src/pages/DashboardPage.tsx`,
`src/pages/dashboardPanels.ts`, `src/pages/dashboardPanels.test.ts`,
`src/pages/TimelinePage.tsx`, `src/pages/timelineZoom.ts`,
`src/pages/timelineZoom.test.ts`, `src/utils/dates.ts`,
`src/utils/dates.test.ts`, `src/styles.css`, `handoffs/RUN-STATE.md`.

Nowe: `src/components/mentionAutocomplete.ts`,
`src/components/mentionAutocomplete.test.ts`,
`handoffs/packages/PKG-20260727-{alloc-start-hour,timeline-day-headers,notification-preview,mention-autocomplete}.md`.

Bez zmian w `package.json` — żadnej nowej zależności runtime.
`DATA_VERSION` pozostaje 7 (`WorkloadEntry.startMinutes` już istniało).
Bez zmian w migracjach, RLS i schemacie Supabase.

## Weryfikacja

- Testy skupione per punkt (w trakcie iteracji, wszystkie zielone):
  - poz. 1 — `npx vitest run src/store/saveTaskWorkload.test.ts src/store/blockActions.test.ts src/utils/time.test.ts src/components/taskSaveBlockers.test.ts` → 214 pass / 0 fail
  - poz. 2 — `npx vitest run src/pages/timelineZoom.test.ts src/utils/dates.test.ts` → 59 pass / 0 fail
  - poz. 3 — `npx vitest run src/pages/dashboardPanels.test.ts src/utils/notifications.test.ts src/supabase/notifications.test.ts` → 32 pass / 0 fail
  - poz. 4 — `npx vitest run src/components/mentionAutocomplete.test.ts` → 17 pass / 0 fail
- Pełny zestaw po scaleniu wszystkich czterech punktów i po przebiegu nitów:
  **`npm test` → 69 plików / 1607 testów pass, 0 fail** (bez regresji).
- **`npm run build` (tsc --noEmit + vite build) → zielony.**
- Sprawdzone ręcznie, że wszystkie siedem nowych bloków we współdzielonym
  `src/styles.css` przetrwało równoległe zapisy trzech agentów (żaden zapis nie
  został zgubiony).
- Testy przeglądarkowe: **nie uruchamiano** — żaden punkt nie zmienia cyklu
  życia wskaźnika kalendarza/zasobnika ani celowania w renderowane kolumny;
  nowe kontrolki to natywny `<input type="time">` i zwykła lista Reactowa.
  Matrycę przeglądarkową posiada weryfikacja wydania.

## Ryzyka / rzeczy do sprawdzenia

- **Pakiet poz. 1 deklaruje `Codex review: required`** (rekoncyliacja
  `SAVE_TASK`, inwariant 4/6). W momencie pisania raportu nie istnieje artefakt
  Codeksa dla tego runu — zgodnie z kontraktem uruchamia go scheduler po
  wyjściu procesu implementacyjnego. Reviewer przeczytał tę powierzchnię wprost
  (kompozycja guardu, umiejscowienie post-passu, identyczność referencji,
  granice `clampBlockStart`) i nie znalazł defektu, ale nie zastępuje to
  wymaganego przebiegu Codeksa.
- Przypięta godzina może świadomie utworzyć nakładkę bloków — to zgodne
  z inwariantem 3 (edycje alokacji w TaskModal mogą się nakładać, blokowany jest
  tylko drag/resize w kalendarzu i automatyczne umiejscowienie). Nie jest to
  błąd, ale to widoczna zmiana zachowania dla użytkownika.
- Pin przycięty przez `clampBlockStart` (np. 23:00 przy 4 h → 20:00) zostawia
  w polu wpisaną godzinę 23:00 do czasu ponownego otwarcia modala. Świadoma
  konsekwencja decyzji „przycinaj, nigdy nie odrzucaj”; wyłącznie UX.
- Dni z ≥2 blokami nie mają pola godziny i nie są przez post-pass ruszane —
  celowe, ale użytkownik nie dostaje tam żadnego komunikatu poza istniejącym
  znacznikiem `×N`.
- W polu komentarza lista podpowiedzi może przez jedną klatkę mignąć po
  wstawieniu wzmianki (`body` zaktualizowane, `caret` jeszcze nie, do czasu
  efektu ustawiającego zaznaczenie). Wyłącznie wizualne; wstawiony tekst jest
  poprawny.
- `src/pages/DashboardPage.tsx` ma w nagłówku pliku nieaktualny komentarz
  („Powiadomienia to tylko slot UI, bez źródła danych”). Był nieaktualny już
  przed tym zadaniem — nie ruszano go, żeby nie rozszerzać zakresu.
- Nagłówek osi czasu przy zoomie `month` nadal używa etykiet tygodniowych
  (poniedziałki + dzień 0), co przy 30 px/dzień bywa ciasne. Poza zakresem
  zgłoszenia.
- Decyzja wiki: **`wiki unchanged`**. Żadna zadeklarowana strona nie stała się
  nieprawdziwa — `state-and-persistence.md` nie wylicza pól `AllocationCell`
  i jego opis `SAVE_TASK` („delty zachowujące tożsamość”) nadal obowiązuje;
  `scheduling-and-calendar.md` już stwierdza, że alokacje z TaskModal mogą się
  nakładać, a `findFreeStart` jest nietknięty; `ui-navigation-and-onboarding.md`
  nigdy nie twierdziło, że klik w powiadomienie otwiera obiekt, i nie opisuje
  kontraktu nagłówka osi czasu.

## Podpis schedulera

- Run: `20260727-214256-n2hub-276-tickets-small-features`
- Prompt: `276-tickets-small-features.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `6818e27d3e9f824ff13ec065feb88672522a5e14`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `6818e27d3e9f824ff13ec065feb88672522a5e14`
- Gałąź review: `review-integration`
- Run: `20260727-214256-n2hub-276-tickets-small-features`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `src/components/AllocationGrid.tsx`
- `src/components/CommentsPanel.tsx`
- `src/components/TaskModal.tsx`
- `src/pages/DashboardPage.tsx`
- `src/pages/TimelinePage.tsx`
- `src/pages/dashboardPanels.test.ts`
- `src/pages/dashboardPanels.ts`
- `src/pages/timelineZoom.test.ts`
- `src/pages/timelineZoom.ts`
- `src/store/AppStore.tsx`
- `src/store/saveTaskWorkload.test.ts`
- `src/styles.css`
- `src/utils/dates.test.ts`
- `src/utils/dates.ts`
- `handoffs/packages/PKG-20260727-alloc-start-hour.md`
- `handoffs/packages/PKG-20260727-mention-autocomplete.md`
- `handoffs/packages/PKG-20260727-notification-preview.md`
- `handoffs/packages/PKG-20260727-timeline-day-headers.md`
- `handoffs/scheduler-reviews/20260727-214256-n2hub-276-tickets-small-features.md`
- `src/components/mentionAutocomplete.test.ts`
- `src/components/mentionAutocomplete.ts`
