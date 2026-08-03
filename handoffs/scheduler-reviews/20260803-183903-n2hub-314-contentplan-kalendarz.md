# Raport workflow: 20260803-183903-n2hub-314-contentplan-kalendarz

## Wykonane

Faza R4 modułu Content Plan: widok kalendarza miesięcznego. Analiza wstępna potwierdziła, że zadanie było wciąż otwarte (po 313 strona `/content-plan` była 79-liniowym szkieletem z pustym stanem, zero klas `cp-` w CSS), a wymagane fundamenty z 312/313 istnieją (domena `src/contentplan/domain.ts`, slice'y `contentPlan*` w AppStore, selektory `contentPlanPostsForMonth`/`contentPlanMonthStats`, trasa i bramka dostępu).

Przeportowano CalendarGrid, PostCard i MonthStats z aplikacji źródłowej na prymitywy N2Hub (tryb tier: developer, potem osobny read-only reviewer):

- `src/pages/contentPlanCalendar.ts` (nowy) — czysta logika widoku: opcje i rozwiązywanie wybranej marki (kolacja polska, fallback na pierwszą), rozkład publikacji na dni miesiąca, liczniki MonthStats (w tym rozkład kanałów), model karty (platformy bez duplikatów, pierwszy niepusty opis, tagi, placeholder mediów), `contentPlanEmptyDraft` i `contentPlanPasteDraft` (port `pastePost`; kopia zawsze startuje jako szkic ze świeżymi id kanałów, generator id wstrzykiwany).
- `src/pages/ContentPlanPage.tsx` — pusty stan zastąpiony pełnym widokiem: wybór marki jako natywny `<select>` w prymitywie `Field`, przegląd miesiąca (liczniki + rozkład kanałów), siatka dni z kartami postów (status, pigułki platform, tytuł, placeholder miniatury), dodawanie pustego posta w dniu (`makeEmptyPost` przez istniejącą akcję `SAVE_CP_POST` z `postId: null`), kopiuj/wklej posta (schowek jako stan strony), usuwanie przez `useConfirm()` (`DELETE_CP_POST`), animacje wejścia przez `m.*` z `useReducedMotion`. Nagłówek, pager miesięcy, stan `?m=` w URL i redirect bramki dostępu bez zmian.
- `src/styles.css` — blok klas `cp-*` na tokenach `--n2-*`, obie animacje przez mnożnik `var(--n2-motion)`, breakpoint 760 px.
- `src/components/icons.ts` — dopisane `Copy`, `ClipboardPaste`, `Eye`, `EyeOff`, `FileImage` (lucide wyłącznie przez barrel).
- `src/utils/colors.ts` — `TintVarName` rozszerzone o `--cp-platform` (kolor platformy jedną zmienną, wzorzec jak `--status`/`--person`).
- `openwiki/n2hub/ui-navigation-and-onboarding.md` — zaktualizowany akapit `/content-plan` (opis szkieletu był po tej fazie nieaktualny); `frontend-performance-and-primitives.md` bez zmian.

Zero Mantine i zero nowych bibliotek (`package.json` nietknięty). Rejestracja encji modułu w GlobalSearch świadomie ODROCZONA: `searchAll` jest czystym selektorem bez wejścia roli, więc dopisanie treści widocznych tylko dla administratorów wystawiłoby je każdej roli albo wymusiłoby przebudowę modelu wyszukiwarki; paleta ma już nawigacyjną szybką akcję za `canContentPlan`. Inspektor/edytor posta, Google Drive, sync i tryb „emerytura"/clientOnly poza zakresem zgodnie z promptem.

## Zmiany

- Nowe: `src/pages/contentPlanCalendar.ts`, `src/pages/contentPlanCalendar.test.ts`
- Zmienione: `src/pages/ContentPlanPage.tsx`, `src/styles.css`, `src/components/icons.ts`, `src/utils/colors.ts`, `openwiki/n2hub/ui-navigation-and-onboarding.md`, `handoffs/RUN-STATE.md`

## Weryfikacja

- `npm test`: 114 plików / 2516 testów, w pełni zielony (w tym 22 nowe testy `contentPlanCalendar.test.ts`: kolacja polska marek, publikacja spoza siatki, kanał osierocony, świeże id z wstrzykniętego generatora, kopia jako szkic, marka bez platform; kontrakt arkusza `stylesheetContract.test.ts` przechodzi z nowym CSS).
- `npm run build` (`tsc --noEmit && vite build`): zielony, chunk `ContentPlanPage` 11,55 kB.
- Review (osobny read-only reviewer): **APPROVED**, zero blokerów; zakres diffu zgodny z raportem (AppStore nietknięty, więc inwariant 6 strukturalnie nienaruszony), payloady akcji zgodne z kontraktami reduktora, brak em/en-dash w stringach widocznych dla użytkownika, odroczenie GlobalSearch uznane za zasadne, wiki: `wiki updated` (akapit zweryfikowany z kodem).
- Gate (`npm test && npm run build`): oczekuje na scheduler

## Ryzyka / rzeczy do sprawdzenia

- Dane: `seed.ts` nie zawiera marek, a UI tworzenia marki wchodzi dopiero w R5 — do tego czasu strona pokazuje pusty stan „Brak marek w module."; wizualna weryfikacja kalendarza z realnymi danymi będzie możliwa po R5/R6.
- Świadome odstępstwo od źródła: zamiast poziomego przewijacza 31 kolumn (każda z własnym scrollerem) jest responsywna siatka zawijana `repeat(auto-fill, minmax(230px, 1fr))` — zgodnie z zasadą jednego właściciela przewijania z `frontend-performance-and-primitives.md`. Odnotowane w wiki.
- Dodanie slotu nie zaznacza nowej karty (reduktor nadaje id wewnątrz stanu i nie zwraca go wywołującemu); w źródle po dodaniu otwierał się inspektor, który wchodzi w R5.
- Drobiazgi od reviewera (minor/nit, do rozważenia w R5): przycisk „Wklej kopię" renderuje się we wszystkich dniach przy pełnym schowku (szum wizualny, zachowanie zgodne ze źródłem); `aria-pressed` na „Kopiuj" bez zdejmowania stanu ponownym kliknięciem; `selectedPostId` nieczyszczone przy zmianie miesiąca (nieszkodliwe).
- Podglądu w przeglądarce nie uruchamiano (Playwright niezainstalowany w środowisku — ten sam blocker co w runie n2hub-310).

## Podpis schedulera

- Run: `20260803-183903-n2hub-314-contentplan-kalendarz`
- Prompt: `314-contentplan-kalendarz.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `c3770096c57fe22bba156a3b89ec278f525f47c5`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `c3770096c57fe22bba156a3b89ec278f525f47c5`
- Gałąź review: `review-integration`
- Run: `20260803-183903-n2hub-314-contentplan-kalendarz`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `openwiki/n2hub/ui-navigation-and-onboarding.md`
- `src/components/icons.ts`
- `src/pages/ContentPlanPage.tsx`
- `src/styles.css`
- `src/utils/colors.ts`
- `handoffs/scheduler-reviews/20260803-183903-n2hub-314-contentplan-kalendarz.md`
- `src/pages/contentPlanCalendar.test.ts`
- `src/pages/contentPlanCalendar.ts`
