# Supabase Edge Functions

Cztery funkcje: `provision-account` (zakładanie kont), `send-notification-emails`
(opcjonalne dublowanie powiadomień in-app mailem), `google-calendar-connect`
i `google-calendar-sync` (import Kalendarza Google). Wszystkie trzymają się tego
samego wzorca: czysty, bezzależnościowy `contract.ts` (współdzielony z testami
repo) + `index.ts` z warstwą I/O w runtime Deno.

## `provision-account`

Zaufana, **serwerowa** granica zakładania kont N2Hub. Funkcja tworzy
użytkownika w `auth.users` oraz odpowiadający mu wiersz w `public.profiles`,
i może to zrobić **wyłącznie** na żądanie uwierzytelnionego administratora.

To wciąż uśpiona infrastruktura: aplikacja działa na localStorage, **nie ma
jeszcze UI administracyjnego** ani wywołania tej funkcji z frontendu, a ta
zmiana **nie wymaga żadnej migracji** (korzysta z istniejących tabel
`departments` i `profiles`).

## Granica zaufania

- Klucz `service_role` (sekret) żyje **wyłącznie w runtime Edge**, gdzie jest
  auto-wstrzykiwany. **Nigdy** nie trafia do przeglądarki ani do tego repo.
- Frontend używa tylko klucza *publishable* (patrz `src/supabase/config.ts`).
- Autoryzacja jest egzekwowana po stronie serwera: funkcja odczytuje JWT
  wywołującego, ustala jego profil i wpuszcza tylko `access_role =
  'administrator'`. Service role świadomie omija RLS — to poprawne zachowanie
  serwerowe, ale tylko za bramką autoryzacji administratora.
- Nigdzie nie logujemy treści żądania, hasła ani kluczy. `console.error`
  zawiera co najwyżej kod błędu.

## Podział plików

```
supabase/functions/provision-account/
  contract.ts   # czysty kontrakt + walidacja (bez SDK, bez globali Deno) — współdzielony z testami repo
  index.ts      # handler Deno Edge (Deno.serve, npm:@supabase/supabase-js@2)
```

`contract.ts` jest celowo pozbawiony zależności, więc konsumuje go zarówno
bundler Deno, jak i `tsc`/`vitest` repo. Testy jednostkowe kontraktu żyją w
`src/supabase/provisioning.test.ts` i importują wyłącznie `contract.ts`.

## Kontrakt żądania i odpowiedzi

`POST` z nagłówkiem `Authorization: Bearer <jwt>` i ciałem JSON:

| Pole | Typ | Uwagi |
| --- | --- | --- |
| `firstName` | string (wymagane) | przycięte, 1–100 znaków |
| `lastName` | string (opc.) | przycięte, ≤ 100, domyślnie `''` |
| `email` | string (wymagane) | trim + lowercase, walidacja formatu, opcjonalna dozwolona domena |
| `roleTitle` | string (opc.) | przycięte, ≤ 200, domyślnie `''` |
| `departmentId` | uuid \| null (opc.) | musi istnieć w `departments` |
| `managerProfileId` | uuid \| null (opc.) | profil musi być menedżerem zarządzającym `departmentId` |
| `accessRole` | `administrator` \| `manager` \| `worker` | |
| `initialPassword` | `{ mode: 'invite' }` \| `{ mode: 'temporary-password', password }` | hasło ≥ 8 znaków |

Powiązanie z menedżerem to kontrola spójności: w modelu N2Hub **nie ma** kolumny
`manager_id`. Menedżer to profil z `access_role = 'manager'`, którego
`department_id` wskazuje zarządzany dział; musi on być równy `departmentId` z
żądania.

Odpowiedź sukcesu — `201`:

```json
{
  "userId": "…",
  "email": "…",
  "accessRole": "worker",
  "mustChangePassword": true,
  "initialPasswordMode": "invite"
}
```

