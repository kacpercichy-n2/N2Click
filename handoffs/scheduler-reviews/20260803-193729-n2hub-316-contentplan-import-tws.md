# Raport workflow: 20260803-193729-n2hub-316-contentplan-import-tws

## Wykonane

Content Plan, faza R6 — migracja danych live Tetra Wave (tier: developer → reviewer;
werdykt reviewera: **approve**, zero blockerów). Zadanie było aktualne: worktree
miał migracje z 311 i domenę z 312, ale ani skryptu importu, ani seeda TWS.

- Jednorazowy, idempotentny skrypt importu: `scripts/contentplan-seed-tws.mjs`
  (cienka warstwa I/O; domyślna ścieżka źródła nadpisywalna argumentem) +
  czysty mapper `scripts/contentplan-seed-tws-mapper.mjs` (bez I/O,
  deterministyczne UUID v5 w stałej przestrzeni nazw, zero `Date.now()`/
  `Math.random()`; dwa przebiegi → plik bajt w bajt identyczny) + sidecar typów
  `scripts/contentplan-seed-tws-mapper.d.mts` (tsconfig nie ma `allowJs`).
- Wygenerowany deterministyczny seed SQL jako migracja:
  `supabase/migrations/20260803170000_contentplan_seed_tws.sql` — banner po
  polsku, pełna kwalifikacja `contentplan.*`, `insert ... on conflict (id) do
  nothing` (seed danych historycznych — ponowne wykonanie nie cofa redakcji
  zespołu), bez DDL. Zawartość: **1 marka** (Tetra Wave Solutions, platformy
  FB/IG/TT, `n2click_client_id = null`), **23 posty** (7.07–11.08.2026),
  **55 post_channels** (wszystkie z mediami gdrive, 11 postów typu video).
- Rejestracja migracji na przypiętej liście w `src/supabase/migrations.test.ts`
  (1 wpis + komentarz — wymóg konwencji z `cloud-database.md`).
- Testy mappera: `src/contentplan/twsSeedImport.test.ts` — hermetyczne
  (fixtures wbudowane, bez czytania ścieżek poza repo), pokrywają mapowanie
  statusów, merge najmniej zaawansowanego statusu ze slotów, `visibility`,
  rozbicie na kanały per platforma (variants vs wspólny opis), media
  image/video (`videoFile`), determinizm i przypięte UUID v5 oraz render SQL
  (escaping, brak DDL). Fixture „z variants" to realny post `tws-0713-1`
  uzupełniony o `variants` — żaden z 23 postów TWS tego pola nie ma.

Mapowanie statusów sheet → 7 statusów modułu (tabela w kodzie mappera
z komentarzem): `📤 OPUBLIKOWANO` → `opublikowany`, `⌛ ZAPLANOWANE DO
PUBLIKACJI` → `zaplanowany`; dalej klucz plannera → status modułu:
szkic / w-produkcji → „W trakcie tworzenia", do-akceptacji → „Do akceptacji",
poprawki → „Wdrażane poprawki", zaakceptowany → „Akceptacja",
zaplanowany → „Zaplanowane", opublikowany → „Opublikowano".
`visibility='published'` dla kroku ≥ zaakceptowany (5–7) z bramką
`validatePostForPublication`; w seedzie 23/23 published (statusy: Opublikowano 5,
Zaplanowane 18 — zgodne z rozkładem źródła, 0 rozbieżności z polem `status`).

## Zmiany

- `scripts/contentplan-seed-tws.mjs` (nowy)
- `scripts/contentplan-seed-tws-mapper.mjs` (nowy)
- `scripts/contentplan-seed-tws-mapper.d.mts` (nowy)
- `src/contentplan/twsSeedImport.test.ts` (nowy)
- `supabase/migrations/20260803170000_contentplan_seed_tws.sql` (nowy, wygenerowany)
- `src/supabase/migrations.test.ts` (rejestracja migracji, 1 wpis)
- `handoffs/RUN-STATE.md` (wpis workera)

## Weryfikacja

- `npm test`: **zielony** (117 plików, 2591 testów) — uruchomione przez
  developera i niezależnie potwierdzone przez reviewera.
- `npm run build` (`tsc --noEmit && vite build`): **zielony** (2×, jw.).
- Determinizm: `node scripts/contentplan-seed-tws.mjs` ×2 + `diff` → pliki
  identyczne; reviewer dodatkowo zregenerował seed na żywych danych źródłowych
  i potwierdził zgodność bajt w bajt z commitowanym plikiem.
- Zgodność ze źródłem: 23 posty / 55 kanałów / rozkład statusów zgodne
  z `tws.js`; wyrywkowo zweryfikowane `tws-0707-1`, `tws-0708-1` (video),
  `tws-0811-1`. SQL spełnia CHECK-i schematu z `20260803160000`, wartości
  kanoniczne dla `src/contentplan/domain.ts`.
- **Nic nie zostało zaaplikowane do żadnej bazy** (zero połączeń: bez MCP,
  psql i supabase CLI). Gate (`npm test && npm run build`): oczekuje na scheduler.
- Wiki: **unchanged** — `cloud-database.md` opisuje granice schematu, RLS
  i konwencję rejestru migracji; seed czysto danych niczego nie dezaktualizuje.

## Ryzyka / rzeczy do sprawdzenia

- **Seed aplikuje operator ręcznie po review, po migracjach contentplan z R1**
  (`20260803160000..160300`) — pamiętaj też o ręcznym kroku Exposed schemas
  w dashboardzie z R1.
- Dla rolek `media_file_id` to miniatura jpg z Dysku przy `media_type='video'`
  (wierne wymogowi `media.fileId` → `media_file_id`; schemat R1 nie ma kolumny
  na mp4). Źródło niesie id mp4 w `videoUrl` — ewentualny follow-up, gdy
  schemat dostanie drugie gniazdo mediów; zmiana to jedna linia w mapperze
  i regeneracja.
- `brands.industry` puste (źródło nie niesie branży), `n2click_client_id` NULL
  (bez dostępu do bazy nie zgadywano UUID-ów), `drive_folders` nieseedowane
  (źródło nie mapuje folderów per marka+miesiąc).
- Id marki w seedzie to UUID, a lokalna domena nadaje slugi — dziś bez kolizji
  (kolekcje Content Planu są lokalne), przyszła hydracja chmurowa (R8) powinna
  przyjąć id z bazy.
- Dane Lentrii poza zakresem: `Content plan - Lentria.xlsx` nie ma ekstrakcji
  w kodzie — do osobnego zadania. `BASE_POSTS` (demo z `posts.js`) celowo nie
  weszły do seeda.

## Podpis schedulera

- Run: `20260803-193729-n2hub-316-contentplan-import-tws`
- Prompt: `316-contentplan-import-tws.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `7bf7a7ac4a6008b41e79296b1f24c2ba7696443d`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `7bf7a7ac4a6008b41e79296b1f24c2ba7696443d`
- Gałąź review: `review-integration`
- Run: `20260803-193729-n2hub-316-contentplan-import-tws`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `src/supabase/migrations.test.ts`
- `handoffs/scheduler-reviews/20260803-193729-n2hub-316-contentplan-import-tws.md`
- `scripts/contentplan-seed-tws-mapper.d.mts`
- `scripts/contentplan-seed-tws-mapper.mjs`
- `scripts/contentplan-seed-tws.mjs`
- `src/contentplan/twsSeedImport.test.ts`
- `supabase/migrations/20260803170000_contentplan_seed_tws.sql`
