# Raport workflow: 20260716-135102-208-localstorage-import

## Wykonane

Trasa TierWorkflow: `architect → developer` (pakiet
`handoffs/scheduler-reviews/208-architect-package.md`, PKG-20260716-supabase-import,
`Codex review: required`).

Zaimplementowano bramkowany, idempotentny, dostępny wyłącznie dla administratora
import zwalidowanego eksportu localStorage do Supabase:

- Nowy moduł `src/supabase/dataImport.ts`: interfejs `ImportDb` z cienkim
  adapterem `createSupabaseImportDb`, czysta bramka `evaluateImportGate`
  (rola admina + tryb Supabase + aktywna sesja + obecny raport dry-run
  + zero blokerów + wpisane potwierdzenie `IMPORTUJ`) oraz `runSupabaseImport`.
- Idempotencja: wyłącznie insert z select-before-insert — istniejące wiersze są
  raportowane jako pominięte, nigdy nadpisywane ani usuwane; lokalne UUID stają
  się kluczami głównymi w Supabase, więc ponowne uruchomienie po częściowym
  niepowodzeniu dokańcza resztę bez duplikatów.
- Kolejność zgodna z kluczami obcymi schematu: działy → mapowanie profili
  (osoby nigdy nie są tworzone — mapowane po znormalizowanym e-mailu do
  istniejących profili; braki dają diagnostykę „załóż konto”) → projekty →
  zadania → członkowie projektów → przypisania zadań. Kolekcje bez tabel
  docelowych (klienci, statusy, workload, komentarze, kamienie milowe itd.)
  trafiają do podsumowania jako pominięte z polskim wyjaśnieniem.
- Częściowe niepowodzenia: try/continue per rekord, per-kolekcja liczniki
  zaimportowane/pominięte/nieudane + diagnostyka; błąd rekordu nie przerywa
  importu.
- UI: sekcja „Import do Supabase” w `src/components/ExportDryRunPanel.tsx`
  (poniżej niezmienionego eksportu/dry-run), świeżość weryfikowana ponownie
  w momencie kliknięcia (ponowny peek + dry-run), polskie podsumowanie
  i diagnostyka.
- localStorage nie jest nigdzie modyfikowany ani usuwany — `storage.ts`
  pozostaje jedyną granicą, lokalny backup/eksport nienaruszony; odczyty
  planera nadal wyłącznie z localStorage (bez przełączenia na Supabase).

`wiki unchanged` — `openwiki/n2hub/state-and-persistence.md` pozostaje aktualna
(import czyta przez istniejące `peekDataResult`, nic lokalnie nie zapisuje).

## Zmiany

- `src/supabase/dataImport.ts` (nowy) — logika importu, bramka, adapter.
- `src/supabase/dataImport.test.ts` (nowy) — 17 testów: bramkowanie admina,
  odmowa przy blokerach, kolejność zależności, idempotentny rerun, kontynuacja
  po częściowym niepowodzeniu, mapowanie osób/działów, złe UUID, adapter.
- `src/components/ExportDryRunPanel.tsx` — dodana bramkowana sekcja importu.
- `handoffs/RUN-STATE.md` — wpis wynikowy developera (konwencja runów).
- `handoffs/scheduler-reviews/208-architect-package.md` (nowy) — pakiet handoff.

## Weryfikacja

- `npm test`: oczekuje na scheduler (worker: 804 testy, 0 błędów, 25 plików)
- `npm run build`: oczekuje na scheduler (worker: zielony, tsc strict + vite)
- Fokusowo (worker): `npx vitest run src/supabase/dataImport.test.ts
  src/store/exportDryRun.test.ts src/store/storage.test.ts` → 168 testów,
  0 błędów; istniejące testy eksportu/dry-run/storage niezmienione.

## Ryzyka / rzeczy do sprawdzenia

- Ścieżka zapisu ćwiczona wyłącznie na wstrzykiwanym fake'u `ImportDb`;
  zachowanie na żywym Supabase (polityki RLS admina, realne wymuszanie FK/PK,
  błędy sieci) wymaga ręcznego kroku operatora — zgodnie z pakietem.
- Dla `task_assignments`, których zadanie-rodzic się nie zaimportowało,
  diagnostyka używa komunikatu „Projekt zadania nie został zaimportowany…”
  (najczęstsza przyczyna to faktycznie projekt, ale sformułowanie mówi
  o projekcie, nie o zadaniu).
- Błąd `select` dla kolekcji oznacza jej rekordy jako nieudane i nie wykonuje
  żadnych insertów (bezpieczne, brak ryzyka duplikatów); ta ścieżka nie ma
  dedykowanego testu spec.

## Podpis schedulera

- Run: `20260716-135102-208-localstorage-import`
- Prompt: `208-localstorage-import.md`
- Gałąź review: `review-integration`
- Baza: `f106bf3b2214aa155f7ca073af37348db4f40d8c`


## Gate schedulera

- `npm test`: zaliczone
- `npm run build`: zaliczone
- Baza: `f106bf3b2214aa155f7ca073af37348db4f40d8c`
- Gałąź review: `review-integration`
- Run: `20260716-135102-208-localstorage-import`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `src/components/ExportDryRunPanel.tsx`
- `handoffs/scheduler-reviews/20260716-135102-208-localstorage-import.md`
- `handoffs/scheduler-reviews/208-architect-package.md`
- `src/supabase/dataImport.test.ts`
- `src/supabase/dataImport.ts`
