# Raport workflow: 20260803-212145-n2hub-322-zadania-karta-i-tlo

## Wykonane

Workflow tier: `developer -> reviewer` (orkiestrator tylko diagnozował i routował).
Wszystkie trzy punkty feedbacku operatora były nadal obecne w buildzie i zostały
naprawione:

1. **Pasek „zaplanowany czas"** — usunięty w całości z `PlanningProgress`
   (`.planning-progress-bar` + `span.planning-progress-fill`, razem z regułami
   tonu `over` w CSS). Ten sam zarzut (tor stałej długości, nic nie komunikuje)
   dotyczył każdego użycia, więc pasek zniknął spójnie także z wierszy Panelu
   i szczegółów projektu — tam godziny i tak stoją obok jako tekst. Wartości
   liczbowe („zaplanowano X / szac. Y") oraz teksty dla czytnika ekranu
   (etykieta rozplanowania + stan planowania) zostały; usunięto tylko
   `role="progressbar"`, bo nie ma już wizualnego paska. `utils/planningProgress.ts`
   i jego testy nietknięte.
2. **Akcje karty zadania** — wzorcem usuwania w aplikacji jest czerwony kosz
   (`Trash2` + `IconButton variant="danger"`, jak w Klientach i Content planie),
   więc oba przyciski usuwania na karcie zadania (desktop i mobile) przeszły
   z „X" na kosz. Logika (`useConfirm()`, `handleDelete`) bez zmian — tylko
   ikona. Chevron na końcu karty usunięty razem z rezerwą `padding-right: 40px`
   i selektorami hover; reviewer wykrył, że te same klasy (`task-card-main`)
   współdzieliła karta na `/projects` — tam chevron zostałby osierocony, więc
   (zadeklarowane rozszerzenie zakresu) usunięto go również z kart projektów,
   z tym samym uzasadnieniem operatora: cała karta jest klikalna i podświetla
   się na hoverze. Chevrony na wierszach szczegółów projektu i osób zostają,
   ich CSS nienaruszony.
3. **Tło `/tasks`** — przyczyna potwierdzona w przeglądarce: w skrócie
   `body { background: var(--n2-gradient-page) fixed }` słowo `fixed` przypinało
   tylko OSTATNIĄ warstwę (computed: `scroll, scroll, scroll, fixed`). Trzy
   fioletowe radial-gradienty przewijały się ze stroną i skalowały do wysokości
   dokumentu, więc długie widoki (lista zadań) dostawały dużo większą, jasną
   fioletową łunę. Naprawa: skrót bez `fixed` + osobna deklaracja
   `background-attachment: fixed` (jedna wartość obejmuje wszystkie warstwy).
   Po zmianie computed = `fixed, fixed, fixed, fixed`, tło identyczne na każdej
   trasie niezależnie od długości strony (sprawdzone wizualnie przed i po).

## Zmiany

- `src/components/PlanningProgress.tsx` — pasek usunięty, tekst godzin i `.sr-only` zostają.
- `src/pages/TasksPage.tsx` — `X` -> `Trash2` (oba warianty karty), chevron usunięty, importy przez barrel uporządkowane.
- `src/pages/ProjectsPage.tsx` — usunięty osierocony chevron karty projektu (rozszerzenie po werdykcie reviewera).
- `src/styles.css` — martwy CSS paska i chevronu kart, naprawa `background-attachment` na `body`; reguły chevronu dla pozostałych wierszy nietknięte.
- `openwiki/n2hub/ui-navigation-and-onboarding.md` — akapit o pasku i chevronie zaktualizowany do stanu po zmianie.
- `openwiki/n2hub/frontend-performance-and-primitives.md` — notka: gradient strony przypinany osobnym `background-attachment`, nigdy `fixed` w skrócie.
- `handoffs/RUN-STATE.md` — wpis runu.

## Weryfikacja

- `npm test` — zielony: 119 plików / 2663 testy (uruchomiony przez developera po każdej rundzie).
- `npm run build` — zielony.
- `node scripts/check-openwiki-links.mjs` — 6 plików wiki zwalidowanych.
- Grep-gate: brak `planning-progress-fill`/`planning-progress-bar` w `src`, brak `card-chevron` w `TasksPage.tsx` i `ProjectsPage.tsx`.
- Kontrola wizualna (Playwright, tryb lokalny z danymi przykładowymi): `/tasks` przed/po — paski i chevrony zniknęły, przewinięty widok ma to samo ciemne tło co pozostałe zakładki.
- Reviewer: pierwsza runda `changes-required` (osierocony chevron na `/projects`), po remediacji **approve**, `wiki updated`.
- Gate (`npm test && npm run build`): oczekuje na scheduler.

## Ryzyka / rzeczy do sprawdzenia

- Wiersze z `PlanningProgress showHours={false}` (Panel, szczegóły projektu, arkusz szczegółów zadania na telefonie) nie mają już żadnego wizualnego wskaźnika rozplanowania — zostaje tylko tekst `.sr-only`. To zamierzone (godziny stoją obok), ale operator może chcieć w przyszłości innego wskaźnika stanu.
- `utils/planningProgress.ts` nadal eksportuje `percent`/`tone` bez konsumenta DOM — zostawione świadomie (testowana logika współdzielona), do ewentualnego odchudzenia osobnym zadaniem.
- Reguły `.dash-row .card-chevron` w CSS to martwy kod sprzed tego zadania (Panel nie renderuje chevronu) — nietknięte, poza zakresem.

## Podpis schedulera

- Run: `20260803-212145-n2hub-322-zadania-karta-i-tlo`
- Prompt: `322-zadania-karta-i-tlo.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `19a54efa2b433cc41bf4dea2b635f6dfeb30b707`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `19a54efa2b433cc41bf4dea2b635f6dfeb30b707`
- Gałąź review: `review-integration`
- Run: `20260803-212145-n2hub-322-zadania-karta-i-tlo`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `openwiki/n2hub/frontend-performance-and-primitives.md`
- `openwiki/n2hub/ui-navigation-and-onboarding.md`
- `src/components/PlanningProgress.tsx`
- `src/pages/ProjectsPage.tsx`
- `src/pages/TasksPage.tsx`
- `src/styles.css`
- `handoffs/scheduler-reviews/20260803-212145-n2hub-322-zadania-karta-i-tlo.md`
