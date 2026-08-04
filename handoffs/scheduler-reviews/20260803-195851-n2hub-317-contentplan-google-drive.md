# Raport workflow: 20260803-195851-n2hub-317-contentplan-google-drive

## Wykonane

Content Plan R7: integracja Google Drive (media). Analiza wstepna potwierdzila,
ze zadanie bylo nadal aktualne (brak `src/contentplan/google.ts` i zmiennych
`VITE_GOOGLE_*`), a zaleznosci gotowe: edytor posta z promptu 315 oraz tabela
`contentplan.drive_folders` z migracji promptu 311. Routing tier:
`developer -> reviewer`.

1. **`src/contentplan/google.ts`** - port `planner/src/lib/google.js` do TS bez
   zmian architektury: GIS token flow (`initTokenClient`, scope `drive.file`),
   cache tokenu w pamieci z marginesem 60 s (fabryka z wstrzykiwanym zegarem,
   dodatkowo dedup rownoleglych zadan tokenu), leniwe ladowanie skryptow
   gsi/api.js z dedupem po `data-src`, `pickFromDrive` (multi-select mediow),
   `pickFolderFromDrive` (folder marki), oba z `setOrigin(window.location.origin)`,
   `shareFilePublic` (POST drive/v3 permissions anyone/reader, best-effort),
   helpery `driveThumbUrl`/`driveViewUrl`/`drivePreviewUrl`. Walidacja miekka:
   import modulu bez env nie rzuca, `googleDriveDisabledReason()` daje polski
   powod dla DisabledHint.
2. **`.env.example`** - dopisane `VITE_GOOGLE_CLIENT_ID` i `VITE_GOOGLE_API_KEY`
   z komentarzem (modul dziala bez nich, wylaczony jest tylko picker).
3. **`src/contentplan/driveFolders.ts`** - pamiec folderow
   `brandId:YYYY-MM -> folderId`: adapter `getSupabaseClient().schema('contentplan')`
   na tabeli `drive_folders` (bez drugiego `createClient`; klient glowny zostaje
   przypiety do n2click), fallback localStorage (`n2click.contentplan.driveFolders`)
   w trybie lokalnym, zapis lokalny zawsze, chmura best-effort, degradacja
   missing-table (PGRST205/42P01/schema cache) calkowicie cicha.
4. **Wpiecie w edytor posta** - nowa sekcja "Media z Dysku Google" w
   `ContentPlanPostModal.tsx` (jeden wiersz na kanal): wybor/podmiana/usuniecie
   pliku, przycisk "Wskaz folder marki", miniatura przez `driveThumbUrl`,
   auto-`shareFilePublic` dla podpietego pliku, DisabledHint przy braku
   konfiguracji. Czysta funkcja `setChannelMedia` w `contentPlanPostEditor.ts`
   (no-op zachowuje referencje draftu) + pozycja "media" w etykiecie historii.
   Multi-select: podpinany jest pierwszy plik, przy >1 polska podpowiedz.
   Zadnych zmian w reducerze - inwariant 6 nienaruszony.
5. Drobne: ikona `FolderOpen` w `icons.ts`, style `.cp-media-*` w `styles.css`.

Ladowanie gsi/api.js jest leniwe i ograniczone do strony modulu: `google.ts`
importowany wylacznie z lazy chunku `/content-plan` (potwierdzone grepem w
`dist/assets` - `gsi/client` tylko w `ContentPlanPage-*.js`).

## Zmiany

- Nowe: `src/contentplan/google.ts`, `src/contentplan/google.test.ts`,
  `src/contentplan/driveFolders.ts`, `src/contentplan/driveFolders.test.ts`.
- Zmienione: `src/components/contentPlanPostEditor.ts`,
  `src/components/ContentPlanPostModal.tsx`,
  `src/components/contentPlanPostEditor.test.ts`, `src/components/icons.ts`,
  `src/styles.css`, `.env.example`,
  `openwiki/n2hub/ui-navigation-and-onboarding.md`, `handoffs/RUN-STATE.md`.

