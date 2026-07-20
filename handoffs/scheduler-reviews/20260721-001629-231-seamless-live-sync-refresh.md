# Raport workflow: 20260721-001629-231-seamless-live-sync-refresh

## Wykonane

### Czy zadanie było nadal aktualne?

Tak. Sprawdziłem stan bieżącej gałęzi przed implementacją:

- **Debounce już istniał** (`scheduleLiveSync`, 1200 ms) — serie zdarzeń
  Realtime były już zlewane w jedno odświeżenie, więc punktu 3 nie trzeba było
  wprowadzać, tylko potwierdzić.
- **Migotanie nadal było obecne** — dwie realne przyczyny (niżej). W repo nie ma
  i nie było żadnego `mergeById`; hipoteza z promptu o „niedziałającym
  mergeById” była nietrafna, bo taki helper po prostu nie istniał.

### Zdiagnozowana przyczyna źródłowa

Dwie niezależne przyczyny, obie w ścieżce
`postgres_changes → performLiveSync → runHydration → MERGE_CLOUD_ENTITIES`:

1. **Hurtowa podmiana wszystkich kolekcji.** `mergeCloudEntities`
   (`src/store/AppStore.tsx`) kończyło się `clients: [...payload.clients]`,
   `tasks: [...payload.tasks]`, `workload: [...payload.workload]` itd. Wiersze w
   ładunku to świeże obiekty zmapowane przez `plannerData.ts`, więc po KAŻDYM
   zdarzeniu Realtime — nawet gdy zmienił się jeden wiersz albo nic — **każdy
   obiekt i każda tablica dostawały nową referencję**. To unieważniało wszystkie
   `useMemo`/selektory widoków i wymuszało pełne przerysowanie kalendarza i
   mapy. To główne źródło migotania.
2. **Przełączanie wskaźnika ładowania dla odświeżeń w tle.** `runHydration`
   bezwarunkowo robiło `setStatus('hydrating')`, a `CloudSyncBanner` renderuje
   na tym statusie baner „Wczytywanie danych z serwera…”. Przy żywej
   synchronizacji (`status === 'ready' && live` → normalnie `null`) baner
   **pojawiał się i znikał** przy każdym zdarzeniu, przesuwając układ nad
   kalendarzem/mapą — widoczny skok.

Dodatkowe ryzyko wykryte przy okazji: scalenie w ŚRODKU przeciągania bloku
podmieniało `entry` pod kursorem, a przy wierszu nieznanym chmurze odmontowywało
komponent trzymający `setPointerCapture` — przechwycenie wskaźnika mogło zostać
niezwolnione (invariant 7).

### Zaimplementowana poprawka

1. **Scalanie zachowujące referencje** (`src/store/AppStore.tsx`):
   - `sameRowValue` — głęboka równość wartości dla płaskich danych JSON wiersza
     (konieczna, bo `Task.checklist` i `Comment.mentionIds` to zagnieżdżone
     tablice; porównanie płytkie fałszywie raportowałoby zmianę zawsze).
   - `reconcileRows` — chmura pozostaje autorytatywna (zbiór i KOLEJNOŚĆ wierszy
     z ładunku), ale wiersz identyczny wartościowo **zachowuje swoją
     dotychczasową referencję**, a kolekcja bez żadnej zmiany **zachowuje swoją
     tablicę**.
   - `keepArrayIfSame` — to samo dla `assignments` (uzgadnianych po parze
     `(taskId, personId)`, co już wcześniej zachowywało referencje wierszy).
   - Na końcu: gdy żaden klucz stanu się nie zmienił, zwracany jest
     **oryginalny obiekt stanu** — hydracja jest idempotentna.
   - Semantyka autorytatywności bez zmian: wiersze lokalne nieznane chmurze dalej
     odpadają, walidacja fail-closed i invariant 6 nietknięte (wszystkie
     wcześniejsze wyjścia `return state` zostały na miejscu, przed nową sekcją).
