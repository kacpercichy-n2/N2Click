# Handoff: Zbuduj edytor publikacji i zarządzanie markami modułu Content Plan (R5)

- Package ID: PKG-20260803-contentplan-editor-brands
- Status: ready
- Tier: developer
- Depends on: R2 (domena/store, done), R4 (kalendarz, done)
- Risk: medium
- Codex review: required — zmiana cross-module (dirtyRegistry + strona + 2 nowe modale)

## Goal

Dwa modale na istniejącej powłoce `useModalShell`, wpięte w `ContentPlanPage`:
(1) edytor publikacji otwierany klikiem w kartę kalendarza, (2) edytor marki ze
słownikami i guardem integralności referencyjnej. Zero nowych akcji reduktora —
wszystkie istnieją z R2.

## Wiki context

- `openwiki/n2hub/ui-navigation-and-onboarding.md` (sekcja `/content-plan`, powłoka modali, kontrakt pola, useConfirm)
- `openwiki/n2hub/frontend-performance-and-primitives.md` (shared modal contract: jeden scroller `.task-modal-body`, scrim, transform/opacity)

## Expected touchpoints

- `src/pages/ContentPlanPage.tsx` — otwieranie modali z parametrów URL, klik karty otwiera edytor
- `new: src/components/ContentPlanPostModal.tsx` — modal edytora publikacji (+ wątkowane komentarze, historia, akcept)
- `new: src/components/contentPlanPostEditor.ts` + `new: src/components/contentPlanPostEditor.test.ts` — CZYSTA logika draftu edytora (node)
- `new: src/components/ContentPlanBrandModal.tsx` — modal marki + słowników
- `new: src/components/contentPlanBrandEditor.ts` + `new: src/components/contentPlanBrandEditor.test.ts` — CZYSTA logika słowników i guardu (node)
- `src/utils/dirtyRegistry.ts` + `src/utils/dirtyRegistry.test.ts` — dwa nowe scope'y strażnika nawigacji
- `src/components/icons.ts` — brakujące ikony przez barrel (np. `MessageSquare`, `History`, `Settings2`, `Pencil`)
- `src/styles.css` — wyłącznie NOWE klasy z prefiksem `cp-` (współdzielone `.task-modal-*`, `.field`, `.btn`, `.empty-state` reużywamy bez zmian); `stylesheetContract.test.ts` musi przejść
- Tylko odczyt (nie modyfikować): `src/contentplan/domain.ts`, `src/store/AppStore.tsx`, `src/store/selectors.ts`, `src/pages/contentPlanCalendar.ts`

Źródło portu (WYŁĄCZNIE referencja, ścieżka ze spacją, niczego tam nie zapisywać):
`"/Users/kacpercichyn2/Documents/AI/N2Media/Content plan/src/main.tsx"` — PostInspector 1654–2127, ThreadedComments/CommentThread 2128–2357, AdminView 1122–1265; testy `".../Content plan/tests/components/app.test.tsx"`.

## Invariants

- Inwariant 6 repo: reduktora NIE zmieniamy; niepoprawny draft => ta sama referencja stanu. UI ma lustrzaną bramkę (wzorzec `isValidEventDraft` w EventModal): przed dispatchem `SAVE_CP_POST` woła `normalizeContentPlanPostDraft(draft, brands)`; `null` => polski błąd inline, modal NIE zamyka się, dirty NIE jest czyszczone (nieudany zapis nigdy nie wygląda jak sukces).
- Reducerowe bramki są prawem UI: `ADD_CP_COMMENT` i `REVIEW_CP_POST` działają TYLKO na `visibility === 'published'` — sekcje komentarzy/akceptu na szkicu pokazują hint zamiast formularza, nigdy martwy przycisk dispatchujący no-op.
- Media: wyłącznie odczyt `{source:'gdrive', fileId, ...}` (placeholder miniatury jak na karcie R4, `mediaAspectRatio`/`mediaRatioLabel` z domeny). Żadnego inputu pliku, base64, Pickera (R7).
- Jeden scroller `.task-modal-body`, focus trap i powrót fokusa z `useModalShell`, `closeOnBackdrop: false` (modale z formularzem), animacja karty tylko transform/opacity.
- Wszystkie stringi po polsku; zakaz em-dash/en-dash w treści UI. Usuwanie wyłącznie przez `useConfirm()` (nigdy `window.confirm`).
- Zero nowych bibliotek (również testowych), zero Mantine. Ikony tylko przez barrel `icons.ts`.
- Sortowanie nazw wyłącznie przez `src/utils/collation.ts`; logika dat wyłącznie z `utils/dates.ts` / `contentplan/domain.ts`.

