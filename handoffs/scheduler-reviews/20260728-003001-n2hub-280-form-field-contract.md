# Raport workflow: 20260728-003001-n2hub-280-form-field-contract

## Wykonane

Najpierw sprawdziłem, czy zadanie jest jeszcze aktualne w bieżącym buildzie —
było. W `src/` nie istniał żaden komponent `Field`, `aria-describedby`
występowało dokładnie 3 razy (wyłącznie w `useModalShell.ts` i
`confirmDialog.ts`, ani razu przy polu formularza), a edytor TaskModal nie miał
elementu `<form>`. Częściowa warstwa IA-12 z wcześniejszego promptu
(`taskSaveBlockers.ts` z kotwicami `focusId`, `focusSaveBlocker`, lista
`.save-blockers` z `role="alert"` oraz auto-fokus pierwszej blokady w `doSave`)
już istniała — rozbudowałem ją, nie duplikowałem.

Trasa tierów: `architect → developer` (+ mechaniczny `test-writer` na synchro
wiki). Architekt rozstrzygnął wszystkie decyzje w pakiecie
`handoffs/packages/PKG-20260728-form-field-contract.md` (`Status: ready`).

Zrealizowany zakres:

1. **Kontrakt pola.** Czysta logika w `src/components/fieldContract.ts`
   (`fieldIds`, `fieldAria`, `firstInvalidKey`, `saveErrorSummary`) + cienka
   warstwa JSX `src/components/Field.tsx` (`label htmlFor` → kontrolka →
   `.field-hint` → `.field-error`, spięte `aria-describedby` z `aria-invalid`,
   pomoc i błąd mogą współistnieć) oraz helper DOM `focusFieldById`. Podział na
   modul czysty + cienką warstwę DOM wynika z tego, że vitest działa tu w
   `environment: 'node'` i nie ma renderera React — to ten sam wzorzec, co
   `modalShell` / `overlayShell` / `confirmDialog`. Wizualia bez zmian: użyte są
   istniejące klasy CSS.
2. **Migracja.** TicketModal — wszystkie 5 pól z etykietą. EventModal — 8
   prostych kontrolek z etykietą. TaskModal — `t-title`, `t-desc`, `t-project`,
   `t-status`, `t-priority`, `t-start`, `t-end` plus grupa `t-assignees`
   (`role="group"`). Walidatory domenowe oraz logika `dirty`/autosave nie były
   przepisywane. Świadomie poza migracją (wypisane w pakiecie): szacunek /
   godziny sprzedane, `AllocationGrid`, checklista, „Cykliczność”, attendees i
   chipy powtarzalności w EventModal, `CommentsPanel`, strony auth/profilu.
   `aria-describedby` w `src/`: 3 → 16.
3. **Ścieżka nieudanego zapisu.** Dokładnie JEDEN region `role="alert"` na modal.
   Jego treść to zliczający komunikat po polsku budowany przez
   `saveErrorSummary` z odmianą liczebnika („… — popraw 2 pola: Tytuł, Okres.”).
   W TaskModal to istniejący region `.save-blockers` — zmieniony został tylko
   tekst jego tytułu, więc nie powstał drugi, konkurencyjny alert. Etykiety
   pochodzą z nowego `SaveBlocker.fieldLabel` (jedno źródło, bez drugiej listy,
   która mogłaby się rozjechać). Fokus + `scrollIntoView` na pierwsze złe pole
   działa w każdym z trzech modali. Błędy zakresu okresu wiszą przy polach
   okresu: akapit błędu ma `id="t-period-error"` wskazywany przez oba inputy, a
   nowe `periodInvalidTargets` oznacza `aria-invalid` na OBU datach dla błędów
   zakresowych (`reversed`, `too-long`) i na jednej dla błędów jednostronnych.
4. **Moment walidacji.** Pierwsza walidacja na blur albo na próbę zapisu; potem
   walidacja na żywo tylko dla pól, które już raz pokazały błąd. W TaskModal
   `touched: Set<SaveBlockerId>` zastąpił pojedynczy `titleTouched`; bramka
   stopki `saveAttempted || (isEdit && dirty)` została bez zmian.
5. **`<form>` w TaskModal.** Formularz obejmuje sekcje „Szczegóły” → „Zasobnik”.
   „Dyskusja” i sticky pasek akcji zostają POZA nim, bo `CommentsPanel` ma
   własny `<form>`, a zagnieżdżanie formularzy jest nielegalne w HTML — to nie
   jest kwestia estetyki, tylko warunek poprawności. `onSubmit` robi
   `preventDefault()` i wchodzi w istniejącą ścieżkę `handleSave`. Wszystkie 13
   realnych przycisków ma `type="button"` (sprawdzone), a domyślny submit daje
   jeden ukryty `<button type="submit" hidden>` — bez niego Enter i tak by nic
   nie zrobił, bo HTML nie robi implicit submission, gdy formularz ma wiele pól
   blokujących i żadnego przycisku submit. `hidden` wyklucza go z cyklu Tab i z
   fokusu początkowego `useModalShell`.

