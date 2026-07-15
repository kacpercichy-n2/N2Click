# Raport workflow: 20260716-003101-204-secure-account-provisioning

## Wykonane

TierWorkflow, trasa `developer → reviewer` (jedna granica implementacyjna,
testy nierozdzielne od implementacji). Dodano bezpieczną, serwerową granicę
zakładania kont Supabase do przyszłego użytku administratora:

- **`supabase/functions/provision-account/index.ts`** — Edge Function (Deno):
  tylko POST (+ preflight z restrykcyjnym CORS sterowanym env), wymaga
  `Authorization: Bearer <JWT>`; klient service-role budowany wyłącznie z
  `Deno.env` (klucz nigdy w repo ani w przeglądarce). Kolejność kontroli:
  metoda → obecność JWT (401) → konfiguracja env (500) → `auth.getUser` (401)
  → profil wywołującego musi mieć `access_role = 'administrator'` (403) →
  dopiero parsowanie i walidacja body (400). Tworzy użytkownika Auth
  (tryb `temporary-password` przez `admin.createUser` z `email_confirm` albo
  tryb `invite` przez `inviteUserByEmail`), wstawia wiersz `public.profiles`
  z jawnym `must_change_password: true`; przy błędzie insertu wykonuje
  best-effort rollback (`admin.deleteUser`). Duplikat e-maila → 409 po polsku;
  żadna odpowiedź ani log nie zawiera hasła, klucza ani surowego tekstu SDK.
- **`supabase/functions/provision-account/contract.ts`** — czysty, bezzależny
  moduł typowanego kontraktu żądania: imię (1–100), nazwisko, znormalizowany
  e-mail firmowy (trim + lowercase, opcjonalna lista dozwolonych domen z env),
  stanowisko (`role_title`), dział (uuid), relacja menedżerska (walidacja
  spójności: wskazany profil musi być menedżerem tego działu — schemat nie ma
  kolumny `manager_id`), rola dostępu (enum trzech ról) oraz tagowana unia
  workflow hasła początkowego (`invite` | `temporary-password`, min. 8 znaków
  — lustro `MIN_PASSWORD_LENGTH` z `src/auth/passwordChange.ts`). Polskie
  komunikaty błędów; `authorizeProvisioning` przepuszcza wyłącznie
  administratora.
- **`src/supabase/provisioning.test.ts`** — 31 deterministycznych testów
  vitest granic walidacji i autoryzacji (normalizacja, domeny, zakresy, uuid,
  enum ról, tryby hasła, relacja menedżerska, odmowy 403, brak echa hasła w
  komunikatach). Importuje wyłącznie `contract.ts`.
- **`supabase/functions/README.md`** — dokumentacja wdrożenia i konfiguracji:
  granica zaufania, `supabase functions deploy provision-account`, wymagane
  sekrety wyłącznie z NAZWY (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` —
  zarezerwowane/auto-wstrzykiwane; opcjonalne `PROVISION_ALLOWED_EMAIL_DOMAINS`,
  `PROVISION_ALLOWED_ORIGIN` przez `supabase secrets set`), bez żadnych
  wartości w repo.
- **`supabase/README.md`** — minimalna aktualizacja sekcji struktury (katalog
  `functions/provision-account/` + link do nowego README).
- **`handoffs/RUN-STATE.md`** — dopisany wpis runu (konwencja poprzednich
  etapów).

Bez migracji, bez UI administratora, bez realnych kont i haseł. Nic w `src/`
poza nowym testem nie importuje `supabase/functions/`; `contract.ts` kompiluje
się czysto pod strict `tsc`, a deno-owy `index.ts` jest poza zasięgiem builda.

## Zmiany

- `supabase/functions/provision-account/contract.ts` (nowy)
- `supabase/functions/provision-account/index.ts` (nowy)
- `supabase/functions/README.md` (nowy)
- `src/supabase/provisioning.test.ts` (nowy)
- `supabase/README.md` (edycja sekcji struktury)
- `handoffs/RUN-STATE.md` (dopisany wpis runu)

## Weryfikacja

- `npx vitest run src/supabase/provisioning.test.ts`: **31 passed / 0 failed**
- `npm test`: **727 testów / 19 plików — zielone** (worker i reviewer, niezależnie)
- `npm run build` (`tsc --noEmit && vite build`): **zielony** (jedynie
  wcześniej istniejące ostrzeżenie o chunku >500 kB)
- Reviewer (read-only): werdykt **approve**, `git grep` nie znalazł żadnego
  sekretu/klucza/ref-a projektu w diffie; decyzja wiki: **wiki unchanged** —
  żadna z czterech stron `openwiki/n2hub` nie pokrywa obszaru serwerowego
  Supabase (dokumentem obszaru jest `supabase/README.md`, zaktualizowany).
- `npm test` / `npm run build` jako obowiązkowy gate: wykona scheduler.

## Ryzyka / rzeczy do sprawdzenia

- Wykrywanie duplikatu e-maila w `index.ts` dopasowuje podłańcuchy komunikatu
  SDK (a nie tylko `error.code`); gdyby Supabase przeredagował komunikat,
  duplikat zwróci ogólny błąd 502 zamiast 409 — degradacja bezpieczna (klient
  nigdy nie widzi surowego tekstu SDK).
- Gdy wiersz `profiles` z danym e-mailem istnieje bez konta Auth, insert
  profilu zwróci 500 (z rollbackiem konta Auth) zamiast 409 — rzadki przypadek
  brzegowy, do ewentualnego doprecyzowania przy zadaniu na UI administratora.
- Warstwa transportowa `index.ts` (Deno) jest świadomie poza vitest; pokryta
  jest cała logika kontraktu i autoryzacji. Funkcja nie została wdrożona na
  żaden hostowany projekt w ramach tego zadania.

## Podpis schedulera

- Run: `20260716-003101-204-secure-account-provisioning`
- Prompt: `204-secure-account-provisioning.md`
- Gałąź review: `review-integration`
- Baza: `824b20d3d798df7479b65795c7968bcf02c673fa`


## Gate schedulera

- `npm test`: zaliczone
- `npm run build`: zaliczone
- Baza: `824b20d3d798df7479b65795c7968bcf02c673fa`
- Gałąź review: `review-integration`
- Run: `20260716-003101-204-secure-account-provisioning`

### Pliki zgłoszone do review

- `handoffs/RUN-STATE.md`
- `supabase/README.md`
- `handoffs/scheduler-reviews/20260716-003101-204-secure-account-provisioning.md`
- `src/supabase/provisioning.test.ts`
- `supabase/functions/`