## Rozstrzygnięte decyzje (wiążące)

D1 — **Akcje reduktora: żadnych nowych.** Istnieją i wystarczają: `SAVE_CP_BRAND` (brandId `null` = utworzenie), `DELETE_CP_BRAND` (kaskada na publikacje), `SAVE_CP_POST` (postId `null` = utworzenie; opcjonalny `historyLabel`), `DELETE_CP_POST`, `REVIEW_CP_POST` (tylko published, autor niepusty), `ADD_CP_COMMENT` (tylko published, parentId musi wskazywać komentarz tej publikacji). `PUBLISH_CP_MONTH` NIE dostaje UI w tej fazie (świadomie odroczone; przycisk miesiąca wejdzie z portalem/R9).

D2 — **Montaż modali: WEWNĄTRZ `ContentPlanPage`, nie na poziomie App.** Świadoma różnica wobec EventModal/TicketModal: moduł jest bramkowany rolą i jednostronicowy, więc montaż w stronie reużywa samo-guard strony i nie dokłada czwartego globalnego mountu. Sterowanie parametrami URL bieżącej strony: `?publikacja=<postId>` (edytor posta), `?marka=new|<brandId>` (edytor marki), oba w `AnimatePresence`, zamknięcie usuwa tylko własny parametr (pager `?m=` zostaje nietknięty). Nieznane id => karta „Nie znaleziono publikacji/marki” (wzorzec EventModal notFound).

D3 — **Klik w kartę otwiera edytor.** Przycisk `.cp-card-title` przestaje przełączać zaznaczenie i ustawia `?publikacja=<id>` (stan `selectedPostId` i `data-selected` z R4 usuwamy — zaznaczenie było tymczasowym zamiennikiem edytora). Dodanie pustego slotu (`+` w dniu) zostaje jak w R4 (dispatch bez otwierania edytora — reduktor nadaje id, strona go nie zna; użytkownik wchodzi klikiem w świeżą kartę).

D4 — **Model edycji posta: DRAFT + jawny zapis** (nie blur-commit ze źródła). Editor seeduje lokalny stan z posta (`buildPostDraft(post)` w czystym module), każda zmiana woła `markDirty`, „Zapisz zmiany” wysyła JEDEN `SAVE_CP_POST` z `historyLabel` z czystej funkcji `saveHistoryLabel(before, draft)` (polska etykieta wymieniająca zmienione obszary, np. „Zmieniono: tytuł, opis (Instagram), widoczność”; brak zmian => etykieta domyślna reduktora). Dirty-guard dokładnie jak EventModal: `setNavGuard`/`clearNavGuard` + `bypassNavGuardOnce` przy celowym zamknięciu + `useConfirm` „Masz niezapisane zmiany.” (bez `requireAck`).