Hasło **nigdy** nie jest zwracane. Wybrane statusy błędów (komunikaty po
polsku): `401` brak/niepoprawna sesja, `403` brak uprawnień administratora,
`400` nieprawidłowe dane wejściowe (per-pole), `409` konto z tym e-mailem już
istnieje, `405` niedozwolona metoda, `500/502` błąd/konfiguracja serwera.

## Weryfikacja JWT

Funkcja sama waliduje token przez `serviceClient.auth.getUser(jwt)`, więc może
działać z domyślną weryfikacją JWT bramy. Autoryzacja roli i tak jest
powtórzona po stronie serwera na podstawie wiersza w `profiles`.

## Wdrożenie i sekrety

```bash
supabase functions deploy provision-account
```

Sekrety (ustawiaj **nazwami**, nigdy nie commituj wartości):

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — **zarezerwowane**,
  auto-wstrzykiwane w runtime Edge; nie ustawiaj ich ręcznie.
- `PROVISION_ALLOWED_EMAIL_DOMAINS` (opc.) — lista domen po przecinku; pusta =
  dowolna domena.
- `PROVISION_ALLOWED_ORIGIN` (opc.) — jeśli ustawione, dodawany nagłówek CORS
  `Access-Control-Allow-Origin`; bez niego brak nagłówka origin.

```bash
supabase secrets set PROVISION_ALLOWED_EMAIL_DOMAINS=firma.pl
supabase secrets set PROVISION_ALLOWED_ORIGIN=https://planer.firma.pl
```

## `send-notification-emails`

Opcjonalne dublowanie powiadomień in-app (tabela `notifications`, prompt 266)
zbiorczym mailem per odbiorca. Funkcja jest **cykliczna** (bezstanowa): przy
każdym wywołaniu wybiera wsad niewysłanych powiadomień, grupuje per odbiorca,
wysyła jeden mail i oznacza je jako wysłane.

### Jak działa

1. Bez sekretów dostawcy (`RESEND_API_KEY` / `NOTIFY_FROM_EMAIL`) — **czysty
   no-op**: funkcja loguje i kończy się `200` bez żadnej wysyłki. Nie spamujemy
   od pierwszego deployu.
2. Pobiera do 50 powiadomień z `emailed_at is null` (najstarsze pierwsze).
3. Dociąga profile odbiorców/aktorów oraz zadania i projekty potrzebne do treści.
4. **Selekcja odbiorców**: pomija tych z wyłączoną preferencją
   `profiles.email_notifications` (domyślnie `false`) albo bez adresu e-mail.
5. Buduje jeden **polski** mail zbiorczy per odbiorca („kto / co / gdzie" + link
   do huba) i wysyła czystym `fetch` do Resend (`POST https://api.resend.com/emails`,
   bez ciężkich zależności).
6. **Idempotencja**: po udanej wysyłce (oraz dla świadomie pominiętych
   powiadomień) ustawia `emailed_at`, więc kolejny cron ich nie wybiera. Wiersz z
   błędem wysyłki zostaje `null` i spróbuje ponownie w następnym cyklu.

Cała logika selekcji, grupowania i treści żyje w `contract.ts` i jest testowana
w repo (`src/supabase/notificationEmails.test.ts`, m.in. opt-out i no-op bez
sekretów) — `index.ts` to wyłącznie I/O.

### Sekrety

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — **zarezerwowane**,
  auto-wstrzykiwane w runtime Edge; nie ustawiaj ich ręcznie. Service role
  omija RLS świadomie (batch dla wszystkich odbiorców).
- `RESEND_API_KEY` (wymagany do wysyłki) — klucz API dostawcy. Brak = no-op.
- `NOTIFY_FROM_EMAIL` (wymagany do wysyłki) — adres nadawcy, np.
  `powiadomienia@firma.pl`. Brak = no-op.
- `NOTIFY_HUB_URL` (opcjonalny) — link do huba wstawiany w treść maila.

