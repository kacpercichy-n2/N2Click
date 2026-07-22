# Raport workflow: 20260722-123533-n2hub-249-dashboard-layout

## Wykonane

Workflow tier: `developer → reviewer` (jedna granica: strona + CSS + mały moduł
pomocniczy z testami). Analiza wstępna potwierdziła, że WSZYSTKIE punkty promptu
nadal pozostawały w buildzie — wykonano pełną przebudowę:

1. **Siatka Panelu** — `.dash-welcome-grid` przepisana na jawne
   `grid-template-areas` z kolumnami `minmax(0,2fr) | minmax(0,1fr)`:
   rząd 2 „Powiadomienia | Obciążenie", rząd 3 „Zadania na dziś | Zespół",
   rząd 4 „Twój tydzień" na pełną szerokość. Pasek changelogu (rząd 1) bez
   zmian, nad siatką. Rząd 5 „Pozostałe kategorie" zarezerwowany wyłącznie jako
   komentarz w kodzie (bez widocznego pustego kafelka) pod przyszłe kafelki
   Zasobnika/Alertów (prompt 258). Poniżej 1180px siatka składa się do jednej
   kolumny w kolejności DOM. Animacje stagger (motion) zachowane.
2. **Powiadomienia — tylko slot UI** — nowy kafelek zasilany na razie pustą
   listą; limit 3 wpisów przez `visibleNotifications()`, pusty stan
   „Brak nowych powiadomień". Zero zmian w store/reduktorze/modelu danych,
   bez backendu i źródła zdarzeń.
3. **Zespół** — licznik w nagłówku „Zespół (N)" (`teamHeaderLabel()`, przy 0
   współpracowników samo „Zespół" + dotychczasowa podpowiedź); lista
   `.chat-people` z `max-height: 200px` (~4 wiersze) i `overflow-y: auto` —
   reszta osób przewija się WEWNĄTRZ kafelka, kafelek nie wydłuża viewportu.
4. **Równe wysokości w rzędzie 3** — oba kafelki rozciągają się do wspólnego
   wiersza grida (`flex-direction: column` wewnątrz, więc scroll listy zespołu
   działa w ramach wspólnej wysokości).
5. **Obciążenie (kompakt, wąska kolumna)** — usunięty sztywny
   `.donut-center { top: 60px }`; SVG owinięte w `.donut-ring`
   (`position: relative`, overlay centrowany przez `inset: 0`), wartość
   (`31h 45m / 40h`) zmniejszona do `--n2-type-xs` z `tabular-nums` — mieści
   się w pierścieniu bez nachodzenia i ucinania; oba pierścienie (Dziś /
   Ten tydzień) zawijają się w wąskiej kolumnie.
6. **Twój tydzień** — pełna szerokość (obszar `week week`), zawartość bez zmian.

Zachowane kotwice onboardingu: `data-tour="home.today"` na „Zadania na dziś"
(cel z `src/onboarding/catalog.ts:70`) oraz `data-tour="home.workload"`.
NIE scalano Panelu z „Moja praca"/zasobnikiem (osobny prompt 258).

## Zmiany

- `src/pages/DashboardPage.tsx` — nowy kafelek Powiadomienia, klasy
  `dash-area-*`, licznik zespołu, wrapper `.donut-ring`, slot rzędu 5.
- `src/styles.css` — sekcja dashboardu: grid-template-areas, media query
  ≤1180px, scroll `.chat-people`, poprawki donuta.
- `src/pages/dashboardPanels.ts` (nowy) — czysta logika: `visibleNotifications`
  (limit 3), `teamHeaderLabel` (licznik).
- `src/pages/dashboardPanels.test.ts` (nowy) — 6 testów: limit 0/3/5
  (z zachowaniem kolejności) i etykieta 0/1/7.
- `handoffs/RUN-STATE.md` — dopisany wpis pakietu (kontynuacja logu runów).

## Weryfikacja

- `npx vitest run src/pages/dashboardPanels.test.ts` → PASS (6/6).
- `npm test` → PASS (51 plików, 1327 testów; +6 nowych, brak regresji).
- `npm run build` → PASS (`tsc --noEmit` + vite; jedynie wcześniej istniejące
  ostrzeżenie o chunku >500 kB).
- Reviewer (read-only, pełny diff vs kryteria akceptacji): **APPROVED**,
  0 blockerów; checklista akceptacyjna w całości PASS; komendy powtórzone
  niezależnie z tym samym wynikiem.
- Wiki: **wiki unchanged** — `ui-navigation-and-onboarding.md` opisuje Panel
  tylko na poziomie routingu (`/dashboard` jako lądowanie ról nie-worker),
  nie opisuje układu kafelków; nic nie stało się nieaktualne.
- Gate (`npm test && npm run build`): oczekuje na scheduler.

## Ryzyka / rzeczy do sprawdzenia

- Nity reviewera (nieblokujące): (1) `max-height: 200px` listy zespołu
  pokazuje ~8px skrawek 5. wiersza — działa jako afordancja przewijania;
  (2) wiersze powiadomień reużywają `.dash-row` z hoverem/kursorem, choć nie
  są klikalne — gałąź dziś martwa (pusta lista), prompt 258 dostarczy realne
  dane i może przestylować; (3) `cursor: pointer` na `.chat-person` to stan
  sprzed tej zmiany.
- Kafelek Powiadomień zawsze renderuje pusty stan (brak źródła danych w tej
  iteracji) — zgodnie z promptem to wyłącznie warstwa UI pod przyszłe dane.
- Recenzja Codex: uruchamiana przez scheduler po zakończeniu tego procesu
  (poza sesją) — werdykt powyżej jest werdyktem reviewera in-session.

## Podpis schedulera

- Run: `20260722-123533-n2hub-249-dashboard-layout`
- Prompt: `249-dashboard-layout.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `93c5031ce2d6005f18460f2718b8c212f70f1443`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `93c5031ce2d6005f18460f2718b8c212f70f1443`
- Gałąź review: `review-integration`
- Run: `20260722-123533-n2hub-249-dashboard-layout`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `src/pages/DashboardPage.tsx`
- `src/styles.css`
- `handoffs/scheduler-reviews/20260722-123533-n2hub-249-dashboard-layout.md`
- `src/pages/dashboardPanels.test.ts`
- `src/pages/dashboardPanels.ts`