## Weryfikacja

- `npx vitest run src/contentplan src/components/contentPlanPostEditor.test.ts` -
  170 testow, zielone.
- `npm test` - 119 plikow / 2634 testy, zielone (bazowo 117/2591; +43 testy,
  zero regresji). Nowe testy node: cache tokenu (granica expiry-60s, refresh,
  dedup), budowa URL miniatur, mapowanie wyboru pickera (w tym cancel -> null),
  konfiguracja/powod disabled, adapter folderow (tryb lokalny, degradacja
  PGRST205, ksztalt zapytan). Picker i DOM mockowane, zero realnych requestow.
- `npm run build` - zielony (tsc --noEmit + vite build). `npm run check:openwiki` - OK.
- Review (reviewer, read-only): **approve**, bez blockerow; zweryfikowana
  wiernosc portu wzgledem zrodla, brak drugiego createClient, brak em/en-dash
  w nowych stringach UI, czystosc wzorca draftu i sensownosc testow.
- Wiki: **wiki updated** - `openwiki/n2hub/ui-navigation-and-onboarding.md`
  dokumentuje sekcje mediow i miekka konfiguracje `VITE_GOOGLE_*` (media w
  edytorze nie sa juz "tylko do odczytu"). `cloud-database.md` bez zmian
  (adapter jest modulowo-lokalny).
- Gate (`npm test && npm run build`): oczekuje na scheduler

## Ryzyka / rzeczy do sprawdzenia

- **uuid vs slug:** `drive_folders.brand_id` jest `uuid`, a lokalne id marek to
  slugi. W trybie chmurowym zapis/odczyt pamieci folderow konczy sie bledem
  22P02 i cicho degraduje do localStorage; realna pamiec chmurowa ruszy po
  mapowaniu id w R8 (sync). Pamiec folderow to wygoda, nie dane krytyczne -
  ryzyko ujawnione i zaakceptowane przez review.
- Sam Picker i token flow nie maja testu end-to-end (zewnetrzne API) - wymagaja
  recznego sprawdzenia w przegladarce po skonfigurowaniu env.
- Miniatura z `drive.google.com/thumbnail` moze nie wyswietlic sie osobom bez
  dostepu do pliku, jesli best-effort `shareFilePublic` sie nie powiedzie.
- Karta publikacji w kalendarzu nie pokazuje jeszcze miniatury Drive (poza
  zakresem R7).

**Reczny krok operatora w Google Cloud** (projekt "My First Project", konto
kacper.cichy@n2media.agency):

1. OAuth client **"N2 Content Planner Web"**: dodac originy N2Hub (produkcyjny
   oraz lokalny `http://localhost:5173`) do Authorized JavaScript origins.
2. Klucz API z restrykcja **Google Picker API**: dodac te same adresy jako
   dozwolone HTTP referrery.

Bez tego Picker zwroci blad origin mimo poprawnych zmiennych w `.env.local`.

## Podpis schedulera

- Run: `20260803-195851-n2hub-317-contentplan-google-drive`
- Prompt: `317-contentplan-google-drive.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `ab7eefdfd8cabfca9eb7d2fc61a1f22ed02f3da3`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `ab7eefdfd8cabfca9eb7d2fc61a1f22ed02f3da3`
- Gałąź review: `review-integration`
- Run: `20260803-195851-n2hub-317-contentplan-google-drive`

### Pliki zgłoszone do review

- `.env.example`
- `handoffs/RUN-STATE.md`
- `openwiki/n2hub/ui-navigation-and-onboarding.md`
- `src/components/ContentPlanPostModal.tsx`
- `src/components/contentPlanPostEditor.test.ts`
- `src/components/contentPlanPostEditor.ts`
- `src/components/icons.ts`
- `src/styles.css`
- `handoffs/scheduler-reviews/20260803-195851-n2hub-317-contentplan-google-drive.md`
- `src/contentplan/driveFolders.test.ts`
- `src/contentplan/driveFolders.ts`
- `src/contentplan/google.test.ts`
- `src/contentplan/google.ts`
