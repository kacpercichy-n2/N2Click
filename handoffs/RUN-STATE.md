# Run state — 20260803-185957-n2hub-315 Content Plan: edytor i marki (R5)

## Goal

Edytor publikacji jako modal na `useModalShell` (draft + jawny zapis, walidacja
publikacji przy polach, komentarze wątkowane, historia, akcept klienta przez
`REVIEW_CP_POST`, media tylko odczyt fileId) oraz zarządzanie markami i
słownikami z guardem integralności referencyjnej. Zero nowych akcji reduktora,
zero nowych bibliotek, CSS tylko `cp-`.

## Packages

1. `handoffs/packages/PKG-20260803-contentplan-editor-brands.md` — tier
   developer, ready, risk medium, Codex required. Jeden pakiet (modale dzielą
   powłokę, stronę i scope'y strażnika).

## Changed boundaries (planned)

`ContentPlanPage.tsx` (parametry `?publikacja=`/`?marka=`, klik karty otwiera
edytor, toolbar/pusty stan), nowe `components/ContentPlanPostModal.tsx`,
`components/ContentPlanBrandModal.tsx`, czyste
`components/contentPlanPostEditor.ts` i `components/contentPlanBrandEditor.ts`
(+ testy node), `utils/dirtyRegistry.ts` (+test; scope'y
`contentplan-post-modal`/`contentplan-brand-modal`), `styles.css` (blok `cp-`),
`components/icons.ts`. Reduktor, domena, selektory, kalendarz — bez zmian.

## Verification

Focused vitest z pakietu (postEditor, brandEditor, dirtyRegistry,
contentPlanActions, contentPlanCalendar), potem pełne `npm test` +
`npm run build` (scheduler-owned). Browser: none (Playwright niezainstalowany;
powłoka modali już zweryfikowana).

## Open questions

Brak blokujących. Świadome decyzje D1–D10 w pakiecie; D10 (port przepływów RTL
jako testy node — repo nie ma RTL/jsdom) do potwierdzenia w werdykcie
recenzenta. Wiki: akapit `/content-plan` w `ui-navigation-and-onboarding.md`
stanie się nieaktualny (karta ma otwierać edytor) — aktualizacja po zielonym
runie.

## Developer result (R5)

Zmienione granice: `ContentPlanPage` (modale montowane w stronie,
`?publikacja=`/`?marka=`), nowe `ContentPlanPostModal`/`ContentPlanBrandModal`
+ czyste `contentPlanPostEditor.ts`/`contentPlanBrandEditor.ts` (+ testy node),
dwa scope'y w `dirtyRegistry`, blok `cp-` w `styles.css`, cztery ikony.
Reduktor, domena i selektory nietknięte. `npm test`: 116 plików / 2567 testów
zielone; `npm run build` zielony. Wiki `/content-plan` zaktualizowane.
Blokad brak.

## Developer result (R6, 20260803-193729-n2hub-316)

Import live TWS: nowy mapper `scripts/contentplan-seed-tws-mapper.mjs` (+`.d.mts`),
skrypt I/O `scripts/contentplan-seed-tws.mjs`, test
`src/contentplan/twsSeedImport.test.ts`, migracja
`supabase/migrations/20260803170000_contentplan_seed_tws.sql` (1 marka / 23 posty
/ 55 kanałów) i wpis w `migrations.test.ts`. Dwa uruchomienia = identyczny plik.
`npm test` 117/2591 zielone, `npm run build` zielony. Nic nie aplikowano do bazy.
Wiki bez zmian.

## Developer result (R7, 20260803-195851-n2hub-317)

Nowe granice: `src/contentplan/google.ts` (GIS + Picker, leniwe skrypty tylko w
chunku `/content-plan`) i `src/contentplan/driveFolders.ts` (schemat
`contentplan` + fallback localStorage, cicha degradacja missing-table). Edytor
posta dostał sekcję mediów (`setChannelMedia`), `.env.example` dwie zmienne
Google. `npm test` 119 plików / 2634 testy zielone, `npm run build` zielony.
Wiki `/content-plan` zaktualizowane. Blokad brak.

## Developer result (R8, 20260803-202156-n2hub-318)

Nowe granice: `diffContentPlanToCloudOps` + routing `CloudOp.schema` w
`applyCloudOps` (cloudMirror), `createSupabaseContentPlanDb` +
`loadContentPlanSnapshot` (plannerData), akcja `MERGE_CLOUD_CONTENT_PLAN`
(AppStore), podpięcie w `CloudSyncProvider`, wiersz modułu w `exportDryRun`.
Realtime ŚWIADOMIE pominięty. `npm test` 119 plików / 2663 testy zielone,
`npm run build` zielony. Wiki: cloud-database + state-and-persistence.
Ograniczenie: marka o id-slugu (utworzona lokalnie) nie jedzie do chmury.

## Test-writer result (R9, 20260803-204922-n2hub-319)

Zweryfikowano 8 case'ów defects: wszystkie przeportowane albo N/A (login mock,
readAssetFile, uid-kolizja) dla obecnej architektury. Brak luk, brak zmian w
testach. Sweep a-g: PASS wszystkie (RLS 6/6, brak Mantine/nowych libów, brak
base64, brak dashy). `npm test` 119/2663 zielone, build zielony. Wiki
unchanged (oba źródła aktualne).

