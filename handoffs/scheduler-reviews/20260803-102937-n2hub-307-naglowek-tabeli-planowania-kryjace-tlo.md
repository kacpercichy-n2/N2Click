# Raport workflow: 20260803-102937-n2hub-307-naglowek-tabeli-planowania-kryjace-tlo

## Wykonane

Problem był nadal aktualny: `.alloc-grid thead th` w `src/styles.css` miał
`background: rgba(255, 255, 255, 0.04)`, więc przy przewijaniu siatki
przydziału w modalu zadania wiersze prześwitywały pod sticky nagłówkiem.
Poprawka czysto stylistyczna, tylko w `src/styles.css` (zero zmian w TSX,
stanie i logice):

1. **Kryjące tło** — nagłówek dostał `background: var(--n2-panel-soft)`
   (#29282f, istniejący token, ten sam co nagłówek modala). Wybór
   nieprzypadkowy: złożenie półprzezroczystego `--card-bg` (4% bieli) na
   `--n2-panel` (#202024) karty modala daje wizualnie ≈#29292d, czyli
   praktycznie dokładnie `--n2-panel-soft` — kolor nagłówka się nie zmienia,
   znika tylko prześwit. Bez nowego hardkodu.
2. **Krawędź oddzielająca** — przy `border-collapse: collapse` krawędzie
   komórek w Chrome nie jadą ze sticky nagłówkiem, więc dolna krawędź jest
   zagwarantowana jako `box-shadow: inset 0 -1px 0 var(--n2-border)`
   (podróżuje z komórką i czytelnie oddziela nagłówek od treści).
3. **Kolejność malowania** — kryjące tło ujawniłoby dwa dotąd niewidoczne
   nachodzenia sticky-elementów (malowanie w kolejności DOM): etykiety dni z
   `tbody` (sticky left) malowałyby się nad nagłówkiem przy przewijaniu w
   pionie, a komórki nagłówka nad narożnikiem przy przewijaniu w poziomie.
   Dodano `z-index: 2` na `thead th` i `z-index: 3` na narożniku
   `thead .alloc-day-col` (sticky top+left).

Kontrast tekstu nagłówka zachowany: `--n2-text-muted` na #29282f daje ~4,6:1
(powyżej WCAG AA 4,5:1) — tyle samo, ile dawało dotychczasowe złożenie
warstw. Selektor `.alloc-grid thead th` (0,1,2) wygrywa z `.alloc-day-col`
i `.alloc-total-col` (0,1,0), więc wszystkie komórki nagłówka — łącznie z
narożnikiem „Dzień" i kolumną „Suma dnia" — dostają kryjące tło bez
dodatkowych reguł. Tryb retirement pozostaje wyłączony.

## Zmiany

- `src/styles.css` — blok `.alloc-grid thead th` (tło, box-shadow, z-index)
  plus nowa reguła `.alloc-grid thead .alloc-day-col { z-index: 3; }`.

## Weryfikacja

- `npm test` — 107 plików, 2243 testy, wszystkie zielone, bez regresji.
- `npm run build` — zielony (build w 3,1 s).
- Gate (`npm test && npm run build`): oczekuje na scheduler

## Ryzyka / rzeczy do sprawdzenia

- Siatka renderuje się też na stronie Obciążenia (`WorkloadPage`), gdzie leży
  bezpośrednio na ciemniejszym tle strony — tam nagłówek będzie odrobinę
  jaśniejszy od reszty tabeli i będzie czytał się jako lekko uniesiony pasek
  (spójnie z konwencją `--n2-panel-soft`). W trybie strony kontener nie
  przewija się w pionie, więc prześwit tam nigdy nie występował; zmiana jest
  tam czysto kosmetyczna.
- Sticky-left kolumna dni w `tbody` (`.alloc-day-label`) nadal ma
  półprzezroczyste tło — przy przewijaniu w POZIOMIE komórki prześwitują pod
  etykietami dni tak jak dotychczas. To osobny, wcześniej istniejący problem,
  poza zakresem tego zadania (obejmowało wyłącznie `thead th`).
- Wiki: unchanged — zmiana nie dotyka żadnej granicy, inwariantu ani trasy
  testowej opisanej w wiki.

## Podpis schedulera

- Run: `20260803-102937-n2hub-307-naglowek-tabeli-planowania-kryjace-tlo`
- Prompt: `307-naglowek-tabeli-planowania-kryjace-tlo.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `5c5c2e66f35f8ddd541850503647fde0b4133ce4`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `5c5c2e66f35f8ddd541850503647fde0b4133ce4`
- Gałąź review: `review-integration`
- Run: `20260803-102937-n2hub-307-naglowek-tabeli-planowania-kryjace-tlo`

### Pliki zgłoszone do review

- `src/styles.css`
- `handoffs/scheduler-reviews/20260803-102937-n2hub-307-naglowek-tabeli-planowania-kryjace-tlo.md`