```bash
supabase secrets set RESEND_API_KEY=...redacted...
supabase secrets set NOTIFY_FROM_EMAIL=powiadomienia@firma.pl
supabase secrets set NOTIFY_HUB_URL=https://planer.firma.pl
```

> Zamiast Resend można podstawić dowolnego dostawcę z jednym POST-em HTTP albo
> generyczny SMTP — wystarczy podmienić wywołanie `fetch` w `index.ts`. Klucz
> **zawsze** jako sekret funkcji, nigdy w repo.

### Harmonogram (krok operatora)

Funkcję trzeba wołać cyklicznie — **NIE** robi tego kod aplikacji. Zalecane co
~5 minut. Najprościej zaplanowanym cronem Supabase (`pg_cron` + `pg_net`), np. w
SQL editor projektu:

```sql
select cron.schedule(
  'send-notification-emails',
  '*/5 * * * *',
  $$ select net.http_post(
       url := 'https://<PROJECT_REF>.supabase.co/functions/v1/send-notification-emails',
       headers := jsonb_build_object('Authorization', 'Bearer <SERVICE_ROLE_KEY>')
     ) $$
);
```

Alternatywnie zewnętrzny scheduler uderzający w ten sam URL. To krok operatora —
w repo nie konfigurujemy crona.

### Wdrożenie

```bash
supabase functions deploy send-notification-emails
```

### Kroki operatora (podsumowanie)

1. Zastosuj migracje: `20260723130000_notifications_emailed_at` (kolumna stanu
   wysyłki) i `20260723131000_profiles_email_notifications` (preferencja opt-in).
2. Zdeployuj funkcję: `supabase functions deploy send-notification-emails`.
3. Ustaw sekrety: `RESEND_API_KEY`, `NOTIFY_FROM_EMAIL` (i opcjonalnie
   `NOTIFY_HUB_URL`).
4. Skonfiguruj crona (~5 min) na URL funkcji.
5. Użytkownicy włączają „Powiadomienia mailowe" w swoim profilu (domyślnie
   wyłączone).


## `google-calendar-connect` i `google-calendar-sync`

Import Kalendarza Google **tylko do odczytu** (migracja
`20260825140000_google_calendar`). Każdy pracownik podpina WŁASNE konto Google
na stronie konta; jego spotkania trafiają do warstwy cieniowej
`n2click.google_calendar_events` (nigdy do `events`) i pokazują się w widoku
Tydzień/Miesiąc obok spotkań N2Hub. Research i decyzje:
`handoffs/research/google-calendar-import-2026-08-25.md`.

### Jak działa

1. Przeglądarka: GIS w trybie **authorization code** (popup, ten sam klient OAuth
   `VITE_GOOGLE_CLIENT_ID` co Dysk w Content Planie) zwraca jednorazowy `code`.
   Zakresy: `calendar.events.readonly`, `calendar.calendarlist.readonly`,
   `openid email`.
2. `google-calendar-connect` (JWT użytkownika): wymienia `code` na tokeny kluczem
   `GOOGLE_CLIENT_SECRET` (`redirect_uri=postmessage`), chowa refresh token w
   **Vault** przez definera `n2click.google_store_refresh_token` (wykonywalny
   tylko dla `service_role`), zakłada/odświeża `google_accounts` i od razu woła
   sync dla tego konta.
3. `google-calendar-sync`: dla każdego aktywnego konta odświeża access token,
   pobiera `calendarList` (nowe kalendarze: `primary` domyślnie importowany),
   a dla wybranych kalendarzy `events.list` — pełny sync w oknie −30/+90 dni,
   potem przyrostowo `syncToken` (410 => pełny od nowa; co 30 dni okno jest
   przesuwane). Mapowanie na siatkę 15 min (start w dół, koniec w górę),
   całodniowe 0/1440, `outOfOffice`/`focusTime` importowane, reszta typów
   pomijana, uczestnicy dopasowani po e-mailu do `profiles`. Cała decyzyjność w
   `google-calendar-sync/contract.ts` (testy: `src/gcal/gcalContract.test.ts`).