D5 — **Sekcje edytora** (kolejność, wszystkie w `.task-modal-body`):
1. Meta: `Field` + kontrakt pola — data (`type="date"`), tytuł roboczy, temat (select ze słownika marki), typ/format (select), status (select z `CONTENT_PLAN_STATUSES`), widoczność (select: „Szkic (roboczy)” / „Udostępniona klientowi”).
2. Platformy: pigułki toggle kanałów (port `togglePlatform`): ostatniego kanału nie da się wyłączyć (disabled); nowy kanał dziedziczy opis grupy głównej, wchodzi do grupy main.
3. Opisy per grupa (`getDescriptionGroups`): grupa główna + dedykowane; „Wydziel opis” (wybór platformy z `splitOptions`, świeży `descriptionGroupId`, przejęcie tagów: `overrideTags: true`, tags = dotychczasowe efektywne), „Scal” (powrót do main, opis głównej, `overrideTags: false`, tags ''); tagi z dziedziczeniem `groupTags` — edycja tagów grupy main zapisuje `baseTags` i czyści nadpisania kanałów tej grupy; wiersz mediów per kanał: nazwa platformy, `fileId` albo „Nie dodano pliku”, badge proporcji (`mediaRatioLabel`), miniatura-placeholder.
4. Walidacja publikacji: przy zapisie z `visibility: 'published'` najpierw `validatePostForPublication(draft)`; issue'y mapują się na pola: `title` => błąd przy polu tytułu, `channels` => błąd przy sekcji platform, `copy` => błąd przy pierwszym pustym opisie; plus JEDNO liczone podsumowanie `role="alert"` (`saveErrorSummary`, wzorzec fieldContract) i fokus na pierwsze złe pole (`focusFieldById`).
5. Akcept klienta (tylko `post.visibility === 'published'` wg STANU STORE): przyciski „Akceptuję” / „Zgłoś uwagi” => `REVIEW_CP_POST` z `author` = nazwa zalogowanej osoby (`state.people` po `state.currentUserId`; pusta => fallback `'Zespół N2'`). Po dispatchu ustaw lokalnie `draft.status` na decyzję BEZ markDirty (draft nie może pokazywać przeterminowanego statusu).
6. Komentarze wątkowane (tylko published, inaczej hint „Komentarze będą dostępne po udostępnieniu publikacji klientowi.”): działają na ŻYWYM poście ze store (nie na drafcie) przez `ADD_CP_COMMENT`; wątki z czystego helpera `threadedComments(comments)` na `commentRepliesByParent`/`flattenCommentReplies` z domeny (korzenie od najnowszych, odpowiedzi chronologicznie rosnąco, sierota bez rodzica renderuje się jako korzeń); odpowiedź jednym aktywnym polem (`replyTargetId`), etykiety czasu przez `formatCommentDate`.
7. Historia zmian: lista `post.history` (już posortowana od najnowszej przez reduktor), etykieta + `formatCommentDate(at)`.
8. Usuń publikację: `useConfirm` z konsekwencjami jak w R4 (treści kanałów, komentarze, historia), po potwierdzeniu `DELETE_CP_POST` + celowe zamknięcie.

D6 — **Marki: OSOBNY MODAL, nie sekcja strony.** Uzasadnienie: strona zostaje kalendarzem (jedyny właściciel przewijania), CRUD marki jest rzadki, modal reużywa dirty-guard/Field/useModalShell 1:1, a wejście musi działać także przy ZERO marek. Wejścia: toolbar strony dostaje „Edytuj markę” (`?marka=<aktywna>`) i „Dodaj markę” (`?marka=new`); pusty stan (brak marek) dostaje przycisk „Dodaj markę” i zaktualizowaną treść (koniec z „pojawi się w kolejnym kroku”). Lista marek NIE powstaje — selektem marki z R4 już jest.

D7 — **Formularz marki** (port AdminView na Field/draft): nazwa (wymagana), branża, kontakt, akcent (`<input type="color">`), słowniki jako trzy textarea rozdzielane przecinkami (Platformy / Tematy / Typy publikacji). Czysty moduł `contentPlanBrandEditor.ts`:
- `parseDictionary(text)` — trim, dedup, odrzucenie pustych;
- `resolvePlatforms(existing, names)` — dopasowanie po nazwie case-insensitive `pl-PL` ZACHOWUJE id i kolor istniejącej platformy (kanały postów wskazują platformy po id!); nowe dostają id `brandSlug(name)` z sufiksem antykolizyjnym i kolor z cyklu `['#1f6fe5','#7b4cc2','#0a66c2','#111827']`;
- `dictionaryIntegrityIssue(brand, posts, next)` — GUARD referencyjny (port `saveDictionaries`): każdy słownik >= 1 pozycja; nie wolno usunąć platformy/tematu/formatu użytego w publikacjach tej marki => polski komunikat wskazujący rodzaj („Nie można usunąć używanej pozycji (platforma). Najpierw zmień przypisane publikacje.”). Guard jest LUSTREM w UI (blokuje zapis + `role="alert"`); reduktor celowo pozostaje liberalny (kanał osierocony ma zachowanie awaryjne `platformFor` — nie zmieniać).
Zapis => `SAVE_CP_BRAND`; usunięcie marki w modalu => `useConfirm` z `tone:'danger'`, `requireAck` (kasuje realne dane) i konsekwencją „To usunie N publikacji tej marki.” (odmiana przez `polishCount`), potem `DELETE_CP_BRAND`.

