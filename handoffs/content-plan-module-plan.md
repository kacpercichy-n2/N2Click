# Moduł Content Plan w N2Hub — plan wdrożenia + prompty schedulera

Data: 2026-08-03. Autor: sesja planistyczna (Fable). Źródło:
`/Users/kacpercichyn2/Documents/AI/N2Media/Content plan` (uwaga: spacja w ścieżce).

> **Aktualizacja 2026-08-03:** prompty z §5 zostały przepisane do formatu
> schedulera i zakolejkowane jako `prompts/n2hub/311–319` (R10 czeka w
> `prompts-staged/n2hub/320`). Wersja w §5 jest wyłącznie referencyjna —
> obowiązuje treść plików kolejki. Decyzja gatingu: **na start moduł widzą
> wyłącznie użytkownicy z rolą `administrator`** (patrz §2 pkt 4 i §4 pkt 3).

---

## 1. Ustalenia z rozpoznania

### 1.1 Katalog „Content plan" to DWIE niezależne aplikacje

| | Root (`src/main.tsx`) | `planner/` |
|---|---|---|
| Stack | Vite 8, React 19, **Mantine 9**, TS, motion, lucide | Vite, React 19, JSX bez TS |
| Rozmiar | 1 plik, 2423 linie, `mountContentPlan()` już wyeksportowany | ~10 plików: views, components, data, lib |
| Model | Typowany: `Brand` / `ContentItem` / `ChannelPost` / `Comment` / `ChangeEventLog`, 7 polskich statusów | `client` / `post` z `platforms[]`, `variants{}`, `media{source:'gdrive', fileId}` |
| Dane | Tylko demo (2 marki, 2 posty) | **Dane live: `data/tws.js` — 23 realne posty Tetra Wave (VII–VIII 2026)** wyciągnięte 1:1 z `Content plan - TWS.xlsx`; + 36 postów demo w `data/posts.js` |
| Google | **Brak** | **Całość: `lib/google.js`** — GIS token flow, scope `drive.file`, Google Picker, `shareFilePublic`, miniatury z `drive.google.com/thumbnail` |
| Persistencja | localStorage `content-plan-store`; media jako base64 (limit 4 MB) | media jako Drive `fileId` (nic nie przechodzi przez naszą infrę); localStorage `n2planner.driveParents` |
| Style | Globalne, kolizyjne (`:root --bg/--text`, `body::before`, remote Google Fonts) | Tokeny skopiowane 1:1 z N2click `styles.css`; `@fontsource` |
| Testy | 60+ (unit, RTL, axe, defects, Playwright) | Brak |
| Deploy | Vercel `content-planer` | Tylko lokalnie (localhost:5199/5173) |

„Akcepty" klienta to koncept lokalny (statusy Akceptacja/Uwagi + przyciski w
ClientView) — **nie** są backowane przez Google. Google to wyłącznie Drive/Picker
na media. Pliki `Content plan - Lentria*.{csv,xlsx}` nie są czytane przez żaden
kod — to niezmigrowany materiał źródłowy.

### 1.2 Infrastruktura N2Hub (potwierdzona w kodzie i żywej bazie)

- Nawigacja: React Router 6, `NAV` w `src/components/navItems.ts`, chunki w
  `src/pages/routeChunks.ts`, trasy + gating w `src/App.tsx` (wzorzec
  `/admin`: filtr `navPaths` + `<Navigate>` + samo-guard strony). Wzorzec
  czystej funkcji gate'a: `src/pages/teamScope.ts`.
- Frontend **nie czyta JWT** — rola płynie ze snapshotu `OrgDataProvider`
  (`src/supabase/referenceData.ts`, `CloudRole = administrator|manager|worker`).
- Klient Supabase przypięty do schematu `n2click`
  (`src/supabase/client.ts`); dostęp do innego schematu przez
  `client.schema('...')` lub drugi cienki adapter.
- Store: `AppStore.tsx` (reducer + external store), granica localStorage w
  `storage.ts`, `DATA_VERSION = 7` — **kolekcja czysto addytywna NIE bumpuje
  wersji** (precedens: `events`, `tickets`, `notifications`).
