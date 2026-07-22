# N2Hub — śledztwo: lagi/klatkowanie przy scrollu changelogu (modal „Co nowego")

> Dokument dla kolejnego modelu do dalszej pracy. Zawiera KOMPLET prób
> (nieudanych i tej jednej, która w moim pomiarze zredukowała drop klatek),
> twarde dane i — najważniejsze — **ostrzeżenie, że fix wdrożony na produkcję
> NIE pomógł na realnej maszynie użytkownika**, mimo że mój pomiar pokazywał
> ~100× mniej długich klatek.

Data: 2026-07-22. Ostatni commit z fixem: `375ed73`
(`perf: kompozytowany scroll w modalach`). Poprzednia produkcja (rollback
target): `80a3154`.

---

## 1. Objaw (zgłoszenie użytkownika)

- W kokpicie (Panel/dashboard) otwiera się modal changelogu („Czytaj całość" →
  modal „Co nowego", klasa `.changelog-modal-card`).
- Przy przewijaniu długiej treści changelogu scroll **nie jest smooth** — gubi
  klatki, „zacina się".
- Dzieje się to po „patchu optymalizacyjnym" wdrożonym tego samego dnia.
- **Po wdrożeniu mojego fixa i twardym resecie cache — użytkownik nadal widzi
  lagi na swojej maszynie.** (Mój pomiar w przeglądarce automatyzacji pokazywał
  poprawę — patrz §7 i §9. Rozbieżność jest kluczowa, patrz §10.)

---

## 2. Środowisko i KRYTYCZNE zastrzeżenia pomiarowe

- Aplikacja: Vite 5 / React 18 / TS, plain CSS, `motion` (Framer Motion),
  `lucide-react`. Bez frameworka UI, bez Tailwinda. Deploy: Vercel (projekt
  `n2click`, prod alias `n2click.vercel.app`).
- Testy robiłem przez rozszerzenie „Claude in Chrome" (automatyzacja przeglądarki).
- **ZASTRZEŻENIE 1 — karta w tle:** `document.visibilityState === "hidden"` w
  karcie sterowanej automatyzacją. Skutek: `requestAnimationFrame` jest
  całkowicie throttlowany (0 klatek), a pierwsze pomiary rAF dawały 0 klatek /
  timeout 45 s. **Pomiary oparte na rAF są w tym środowisku nieważne.**
- **ZASTRZEŻENIE 2 — Event Timing zafałszowany:** durationy `pointerenter/leave`
  rzędu 140–190 ms okazały się artefaktem throttlingu paintów w tle, nie realnym
  kosztem (patrz §5, hover finalnie niewinny).
- **ZASTRZEŻENIE 3 (NAJWAŻNIEJSZE) — inny sprzęt niż użytkownika:** przeglądarka
  automatyzacji ma inne okno, potencjalnie inny GPU/rozdzielczość/DPR/flagi
  Chrome niż realna maszyna użytkownika. Mierzone `innerWidth×innerHeight =
  1710×888`, `devicePixelRatio = 2` (Retina). **Poprawa LoAF u mnie ≠ poprawa u
  użytkownika.** Ostatecznie fix u użytkownika nie zadziałał — pomiar autorytatywny
  to trace z DevTools NA MASZYNIE UŻYTKOWNIKA, którego nie mam.
- **ZASTRZEŻENIE 4 — animacja rozszerzenia:** jedyna działająca animacja na
  stronie to `claude-pulse` (wskaźnik rozszerzenia Claude), NIE aplikacja. Może
  wpływać na repainty w MOJEJ karcie, a nie u użytkownika. (Aplikacyjnie
  dashboard jest statyczny — patrz §6.)

---

## 3. Struktura DOM / CSS (fakty)

Łańcuch kontenerów modalu (od kontenera scrolla w górę):

```
.task-modal-body      overflow-y:auto  (KONTENER SCROLLA; scrollH≈4990, clientH≈702, 244 węzły)
  └ .task-modal-card.changelog-modal-card  overflow:hidden; border-radius:28px; box-shadow:0 28px 80px
      └ .task-modal-viewport  position:fixed; z-index:1001; overflow-y:auto   (drugi scroller — zagnieżdżony)
          └ .page (SECTION)   <-- WSZYSTKO poniżej to rodzeństwo w jednym .page:
              ├ .page-head.dash-greeting
              ├ .changelog-bar
              ├ .task-modal-scrim   position:fixed; inset:0; z-index:1000; background:rgba(4,3,8,0.68); backdrop-filter:blur(6px); pointer-events:none
              ├ .task-modal-viewport (modal, 253 węzły)
              └ .dash-grid.dash-welcome-grid  (DASHBOARD, 199 węzłów)  <-- tło pod scrimem
```

Kluczowe pliki/linie (`src/styles.css`):
- `4401` `.task-modal-scrim` — `backdrop-filter: blur(6px)`, tło `rgba(4,3,8,0.68)`, `inset:0`, `pointer-events:none`.
- `4419` `.task-modal-card` — `overflow:hidden`, `box-shadow: var(--n2-shadow-soft)` (≈ `0 28px 80px`), `border-radius`.
- `4474` `.task-modal-body` — `overflow-y:auto` (kontener scrolla; TU trafił fix).
- `107` `--n2-blur-glass: blur(22px) saturate(132%)` — używany m.in. przez `.app-sidebar` (blur(22px), zawsze widoczny).
- Backdrop-filtry AKTYWNE na stronie: **tylko 2** — `.app-sidebar` (blur 22px) + `.task-modal-scrim` (blur 6px). (Skan computed style całego DOM.)
- `.changelog-item` / treść changelogu: **zero** hover, transition, box-shadow, gradientów, filtrów.

Modal jest komponentem `ChangelogModal.tsx` — `AnimatePresence` + `motion.div`
dla scrim/card (animacja tylko wejścia/wyjścia), **brak** scroll-listenerów,
`useScroll`, `useTransform`. Brak `createPortal`. Brak `position:fixed/absolute`
w treści modali (sprawdzone grepem + computed).

---

## 4. Dane bazowe (twarde liczby)

- **Wymuszony reflow (styl+layout):** `~0.14 ms/cykl`. → layout/styl NIE są wąskim
  gardłem.
- **Treść scrolla:** 244 węzły, 0 cieni, 0 gradientów, 0 filtrów. → treść tania.
- **Dashboard (tło):** 199 węzłów, 16 małych cieni (1–10px blur, 0 „dużych"),
  0 gradientów, 2 SVG (donuty „Obciążenie"), 0 filtrów, 0 backdrop-filtrów,
  2 elementy z transformem. → tło TANIE do rasteryzacji.
- **DPR = 2**, viewport `1710×888` → pełnoekranowy blur/blend operuje na ~3420×1776
  px urządzenia.
- **`getAnimations()`:** 1 działająca = `claude-pulse` (rozszerzenie). Aplikacja
  statyczna pod modalem.

---

## 5. Long Animation Frames — dowód wąskiego gardła (stan ORYGINALNY, tnący)

Podczas realnego scrolla kółkiem (`computer scroll`, tło throttluje rAF, ale
realny input produkuje klatki), obserwator `long-animation-frame`:

```
loafCount: 201
wszystkie > 50 ms
maxDur: 192.4 ms   (≈ 5–13 fps)
w KAŻDEJ długiej klatce:  scripts: []   render: ~0   styleLayout: ~0   blocking: 0
```

**Interpretacja:** długość klatki 70–190 ms przy ~0 ms pracy głównego wątku →
główny wątek **czeka**, czas idzie w **kompozytor/GPU (raster+composite) poza
wątkiem głównym**. Wniosek: **scroll nie jest kompozytowany** — Chromium przy
każdej klatce rasteryzuje na nowo duży obszar (cały viewport), bo półprzezroczysty
scrim nad stroną nie pozwala pominąć tego, co pod nim (brak okluzji).

(Wcześniejszy „artefakt": Event Timing `pointerenter/leave` 140–190 ms → to NIE
realny koszt, tylko throttling paintów w tle. Hover finalnie niewinny, §7.)

---

## 6. Bisekcja przyczyny (subiektywne oceny użytkownika „płynnie/tnie")

Metoda: wstrzykiwany `<style id="__perfFix">` z `!important`, użytkownik scrolluje
i ocenia. Stany:

| # | Konfiguracja (co zmienione względem oryginału) | Wynik u użytkownika |
|---|---|---|
| A | Oryginał (scrim blur6 + 0.68, sidebar blur22, cień 0 28 80) | najgorszy lag |
| B | Wyłączony blur scrim + sidebar; scrim `rgba(..,0.82)`; `contain:paint` na body | „~10% lepiej", nadal tnie |
| C | **MAX strip-down:** scrim **nieprzezroczysty** `#0a0910`, blur off, cień off, `pointer-events:none` na treści, `contain:layout paint` | **PŁYNNIE** |
| D | jak C, ale `pointer-events` z powrotem WŁ (hover aktywny) | płynnie → **hover niewinny** |
| E | jak C, ale cień karty z powrotem WŁ | płynnie, „minimalnie czuć początek" → cień prawie niewinny |
| F | jak C, ale scrim znów **półprzezroczysty** `rgba(4,3,8,0.68)` (blur off) | **mocny lag** → scrim-translucency = DOMINANT |

**Wniosek z bisekcji:** dominującym kosztem jest **kompozytowanie
półprzezroczystego pełnoekranowego scrima nad dashboardem** (brak okluzji →
Chromium nie może pominąć tła → drogi re-blend/re-raster co klatkę). Blur ~10%,
cień znikomo. Nieprzezroczysty scrim leczy objaw, bo zasłania tło.

Wizualnie: nieprzezroczysty scrim wygląda niemal identycznie (screenshoty
nieodróżnialne — scrim i tak ma ciemne `0.68` tło), ale użytkownik chce zachować
oryginalny „frosted glass".

---

## 7. Próby, które NIE zadziałały (architektoniczne)

Wszystkie testowane na żywo z PEŁNYM oryginalnym wyglądem (chyba że zaznaczono):

1. **rAF frame-timing** — nieważne (karta w tle, rAF throttlowany). Timeout/0 klatek.
2. **Wyłączenie backdrop-filtrów (scrim+sidebar)** — wizualnie identyczne, ale
   tylko ~10% poprawy → blur to nie sedno.
3. **Fix #1+#2** (scrim bez blura + sidebar blur 22→10px + `contain:paint`) —
   ~10%, dalej tnie.
4. **Izolacja warstw na SCRIMIE+KARCIE** (`transform:translateZ(0)`, `will-change`
   na `.task-modal-scrim` i `.task-modal-card`) — **POGORSZYŁO**. (Promowanie
   elementu z `backdrop-filter` wymusza ponowne próbkowanie tła co klatkę.)
5. **Promocja TŁA** (`.page > .dash-grid`, `.page-head`, `.changelog-bar`:
   `transform:translateZ(0)` + `contain:paint`) — bez poprawy.
6. **Promocja kontenera modalu** (`.task-modal-viewport { transform:translateZ(0) }`
   + `.task-modal-body { contain:layout paint }`) — dalej tnie.
7. **Portal do `<body>`** — fizyczne przeniesienie `.task-modal-scrim` +
   `.task-modal-viewport` z `.page` do `document.body` (są `position:fixed`, więc
   wygląd bez zmian). **Bez poprawy** → to NIE „rodzeństwo z dashboardem".
8. `contain: strict` na `.task-modal-body` — błąd (size-containment zapada
   wysokość do 0); poprawione na `contain: layout paint`.

---

## 8. Próba, która ZADZIAŁAŁA W MOIM POMIARZE (ale nie u użytkownika)

**Zmiana:** promocja **samego kontenera przewijania** na własną warstwę GPU:

```css
/* src/styles.css : .task-modal-body (linia ~4474) */
.task-modal-body {
  padding: var(--n2-space-6);
  overflow-y: auto;
  transform: translateZ(0);   /*  <-- FIX  */
}
```

Różnica względem prób §7 pkt 4/6: warstwa jest na **samym scrollerze**
(`.task-modal-body`), nie na scrimie ani na `.task-modal-viewport`.

**Pomiar (przeglądarka automatyzacji), ten sam gest 15 ticków:**

| | długie klatki >50 ms | max |
|---|---|---|
| oryginał | **201** | 192 ms |
| po `translateZ(0)` na `.task-modal-body` | **~1** (startowa) | 70 ms |

Dwa pełne gesty (35 ticków) = 0 NOWYCH długich klatek poza startową. Wygląd bez
zmian (pełny scrim + blur + cień). Build `npm run build` ✓.

---

## 9. Weryfikacja na produkcji (mój pomiar)

Po `git push` (commit `375ed73`) Vercel zbudował prod (~28 s, READY). Po
hard-reloadzie karty automatyzacji, ten sam gest 15 ticków na
`n2click.vercel.app`:

```
computed transform na .task-modal-body = matrix(1,0,0,1,0,0)  (fix aktywny)
długie klatki >50 ms: 2   (startowe, max 61 ms)   vs 201 w oryginale
```

**ALE:** użytkownik na SWOJEJ maszynie po twardym resecie cache — **nadal lagi.**

---

## 10. Rozbieżność mój-pomiar vs maszyna-użytkownika (do rozpracowania)

To jest sedno dla następnego modelu. Hipotezy, dlaczego fix „zmierzył się
dobrze" u mnie, a nie pomaga u użytkownika:

1. **Inny sprzęt/GPU/sterowniki/flagi Chrome.** Mój pomiar: DPR 2, 1710×888,
   okno automatyzacji. Maszyna użytkownika: nieznana rozdzielczość/DPR/GPU,
   być może większy ekran (więcej pikseli do blendu/blura na klatkę). Koszt
   pełnoekranowego `backdrop-filter: blur(6px)` scrim + `blur(22px)` sidebar
   rośnie z liczbą pikseli. Na 4K/większym oknie może to być dominujące.
2. **`translateZ(0)` na scrollerze nie usuwa realnego kosztu** — usuwa
   re-raster tła TYLKO jeśli sprzęt/kompozytor faktycznie promuje warstwę i
   pomija tło. Na słabszym/innym GPU kompozytor mógł i tak re-rasteryzować
   (LoAF u mnie mógł być „za optymistyczny" z powodu artefaktów tła — patrz
   §2). Możliwe, że mój pomiar był fałszywie pozytywny.
3. **Throttling paintów w karcie w tle** mógł zaniżać liczbę „długich klatek"
   u mnie (mniej wymuszonych klatek → mniej okazji na long-frame).
4. **Sidebar `blur(22px)` (zawsze widoczny)** — nie tknięty przez fix, a to
   najgrubszy blur na stronie; może być realnym, stałym obciążeniem GPU
   niezależnym od scrolla changelogu, bardziej odczuwalnym na sprzęcie
   użytkownika.

---

## 11. Rekomendowane następne kroki (dla kolejnego modelu)

Priorytet: **pomiar NA MASZYNIE UŻYTKOWNIKA**, bo tylko on jest autorytatywny.

1. **Chrome DevTools → Performance**: nagrać scroll changelogu na maszynie
   użytkownika. Sprawdzić: czy klatki są „GPU/raster-bound" (jak mój LoAF), czy
   jednak jest praca JS/layout. Włączyć **Rendering → Paint flashing** i
   **Frame Rendering Stats** — zobaczyć CO się przemalowuje przy scrollu (czy
   cały viewport/dashboard, czy tylko modal).
2. **Sprawdzić „main-thread scrolling reasons"** (DevTools → Rendering, lub
   `chrome://tracing`) dla `.task-modal-body` — potwierdzić/obalić hipotezę
   non-composited scroll na sprzęcie użytkownika.
3. **Sprawdzić akcelerację GPU:** `chrome://gpu` u użytkownika — czy compositing
   jest hardware'owy; blacklisty sterowników potrafią wrzucić raster na CPU
   (co idealnie tłumaczyłoby 70–190 ms/klatka).
4. **Test empiryczny „opaque scrim"** u użytkownika: to JEDYNA rzecz, która w
   bisekcji dała pełną płynność (§6C/F). Jeśli u użytkownika opaque też leczy —
   przyczyną jest koszt pełnoekranowego półprzezroczystego blendu i realny fix
   to: (a) scrim (prawie) nieprzezroczysty, albo (b) **odcięcie tła spod modalu**
   (`content-visibility`/odmontowanie dashboardu, gdy modal otwarty), albo
   (c) drastyczna redukcja/rezygnacja z blura scrima I sidebara.
5. **Zredukować/zdjąć `blur(22px)` z sidebara** (`--n2-blur-glass`, linia 107) i
   `blur(6px)` ze scrima — zmierzyć u użytkownika. Blur to najdroższa operacja
   GPU per-piksel; 22px jest bardzo drogi.
6. **Rozważyć: nie pełnoekranowy scrim.** Zamiast `backdrop-filter` na
   `inset:0`, ograniczyć rozmyty obszar albo użyć statycznego ciemnego tła bez
   backdrop-filter (frosted look można udać gradientem/teksturą bez live-blur).
7. **Uwaga na `.task-modal-viewport` overflow-y:auto + `.task-modal-body`
   overflow-y:auto** — dwa zagnieżdżone scrollery; uprościć do jednego.

---

## 12. Stan repo

- `main` @ `375ed73` — fix `transform: translateZ(0)` na `.task-modal-body`
  (wdrożony na prod, NIE rozwiązał problemu u użytkownika).
- Rollback: Vercel „Instant Rollback" → `80a3154`, lub `git revert 375ed73`.
- Do rozważenia: **revert `375ed73`**, jeśli fix nic nie daje u użytkownika
  (nie chcemy martwego `translateZ` w kodzie bez efektu). Decyzja użytkownika.

---

## 13. Skrót „dla drugiego modelu" (TL;DR)

- Objaw: klatkowanie przy scrollu modalu changelogu, tylko u nas.
- Zmierzone (u mnie): layout/JS/paint-record ≈ 0 ms; długość klatki 70–190 ms →
  **GPU/kompozytor-bound**, **non-composited scroll**, re-raster całego viewportu.
- Bisekcja: **półprzezroczysty pełnoekranowy `.task-modal-scrim` (blur6 + 0.68)
  nad tłem = dominująca przyczyna**; blur sidebara/scrima dokłada; cień/hover ~0.
  Nieprzezroczysty scrim = pełna płynność.
- Nie pomogło: layer-promo scrima/karty/tła/viewportu, portal do body,
  content-visibility, contain.
- „Pomogło" (tylko w moim pomiarze): `transform: translateZ(0)` na
  `.task-modal-body` → LoAF 201→~2. **U użytkownika nie pomogło.**
- Najpewniejszy trop: koszt pełnoekranowego półprzezroczystego blendu +
  `backdrop-filter` blur (scrim 6px + sidebar 22px) na realnym sprzęcie
  użytkownika (inny GPU/DPR/rozmiar okna niż mój pomiar). **Zmierzyć DevTools
  Performance + `chrome://gpu` NA MASZYNIE UŻYTKOWNIKA.** Jeśli opaque scrim
  leczy — iść w stronę okluzji tła / redukcji blura, nie w kolejne `translateZ`.

---

## 14. Research i przebudowa: snapshot zamiast żywego backdropu (2026-07-22)

### Kontekst rozszerzony

Zakres został świadomie rozszerzony tylko o wspólną ramę modali, jej CSS,
zależność do rasteryzacji DOM i ten dokument. Nie otwierano innych stron wiki
ani historycznych handoffów, bo nie są bezpośrednią zależnością renderowania:

- `src/components/ModalFrame.tsx`
- `src/components/modalBackdropSnapshot.ts`
- `src/styles.css`
- `package.json` / `package-lock.json`

### Co faktycznie robią popularne implementacje

1. **Radix Dialog**: `Root → Portal(body) → Overlay → Content`; tło jest inert,
   dokument jest scroll-locked, a przykład długiego dialogu umieszcza Content
   wewnątrz jednego scrollowalnego Overlay. Przykład używa zwykłego
   `rgba(0 0 0 / .5)`, bez blura.
   Źródło: https://www.radix-ui.com/primitives/docs/components/dialog
2. **Material UI Backdrop**: pojedyncza przyciemniona warstwa; domyślnie Fade.
   Dokumentacja nie obiecuje wydajnego pełnoekranowego frosted glass.
   Źródło: https://mui.com/material-ui/react-backdrop/
3. **Przeglądarki**: `backdrop-filter` działa na pikselach już namalowanych za
   elementem. Blur jest kosztowną operacją paint/raster, szczególnie na dużych
   powierzchniach. Źródła:
   - https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/backdrop-filter
   - https://web.dev/articles/animations-guide
4. **Potwierdzenie z praktyki**: VitePress odnotował ok. 30% poprawę FPS po
   wyłączeniu blur na przewijanej stronie i ostatecznie usunął ten efekt;
   problem rośnie na ekranach 4K.
   Źródło: https://github.com/vuejs/vitepress/issues/1049
5. **Raporty modalowe**: ten sam problem z `backdrop-filter` i dropami FPS jest
   zgłaszany dla modali. Praktyczne obejścia to filtr na oddzielonym root albo
   gotowy obraz zamiast live blur. Pierwszy wariant w N2Hub również lagował,
   dlatego pozostał wariant rastrowy.
   Źródła:
   - https://stackoverflow.com/questions/58033230/css-backdrop-filter-too-slow
   - https://stackoverflow.com/questions/61785743/how-to-animate-backdrop-filter
6. **Rasteryzacja DOM**: `html2canvas` tworzy Canvas przez odczyt DOM i stylów;
   pozwala ograniczyć szerokość, wysokość i skalę oraz wykluczyć elementy.
   Ma ograniczenia CSS/CORS, więc błędny capture musi mieć bezpieczny fallback.
   Źródła:
   - https://html2canvas.hertzen.com/configuration
   - https://html2canvas.hertzen.com/faq/

### Różnica: poprzednia wersja a nowa

| Obszar | Poprzednie próby | Nowa wersja testowa |
|---|---|---|
| Tło | aktywny DOM + alpha/backdrop albo `filter` na całym `#root` | jedna bitmapa viewportu |
| Blur/dimming | liczone przez kompozytor na żywej warstwie | wypalone raz przez Canvas 2D |
| Render aplikacji | dashboard pozostawał malowany | `#root { visibility:hidden }` po gotowym snapshotcie |
| Struktura | osobny scrim i viewport | portal + jeden overlay + jedna karta |
| Scroll | wewnętrzny `.task-modal-body` | ten sam pojedynczy scroller, bez drugiego viewport-scrolla |
| Rozdzielczość tła | pełny DPR/viewport | limit 1440×900, bo blur maskuje downscale |
| Awaria capture | brak | nieprzezroczysty gradient zapewniający płynny fallback |

### Inwariant nowej implementacji

Podczas scrolla modala za kartą nie istnieje półprzezroczyste połączenie z
żywym drzewem aplikacji. Warstwy są następujące:

```
body
├── #root                    visibility:hidden po capture; inert
├── .task-modal-snapshot    fixed, opaque
│   └── canvas              gotowy blur + dim, maks. 1440×900
└── .task-modal-viewport    fixed, transparent portal
    └── .task-modal-card
        └── .task-modal-body  jedyny scroll
```

Test lokalny Chrome, viewport 1710×888:

- bitmapa: 1440×747;
- blur bitmapy: 3.5 px equivalent (30% mniej niż pierwszy prototyp), bez
  powiększania snapshotu i bez animacji scale karty;
- `data-modal-backdrop="snapshot"` aktywne;
- `#root` ma `visibility:hidden`;
- dokładnie jeden canvas snapshotu;
- scroll `.task-modal-body`: 0 → 1171 px bez zmiany stanu tła;
- brak błędów i ostrzeżeń konsoli;
- typecheck ✓, 58/58 plików i 1383/1383 testów ✓, build ✓;
- `npm audit --omit=dev`: 0 podatności.

Automatyzacja potwierdza strukturę i brak renderowania aplikacji pod modalem,
ale ostateczna ocena płynności pozostaje po stronie realnej maszyny użytkownika.
