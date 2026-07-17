# Raport workflow: 20260715-215341-203-forced-password-change

## Wykonane

Dodano wymuszoną zmianę pierwszego hasła oraz panel samodzielnej zmiany hasła
dla trybu Supabase; tryb lokalny (brak konfiguracji `VITE_SUPABASE_*`) pozostaje
bez zmian zachowania. Routing tieru: `developer → reviewer` (jeden spójny pakiet —
rozszerzenie istniejącej granicy `src/auth/` + jedna uśpiona migracja + jedna
nowa strona; testy nierozłączne z implementacją; ryzyko `high` — trust/auth +
migracja schematu, Codex review wymagany po stronie schedulera). Implementację
wykonał agent developer; orkiestrator rozstrzygnął decyzje projektowe przed
routingiem i zweryfikował diff oraz checki niezależnie.

- **Flaga serwerowa**: migracja tylko-do-przodu
  `supabase/migrations/20260715220000_profiles_must_change_password.sql` dodaje
  `profiles.must_change_password boolean not null default true` (konta zakłada
  administrator z hasłem tymczasowym, więc nowy profil domyślnie wymaga zmiany).
  Polityka `profiles_update_self_or_admin` + trigger `protect_profile_privileges`
  (blokuje tylko `id`/`access_role`/`department_id`) czynią kolumnę
  samo-czyszczalną przez właściciela — udokumentowane w migracji i README jako
  bramka UX/integralności danych, nie granica bezpieczeństwa (spójnie z
  guardrails repo). Migracja nie była stosowana na żadnym hostowanym projekcie.
- **Bramka**: po `signedIn` `SessionProvider` wczytuje flagę raz na id
  użytkownika (`maybeSingle` po `profiles`); `App.tsx` blokuje całą powłokę
  ekranem `ForcedPasswordChange` (polski, dwa pola `new-password`, walidacja,
  busy, działające „Wyloguj”) PRZED dopasowaniem lokalnego profilu, więc także
  konto bez profilu w planerze musi najpierw ustawić hasło. Wczytywanie flagi
  jest fail-open (brak wiersza/`null`/błąd/wyjątek ⇒ `false`) — uśpiona/pusta
  tabela `profiles` ani błąd sieci nigdy nie zablokują aplikacji.
- **Zmiana hasła**: czysty moduł `src/auth/passwordChange.ts` (wzorzec
  `session.ts` — zero SDK, testowalny w node): walidacja (puste / <8 znaków /
  niezgodne powtórzenie), mapowanie błędów `updateUser` na polskie komunikaty
  (`same_password`, `weak_password`, sieć, nieznane — nigdy surowy tekst SDK)
  i orkiestracja: walidacja → `auth.updateUser({password})` → dopiero po
  sukcesie czyszczenie flagi (`update profiles`). Błąd zmiany hasła NIE czyści
  flagi; udana zmiana z nieudanym czyszczeniem flagi odblokowuje lokalnie
  (hasło już zmienione), a serwerowa flaga wymusi ustawienie kolejnego nowego
  hasła przy następnym logowaniu (best-effort, udokumentowane).
- **Panel konta**: nowa strona `src/pages/AccountPage.tsx` pod trasą `/account`
  („Konto”, sekcja „Zmiana hasła”, komunikat sukcesu „Hasło zostało
  zmienione.”), link nawigacyjny tylko w trybie Supabase; w trybie lokalnym
  trasa przekierowuje na `/` i link nie istnieje.
- Hasła nie są nigdzie wyświetlane, logowane ani zapisywane (grep czysty);
  w testach wyłącznie oczywiste atrapy. Bez przepływów resetu e-mail, bez UI
  tworzenia kont, bez migracji danych planera; reducer `AppStore.tsx`,
  `src/store/` i `storage.ts` nietknięte.

## Zmiany

- `supabase/migrations/20260715220000_profiles_must_change_password.sql` — nowa
  migracja ALTER (flaga + komentarz kolumny).
- `supabase/README.md` — nota o fladze i nowym pliku migracji.
- `src/auth/passwordChange.ts` — czysty moduł walidacji/mapowania/orkiestracji
  zmiany hasła (nowy plik).
- `src/auth/passwordChange.test.ts` — 18 testów node: walidacja, mapowanie
  błędów, fail-open wczytywania flagi, kolejność i gałęzie orkiestracji (nowy
  plik).
- `src/auth/session.ts` — opcjonalne `AuthUser.id` (bez zmian maszyny stanów).
- `src/auth/SessionProvider.tsx` — stan `mustChangePassword` (reset przy
  wylogowaniu/zmianie użytkownika), adaptery PostgREST/`updateUser`,
  `changePassword` w kontekście.
