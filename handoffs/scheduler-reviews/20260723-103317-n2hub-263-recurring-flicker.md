# Raport workflow: 20260723-103317-n2hub-263-recurring-flicker

## Wykonane

**Diagnoza: migotanie NIE występuje już w bieżącym buildzie — usterka jest naprawiona u
źródła przez istniejącą infrastrukturę scalania.** Prześledziłem pełny round-trip syncu i
zweryfikowałem trzy hipotezy z promptu:

- **Hipoteza (a) — gubienie `recurrence` w round-tripie: ODRZUCONA.** Zapis
  (`cloudMirror.ts` `taskRow` ~271–274) utrwala regułę do jsonb DOSŁOWNIE
  (`recurrence: t.recurrence ?? null`). Odczyt (`plannerData.ts` ~486–492) uruchamia
  `normalizeRecurrence(row.recurrence, startDate)`, która jest **idempotentna na formie
  kanonicznej** (ta sama forma, jaką utrwala reduktor w `SET_TASK_RECURRENCE`). Round-trip
  daje wartość deep-equal, więc reguła nie znika w żadnym kierunku.
- **Hipoteza (b) — oscylacja bramki draft/published: ODRZUCONA jako źródło stałego
  migotania.** `SET_TASK_RECURRENCE` odrzuca szkice (`AppStore.tsx` ~964), więc reguła
  żyje wyłącznie na zadaniu opublikowanym; publikacja jest jednokierunkowa (osobne akcje
  `PUBLISH_*`), więc `isDraft` nie oscyluje w stanie ustalonym. Szkic nigdy nie niesie
  reguły, więc nie ma czego migotać. (Przejściowe okno optimistic-vs-cloud podczas samej
  publikacji byłoby jednorazowe, nie rytmiczne ~1,2 s.)
- **Hipoteza (c) — klucz memo widoku tygodnia: ODRZUCONA.** `WeekView.tsx` ~1289
  memoizuje `buildWeekModel(state, days, filter)` po CAŁYM `state`. `recurrenceOccurrencesForDate`
  (`selectors.ts` ~358) czyta regułę wprost ze `state`, więc model zawsze odzwierciedla
  bieżącą wartość — nie ma przestarzałego klucza.

**Właściwa naprawa już istnieje**: `mergeCloudEntities` → `reconcileRows` + `sameRowValue`
(`AppStore.tsx` ~2559–2812). Wiersz zadania wartościowo identyczny z chmurą zachowuje SWOJĄ
referencję, a niezmieniona kolekcja — całą tablicę, więc autorytatywne odświeżenie Realtime
nie unieważnia `useMemo` modelu tygodnia (komentarz „źródło migotania” w kodzie ~2581).
Reguła cykliczna jest częścią tej ścieżki symetrycznie z resztą pól zadania.

**Uzupełniona luka w testach**: dotychczas każdy odcinek round-tripu był pokryty osobno
(zapis: `cloudMirror.test.ts` ~256; odczyt: `plannerData.test.ts` ~299; scalenie:
`cloudMerge.test.ts` ~876 — ale przez naiwny klon `JSON.parse/stringify`, który OMIJA
prawdziwy `taskRow` i `normalizeRecurrence`). Dodałem jeden test spinający cały łańcuch
end-to-end (patrz niżej), jako regresyjny strażnik dokładnie tej usterki.

## Zmiany

- `src/supabase/plannerData.test.ts` — nowy test round-trip end-to-end:
  „round-trip opublikowanego zadania cyklicznego: reguła, wystąpienia i referencja stanu
  (brak migotania)”. Buduje opublikowane zadanie z regułą (Pn/Śr 9:00, wyjątki: pominięcie
  + przesunięcie), przeprowadza je przez `diffToCloudOps` (mirror) → `loadPlannerSnapshot`
  (hydracja) → `reducer(MERGE_CLOUD_ENTITIES)` i asertuje: (1) reguła w jsonb dosłownie i
  wiersz opublikowany, (2) reguła po hydracji deep-equal, (3) wystąpienia deterministycznie
  identyczne w oknie tygodnia (te same daty/minuty/flaga override), (4) MERGE zachowuje TĘ
  SAMĄ referencję wiersza i całej kolekcji `tasks` (dowód braku unieważnienia memo).
  Dodane importy: `reducer`, `expandOccurrences`, `normalizeRecurrence`.
- Brak zmian w kodzie produkcyjnym — usterka nie występuje w bieżącym buildzie.

## Weryfikacja

- `npm test`: **zielony — 57 plików, 1413 testów** (nowy test przechodzi; zero regresji).
- `npm run build` (`tsc --noEmit && vite build`): **zielony** (2649 modułów, build OK;
  jedynie zwykłe ostrzeżenie o rozmiarze chunku, bez zmian).
- Wiki: bez zmian — żadna granica, inwariant ani trasa testowa nie stała się nieaktualna
  (dodano wyłącznie test pokrywający istniejące zachowanie).

## Ryzyka / rzeczy do sprawdzenia

- **Zakres testu**: nowy test pokrywa ścieżkę zadania OPUBLIKOWANEGO (jedyną, na której
  reguła może istnieć — inwariant formy kanonicznej). Przejściowego okna optimistic podczas
  samej publikacji nie da się sensownie odtworzyć w teście jednostkowym reduktora; z analizy
  jest ono jednorazowe (nie rytmiczne), a `INVARIANT 1` (brak materializacji wystąpień jako
  `WorkloadEntry`) pozostaje zachowany.
- Jeśli użytkownik nadal obserwuje migotanie w praktyce, najbardziej prawdopodobne pozostałe
  źródło leży POZA round-tripem reguły (np. przeciążony debounce Realtime lub zmiana INNEGO
  pola zadania co sync) — ale to nie usuwałoby wystąpień („pojawia się i znika”), tylko
  przerysowywało obecne. Round-trip samej cykliczności jest teraz udowodniony jako stabilny.

## Podpis schedulera

- Run: `20260723-103317-n2hub-263-recurring-flicker`
- Prompt: `263-recurring-flicker.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `a0be07ae9a3dd1b1a36cd9b2a4222f860b11b487`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `a0be07ae9a3dd1b1a36cd9b2a4222f860b11b487`
- Gałąź review: `review-integration`
- Run: `20260723-103317-n2hub-263-recurring-flicker`

### Pliki zgłoszone do review

- `src/supabase/plannerData.test.ts`
- `handoffs/scheduler-reviews/20260723-103317-n2hub-263-recurring-flicker.md`
