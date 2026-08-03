# Raport workflow: 20260803-103604-n2hub-308-cyklicznosc-co-x-tygodni

## Wykonane

Analiza wstępna potwierdziła, że zadanie było aktualne: `intervalWeeks` nie
występowało nigdzie w kodzie, a `TaskRecurrence` obsługiwał wyłącznie sztywne
„co tydzień". Trasa tier: orkiestrator → developer (implementacja + testy w
jednym pakiecie, pojedyncza granica — matematyka rekurencji jest
scentralizowana w `src/utils/recurrence.ts`) → reviewer schedulera.

1. **Model** (`src/types.ts`): `TaskRecurrence.intervalWeeks?: number` —
   forma kanoniczna: klucz obecny wyłącznie dla integera 2–8, wartość 1 =
   klucz nieobecny (pełna kompatybilność wsteczna, idempotentny round-trip).
   Pole opcjonalne i addytywne, `DATA_VERSION` zostaje 7. Wydarzenia reużywają
   ten sam typ, więc dostają interwał automatycznie.
2. **Matematyka** (`src/utils/recurrence.ts`): tydzień aktywny liczony od
   poniedziałku tygodnia ISO kotwicy:
   `floor(diffDays(weekStart(anchor), date) / 7) % interval === 0`. Bramka
   dodana spójnie w `normalizeRecurrenceRule`, `isOccurrenceDate` i pętli
   `expandOccurrences` — przez centralizację pokrywa wszystkie ścieżki
   materializacji/wyświetlania (selektory kalendarza dla zadań i wydarzeń,
   walidację overrides w reduktorze, `commandValidation`, repair storage,
   hydrację chmury). Dodane `INTERVAL_WEEKS_OPTIONS` i `intervalWeeksLabel`
   (polska odmiana: „co tydzień" / „co 2–4 tygodnie" / „co 5–8 tygodni").
3. **Walidacja payloadu chmurowego**: w `normalizeRecurrenceRule` wartość
   spoza integera 2–8 (brak, null, 1, ułamek, string, 0, 9, NaN…) jest
   traktowana jak brak klucza (=1) i NIGDY nie unieważnia całej reguły —
   inwariant 6 (zły payload → ta sama referencja stanu) bez zmian. Chmura bez
   migracji: `recurrence` idzie do jsonb w całości, hydracja przechodzi przez
   `normalizeRecurrence` idempotentnie. Tryb retirement nietknięty.
4. **UI**: select „Powtarzaj" (1–8) w edytorach rekurencji TaskModal i
   EventModal, spójny z istniejącymi polami formularzy; wartość 1 wyświetla
   „co tydzień" i nie trafia do modelu. Dodatkowo badge listy wydarzeń
   (`EventsPage.recurrenceLabel`) dokleja sufiks „(co 2 tygodnie)" tylko przy
   interwale > 1 — dla danych bez klucza tekst pozostaje bajt w bajt jak dotąd.
5. **Wiki**: zaktualizowane 2 pliki, w których kształt kanoniczny
   `tasks.recurrence` był wyliczony wprost: `openwiki/n2hub/cloud-database.md`
   i `openwiki/n2hub/state-and-persistence.md` (dopisany `intervalWeeks` i
   zasada liczenia tygodnia od kotwicy).

## Zmiany

- `src/types.ts` — pole `intervalWeeks?` z komentarzem formy kanonicznej.
- `src/utils/recurrence.ts` — bramka tygodnia w normalizacji, predykacie i
  ekspansji; stałe zakresu i etykiety PL.
- `src/components/TaskModal.tsx`, `src/components/EventModal.tsx` — select
  „Powtarzaj" w obu edytorach rekurencji.
- `src/pages/EventsPage.tsx` — sufiks interwału w badge'u „Cykliczne: …".
- `src/utils/recurrence.test.ts` — +16 testów (interwały 1/2/4, okno
  startujące w martwym tygodniu, kotwica w środku tygodnia, kompatybilność
  wsteczna, normalizacja wartości niepoprawnych, idempotencja, drop override
  z martwego tygodnia, etykiety).
- `src/supabase/plannerData.test.ts` — +1 test round-tripu mirror → jsonb →
  hydracja dla `intervalWeeks: 2`.
- `openwiki/n2hub/cloud-database.md`, `openwiki/n2hub/state-and-persistence.md`
  — aktualizacja opisu formy kanonicznej.
- `handoffs/RUN-STATE.md` — notka runu.

## Weryfikacja

- `npm test` (worker, pełny): 107 plików / 2256 testów, wszystkie zielone.
- `npm run build` (`tsc --noEmit && vite build`): zielony.
- Gate (`npm test && npm run build`): oczekuje na scheduler

## Ryzyka / rzeczy do sprawdzenia

- Zmiana interwału na istniejącej regule dropuje wyjątki (`overrides`), które
  wpadły w nowo martwe tygodnie — spójne z dotychczasowym zachowaniem przy
  zmianie `daysOfWeek`, ale UI o tym nie ostrzega.
- `recurrenceLabel` w EventsPage pozostaje prywatną funkcją komponentu (strona
  nie ma testów); logika nośna etykiety jest pokryta testami
  `intervalWeeksLabel`. Ewentualna asercja na samym badge'u wymagałaby
  wyniesienia helpera do osobnego modułu — poza zakresem chirurgicznym.
- Wydajność bez zmian: bramka tygodnia to jedno `diffDays` na dzień w oknie
  ograniczonym istniejącym capem 400 dni.

## Podpis schedulera

- Run: `20260803-103604-n2hub-308-cyklicznosc-co-x-tygodni`
- Prompt: `308-cyklicznosc-co-x-tygodni.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `5a834be0aa3ae5d6e8d1cb4bdbb823231ee2c6ce`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `5a834be0aa3ae5d6e8d1cb4bdbb823231ee2c6ce`
- Gałąź review: `review-integration`
- Run: `20260803-103604-n2hub-308-cyklicznosc-co-x-tygodni`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `openwiki/n2hub/cloud-database.md`
- `openwiki/n2hub/state-and-persistence.md`
- `src/components/EventModal.tsx`
- `src/components/TaskModal.tsx`
- `src/pages/EventsPage.tsx`
- `src/supabase/plannerData.test.ts`
- `src/types.ts`
- `src/utils/recurrence.test.ts`
- `src/utils/recurrence.ts`
- `handoffs/scheduler-reviews/20260803-103604-n2hub-308-cyklicznosc-co-x-tygodni.md`