- Precedens modułu = `events` (2026-07-21): typ w `types.ts`, slice w
  `AppData`+`emptyData()`+sanitizer, akcje+reducer, selektory, strona+modal,
  rodzina diff w `cloudMirror.ts`, gałąź hydrate w `plannerData.ts`, wiersz w
  `exportDryRun.ts`, migracja SQL.
- Baza (projekt `N2Hub`, ref `rclcndcgxbpndpmuemww`): schematy per aplikacja
  istnieją (`core`, `app`, `n2click`, `clarity`, `blogoapp`, `n2bingo`).
  `core.app_access(user_id, app text, role text, company_id, created_at)` —
  obecnie `n2click`: 9 użytkowników, wszyscy `admin`. Hook JWT składa wszystkie
  wpisy do claimów `app_roles` / `app_company`; RLS czyta przez
  `core.has_app()` / `core.app_role()`.

---

## 2. Decyzje architektoniczne

1. **Port natywny, nie osadzenie.** Mantine w N2Hub łamie „no UI framework"
   i „never mix two design systems"; CSS obu aplikacji źródłowych jest
   globalnie kolizyjny. Przenosimy logikę i widoki na prymitywy N2Hub
   (`useOverlay`, `useModalShell`, `Field`, `ModalFrame`, barrel `icons.ts`,
   klasy `.page`/`.editor-section`, tokeny `--n2-*`). Klasy modułu z prefiksem
   `cp-` w jednym `styles.css`.
2. **Model domenowy: typowany model root appki + model mediów plannera.**
   `Brand`/`ContentItem`/`ChannelPost` zostają bazą (są typowane i pokryte
   testami), ale media przechowujemy jak planner: `{source:'gdrive', fileId,
   width?, height?, type}` — **żadnego base64 w store/bazie**.
3. **Baza: nowy schemat `contentplan`** — dokładnie wg przepisu z CLAUDE.md
   (schemat, granty minimalne, RLS na każdej tabeli, wąskie widoki-mostki,
   Exposed schemas w dashboardzie). Moduł „istnieje z boku" jak blogoapp/bingo,
   niczego nie dopisujemy do `core` poza wierszami w `core.app_access`.
4. **Gating = `core.app_access` z `app='contentplan'`.** Hook JWT już to
   obsłuży bez zmian. RLS: `core.has_app('contentplan')`. Frontend: czysta
   funkcja `canViewContentPlan()` (wzorzec `teamScope.ts`) czytająca grant
   modułu ze snapshotu (wąski widok `contentplan.my_access` lub dodatkowy
   select w snapshotcie org). **Na start grant dostają wszyscy członkowie
   n2click** (= widoczne dla wszystkich), ale przełącznik ról jest gotowy —
   zawężenie do administratorów to zmiana wierszy w `app_access`, nie kodu.
   **Decyzja operatora (2026-08-03): na ten moment moduł widzą wyłącznie
   użytkownicy z rolą `administrator`** — frontendowy gate sprawdza CloudRole
   ze snapshotu, seed `app_access` kopiuje tylko wpisy n2click z role='admin'.
5. **Marki modułu a klienci N2Hub:** luźne powiązanie — `contentplan.brands`
   ma opcjonalną kolumnę `n2click_client_id` (bez twardego FK między
   schematami), do podpięcia w UI później. Bez tego moduł działa samodzielnie.
6. **Sync wg precedensu `events`:** slice'y w AppStore + rodzina diff w
   `cloudMirror.ts` + hydrate w `plannerData.ts` (adapter na
   `client.schema('contentplan')`). Tryb lokalny (puste `VITE_SUPABASE_*`)
   działa dalej na localStorage.
7. **Google Drive:** port `planner/src/lib/google.js` do TS
   (`src/contentplan/google.ts`), te same 2 zmienne env
   (`VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_API_KEY`), pamięć folderów
   (`clientId:miesiąc → folderId`) przenosi się z localStorage do tabeli
   `contentplan.drive_folders`. **Wymaga ręcznej zmiany w Google Cloud**
   (origins + referrers — patrz §4).
8. **Portal klienta (akcepty zewnętrzne) = osobna, późniejsza faza.** Teraz
   moduł jest wewnętrzny; rola `client` w `app_access` i polityki RLS
   „klient widzi tylko published swojej marki" są przewidziane w schemacie,
   ale UI portalu nie wchodzi w ten zakres.

