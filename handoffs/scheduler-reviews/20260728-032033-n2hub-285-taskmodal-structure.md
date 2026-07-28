# Raport workflow: 20260728-032033-n2hub-285-taskmodal-structure

## Wykonane

**Analiza wstępna: zadanie NADAL było otwarte w bieżącym buildzie.** Przed zmianą
kolejność DOM w `TaskModal.tsx` wyglądała tak: Szczegóły (~1206) → Osoby i godziny
(~1359) → siatka przydziału (~1551) → Checklista (~1593) → Wykonane bloki (~1660)
→ Cykliczność (~1709) → **Okres (~1857)** → **Zasobnik (~1917)** → Dyskusja (~1976).
Okres stał ~500 linii POD siatką godzin, osobna sekcja „Zasobnik" powtarzała liczbę
z `estimate-compare`, Dyskusja była zwykłą sekcją na końcu, a Cykliczność
i Klasyfikacja były zawsze rozwinięte. Wcześniejsze prompty dostarczyły tylko
części całości (scroll-to-error, `SaveStatus`, kontrakt `Field`, `estimate-compare`
pod godzinami).

Praca przeszła ścieżką tier: `architect → developer` (recenzent jest własnością
schedulera). Pakiet: `handoffs/PKG-20260728-taskmodal-structure.md`.

**Nowy model kolejności sekcji** — `src/components/taskModalSections.ts` (czysty
moduł w stylu sąsiadów `taskSaveBlockers.ts` / `modalShell.ts`): jedna tabela
`ALL_SECTIONS`, jeden przełącznik `isSectionVisible`, eksporty `visibleSections`,
`visibleTabs`, `initialTab`, `resolveTabNavKey` oraz typy `SectionFlags`,
`TaskModalSection`, `TaskModalTab`, `TaskModalTabId`, `TaskModalSectionId`.
TaskModal renderuje sekcje Z tego modelu (JSX trzymany w
`Record<TaskModalSectionId, ReactNode>`), a nie z zaszytej kolejności.

**Docelowa struktura modala** (`.editor.task-editor`): pasek `role="tablist"`
(renderowany tylko gdy zakładek > 1) → `<form className="task-editor-form">`
z panelami `zadanie` i `planowanie` → panel `dyskusja` jako **rodzeństwo**
formularza → przyklejony `.editor-actions-sticky`. Panele chowane przez `hidden`,
więc `AllocationGrid` nigdy się nie odmontowuje.

Zakładka **Zadanie**: przyklejony kontekst (tytuł, projekt, status) → Opis /
szczegóły → **Termin / Okres (przeniesiony NAD godziny)** → Osoby i godziny
z panelem dostępności → scalony pasek podsumowania planowania (kalendarz ·
zasobnik · sprzedane), który **zastąpił skasowaną sekcję „Zasobnik (bez terminu)"**
→ Checklista → Cykliczność zwinięta za przełącznikiem „Powtarzaj to zadanie" →
Klasyfikacja (kategoria, dział) zwinięta. Zakładka **Planowanie**: siatka
dziennego przydziału + wykonane bloki. Zakładka **Dyskusja** z licznikiem
komentarzy w etykiecie; w `CommentsPanel.tsx` pole komentarza przeniesione NAD
wątek (IA-17).

**Tryb tworzenia** (`isNew`) pokazuje wyłącznie pozycje 1–5 + checklistę; przy
jednej zakładce pasek zakładek się nie renderuje. Siatka przydziału, cykliczność,
wykonane bloki i dyskusja pojawiają się dopiero, gdy zadanie istnieje / ma
poprawny okres.

To była przebudowa **strukturalna**: logika pól, autozapis, śledzenie „dirty",
walidatory, `serializeDraft`, dispatch cykliczności, `DisabledHint` (AT-07)
i wnętrze `AllocationGrid` zostały przeniesione dosłownie, nie przepisane.
CSS (`src/styles.css`): dołożone `.task-editor-tabs`, `.task-context-header`
(z-index 4, pod stopką 5), `.section-toggle`, `.editor-section-collapsible`,
`.editor-section-summary`; skasowane `.bin-existing*` / `.bin-chip*` po
sprawdzeniu grepem, że TaskModal był ich jedynym konsumentem (`.bin-add-row`
/ `.bin-pending` celowo nietknięte).

## Zmiany

- `src/components/taskModalSections.ts` (nowy) — czysty model kolejności sekcji i zakładek.
- `src/components/taskModalSections.test.ts` (nowy) — 20 testów: pełna kolejność
  w edycji, asercja „okres nad godzinami", zbiór sekcji trybu tworzenia przed i po
  ustawieniu poprawnego okresu, szkic, zbiór zwijalny, listy zakładek z licznikiem
  `Dyskusja (3)`, `initialTab` dla deep linku, `resolveTabNavKey` (zawijanie,
  Home/End, klawisz nienawigacyjny → `null`).
- `src/components/TaskModal.tsx` — przebudowa strukturalna wg modelu.
- `src/components/CommentsPanel.tsx` — formularz komentarza nad wątkiem (IA-17).
- `src/styles.css` — style zakładek, przyklejonego kontekstu i sekcji zwijalnych;
  usunięte martwe reguły `.bin-existing*` / `.bin-chip*`.