Store, reduktor, selektory, `isValidTaskDraft`, `useAutoSave`, `dirty`,
`dirtyRegistry`, `useModalShell` i `confirmDialog` nie były modyfikowane.
Invariant 6 nietknięty — zablokowany formularz nadal nigdy nie dispatchuje.
Tryb wygaszania pozostaje wyłączony. Zero nowych zależności runtime.

## Zmiany

Nowe pliki:

- `src/components/fieldContract.ts` — czyste wiring id/aria + zliczające
  podsumowanie.
- `src/components/fieldContract.test.ts` — 20 testów node.
- `src/components/Field.tsx` — cienka warstwa JSX + `focusFieldById`.
- `handoffs/packages/PKG-20260728-form-field-contract.md` — pakiet architekta.

Zmienione pliki:

- `src/components/taskSaveBlockers.ts` — `fieldLabel` z jednej mapy
  `BLOCKER_FIELD_LABELS`, nowe `periodInvalidTargets`; istniejące `id`,
  `message`, `focusId` i kolejność bez zmian.
- `src/components/taskSaveBlockers.test.ts` — +6 testów (12 → 18), wyłącznie
  addytywnie.
- `src/components/TaskModal.tsx` — `<form className="task-editor-form">`,
  `touched: Set<SaveBlockerId>`, migracja pól na `Field`, `t-period-error`,
  grupa przypisanych osób, zliczające podsumowanie w `.save-blockers`.
- `src/components/EventModal.tsx` — `EVENT_FIELDS` + 4 czyste reguły wspólne dla
  blur / zmiany-w-błędzie / submitu, migracja pól, `event-time-error`, jeden
  `role="alert"`, fokus pierwszego złego pola.
- `src/components/TicketModal.tsx` — `TICKET_FIELDS` + reguły, migracja 5 pól,
  jeden `role="alert"`, fokus pierwszego złego pola.
- `src/styles.css` — jedna reguła:
  `.task-editor-form .editor-section:last-of-type { margin-bottom: … }`,
  kompensuje margines, który zjadłby nowy wrapper.
- `scripts/browser-check-date-hardening.mjs` — dwa jawne `.blur()` w przepływie
  2 (patrz „Rozszerzenia zakresu”).
- `openwiki/n2hub/ui-navigation-and-onboarding.md` — wpis o nowym wspólnym
  kontrakcie pola oraz korekta zbyt wąskiego zdania, które sugerowało, że
  bramkowana blurem jest tylko sekcja „Cykliczność”.
- `openwiki/n2hub/testing-and-automation.md` — punkt o
  `browser-check-date-hardening.mjs` uzupełniony o wymagany blur.
- `handoffs/RUN-STATE.md` — wpisy runu.

## Weryfikacja

Uruchomione przeze mnie, wyniki zaobserwowane (nie przewidziane):

- `npm test` → **73 pliki / 1710 testów passed, 0 failed.** Bazowo (run
  n2hub-279) było 1684 testy; +26 to dokładnie nowe testy tego runu. Zero
  regresji — nie zmieniano istniejących asercji, jedyny wcześniej istniejący
  plik testowy (`taskSaveBlockers.test.ts`) rozszerzono addytywnie.
- `npm run build` (`tsc --noEmit && vite build`) → **czysty**, zbudowany w 3,7 s.
  Jedyne ostrzeżenie to wcześniej istniejące „chunk > 500 kB”.
- `npm run check:openwiki` → `Validated 6 wiki files.` (pass).
- Testy celowane w trakcie iteracji:
  `npx vitest run src/components/fieldContract.test.ts src/components/taskSaveBlockers.test.ts`
  → 38 passed.
- Kontrola ręczna granicy formularza: `CommentsPanel` renderuje się po
  `</form>`, nie w środku; 13 z 14 `<button>` w TaskModal ma `type="button"`,
  czternasty to celowy ukryty submit.
- Check przeglądarkowy **nie był uruchamiany** — playwright nie jest w tym
  worktree zainstalowany i nie ma dostępnego wyświetlacza. Zmodyfikowany skrypt
  przeszedł tylko `node --check`.

## Ryzyka / rzeczy do sprawdzenia

