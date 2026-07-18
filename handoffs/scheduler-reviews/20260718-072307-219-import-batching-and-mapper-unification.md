# Raport workflow: 20260718-072307-219-import-batching-and-mapper-unification

## Wykonane

Pełny zakres promptu 219 (wszystkie trzy refaktory) dostarczony przez workflow
`architect → developer×2 → reviewer`:

1. **Hybrydowy import wsadowy** — `runSupabaseImport` w `src/supabase/dataImport.ts`
   nie wstawia już wierszy pojedynczo. Każda kolekcja akumuluje gotowe wiersze i
   wysyła je paczkami po ≤100 (`insertMany` w `ImportDb`); przy błędzie paczki
   następuje fallback per-wiersz w oryginalnej kolejności, więc każda
   diagnostyka zachowuje swoje `entityId`. Liczniki, `idMap`-y,
   `availableProjectIds/TaskIds` i pary junction rejestrują się wyłącznie po
   potwierdzonym sukcesie. Dla słowników i działów dodano regułę
   flush-on-dependency (skip-by-key w obrębie jednego przebiegu działa jak w
   kodzie sekwencyjnym). Import pozostaje insert-only i idempotentny.
2. **Wspólny moduł mapperów wierszy** — nowy `src/supabase/rowMappers.ts` jest
   jedynym właścicielem nazw kolumn dla 7 rodzin mapowanych po obu stronach
   (clients, projects, tasks, milestones, workload_entries, comments,
   activity_events). `cloudMirror.ts` i `dataImport.ts` konsumują go, zachowując
   swoje dotychczasowe polityki braków słownikowych (mirror: drop + diagnostyka;
   import: null przez `dictRef`; impersonator: null po obu stronach — zgodnie z
   ustaleniem promptu 212). Przyszła zmiana schematu edytowana jest w jednym
   miejscu.
3. **Metadane pochodzenia akcji zamiast denylisty SUPPRESSED** — nowy typ
   `ActionOrigin = 'cloud' | 'local'` na akcjach (`AppStore.tsx`),
   `lastActionRef` niesie `{ type, origin }`, a czysty helper
   `shouldMirrorTransition` w nowym `src/supabase/mirrorGate.ts` zastępuje
   usunięty zbiór `SUPPRESSED` w `CloudSyncProvider.tsx`. Otagowano żywe
   dispatch-e: `MERGE_CLOUD_ENTITIES`, oba `REPLACE_FROM_STORAGE`,
   `LOAD_SAMPLE` (`RESET_ALL` nie ma żywego miejsca dispatchu — pokryty testem
   helpera). Reducer ignoruje `origin`; niewymieniona hipotetyczna akcja
   masowa z `origin: 'cloud'` nie emituje żadnych opów (test
   denylist-independence z `BULK_HYDRATE_V2`).

Testy: awaria wiersza w środku paczki zachowuje diagnostykę per-wiersz i
importuje rodzeństwo; happy-path nie wykonuje żadnego insertu per-wiersz;
flush-on-dependency; parzystość kształtów wierszy (istniejące asercje
`cloudMirror.test.ts` / `dataImport.test.ts` bez osłabień); tłumienie przez
`origin` (nowy `mirrorGate.test.ts`).

## Zmiany

- `src/supabase/dataImport.ts` — wsadowy pipeline importu z fallbackiem per-wiersz.
- `src/supabase/rowMappers.ts` (nowy) — wspólne mapowanie domena→kolumny.
- `src/supabase/cloudMirror.ts` — buildery `*Row` delegują do `rowMappers`.
- `src/supabase/mirrorGate.ts` (nowy) + `src/supabase/mirrorGate.test.ts` (nowy)
  — czysta bramka tłumienia mirrora oparta na `origin`.
- `src/supabase/CloudSyncProvider.tsx` — usunięty `SUPPRESSED`, bramka przez
  `shouldMirrorTransition`, otagowany `MERGE_CLOUD_ENTITIES`.
- `src/store/AppStore.tsx` — `ActionOrigin`, poszerzony wrapper dispatch,
  otagowane `REPLACE_FROM_STORAGE`.
- `src/components/SampleBanner.tsx` — otagowany `LOAD_SAMPLE`.
- `src/supabase/dataImport.test.ts` — `FakeDb.insertMany` + nowe testy wsadowe.
- `handoffs/RUN-STATE.md` — log przebiegu.

## Weryfikacja

- `npx vitest run src/supabase` / `src/store` (workerzy, iteracyjnie): zielone.
- `npm test` (pre-flight orkiestratora): 38 plików, 1006/1006 testów — PASS.
- `npm run build` (tsc strict + vite): PASS.
- Reviewer (read-only): brak defektów blokujących w kodzie; werdykt techniczny
  pozytywny. Formalny werdykt `codex-requested` wyłącznie z powodu braku
  artefaktu Codex, który zgodnie z kontraktem powstaje dopiero po zakończeniu
  tego procesu (`scripts/codex-review.sh`). Decyzja wiki: **wiki unchanged** —
  żadna z zadeklarowanych stron nie opisywała denylisty ani mechaniki insertów
  per-wiersz; granice pozostają aktualne.

## Ryzyka / rzeczy do sprawdzenia

- Kolejność kluczy w wierszach importu projects/tasks zmieniła się na kolejność
  mirrora (identyczny zbiór kluczy i wartości; PostgREST mapuje po nazwach —
  semantycznie neutralne).
- Literalny duplikat id/pary w obrębie jednej kolekcji w jednym przebiegu
  skończyłby się teraz `failed` + diagnostyka zamiast `skipped`; nieosiągalne
  dla poprawnych eksportów (id unikalne z konstrukcji).
- Kolejność diagnostyk w obrębie kolekcji może się przesunąć (raport po flushu);
  treść diagnostyk per `entityId` bez zmian.
- `RESET_ALL` nie ma żywego miejsca dispatchu — tłumienie pokryte na poziomie
  helpera; sonda retirement w `migrationStatus.ts` świadomie poza modułem
  mapperów (wiersz syntetyczny, poza 7 rodzinami).

## Podpis schedulera

- Run: `20260718-072307-219-import-batching-and-mapper-unification`
- Prompt: `219-import-batching-and-mapper-unification.md`
- Gałąź review: `review-integration`
- Baza: `3a1afbbd4287c69296f2ad73ea0f3da22880733b`


## Gate schedulera

- `npm test`: zaliczone
- `npm run build`: zaliczone
- Baza: `3a1afbbd4287c69296f2ad73ea0f3da22880733b`
- Gałąź review: `review-integration`
- Run: `20260718-072307-219-import-batching-and-mapper-unification`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `src/components/SampleBanner.tsx`
- `src/store/AppStore.tsx`
- `src/supabase/CloudSyncProvider.tsx`
- `src/supabase/cloudMirror.ts`
- `src/supabase/dataImport.test.ts`
- `src/supabase/dataImport.ts`
- `handoffs/scheduler-reviews/20260718-072307-219-import-batching-and-mapper-unification.md`
- `src/supabase/mirrorGate.test.ts`
- `src/supabase/mirrorGate.ts`
- `src/supabase/rowMappers.ts`
