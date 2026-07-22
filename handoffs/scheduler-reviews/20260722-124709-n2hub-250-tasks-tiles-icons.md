# Raport workflow: 20260722-124709-n2hub-250-tasks-tiles-icons

## Wykonane

Workflow tier: `developer → reviewer` (pojedyncza granica UI, bez architekta).
Analiza wstępna potwierdziła, że KAŻDY punkt zadania nadal występował w bieżącym
buildzie — nic nie pominięto.

1. **Wspólny wzorzec centrowania ikon** — nowy komponent
   `src/components/IconButton.tsx`: okrągły, flex-centrowany przycisk ikonowy
   (`type="button"`, wymagany `label` → `aria-label`, `title` domyślnie z labela,
   warianty `default`/`danger`), bez polegania na line-height glifów tekstowych.
   Style `.icon-btn` / `.icon-btn.danger` w `src/styles.css` (spójne z
   `.task-modal-close` i `.btn.danger-ghost`).
2. **Kafelki zadań (`src/pages/TasksPage.tsx`)**:
   - „Usuń” → IconButton z ikoną X w kółku (wariant danger, `aria-label`
     `Usuń <tytuł>`, `title="Usuń"`), wycentrowany pionowo w `.card-actions`;
     flow potwierdzenia i `DELETE_TASK` bez zmian.
   - Bąbel projektu: `.project-badge` przełączony na `inline-flex` z
     `align-items: center; gap: 4px` — monetka (`Coin`) jest wycentrowana
     pionowo i siedzi tuż przy tekście (bez zbędnej spacji). Grafika SVG monety
     bez zmian; inne użycia `.project-badge` (modyfikatory department/document/
     draft, ProjectsPage, ProjectDetailPage) zweryfikowane — bez regresji.
   - „+ Nowe zadanie” (nagłówek strony i empty state): plusik jako ikona
     `<Plus size={16} />` w jednej linii i wyśrodkowany dzięki flex+gap w `.btn`.
3. **Karta edycji (`src/components/TaskModal.tsx`)**:
   - Nowa kolejność sekcji: Szczegóły → **Przypisane osoby** (2.) →
     **Dzienny przydział godzin** (3.) → Checklista → Wykonane bloki →
     Cykliczność → Okres → Zasobnik (bez terminu) → Dyskusja → przyciski sticky.
     Czysta zmiana kolejności JSX (reviewer potwierdził bajtową identyczność
     przeniesionych bloków); warunki `!isDraft` / `isEdit` / `existing`,
     handlery i kolejność hooków nietknięte. Opis i checklista bez zmian.
   - Przycisk zamknięcia: tekstowy `×` → IconButton z ikoną X (lucide),
     wycentrowany w kółku 36px (klasa `task-modal-close` zachowana),
     `aria-label="Zamknij"`. Przycisk „Usuń” w nagłówku karty zostaje.
   - Ten sam wzorzec zamknięcia zastosowano w `EventModal`, `TicketModal`
     i `ChangelogModal` (współdzielą klasę i wzorzec TaskModala — inaczej
     przycisk zamknięcia wyglądałby w nich inaczej niż w karcie zadania).

Bez zmian w modelu danych, reduktorach, storage i logice zapisu (inwariant 6
nienaruszony — diff nie dotyka `src/store/`). Stringi po polsku.

## Zmiany

- `src/components/IconButton.tsx` (nowy)
- `src/pages/TasksPage.tsx`
- `src/components/TaskModal.tsx`
- `src/components/EventModal.tsx`, `src/components/TicketModal.tsx`,
  `src/components/ChangelogModal.tsx` (tylko przycisk zamknięcia)
- `src/styles.css` (`.icon-btn`, `.icon-btn.danger`, `.project-badge`)

## Weryfikacja

- `npm test` → **51 plików, 1327 testów, wszystkie zielone** (bez regresji;
  brak nowych testów — zmiany czysto prezentacyjne, bez nowej logiki).
- `npm run build` → **zielony** (ostrzeżenie o rozmiarze chunka >500 kB —
  istniejące wcześniej, niezwiązane ze zmianą).
- `npx tsc --noEmit` (developer) → czysty.
- Reviewer (read-only): werdykt **approve**, 0 blockerów; artefakt Codex
  jeszcze nie istnieje — scheduler uruchamia go po zakończeniu tego procesu.
- Gate (`npm test && npm run build`): oczekuje na scheduler

## Ryzyka / rzeczy do sprawdzenia

- Sekcja „Dzienny przydział godzin” jest teraz NAD sekcją „Okres”, a jej hint
  „Ustaw prawidłowy okres…” wskazuje sekcję niżej — zgodne z żądaną kolejnością,
  ale do ewentualnej korekty UX w przyszłości.
- Poza zakresem zadania pozostały dwa analogiczne miejsca (świadomie
  niedotknięte, kandydaci na osobny prompt): tekstowy plus w
  `src/pages/ProjectDetailPage.tsx:660` i glif `×` w
  `src/onboarding/OnboardingRoot.tsx:568` (renderuje się poprawnie — style
  glifu w `.task-modal-close` zachowane).
- Wiki: **wiki unchanged** — `openwiki/n2hub/ui-navigation-and-onboarding.md`
  opisuje granice, trasy i strażnika nawigacji; kolejność sekcji karty i sposób
  renderowania ikon są poniżej poziomu abstrakcji tej strony.

## Podpis schedulera

- Run: `20260722-124709-n2hub-250-tasks-tiles-icons`
- Prompt: `250-tasks-tiles-icons.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `c4d9dcac9c726765bf0f1ce2f0d827dc62d4df14`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `c4d9dcac9c726765bf0f1ce2f0d827dc62d4df14`
- Gałąź review: `review-integration`
- Run: `20260722-124709-n2hub-250-tasks-tiles-icons`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `src/components/ChangelogModal.tsx`
- `src/components/EventModal.tsx`
- `src/components/TaskModal.tsx`
- `src/components/TicketModal.tsx`
- `src/pages/TasksPage.tsx`
- `src/styles.css`
- `handoffs/scheduler-reviews/20260722-124709-n2hub-250-tasks-tiles-icons.md`
- `src/components/IconButton.tsx`
