# Raport workflow: 20260728-042633-n2hub-287-mobile-nav-day-view

## Wykonane

Zgodnie z poleceniem najpierw sprawdzono, które z czterech punktów są jeszcze
nieobecne w bieżącym buildzie. Werdykt (z dowodami w kodzie):

| Punkt | Stan przed | Zakres pracy |
| --- | --- | --- |
| 1. Dolny pasek zakładek | **DO ZROBIENIA** — brak identyfikatora `bottom-nav` w `src`; `App.tsx` miał hamburger, kurtynę i lewą szufladę | całość |
| 2. Kalendarz jako widok dnia | **DO ZROBIENIA** — `WeekView` zawsze liczył `weekDays(anchor)`, stała `DAY_COLS = 7`, CSS `repeat(7, …)` | całość |
| 3. Zasobnik jako arkusz | **DO ZROBIENIA** — `.week-bin-pane` to `flex: 0 0 200px`, brak arkusza, uchwytu i peeku | całość |
| 4. Jeden rząd kontrolek | **CZĘŚCIOWO ZROBIONE** — scalenie rzędów na desktopie już istniało (jeden `.cal-toolbar`), przycisk „Filtry” z licznikiem też (`FilterPanel`) | dorobiono wyłącznie formę telefonu: 56 px, szybki skok, pływająca pigułka „Dzisiaj” |

Przy okazji sprostowano założenie z treści zadania: hook `useMediaQuery` **nie
istniał** — był tylko wbudowany `matchMedia` w `App.tsx`. Wydzielono go do
`src/utils/useMediaQuery.ts` i współdzielą go teraz `App.tsx` i `CalendarPage`.

Zrealizowano:

1. **Dolny pasek (≤760 px).** Pięć zakładek (Panel · Kalendarz · Zadania ·
   Zasobnik · Więcej), wysokość `--n2-bottom-nav-h` + `env(safe-area-inset-bottom)`.
   „Zasobnik” to deep-link `/calendar?zasobnik=1` (parametr konsumowany i
   czyszczony w `WeekView`). „Więcej” to arkusz na istniejącej powłoce
   `useOverlay` (`role="menu"`). Szuflada, hamburger i kurtyna **usunięte** na
   telefonie; sidebar renderuje się wyłącznie powyżej breakpointu. Górny pasek
   telefonu niesie tytuł trasy i **jedyny** zamontowany `GlobalSearch`.
2. **Widok dnia.** `WeekView` dostał prop `mode` (`'week'` | `'day'`). Różnicę
   niesie wyłącznie długość tablicy `days` — stała `DAY_COLS` zniknęła na rzecz
   `days.length` w pięciu miejscach. Doszedł pasek 7 dat, jedna pełnej szerokości
   kolumna godzin oraz kaskadowe karty dla bloków nachodzących na siebie
   (zamiast ściskania). Cała logika przeciągania, rozciągania i kolizji jest
   niezmieniona.
3. **Zasobnik jako arkusz od dołu.** Stany `closed` / `peek` / `open` różnią się
   **wysokością, nigdy `translateY`**, więc `binRef` zostaje na `.week-bin-pane`,
   a trafianie w wyrenderowaną kolumnę działa jak dotąd. Auto-peek w trakcie
   przeciągania płynie z **istniejącego** efektu `[dragging]`, obok
   `setLiveSyncHold`; poza trybem dnia wychodzi natychmiast.
4. **Jeden rząd 56 px na telefonie:** ‹ · przycisk zakresu (otwiera szybki skok)
   · › · „Filtry” z licznikiem. „Dzisiaj” tylko jako pływająca pigułka, gdy
   widoczny zakres nie obejmuje dziś.

Nowe czyste moduły (bez Reactu, testowalne w node): `bottomNav.ts`,
`dayStrip.ts`, `dayStack.ts` — plus `useMediaQuery.ts`.

Recenzja tieru zwróciła werdykt **approved-with-nits** (bez blokerów) i na jej
podstawie naprawiono jeszcze dwie realne usterki w dostarczonej funkcji:

- przeciągnięcie karty **z otwartego** arkusza zasobnika zostawiało nad siatką
  panel 85dvh, a zapasowa ścieżka trafiania i tak wyliczała kolumnę **pod** nim —
  upuszczenie planowało blok w niewidocznym slocie. Arkusz zwija się teraz na
  czas gestu do `peek` i wraca do poprzedniego stanu po jego zakończeniu
  (mechanizm zapisu stanu już istniał);
- `.week-bin-sheet` nie miał roli ani nazwy — dostał `role="dialog"` +
  `aria-label="Zasobnik"`, spójnie z dwoma pozostałymi arkuszami.

## Zmiany

Zmodyfikowane: `src/App.tsx`, `src/components/WeekView.tsx`,
`src/components/icons.ts`, `src/pages/CalendarPage.tsx`, `src/styles.css`,
`scripts/browser-check-ui-keyboard.mjs`, `openwiki/n2hub/scheduling-and-calendar.md`,
`openwiki/n2hub/ui-navigation-and-onboarding.md`,
`openwiki/n2hub/testing-and-automation.md`, `handoffs/RUN-STATE.md`.

Nowe: `src/components/bottomNav.ts` (+ `.test.ts`), `src/components/dayStrip.ts`
(+ `.test.ts`), `src/components/dayStack.ts` (+ `.test.ts`),
`src/utils/useMediaQuery.ts`, `handoffs/packages/PKG-20260728-mobile-nav-day-view.md`.

