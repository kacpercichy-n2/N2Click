# Raport workflow: 20260722-130626-n2hub-251-projects-detail-layout

## Wykonane

Analiza wstępna potwierdziła, że wszystkie punkty promptu były nadal aktualne w
bieżącym buildzie — żaden nie został pominięty. Routing tier: `developer →
reviewer` (pojedyncza granica UI, gotowa specyfikacja).

1. **Lista projektów** — nazwa klienta (`.client-group-name`, `src/styles.css`)
   przerobiona z małego wyszarzonego nagłówka na widoczny kafelek/blob:
   tło lawendowe, obramowanie, zaokrąglenie, padding i większa czcionka
   (`--n2-type-lg` zamiast `--n2-type-xs`), wszystko na istniejących tokenach.
2. **Panel projektu** (`src/pages/ProjectDetailPage.tsx`):
   - pole opisu `#pd-desc`: `rows={3}` → `rows={6}` (×2 wyższe);
   - **usunięta sekcja „Kamienie milowe”** wraz z martwym kodem tego pliku
     (stan formularza, `addMilestone`, importy `milestonesOfProject`
     i `isValidDateStr`). Chirurgicznie i odwracalnie: model, reducery
     (`SAVE_MILESTONE`/`MOVE_MILESTONE`/`DELETE_MILESTONE`), selektor,
     TimelinePage i CSS `.milestone-*` nietknięte;
   - sekcja **„Zadania” przeniesiona zaraz po „Szczegóły”** — kolejność:
     Szczegóły → Zadania → Dokumenty → Dyskusja; Dokumenty bez zmian treści;
   - **Dyskusja** wyróżniona akcentem (`.editor-section-discussion`, lewy
     border lawendowy) i textarea ×2: nowy opcjonalny prop
     `inputRows` w `CommentsPanel` (domyślnie 2, tu 4) — TaskModal bez zmian.
3. `src/pages/ProjectsPage.tsx` — hint formularza tworzenia nie obiecuje już
   edycji kamieni milowych na karcie projektu.

Belka filtrów (prompt 248) nietknięta; zero zmian w store/reducerach/typach.

## Zmiany

- `src/pages/ProjectDetailPage.tsx` — opis ×2, usunięcie UI milestones,
  kolejność sekcji, akcent dyskusji
- `src/pages/ProjectsPage.tsx` — hint formularza (bez „kamieni milowych”)
- `src/components/CommentsPanel.tsx` — opcjonalny prop `inputRows` (default 2)
- `src/styles.css` — blob `.client-group-name`, `.editor-section-discussion`
- `handoffs/RUN-STATE.md` — notatka developera z runu

## Weryfikacja

- `npm test` (developer): **1327 passed / 0 failed**, 51 plików, bez regresji.
- `npm run build` (developer): zielony (tsc --noEmit + vite build).
- Reviewer (read-only): **APPROVED, bez blockerów** — potwierdził realizację
  wszystkich punktów, brak zmian poza zakresem, wsteczną zgodność
  `CommentsPanel` (TaskModal → rows=2), stringi po polsku, tokeny CSS,
  `.client-group-name` używane wyłącznie na liście projektów.
- Wiki: **unchanged** — zmiana czysto layoutowa; strony wiki opisują model
  danych i reducery milestones, które pozostały nietknięte; żadna strona nie
  dokumentuje kolejności sekcji panelu projektu.
- Gate (`npm test && npm run build`): oczekuje na scheduler.

## Ryzyka / rzeczy do sprawdzenia

- Dane kamieni milowych pozostają w modelu i na osi czasu (TimelinePage) —
  usunięto tylko UI na karcie projektu; przywrócenie sekcji to odwrócenie
  jednego diffa (CSS `.milestone-*` celowo zostawione).
- Confirm usunięcia projektu nadal wymienia „kamienie milowe” — poprawnie, bo
  kaskada w store faktycznie je kasuje.
- Poza tym: Brak.

## Podpis schedulera

- Run: `20260722-130626-n2hub-251-projects-detail-layout`
- Prompt: `251-projects-detail-layout.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `9621f747f9a49221cae30623fbbca802e9d8e9aa`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `9621f747f9a49221cae30623fbbca802e9d8e9aa`
- Gałąź review: `review-integration`
- Run: `20260722-130626-n2hub-251-projects-detail-layout`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `src/components/CommentsPanel.tsx`
- `src/pages/ProjectDetailPage.tsx`
- `src/pages/ProjectsPage.tsx`
- `src/styles.css`
- `handoffs/scheduler-reviews/20260722-130626-n2hub-251-projects-detail-layout.md`