D8 — **Strażnik nawigacji:** `NavGuardScope` dostaje `'contentplan-post-modal'` i `'contentplan-brand-modal'`; `navGuardBlocks` blokuje, gdy scope dirty i zmienia się odpowiednio param `publikacja` / `marka` ALBO pathname; zmiana samego `?m=` (pager) NIE blokuje. Rozszerzyć `dirtyRegistry.test.ts` o oba scope'y i przypadek pagera.

D9 — **Uprawnienia:** moduł widzą tylko administratorzy (gate R3), więc wewnątrz `canManage = true` dla każdego, kto widzi stronę — tryb read-only klienta ze źródła NIE wchodzi (portal klienta = późniejsza faza). Przyciski akceptu służą adminowi do REJESTROWANIA decyzji klienta.

D10 — **Testy: port PRZEPŁYWÓW z RTL-testów źródła jako testy node na czystych modułach** (świadome odstępstwo od litery promptu, do werdyktu recenzenta): repo nie ma RTL/jsdom (`vitest.config.ts`: `environment: 'node'`, include `src/**/*.test.ts`), a dokładanie `@testing-library/react` + jsdom to zmiana infrastruktury testowej należąca do R9, nie do tego pakietu. Logika przepływów jest w całości w czystych modułach + reduktorze (już pokrytym `contentPlanActions.test.ts`), więc pokrycie jest równoważne. Mapa portu:
- „nie pozwala rozłączyć słowników z używanymi publikacjami” => `contentPlanBrandEditor.test.ts` (guard: usunięcie używanej platformy/tematu/formatu, puste słowniki, zachowanie id/koloru po nazwie, sufiksy id);
- „dodaje markę i przełącza planner na nową markę” => tamże (parseDictionary/resolvePlatforms dla świeżej marki; przełączenie selektu pokrywa istniejący `resolveContentPlanBrandId`);
- „obsługuje wariant opisu, tagi i komentarz z odpowiedzią” => `contentPlanPostEditor.test.ts` (split/merge/toggle/tagi jak w D5.3 + `threadedComments` + `saveHistoryLabel` + mapowanie issue->pole);
- „edytuje szybkie metadane i otwiera pełny inspector karty” / „usuwa publikację po wyraźnym potwierdzeniu” => `buildPostDraft` + lustro `normalizeContentPlanPostDraft` w testach draftu; ścieżki confirm/dispatch pokrywa istniejący wzorzec (reducer testowany w R2);
- dirty-guard => rozszerzony `dirtyRegistry.test.ts`.

## Scope

