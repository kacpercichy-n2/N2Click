# Raport workflow: 20260721-002730-232-estimated-time-field-ui

## Wykonane

**Werdykt kroku 1 (weryfikacja): uwaga nadal była aktualna — zadania nie
pomijam.** W bieżącym `TaskModal.tsx` zostały dwa mylące elementy:

- w sekcji „Szczegóły” (wysoko w modalu, w rzędzie z `Projekt` / `Status`) stał
  `<input id="t-est">` z etykietą „Szacowane godziny (suma osób)”. Był
  `readOnly`/`disabled`, ale wizualnie pozostawał zwykłym polem formularza —
  czyli dokładnie ten „pływający, edytowalny input” z notatki „fIXY”. Dublował
  przy tym wiersz „Razem” z sekcji „Przypisane osoby”, stojąc daleko nad nim.
- pasek `.estimate-compare` („zaplanowano … vs szacunek …” + `PlanningBadge`)
  oraz ostrzeżenie `.estimate-over` również kończyły sekcję „Szczegóły”, choć
  porównują liczby, które użytkownik edytuje dopiero niżej, przy osobach.

Zmiany (wyłącznie prezentacyjne):

1. Usunąłem pole `t-est` z sekcji „Szczegóły”. Rząd `field-row` jest flexem,
   więc `Projekt` + `Status` domykają go bez zmian w CSS.
2. Przeniosłem pasek `.estimate-compare`, ostrzeżenie `.estimate-over` oraz
   podpowiedź o poprzednim ręcznym szacunku (`legacyEstimate`) na koniec sekcji
   „Przypisane osoby”, bezpośrednio pod godzinami osób — tam, gdzie powstają
   porównywane liczby.
3. Doprecyzowałem polskie etykiety rozdzielające to, co edytowalne, od tego, co
   wyliczane:
   - podpowiedź nad wierszami osób: „Edytujesz godziny każdej osoby na tym
     zadaniu (sprzedane). Szacunek zadania to ich suma — wylicza się sam, nie ma
     osobnego pola.”;
   - wiersz sumy: „Szacunek zadania (suma godzin osób): X — wyliczany” (dawniej
     samo „Razem: X”);
   - w pasku porównania „zaplanowano” → „w kalendarzu”, spójnie z metadanymi
     przy każdej osobie („w kalendarzu … • zasobnik …”).

Model sprzedanych godzin, `normalizedEstimate`, `binTargets` i semantyka
`SAVE_TASK` pozostały nietknięte — zmienił się wyłącznie JSX renderujący te same
wartości. CSS bez zmian (klasy `.estimate-compare`, `.estimate-over`,
`.sold-hours-total` działają w nowym miejscu).

## Zmiany

- `src/components/TaskModal.tsx` — usunięcie pola `t-est`, przeniesienie paska
  porównania / ostrzeżenia / podpowiedzi o starym szacunku do sekcji „Przypisane
  osoby”, doprecyzowanie etykiet.

## Weryfikacja

- `npm test`: **zielone** — 39 plików, 1036 testów.
  (Prompt zapowiadał 933 testy; na aktualnej `review-integration` jest ich 1036
  po wcześniejszych etapach kolejki. Żaden test nie odwoływał się do `t-est` ani
  do klas `estimate-compare` / `estimate-over`, więc przeniesienie nie wymagało
  korekt w testach.)
- `npm run build`: **zielone** — `tsc --noEmit` + `vite build`, 2633 moduły.
- Checku przeglądarkowego nie uruchamiałem: zmiana nie dotyka interakcji
  kalendarza ani zasobnika, tylko kolejności i copy w modalu.

## Ryzyka / rzeczy do sprawdzenia

- Podpowiedź o poprzednim ręcznym szacunku (dane sprzed przejścia na model
  sprzedanych godzin) pojawia się teraz niżej w modalu, przy osobach, a nie w
  „Szczegółach”. Treść i warunek pokazania są bez zmian.
- Wiersz „Szacunek zadania (suma godzin osób)” renderuje się tylko wtedy, gdy do
  zadania przypisano choć jedną osobę — tak samo jak wcześniejsze „Razem”. Pasek
  porównania renderuje się zawsze, dokładnie jak przed zmianą.
- Wiki bez zmian: żadna granica, inwariant ani trasa testowa opisana w
  `openwiki/n2hub/ui-navigation-and-onboarding.md` nie uległa zmianie — to
  wyłącznie układ i copy wewnątrz `TaskModal`.

## Podpis schedulera

- Run: `20260721-002730-232-estimated-time-field-ui`
- Prompt: `232-estimated-time-field-ui.md`
- Gałąź review: `review-integration`
- Baza: `9893b67c3146f0839b59c9e9c8046939ba5d658c`


## Gate schedulera

- `npm test`: zaliczone
- `npm run build`: zaliczone
- Baza: `9893b67c3146f0839b59c9e9c8046939ba5d658c`
- Gałąź review: `review-integration`
- Run: `20260721-002730-232-estimated-time-field-ui`

### Pliki zgłoszone do review

- `src/components/TaskModal.tsx`
- `handoffs/scheduler-reviews/20260721-002730-232-estimated-time-field-ui.md`
