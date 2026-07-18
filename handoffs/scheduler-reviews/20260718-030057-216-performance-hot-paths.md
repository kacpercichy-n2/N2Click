# Raport workflow: 20260718-030057-216-performance-hot-paths

## Wykonane

Routing TierWorkflow: `developer → reviewer` — prompt kolejki był kompletnym
pakietem handoff (dokładna poprawka na plik + lista testów, zero nierozstrzygniętych
decyzji), a nowe testy są nierozłączne z implementacją, więc architect nie wnosił
wartości. Cztery czysto wydajnościowe poprawki, zachowanie identyczne:

1. **`src/supabase/cloudMirror.ts` (`diffToCloudOps`)** — szybka ścieżka
   referencyjna: każdy z bloków kolekcji (klienci, profile osób, projekty,
   kamienie milowe, zadania, przypisania, godziny, komentarze, aktywność) jest
   w całości pomijany, gdy `prev.X === next.X` (reduktor zachowuje tożsamość
   nietkniętych kolekcji — inwariant 6), a w pętlach upsert `before === wiersz`
   ucina porównanie przed jakimkolwiek `JSON.stringify` (fallback stringify
   zachowany dla wierszy odtworzonych z tą samą treścią). Koszt diffu spadł do
   O(zmienionych wierszy); kolejność i treść operacji bez zmian.
2. **`src/store/selectors.ts`** — usunięte skany O(W²): nowa wewnętrzna
   agregacja `bookedHoursByPersonDate` (jedno przejście po `state.workload`,
   wiersze zasobnika pomijane, cache w module w `WeakMap` kluczowanym referencją
   tablicy `workload`, więc nie może się zdezaktualizować ani wyciekać).
   Przepisane na nią: `overloadedDatesForPersonInRange`, `overloadedPeopleOnDate`,
   `conflictDatesForTask`, `conflictDatesForTaskPerson`. Sygnatury, kolejność
   wyników i semantyka (booked > available wg `availableHoursOnDate`) bez zmian;
   `dayAvailabilityForPerson`/`hoursForPersonOnDate`/`rangeAvailabilityForPerson`
   nietknięte.
3. **`src/pages/WorkloadPage.tsx`** — `hoursFor` nie filtruje już wszystkich
   wpisów tygodnia na komórkę (~3× na komórkę): mapa `${personId}|${date}`
   budowana raz na render z przefiltrowanych `weekEntries`, `hoursFor` to
   odczyt z mapy z domyślnym 0. Wyrenderowany wynik identyczny.
4. **`src/store/AppStore.tsx` — churn inwariantu 6**: odrzucone komendy zwracają
   teraz PIERWOTNĄ referencję stanu zamiast świeżej kopii (stale double-click nie
   przechodzi już przez persist + broadcast kart + diff chmury): `DELETE_TASK`,
   `DELETE_PROJECT`, `DELETE_CLIENT` (guard przed kaskadą), `SET_PASSWORD`
   (nieznana osoba), `LOGOUT` (nikt nie zalogowany), `DELETE_DEPARTMENT`,
   `DELETE_SERVICE_TYPE`, `DELETE_WORK_CATEGORY` (nieznane id). `deleteStatus`
   już zwracał pierwotną referencję na wszystkich ścieżkach odrzucenia — bez
   zmiany, dopisany test regresyjny (zablokowane usunięcie ostatniego statusu
   done).

Bez nowych stringów UI; wszystkie polskie teksty nietknięte.

## Zmiany

- `src/supabase/cloudMirror.ts` — fast-path referencyjny w `diffToCloudOps`.
- `src/store/selectors.ts` — agregacja `bookedHoursByPersonDate` (WeakMap) +
  4 selektory overload/konflikt przepisane na O(W).
- `src/pages/WorkloadPage.tsx` — jednoprzejściowa mapa godzin per (osoba, dzień).
- `src/store/AppStore.tsx` — 8 komend zwraca pierwotną referencję przy odrzuceniu.
- `src/supabase/cloudMirror.test.ts` — nowe testy: identyczny stan ⇒ zero
  operacji i diagnostyk; cykliczny obiekt w NIEZMIENIONEJ kolekcji (stringify by
  rzucił) dowodzi braku serializacji przy zmianie innej kolekcji; reużyty wiersz
  w zmienionej kolekcji ⇒ operacja tylko dla faktycznie zmienionego wiersza.
- `src/store/selectors.test.ts` — fixture parytetu: wyniki 4 przepisanych
  selektorów identyczne z naiwną referencyjną implementacją (przez nietknięte
  `dayAvailabilityForPerson`), w tym osoba-duch spoza `state.people`, wiersze
  zasobnika, pusty `personFilter` (= brak filtra) i przypięta kolejność wyników.
- `src/store/commandValidation.test.ts` — 9 przypadków `expect(result).toBe(state)`
  dla odrzuconych komend (nieznane id, `SET_PASSWORD` nieznana osoba, `LOGOUT`
  bez zalogowanego, zablokowany `DELETE_STATUS`).
- `handoffs/RUN-STATE.md` — dopisana sekcja runu 216.

## Weryfikacja

- `npm test`: **976/976 passed** (35 plików) — uruchomione przez developera i
  ponownie niezależnie przez orchestratora; zielone.
- `npm run build`: **pass** (`tsc` + `vite build`); ostrzeżenie o chunku
  > 500 kB jest istniejące wcześniej, bez zmian.
- Sprawdzone, że żaden istniejący test nie zakładał przycinania sierot przy
  usunięciu nieistniejącego id (ryzyko z handoffu — nie wystąpiło).

## Ryzyka / rzeczy do sprawdzenia

- Ścieżki drag/selektory (inwariant 7) zmienione wyłącznie wewnętrznie —
  sygnatury, kolejność i semantyka przypięte testami parytetu; pełne scenariusze
  przeglądarkowe pozostają w gestii weryfikacji wydań (zmiana nie dotyka
  interakcji, tylko koszt obliczeń).
- Degeneracyjne wejście `date === ''` do selektorów overload nigdy nie występuje
  u wywołujących (daty pochodzą z zakresów tygodni); dla realnych dat zachowanie
  jest tożsame, co przypina test parytetu.
- `wiki unchanged` — granice, inwarianty i trasy testów z
  `state-and-persistence.md` i `scheduling-and-calendar.md` pozostają aktualne
  (zmiany czysto wydajnościowe, bez przesunięcia granic).

## Podpis schedulera

- Run: `20260718-030057-216-performance-hot-paths`
- Prompt: `216-performance-hot-paths.md`
- Gałąź review: `review-integration`
- Baza: `65c69385131d1d633455b52eb1706e21016f2898`


## Gate schedulera

- `npm test`: zaliczone
- `npm run build`: zaliczone
- Baza: `65c69385131d1d633455b52eb1706e21016f2898`
- Gałąź review: `review-integration`
- Run: `20260718-030057-216-performance-hot-paths`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `src/pages/WorkloadPage.tsx`
- `src/store/AppStore.tsx`
- `src/store/commandValidation.test.ts`
- `src/store/selectors.test.ts`
- `src/store/selectors.ts`
- `src/supabase/cloudMirror.test.ts`
- `src/supabase/cloudMirror.ts`
- `handoffs/scheduler-reviews/20260718-030057-216-performance-hot-paths.md`
