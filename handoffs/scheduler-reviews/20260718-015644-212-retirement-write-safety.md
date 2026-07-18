# Raport workflow: 20260718-015644-212-retirement-write-safety

## Wykonane

TierWorkflow, trasa `developer → reviewer` (jedna granica: ścieżka trwałości
w trybie wycofania; poprawki precyzyjnie wyspecyfikowane, testy nierozłączne
z implementacją — architekt zbędny). Pięć chirurgicznych poprawek utraty danych
i handshake'u na ścieżce wycofania zapisów lokalnych (potwierdzone znaleziska
ultra-review z 2026-07-17):

1. **Ciche gubienie niemapowalnych wierszy** — efekt lustra w
   `CloudSyncProvider.tsx` konsumuje teraz `diagnostics` z `diffToCloudOps`
   (niezależnie od wczesnego wyjścia `ops.length === 0`), pokazuje je w
   banerze `dropped` przez nowy czysty helper `diagnosticsToDropped`
   (polska etykieta „Wiersz pominięty w lustrze”, deduplikacja) i ZAWSZE
   wymusza lokalny zapis awaryjny (`retryPersist`) przy niepustych
   diagnostykach — praca ląduje w localStorage nawet, gdy bramka wycofania
   pominęła zapis per-akcyjny.
2. **Jawność konfliktu kart po pominiętym zapisie** — nowa flaga modułowa w
   `persistGate.ts` („pamięć nowsza niż localStorage przez pominięcie”):
   ustawiana dokładnie przy pominięciu, czyszczona przy każdym udanym
   `saveData` (efekt persist, `retryPersist`, `keepLocal`) i na obu ścieżkach
   `REPLACE_FROM_STORAGE`; dołączona do warunku czystości w nasłuchu storage —
   zapis z innej karty podnosi jawny konflikt zamiast cichej podmiany stanu.
3. **Kolizja sondy zapisu z indeksem zasobnika** — sonda handshake'u używa
   wiersza DATOWANEGO (`PROBE_WORK_DATE = '1970-01-01'`), więc częściowy
   indeks unikalny `workload_entries_bin_pair (…) WHERE work_date IS NULL`
   nie zgłasza już 23505; `onConflict: 'id'` zachowany (wariant
   `task_id,profile_id` nadpisałby realny wiersz zasobnika). Przed sondą
   sprzątanie sierot: `remove` po trójce `(task_id, profile_id, work_date)`;
   błąd sprzątania kończy krok zapisu po polsku.
4. **Rozjazd polityki `impersonatorId`** — ujednolicone na politykę importu
   (`dataImport.ts`): lustro mapuje niemapowalnego impersonatora na `NULL`
   (bez porzucania wiersza, bez diagnostyki); aktor pozostaje ścisły
   (porzucenie + diagnostyka), zgodnie z raportem pokrycia, który sprawdza
   tylko aktora. Wybór udokumentowany w komentarzu `activityRow`: dziennik
   aktywności jest dopisywalny, impersonator to atrybucja wtórna — czyste
   pokrycie gwarantuje teraz zero porzuceń w lustrze.
5. **`mountedRef` pod StrictMode (tylko dev)** — ciało efektu przywraca
   `mountedRef.current = true`, więc hydracja nie zawiesza się na
   `'hydrating'` po podwójnym montażu StrictMode.

Testy regresji: `cloudMirror.test.ts` (diff złożony wyłącznie z
niemapowalnych wierszy ⇒ zero operacji + diagnostyki; helper banera;
impersonator ⇒ `NULL` bez diagnostyki; zgodność pokrycie↔lustro),
`migrationStatus.test.ts` (datowana sonda, kolejność sprzątania przed sondą,
stub 23505 działający tylko dla `work_date IS NULL`, sierota po nieudanym
remove czyszczona w kolejnym przebiegu), `persistGate.test.ts` (semantyka
flagi + idempotencja). Poprawka 5 bez powierzchni testowalnej w node
(efekt Reactowy) — zweryfikowana inspekcją.

Recenzent (read-only) zatwierdził: `approve`, zero blokerów, brak
niezadeklarowanego rozszerzenia granic. Niezależny przegląd Codex uruchamia
scheduler po zakończeniu tego procesu.

