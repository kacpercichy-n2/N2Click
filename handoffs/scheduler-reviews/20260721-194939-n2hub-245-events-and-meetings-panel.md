# Raport workflow: 20260721-194939-n2hub-245-events-and-meetings-panel

## Wykonane

Workflow tier `architect → developer → reviewer` (+ jedna runda remediacji). Analiza wstępna potwierdziła, że funkcja nadal nie istniała w buildzie (brak `CalendarEvent` i kolekcji `events`; `ActivityEvent` to log audytu), a `src/utils/recurrence.ts` z promptu 244 był dostępny do reużycia.

- **Model:** nowa encja `CalendarEvent` (`src/types.ts`) + kolekcja `AppData.events`; akcje reduktora `ADD_EVENT`/`SAVE_EVENT`/`DELETE_EVENT` z walidacją `normalizeEventDraft`/`isValidEventDraft` (`src/store/commandValidation.ts`) — nieprawidłowa komenda zachowuje referencję stanu (invariant 6). Cykliczność: **reużyty** typ `TaskRecurrence` i `src/utils/recurrence.ts` przez wrapper `canonicalEventRecurrence` — zero drugiej implementacji; forma kanoniczna (czasy reguły = czasy wydarzenia, dzień kotwicy w `daysOfWeek`) egzekwowana na trzech granicach: reducer, repair storage, hydracja chmury.
- **Storage:** `repairEvents` + `coerceArray` + `emptyData.events` w `src/store/storage.ts`, bez bumpa wersji (`DATA_VERSION` = 7).
- **Uprawnienia:** nowe `events.manage` (administrator/pm/handlowiec; podgląd dla wszystkich) w `src/store/permissions.ts`.
- **Kalendarz:** w `WeekView` menu kontekstowe pustego slotu (z promptu 236) rozszerzone o „+ Dodaj spotkanie (HH:mm)" z prefillem daty/godziny/osoby; render `EventBlock` czysto prezentacyjny (pozycja po `startMinutes`, wysokość ∝ `durationMinutes`), w `MonthView` znacznik `.month-cell-event`. Kolory: tokeny `--event-accent` (cyan) w `src/styles.css`, odróżniające wydarzenia od zadań. **Pointer/drag/hit-test nietknięte** (invariant 7, potwierdzone przeglądem diffu).
- **Panel „Wydarzenia":** nowa route `/wydarzenia` (NAV w `src/App.tsx`, ikona, label „Wydarzenia"), `src/pages/EventsPage.tsx` + URL-driven `src/components/EventModal.tsx` (`?wydarzenie=new`/`?wydarzenie=<id>`), pola po polsku, wymagane z ` *`, scope `event-modal` w dirty registry.
- **Chmura + RLS:** migracja `supabase/migrations/20260721210000_events.sql` — forward-only, idempotentna (`if not exists`, `drop policy if exists`), tabela `public.events` z `attendee_ids uuid[]`, `recurrence jsonb`, CHECK-i siatki 15 min, trigger `app.set_updated_at`, `enable row level security`, `revoke all … from anon`, polityki `to authenticated` z `with check`, publikacja realtime. Wpis w `src/supabase/migrations.test.ts` + `EXPECTED_POLICIES`; `cloudMirror.ts` (dziesiąta rodzina diff, `eventRow`), `plannerData.ts` + `MERGE_CLOUD_ENTITIES.events` (cloud-authoritative, fail-closed, filtr dangling attendees per wiersz).
- **Remediacja po review:** reviewer wykrył ścieżkę cichej utraty zapisu w `EventModal` (czas off-grid / `until < date` → reducer odrzucał draft, a modal zamykał się jak po sukcesie). Naprawione: snap czasów do siatki 15 min + autorytatywna bramka `isValidEventDraft` przed dispatch, polski komunikat inline (`role="alert"`), modal nie zamyka się i nie czyści dirty przy odrzuceniu. Finalny werdykt reviewera: **APPROVED**.
- **Wiki (updated):** `openwiki/n2hub/state-and-persistence.md`, `scheduling-and-calendar.md`, `cloud-database.md`, `ui-navigation-and-onboarding.md` — zaktualizowane o nową granicę (kolekcja `events`, forma kanoniczna recurrence, `.week-event-block`, tabela `public.events`, route `/wydarzenia`).
- Pakiet architekta: `handoffs/scheduler-reviews/20260721-194939-n2hub-245-architect-package.md`.

