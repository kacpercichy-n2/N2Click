# Raport workflow: 20260803-114641-n2hub-310-modale-wykorzystanie-przestrzeni

## Wykonane

Workflow tier: `developer → reviewer` (jedna granica prezentacyjna: warstwa stylów modali). Audyt potwierdził, że zgłoszenie nadal dotyczy bieżącego buildu: wszystkie modale współdzieliły `.task-modal-card` ze sztywnym `max-width: 980px`, a pola opisu/dyskusji miały stałe, ciasne wysokości (`rows={3}`/`rows={6}`).

Audyt per modal (duże viewporty):

- **TaskModal** (`.task-modal-card`, 980px): wąski pasek na 2560/4K (ok. 38% szerokości), opis ~85px w karcie do 88dvh.
- **EventModal** (współdzielił `.ticket-modal-card`, 720px): najszerszy formularz po TaskModalu (daty, godziny, lokalizacja, cykliczność) łamał wiersze pól już przy 720px.
- **TicketModal** (720px): opis pełnej szerokości, karta nigdy nie rosła.
- **ChangelogModal** (760px): powierzchnia do czytania, lekko niedowymiarowana.
- **QuickAddModal** (420px) i **ConfirmProvider** (`min(92vw, 460px)`): poprawne — celowo pozostawione małe (alert dialog nie może się rozdąć); dodano komentarze utrwalające tę decyzję.
- **GlobalSearch** (pełnoekranowy overlay z runu 303) i **FilterPanel** (portal sheet z runu 289): własne klasy, poza zakresem, nietknięte.

Zmiany:

1. **Skala szerokości modali** (`src/styles.css`): `.task-modal-card` → `max-width: clamp(980px, 76vw, 1360px)`; nowa klasa `.event-modal-card` → `clamp(720px, 64vw, 1160px)`; `.ticket-modal-card` → `clamp(720px, 52vw, 960px)`; `.changelog-modal-card` → `clamp(760px, 48vw, 940px)`. Dolna granica każdego `clamp()` równa się starej stałej, więc na małych i średnich ekranach szerokości są identyczne jak przed zmianą; górne limity zapobiegają rozciąganiu od krawędzi do krawędzi na 4K. Sufit wysokości `max-height: 88dvh` pozostał bez zmian.
2. **Auto-rosnące pola tekstowe** (`src/styles.css:1361-1377`): nowy blok `@media (min-width: 761px)` z `field-sizing: content; min-height: 10rem; max-height: 40vh; overflow-y: auto` dla textarea w `.task-modal-body`, `.editor-section` i `.project-create`; osobny próg `7rem/34vh` dla `.comment-form textarea` (dyskusja). Rozwiązanie CSS-first, bez JS (zero nowych refów/handlerów), zgodnie z porównaniem dwóch źródeł pierwotnych: MDN `field-sizing` (zalecane parowanie z `min-*`/`max-*`, Baseline od 06.2026) i CSS Form Control Styling Level 1 §7.1 (normatywne zachowanie `content`). Fallback dla starszych przeglądarek: `min-height` daje ten sam rozmiar startowy, `rows` w JSX i globalne `resize: vertical` pozostają.
3. **EventModal** (`src/components/EventModal.tsx:279`): zamiana klasy `ticket-modal-card` → `event-modal-card` — jedyna zmiana poza CSS, wyłącznie nazwa klasy (`.ticket-modal-card` wnosił dokładnie jedną deklarację `max-width`, więc EventModal niczego nie traci).

Mobile (≤760px) nietknięte konstrukcyjnie: blok textarea jest gated na `min-width: 761px`, dolne granice clamp() równe starym stałym, pełnoekranowe zachowanie modali i `--n2-kb-inset` bez zmian.

## Zmiany

- `src/styles.css` — skala szerokości modali (clamp), blok auto-rosnących textarea, komentarze dokumentujące decyzje.
- `src/components/EventModal.tsx` — zamiana klasy karty na `event-modal-card` (tylko className).

## Weryfikacja

- `npm test`: zielony, 107 plików / 2337 testów.
- `npm run build`: zielony; potwierdzono, że `field-sizing: content` i wartości `clamp()` przechodzą do `dist/assets/*.css`.
- Review (agent reviewer, read-only): **approve**, bez blockerów. Zweryfikowano zakres diffu (tylko style + jedna klasa), kaskadę mobile (blok fullscreen ≤760px bit-identyczny), zgodność dolnych granic clamp() ze starymi stałymi, zachowanie fallbacków textarea, brak em-dash w stringach UI, brak nowych zależności i z-index.
- Wiki: **unchanged** — `frontend-performance-and-primitives.md` opisuje kontrakt powłoki modala (stos, Escape, jedyny scroller `.task-modal-body`, scrim), nic z tego się nie zmieniło; szerokości kart nie były nigdzie w wiki udokumentowane.
- Gate (`npm test && npm run build`): oczekuje na scheduler

## Ryzyka / rzeczy do sprawdzenia

- Playwright nie jest zainstalowany w tym worktree — brak przebiegu przeglądarkowego; zmiana jest wyłącznie stylowa (bez ścieżek pointer/keyboard), ale wizualna weryfikacja na 1920 i 2560 należy do weryfikacji wydania.
- Selektory `.editor-section`/`.project-create` obejmują też formularze stron (opis projektu na ProjectDetailPage, notatki klienta na ClientsPage) — te pola również zyskują auto-wzrost na desktopie; spójne z celem zadania, bez wpływu na mobile.
- Przy nowym suficie 1360px pojedyncze selecty/daty w `.field-row` robią się szerokie (~430-630px). Nie jest to defekt; ewentualny cap `max-width` na krótkich kontrolkach to follow-up (nie dodano, bo `.field-row` jest globalny i zmiana promieniowałaby na wszystkie strony).
- Drobna nieścisłość raportu developera wychwycona w review: `.event-modal-card` zaczyna się poszerzać od ~1125px (64vw > 720px), nie ~1300px — zamierzone dla nowej klasy, nie regresja.

## Podpis schedulera

- Run: `20260803-114641-n2hub-310-modale-wykorzystanie-przestrzeni`
- Prompt: `310-modale-wykorzystanie-przestrzeni.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `e2692b5f69e41bbfc6f8cb69dae311ff43dacb97`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `e2692b5f69e41bbfc6f8cb69dae311ff43dacb97`
- Gałąź review: `review-integration`
- Run: `20260803-114641-n2hub-310-modale-wykorzystanie-przestrzeni`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `src/components/EventModal.tsx`
- `src/styles.css`
- `handoffs/scheduler-reviews/20260803-114641-n2hub-310-modale-wykorzystanie-przestrzeni.md`