2. **Odświeżenie w tle bez wskaźnika ładowania**
   (`src/supabase/CloudSyncProvider.tsx`): `runHydration` przyjmuje
   `{ background }`. W trybie tła (wyłącznie ze stanu `ready`, czyli tylko
   ścieżka Realtime) status NIE spada do `hydrating`. Zachowane bez zmian:
   `setStatus('error')` przy realnym błędzie, baner konfliktu/uprawnień, baner
   „dane mogą być nieaktualne”, a ręczne „Odśwież dane z serwera” i ponowienie
   po błędzie dalej pokazują wskaźnik.
   - Parytet efektów ubocznych: ponieważ tło nie przechodzi przez krawędź
     `hydrating→ready`, w ścieżce tła wołam wprost `retryPersist()` (świeża kopia
     lokalna do odzysku) i dosynchronizowanie znacznika wycofania — dokładnie to,
     co robił dotąd efekt na krawędzi statusu.
3. **Blokada odświeżania na czas przeciągania** — nowy, czysty rejestr
   `src/utils/liveSyncGate.ts` (wzorowany na `dirtyRegistry`: klucz-obiekt zamiast
   licznika, więc nie da się „zgubić” zwolnienia). `TimedBlock` i `BinCard`
   (`WeekView.tsx`) trzymają blokadę na czas `drag !== null`, ze sprzątaniem przy
   odmontowaniu. `performLiveSync` przy aktywnej blokadzie **przeplanowuje** się
   tym samym debounce'em zamiast scalać — odświeżenie jest odroczone, nigdy
   porzucone. Cykl życia wskaźnika i istniejące ścieżki anulowania przeciągania
   (Escape, blur, `visibilitychange`, `pointercancel`) nietknięte.
4. **Debounce**: zweryfikowany, już istniał (1200 ms, `scheduleLiveSync`), plus
   istniejące odraczanie na czas drenażu kolejki i hydracji. Bez zmian.
5. **Wiki**: `openwiki/n2hub/state-and-persistence.md` — dopisany kontrakt
   bezszwowego odświeżania (trzy reguły: referencje, brak wskaźnika w tle,
   blokada przeciągania) oraz trasa testowa. Zmiana była potrzebna, bo boundary
   `MERGE_CLOUD_ENTITIES` ma teraz nowy, wiążący kontrakt referencyjny.

## Zmiany

- `src/store/AppStore.tsx` — `sameRowValue`, `reconcileRows`, `keepArrayIfSame`,
  przepisane wyjście `mergeCloudEntities`.
- `src/supabase/CloudSyncProvider.tsx` — tryb `background` w `runHydration`,
  odroczenie na blokadzie, parytet efektów ubocznych.
- `src/components/WeekView.tsx` — blokada żywej synchronizacji w `TimedBlock`
  i `BinCard`.
- `src/utils/liveSyncGate.ts` — nowy rejestr blokad (+ testy).
- `src/store/cloudMerge.test.ts` — nowy blok testów referencyjnych.
- `src/utils/liveSyncGate.test.ts` — nowy plik testów.
- `openwiki/n2hub/state-and-persistence.md` — kontrakt + trasa testowa.

## Weryfikacja

- `npm test` — **zielone: 39 plików, 1036 testów** (baza 1025, +11 nowych).
- `npm run build` (`tsc --noEmit && vite build`) — **zielone**.
- Nowe testy skupione:
  - `src/store/cloudMerge.test.ts`, blok „bezszwowe odświeżanie (referencje)” —
    ładunek bez zmian → ta sama referencja stanu; ta sama tablica dla każdej
    kolekcji; zmiana jednego wiersza nie rusza sąsiadów ani innych kolekcji;
    zagnieżdżone tablice porównywane wartościowo (i realna zmiana w `checklist`
    daje nowy obiekt); zmiana kolejności z chmury zachowuje referencje wierszy;
    usunięcie wiersza zmienia tylko swoją kolekcję; kontrola invariantu 6
    (zadanie wskazujące nieistniejący projekt → oryginalna referencja stanu).
  - `src/utils/liveSyncGate.test.ts` — brak blokad, cykl założenie/zdjęcie,
    równoległe przeciągania, odmontowanie w trakcie przeciągania, brak kumulacji
    przy powtórzonym ustawieniu.
- **Kontrola nie-wydmuszkowości**: odłożyłem zmiany w `AppStore.tsx`
  (`git stash`) i uruchomiłem nowy blok testów — testy referencyjne **padają na
  starym kodzie**, przechodzą po przywróceniu. Testy realnie pilnują poprawki,
  a nie tautologii.

### Jak zweryfikowałem brak migotania

