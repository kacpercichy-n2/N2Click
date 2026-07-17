# Raport workflow: 20260715-212754-202-supabase-auth-session-login

## Wykonane

Zastąpiono demonstracyjną granicę logowania realnym przepływem sesji Supabase
Auth; mutacje danych planera pozostają w localStorage. Routing tieru:
`developer → reviewer` (pojedyncza granica — warstwa sesji auth + bramka
aplikacji; testy nierozłączne z implementacją; recenzję wykonuje osobny proces
schedulera). Implementację wykonał agent developer, orkiestrator zweryfikował
granice i checki niezależnie.

Dwa tryby, ustalane raz przy starcie w `SessionProvider`:

- **Tryb lokalny** (brak/niepoprawna konfiguracja `VITE_SUPABASE_*` —
  `resolveSupabaseConfig` rzuca): aplikacja zachowuje się dokładnie jak dotąd
  (demo person-picker `LoginPage`, bramka `currentUserId`), klient Supabase nie
  jest tworzony. Automatyczny, bezpieczny fallback dla lokalnego dev.
- **Tryb Supabase** (konfiguracja obecna): cała powłoka aplikacji jest za realną
  sesją `supabase.auth` — logowanie e-mail+hasło (`signInWithPassword`),
  odtworzenie sesji na starcie (`getSession` + `onAuthStateChange`, polski ekran
  „Wczytywanie sesji…” bez mignięcia formularza/powłoki), wylogowanie
  (`auth.signOut()` + istniejąca akcja `LOGOUT`), stany busy/disabled na
  formularzu i polskie komunikaty błędów (nieprawidłowe dane logowania,
  niepotwierdzony e-mail, błąd sieci, błąd nieoczekiwany — nigdy surowe teksty
  SDK).

Skojarzenie z modelem profilu: wyłącznie po tożsamości — e-mail sesji
dopasowany do `Person.email` (trim, bez rozróżniania wielkości liter; pusty
e-mail nigdy nie pasuje). `accessRole` i `departmentId` pochodzą zawsze z
lokalnego rekordu `Person`; nie istnieje żadna ścieżka czytająca rolę/dział z
`user_metadata`, `app_metadata` ani JWT. Zalogowany użytkownik bez profilu w
planerze widzi dedykowany polski stan zablokowany z działającym „Wyloguj” —
planer pozostaje zamknięty. `SET_CURRENT_USER` jest wysyłane tylko gdy realny
użytkownik (`realUserId`) się różni, więc odtworzenie sesji nie depcze aktywnej
personifikacji. Nie tworzy się użytkowników z przeglądarki, brak resetu hasła,
brak migracji danych planera, brak sekretów w kodzie.

Architektura: czysta maszyna stanów sesji (`src/auth/session.ts`) na
wstrzykiwanym minimalnym interfejsie klienta auth (testowalna w node bez SDK i
jsdom, fail-closed: błąd/wyjątek `getSession` ⇒ `signedOut`), cienka integracja
React (`SessionProvider.tsx`, sterownik tworzony w efekcie — bezpieczne dla
StrictMode), ekrany reużywające istniejące klasy CSS. Reducer `AppStore.tsx`
nietknięty (kompozycja z istniejącymi `SET_CURRENT_USER`/`LOGOUT`).

## Zmiany

- `src/auth/session.ts` — czysta maszyna stanów sesji + mapowanie błędów na
  polskie komunikaty (nowy plik).
- `src/auth/profile.ts` — skojarzenie profilu wyłącznie po e-mailu (nowy plik).
- `src/auth/mode.ts` — czyste wykrywanie trybu local/supabase, nigdy nie rzuca
  (nowy plik).
- `src/auth/SessionProvider.tsx` — kontekst React, adapter na `supabase.auth`,
  efekt skojarzenia tożsamości (nowy plik).
- `src/auth/AuthScreens.tsx` — ekrany: ładowanie sesji, logowanie e-mail+hasło,
  stan „brak profilu” (nowy plik).
- `src/auth/session.test.ts` — 26 testów przejść stanów, obsługi błędów i
  dopasowania profilu (nowy plik).
- `src/main.tsx` — `SessionProvider` owija router (wewnątrz store, na zewnątrz
  routera).
- `src/App.tsx` — bramka trybu Supabase przed bramką lokalną
  (restoring→loading, signedOut→login, brak profilu→blocked,
  niezsynchronizowana tożsamość→loading) oraz `handleLogout`
  (`signOut` + `LOGOUT`).
- `openwiki/n2hub/ui-navigation-and-onboarding.md` — nota o nowej granicy
  `src/auth/` i dwóch trybach (wiki updated).
- `handoffs/RUN-STATE.md` — wpis runu zgodnie z konwencją pliku.

## Weryfikacja

- `npm test`: PASS — 17 plików, 678 testów (652 wcześniejsze + 26 nowych auth);
  uruchomione przez developera i powtórzone niezależnie przez orkiestratora.
- `npm run build` (`tsc --noEmit && vite build`): PASS — tsc czysty; jedynie
  istniejące wcześniej ostrzeżenie o chunku >500 kB.
- `npm run check:openwiki`: PASS — 6 plików wiki zwalidowanych.
- Inspekcja granic: brak ścieżek `user_metadata`/`app_metadata`/JWT poza
  komentarzami i fixturą testową; brak nowych zależności; `supabase/migrations/`
  nietknięte; komentarz „UX gate, nie granica bezpieczeństwa” przy bramce.

## Ryzyka / rzeczy do sprawdzenia

- W trybie Supabase tryb konfiguracji zerowej liczby osób (setup mode) jest
  nieosiągalny: zalogowany użytkownik bez lokalnego profilu trafia na stan
  zablokowany. Pierwsza osoba musi powstać w trybie lokalnym lub przez import
  danych — do świadomej decyzji przy dalszej migracji.
- `SessionProvider` importuje statycznie klienta Supabase, więc
  `@supabase/supabase-js` jest teraz zawsze w bundlu (chunk ~883 kB; znane
  ostrzeżenie Vite >500 kB, bez code-splittingu — poza zakresem zadania).
- Mapowanie błędów SDK na polskie komunikaty jest heurystyką po
  `code`/`message`/`status`; nieznane błędy dostają komunikat ogólny
  (fail-safe, bez surowych tekstów SDK).
- Przepływ przeglądarkowy formularza Supabase nie ma scenariusza w matrycy
  browser-checks (weryfikacja release'owa jest właścicielem pełnej matrycy);
  testy jednostkowe pokrywają maszynę stanów i dopasowanie profilu.

## Podpis schedulera

- Run: `20260715-212754-202-supabase-auth-session-login`
- Prompt: `202-supabase-auth-session-login.md`
- Gałąź review: `review-integration`
- Baza: `ea4a6791bf5b3fc1b8f5993df671879502361576`


## Gate schedulera

- `npm test`: zaliczone
- `npm run build`: zaliczone
- Baza: `ea4a6791bf5b3fc1b8f5993df671879502361576`
- Gałąź review: `review-integration`
- Run: `20260715-212754-202-supabase-auth-session-login`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `openwiki/n2hub/ui-navigation-and-onboarding.md`
- `src/App.tsx`
- `src/main.tsx`
- `handoffs/scheduler-reviews/20260715-212754-202-supabase-auth-session-login.md`
- `src/auth/`
