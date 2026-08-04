# Raport workflow: 20260803-185957-n2hub-315-contentplan-edytor-i-marki

## Wykonane

Faza R5 modułu Content Plan: edytor publikacji i zarządzanie markami. Workflow
tier: architect -> developer -> reviewer (pakiet:
`handoffs/packages/PKG-20260803-contentplan-editor-brands.md`).

- **Edytor publikacji** (`src/components/ContentPlanPostModal.tsx`): modal na
  `useModalShell` (jeden scroller `.task-modal-body`, focus trap, dirty-guard
  przez `utils/dirtyRegistry`, scope `contentplan-post-modal`). Sekcje: meta
  (data, tytuł, temat, format, status, widoczność szkic/opublikowana), kanały
  per platforma z wariantami copy (`getDescriptionGroups`) i tagami
  z dziedziczeniem (`groupTags`), walidacja publikacji
  (`validatePostForPublication`) z komunikatami przy polach (Field +
  field-error) i kotwicami fokusa, komentarze wątkowane, historia zmian,
  akcept klienta (`REVIEW_CP_POST`: Akceptacja/Uwagi), media wyłącznie jako
  odczyt fileId (placeholder miniatury). Edycja jako lokalny draft z jawnym
  „Zapisz” i etykietą historii; odrzucony zapis nigdy nie zamyka modala.
- **Zarządzanie markami** (`src/components/ContentPlanBrandModal.tsx`): osobny
  modal (strona zostaje kalendarzem): CRUD marek oraz słowniki
  platform/tematów/formatów z guardem integralności referencyjnej - nie można
  usunąć wartości użytej w publikacjach (logika portowana z AdminView);
  usunięcie marki przez `useConfirm()` z `requireAck` i liczbą publikacji.
- Czysta logika w `src/components/contentPlanPostEditor.ts`
  i `contentPlanBrandEditor.ts` (m.in. `resolvePlatforms` zachowuje id i kolor
  platformy po nazwie, `dictionaryIntegrityIssue`, `saveHistoryLabel`).
- Otwieranie z kalendarza: klik w tytuł karty ustawia `?publikacja=<id>`,
  toolbar ma „Edytuj markę”/„Dodaj markę” (`?marka=`); oba modale montowane
  w `ContentPlanPage`. Zero nowych akcji reduktora - komplet z R2 wystarcza,
  UI odwzorowuje bramki domeny (inwariant 6 nietknięty).
- CSS wyłącznie z prefiksem `cp-` w `src/styles.css`; zero nowych bibliotek;
  wszystkie stringi po polsku. Tryb retirement pozostaje wyłączony.
- Wiki: zaktualizowano `openwiki/n2hub/ui-navigation-and-onboarding.md`
  (akapit `/content-plan` + lista scope'ów strażnika nawigacji) - decyzja
  recenzenta: `wiki updated`.

## Zmiany

- Nowe: `src/components/ContentPlanPostModal.tsx`,
  `ContentPlanBrandModal.tsx`, `contentPlanPostEditor.ts(+test)`,
  `contentPlanBrandEditor.ts(+test)`,
  `handoffs/packages/PKG-20260803-contentplan-editor-brands.md`.
- Zmienione: `src/pages/ContentPlanPage.tsx`, `src/utils/dirtyRegistry.ts`
  (+test), `src/components/icons.ts`, `src/styles.css`,
  `openwiki/n2hub/ui-navigation-and-onboarding.md`, `handoffs/RUN-STATE.md`.

## Weryfikacja

- `npm test`: 116 plików / 2567 testów, 0 błędów (uruchomione przez developera
  i niezależnie przez recenzenta). Port kluczowych przepływów RTL ze źródła
  („Content plan”/tests/components/app.test.tsx) jako testy node czystych
  modułów - repo nie ma RTL/jsdom, to konwencja wszystkich testów
  (odstępstwo D10 zadeklarowane w pakiecie i zaakceptowane przez recenzenta).
- `npm run build`: zielony (`built in 2.63s`), chunk `ContentPlanPage`
  39,41 kB / gzip 11,56 kB. `npx tsc --noEmit`: czysto.
- Recenzent (read-only): zero blokerów w kodzie; jedyny bloker proceduralny to
  brak artefaktu Codex, który zgodnie z kontraktem tier generuje scheduler po
  zakończeniu tego procesu (`scripts/codex-review.sh`).
- Gate (`npm test && npm run build`): oczekuje na scheduler.

## Ryzyka / rzeczy do sprawdzenia

- Advisory recenzenta (nieblokujące): (a) duplikaty nazw platform różniące się
  wielkością liter w jednym wpisie słownika łapie dopiero ogólny komunikat
  bramki lustrzanej, nie precyzyjny błąd przy polu; (b) wyczyszczone pole daty
  również kończy się ogólnym komunikatem zamiast błędu przy polu daty;
  (c) ścieżka usunięcia publikacji woła `closePost()` bez
  `bypassNavGuardOnce` - w praktyce nieosiągalne, warte wyrównania przy
  zmianie powierzchni usuwania.
- Modale renderują fixed scrim wewnątrz `<section class="page">`; dziś żaden
  przodek nie tworzy kontekstu stakowania, ale transformowana animacja na
  kontenerze trasy w przyszłości przykleiłaby modale do niego.
- Brak weryfikacji przeglądarkowej układu (precedens R4, Playwright
  niedostępny); interakcje pokrywa zweryfikowana powłoka `useModalShell`.
- `PUBLISH_CP_MONTH` świadomie bez UI (decyzja pakietu D1) - publikacja
  miesiąca odbywa się publikacja po publikacji do czasu późniejszej fazy.
- Kanał osierocony po zmianie słownika renderuje się awaryjnym `platformFor`
  (pierwsza platforma marki) - celowo nietknięte zachowanie domeny z R2.

## Podpis schedulera

- Run: `20260803-185957-n2hub-315-contentplan-edytor-i-marki`
- Prompt: `315-contentplan-edytor-i-marki.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `41de09d474e12de6dfefcf1a629a957ad1d01bf7`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `41de09d474e12de6dfefcf1a629a957ad1d01bf7`
- Gałąź review: `review-integration`
- Run: `20260803-185957-n2hub-315-contentplan-edytor-i-marki`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `openwiki/n2hub/ui-navigation-and-onboarding.md`
- `src/components/icons.ts`
- `src/pages/ContentPlanPage.tsx`
- `src/styles.css`
- `src/utils/dirtyRegistry.test.ts`
- `src/utils/dirtyRegistry.ts`
- `handoffs/packages/PKG-20260803-contentplan-editor-brands.md`
- `handoffs/scheduler-reviews/20260803-185957-n2hub-315-contentplan-edytor-i-marki.md`
- `src/components/ContentPlanBrandModal.tsx`
- `src/components/ContentPlanPostModal.tsx`
- `src/components/contentPlanBrandEditor.test.ts`
- `src/components/contentPlanBrandEditor.ts`
- `src/components/contentPlanPostEditor.test.ts`
- `src/components/contentPlanPostEditor.ts`
