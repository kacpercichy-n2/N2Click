# Raport workflow: 20260803-213841-n2hub-323-klienci-karta-i-scroll-fade

## Wykonane

Workflow tier: `developer -> reviewer` (jeden pakiet implementacyjny, zmiany czysto prezentacyjne). Reviewer po pierwszej rundzie zwrócił jeden blocker; developer naprawił, reviewer zatwierdził (`approve`).

**1. Przebudowa nagłówka karty klienta (`/clients`, `div.client-card`)** — `src/pages/ClientsPage.tsx`, `src/styles.css`, `src/components/icons.ts`:

- Usunięty chevron i rozwijanie kliknięciem w tło karty; karta zaczyna się od nazwy firmy.
- Licznik projektów przeniesiony do chipa z kolorem przy nazwie (`.client-project-chip`); nadal jest linkiem do `/projects?client=<id>` z polską odmianą (`polishCount`).
- Po prawej stronie nagłówka zestaw akcji: „Zobacz szczegóły" jako tekstowy CTA przejmujący funkcję chevrona (przeniesione `aria-expanded` i `aria-controls`), „Edytuj" jako ikona (Pencil), archiwizacja jako ikona (Archive / ArchiveRestore z barrela; `ArchiveRestore` dodany do `src/components/icons.ts`), „Usuń" zachowane jako ikona danger z dotychczasowym potwierdzeniem kaskady (`requireAck`). Gating `canManage` bez zmian.
- Archiwizacja otwiera potwierdzenie przez `useConfirm()` PRZED dispatchem `SET_CLIENT_ARCHIVED`. Treść opisuje zweryfikowane w kodzie skutki systemowe:
  - Tytuł: `Zarchiwizować klienta „<nazwa>"?`
  - Opis: `Klient zniknie z listy Klienci (pokażesz go przełącznikiem „Pokaż zarchiwizowanych") i nie da się go wybrać przy zakładaniu nowego projektu.`
  - Konsekwencje: `Projekty, zadania i zaplanowane godziny zostają bez zmian. Archiwizację cofniesz w każdej chwili przyciskiem „Przywróć klienta".`
  - Przyciski: `Anuluj` / `Archiwizuj klienta`. Przywracanie bez potwierdzenia.
  - Podstawa (zweryfikowana przez developera i niezależnie przez reviewera): reducer `SET_CLIENT_ARCHIVED` (`AppStore.tsx:3792`) tylko przełącza flagę (odwracalne, bez kaskady, inwariant 6 nienaruszony — no-op zachowuje referencję stanu); jedyni konsumenci flagi to filtr listy klientów (`ClientsPage.tsx:222`) i lista wyboru klienta przy nowym projekcie (`ProjectsPage.tsx:112`); wyszukiwarka i filtry iterują pełne `state.clients`, więc zarchiwizowani pozostają wyszukiwalni — celowo niedeklarowane w treści potwierdzenia.

**2. Globalne miękkie wygaszanie krawędzi scrolla** — `src/App.tsx`, `src/styles.css`:

- Fakt strukturalny: scrollportem aplikacji jest dokument (`.app-main` nie scrolluje), więc zwykłe `mask-image` na kontenerze nie zadziała. Wybrano wariant bez zmiany właściciela scrolla: dwa paski `position: sticky` (pierwsze i ostatnie dziecko `main.app-main`, `aria-hidden`, `pointer-events: none`), tło `var(--n2-gradient-page)` z `background-attachment: fixed` (identyczne wyrównanie jak tło `body`) plus alfa-rampa `mask-image`. Czysty CSS, zero nasłuchu scrolla; strefa 24px (`--n2-scroll-fade-h`), semantyczny token `--n2-z-scroll-fade: 20`.
- Desktop only (`!mobileNav`) — na mobile pasków nie ma (drawer + sticky `.app-topbar` czynią je tam błędnymi).
- Blocker z review: pasek dolny przykrywał przypięty do dokumentu pasek zapisu `.editor-actions-sticky` (z 5) na `/projects/:id` w trybie edycji. Naprawa: nowy token `--n2-z-sticky-actions: 30` na `.editor-actions-sticky` (fade 20 < sticky-actions 30 < popover 40); odrzucono obniżenie fade do 4, bo schowałoby fade pod bloki kalendarza i przeciągane paski timeline (regresja celu zadania).