Weryfikacja jest deterministyczna i jednostkowa, nie wizualna — migotanie było w
całości konsekwencją unieważnionych referencji i przełączanego statusu, więc obie
przyczyny dało się przypiąć testem/inspekcją zamiast oglądaniem:

- Przyczyna 1 przypięta wprost testami referencyjnymi: po scaleniu identycznego
  snapshotu React dostaje **ten sam obiekt stanu**, więc żaden konsument nie
  renderuje się ponownie (a zatem pozycja scrolla kalendarza, otwarty modal i
  zaznaczenie nie mają jak zniknąć — komponenty się nie odmontowują). Przy
  zmianie jednego wiersza przerysowuje się wyłącznie ta jedna kolekcja.
- Przyczyna 2 zweryfikowana przez odczyt ścieżki renderu: `CloudSyncBanner`
  renderuje baner ładowania wyłącznie dla `status === 'hydrating'`; ścieżka tła
  nie ustawia już tego statusu, a `setStatus('ready')` przy statusie już `ready`
  jest w Reakcie bailoutem (brak renderu). Przy `live === true` baner i tak
  zwraca `null`, więc w stanie ustalonym nie zmienia się nic w drzewie.
- **Nie uruchamiałem checku przeglądarkowego.** Zgodnie z CLAUDE.md check
  przeglądarkowy uruchamia się, gdy zmienia się pokryta nim interakcja — tu
  interakcje (drag/resize, modal) nie zmieniły semantyki, zmieniło się tylko to,
  KIEDY wolno je przerwać scaleniem. Pełna matryca przeglądarkowa należy do
  weryfikacji wydania.

## Ryzyka / rzeczy do sprawdzenia

- **Koszt porównania.** `sameRowValue` biegnie po każdym wierszu przy każdym
  odświeżeniu. Dane są płaskie i małe (rzędu setek wierszy), a koszt jest
  wielokrotnie niższy niż pełne przerysowanie widoków, którego unika. Przy bardzo
  dużych zbiorach warto by kiedyś porównywać po `updatedAt`, ale nie wszystkie
  rodziny (np. `workload`) mają taki znacznik — dlatego świadomie wybrałem
  porównanie wartościowe, bo jest poprawne dla wszystkich kolekcji.
- **Blokada przeciągania odracza, nie porzuca**, ale przy przeciąganiu trwającym
  bardzo długo odświeżenie czeka do jego końca (przeplanowanie co 1200 ms).
  Świadomy kompromis na rzecz invariantu 7.
- **Głodzenie debounce'u**: `scheduleLiveSync` resetuje timer przy każdym
  zdarzeniu, więc nieprzerwany strumień zapisów częstszy niż co 1200 ms mógłby
  teoretycznie odsuwać odświeżenie. Zachowanie zastane, nie zmieniałem go — nie
  było częścią zgłoszonego problemu, a dodanie górnego limitu oczekiwania
  dotknęłoby ścieżki wrażliwej na stabilność bez pokrycia testowego.
- **Ręczne odświeżenie i hydracja startowa świadomie NADAL pokazują baner** — to
  informacja zwrotna dla akcji zainicjowanej przez użytkownika, zgodnie z
  wymaganiem „wskaźnik tylko dla hydracji startowej”.
- Nie dotykałem ścieżki zapisu (`diffToCloudOps`), kolejki, RLS ani schematu
  bazy. Bez zmian w migracjach.

## Podpis schedulera

- Run: `20260721-001629-231-seamless-live-sync-refresh`
- Prompt: `231-seamless-live-sync-refresh.md`
- Gałąź review: `review-integration`
- Baza: `6257c267b97c7b15600d836c5b134d27e24d76ae`


## Gate schedulera

- `npm test`: zaliczone
- `npm run build`: zaliczone
- Baza: `6257c267b97c7b15600d836c5b134d27e24d76ae`
- Gałąź review: `review-integration`
- Run: `20260721-001629-231-seamless-live-sync-refresh`

### Pliki zgłoszone do review

- `openwiki/n2hub/state-and-persistence.md`
- `src/components/WeekView.tsx`
- `src/store/AppStore.tsx`
- `src/store/cloudMerge.test.ts`
- `src/supabase/CloudSyncProvider.tsx`
- `handoffs/scheduler-reviews/20260721-001629-231-seamless-live-sync-refresh.md`
- `src/utils/liveSyncGate.test.ts`
- `src/utils/liveSyncGate.ts`