Uwaga do kontekstu: prompt wskazywał `openwiki/n2hub/cloud-database.md`,
która nie istnieje — obowiązującym kontekstem była
`state-and-persistence.md` (obejmuje lustro chmury i bramkę wycofania).

## Zmiany

- `src/supabase/CloudSyncProvider.tsx` — konsumpcja diagnostyk + wymuszony
  zapis lokalny; reset `mountedRef` w ciele efektu.
- `src/store/AppStore.tsx` — cykl życia flagi pominięcia + jawny konflikt.
- `src/store/persistGate.ts` — flaga `markLocalPersistSkipped` /
  `clearLocalPersistSkipped` / `wasLocalPersistSkipped`.
- `src/supabase/cloudMirror.ts` — `diagnosticsToDropped`; polityka `NULL`
  dla impersonatora w `activityRow`.
- `src/supabase/migrationStatus.ts` — `PROBE_WORK_DATE`, datowana sonda,
  sprzątanie sierot przed sondą.
- Testy: `cloudMirror.test.ts`, `migrationStatus.test.ts`,
  `persistGate.test.ts` (rozszerzone).
- `openwiki/n2hub/state-and-persistence.md` — **wiki updated** (decyzja
  recenzenta): datowana sonda ze sprzątaniem sierot, zapis awaryjny
  wyzwalany diagnostykami, flaga pominięcia w protokole konfliktu.

## Weryfikacja

- `npx vitest run src/supabase/cloudMirror.test.ts
  src/supabase/migrationStatus.test.ts src/store/persistGate.test.ts`:
  39 testów, wszystkie zielone (worker; potwierdzone niezależnie przez
  recenzenta).
- `npm test`: 31 plików, 910 testów, wszystkie zielone.
- `npm run build` (`tsc --noEmit && vite build`): zielony (jedynie
  istniejące wcześniej ostrzeżenie o chunku > 500 kB).
- Ostateczny gate `npm test` + `npm run build`: oczekuje na scheduler.

## Ryzyka / rzeczy do sprawdzenia

- Flaga pominięcia jest zachowawcza w bezpiecznym kierunku: po wymuszonym
  `retryPersist` z efektu-dziecka efekt persist rodzica może ponownie
  oznaczyć pominięcie dla tego samego stanu, więc flaga bywa `true`, gdy
  localStorage faktycznie zgadza się z pamięcią — najwyżej nadmiarowy jawny
  konflikt, nigdy cicha podmiana (kierunek zgodny z inwariantami).
- Baner `dropped` akumuluje wpisy między partiami (deduplikacja tylko w
  obrębie partii) — spójne z istniejącym zachowaniem `processQueue`,
  `dismissDropped` czyści; nie regresja.
- Wisząca drobnostka sprzed tej zmiany: komentarz nagłówkowy
  `CloudSyncProvider.tsx` mówi „siedem grup encji”, wymienia sześć, a wiki
  osiem rodzin — nietknięte tym diffem, do ewentualnego sprzątnięcia przy
  następnej zmianie pliku.

## Podpis schedulera

- Run: `20260718-015644-212-retirement-write-safety`
- Prompt: `212-retirement-write-safety.md`
- Gałąź review: `review-integration`
- Baza: `db5cd250d2ab08db1c8b5dded6292e28f9477b75`


## Gate schedulera

- `npm test`: zaliczone
- `npm run build`: zaliczone
- Baza: `db5cd250d2ab08db1c8b5dded6292e28f9477b75`
- Gałąź review: `review-integration`
- Run: `20260718-015644-212-retirement-write-safety`

### Pliki zgłoszone do review

- `openwiki/n2hub/state-and-persistence.md`
- `src/store/AppStore.tsx`
- `src/store/persistGate.test.ts`
- `src/store/persistGate.ts`
- `src/supabase/CloudSyncProvider.tsx`
- `src/supabase/cloudMirror.test.ts`
- `src/supabase/cloudMirror.ts`
- `src/supabase/migrationStatus.test.ts`
- `src/supabase/migrationStatus.ts`
- `handoffs/scheduler-reviews/20260718-015644-212-retirement-write-safety.md`