1. Czyste moduły `contentPlanPostEditor.ts` i `contentPlanBrandEditor.ts` + ich testy node (najpierw — reszta na nich stoi).
2. `ContentPlanPostModal.tsx` wg D2–D5 (powłoka: wzorzec EventModal — scrim, viewport, karta `task-modal-card` + własna klasa `cp-post-modal-card`, head/body, `useId` na tytule).
3. `ContentPlanBrandModal.tsx` wg D6–D7.
4. Wpięcie w `ContentPlanPage.tsx` (parametry, przyciski toolbaru, pusty stan, klik karty) wg D2–D3.
5. Scope'y w `dirtyRegistry.ts` + test wg D8.
6. CSS `cp-` w `styles.css`; ikony przez barrel.
7. Po zielonym runie: aktualizacja akapitu `/content-plan` w `ui-navigation-and-onboarding.md` (karta OTWIERA edytor `?publikacja=`, marki w modalu `?marka=`, nowe scope'y strażnika) — akapit z R4 stanie się nieaktualny.

## Out of scope

- Google Drive / Picker / upload (R7), sync chmurowy (R8), portal klienta, tryb retirement.
- UI dla `PUBLISH_CP_MONTH` (D1), rejestracja encji w GlobalSearch (deferral z R4 stoi).
- Jakiekolwiek zmiany w `domain.ts`, reduktorze, selektorach, sanitizerach, `contentPlanCalendar.ts`.
- Nowe biblioteki (także testowe), zmiany `vitest.config.ts`.
- Commit / zmiana gałęzi (scheduler)./ Aplikowanie czegokolwiek do bazy.

## Acceptance

- [ ] Klik w tytuł karty kalendarza otwiera modal edytora (`?publikacja=<id>`); Escape/Anuluj przy dirty pyta o porzucenie; zamknięcie wraca fokusem na kartę.
- [ ] Zapis edytora wysyła JEDEN `SAVE_CP_POST` z etykietą historii; odrzucony draft (lustro normalizacji) pokazuje polski błąd i NIE zamyka modala.
- [ ] Próba zapisu `published` bez tytułu/kanału/opisu blokuje z komunikatami przy polach + jedno `role="alert"` podsumowanie + fokus na pierwszym złym polu.
- [ ] Wydziel/scal opis i tagi z dziedziczeniem działają zgodnie z domeną (`getDescriptionGroups`/`groupTags`); ostatniego kanału nie da się usunąć togglem.
- [ ] Na publikacji udostępnionej działają komentarz, odpowiedź w wątku i „Akceptuję”/„Zgłoś uwagi” (status + wpis historii); na szkicu sekcje pokazują hint.
- [ ] Historia zmian renderuje się od najnowszej z `formatCommentDate`; media tylko do odczytu (fileId + proporcja + placeholder).
- [ ] „Dodaj markę”/„Edytuj markę” działają z toolbaru i z pustego stanu; guard słowników blokuje usunięcie używanej pozycji z polskim komunikatem; usunięcie marki wymaga confirm z `requireAck` i liczbą publikacji.
- [ ] Zmiana `?m=` przy dirty edytorze NIE pyta o porzucenie; zmiana `publikacja`/`marka`/ścieżki pyta.
- [ ] Nowe klasy CSS wyłącznie `cp-`; `stylesheetContract.test.ts` zielony; zero em/en-dash w stringach UI.

## Verification

- Worker: `npx vitest run src/components/contentPlanPostEditor.test.ts src/components/contentPlanBrandEditor.test.ts src/utils/dirtyRegistry.test.ts src/store/contentPlanActions.test.ts src/pages/contentPlanCalendar.test.ts`
- Browser: none — Playwright niezainstalowany w środowisku (precedens R4); interakcje modala pokrywa wspólna, już zweryfikowana powłoka `useModalShell`.
- Scheduler owns final `npm test && npm run build`.

## Prior decisions

- Gating: moduł wyłącznie dla administratorów (operator, 2026-08-03); bramka UX, nie granica bezpieczeństwa.
- Model draft/publikacja, media bez base64, walidacja publikacji w reduktorze — R2 (nie ruszać).
- Pager w URL, marka jako stan sesji widoku, `useConfirm` dla usuwania — R4.
- GlobalSearch dla encji modułu — świadomie odroczone (RUN-STATE R4).

## External reference patterns

- WAI-ARIA APG Dialog (Modal) pattern + Radix UI Dialog: pułapka fokusa, powrót fokusa, Escape, aria-labelledby — przyjęte PRZEZ ISTNIEJĄCĄ powłokę `useModalShell`/`modalShell.ts`; różnica strukturalna N2Hub: jeden scroller `.task-modal-body`, scrim `pointer-events:none` nad żywą aplikacją (decyzja właściciela 2026-07-28), zamknięcie tłem wyłączone dla formularzy. Nowych prymitywów NIE budujemy — oba modale to konsumenci powłoki.