- `src/auth/AuthScreens.tsx` — ekran `ForcedPasswordChange`.
- `src/pages/AccountPage.tsx` — panel konta (nowy plik).
- `src/App.tsx` — bramka wymuszonej zmiany przed dopasowaniem profilu, trasa
  `/account` (lokalnie redirect), link „Konto” tylko w trybie Supabase.
- `src/components/icons.ts` — eksport `KeyRound` dla linku nawigacji.
- `src/supabase/migrations.test.ts` — dostosowanie do plików tylko-do-przodu:
  lista migracji rozszerzona o nowy plik, plik RLS wskazywany po nazwie zamiast
  „ostatni po sortowaniu” (wszystkie inwarianty bezpieczeństwa bez zmian).
- `openwiki/n2hub/ui-navigation-and-onboarding.md` — sekwencja bramki
  uzupełniona o krok wymuszonej zmiany hasła i panel `/account` (wiki updated).
- `handoffs/RUN-STATE.md` — wpis runu zgodnie z konwencją pliku.

## Weryfikacja

- `npm test`: PASS — 18 plików, 696 testów (678 wcześniejszych + 18 nowych);
  uruchomione przez developera i powtórzone niezależnie przez orkiestratora.
- `npm run build` (`tsc --noEmit && vite build`): PASS — tsc czysty; jedynie
  istniejące wcześniej ostrzeżenie o chunku >500 kB.
- `npx vitest run src/auth/ src/supabase/`: PASS — 77 testów (developer).
- Inspekcja diffu przez orkiestratora: kolejność bramek w `App.tsx` poprawna
  (restoring → signedOut → flaga `null`/`true` → brak profilu → powłoka),
  `USER_UPDATED` po zmianie hasła nie resetuje wczytanej flagi, wylogowanie
  resetuje stan flagi, brak `console.*`/localStorage w nowych modułach, brak
  haseł w kodzie/komentarzach/testach poza atrapami.

## Ryzyka / rzeczy do sprawdzenia

- Właściciel może wyczyścić własną flagę bezpośrednio przez API PostgREST bez
  zmiany hasła — świadoma, udokumentowana decyzja (bramka UX; twarda egzekucja
  wymagałaby logiki po stronie serwera poza zakresem repo).
- Wczytywanie flagi jest fail-open: przy braku wiersza profilu w (uśpionej)
  tabeli `profiles` lub błędzie sieci wymuszenie nie nastąpi. To celowy wybór —
  odwrotność zablokowałaby aplikację, dopóki tabela `profiles` nie jest
  zasilona danymi.
- Migracja ALTER nie była wykonana na żadnym Postgresie (walidacja statyczna w
  `migrations.test.ts`); przed `db push` warto przepuścić całość przez lokalne
  `supabase db start`/`db lint`.
- Udana zmiana hasła z nieudanym czyszczeniem flagi (rzadki podwójny błąd)
  wymusi ustawienie kolejnego nowego hasła przy następnym logowaniu — akceptowalne
  i lepsze niż pętla „to samo hasło”.
- Przepływ przeglądarkowy ekranu wymuszonej zmiany i panelu `/account` nie ma
  scenariusza w matrycy browser-checks (matryca należy do weryfikacji
  release'owej); logika jest pokryta testami czystych modułów.

## Podpis schedulera

- Run: `20260715-215341-203-forced-password-change`
- Prompt: `203-forced-password-change.md`
- Gałąź review: `review-integration`
- Baza: `22979fdb501607b7ef4a8891022aae7e53bed49f`


## Gate schedulera

- `npm test`: zaliczone
- `npm run build`: zaliczone
- Baza: `22979fdb501607b7ef4a8891022aae7e53bed49f`
- Gałąź review: `review-integration`
- Run: `20260715-215341-203-forced-password-change`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `openwiki/n2hub/ui-navigation-and-onboarding.md`
- `src/App.tsx`
- `src/auth/AuthScreens.tsx`
- `src/auth/SessionProvider.tsx`
- `src/auth/session.ts`
- `src/components/icons.ts`
- `src/supabase/migrations.test.ts`
- `supabase/README.md`
- `handoffs/scheduler-reviews/20260715-215341-203-forced-password-change.md`
- `src/auth/passwordChange.test.ts`
- `src/auth/passwordChange.ts`
- `src/pages/AccountPage.tsx`
- `supabase/migrations/20260715220000_profiles_must_change_password.sql`