## 3. Plan wdrożenia (fazy = rangi promptów)

| Ranga | Faza | Zakres | Tier | Zależy od |
|---|---|---|---|---|
| R1 | Baza danych | schemat `contentplan`, tabele, RLS, granty, `app_access`, widoki-mostki, seed grantów | architect→developer | — |
| R2 | Domena + store | typy `ContentPlan*`, slice'y, akcje, sanitizery, selektory | developer | — (równolegle z R1) |
| R3 | Routing + gate | trasa `/content-plan`, NAV, chunk, `contentPlanScope.ts`, szkielet strony | developer | R2 |
| R4 | UI: kalendarz | siatka miesiąca, karty postów, statystyki, pager miesięcy | developer | R3 |
| R5 | UI: edytor + admin | inspektor posta (kanały, warianty copy, tagi, komentarze, historia), zarządzanie markami i słownikami | developer | R4 |
| R6 | Import danych live | mapper `tws.js` → model, seed 23 postów TWS + marki do bazy | developer + test-writer | R1, R2 |
| R7 | Google Drive | port `google.ts`, Picker, `drive_folders`, miniatury | developer | R5 (+ ręczne w GCP) |
| R8 | Sync chmurowy | diff w `cloudMirror`, hydrate w `plannerData`, adapter schematu | developer | R1, R2, R5 |
| R9 | Testy + hardening | port testów domenowych, testy gate'a, browser check, wiki, review | test-writer + reviewer | R3–R8 |
| R10 | Zawężenie ról | przełączenie widoczności na role (np. tylko administratorzy) | developer (mały) | R9 (decyzja ludzka) |

Konteksty wiki do deklarowania: R1/R6/R8 → `cloud-database.md`; R2 →
`state-and-persistence.md`; R3–R5 → `ui-navigation-and-onboarding.md` +
`frontend-performance-and-primitives.md`; R9 → `testing-and-automation.md`.

## 4. Zadania ręczne (człowiek, poza schedulerem)

1. **Supabase dashboard**: po R1 dodać `contentplan` do Integrations → Data
   API → Exposed schemas (nie da się z migracji; bez tego PostgREST zwraca 406).
   Nie klikać „custom grants" w Exposed tables.
2. **Google Cloud** (projekt „My First Project", konto
   kacper.cichy@n2media.agency): do OAuth clienta „N2 Content Planner Web"
   dodać JavaScript origins produkcyjnego i lokalnego originu N2Hub; do klucza
   API (restrykcja: Google Picker API) dodać te same HTTP referrers.
3. **Decyzja przed R10**: kto finalnie widzi moduł (rola per użytkownik
   w `core.app_access`). **PODJĘTA 2026-08-03: wyłącznie administratorzy**
   (wdrażana od razu w fazie R3/prompt 313; R10 zostaje w stagingu na
   wypadek przyszłej zmiany kryterium).
4. (Później) ekstrakcja danych Lentrii z `Content plan - Lentria.xlsx` — nikt
   ich jeszcze nie zmigrował do kodu.

---

## 5. Lista promptów do schedulera

Każdy prompt wklejany osobno w sesji Claude Code w repo N2click jako
`/tier <treść>`. Architect ma obowiązek przejść Definition of Ready i wystawić
pakiety `handoffs/packages/PKG-*.md` z tierem i blast radius; workerzy
aktualizują `handoffs/RUN-STATE.md`. Rangi = kolejność uruchamiania; R1 i R2
można puścić równolegle (osobne sesje/worktree — pamiętaj o zakazie zmian
stanu gita w subagentach).

---

### R1 · PROMPT 1 — schemat bazy `contentplan` (blast: high)

