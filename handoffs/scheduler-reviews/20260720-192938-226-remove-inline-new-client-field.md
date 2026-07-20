# Raport workflow: 20260720-192938-226-remove-inline-new-client-field

## Wykonane

Zadanie było nadal aktualne: formularz tworzenia projektu wciąż zawierał opcję
„— nowy klient —" oraz warunkowe pole „Nazwa nowego klienta", a reducer
`SAVE_PROJECT` obsługiwał atomową ścieżkę tworzenia klienta przez parametr
`newClientName`. Zgodnie ze zgłoszeniem Zuzanny tworzenie klientów odbywa się
teraz WYŁĄCZNIE w module Klienci:

1. **`src/pages/ProjectsPage.tsx`** — usunięty stan `newClientName`, opcja
   „— nowy klient —" (zastąpiona placeholderem „— wybierz klienta —") i cały
   blok pola „Nazwa nowego klienta". Select listuje tylko aktywnych
   (niezarchiwizowanych) klientów; gdy nie ma żadnego, pod selektem pojawia się
   podpowiedź „Najpierw dodaj klienta w zakładce Klienci" z linkiem do
   `/clients`. „Klient *" pozostaje wymagany — brak wyboru daje błąd
   „Wybierz klienta" i formularz nie wysyła akcji.
2. **`src/store/AppStore.tsx`** — usunięta martwa ścieżka tworzenia klienta z
   przepływu zapisu projektu: `newClientName` zniknął z typu akcji
   `SAVE_PROJECT`, sygnatury `saveProject` i z ciała handlera (blok atomowego
   create/reuse klienta). Jedyną ścieżką tworzenia klienta pozostaje
   `ADD_CLIENT` (ClientsPage / AdminPage — nietknięte).
3. **`src/store/commandValidation.ts`** — `isValidProjectDraft` bez parametru
   `newClientName`; przy tworzeniu `clientId` musi wskazywać istniejącego
   klienta, przy edycji niezmieniony „osierocony" `clientId` (legacy orphan)
   pozostaje dopuszczalny. Nieprawidłowy draft nadal zwraca poprzednią
   referencję stanu.
4. **`src/store/commandValidation.test.ts`** — trzy testy ścieżki
   `newClientName` przekształcone bez zmiany liczby testów: create z pustym
   `clientId` → odrzucenie; edycja przełączająca na pusty `clientId` →
   odrzucenie; create z istniejącym `clientId` → sukces bez dodania klienta
   (`next.clients` pozostaje tą samą referencją).

`ClientsPage.tsx` nie był modyfikowany (zgodnie z ograniczeniem).
`wiki unchanged` — żadna strona `openwiki/` nie opisuje usuniętej ścieżki ani
formularza tworzenia projektu (zweryfikowane grepem).

## Zmiany

- `src/pages/ProjectsPage.tsx`
- `src/store/AppStore.tsx`
- `src/store/commandValidation.ts`
- `src/store/commandValidation.test.ts`

## Weryfikacja

- `npm test`: **941/941 zielone** (33 pliki testowe). Liczba 933 z treści
  zadania była aktualna w chwili jego pisania; suite urósł o testy zadań
  224/225.
- `npm run build`: **zielony** (jedynie istniejące wcześniej ostrzeżenie o
  rozmiarze chunków >500 kB).
- Grep: brak pozostałych referencji `newClientName` w `src/`; frazy „Nazwa
  nowego klienta" w `AdminPage.tsx` to legalna ścieżka `ADD_CLIENT` panelu
  administracyjnego.

## Ryzyka / rzeczy do sprawdzenia

- Zmiana typu akcji `SAVE_PROJECT` jest łamiąca dla ewentualnych dispatchy z
  `newClientName`, ale jedynym nadawcą był formularz w `ProjectsPage`;
  `ProjectDetailPage` nigdy tego pola nie przekazywał (potwierdzone grepem).
- Edycja projektu z niezmienionym wiszącym `clientId` (legacy orphan) działa
  bez regresji — pokryta istniejącym testem „SAVE_PROJECT edit of the orphan
  project…".
- Poza tym: Brak.

## Podpis schedulera

- Run: `20260720-192938-226-remove-inline-new-client-field`
- Prompt: `226-remove-inline-new-client-field.md`
- Gałąź review: `review-integration`
- Baza: `16534a51e657d114e4be82b535db8e7440660a80`


## Gate schedulera

- `npm test`: zaliczone
- `npm run build`: zaliczone
- Baza: `16534a51e657d114e4be82b535db8e7440660a80`
- Gałąź review: `review-integration`
- Run: `20260720-192938-226-remove-inline-new-client-field`

### Pliki zgłoszone do review

- `src/pages/ProjectsPage.tsx`
- `src/store/AppStore.tsx`
- `src/store/commandValidation.test.ts`
- `src/store/commandValidation.ts`
- `handoffs/scheduler-reviews/20260720-192938-226-remove-inline-new-client-field.md`
