# Jedzenie: zamówienia pracownicze (2026-08-26)

Pracownicy zamawiają jutrzejszy posiłek z cateringu Błogość w cenie
pracowniczej. Zamówienie trafia do wybranego kierowcy jako zadanie w jego
aplikacji (BłogoSELL), które przyjmuje albo odrzuca. Trasa `/jedzenie`, pozycja
menu „Jedzenie" (ikona `Utensils`), widoczna dla każdej roli.

## Boundaries

- Backend to schemat `blogoapp` TEGO SAMEGO projektu Supabase (N2Hub). N2click
  nie ma tam żadnej tabeli ani migracji; źródło prawdy kontraktu leży w repo
  BłogoSELL: `supabase/migrations/20260826120000_blogoapp_driver_tasks.sql`,
  sekcja 6 „Bramka zamówień pracowniczych". Zmiana kontraktu = zmiana tamtej
  migracji + tego pliku + `src/food/foodData.ts`.
- Dostęp WYŁĄCZNIE przez RPC nadane roli `authenticated`, wołane jako
  `getSupabaseClient().schema('blogoapp').rpc(...)`. Główny klient zostaje
  przypięty do `n2click`; `schema()` przepina tylko zapytania adaptera, więc
  NIE powstaje drugi `createClient` (wzorzec `createSupabaseContentPlanDb`).
- `src/food/foodData.ts` to jedyne miejsce, które zna SDK (`createSupabaseFoodDb`
  nad wstrzykiwanym `FoodDb.rpc`). Mapowanie jsonb jest łagodne (zepsuta
  pozycja albo zamówienie odpada, nigdy nie rzuca), a polskie komunikaty
  `raise exception` z bazy idą do użytkownika bez zmian.
- `src/food/foodModel.ts` to czysty model: domyślna data (jutro; sobota
  przeskakuje na poniedziałek), kwoty w PLN (`formatPln`, `orderTotal`,
  `cartTotal`), etykiety statusów, koszyk (`buildOrderLines`, `clampQty`
  0..10, `canPlaceOrder`), sortowanie i upsert listy zamówień.
- Strona `src/pages/FoodPage.tsx` jest cienkim okablowaniem; nie dotyka
  reduktora ani localStorage. Nazwa zleceniodawcy: osoba ze store
  (`currentUser`), w zapasie e-mail sesji. Bez sesji chmury (`auth.mode`
  różne od `supabase` albo brak `session`) renderuje wyłącznie pusty stan.
- Ceny liczy BAZA. Suma w formularzu to podgląd; linie zamówienia dostają
  cenę pracowniczą po stronie serwera. Napoje są poza rabatem, więc bramka
  ich nie oferuje.

## Kontrakt RPC (schemat `blogoapp`)

| RPC | Zwraca |
| --- | --- |
| `food_menu_for_date(p_date date)` | `{date, published, employee_discount_percent, items: [{dish_id, name, category, category_label, price, employee_price}]}`, pozycje posortowane po kategorii |
| `food_order_drivers()` | `[{id, full_name}]` aktywni kierowcy |
| `place_food_order(p_for_date, p_driver_id, p_lines [{dish_id, qty}], p_note, p_requester_name, p_app = 'n2click')` | jsonb zadania; polskie wyjątki przy złym wejściu (data wstecz, nieaktywny kierowca, pusta lista, menu nieopublikowane, pozycja spoza menu, qty poza 1..50) |
| `my_food_orders(p_from date)` | tablica własnych zamówień `{id, kind, title, body, for_date, lines, status, accepted_by, accepted_by_name, accepted_at, responses: [{driver_name, response, note, responded_at}], created_at}`; `p_from = null` = ostatnie 7 dni i dalej |
| `cancel_driver_task(p_task_id uuid)` | jsonb zadania; tylko status `open` i tylko zleceniodawca (albo biuro) |

Statusy: `open` (Czeka na kierowcę), `accepted` (Przyjął: <imię>), `rejected`
(Odrzucone), `cancelled` (Anulowane), `done` (Zrealizowane).

## UI

Nagłówek: poprzedni/następny dzień + `input[type=date]` (min = dziś).
Menu pogrupowane po `category_label`: cena pełna przekreślona, pracownicza
pogrubiona, stepper 0..10. Brak publikacji = pusty stan „Menu na ten dzień nie
jest jeszcze opublikowane". Formularz: kierowca (select), uwagi, suma, „Zamów"
(aktywny od jednej linii i kierowcy). Po sukcesie koszyk się czyści, a nowe
zamówienie ląduje u góry listy „Moje zamówienia"; otwarte można anulować przez
wspólny `useConfirm()`. Style: sekcja `.food-*` na końcu `styles.css`
(reużywa `.editor-section`, `.field`, `.btn`, `.empty-state`).

## Relevant tests

`src/food/foodModel.test.ts` (data domyślna, kwoty, statusy, koszyk, sortowanie),
`src/food/foodData.test.ts` (nazwy i argumenty RPC na atrapie `FoodDb`,
łagodne mapowanie, polskie błędy z bazy).
