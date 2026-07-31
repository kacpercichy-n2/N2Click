# Handoff: przepięcie N2Click na nową architekturę bazy (schema-per-app)

**Dla:** agenta/operatora prowadzącego wdrożenie N2Click
**Od:** agenta wykonującego przebudowę bazy (handoff źródłowy:
`RaportyClarity/handoffs/n2hub-db-restructure-handoff.md`)
**Data:** 2026-07-31
**Projekt Supabase:** `rclcndcgxbpndpmuemww` (eu-central-1)

---

## 1. Stan zastany — co jest JUŻ zrobione (nie powtarzać)

Cała warstwa bazodanowa i kodowa jest wdrożona i zweryfikowana (testy RLS na
żywej bazie, `npm test` 2209/2209, build zielony, niezależna weryfikacja
adwersaryjna Opus 5 — znaleziska naprawione). Szczegóły i dowody:
`reports/2026-07-31-faza0-audyt-db-restructure.md` (z aneksem weryfikacji).

### Baza (13 migracji `20260731*`, zlustrzane w `supabase/migrations/`)

- Schematy: `core` (tożsamość: `profiles`, `companies`, `app_access`, enum
  `access_role`, hook `core.custom_access_token`, trigger `on_auth_user_created`),
  `n2click` (20 tabel domenowych + `bingo_today()`), `clarity` i `blogoapp`
  (puste, z grantami — pod przyszłe migracje innych appek), `public` (puste —
  niczego tam nie tworzyć).
- RLS: każda polityka `authenticated` wymaga claimu `core.has_app('n2click')`
  z JWT; tabele łańcucha projektowego (tasks, milestones, comments,
  workload_entries, task_assignments) dodatkowo tną po spółce
  (`app.company_ok_project/task`; NULL company projektu = wspólny, claim
  `admin` widzi wszystko). Wyjątek: `bingo_lines`/`bingo_marks` — anon, celowo.
- `core` NIE jest (i nie ma być) wystawiony w PostgREST — appka używa
  widoków-mostków `n2click.profiles` / `n2click.companies` /
  `n2click.app_access` (security_invoker; upsert ON CONFLICT przez widok
  działa — zweryfikowane empirycznie).
- Nowe konto w `auth.users` dostaje automatycznie profil w `core.profiles`
  (trigger), ale ZERO dostępów — dostęp do appki nadaje wpis w
  `core.app_access` (robi to Edge Function przy provisioningu albo admin przez
  service_role).

### Kod (zmiany w repo N2click, NIEZACOMMITOWANE — patrz sekcja 4)

- `src/supabase/client.ts` — `createClient(..., { db: { schema: 'n2click' } })`.
- `src/supabase/CloudSyncProvider.tsx` — realtime nasłuchuje DWÓCH schematów:
  `n2click` i `core` (profiles/companies są w publikacji jako tabele bazowe).
- `supabase/functions/provision-account/` — v5 WDROŻONA na Supabase: domyślny
  schemat `n2click`, UPSERT profilu (koegzystencja z triggerem), `company_id`
  wywołującego admina zapisywany do profilu ORAZ do `app_access`.
- `supabase/migrations/` + `src/supabase/migrations.test.ts` — 13 nowych
  plików + zaktualizowany rejestr.
- `.github/workflows/db-backup.yml` — nocne dumpy per schemat (uśpione do
  czasu dodania sekretu, sekcja 3 pkt 3).
- Wiki: `openwiki/n2hub/cloud-database.md` opisuje nową architekturę.

---

## 2. Do wykonania: przepięcie (kolejność OBOWIĄZKOWA)

Uwaga operacyjna: między krokiem 2.2 a końcem 2.4 aplikacja jest PUSTA dla
wszystkich użytkowników (PostgREST nie wystawia jeszcze `n2click`, a stare
tokeny nie mają claimów). To zaplanowane okno serwisowe — najpierw komunikat
do zespołu (9 osób), potem klikanie.

### 2.1 Komunikat do zespołu

Zapowiedzieć przerwę i obowiązkowe przelogowanie po jej zakończeniu.

### 2.2 Dashboard → Settings → API → Exposed schemas

Ustawić dokładnie: `n2click`, `clarity`, `blogoapp`.
- USUNĄĆ `public` z listy.
- NIE dodawać `core` (to nie pomyłka — tożsamość idzie przez widoki-mostki).

### 2.3 Dashboard → Authentication → Hooks → Custom Access Token

Włączyć hook → funkcja `core.custom_access_token` (schemat `core`).
Bez tego JWT nie ma claimów `app_roles`/`app_company` i RLS tnie wszystko.

### 2.4 Deploy frontu + re-login zespołu

1. Zbudować i wdrożyć aktualny stan repo (zmiany z sekcji 1; przed deployem
   commit — sekcja 4).
2. Cały zespół: wylogować i zalogować ponownie (stary refresh token odświeży
   się sam z czasem, ale re-login daje claimy natychmiast).

### 2.5 Smoke-test (checklista odbioru przepięcia)

Na koncie admina po re-loginie:
- [ ] login przechodzi, dashboard pokazuje projekty/zadania (dane sprzed
      przepięcia: 25 projektów, ~73 zadania, 9 profili),
- [ ] CRUD: utworzyć/edytować/usunąć testowe zadanie i projekt,
- [ ] edycja własnego profilu (idzie przez widok-mostek) + avatar (storage),
- [ ] komentarz pod zadaniem + wpis w dzienniku aktywności,
- [ ] realtime: zmiana na drugim urządzeniu/karcie pojawia się live; edycja
      PROFILU też wyzwala odświeżenie (to test schematu `core`),