4. Wywołanie: **cron** (`pg_cron` co 5 min → `n2click.google_calendar_sync_tick()`
   → `pg_net` POST z nagłówkiem `x-n2-cron-secret`) albo **użytkownik**
   („Synchronizuj teraz", JWT => tylko jego konto).
   Zapis jest ATOMOWY: funkcja pobiera komplet stron z Google, a dopiero potem
   jedno RPC `n2click.google_apply_calendar_sync` (service_role) w jednej
   transakcji kasuje/upsertuje/przesuwa token; konto ma dzierżawę
   `sync_lease_until`, więc cron, connect i „Synchronizuj teraz" nie biegną
   równolegle. Obie funkcje wymagają wiersza `app_access` N2Click wywołującego.
5. Kto co widzi: widok `n2click.google_calendar_events_visible` maskuje wiersze
   (właściciel i zaproszeni: szczegóły; reszta: „Zajęty" wg `share_level`
   konta; prywatne/poufne: tylko właściciel). Klient czyta wyłącznie ten widok.

### Sekrety funkcji

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — zarezerwowane, auto-wstrzykiwane.
- `GOOGLE_CLIENT_ID` — ten sam identyfikator co `VITE_GOOGLE_CLIENT_ID`.
- `GOOGLE_CLIENT_SECRET` — sekret klienta OAuth z Google Cloud (Credentials >
  klient „N2 Content Planner Web" > Client secret). **Nigdy w repo ani w
  przeglądarce.**
- `GOOGLE_SYNC_CRON_SECRET` — dowolny losowy ciąg; ten sam trafia do Vault jako
  `n2click_google_sync_secret`.
- `GOOGLE_ALLOWED_ORIGIN` (opcjonalny) — origin aplikacji dla CORS.

```bash
supabase secrets set GOOGLE_CLIENT_ID=866717457340-....apps.googleusercontent.com
supabase secrets set GOOGLE_CLIENT_SECRET=...redacted...
supabase secrets set GOOGLE_SYNC_CRON_SECRET="$(openssl rand -hex 32)"
supabase functions deploy google-calendar-connect
supabase functions deploy google-calendar-sync --no-verify-jwt
```

`--no-verify-jwt` jest KONIECZNE dla `google-calendar-sync`: cron woła ją bez
JWT użytkownika, a funkcja sama sprawdza sekret nagłówka (albo JWT, gdy woła
użytkownik).

### Krok operatora: Google Cloud i Vault

1. Google Cloud (projekt z klientem „N2 Content Planner Web"): włącz **Google
   Calendar API**; na ekranie zgody dodaj zakresy
   `.../auth/calendar.events.readonly` i `.../auth/calendar.calendarlist.readonly`.
   Consent screen musi być w stanie **In production** (w „Testing" refresh
   tokeny wygasają po 7 dniach i sync w tle pada). Bez weryfikacji Google
   użytkownicy zobaczą raz ekran „unverified app" (Advanced > Go to N2Hub);
   limit 100 użytkowników.
2. Vault (SQL editor projektu), żeby cron wiedział, dokąd pukać:

```sql
select vault.create_secret('https://<ref>.supabase.co/functions/v1/google-calendar-sync',
  'n2click_google_sync_url', 'Adres Edge Function sync (N2Hub)');
select vault.create_secret('<ta sama wartość co GOOGLE_SYNC_CRON_SECRET>',
  'n2click_google_sync_secret', 'Sekret nagłówka x-n2-cron-secret');
```

Bez tych dwóch sekretów zadanie crona jest cichym no-opem (funkcja
`google_calendar_sync_tick` wychodzi na początku). Migracja włącza `pg_cron`
i `pg_net` sama (`create extension if not exists`).
