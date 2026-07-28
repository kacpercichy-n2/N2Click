# Raport workflow: 20260728-015729-n2hub-282-kanban-touch-keyboard

## Wykonane

Analiza wstępna: zadanie BYŁO nadal aktualne. `src/pages/KanbanPage.tsx` używał
natywnego HTML5 DnD (`draggable`, `dataTransfer`, `onDragOver`/`onDrop`), a
jedyną obsługą klawiatury był Enter otwierający `TaskModal` — na telefonie i
tablecie tablica była faktycznie tylko do odczytu. Praca poszła trybem tier
(`developer → reviewer`) na podstawie paczki
`handoffs/packages/PKG-20260728-kanban-touch-keyboard.md`.

Zakres zrealizowany:

1. **Przeciąganie na Pointer Events (mysz + dotyk).** HTML5 DnD wycięte w
   całości. Start przeciągania idzie przez istniejącą, przetestowaną bramkę
   `useTouchDragGate` (przytrzymanie 350 ms, slop 10 px) — dokładnie tak, jak
   robią to `WeekView` i `TimelinePage` — więc ruch palcem po karcie przed
   przytrzymaniem nadal przewija tablicę. Przechwycenie wskaźnika w `try/catch`,
   koalescencja ruchu do jednego `requestAnimationFrame`, cel liczony ze
   ZMIERZONYCH prostokątów renderowanych kolumn (`data-status-id` +
   `getBoundingClientRect`), nie z `elementFromPoint` (przechwycenie kieruje
   wszystkie zdarzenia na kartę). Ścieżki anulowania bez wysyłki:
   `pointercancel`, Escape, `blur` okna, `visibilitychange`, mysz z
   `buttons === 0`, odmontowanie w trakcie gestu. Dotknięcie bez przeciągnięcia
   nadal otwiera `TaskModal` (`moved`-ref).