**Wiki:** `wiki updated` — `openwiki/n2hub/ui-navigation-and-onboarding.md`, dwie punktowe pozycje w Boundaries: kontrakt fade w shellu (kolejność dzieci `main.app-main`, tokeny, finalny z-order, reguła: nowe przypięte do dokumentu kontrolki biorą `--n2-z-sticky-actions`) oraz kontrakt karty klienta (CTA + potwierdzenie archiwizacji). Pozostałe strony bez zmian.

## Zmiany

- `src/pages/ClientsPage.tsx` — nagłówek karty, chip projektów, akcje, potwierdzenie archiwizacji
- `src/components/icons.ts` — eksport `ArchiveRestore`
- `src/App.tsx` — paski fade jako pierwsze/ostatnie dziecko `main.app-main` (desktop)
- `src/styles.css` — tokeny `--n2-scroll-fade-h`, `--n2-z-scroll-fade`, `--n2-z-sticky-actions`; reguły `.app-scroll-fade*`; przepisany blok `.client-card*` (usunięte martwe `.client-card-toggle/-chevron/-main`); reguła 760px dla wiersza akcji
- `openwiki/n2hub/ui-navigation-and-onboarding.md` — dwa punkty Boundaries
- `handoffs/RUN-STATE.md` — wpis do logu runu

## Weryfikacja

- `npm test`: **119 plików / 2663 testy passed** (po remediacji ponownie zielone). Żaden istniejący test nie asertował usuniętego chevrona ani starego układu akcji — brak zmian w testach.
- `npm run build`: zielony (`tsc --noEmit` bez błędów, Vite `✓ built`).
- `npm run check:openwiki`: `Validated 6 wiki files.`
- Weryfikacja w przeglądarce (Chromium, seed lokalny, 1280x620 i 1440x900): paski fade przypięte do krawędzi viewportu na `/tasks` przy scrollY 0/500/koniec; brak przyciemniania treści w spoczynku; `elementFromPoint` nie trafia w paski (klikalność nienaruszona); po naprawie na `/projects/:id` w edycji pasek zapisu w pełni ostry, realny klik w dolną krawędź „Zapisz teraz" zapisuje projekt; TaskModal (tabela planowania, sticky nagłówek) i pozostałe modale nienaruszone — żyją we własnych scrollportach nad z 1000; mobile 390px renderuje 0 pasków; zero błędów konsoli.
- Reviewer (read-only, druga runda): **approve**; potwierdzone m.in. inwariant 6, prawdziwość treści potwierdzenia względem reducera i call sites, ikony wyłącznie przez barrel, brak em/en-dash w stringach użytkownika, brak osieroconych z-indeksów w paśmie 20-39.
- Gate (`npm test && npm run build`): oczekuje na scheduler

## Ryzyka / rzeczy do sprawdzenia

- `background-attachment: fixed` + `mask-image` na paskach fade zweryfikowane tylko w Chromium; spot-check desktopowego Safari należy do weryfikacji wydaniowej (ryzyko niskie: `body` już używa fixed attachment; stary WebKit pokazałby co najwyżej nieprzezroczysty pasek 24px).
- Paski fade wymuszają przemalowanie dwóch stref 24px na klatkę scrolla; bez trace'u na urządzeniu operatora — jeśli słabszy sprzęt zgłosi jank, to pierwszy kandydat do sprawdzenia.
- Kosmetyka: `.week-block.fused` (z 20, animacja 280ms) remisuje z fade i przez kolejność DOM maluje się nad górnym paskiem w trakcie przejścia; przejściowe, bez działania.
- Poza zakresem, odnotowane: `activeClients` w `src/store/selectors.ts:243` to martwy kod zduplikowany inline w `ProjectsPage.tsx:112`.

## Podpis schedulera

- Run: `20260803-213841-n2hub-323-klienci-karta-i-scroll-fade`
- Prompt: `323-klienci-karta-i-scroll-fade.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `f8de3aa7deca4e438a18da0c8a986fe37b20f2ea`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `f8de3aa7deca4e438a18da0c8a986fe37b20f2ea`
- Gałąź review: `review-integration`
- Run: `20260803-213841-n2hub-323-klienci-karta-i-scroll-fade`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `openwiki/n2hub/ui-navigation-and-onboarding.md`
- `src/App.tsx`
- `src/components/icons.ts`
- `src/pages/ClientsPage.tsx`
- `src/styles.css`
- `handoffs/scheduler-reviews/20260803-213841-n2hub-323-klienci-karta-i-scroll-fade.md`
