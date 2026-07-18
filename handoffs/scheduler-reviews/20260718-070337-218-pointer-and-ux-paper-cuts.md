# Raport workflow: 20260718-070337-218-pointer-and-ux-paper-cuts

## Wykonane

Trasa TierWorkflow: `developer → reviewer` (prompt gotowy, bez architekta; testy
nierozdzielne od implementacji — jeden worker). Zamknięto siedem zweryfikowanych
usterek interakcji, zmiany minimalne i addytywne, bez refaktoru architektury
drag:

1. **WeekView — bin drop tylko lewym przyciskiem**: zwolnienie prawego/środkowego
   przycisku (`pointerup` i fallback `mouseup`) przechodzi teraz przez istniejącą
   ścieżkę `cancelDrag()` zamiast zatwierdzać upuszczenie; commit wykonuje tylko
   `button === 0`. Sprzątanie window-owned (pointerup/cancel/blur/Escape/
   visibility, synchroniczne refy, hit-testing po wyrenderowanych kolumnach)
   nietknięte.
2. **WeekView — „Wstaw” nie no-opuje po cichu**: formularz wstawiania wykrywa
   odrzucenie `spansInsertPoint` (lustrzany helper `insertPointInsideBlock`,
   zgodny 1:1 z predykatem reduktora) i pokazuje polski komunikat, wyłączając
   przycisk „Wstaw” — ten sam wzorzec co pozostałe odrzucenia w tym pliku.
   Reduktor bez zmian.
3. **WeekView — klik w kartę bina nie ginie od 1px jittera**: ścieżka karty bina
   używa teraz progu ruchu `exceedsDragThreshold` (3px, jak TimedBlock); klik
   poniżej progu zachowuje semantykę kliknięcia.
4. **WeekView — limit 92 dni z feedbackiem**: przeciągnięcie poszerzające okres
   zadania ponad 92 dni cofa blok i pokazuje ten sam wzorzec feedbacku co
   odrzucenie kolizyjne (klasa `colliding` + polski tooltip). Helper
   `widenExceedsCap` odwzorowuje strażnika reduktora; sam reduktor bez zmian.
5. **WeekView — wyczyszczone pole daty ≠ BIN**: pusta wartość inputu daty jest
   traktowana jako nieprawidłowa (`isDayGridDate`), a nie jako sentinel bina
   `''`; przenoszenie do bina (wyłącznie drag/`overBin`) działa bez zmian.
6. **TimelinePage — sprzątanie po przerwanym dragu**: pasek i znacznik kamienia
   milowego obsługują `pointercancel`, a podczas trwającego draga także
   `blur`/`visibilitychange` (wzorzec z WeekView); przerwany drag dotykowy lub
   zmiana karty resetuje stan wizualny zamiast zostawiać pasek z offsetem.
   Ścieżka commita (`onPointerUp`) nietknięta.
7. **OnboardingRoot — „Nie teraz” per strona**: jedna globalna flaga zastąpiona
   zbiorem w pamięci kluczowanym id modułu (`src/onboarding/hintState.ts`);
   odrzucenie podpowiedzi na jednej stronie nie tłumi podpowiedzi na innych.
   Trwała preferencja „Nie pokazuj ponownie” bez zmian.

Nowe czyste helpery: `isPrimaryPointerButton`, `exceedsDragThreshold`,
`insertPointInsideBlock` (`src/utils/time.ts`), `widenExceedsCap`,
`isDayGridDate` (`src/utils/dates.ts`), `dismissHintFor`/`isHintDismissed`
(`src/onboarding/hintState.ts`).

## Zmiany

- `src/components/WeekView.tsx` — poprawki 1–5 (addytywne, lifecycle wskaźników
  zachowany).
- `src/pages/TimelinePage.tsx` — poprawka 6.
- `src/onboarding/OnboardingRoot.tsx` + nowy `src/onboarding/hintState.ts` —
  poprawka 7.
- `src/utils/time.ts`, `src/utils/dates.ts` — czyste helpery decyzyjne.
- Testy: `src/utils/time.test.ts`, `src/utils/dates.test.ts`, nowy
  `src/onboarding/hintState.test.ts`.

## Weryfikacja

- `npx vitest run src/utils/time.test.ts src/utils/dates.test.ts src/onboarding/hintState.test.ts`: 82 testy, pass.
- `npm test` (worker, pełny): 37 plików, 996 testów, pass.
- `npm run build` (worker): pass.
- Review (tier `reviewer`, read-only): **approved**; predykaty lustrzane zgodne z
  reduktorem, sprzątanie addytywne, testy behawioralne. 3 uwagi non-blocking
  (patrz Ryzyka). Werdykt wiki: `wiki unchanged` — żadna granica, inwariant ani
  trasa testowa w `scheduling-and-calendar.md` / `ui-navigation-and-onboarding.md`
  nie stała się nieaktualna.
- `npm test` / `npm run build`: finalny gate należy do schedulera.

## Ryzyka / rzeczy do sprawdzenia

- Poprawka 6 (TimelinePage) nie ma testu jednostkowego: ścieżka cancel to czysty
  reset stanu wizualnego bez logiki decyzyjnej, a harness testowy jest
  node-only (bez DOM/pointer events). Pokrycie strukturalne przez build i
  parytet z istniejącym wzorcem sprzątania w WeekView; autorytatywnym testem
  lifecycle'u wskaźników pozostają skrypty browser-check w weryfikacji release.
- `widenExceedsCap` sprawdza limit bezwarunkowo, reduktor tylko przy realnym
  poszerzeniu okresu — rozjazd wyłącznie dla hipotetycznego legacy zadania już
  ponad 92 dni (UI nadblokowuje ruch, który reduktor by przyjął). Kierunek
  fail-safe, bez ryzyka danych.
- Ścieżki wskaźników z poprawek 1 i 4 są stability-sensitive (inwariant 7);
  zmiany są addytywne i przeszły review, ale zachowań DOM nie ćwiczy harness
  node — jak wyżej, właścicielem jest matryca browser-check.

## Podpis schedulera

- Run: `20260718-070337-218-pointer-and-ux-paper-cuts`
- Prompt: `218-pointer-and-ux-paper-cuts.md`
- Gałąź review: `review-integration`
- Baza: `6f41023ea1298c2beb831ae0b47917c0a3720461`


## Gate schedulera

- `npm test`: zaliczone
- `npm run build`: zaliczone
- Baza: `6f41023ea1298c2beb831ae0b47917c0a3720461`
- Gałąź review: `review-integration`
- Run: `20260718-070337-218-pointer-and-ux-paper-cuts`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `src/components/WeekView.tsx`
- `src/onboarding/OnboardingRoot.tsx`
- `src/pages/TimelinePage.tsx`
- `src/utils/dates.test.ts`
- `src/utils/dates.ts`
- `src/utils/time.test.ts`
- `src/utils/time.ts`
- `handoffs/scheduler-reviews/20260718-070337-218-pointer-and-ux-paper-cuts.md`
- `src/onboarding/hintState.test.ts`
- `src/onboarding/hintState.ts`
