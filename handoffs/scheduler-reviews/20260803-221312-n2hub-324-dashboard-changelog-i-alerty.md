# Raport workflow: 20260803-221312-n2hub-324-dashboard-changelog-i-alerty

## Wykonane

Trasa tier: developer -> reviewer (jedna granica: dashboard + helper changelogu,
testy nierozłączne z implementacją). Oba punkty feedbacku były nadal aktualne
w bieżącym buildzie i zostały wykonane.

**1. Przycisk changelogu z ikoną i licznikiem nieprzeczytanych**

- `src/data/changelog.ts`: nowy helper `changelogUnreadCount(entries, seenId)`
  liczy wpisy nowsze niż ostatnio potwierdzony (`seenId` nieznany lub brak =
  wszystkie nieprzeczytane, pusty dziennik = 0).
- `src/pages/DashboardPage.tsx`: przycisk `link-btn dash-changelog-btn`
  („Zobacz zmiany") dostał ikonę `History` (16 px, `aria-hidden`, przez barrel
  `src/components/icons.ts`, gdzie eksport już istniał) oraz plakietkę
  `span.dash-changelog-badge` z liczbą nieprzeczytanych, gdy licznik > 0.
  Dostępna etykieta liczby przez istniejący `polishCount` („3 nowe wpisy").
- Oznaczanie jako przeczytane reużywa istniejącej ścieżki: `openChangelog`
  ustawia `changelogSeenId` w `uiPrefs` (`updateUiPrefs`) i lokalny stan, więc
  licznik znika po otwarciu. AppStore, reducery i pasek `.changelog-line`
  („Nowości") nietknięte; `ChangelogModal` bez zmian (pokazuje pełną listę od
  najnowszych).
- `src/styles.css`: `.dash-changelog-btn` jako inline-flex z odstępem, badge w
  estetyce istniejącego `.dash-badge`; bez żadnych z-indexów.

**2. Stała wysokość karty alertów (`dash-card.dash-area-alerts`)**

- `src/pages/dashboardPanels.ts`: `COLLAPSIBLE_TILE_LABELS.alerts.empty = null`,
  a `dashTileView` traktuje `null` jako „nigdy belka". Zwijanie kafelka
  Powiadomień (OP-01) zostaje bez zmian.
- `src/pages/DashboardPage.tsx`: pusta karta alertów renderuje pełną kartę
  `dash-card dash-alerts-empty-card` z nagłówkiem „Alerty" i pustym stanem
  „Brak alertów. Wszystko pod kontrolą." zamiast belki 40 px; karta rozciąga
  się do wysokości rzędu obok Zasobnika (grid stretch), więc siatka nie skacze.
  `data-tour="home.alerts"` i `data-tile="alerts"` zachowane dla onboardingu.
  Na telefonie pusty kafelek nadal nie trafia do DOM (`mobileDashboardOrder`
  bez zmian).
- `src/styles.css`: `.dash-alerts-empty-card` (flex column) i wyśrodkowany
  `.dash-alerts-empty`; wariant karty z treścią renderuje się identycznie jak
  dotąd.

Wiki: `openwiki/n2hub/ui-navigation-and-onboarding.md` zaktualizowana (wyjątek
Alertów od belki OP-01 i licznik nieprzeczytanych na przycisku changelogu) —
poprzedni opis byłby po tym diffie nieprawdziwy. Decyzja reviewera:
`wiki updated`.

## Zmiany

- `src/data/changelog.ts`, `src/data/changelog.test.ts`
- `src/pages/DashboardPage.tsx`, `src/pages/dashboardPanels.ts`,
  `src/pages/dashboardPanels.test.ts`
- `src/components/icons.ts` (tylko komentarz), `src/styles.css`
- `openwiki/n2hub/ui-navigation-and-onboarding.md`, `handoffs/RUN-STATE.md`
  (log developera, append-only)

## Weryfikacja

- `npm test` (developer, pełny run): zielony, 119 plików / 2669 testów.
- `npm run build` (developer): zielony (`tsc --noEmit && vite build`).
- Nowe testy: blok `changelogUnreadCount` w `src/data/changelog.test.ts`
  (brak `seenId`, `seenId` = najnowszy, starsze wpisy, id spoza dziennika,
  pusty dziennik) oraz test „mark as read" (po ustawieniu id najnowszego
  wpisu licznik = 0). Świadoma aktualizacja `src/pages/dashboardPanels.test.ts`:
  zwija się tylko kafelek z tekstem belki (Powiadomienia tak, Alerty nie),
  powód opisany komentarzem w teście.
- Reviewer (read-only): APPROVED, bez blockerów; potwierdził brak zmian w
  `src/store/*`, brak em/en-dash w nowych stringach UI, brak z-indexów,
  poprawność licznika i pełną wysokość pustej karty alertów. Codex: skip
  (polityka niezadeklarowana w pakiecie, zakres zdefiniowany wprost w prompcie;
  ostateczna decyzja należy do schedulera).
- Gate (`npm test && npm run build`): oczekuje na scheduler

## Ryzyka / rzeczy do sprawdzenia

- Niewblokujące uwagi reviewera: `aria-label` na plakietce (span bez roli) może
  być pomijany przez część czytników — liczba i etykieta przycisku są czytane,
  wzorzec spójny z istniejącym `.dash-badge`; pusta karta alertów nie używa
  `dash-card-head` jak wariant z treścią (drobna asymetria struktury, wizualnie
  spójne).
- Znacznik przeczytania pozostaje per przeglądarka (uiPrefs), zgodnie z
  istniejącą ścieżką „seen" changelogu; synchronizacja między urządzeniami
  byłaby osobną decyzją produktową.
- Przy okazji zniknął stary tekst belki „Alerty — czysto" (belka dla alertów
  już nie istnieje); jeśli ten komunikat ma wrócić w innej formie, to osobna
  decyzja produktowa.

## Podpis schedulera

- Run: `20260803-221312-n2hub-324-dashboard-changelog-i-alerty`
- Prompt: `324-dashboard-changelog-i-alerty.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `b6620ff1b58c415f3eab33ecb7c30f82ffd94111`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `b6620ff1b58c415f3eab33ecb7c30f82ffd94111`
- Gałąź review: `review-integration`
- Run: `20260803-221312-n2hub-324-dashboard-changelog-i-alerty`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `openwiki/n2hub/ui-navigation-and-onboarding.md`
- `src/components/icons.ts`
- `src/data/changelog.test.ts`
- `src/data/changelog.ts`
- `src/pages/DashboardPage.tsx`
- `src/pages/dashboardPanels.test.ts`
- `src/pages/dashboardPanels.ts`
- `src/styles.css`
- `handoffs/scheduler-reviews/20260803-221312-n2hub-324-dashboard-changelog-i-alerty.md`