## Weryfikacja

- `npm test`: **PASS — 1299/1299** (48 plików; +43 nowe testy: reducer wydarzeń z gałęziami odrzuceń invariant 6, repair storage, merge chmury fail-closed, mirror/plannerData, rejestr migracji, bramka walidacyjna modala).
- `npm run build`: **PASS** (tsc + vite; jedynie standardowy warning o rozmiarze chunku).
- `scripts/browser-check-bin-drag.mjs`: **nie uruchomiony** — pakiet `playwright` nie jest zainstalowany w środowisku (ani lokalnie, ani globalnie; zweryfikowano), a instalacja łamałaby zakaz nowych zależności. Zmiany w `WeekView` są addytywne/prezentacyjne — `packDayBlocks`, `TimedBlock`, drag/pointer i hit-test gridu nietknięte (potwierdzone read-only review).
- Gate (`npm test && npm run build`): oczekuje na scheduler

## Ryzyka / rzeczy do sprawdzenia

- Migracja `20260721210000_events.sql` celowo **nie została zaaplikowana** na zdalną bazę — do czasu aplikacji upserty mirrora do `public.events` będą odrzucane po stronie serwera i live sync wydarzeń nie działa (follow-up operacyjny).
- Browser check pominięty (playwright niedostępny w środowisku) — interakcje slot-menu/EventBlock zweryfikowane przeglądem kodu i testami jednostkowymi; pełna matryca przeglądarkowa należy do release verification.
- Hydracja `plannerData` ufa CHECK-om SQL co do siatki 15 min — ręcznie zepsuty off-grid wiersz w `public.events` fail-closuje całą hydrację (świadomy parytet z rodziną workload).
- Wydarzenie cykliczne z bazową datą w przeszłości trafia w panelu do „Minione" mimo przyszłych wystąpień; edycja pojedynczych wystąpień (overrides) poza zakresem v1 (zamknięte decyzje pakietu).
- Snap czasów zaokrągla ręcznie wpisane wartości (np. 09:10 → 09:15) bez wizualnej aktualizacji inputów przed zapisem — drobny UX, zapisane wartości są kanoniczne.
- Obowiązkowy Codex review (`scripts/codex-review.sh`) uruchamia scheduler po zakończeniu tego procesu — aprobata reviewera jest warunkowa względem braku nowych ustaleń Codexa.

## Podpis schedulera

- Run: `20260721-194939-n2hub-245-events-and-meetings-panel`
- Prompt: `245-events-and-meetings-panel.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `d72097a7756eff745484db1e2dfc276e5e17e14d`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `d72097a7756eff745484db1e2dfc276e5e17e14d`
- Gałąź review: `review-integration`
- Run: `20260721-194939-n2hub-245-events-and-meetings-panel`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `openwiki/n2hub/cloud-database.md`
- `openwiki/n2hub/scheduling-and-calendar.md`
- `openwiki/n2hub/state-and-persistence.md`
- `openwiki/n2hub/ui-navigation-and-onboarding.md`
- `src/App.tsx`
- `src/components/MonthView.tsx`
- `src/components/WeekView.tsx`
- `src/components/icons.ts`
- `src/store/AppStore.tsx`
- `src/store/cloudMerge.test.ts`
- `src/store/commandValidation.ts`
- `src/store/permissions.test.ts`
- `src/store/permissions.ts`
- `src/store/seed.ts`
- `src/store/selectors.ts`
- `src/store/storage.test.ts`
- `src/store/storage.ts`
- `src/styles.css`
- `src/supabase/cloudMirror.test.ts`
- `src/supabase/cloudMirror.ts`
- `src/supabase/migrations.test.ts`
- `src/supabase/plannerData.test.ts`
- `src/supabase/plannerData.ts`
- `src/types.ts`
- `src/utils/dirtyRegistry.ts`
- `handoffs/scheduler-reviews/20260721-194939-n2hub-245-architect-package.md`
- `handoffs/scheduler-reviews/20260721-194939-n2hub-245-events-and-meetings-panel.md`
- `src/components/EventModal.tsx`
- `src/pages/EventsPage.tsx`
- `src/store/eventActions.test.ts`
- `supabase/migrations/20260721210000_events.sql`