```
/tier Moduł Content Plan — fundament bazodanowy. Kontekst wiki: cloud-database.md.
Utwórz w projekcie Supabase N2Hub nowy schemat `contentplan` dokładnie wg przepisu
z ~/.claude/CLAUDE.md („Supabase - how our database is built"): create schema,
grant usage dla anon/authenticated/service_role, granty tylko na używane verby
(bez TRUNCATE/ALL dla anon), RLS na każdej tabeli od pierwszej migracji.
Tabele (kształt wyprowadź z modelu domenowego w
"/Users/kacpercichyn2/Documents/AI/N2Media/Content plan/src/main.tsx" linie 53-138
oraz media-modelu z ".../Content plan/planner/src/data/posts.js"):
- brands (id, name, industry, contact, accent, platforms jsonb, topics text[],
  formats text[], n2click_client_id uuid null — bez FK między schematami),
- posts (id, brand_id FK, date date, title, topic, format, status, visibility
  draft|published, base_tags text[], created_at, updated_at),
- post_channels (id, post_id FK, platform_id, copy, tags text[], override_tags bool,
  description_group_id, media_source gdrive|null, media_file_id, media_width,
  media_height, media_type image|video),
- comments (id, post_id FK, author, body, at, parent_id),
- post_history (id, post_id FK, label, at),
- drive_folders (brand_id, month_key, folder_id, PK(brand_id, month_key)).
RLS: pełny dostęp dla core.has_app('contentplan') z rolą admin/editor
(core.app_role('contentplan')); przygotuj (ale wyłączone kodem, nie brakiem
polityki) politykę pod przyszłą rolę client: select tylko visibility='published'
w obrębie przypisanej marki. Widok-mostek contentplan.my_access (user_id, role)
nad core.app_access ograniczony do auth.uid(), do odczytu grantu przez frontend.
Seed: wiersze core.app_access app='contentplan', role='admin' dla wszystkich
obecnych członków n2click (istniejące wpisy app='n2click').
Migracje jako pliki w supabase/migrations/ wg konwencji repo (nagłówek-banner
po polsku, search_path='', pełna kwalifikacja nazw) — src/supabase/migrations.test.ts
musi przejść. Aplikowanie przez MCP apply_migration wyłącznie za moją zgodą.
Na końcu przypomnij mi o ręcznym kroku: Exposed schemas w dashboardzie.
Out of scope: jakikolwiek kod frontendu, zmiany w schemacie n2click i core
poza wierszami app_access.
```

### R2 · PROMPT 2 — domena i store (blast: medium)

```
/tier Moduł Content Plan — warstwa domeny i store. Kontekst wiki:
state-and-persistence.md. Przenieś typowany model domenowy z
"/Users/kacpercichyn2/Documents/AI/N2Media/Content plan/src/main.tsx"
(linie 53-200: Brand, ContentItem, ChannelPost, Comment, ChangeEventLog,
statusy, monthKey/monthLabel/getMonthDays oraz czyste helpery: uid, brandSlug,
uniqueBrandId, getDescriptionGroups, groupTags, validatePostForPublication,
makeEmptyPost, flattenCommentReplies) do N2Hub jako moduł
src/contentplan/domain.ts + typy ContentPlanBrand/ContentPlanPost/... w
src/types.ts. ZMIANA względem źródła: media w kanale to
{source:'gdrive', fileId, width?, height?, type} — usuń pola base64
(assetPreview/assetName) i limit 4MB. Nie dubluj logiki dat z src/utils/dates.ts.
Dodaj slice'y contentPlanBrands i contentPlanPosts do AppData wg precedensu
events/tickets: emptyData(), sanitizer na load w storage.ts (BEZ bumpu
DATA_VERSION — kolekcje czysto addytywne), akcje reducer'a
(SAVE_CP_BRAND, DELETE_CP_BRAND, SAVE_CP_POST, DELETE_CP_POST, REVIEW_CP_POST,
PUBLISH_CP_MONTH, ADD_CP_COMMENT) z zachowaniem inwariantu 6 (niepoprawna
komenda zwraca tę samą referencję stanu), selektory w selectors.ts
(posty po marce+miesiącu, liczniki statusów). Testy jednostkowe czystej domeny
przeportuj z ".../Content plan/tests/unit/domain.test.ts" (środowisko node,
konwencja vitest repo). npm test i npm run build zielone.
Out of scope: UI, trasy, Supabase, Google.
```

### R3 · PROMPT 3 — trasa, nawigacja, gate (blast: medium)

