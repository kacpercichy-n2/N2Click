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