- **Enter wewnątrz opakowanych sekcji teraz zapisuje** (a po udanym zapisie
  zamyka modal): inputy godzin sprzedanych, komórki `AllocationGrid`,
  `recur-start` / `recur-until`. Wcześniej Enter był tam bezczynny. Input
  checklisty nadal robi `preventDefault()`, a „Zastosuj cykliczność” i publikacja
  zostają wyłącznie przyciskowe. To najważniejsza zmiana zachowania do oceny —
  jeśli któreś z tych pól ma pozostać „Enter = nic”, trzeba je wyłączyć jawnie.
- **Zachowanie Entera i nowy margines nie zostały potwierdzone w realnej
  przeglądarce** (brak playwright/wyświetlacza). Rozumowanie było statyczne.
  Najgorszy przypadek dla Entera to powrót do bezczynności, czyli brak regresji;
  regułę marginesu `.task-editor-form .editor-section:last-of-type` warto
  rzucić okiem na dev-serverze.
- **Błędy okresu i projektu nie pojawiają się już przy każdym wciśnięciu
  klawisza** — dopiero po blur lub próbie zapisu. To jawnie wymagane zadaniem 4,
  nie regresja, ale zmienia dotychczasowe odczucie „natychmiastowej czerwieni”.
- **Rozszerzenie zakresu (jedno, świadome):**
  `scripts/browser-check-date-hardening.mjs` asercjował inline’owy błąd okresu
  w trakcie pisania, więc po zmianie momentu walidacji zacząłby padać. Dodano
  dwa jawne `.blur()`, żeby check nadal sprawdzał ten sam polski komunikat pod
  nowym timingiem. Twierdzenie pakietu, że żadna pokryta interakcja
  przeglądarkowa się nie zmienia, było w tym punkcie nieścisłe.
- **Odstępstwa od pakietu:** (a) planowana nazwa `field.ts` kolidowała z
  `Field.tsx` na case-insensitive systemie plików macOS (TS1261/TS1149), więc
  modul czysty nazywa się `fieldContract.ts` — zgodnie z konwencją repo, gdzie
  moduły czyste mają odrębne nazwy (`modalShell.ts`, `overlayShell.ts`);
  (b) dodano ukryty przycisk submit, bez którego kryterium „Enter w tytule
  uruchamia zapis” byłoby nieosiągalne; (c) `fieldAria` przyjmuje opcjonalne
  `invalid`, żeby błąd zakresowy mógł oznaczyć dwie kontrolki bez wymyślania
  sztucznego komunikatu per pole; (d) `errors.reporter` w TicketModal został
  osobnym akapitem `.field-error` (bez `role="alert"`) i jednocześnie wnosi
  „Zgłaszający” do podsumowania — usunięcie go skasowałoby instrukcję „zaloguj
  się ponownie”.
- **`t-project`:** `label htmlFor` nadal wisi w powietrzu, gdy nie ma żadnego
  projektu (renderuje się wtedy podpowiedź stanu pustego, nie `select`). Stan
  wcześniej istniejący, nie ruszany.
- **Wiki:** synchronizacja została wykonana, bo `CLAUDE.md` wymaga aktualizacji
  zadeklarowanej strony, gdy zmieniona granica jest w niej nieaktualna — a
  nowego wspólnego primitywu tam nie było, przy udokumentowanych
  `modalShell`/`overlayShell`/`confirmDialog`. Ostateczna decyzja
  `wiki updated` / `wiki unchanged` należy do recenzenta schedulera; diff jest
  mały i odwracalny.

## Podpis schedulera

- Run: `20260728-003001-n2hub-280-form-field-contract`
- Prompt: `280-form-field-contract.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `d7a96695902cd699e1da5b3a3fac55ffbc49b023`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `d7a96695902cd699e1da5b3a3fac55ffbc49b023`
- Gałąź review: `review-integration`
- Run: `20260728-003001-n2hub-280-form-field-contract`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `openwiki/n2hub/testing-and-automation.md`
- `openwiki/n2hub/ui-navigation-and-onboarding.md`
- `scripts/browser-check-date-hardening.mjs`
- `src/components/EventModal.tsx`
- `src/components/TaskModal.tsx`
- `src/components/TicketModal.tsx`
- `src/components/taskSaveBlockers.test.ts`
- `src/components/taskSaveBlockers.ts`
- `src/styles.css`
- `handoffs/packages/PKG-20260728-form-field-contract.md`
- `handoffs/scheduler-reviews/20260728-003001-n2hub-280-form-field-contract.md`
- `src/components/Field.tsx`
- `src/components/fieldContract.test.ts`
- `src/components/fieldContract.ts`