- [ ] provisioning: założyć konto testowe przez Zespół → Utwórz konto;
      sprawdzić w SQL, że ma `core.profiles.company_id` ORAZ wpis w
      `core.app_access` (obie wartości = spółka zakładającego admina),
- [ ] świeże konto BEZ wpisu w `app_access` (np. utworzone bezpośrednio w
      Auth) po zalogowaniu widzi pustą appkę — i to jest POPRAWNE zachowanie,
- [ ] JWT (np. z devtools) zawiera claimy `app_roles.n2click` i
      `app_company.n2click`.

Jeśli coś nie działa: NIE cofać migracji. Najczęstsza przyczyna to brakujący
krok 2.2/2.3 albo stary token (re-login). Diagnoza: Dashboard → Logs → API.

### 2.6 Po zielonym smoke-teście

- Zweryfikować, że `public` nie jest już w Exposed schemas (krok 2.2 zrobił to
  od razu — tu tylko kontrola).
- Odpalić ręcznie workflow `db-backup` (sekcja 3 pkt 3) i sprawdzić artefakty.

---

## 3. Zadania okołowdrożeniowe (mogą iść po przepięciu)

1. **Commit zmian repo** (sekcja 4) — przed lub w ramach deployu.
2. **Leaked password protection** (jedyny WARN advisora, sprzed przebudowy):
   Dashboard → Authentication → Passwords → włączyć.
3. **Backupy nocne:** dodać sekret repo GitHub `SUPABASE_DB_URL` = connection
   string **Session poolera (IPv4)** z Dashboard → Settings → Database.
   Workflow `.github/workflows/db-backup.yml` robi wtedy co noc osobne dumpy
   `core`/`n2click`/`clarity`/`blogoapp` (artefakty, 30 dni). Direct connection
   nie zadziała z GitHub Actions po IPv6 — stąd pooler.
4. **Upgrade planu na Pro + Spend Cap ON** — decyzja właściciela, niezależna
   technicznie od przepięcia, ale warunek dalszej roadmapy (konsolidacja
   Clarity).
5. **Sygnał dla agenta Clarity** (krok 2 roadmapy): po odbiorze przekazać mu
   URL projektu, klucze anon/service_role i connection string. Schemat
   `clarity` czeka pusty, jest już w Exposed schemas po kroku 2.2. Clarity NIE
   podpina się pod globalne konto (`'clarity'` celowo poza checkiem
   `app_access.app`) — nie „naprawiać" tego.
6. **Test podziału na spółki na dedykowanych kontach:** wszystkie 9 kont
   produkcyjnych to admini (kolaps ról 2026-07-22), więc z definicji widzą
   wszystko i nie nadają się do testu „spółka A nie widzi B". Założyć 2 konta
   testowe z `app_access.role='member'` i różnymi `company_id`, nadać
   projektowi spółkę i sprawdzić odcięcie łańcucha (projekt → zadania →
   komentarze → workload).

---

## 4. Stan repo do commitu

Zmiany związane z przepięciem (oddzielić od niepowiązanych modyfikacji
scheduler/WeekView, które były w drzewie wcześniej!):

- `src/supabase/client.ts`, `src/supabase/CloudSyncProvider.tsx`
- `supabase/functions/provision-account/index.ts`, `contract.ts`
- `supabase/migrations/20260731*.sql` (13 plików)
- `src/supabase/migrations.test.ts`
- `.github/workflows/db-backup.yml`
- `openwiki/n2hub/cloud-database.md`
- `reports/2026-07-31-faza0-audyt-db-restructure.md` (audyt + aneks
  weryfikacji), ten handoff

---

## 5. Zasady na przyszłość (dla każdego, kto dotyka bazy)

- Nowe tabele N2Click → schemat `n2click`; wspólna tożsamość → wyłącznie
  `core`; w `public` nie tworzymy NICZEGO.
- Nowa polityka RLS `authenticated` MUSI zawierać `core.has_app('n2click')`;
  funkcje definer odwołują się do `core.*`/`n2click.*`, nigdy `public.*`.
- Dostęp konta do appki = wpis w `core.app_access` (nigdy sam signup).
- Nowe buckety Storage: prefiks `n2click-` (konwencja per appka; istniejący
  `avatars` zostaje bez zmiany nazwy).
- Migracje: plik w `supabase/migrations/` + wpis w `migrations.test.ts`
  (klucze `EXPECTED_POLICIES` zostają historycznie `public.*` — test parsuje
  stary tekst migracji, nie żywą bazę).

## 6. Znane, świadome odstępstwa i ograniczenia

- `clients` bez gatingu spółki (brak kolumny/relacji spółki w modelu — klient
  może obsługiwać wiele spółek); `tickets` prywatne per reporter.
- FK `core.profiles.department_id → n2click.departments` wiąże core z
  N2Click — do ewentualnego rozplątania osobną decyzją, nic dziś nie psuje.
- `core.app_access` ma RLS bez polityk (INFO w advisorze — celowe: pisze
  service_role, czyta hook).
- Sesja żyje per domena: konto jest globalne, ale bez wspólnej domeny
  nadrzędnej użytkownik loguje się na każdej appce osobno tymi samymi danymi
  (nota produktowa z handoffu źródłowego).
