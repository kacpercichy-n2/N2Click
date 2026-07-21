# Raport workflow: 20260721-051653-237-team-contacts-and-birthdays

## Wykonane

Analiza wstępna: funkcja NIE istniała w buildzie (`grep` po
`birthDate`/`birth_date`/`urodzenia`/🎂 nic nie zwrócił). Zaimplementowana od zera.

### 1. Model danych — `Person.birthDate`
- `src/types.ts`: `birthDate: DateStr` ('' = brak). Pole ADDYTYWNE — `DATA_VERSION`
  zostaje **7** (bez podbicia).
- Repair: `src/store/storage.ts` `migratePerson` (biegnie przez `migrateV4toV5`
  na KAŻDYM wczytaniu) — brak pola albo wartość niebędąca poprawną 'yyyy-MM-dd'
  spada na '' (`isValidDateStr`, nigdy nie rzuca).
- `PersonDraft.birthDate`, `personFromDraft` (koercja do '' gdy niepoprawna),
  `ADD_PERSON`/`UPDATE_PERSON`, `emptyDraft` (PeoplePage), seed (3 przykładowe daty).
- Helpery `src/utils/dates.ts`: `isBirthdayOn` (dopasowanie miesiąc+dzień, rok bez
  znaczenia; puste/niepoprawne => false) i `formatBirthday` („14 marca 1988”).

### 2. Edycja w profilu + polityka
- `src/pages/profileEditPolicy.ts`: `'birthDate'` w `ALL_FIELDS`, `SELF_FIELDS`
  (self) i `MANAGER_FIELDS` (menedżer własnego działu — jak telefon, NIE eskalacja
  uprawnień). Pola chronione triggerem (access_role/department) pozostają
  zablokowane w ścieżkach nie-admina; `save()` bierze zablokowane pola z rekordu.
- `src/pages/PersonProfilePage.tsx`: input `type="date"` z etykietą
  **„Data urodzenia”** oraz read-only 🎂 w sekcji „Informacje”; telefon i e-mail
  są tam teraz klikalne (`tel:`/`mailto:`).

### 3. Chmura
- Migracja forward-only, idempotentna
  `supabase/migrations/20260721030000_profiles_birth_date.sql`
  (`add column if not exists birth_date date`; celowo POZA triggerem
  `protect_profile_privileges`). Dopisana do `src/supabase/migrations.test.ts`.
- `src/supabase/referenceData.ts`: `CloudProfile.birthDate`, `toCloudProfile`
  (`birth_date` → '' gdy null/śmieci), kolumna w selektcie `loadOrgSnapshot`,
  `CloudPersonMergeRow.birthDate`, `buildCloudPeoplePayload`.
- `src/store/AppStore.tsx`: `cloudPersonFields`, `isValidCloudPersonRow`, porównanie
  „same” w `applyCloudPeople` (hydracja MERGE_CLOUD_PEOPLE).
- `src/supabase/cloudMirror.ts`: wiersz UPDATE `profiles` wysyła
  `birth_date: p.birthDate === '' ? null : p.birthDate`.

### 4. Kalendarz (czysto prezentacyjne — inwariant 7 zachowany)
- Selektor `peopleWithBirthdayOnDate` (`src/store/selectors.ts`) — cały zespół,
  niezależnie od filtra pracy.
- `WeekView.tsx`: `🎂 + imiona` w nagłówku dnia (tydzień) z tooltipem „Urodziny:
  …”. `MonthView.tsx`: mały 🎂 w rogu komórki z tym samym tooltipem. Bez zmian
  ścieżek wskaźnika/renderowania kolumn. CSS: `.week-col-birthday`,
  `.month-cell-birthday`, `.team-person-contact`.

### 5. Lista kontaktów zespołu (`/team`)
- `src/pages/teamScope.ts`: `TeamPersonView` niesie `phone`/`email` (z osób
  lokalnych i profili chmury). `src/pages/TeamPage.tsx`: wiersze pokazują klikalne
  `mailto:`/`tel:` obok nazwy.

### Wiki
- Zaktualizowany `openwiki/n2hub/state-and-persistence.md` (wpis DATA URODZENIA:
  pole ADDYTYWNE, granica repair + chmury).

## Zmiany

