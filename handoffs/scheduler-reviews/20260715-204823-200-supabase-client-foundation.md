# Raport workflow: 20260715-204823-200-supabase-client-foundation

## Wykonane

Dodano fundament klienta Supabase jako uśpioną infrastrukturę, bez żadnej zmiany
w aktywnym przepływie danych localStorage. Routing tieru: `developer → reviewer`
(pojedyncza granica, testy nierozłączne z implementacją; recenzję wykonuje
osobny proces schedulera).

- Zależność `@supabase/supabase-js` dodana do `package.json` / `package-lock.json`.
- `src/supabase/config.ts` — czysta funkcja `resolveSupabaseConfig(env)`: czyta
  wyłącznie `VITE_SUPABASE_URL` i `VITE_SUPABASE_PUBLISHABLE_KEY`, traktuje
  brak/pusty łańcuch/białe znaki jako brak wartości i rzuca czytelnym błędem
  wskazującym brakujące zmienne oraz `.env.local`. Odrzuca klucze wyglądające na
  sekretne (`sb_secret_...` oraz JWT z `role: service_role`) — żaden klucz
  sekretny nie może trafić do kodu przeglądarki.
- `src/supabase/client.ts` — leniwie inicjowany singleton `getSupabaseClient()`;
  walidacja `import.meta.env` dopiero przy pierwszym wywołaniu, więc brak
  zmiennych nie psuje działania aplikacji (nic jeszcze nie importuje tego modułu).
- `src/supabase/config.test.ts` — 16 testów walidacji konfiguracji na
  wstrzykiwanych rekordach env (bez importu SDK i bez `import.meta.env`).
- `src/vite-env.d.ts` — standardowe typowania `import.meta.env` dla Vite
  (wcześniej nie istniały; wymagane przez strict tsc).
- `.env.example` — dwie zmienne z wartościami zastępczymi (bez prawdziwych
  danych) i polskim komentarzem o kopiowaniu do `.env.local`.
- `.gitignore` — dodany jawny wpis `.env`; `.env.local` pozostaje ignorowany
  przez istniejące `*.local`, a `.env.example` pozostaje śledzony (zweryfikowano
  `git check-ignore`).
- `handoffs/RUN-STATE.md` — dopisany wpis runu zgodnie z konwencją pliku.

Nie dotknięto `AppStore.tsx`, `storage.ts`, selektorów, logowania ani żadnej
strony; nie kontaktowano się z hostowanym projektem Supabase. Wiki: bez zmian —
`state-and-persistence.md` nadal poprawnie opisuje `storage.ts` jako jedyną
aktywną granicę persystencji (nowy moduł jest nieimportowany), a
`testing-and-automation.md` opisuje konwencje, które zostały zachowane.

## Zmiany

- `package.json`, `package-lock.json` — nowa zależność `@supabase/supabase-js`.
- `src/supabase/config.ts`, `src/supabase/client.ts` — nowy, uśpiony moduł klienta.
- `src/supabase/config.test.ts` — testy walidacji konfiguracji.
- `src/vite-env.d.ts` — typowania środowiska Vite.
- `.env.example` — szablon konfiguracji (wartości zastępcze).
- `.gitignore` — jawny wpis `.env`.
- `handoffs/RUN-STATE.md` — wpis runu.

## Weryfikacja

- `npm test`: PASS — 15 plików, 635 testów zaliczonych (w tym 16 nowych testów
  walidacji konfiguracji Supabase).
- `npm run build` (`tsc --noEmit && vite build`): PASS — tsc czysty; Supabase
  nie trafia do bundla (nic go nie importuje). Jedynie istniejące wcześniej
  ostrzeżenie o chunku >500 kB.
- `git check-ignore`: `.env` i `.env.local` ignorowane, `.env.example` śledzony.

## Ryzyka / rzeczy do sprawdzenia

- `npm audit` zgłasza 2 podatności (1 moderate, 1 high) w zależnościach
  przechodnich po instalacji; nie uruchamiano `audit fix`, bo zmieniałby
  niepowiązane zależności — do świadomej decyzji operatora.
- Wykrywanie klucza sekretnego jest heurystyką (prefiks `sb_secret_`, payload
  JWT z `service_role`) — chroni przed pomyłką, nie jest granicą bezpieczeństwa.
- Moduł jest celowo martwy do czasu kolejnych zadań; brak wpływu na runtime.

## Podpis schedulera

- Run: `20260715-204823-200-supabase-client-foundation`
- Prompt: `200-supabase-client-foundation.md`
- Gałąź review: `review/auto-20260715-204823-200-supabase-client-foundation-200-supabase-client-foundation`
- Baza: `63ae73742f61c0226e3d4dc5198e63c526e1d87a`


## Gate schedulera

- `npm test`: zaliczone
- `npm run build`: zaliczone
- Baza: `63ae73742f61c0226e3d4dc5198e63c526e1d87a`
- Gałąź review: `review/auto-20260715-204823-200-supabase-client-foundation-200-supabase-client-foundation`
- Run: `20260715-204823-200-supabase-client-foundation`

### Pliki zgłoszone do review

- `.gitignore`
- `handoffs/RUN-STATE.md`
- `package-lock.json`
- `package.json`
- `.env.example`
- `handoffs/scheduler-reviews/`
- `src/supabase/`
- `src/vite-env.d.ts`
