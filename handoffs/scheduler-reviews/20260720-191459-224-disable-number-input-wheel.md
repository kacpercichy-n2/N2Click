# Raport workflow: 20260720-191459-224-disable-number-input-wheel

## Wykonane

Zadanie było nadal aktualne — w buildzie nie istniała żadna obsługa zdarzeń
`wheel` (grep po całym `src/` nie znalazł nic), a w aplikacji jest 6 pól
`input[type=number]`.

Mechanizm: jeden globalny, delegowany listener `wheel` (capture, pasywny) na
`document`, instalowany raz w `src/main.tsx` przed renderem. Gdy celem scrolla
jest `input[type=number]` mający aktualnie fokus, pole dostaje `blur()` —
przeglądarka zmienia wartość pola liczbowego kółkiem tylko przy fokusie, więc
po zdjęciu fokusu wartość nie zmienia się, a strona przewija się normalnie
(listener pasywny nie blokuje scrolla). Edycja z klawiatury bez zmian.

- `src/utils/numberInputWheel.ts` (nowy) — czysty predykat
  `isFocusedNumberInput` + `installNumberInputWheelGuard` (zwraca funkcję
  sprzątającą).
- `src/main.tsx` — jednorazowa instalacja blokady.
- `src/utils/numberInputWheel.test.ts` (nowy) — 6 testów w środowisku node
  (atrapy DOM, zgodnie z konwencją repo bez jsdom).

Pokryte pola (kompletny sweep — brak dynamicznych `type={...}` na inputach):
`WeekView.tsx` (2× godziny), `TaskModal.tsx` (siatka alokacji / sprzedane
godziny), `AllocationGrid.tsx`, `PersonProfilePage.tsx` (pojemność),
`PeoplePage.tsx`. Delegacja na `document` obejmuje też portale/modale i każde
przyszłe pole liczbowe bez zmian per pole.

## Zmiany

- `src/utils/numberInputWheel.ts` — nowy moduł globalnej blokady.
- `src/utils/numberInputWheel.test.ts` — nowe testy jednostkowe.
- `src/main.tsx` — import i instalacja blokady.

## Weryfikacja

- `npm test`: zielony — 939 testów (933 bazowe + 6 nowych), 33 pliki.
- `npm run build`: zielony (`tsc --noEmit` + Vite build).

## Ryzyka / rzeczy do sprawdzenia

- Podczas scrolla pole traci fokus — to zamierzony i standardowy kompromis
  tego rozwiązania (użytkownik klika ponownie, by dalej edytować); wartość
  nigdy nie zmienia się przypadkiem.
- Wiki unchanged — zmiana nie dotyka granic, inwariantów ani tras testowych
  opisanych w openwiki (jeden globalny listener UI w `main.tsx`).

## Podpis schedulera

- Run: `20260720-191459-224-disable-number-input-wheel`
- Prompt: `224-disable-number-input-wheel.md`
- Gałąź review: `review-integration`
- Baza: `69b58d337f4f79d0f33480d1b41b71690f565ebf`


## Gate schedulera

- `npm test`: zaliczone
- `npm run build`: zaliczone
- Baza: `69b58d337f4f79d0f33480d1b41b71690f565ebf`
- Gałąź review: `review-integration`
- Run: `20260720-191459-224-disable-number-input-wheel`

### Pliki zgłoszone do review

- `src/main.tsx`
- `handoffs/scheduler-reviews/20260720-191459-224-disable-number-input-wheel.md`
- `src/utils/numberInputWheel.test.ts`
- `src/utils/numberInputWheel.ts`
