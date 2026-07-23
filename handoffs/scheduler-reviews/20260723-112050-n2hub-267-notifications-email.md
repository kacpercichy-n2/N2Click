# Raport workflow: 20260723-112050-n2hub-267-notifications-email

## Wykonane

Guard: prompt 266 JEST dostarczony (tabela `public.notifications` +
powiadomienia in-app istnieją w kodzie), więc zadanie 2/2 realizuję w całości.

Dodałem OPCJONALNE dublowanie powiadomień in-app mailem, w pełni addytywnie i
zgodnie z istniejącym wzorcem Edge Function (`provision-account`):

1. **Kolumna stanu wysyłki** — migracja `20260723130000_notifications_emailed_at`:
   addytywna kolumna `emailed_at timestamptz null` w `notifications` +
   częściowy indeks `where emailed_at is null` (szybka selekcja niewysłanych).
   Idempotentna (`add column if not exists`).

2. **Edge Function `send-notification-emails`** (nowa, wzorzec z
   `provision-account`):
   - `contract.ts` — czysta, bezzależnościowa logika (bez SDK/Deno): odczyt
     konfiguracji dostawcy z env, selekcja uprawnionych odbiorców, grupowanie
     per odbiorca, budowa polskiej treści maila (kto/co/gdzie + link do huba,
     odmiana licznika, escaping HTML).
   - `index.ts` — warstwa I/O w Deno: pobiera do 50 powiadomień
     `emailed_at is null` (najstarsze pierwsze), dociąga profile
     (odbiorcy/aktorzy), zadania i projekty, grupuje, wysyła jeden zbiorczy
     mail per odbiorca czystym `fetch` do Resend, po sukcesie ustawia
     `emailed_at`. Adres odbiorcy pobiera z `profiles` (mapowanie konto↔osoba,
     jak w provision-account: `profiles.id` = auth.users id).
   - **Idempotencja**: `emailed_at` ustawiane po udanej wysyłce oraz dla
     świadomie pominiętych powiadomień — powtórny cron ich nie wybiera i nie
     dubluje maili. Wiersz z błędem wysyłki zostaje `null` (retry w następnym
     cyklu).
   - **Graceful no-op**: bez sekretów `RESEND_API_KEY` / `NOTIFY_FROM_EMAIL`
     funkcja loguje i kończy się czysto, bez wysyłki. Sekrety wyłącznie jako env
     funkcji — zero sekretów w repo.

3. **Preferencja użytkownika „Powiadomienia mailowe"** — opt-in, DOMYŚLNIE
   WYŁĄCZONA:
   - migracja `20260723131000_profiles_email_notifications`:
     `email_notifications boolean not null default false`.
   - round-trip przez model profilu jak `birth_date`: `Person.emailNotifications?`
     (opcjonalne, brak => false) ↔ `profiles.email_notifications` (mirror UPDATE
     w `cloudMirror`, hydracja w `referenceData` → `applyCloudPeople`),
     repair legacy w `storage.migratePerson`.
   - UI: checkbox „Powiadomienia mailowe" w edycji profilu
     (`PersonProfilePage`), gated `profileEditPolicy` (SELF + ALL; menedżer NIE
     zmienia cudzej preferencji). Funkcja pomija odbiorców z `false`.

4. **Harmonogram** — udokumentowany w `supabase/functions/README.md` (cron
   Supabase `pg_cron`+`pg_net` co ~5 min lub zewnętrzny scheduler). NIE
   konfigurowany z poziomu kodu aplikacji — to krok operatora.

5. **Testy** — logika grupowania/treści/selekcji jest czysta i testowana poza
   runtime'em Deno (`src/supabase/notificationEmails.test.ts`): m.in. opt-out,
   no-op bez sekretów, treść PL, degradacja braków nazw, odmiana licznika,
   escaping HTML.

Wiki `openwiki/n2hub/cloud-database.md` rozszerzone o `emailed_at`,
`email_notifications` i drugą Edge Function (dokumentowana granica była
niekompletna).

## Zmiany

- Migracje: `supabase/migrations/20260723130000_notifications_emailed_at.sql`,
  `supabase/migrations/20260723131000_profiles_email_notifications.sql`.
- Edge Function: `supabase/functions/send-notification-emails/contract.ts`,
  `.../index.ts`; `supabase/functions/README.md`.