Bez zmian: `src/store/**`, `src/utils/time.ts`, `src/utils/dates.ts`,
`src/utils/touchDrag.ts`, `package.json` (zero nowych zależności runtime).

## Weryfikacja

- `npm test` → **85 plików, 1883 testy zielone** (baza 1845 + 38 nowych).
  Żaden istniejący test nie został usunięty, osłabiony ani pominięty.
  Uruchomione trzykrotnie: po implementacji, po przekierowaniu testu
  przeglądarkowego i po naprawie dwóch usterek z recenzji.
- `npm run build` → zielony (3204 moduły).
- `npx tsc --noEmit` → czysto.
- Testy skupione: `bottomNav` / `dayStrip` / `dayStack` — 38 zielonych;
  regresja `calendarBlockKeyboard` / `weekViewLayout` / `time` / `touchDrag` /
  `weekViewModel` — 117 zielonych.
- **Testy przeglądarkowe: NIE uruchomiono** (patrz Ryzyka).

Gate schedulera (`npm test && npm run build`) uruchomi się ponownie po tym
raporcie; ostatnie lokalne uruchomienie było zielone.

## Ryzyka / rzeczy do sprawdzenia

1. **Nic poniżej 760 px nie zostało sprawdzone w prawdziwej przeglądarce.**
   Ten run nie dostaje serwera deweloperskiego na :5173. Dolny pasek, siatka
   dnia, kaskada kart, auto-peek i rząd 56 px są wyłącznie przejrzane w kodzie.
   To największe ryzyko tej dostawy.
2. **`scripts/browser-check-ui-keyboard.mjs` został przepisany i jest
   NIEURUCHOMIONY** (sprawdzony tylko `node --check`). Skrypt asercjonował
   szufladę mobilną, którą to zadanie celowo kasuje — zamiast go zostawić
   trwale czerwonym, przekierowano go na dolny pasek i arkusz „Więcej”
   (32 asercje zamiast 25, w tym strażnik pojedynczego `GlobalSearch` przez
   Ctrl+K). Asercje desktopowe zostały bez zmian. Najbardziej prawdopodobny tryb
   awarii to nietrafiony selektor, nie fałszywe przejście.
3. **`browser-check-bin-drag.mjs` nie został uruchomiony**, a pakiet uznawał go
   za wymagany — to on jest właściwym dowodem braku regresji inwariantu 7
   (`hitIndex < days.length`, efekt `[dragging]`). Zgodność desktopu została
   potwierdzona wyłącznie analizą statyczną, choć dokładną: przejrzano wszystkie
   pięć miejsc po `DAY_COLS`, gałąź `stack === undefined` i każdą nową regułę CSS
   spoza media query.
4. **Recenzja Codex nie odbyła się**, mimo że pakiet deklarował
   `Codex review: required` — w tym worktree nie ma `automation/claude-scheduler/`
   ani świeżego artefaktu Codeksa. Werdykt pochodzi wyłącznie z recenzenta tieru.
5. Odłożone świadomie (recenzent uznał za utajone lub kosmetyczne, nie blokujące):
   licznik `dragCountRef` dekrementowany przy montowaniu (nie udało się
   skonstruować osiągalnego montażu w trakcie gestu), przeskok fokusu na
   `.week-bin-trigger` przy starcie przeciągania, wyzwalacz schowany pod otwartym
   arkuszem, konsumpcja `?zasobnik=1` dopiero po przełączeniu na tryb dnia,
   zduplikowany CSS uchwytu, brak pełnej daty w `aria-label` pasków dnia,
   `id="app-drawer"` na desktopowym sidebarze (nazwa już kłamie, ale trzyma
   uchwyt testu przeglądarkowego).
6. Wiki: **zaktualizowano** trzy strony — dwa zdania były już **nieprawdziwe**
   (szuflada mobilna z pułapką fokusa; opis pokrycia skryptu klawiaturowego),
   a jedno niekompletne (`WeekView` ma teraz dwa tryby renderowania).
   `testing-and-automation.md` było poza zadeklarowanym kontekstem — rozszerzenie
   świadome, bo zmieniła się trasa testowa opisana na tej stronie.

## Podpis schedulera

- Run: `20260728-042633-n2hub-287-mobile-nav-day-view`
- Prompt: `287-mobile-nav-day-view.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `bc4c7b0362374e0426c64161bb0be7f2be30ba05`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `bc4c7b0362374e0426c64161bb0be7f2be30ba05`
- Gałąź review: `review-integration`
- Run: `20260728-042633-n2hub-287-mobile-nav-day-view`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `openwiki/n2hub/scheduling-and-calendar.md`
- `openwiki/n2hub/testing-and-automation.md`
- `openwiki/n2hub/ui-navigation-and-onboarding.md`
- `scripts/browser-check-ui-keyboard.mjs`
- `src/App.tsx`
- `src/components/WeekView.tsx`
- `src/components/icons.ts`
- `src/pages/CalendarPage.tsx`
- `src/styles.css`
- `handoffs/packages/PKG-20260728-mobile-nav-day-view.md`
- `handoffs/scheduler-reviews/20260728-042633-n2hub-287-mobile-nav-day-view.md`
- `src/components/bottomNav.test.ts`
- `src/components/bottomNav.ts`
- `src/components/dayStack.test.ts`
- `src/components/dayStack.ts`
- `src/components/dayStrip.test.ts`
- `src/components/dayStrip.ts`
- `src/utils/useMediaQuery.ts`