- `scripts/browser-check-savetask-multiblock.mjs` — jedno dodanie w `openModal()`:
  kliknięcie zakładki „Planowanie", zanim skrypt szuka `.alloc-grid`.
- `handoffs/PKG-20260728-taskmodal-structure.md` (nowy) — pakiet architekta.
- `handoffs/RUN-STATE.md` — dopisany wynik developera.

## Weryfikacja

Uruchomione i sprawdzone osobno, po pracy developera:

- `npm test` → **80 plików / 1823 testy PASS**. Baseline zdjęty przed pierwszą
  edycją: 79 plików / 1803 testy. Przyrost: +1 plik, +20 testów, **zero regresji**;
  żaden test nie był czerwony przed zmianą.
- `npm run build` → **green** (`tsc --noEmit` czysty, `vite build` OK; jedyne
  ostrzeżenie to istniejące wcześniej „chunk > 500 kB").
- Skupiony przebieg w trakcie iteracji:
  `npx vitest run src/components/taskModalSections.test.ts taskSaveBlockers fieldContract` → 58 PASS.
- Kontrola strukturalna grepem: dokładnie **jeden** `<form>` w TaskModalu
  (otwarcie 2106, zamknięcie 2125), a panel `dyskusja` jest jego rodzeństwem —
  `CommentsPanel` ze swoim własnym `<form>` NIE jest zagnieżdżony; dokładnie
  **jeden** `role="alert"` (podsumowanie blokad zapisu); w `src/` nie ma już
  sekcji „Zasobnik" TaskModala (pozostałe trafienia to zasobnik kalendarza
  i kafelki Panelu — celowo nietknięte).
- Skrypty browser-check: **nie uruchamiane** (nie są częścią gate'u; brak serwera
  dev w tym przebiegu).

## Ryzyka / rzeczy do sprawdzenia

1. **`scripts/browser-check-savetask-multiblock.mjs` jest czerwony OD WCZEŚNIEJ,
   niezależnie od tej zmiany.** Skrypt trzykrotnie klika przycisk „Zapisz i zamknij",
   którego w `src/` już nie ma (grep zwraca wyłącznie dwie linie komentarza; stopka
   mówi „Gotowe"). Naprawiony został wyłącznie locator zakładki, zgodnie z zakresem —
   nie leczono wcześniejszej rozbieżności przycisku. Locator zakładki nie był
   weryfikowany runtime'owo.
2. **Jedno świadome odstępstwo od pakietu:** `EditorProps.onBlockersChange`
   przyjmuje teraz drugi argument `(blockers, jump)`. Odznaka zapisu żyje
   w `TaskModalShell`, który nie zna stanu zakładek, więc bez tego ustawiałaby
   fokus na kotwicy wewnątrz panelu `hidden`. Edytor przekazuje w górę stabilne
   `jumpToBlocker`, które najpierw przełącza zakładkę na `zadanie`, a fokus ustawia
   w `setTimeout(0)` po commicie. Kolejność blokad, podsumowanie `role="alert"`
   i `focusFieldById` bez zmian. Warte oka recenzenta.
3. **Deep link `?block=`** ląduje fokusem na zakładce „Planowanie", a nie na polu
   tytułu — `useModalShell` odsiewa kandydatów przez `getClientRects().length === 0`,
   więc elementy w panelach `hidden` są automatycznie poza pułapką Tab. To
   zamierzona konsekwencja, nie wyciek fokusu, ale zmiana odczuwalna dla użytkownika.
4. **Brak testu DOM** potwierdzającego, że `CommentsPanel` stoi poza formularzem —
   repo nie ma jsdom ani `@testing-library`, wszystkie testy są czyste/node.
   Zweryfikowano to grepem struktury, nie asercją runtime'ową.
5. `.bin-add-row` / `.bin-pending` w `styles.css` mogą być teraz martwe, ale były
   poza zakresem i zostały nietknięte.
6. **Wiki wymaga aktualizacji** (nie edytowano — decyzja `wiki updated` /
   `wiki unchanged` należy do recenzenta schedulera):
   `openwiki/n2hub/ui-navigation-and-onboarding.md`, linie ~193–197 twierdzą, że
   formularz TaskModala obejmuje sekcje „OD «Szczegóły» DO «Zasobnik» WYŁĄCZNIE".
   Po zmianie formularz obejmuje panele `zadanie` + `planowanie`, sekcja „Zasobnik"
   nie istnieje, a pierwszą sekcją jest przyklejony kontekst, nie „Szczegóły".
   Reszta akapitu (Dyskusja i pasek akcji poza formularzem) pozostaje prawdziwa.

## Podpis schedulera

- Run: `20260728-032033-n2hub-285-taskmodal-structure`
- Prompt: `285-taskmodal-structure.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `4dc49131b4760c982c501cf648a3c7ebc1fbfdc4`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `4dc49131b4760c982c501cf648a3c7ebc1fbfdc4`
- Gałąź review: `review-integration`
- Run: `20260728-032033-n2hub-285-taskmodal-structure`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `scripts/browser-check-savetask-multiblock.mjs`
- `src/components/CommentsPanel.tsx`
- `src/components/TaskModal.tsx`
- `src/styles.css`
- `handoffs/PKG-20260728-taskmodal-structure.md`
- `handoffs/scheduler-reviews/20260728-032033-n2hub-285-taskmodal-structure.md`
- `src/components/taskModalSections.test.ts`
- `src/components/taskModalSections.ts`