- Round-trip preferencji: `src/types.ts`, `src/store/AppStore.tsx`,
  `src/store/storage.ts`, `src/supabase/referenceData.ts`,
  `src/supabase/cloudMirror.ts`, `src/pages/PeoplePage.tsx`,
  `src/pages/PersonProfilePage.tsx`, `src/pages/profileEditPolicy.ts`,
  `src/styles.css`.
- Testy: `src/supabase/notificationEmails.test.ts` (nowy),
  `src/supabase/migrations.test.ts` (lista migracji),
  `src/pages/profileEditPolicy.test.ts` (zbiory pól).
- Wiki: `openwiki/n2hub/cloud-database.md`.

## Weryfikacja

- `npm test`: **zielony** — 63 pliki, 1475 testów (w tym nowe testy kontraktu
  maili oraz zaktualizowane testy migracji i polityki edycji profilu).
- `npm run build` (`tsc --noEmit && vite build`): **zielony**, bez błędów typów.
- Gate (`npm test && npm run build`): przekazuję do schedulera.

## Ryzyka / rzeczy do sprawdzenia

- **Kroki operatora (wymagane po merge)**:
  1. Zastosuj obie migracje (`20260723130000`, `20260723131000`).
  2. Deploy: `supabase functions deploy send-notification-emails`.
  3. Ustaw sekrety: `RESEND_API_KEY`, `NOTIFY_FROM_EMAIL` (opcjonalnie
     `NOTIFY_HUB_URL`). Bez nich funkcja = no-op.
  4. Skonfiguruj cron (~5 min) na URL funkcji (SQL w README).
  5. Użytkownicy sami włączają preferencję w profilu (domyślnie OFF).
- **Brak backfillu**: powiadomienia utworzone przy wyłączonej preferencji (lub
  bez konta/adresu odbiorcy) są oznaczane `emailed_at` i pomijane — po
  późniejszym włączeniu preferencji nie są douwysyłane (opt-in działa „w
  przód"). Świadome i udokumentowane.
- **At-least-once**: jeśli mail wyśle się, ale `emailed_at` nie zdąży się
  zapisać (awaria między krokami), kolejny cron może wysłać duplikat. To celowy
  kompromis prostoty; przy sekwencyjnym cronie ryzyko marginalne.
- **Dostawca**: domyślnie Resend (jedno POST na `api.resend.com/emails`).
  Podmiana na inny HTTP-owy dostawcę lub SMTP = zmiana jednego `fetch` w
  `index.ts`; logika czysta zostaje bez zmian.
- `index.ts` (runtime Deno) nie jest objęty `tsc`/vitest repo — świadomie, jak
  `provision-account/index.ts`; testowalna logika żyje w `contract.ts`.
- Zakres UI ograniczony wyłącznie do opt-in (punkt 3) — reszta UI powiadomień
  nietknięta. Invariant 6 zachowany (preferencja opcjonalna, brak nowej ścieżki
  unieważniania komend).

## Podpis schedulera

- Run: `20260723-112050-n2hub-267-notifications-email`
- Prompt: `267-notifications-email.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `0bb6873477ec9492a8be1fffdf5755449ca453b8`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `0bb6873477ec9492a8be1fffdf5755449ca453b8`
- Gałąź review: `review-integration`
- Run: `20260723-112050-n2hub-267-notifications-email`

### Pliki zgłoszone do review

- `openwiki/n2hub/cloud-database.md`
- `src/pages/PeoplePage.tsx`
- `src/pages/PersonProfilePage.tsx`
- `src/pages/profileEditPolicy.test.ts`
- `src/pages/profileEditPolicy.ts`
- `src/store/AppStore.tsx`
- `src/store/storage.ts`
- `src/styles.css`
- `src/supabase/cloudMirror.ts`
- `src/supabase/migrations.test.ts`
- `src/supabase/referenceData.ts`
- `src/types.ts`
- `supabase/functions/README.md`
- `handoffs/scheduler-reviews/20260723-112050-n2hub-267-notifications-email.md`
- `src/supabase/notificationEmails.test.ts`
- `supabase/functions/send-notification-emails/`
- `supabase/migrations/20260723130000_notifications_emailed_at.sql`
- `supabase/migrations/20260723131000_profiles_email_notifications.sql`