```
/tier Moduł Content Plan — wpięcie w nawigację z gatingiem modułowym.
Kontekst wiki: ui-navigation-and-onboarding.md. Dodaj trasę /content-plan
(etykieta „Content plan") wg pełnej checklisty nowego widoku: wpis w
src/components/navItems.ts z ikoną przez barrel src/components/icons.ts
(dobierz ikonę lucide typu CalendarRange/LayoutList), loader w
src/pages/routeChunks.ts, <Route> w src/App.tsx, NAV_LABELS.
Gating wg wzorca /admin + teamScope: nowy czysty moduł
src/pages/contentPlanScope.ts z funkcją canViewContentPlan(user, moduleAccess)
— na ten moment zwraca true dla każdego zalogowanego użytkownika appki, ale
przyjmuje grant modułu (rola z contentplan.my_access lub null w trybie
lokalnym) tak, żeby zawężenie do konkretnych ról było zmianą jednej funkcji.
Filtr navPaths w App.tsx + <Navigate> na trasie + samo-guard strony, jak /admin.
Strona src/pages/ContentPlanPage.tsx: na razie szkielet (.page, nagłówek,
pager miesięcy ze stanem w URL ?m=YYYY-MM, pusty stan .empty-state po polsku).
Testy: node-testy contentPlanScope.ts oraz aktualizacja
src/utils/navOrder.test.ts / src/components/bottomNav.test.ts jeśli asercje
tego wymagają. npm test i npm run build zielone.
Out of scope: właściwy kalendarz i edytor, Supabase, Google.
```

### R4 · PROMPT 4 — UI kalendarza miesięcznego (blast: medium)

```
/tier Moduł Content Plan — widok kalendarza. Konteksty wiki:
ui-navigation-and-onboarding.md + frontend-performance-and-primitives.md.
Przeportuj do src/pages/ContentPlanPage.tsx widoki CalendarGrid, PostCard i
MonthStats z "/Users/kacpercichyn2/Documents/AI/N2Media/Content plan/src/main.tsx"
(linie 1266-1653) na prymitywy i konwencje N2Hub: zero Mantine, klasy CSS z
prefiksem cp- dopisane do src/styles.css (jeden arkusz, tokeny --n2-*, motion
przez mnożnik --n2-motion), ikony przez barrel, animacje przez m.* (LazyMotion
strict). Funkcje: wybór marki (natywny select w Field), siatka dni miesiąca
z kartami postów (status, platformy, tytuł, miniatura placeholder), liczniki
MonthStats, dodawanie pustego posta w dniu (makeEmptyPost z R2), kopiuj/wklej
posta, usuwanie przez useConfirm() (nigdy window.confirm). Dane z AppStore
(slice'y z R2). Wszystkie stringi po polsku, bez em/en-dash. Zarejestruj
encje w GlobalSearch (globalSearchModel.ts), jeśli to addytywnie proste —
w przeciwnym razie odnotuj jako deferral w RUN-STATE.
npm test i npm run build zielone.
Out of scope: inspektor/edytor posta (R5), Drive (R7), sync (R8).
```

### R5 · PROMPT 5 — edytor posta i administracja marek (blast: medium)

```
/tier Moduł Content Plan — edytor posta + zarządzanie markami. Konteksty wiki:
ui-navigation-and-onboarding.md + frontend-performance-and-primitives.md.
Przeportuj PostInspector (".../Content plan/src/main.tsx" linie 1654-2127,
komentarze wątkowane 2128-2357) i AdminView (1122-1265) na prymitywy N2Hub:
edytor posta jako modal na useModalShell (wzorzec TaskModal/EventModal:
jeden scroller .task-modal-body, focus trap, dirty-guard przez
utils/dirtyRegistry), sekcje: meta (data, tytuł, temat, format, status,
widoczność draft/published), kanały per platforma z wariantami copy
(grupy opisów getDescriptionGroups), tagi z dziedziczeniem (groupTags),
walidacja publikacji (validatePostForPublication) z komunikatami przy polach
(Field + field-error), komentarze wątkowane, historia zmian, akcept klienta
(REVIEW_CP_POST: Akceptacja/Uwagi). Zarządzanie markami jako sekcja strony
lub modal: CRUD marek, słowniki platform/tematów/formatów z guardem
integralności referencyjnej (nie można usunąć wartości użytej w postach —
przeportuj logikę z AdminView). Media na razie tylko jako odczyt fileId
(miniatura-placeholder) — picker wchodzi w R7. CSS cp- w styles.css.
npm test i npm run build zielone; RTL-testy kluczowych przepływów przeportuj
selektywnie z ".../Content plan/tests/components/app.test.tsx".
Out of scope: Google Drive, sync, portal klienta.
```

