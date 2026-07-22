# Raport workflow: 20260722-131754-n2hub-252-clients-expand-contacts

## Wykonane

Workflow tier: `architect → developer` (pakiet: `handoffs/packages/n2hub-252-clients-expand-contacts.md`).
Analiza wstępna potwierdziła, że oba punkty zadania były nadal niezrealizowane
(opis renderował się zawsze na karcie, walidacja wymagała e-mail LUB telefon,
brak listy dodatkowych osób kontaktowych w modelu).

1. **Rozwijane kafelki klientów** — karta ma natywny przycisk-nagłówek
   (`aria-expanded`/`aria-controls`); w stanie zwiniętym widać tylko nazwę
   klienta oraz imię i nazwisko, e-mail i telefon głównej osoby kontaktowej.
   Pełny „Opis klienta” (dotychczasowe pole `notes`, przeetykietowane) i
   dodatkowe osoby kontaktowe pokazują się dopiero po rozwinięciu.
2. **Formularz tworzenia/edycji** — pola wymagane przed zapisem: nazwa klienta,
   główna osoba kontaktowa (imię + nazwisko, reguła split/join na poziomie
   formularza), telefon ORAZ e-mail (zmiana z reguły OR na AND). Plusik dodaje
   kolejne osoby kontaktowe (imię, nazwisko, telefon, e-mail); pierwsza osoba
   pozostaje główną (legacy pola `contactName/Email/Phone`). Auto-zapis dalej
   bramkuje `isValidClientDraft` — niepoprawny draft nigdy nie raportuje
   „Zapisano”.
3. **Model danych rozszerzony additywnie** — `Client.contacts?: ClientContact[]`
   (klucz pomijany, gdy pusto; rekordy legacy bez zmian). Pełny cykl cloud:
   `cloudMirror` zapisuje `contacts`, `plannerData` hydratuje przez
   `sanitizeClientContacts`, `MERGE_CLOUD_ENTITIES` fail-closed na nie-tablicy
   (invariant 6 — ta sama referencja stanu) i deterministycznie filtruje
   zniekształcone wiersze. Migracja `supabase/migrations/20260722130000_client_contacts.sql`
   (kolumna jsonb + check) zapisana w repo, świadomie NIE zaaplikowana do bazy.

Wiki: zaktualizowano `openwiki/n2hub/state-and-persistence.md` (reguła AND,
`contacts`, etykieta „Opis klienta”) i `openwiki/n2hub/cloud-database.md`
(kolumna `clients.contacts` + wpis migracji).

## Zmiany

- Model/walidacja/store: `src/types.ts`, `src/store/commandValidation.ts`,
  `src/store/AppStore.tsx`, `src/store/storage.ts` (nowy `repairClients`),
  `src/store/seed.ts`.
- Cloud: `src/supabase/cloudMirror.ts`, `src/supabase/plannerData.ts`,
  `supabase/migrations/20260722130000_client_contacts.sql` (nowy plik).
- UI: `src/pages/ClientsPage.tsx`, `src/pages/clientContactForm.ts` (nowy —
  czyste helpery formularza), `src/styles.css`.
- Testy: `src/pages/clientContactForm.test.ts` (nowy) oraz rozszerzone
  `commandValidation.test.ts`, `cloudMerge.test.ts`, `storage.test.ts`,
  `cloudMirror.test.ts`, `plannerData.test.ts`, `migrations.test.ts`.

## Weryfikacja

- `npm test` (pełny): **52 pliki, 1358 testów — wszystkie zielone** (w tym nowe:
  walidacja wymaganych pól, wiele osób kontaktowych, round-trip cloud,
  invariant 6, brak echo-write w storage).
- `npm run build`: **zielony** (tsc czysty; ostrzeżenie o rozmiarze chunka
  istniało wcześniej, niezwiązane ze zmianą).
- Gate (`npm test && npm run build`): oczekuje na scheduler

## Ryzyka / rzeczy do sprawdzenia

- Migracja SQL nie została zaaplikowana do żadnej bazy — do wdrożenia przez
  właściciela środowiska (kolumna `contacts jsonb` jest additywna; do czasu
  aplikacji zapis klienta z dodatkowymi osobami do chmury zwróci błąd kolumny,
  dane lokalne pozostają nienaruszone).
- Zaostrzenie walidacji (e-mail ORAZ telefon) oznacza, że edycja istniejącego
  klienta bez kompletu danych wstrzyma auto-zapis do czasu uzupełnienia pól —
  zachowanie celowe, komunikat po polsku widoczny na żywo.
- Poza tym: Brak.

## Podpis schedulera

- Run: `20260722-131754-n2hub-252-clients-expand-contacts`
- Prompt: `252-clients-expand-contacts.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `d403a2f9d27cf784af4a975fbe0d803499049b58`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `d403a2f9d27cf784af4a975fbe0d803499049b58`
- Gałąź review: `review-integration`
- Run: `20260722-131754-n2hub-252-clients-expand-contacts`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `openwiki/n2hub/cloud-database.md`
- `openwiki/n2hub/state-and-persistence.md`
- `src/pages/ClientsPage.tsx`
- `src/store/AppStore.tsx`
- `src/store/cloudMerge.test.ts`
- `src/store/commandValidation.test.ts`
- `src/store/commandValidation.ts`
- `src/store/seed.ts`
- `src/store/storage.test.ts`
- `src/store/storage.ts`
- `src/styles.css`
- `src/supabase/cloudMirror.test.ts`
- `src/supabase/cloudMirror.ts`
- `src/supabase/migrations.test.ts`
- `src/supabase/plannerData.test.ts`
- `src/supabase/plannerData.ts`
- `src/types.ts`
- `handoffs/packages/n2hub-252-clients-expand-contacts.md`
- `handoffs/scheduler-reviews/20260722-131754-n2hub-252-clients-expand-contacts.md`
- `src/pages/clientContactForm.test.ts`
- `src/pages/clientContactForm.ts`
- `supabase/migrations/20260722130000_client_contacts.sql`
