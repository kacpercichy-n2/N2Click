# Raport workflow: 20260716-094327-207-localstorage-export-dry-run

## Wykonane

Zrealizowano lokalne narzędzie eksportu localStorage i migracyjnego dry-runu
(TierWorkflow: architect → developer → reviewer, pakiet
`handoffs/scheduler-reviews/207-architect-package.md`). Narzędzie jest w pełni
read-only: nie zapisuje danych plannera do Supabase, niczego nie importuje ani
nie kasuje.

- `src/store/storage.ts`: wnętrze `loadDataResult` wydzielone do prywatnego
  `readData(recordRevision)`; dodano bezefektowe `peekDataResult()` (bez zapisu
  do localStorage, bez mutacji `latestKnownRevision`, bez echo-write).
  `loadDataResult` deleguje z `recordRevision: true` — zachowanie bez zmian.
- `src/store/exportDryRun.ts`: nowy czysty moduł — `buildExportPayload`
  (sanityzacja: wyzerowane `passwordHash`, `currentUserId`, `impersonatorId`;
  metadane: format, wersja danych 7, wersja zapisu, znacznik czasu) oraz
  `buildDryRunReport` (liczby rekordów, wymagane mapowania ID i ról
  pm→manager / handlowiec,pracownik→worker, kolekcje/pola nieobsługiwane przez
  schemat Supabase, blokujące błędy walidacji wg DDL z `supabase/migrations/`).
- `src/components/ExportDryRunPanel.tsx`: nowy panel wyłącznie dla
  administratorów (sekcja na `src/pages/AdminPage.tsx` za istniejącą bramką
  admina), pobranie kopii JSON przez Blob + tymczasowy anchor, trwała polska
  etykieta „dry run / bez zapisu”.
- `src/store/exportDryRun.test.ts`: testy poprawnych danych (w tym asercja
  braku efektów ubocznych peeka), danych uszkodzonych/niedostępnych oraz
  diagnostyki mapowania (liczby, mapowania ID, pola nieobsługiwane, blokery).

## Zmiany

- Zmodyfikowane: `src/store/storage.ts`, `src/pages/AdminPage.tsx`,
  `handoffs/RUN-STATE.md`.
- Nowe: `src/store/exportDryRun.ts`, `src/store/exportDryRun.test.ts`,
  `src/components/ExportDryRunPanel.tsx`,
  `handoffs/scheduler-reviews/207-architect-package.md`.
- `src/store/storage.test.ts` nietknięty; wersja danych pozostaje 7.

## Weryfikacja

- Testy fokusowe (`npx vitest run src/store/exportDryRun.test.ts
  src/store/storage.test.ts`): 151 pass, 0 fail.
- Pełne `npm test` (vitest): 787 pass, 0 fail.
- `npm run build` (tsc strict + vite): zielony.
- Recenzent (tier reviewer, read-only): APPROVE, bez blokerów; potwierdził brak
  efektów ubocznych `peekDataResult`, zgodność raportu dry-run z DDL
  `supabase/migrations/20260715210000_core_schema.sql`, bramkę admina, brak
  importów `src/supabase/*` i bezpośredniego `localStorage` w nowych modułach,
  wyłącznie polskie stringi. Werdykt: polityka Codex „conditional” nie została
  wyzwolona (diff storage.ts to dokładnie zaplanowana ekstrakcja ścieżki
  odczytu, bez rozszerzenia zakresu).
- Wiki: `wiki unchanged` — `state-and-persistence.md` nie wylicza punktów
  wejścia storage, więc addytywny, bezefektowy `peekDataResult` nie czyni jej
  nieaktualną.

## Ryzyka / rzeczy do sprawdzenia

- Drobiazg diagnostyczny (niebl.): licznik `project_members` uwzględnia parę z
  wiszącym `project_id`; ten sam wiszący identyfikator jest równolegle
  raportowany jako bloker, więc raport nie może wprowadzić w błąd.
- Narzędzie jest wyłącznie dry-runem: właściwy import do Supabase pozostaje
  poza zakresem i wymaga osobnego promptu.

## Podpis schedulera

- Run: `20260716-094327-207-localstorage-export-dry-run`
- Prompt: `207-localstorage-export-dry-run.md`
- Gałąź review: `review-integration`
- Baza: `34a40f93ad5ed57f8ccd99a3e794cec35fc40314`


## Gate schedulera

- `npm test`: zaliczone
- `npm run build`: zaliczone
- Baza: `34a40f93ad5ed57f8ccd99a3e794cec35fc40314`
- Gałąź review: `review-integration`
- Run: `20260716-094327-207-localstorage-export-dry-run`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `src/pages/AdminPage.tsx`
- `src/store/storage.ts`
- `handoffs/scheduler-reviews/20260716-094327-207-localstorage-export-dry-run.md`
- `handoffs/scheduler-reviews/207-architect-package.md`
- `src/components/ExportDryRunPanel.tsx`
- `src/store/exportDryRun.test.ts`
- `src/store/exportDryRun.ts`