### R6 · PROMPT 6 — import danych live TWS (blast: high — dane produkcyjne)

```
/tier Moduł Content Plan — migracja danych live Tetra Wave. Kontekst wiki:
cloud-database.md. Źródło:
"/Users/kacpercichyn2/Documents/AI/N2Media/Content plan/planner/src/data/tws.js"
(23 realne posty VII-VIII 2026, nagłówek pliku dokumentuje reguły ekstrakcji:
merge kreacji IG/FB/TikTok w jeden post z variants, sloty, statusy sheet*) oraz
meta.js (PLATFORMS, STATUSES) i posts.js (marki/DRIVE_CATEGORIES) z tego samego
katalogu. Napisz jednorazowy, idempotentny skrypt importu (scripts/, node) który
mapuje model plannera na model contentplan z R1/R2: marka Tetra Wave Solutions
+ jej słowniki, posty z variants{platform:copy} → post_channels per platforma,
media.fileId → media_file_id (source gdrive), statusy sheet → nasze 7 statusów
(tabela mapowania w kodzie z komentarzem), visibility='published' dla postów
zaakceptowanych. Wyjście skryptu: SQL seed jako migracja w supabase/migrations/
(konwencje repo, migrations.test.ts zielony) LUB wsad przez service-role —
architect wybiera i uzasadnia w pakiecie. Nic nie aplikujemy do bazy bez mojej
zgody. Test-writer: testy mappera (node) na minimum 3 postach źródłowych
w tym jeden z variants i jeden z videoFile.
Out of scope: dane Lentrii (xlsx nie ma ekstrakcji w kodzie — tylko odnotuj),
posty demo z posts.js (BASE_POSTS nie wchodzą do produkcyjnej bazy).
```

### R7 · PROMPT 7 — Google Drive: picker i media (blast: high — zewnętrzne API)

```
/tier Moduł Content Plan — integracja Google Drive. Konteksty wiki:
ui-navigation-and-onboarding.md + cloud-database.md. Przeportuj
"/Users/kacpercichyn2/Documents/AI/N2Media/Content plan/planner/src/lib/google.js"
do src/contentplan/google.ts (TS, bez zmian architektury): GIS token flow
initTokenClient ze scope https://www.googleapis.com/auth/drive.file, cache
tokenu w pamięci z marginesem 60s, Google Picker (pickFromDrive multi-select
media, pickFolderFromDrive dla folderu marki) z setOrigin(window.location.origin),
shareFilePublic (POST drive/v3 permissions anyone/reader, best-effort),
helpery driveThumbUrl/driveViewUrl/drivePreviewUrl. Zmienne env:
VITE_GOOGLE_CLIENT_ID i VITE_GOOGLE_API_KEY — dopisz do .env.example z
komentarzem; walidacja miękka (moduł działa bez Google — przyciski pickera
disabled z DisabledHint i powodem po polsku). Pamięć folderów
(brandId:YYYY-MM → folderId): czytaj/zapisuj tabelę contentplan.drive_folders
przez adapter client.schema('contentplan'), z fallbackiem localStorage w trybie
lokalnym. Wepnij picker w edytor posta z R5 (wybór mediów → media_file_id +
auto-share + miniatura). Ładowanie skryptów gsi/api.js leniwe, tylko na
stronie modułu. Testy: czysta logika (cache tokenu, budowa URL miniatur,
mapowanie wyboru pickera) w node; sam Picker mockowany.
Przypomnij mi na końcu o ręcznym kroku w Google Cloud: dodanie originów N2Hub
do OAuth clienta „N2 Content Planner Web" i referrerów klucza API.
Out of scope: upload przez naszą infrastrukturę, Sheets API, refresh tokeny,
backend.
```

### R8 · PROMPT 8 — sync z chmurą (blast: high — dane + RLS)

