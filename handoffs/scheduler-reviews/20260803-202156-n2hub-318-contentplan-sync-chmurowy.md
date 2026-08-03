# Raport workflow: 20260803-202156-n2hub-318-contentplan-sync-chmurowy

## Wykonane

Faza R8 modułu Content Plan: synchronizacja z Supabase wg precedensu modułu
events (workflow tier: developer → reviewer, werdykt APPROVED). Analiza wstępna
potwierdziła, że zadanie było nadal aktualne — warstwa chmurowa nie miała
żadnego śladu contentplanu.

- **`src/supabase/cloudMirror.ts`** — rodzina diff `diffContentPlanToCloudOps`
  w porządku zależności: marki → publikacje → kanały → komentarze → historia
  recenzji. Komentarze i historia są append-only; wiersze zależne od usuniętej
  marki/publikacji zostawione kaskadzie FK; tagi `string` ↔ `text[]`; media
  Google Drive mapowane na kolumny `media_*`. Nowość: `CloudOp.schema` +
  routing w `applyCloudOps(db, ops, schemaDbs?)` — opsy contentplanu idą do
  adaptera schematu `contentplan`, nigdy do domyślnego `n2click`; brak
  adaptera/tabeli = cichy drop bez zamrożenia kolejki planera.
- **`src/supabase/plannerData.ts`** — `createSupabaseContentPlanDb` oparte o
  `client.schema('contentplan')` (główny klient zostaje przypięty do
  `n2click`, bez drugiego `createClient`), `loadContentPlanSnapshot` (5 tabel →
  zagnieżdżony kształt lokalny + łagodne sanitizery domenowe), wspólny
  `isMissingCloudTable`.
- **`src/supabase/CloudSyncProvider.tsx`** — hydracja modułu przy logowaniu
  (dispatch `MERGE_CLOUD_CONTENT_PLAN`), opsy diffu w tej samej kolejce zapisu,
  akcja dodana do SUPPRESSED.
- **`src/store/AppStore.tsx`** — akcja `MERGE_CLOUD_CONTENT_PLAN`
  (autorytatywna podmiana obu kolekcji przez `reconcileRows`, fail-closed).
- **`src/contentplan/domain.ts`** — `splitContentPlanTags`/`joinContentPlanTags`
  (jedno miejsce konwersji tagów). **`src/store/exportDryRun.ts`** — wiersz
  „Content Plan (schemat contentplan)”. **`src/store/persistGate.ts`** — tylko
  komentarz (klucze modułu świadomie w `NON_MIRRORED_KEYS`).
- **Realtime jawnie pominięty** w tej fazie: żadnych subskrypcji
  `postgres_changes` dla `contentplan`; w wiki odnotowano, że przyszła
  subskrypcja musi literalnie podać schemat (Realtime nie dziedziczy
  `db.schema`).
- **Wiki updated** (decyzja reviewera): `openwiki/n2hub/cloud-database.md`
  (sekcja contentplan, routing schematów, degradacja missing-table, pominięcie
  Realtime) i `state-and-persistence.md` (koniec „LOKALNE ONLY”, hydracja
  modułu) — poprzednie brzmienie było już nieprawdziwe.

## Zmiany

- `src/supabase/cloudMirror.ts` + `cloudMirror.test.ts`
- `src/supabase/plannerData.ts` + `plannerData.test.ts`
- `src/supabase/CloudSyncProvider.tsx`
- `src/store/AppStore.tsx`, `src/store/cloudMerge.test.ts`
- `src/store/exportDryRun.ts` + `exportDryRun.test.ts`
- `src/store/persistGate.ts` (komentarz), `src/contentplan/domain.ts`
- `openwiki/n2hub/cloud-database.md`, `openwiki/n2hub/state-and-persistence.md`
- `handoffs/RUN-STATE.md`

## Weryfikacja

- Testy nowe: +29 (mapowanie wierszy diffu, idempotencja, kaskady, append-only,
  routing schematu i cichy drop w `applyCloudOps`, hydracja + degradacja
  missing-table 42P01/PGRST205, przypadek mieszany/przejściowy, uszkodzony
  wiersz, round-trip przez reduktor, 14 wariantów inwariantu 6 dla
  `MERGE_CLOUD_CONTENT_PLAN`, wiersz exportDryRun).
- `npm test`: 119 plików / 2663 testy, 0 failów (pełny przebieg developera;
  reviewer dodatkowo wyrywkowo: 4 zmienione pliki testowe, 173 passed).
- `npm run build`: zielony (built in 3.13s, index 455.36 kB / gzip 133.08 kB).
- Reviewer (read-only): APPROVED, kryteria 1–7 PASS, brak zmian w SQL i UI,
  brak drugiego `createClient`, brak subskrypcji realtime dla contentplanu.
- Gate (`npm test && npm run build`): oczekuje na scheduler

## Ryzyka / rzeczy do sprawdzenia

1. **Do czasu wystawienia schematu `contentplan` w Data API (dashboard →
   Exposed schemas) logowanie autorytatywnie zeruje kolekcje modułu** —
   degradacja missing-table zwraca trwałe `[]` zgodnie ze specyfikacją, więc
   lokalnie utworzone marki/publikacje zniknęłyby przy logowaniu w takim
   środowisku. Krok operatora wykonać przed wydaniem; tryb lokalny (puste
   `VITE_SUPABASE_*`) działa bez zmian.
2. **Marki tworzone lokalnie mają id-slug (`uniqueBrandId`), a
   `contentplan.brands.id` to `uuid`** — nie lustrują się (wzorzec `nonUuid`
   z events) i przy hydracji są usuwane wraz z publikacjami. Marki z chmury
   (seed TWS) mają UUID i synchronizują się normalnie. Domknięcie wymaga zmiany
   generatora id w domenie/UI — poza zakresem R8.
3. Diagnostyka dropów diffu (nie-UUID) nie jest dziś pokazywana użytkownikowi
   poza wierszem export dry-run — parytet z główną rodziną diff.
4. Konwersja tagów kanonizuje białe znaki (wielokrotne spacje/nowe linie →
   pojedyncza spacja przy round-tripie).
5. Realtime dla contentplanu świadomie pominięty w tej fazie.

## Podpis schedulera

- Run: `20260803-202156-n2hub-318-contentplan-sync-chmurowy`
- Prompt: `318-contentplan-sync-chmurowy.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `8f19b06431096a118fd51a756de9bbcaa300dff9`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `8f19b06431096a118fd51a756de9bbcaa300dff9`
- Gałąź review: `review-integration`
- Run: `20260803-202156-n2hub-318-contentplan-sync-chmurowy`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `openwiki/n2hub/cloud-database.md`
- `openwiki/n2hub/state-and-persistence.md`
- `src/contentplan/domain.ts`
- `src/store/AppStore.tsx`
- `src/store/cloudMerge.test.ts`
- `src/store/exportDryRun.test.ts`
- `src/store/exportDryRun.ts`
- `src/store/persistGate.ts`
- `src/supabase/CloudSyncProvider.tsx`
- `src/supabase/cloudMirror.test.ts`
- `src/supabase/cloudMirror.ts`
- `src/supabase/plannerData.test.ts`
- `src/supabase/plannerData.ts`
- `handoffs/scheduler-reviews/20260803-202156-n2hub-318-contentplan-sync-chmurowy.md`
