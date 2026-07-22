# Raport workflow: 20260722-134519-n2hub-253-calendar-dnd-snap

## Wykonane

Workflow tier: analiza orkiestratora → `developer` → `reviewer` (approve).

**Analiza wstępna (czy problem nadal występuje):** tak, wszystkie trzy objawy
były obecne w bieżącym buildzie.

**Diagnoza punktu przyczepienia (zad. 1):**

1. Przeciąganie karty z zasobnika na siatkę (`BinCard.projectPointer` w
   `src/components/WeekView.tsx`): slot docelowy liczony był z surowej pozycji
   kursora (`clientY − gridRect.top`), podczas gdy widoczny ghost karty rysuje
   górną krawędź na `clientY − grabY`. Rozjazd równy offsetowi chwytu — karta
   „wskazywała” inny slot niż ten, w który faktycznie trafiał drop. Hipoteza
   użytkowników potwierdzona.
2. Brak jakiegokolwiek podświetlenia slotu docelowego w kolumnie dnia — jedyny
   feedback to czerwony tint samego ghosta, stąd wrażenie braku magnetycznego
   przyciągania i „niespójnego podświetlenia”.
3. Karta ściągana do zasobnika znikała, bo przeciągany `.week-block` jest
   pozycjonowany wewnątrz `.week-days-viewport` z `overflow: auto` — clipping na
   krawędzi siatki; `z-index` nie pomaga przeciw overflow.
4. Przesuwanie bloku w obrębie siatki (TimedBlock move/resize) było poprawne
   (delta od pozycji startowej) — nietknięte.

**Naprawa (zad. 2–4), wyłącznie warstwa DnD/UX:**

- `src/utils/time.ts` — nowa czysta funkcja
  `dropStartFromAnchor(anchorOffsetPx, pxPerHour, durationMin)`: magnetyczne
  przyciąganie do najbliższego kwadransa + clamp, by blok mieścił się w dobie;
  guardy na niepoprawną geometrię (→ 0).
- `src/components/WeekView.tsx` — `BinCard.projectPointer` mapuje slot pionowo
  od **góry karty-ducha** (`clientY − grabY`); wybór kolumny (elementFromPoint +
  fallback po prostokątach), guard scrollbara, kolizje i cykl listenerów bajt w
  bajt bez zmian. Dodany prezentacyjny podgląd slotu `.week-drop-preview`
  (portal do docelowej `.week-day-col`) o dokładnie tej geometrii, którą
  dostanie dispatch — „co widzisz = tam wyląduje”; czerwony przy kolizji;
  `pointer-events: none`, niewidoczny dla hit-testu. `TimedBlock` przy
  `mode==='move' && overBin` renderuje dodatkowo stały portal-ghost
  (`.week-drag-ghost`, `document.body`, z-index 1000) — karta jest widoczna nad
  panelem zasobnika podczas ściągania.
- `src/styles.css` — reguły `.week-drop-preview` (+`.colliding`) i
  `.week-drag-ghost`.
- `src/utils/time.test.ts` — testy jednostkowe mapowania pozycja→slot:
  wartości on-grid, granica magnesu (+9 px / +12 px przy 84 px/h → 480 vs 495),
  clamp końca doby z czasem trwania, ujemna kotwica, niepoprawna geometria,
  off-grid duration.

Bez zmian: reducery/AppStore, payloady `SET_BLOCK_TIME`/`MOVE_BLOCK_TO_BIN`,
`blockCollides`, packing, free-slot search, pointer capture/cancel, hit-test
kolumn (invariant 7), skrypty browser-check. Brak nowych zależności i nowych
stringów UI.

## Zmiany

- `src/utils/time.ts` — nowa czysta funkcja `dropStartFromAnchor`.
- `src/utils/time.test.ts` — nowy blok testów `dropStartFromAnchor`.
- `src/components/WeekView.tsx` — kotwica dropu z zasobnika = góra karty;
  podgląd slotu docelowego; portal-ghost bloku nad zasobnikiem.
- `src/styles.css` — style `.week-drop-preview` i `.week-drag-ghost`.

## Weryfikacja

- Worker: `npx vitest run src/utils/time.test.ts` — 51 pass / 0 fail.
- Worker: `npm test` — 52 pliki, 1365 testów, wszystkie zielone.
- Worker: `npm run build` (`tsc --noEmit` + `vite build`) — zielony.
- Reviewer (read-only): **approve**, 0 blockerów; potwierdził niezmieniony
  cykl życia wskaźnika i hit-test (invariant 7), zgodność geometrii
  podgląd = drop = wejście kolizji oraz realność asercji testowych; powtórzył
  testy z tym samym wynikiem.
- Wiki: **wiki unchanged** — granice (WeekView = interakcja siatki, time.ts =
  czyste obliczenia) i opisane inwarianty pozostają dokładne; nowa funkcja
  mieści się w istniejącej granicy time.ts.
- Gate (`npm test && npm run build`): oczekuje na scheduler

## Ryzyka / rzeczy do sprawdzenia

- Niskie: `.week-drop-preview` jest portalowany do żywego węzła
  `.week-day-col` zarządzanego przez React — wzorzec wspierany, kontener
  stabilny w trakcie dragu (7 stałych kolumn; `setLiveSyncHold` wstrzymuje
  odświeżenie w tle podczas przeciągania), znika razem z wyczyszczeniem stanu
  dragu na każdej ścieżce cancel/finish.
- Kosmetyka (nieblokujące, od reviewera): klasa `to-bin` na portal-ghoście nie
  ma dedykowanej reguły CSS (nieszkodliwe); `dropStartFromAnchor` nie strzeże
  `durationMin <= 0`, ale jedyny caller ma guard `unplaceable` przed wywołaniem.
- Zachowanie przy realnym dragu myszą warto potwierdzić w ramach release
  verification (browser matrix); zmiana nie dotyka scenariuszy
  `browser-check-bin-drag/bin-split/placement`.

## Podpis schedulera

- Run: `20260722-134519-n2hub-253-calendar-dnd-snap`
- Prompt: `253-calendar-dnd-snap.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `c15fd3fe004075128a233e48f92817d52630b274`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `c15fd3fe004075128a233e48f92817d52630b274`
- Gałąź review: `review-integration`
- Run: `20260722-134519-n2hub-253-calendar-dnd-snap`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `src/components/WeekView.tsx`
- `src/styles.css`
- `src/utils/time.test.ts`
- `src/utils/time.ts`
- `handoffs/scheduler-reviews/20260722-134519-n2hub-253-calendar-dnd-snap.md`