- Zmiany kodu (nieskomitowane — commit robi scheduler po zielonym gate):
  `src/types.ts`, `src/utils/dates.ts`, `src/store/{storage,seed,AppStore,selectors}.ts`,
  `src/pages/{profileEditPolicy,PersonProfilePage,PeoplePage,TeamPage,teamScope}.tsx/.ts`,
  `src/components/{WeekView,MonthView}.tsx`, `src/supabase/{referenceData,cloudMirror}.ts`,
  `src/styles.css`, `supabase/migrations/20260721030000_profiles_birth_date.sql`,
  `src/supabase/migrations.test.ts`, plus testy (dates/selectors/storage/referenceData/
  cloudMirror) i fixture'y (+`birthDate`), `openwiki/n2hub/state-and-persistence.md`.

## Weryfikacja

- `npm test`: **41 plików, 1096 testów — PASS** (było 1086, +10 nowych; lokalnie).
- `npm run build` (`tsc --noEmit && vite build`): **PASS** (2634 moduły, zielony).

## Ryzyka / rzeczy do sprawdzenia

- Znacznik urodzin celowo obejmuje CAŁY zespół (urodziny nie zależą od filtra
  kalendarza) — świadoma decyzja UX.
- 29 lutego dopasowuje się tylko w latach przestępnych (bez przeniesienia na
  28.02) — prosta, przewidywalna reguła.
- Kolumna `profiles.birth_date` wymaga zastosowania migracji w środowisku
  Supabase (istniejąca ścieżka aplikowania). Kod czyta brak kolumny bezpiecznie
  jako '' (fail-open).

## Podpis schedulera

- Run: `20260721-051653-237-team-contacts-and-birthdays`
- Prompt: `237-team-contacts-and-birthdays.md`
- Gałąź review: `review-integration`
- Baza: `b5f8f860a476a5962e49526c6eb00433e0674145`


## Gate schedulera

- `npm test`: zaliczone
- `npm run build`: zaliczone
- Baza: `b5f8f860a476a5962e49526c6eb00433e0674145`
- Gałąź review: `review-integration`
- Run: `20260721-051653-237-team-contacts-and-birthdays`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `openwiki/n2hub/state-and-persistence.md`
- `src/auth/session.test.ts`
- `src/components/MonthView.tsx`
- `src/components/WeekView.tsx`
- `src/pages/PeoplePage.tsx`
- `src/pages/PersonProfilePage.tsx`
- `src/pages/TeamPage.tsx`
- `src/pages/kanbanBoard.test.ts`
- `src/pages/profileEditPolicy.test.ts`
- `src/pages/profileEditPolicy.ts`
- `src/pages/teamScope.test.ts`
- `src/pages/teamScope.ts`
- `src/store/AppStore.tsx`
- `src/store/activityAttribution.test.ts`
- `src/store/blockActions.test.ts`
- `src/store/cloudMerge.test.ts`
- `src/store/commandValidation.test.ts`
- `src/store/dateGuards.test.ts`
- `src/store/draftTasks.test.ts`
- `src/store/exportDryRun.test.ts`
- `src/store/permissions.test.ts`
- `src/store/saveTaskWorkload.test.ts`
- `src/store/seed.ts`
- `src/store/selectors.test.ts`
- `src/store/selectors.ts`
- `src/store/storage.test.ts`
- `src/store/storage.ts`
- `src/store/taskMeta.test.ts`
- `src/store/taskOrder.test.ts`
- `src/store/ticketActions.test.ts`
- `src/store/ticketsStorage.test.ts`
- `src/styles.css`
- `src/supabase/cloudMirror.test.ts`
- `src/supabase/cloudMirror.ts`
- `src/supabase/dataImport.test.ts`
- `src/supabase/migrationStatus.test.ts`
- `src/supabase/migrations.test.ts`
- `src/supabase/plannerData.test.ts`
- `src/supabase/referenceData.test.ts`
- `src/supabase/referenceData.ts`
- `src/types.ts`
- `src/utils/dates.test.ts`
- `src/utils/dates.ts`
- `handoffs/scheduler-reviews/20260721-051653-237-team-contacts-and-birthdays.md`
- `supabase/migrations/20260721030000_profiles_birth_date.sql`