2. **Tryb przenoszenia z klawiatury.** Nowy czysty automat
   `src/pages/kanbanMove.ts` (bez Reacta i store'u, wzorzec `touchDrag.ts`):
   stan `null | { taskId, sourceStatusId, targetIndex }`, zdarzenia
   `pickup | move(±1) | first | last | drop | cancel`. Zdarzenie bez skutku
   zwraca TĘ SAMĄ referencję stanu (jak `touchHoldReducer` i reduktor store'u),
   `move` nie zawija się na krawędziach pasa kolumn, `drop` na kolumnie
   źródłowej nie wysyła nic. UI: uchwyt na karcie — Spacja/Enter podnosi i
   upuszcza, strzałki (obie osie) oraz Home/End zmieniają kolumnę docelową,
   Escape anuluje i oddaje fokus uchwytowi, wyjście Tabem anuluje bez odbijania
   fokusa.
3. **„Przenieś do statusu →" w menu karty** — dwukrokowe menu na WSPÓLNEJ
   powłoce `useOverlay`/`OverlayLayer` (portal, stos Escape, klawiatura
   `role="menu"`), bez drugiej implementacji popovera. Bieżący status wyłączony,
   więc no-op nie trafia do store'u.
4. **Ogłoszenia i wskaźnik.** Jeden region `role="status" aria-live="polite"` na
   stronę ogłasza podniesienie („Podniesiono: X. Kolumna W toku, pozycja 2 z 4."),
   każdą zmianę celu, upuszczenie i anulowanie. Ten sam WIDOCZNY wskaźnik
   (podświetlona kolumna + kreska `.kanban-drop-indicator` na wyliczonym
   miejscu) obsługuje przeciąganie i tryb klawiaturowy.
5. **Wygląd karty nietknięty.** Treść, rozmiar, gęstość i awatary `.kanban-card`
   bez zmian; uchwyt i wyzwalacz menu to absolutnie pozycjonowany klaster,
   w spoczynku niewidoczny i przezroczysty dla wskaźnika.

Decyzja architektoniczna zapisana w paczce i w wiki: **pozycja w kolumnie jest
POCHODNA, nie zapisywana.** Kolejność wynika z `(orderIndex, startDate, id)` i
miesza projekty, a jedyna istniejąca akcja kolejności `REORDER_PROJECT_TASK`
działa w obrębie projektu — nie da się nią deterministycznie ustawić karty
względem sąsiada z innego projektu. Dlatego tryb klawiaturowy wybiera KOLUMNĘ,
a „pozycja N z M" jest WYLICZANA tym samym komparatorem, którym renderuje się
tablica (`compareTasks` wyeksportowany z `kanbanBoard.ts`, bez duplikowania
klucza sortowania). Zero nowych akcji reduktora, pól w `AppData` i zapisanej
kolejności — inwariant 6 nietknięty, wszystkie trzy ścieżki kończą się tą samą
akcją `SET_TASK_STATUS`. Zero nowych zależności runtime; żadnej biblioteki DnD.
Tryb wygaszania pozostaje wyłączony.

## Zmiany

- `src/pages/KanbanPage.tsx` — Pointer Events zamiast HTML5 DnD, tryb
  klawiaturowy, menu karty, region ogłoszeń, wspólny wskaźnik upuszczenia.
- `src/pages/kanbanMove.ts` (nowy) — czysty automat trybu przenoszenia +
  budowniczki polskich komunikatów.
- `src/pages/kanbanMove.test.ts` (nowy) — 20 testów jednostkowych automatu.
- `src/pages/kanbanBoard.ts` — wyłącznie `export` istniejącego `compareTasks`
  (zero zmian zachowania).
- `src/components/icons.ts` — `GripVertical`, `MoreVertical`.
- `src/styles.css` — klaster akcji, `.kanban-drop-indicator`, stany
  `.dragging` / `.moving`.
- `openwiki/n2hub/ui-navigation-and-onboarding.md` — **wiki zaktualizowane**:
  opisana nowa (trzecia) ścieżka mutacji tablicy oraz bramka dotyku na Kanbanie,
  a także uzupełniona lista konsumentów powłoki nakładek, która po tej zmianie
  była już nieprawdziwa.
- `handoffs/packages/PKG-20260728-kanban-touch-keyboard.md` (nowy),
  `handoffs/RUN-STATE.md` — ślad workflow.

## Weryfikacja

Uruchomione przeze mnie na finalnym stanie drzewa, po zakończeniu implementacji:

- `npm test` → **75 plików / 1747 testów — wszystkie zielone, 0 błędów**
  (bez regresji; `kanbanBoard.test.ts` przeszedł nietknięty).
- `npm run build` (`tsc --noEmit` + vite) → **zielone**. Jedyne ostrzeżenie to
  istniejący od dawna komunikat o rozmiarze chunka (>500 kB), nie regresja.
- W trakcie pracy dodatkowo: `npx vitest run src/pages/kanbanMove.test.ts
  src/pages/kanbanBoard.test.ts` → 40 pass, `npm run typecheck` → czysto.

Test jednostkowy automatu pokrywa m.in.: podniesienie z kolumny aktywnej i z
archiwum, clamp na obu krawędziach, no-op zwracający TĘ SAMĄ referencję
(`toBe`), `drop` na kolumnie źródłowej → brak intencji, `cancel` → stan `null`,
zdarzenia w stanie spoczynku, pustą listę kolumn i wyliczanie „pozycja N z M".

- Gate (`npm test && npm run build`): zielony lokalnie; ostateczne wykonanie
  należy do schedulera.

## Ryzyka / rzeczy do sprawdzenia

1. **Brak testu warstwy Reactowej.** Repo nie ma testów komponentowych ani
   skryptu przeglądarkowego pokrywającego Kanban (`scripts/` obejmuje
   onboarding i regresję wydania). Automat klawiaturowy jest przetestowany
   jednostkowo, ale ścieżki wskaźnika (przechwycenie, rAF, anulowania) oraz
   powrót fokusa zweryfikowano wyłącznie typami i przeglądem kodu. Materiał na
   weryfikację wydania na realnym dotyku (iOS Safari + Android Chrome).
2. **Zmiana powierzchni chwytu na dotyku.** Na `pointer: coarse` klaster akcji
   jest widoczny stale (bez tego dotyk nie miałby ścieżki innej niż
   przeciąganie) i nie startuje przeciągania — ok. 90×44 px w prawym górnym
   rogu karty przestaje być polem chwytu. Zamierzone, ale realnie odczuwalne.
3. **Nakładanie się klastra na tytuł na dotyku.** Stale widoczny klaster
   przykrywa prawy koniec pierwszej linii `.kanban-card-title`. Świadomie nie
   dodano `padding-right`, bo zadanie wykluczało zmiany gęstości karty — to
   decyzja produktowa do ewentualnej korekty w osobnym zadaniu.
4. **Kolumna archiwum pozostała NIE-celem upuszczenia** (jak przed zmianą), więc
   ani przeciąganie, ani tryb klawiaturowy, ani menu nie odsyłają zadania do
   statusu archiwalnego z tablicy. To zachowanie sprzed zmiany, nie regresja.
5. **Kosmetyka animacji.** Kreska wskaźnika pojawia się natychmiast, a karta
   dojeżdża animacją `layout` z `motion` (0,18 s) — przy szybkim przenoszeniu
   widać krótkie rozjechanie. Animacji nie tłumiono, żeby nie ruszać istniejącej
   warstwy wizualnej.

## Podpis schedulera

- Run: `20260728-015729-n2hub-282-kanban-touch-keyboard`
- Prompt: `282-kanban-touch-keyboard.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `575f3d3dbac652288d7954b498bb17304b14a361`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `575f3d3dbac652288d7954b498bb17304b14a361`
- Gałąź review: `review-integration`
- Run: `20260728-015729-n2hub-282-kanban-touch-keyboard`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `openwiki/n2hub/ui-navigation-and-onboarding.md`
- `src/components/icons.ts`
- `src/pages/KanbanPage.tsx`
- `src/pages/kanbanBoard.ts`
- `src/styles.css`
- `handoffs/packages/PKG-20260728-kanban-touch-keyboard.md`
- `handoffs/scheduler-reviews/20260728-015729-n2hub-282-kanban-touch-keyboard.md`
- `src/pages/kanbanMove.test.ts`
- `src/pages/kanbanMove.ts`