## Developer result (20260803-210302-n2hub-321)

Tylko `src/styles.css`. Nowy token `--n2-control-h: 36px` scala wysokości
kontrolek belki (`.toggle-btn`, `.nav-btn`, `.cal-toolbar .btn`, chip osoby,
plakietka zegara). `.nav-btn` centruje glif flexem plus korekta 1,5 px,
zerowana przy strzałkach i ikonach. `.cal-view-toggle` odłączone od `.cal-nav`
i sklejone wspólnie z `.ticket-mode-toggle`. Bez zmian w JSX. `npm test`
119/2663 zielone, `npm run build` zielony. Wiki unchanged.

## Developer result (20260803-212145-n2hub-322)

`PlanningProgress.tsx` bez paska (zostaje tekst godzin + `.sr-only`, util
nietknięty), `TasksPage.tsx` usuwanie na `Trash2`, bez `.card-chevron` (po
werdykcie także `ProjectsPage.tsx` — dzieliła `.task-card-main`),
`styles.css`: martwe reguły toru i chevronu karty (z rezerwą 40 px) oraz
`background-attachment: fixed` osobną deklaracją (skrót przyklejał tylko
ostatnią warstwę). `npm test` 119/2663 zielone, build zielony. Wiki: UI +
frontend-performance.

## Developer result (20260803-213841-n2hub-323)

`ClientsPage.tsx`: nagłówek karty bez chevrona (nazwa + pigułka-link projektów,
CTA „Zobacz szczegóły" z `aria-expanded`/`aria-controls`, `IconButton` edycja/
archiwum/usuwanie, archiwizacja przez `useConfirm()`), `icons.ts`
`ArchiveRestore`, `App.tsx` + `styles.css`: dwa paski `sticky` w `.app-main`
(tło strony + maska, `--n2-z-scroll-fade`) miękko wygaszające krawędzie
przewijania; dokument zostaje scrollportem. Po recenzji: `.editor-actions-sticky`
na `--n2-z-sticky-actions` (30) — na `/projects/:id` przykleja się do dokumentu,
więc wygaszenie (20) kryło mu krawędź i „Zapisz teraz". `npm test` 119/2663
zielone, build zielony. Wiki: UI.

## Developer result (20260803-221312-n2hub-324)

`changelog.ts` + testy: `changelogUnreadCount`. `DashboardPage.tsx`: przycisk
„Zobacz zmiany" z ikoną `History` i plakietką licznika (ten sam
`changelogSeenId`), puste Alerty jako pełna karta z pustym stanem.
`dashboardPanels.ts`: alerts `empty: null` (nigdy belka) — test zwijania
zaktualizowany świadomie. `styles.css`: badge + `.dash-alerts-empty-card`.
`npm test` 119/2669 zielone, build zielony. Wiki: UI.

## Developer result (20260803-222602-n2hub-325)

`AccountPage.tsx`: karty owinięte w `.account-grid` (sam wrapper, warunki i
logika bez zmian). `styles.css`: siatka 2 kolumn z zerowanym `margin-bottom`
kart i zwinięciem do 1 kolumny w `max-width: 760px` (breakpoint z pliku),
`.cloud-profile` dt/dd z `overflow-wrap: anywhere` (długi e-mail zawija się),
`.page > .people-form-hint` z odstępem nad listą osób. `npm test` 119/2669
zielone, build zielony. Wiki: bez zmian (brak nowej granicy ani inwariantu).

## Developer result (20260813 — migracja czatu)

Nowa `supabase/migrations/20260813180000_chat.sql`:
`n2click.conversations/conversation_members/messages`, trzy helpery `app.*`,
triggery Broadcast/bump, RPC `chat_overview`. Tabele świadomie poza
`supabase_realtime`; polityki `chat_*` na `realtime.messages`.
`migrations.test.ts`: lista, cztery wpisy `EXPECTED_POLICIES`, regex tabel
z cyframi, revoke-anon dla naszych schematów. `npm test` 2831/2832 — jedyna
porażka `contentplan/google.test.ts` (lokalny `.env.local`). Nic nie
aplikowano na bazę.

## Developer result (20260813 — rdzeń czatu)

Nowy `src/chat/`: `types`, `chatData` (wstrzykiwany `ChatDb`, kursor
`(created_at,id)`, fallback 23505), `chatState` (dedup/unread/resort),
`ChatProvider` (`useChat`, prywatne kanały broadcast + presence,
`realtime.setAuth`), dwa testy. `npx vitest run src/chat` 53/53; `npm test`
2883/2884 (porażka `contentplan/google` — `.env.local`); build zielony.
Provider niezamontowany, zero UI. Kontekst +migracja czatu (RLS członków).
Wiki bez zmian.

## Developer result (20260813 — UI czatu „bąbelki")

Nowe `src/chat/ui/`: 4 czyste modele widoku z testami + 5 cienkich komponentów.
`Avatar.tsx` wystawia `AvatarBase`, `icons.ts` +3 ikony, `styles.css` sekcja
czatu i token `--n2-z-chat: 890`, montaż w `main.tsx` (ChatProvider w
AvatarUrlsProvider, ChatDock obok routera). `npx vitest run src/chat` 106/106;
`npm test` 2937/2938 (znana porażka `contentplan/google`); build zielony.
Przeglądarka niesprawdzona (brak playwrighta). Wiki bez zmian.