```
/tier Moduł Content Plan — synchronizacja z Supabase. Konteksty wiki:
cloud-database.md + state-and-persistence.md. Wg precedensu modułu events:
dodaj rodzinę diff dla contentPlanBrands/contentPlanPosts (+ kanały, komentarze,
historia) w src/supabase/cloudMirror.ts i gałąź hydrate w
src/supabase/plannerData.ts, z adapterem opartym o client.schema('contentplan')
(klient główny zostaje przypięty do n2click — nie twórz drugiego createClient).
Zachowaj konwencje: degradacja missing-table (PGRST205/42P01 → trwałe []),
MERGE_CLOUD_* zastępuje kolekcje lustrzane przy logowaniu, tryb lokalny
(puste VITE_SUPABASE_*) działa bez zmian na localStorage, nieudany zapis nigdy
nie raportuje „Zapisano". Dopisz wiersz modułu do exportDryRun.ts. Uwaga na
Realtime, jeśli go dotykasz: subskrypcje postgres_changes muszą literalnie
podawać schemat contentplan (db.schema nie jest dziedziczone) — jeśli Realtime
nie jest potrzebny w tej fazie, jawnie go pomiń i odnotuj w RUN-STATE.
Testy: diff/hydrate w node na fixtures; npm test i npm run build zielone.
Out of scope: zmiany w schemacie SQL (to R1), UI.
```

### R9 · PROMPT 9 — testy końcowe, wiki, werdykt (blast: low)

```
/tier Moduł Content Plan — hardening i domknięcie. Kontekst wiki:
testing-and-automation.md (+ strony deklarowane przez poprzednie fazy).
Test-writer: uzupełnij pokrycie — gate (canViewContentPlan: zalogowany/
niezalogowany/tryb lokalny/przyszłe role), sanitizery storage (uszkodzony
slice contentplan nie zabija payloadu), walidacja publikacji miesiąca,
mapowanie statusów importu TWS; przeportuj selektywnie testy defects z
".../Content plan/tests/defects/security-and-integrity.test.tsx" (odrzucenie
niepoprawnego localStorage, słowniki-integralność). Browser check tylko dla
zmienionych interakcji modułu (tryb lokalny: wyzerowane VITE_SUPABASE_* +
dane seed). Reviewer: pełny werdykt względem planu
handoffs/content-plan-module-plan.md — w szczególności: brak Mantine w bundlu,
brak nowych bibliotek bez decyzji, RLS na każdej tabeli contentplan, brak
base64 w store, stringi po polsku, inwarianty CLAUDE.md nienaruszone
(w tym: żadnych regresji kalendarza/binu planera). Architect: final eval +
aktualizacja stron wiki, których granice/inwarianty się zmieniły (co najmniej
ui-navigation-and-onboarding.md o nową trasę i gate oraz cloud-database.md
o schemat contentplan) albo raport „wiki unchanged" z uzasadnieniem.
Commit dopiero po moim zatwierdzeniu werdyktu.
```

### R10 · PROMPT 10 — zawężenie widoczności do ról (blast: low; po decyzji ludzkiej)

```
/tier Moduł Content Plan — włączenie gatingu rolami. Kontekst wiki:
ui-navigation-and-onboarding.md. Decyzja: moduł widzą wyłącznie [TU WPISZ ROLE,
np. administratorzy]. Zmień canViewContentPlan w src/pages/contentPlanScope.ts
tak, by wymagała grantu modułu z contentplan.my_access z rolą z podanej listy
(tryb lokalny: widoczny — klientowskie checki to UX, nie granica bezpieczeństwa),
zaktualizuj node-testy scope'a. Przygotuj migrację SQL aktualizującą wiersze
core.app_access app='contentplan' do docelowego zbioru użytkowników/ról
(aplikacja za moją zgodą). Zweryfikuj, że RLS z R1 również zawęża dostęp po
stronie bazy (polityki czytają core.app_role('contentplan')).
Out of scope: portal klienta, nowe role w matrycy permissions.ts.
```

---

## 6. Poza zakresem promptów (świadomie)

- Portal klienta z akceptami zewnętrznych użytkowników (rola `client` w
  `app_access` + osobne polityki RLS są przygotowane w R1, UI nie).
- Ekstrakcja danych Lentrii z xlsx (60 MB, brak ekstrakcji w kodzie źródłowym).
- Realtime dla modułu.
- Wygaszenie starych aplikacji (Vercel `content-planer`, repo
  `N2ContentPlanner`) — do decyzji po starcie modułu.
