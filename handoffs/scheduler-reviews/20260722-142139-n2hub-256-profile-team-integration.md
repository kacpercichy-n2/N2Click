# Raport workflow: 20260722-142139-n2hub-256-profile-team-integration

## Wykonane

Workflow tier: orchestrator → developer → reviewer (trasa `developer → reviewer`;
jedna granica: strona profilu + moduły polityk z testami). Analiza wstępna
potwierdziła, że wszystkie 4 punkty zadania były nadal aktualne w bieżącym buildzie.

1. **Edycja zintegrowana z profilem** (`src/pages/PersonProfilePage.tsx`):
   usunięty stan `editing` i przycisk „Edytuj profil"/„Zamknij edycję" — profil i
   edycja w jednym panelu. Każde pole renderuje się w miejscu jako input/select,
   gdy `editableProfileFields` na nie pozwala, w przeciwnym razie jako tekst
   read-only („—" dla pustych). „Zapisz profil" widoczny tylko przy niepustym
   zbiorze uprawnień. Semantyka `save()` niezmieniona: pola zablokowane
   merge'owane z bieżącego `person`, nigdy z draftu; walidacje (imię, godziny)
   i sprzężenie stanowisko → rola dostępu (bez degradacji administratora) zachowane.
2. **Uprawnienia wg hierarchii** (`src/pages/profileEditPolicy.ts` + testy):
   reguła managera (pm) zawężona — edytuje wyłącznie **specjalistów**
   (`pracownik`/`handlowiec`) z własnego działu; cele `pm` i `administrator`
   wykluczone (dotąd wykluczony był tylko administrator). Admin bez zmian:
   wszystkie pola, w tym dział oraz imię/nazwisko. Nowa czysta funkcja
   `canViewProfileDetails` (setup / admin / self / pm-własny-dział) gate'uje
   sekcje „Ten tydzień", „Projekty", „Zadania" — specjalista na cudzym profilu
   widzi tylko informacje ogólne, bez edycji. `teamScope.ts` zweryfikowany jako
   zgodny z hierarchią (worker — obszar ukryty, pm — własny dział, admin —
   wszystko) → bez zmian.
3. **Kompaktowe zdjęcie**: wielka sekcja „Zdjęcie profilowe" zastąpiona awatarem
   (72 px) w pierwszej karcie z małym kółeczkiem-ołówkiem (`.avatar-edit-bubble`);
   klik otwiera ukryty wybór pliku (walidacja/upload/usuwanie bez zmian),
   dyskretna akcja „Usuń zdjęcie". Bąbelek i logika zdjęcia montują się wyłącznie
   przy `canUploadAvatarPhoto` (tryb Supabase) — w trybie lokalnym zero wywołań
   klienta Supabase, jak dotychczas.
4. **Pierwsza karta = dane podstawowe**: awatar-kółko + imię, nazwisko,
   stanowisko, dział, spółka; pozostałe pola (kontakt, urodziny, emoji,
   dostępność, uprawnienia, dni/godziny pracy, przełożony) w dalszej części tego
   samego panelu; `ProfileFacts` scalone (linki tel:/mailto: oraz linki do
   profili przełożonego/podwładnych zachowane). `PasswordSection` bez zmian.

## Zmiany

- `src/pages/PersonProfilePage.tsx` — przebudowa na jeden zintegrowany panel.
- `src/pages/profileEditPolicy.ts` — zawężenie reguły PM, nowa `canViewProfileDetails`.
- `src/pages/profileEditPolicy.test.ts` — rozszerzona macierz (m.in. PM na innym
  PM → pusto, PM edytuje handlowca z własnego działu → zbiór managera, pełna
  macierz `canViewProfileDetails`).
- `src/styles.css` — layout pierwszej karty i bąbelek ołówka.
- Bez zmian: model danych osób, `AppStore.tsx`/reduktor (invariant 6
  nienaruszony), `teamScope.ts`, `TeamPage.tsx`, tryb retirement.

## Weryfikacja

- Focused: `npx vitest run src/pages/profileEditPolicy.test.ts src/pages/teamScope.test.ts` — PASS.
- Pełne `npm test`: 53 pliki, **1392 testy PASS** (uruchomione ponownie po
  ostatniej poprawce testowej).
- `npm run build` (tsc --noEmit && vite build): zielony.
- Review (agent reviewer, read-only): 1. runda `changes-required` — jeden
  blocker: brak pozytywnego przypadku „PM edytuje handlowca z własnego działu"
  (zawężenie reguły do samego `pracownik` przeszłoby suite); poprawka wyłącznie
  w pliku testowym. 2. runda: **approve**, zero blockerów.
- Decyzja wiki: **wiki unchanged** — `ui-navigation-and-onboarding.md` opisuje
  granice (profileEditPolicy jako czysta macierz, PersonProfilePage jako ekran
  trasy), które się nie zmieniły; `canViewProfileDetails` rozszerza istniejący
  czysty moduł polityki, nie tworzy nowej granicy.
- Gate (`npm test && npm run build`): oczekuje na scheduler

## Ryzyka / rzeczy do sprawdzenia

- Polityki to granica UX/spójności danych, nie bezpieczeństwa — realną granicą
  pozostaje RLS po stronie serwera (bez zmian w tym zadaniu).
- Stare reguły CSS `.avatar-photo-section`/`.avatar-photo-controls` pozostały
  nieużywane (świadomie — mniejsze ryzyko niż usuwanie); do sprzątnięcia przy okazji.
- Draft profilu inicjalizowany raz na mount (`key=person.id`) — identyczne okno
  „staleness" jak przed zmianą, brak regresji.

## Podpis schedulera

- Run: `20260722-142139-n2hub-256-profile-team-integration`
- Prompt: `256-profile-team-integration.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `e0334cde9ecc9687b85aa2adf061e6dd81c0a9d5`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `e0334cde9ecc9687b85aa2adf061e6dd81c0a9d5`
- Gałąź review: `review-integration`
- Run: `20260722-142139-n2hub-256-profile-team-integration`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `src/pages/PersonProfilePage.tsx`
- `src/pages/profileEditPolicy.test.ts`
- `src/pages/profileEditPolicy.ts`
- `src/styles.css`
- `handoffs/scheduler-reviews/20260722-142139-n2hub-256-profile-team-integration.md`
