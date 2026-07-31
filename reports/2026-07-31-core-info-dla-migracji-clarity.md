# Core info dla agenta migrującego Clarity do wspólnej bazy

**Data:** 2026-07-31
**Projekt Supabase:** `rclcndcgxbpndpmuemww` (eu-central-1, plan Pro)
**Stan:** N2Click jest już przepięty i działa na tej bazie. Schemat `clarity`
jest UTWORZONY, PUSTY i już wystawiony w PostgREST — czeka na Twoje migracje.

Wszystko poniżej odczytane z żywej bazy 2026-07-31, nie z dokumentacji.

---

## 1. Model: schema-per-app

Jeden projekt Supabase hostuje wiele aplikacji rozdzielonych SCHEMATAMI:

| schemat | zawartość |
|---|---|
| `core` | wspólna tożsamość: `profiles`, `companies`, `app_access`, enum `access_role`, hook JWT, trigger signupu |
| `n2click` | 20 tabel domenowych N2Click + 3 widoki-mostki do `core` |
| `clarity` | **PUSTY — Twój** |
| `blogoapp` | pusty, pod przyszłą appkę |
| `public` | PUSTY. Nie tworzyć tam NICZEGO. |

**Exposed schemas w PostgREST** (ustawione, nie zmieniać):
`graphql_public`, `n2click`, `clarity`, `blogoapp`. `core` celowo NIE jest
wystawiony.

Klient Clarity łączy się tak:

```ts
createClient(url, publishableKey, { db: { schema: 'clarity' } })
```

---

## 2. Tożsamość jest WSPÓLNA i mieszka wyłącznie w `core`

Nie twórz w `clarity` własnych `profiles`/`users`/`companies`. Konta są globalne
(`auth.users` → `core.profiles`, ten sam `id`). W bazie jest już 9 profili i
5 spółek — używaj ich, nie duplikuj.

### `core.profiles` (PK `id` = `auth.users.id`, ON DELETE CASCADE)

`id`, `first_name` (NOT NULL, 1–100), `last_name`, `email`, `role_title`,
`access_role` (enum `core.access_role`), `department_id`, `avatar_path`,
`created_at`, `updated_at`, `must_change_password`, `supervisor_id`, `phone`,
`avatar`, `capacity`, `work_days`, `work_start_minutes`, `work_end_minutes`,
`birth_date`, `company_id`, `email_notifications`, `notifications_seen_at`.

Uwaga: `core.profiles.department_id` ma FK do `n2click.departments` — to znane,
świadome sprzężenie `core` z N2Click. **Clarity nie powinna od niego zależeć.**

### `core.companies`

`id` (uuid, default `gen_random_uuid()`), `name` (NOT NULL, 1–200),
`created_at`, `updated_at`.

### `core.app_access` — to ona daje dostęp do appki

```
PRIMARY KEY (user_id, app)
user_id     uuid NOT NULL  FK → auth.users(id) ON DELETE CASCADE
app         text NOT NULL  CHECK (app = ANY (ARRAY['n2click','blogoapp']))
role        text NOT NULL  DEFAULT 'member'
company_id  uuid NOT NULL  FK → core.companies(id)     -- NOT NULL!
created_at  timestamptz NOT NULL DEFAULT now()
```

RLS włączony, ZERO polityk — celowo: pisze `service_role`, czyta hook jako
definer.

> ### ⚠ BLOKER DO DECYZJI: `'clarity'` NIE PRZECHODZI CHECK-a
>
> Constraint `app_access_app_check` dopuszcza wyłącznie `'n2click'` i
> `'blogoapp'`. Wstawienie wiersza z `app='clarity'` **rzuci błędem**.
>
> To było świadome przy przebudowie. Masz dwie drogi:
>
> **A) Wpiąć Clarity we wspólne bramkowanie** — migracja rozszerzająca CHECK:
> ```sql
> alter table core.app_access drop constraint app_access_app_check;
> alter table core.app_access add constraint app_access_app_check
>   check (app = any (array['n2click','blogoapp','clarity']));
> ```
> Nic więcej nie trzeba — hook agreguje WSZYSTKIE wiersze `app_access`
> użytkownika, więc claimy `app_roles.clarity`/`app_company.clarity` pojawią się
> same. Wymaga re-loginu użytkowników Clarity.
>
> **B) Clarity nie używa `core.app_access`** — wtedy musisz zaprojektować własne
> bramkowanie w `clarity` i NIE możesz użyć `core.has_app('clarity')`.
>
> **Zdecyduj to ŚWIADOMIE i zapisz decyzję.** Nie „naprawiaj" CHECK-a mimochodem.

---

## 3. Claimy w JWT i funkcje pomocnicze

Hook Custom Access Token jest WŁĄCZONY (schemat `core`, funkcja
`custom_access_token`). Przy każdym wydaniu tokenu robi:

```sql
select jsonb_object_agg(app, role), jsonb_object_agg(app, company_id)
  from core.app_access where user_id = <user>
```

i wstrzykuje to jako claimy `app_roles` i `app_company`. Przykład realnego JWT:

```json
{ "app_roles":   { "n2click": "admin" },
  "app_company": { "n2click": "95abc035-1af7-4721-a2dc-6ecdd4325d72" } }
```

Gotowe helpery (wszystkie `stable`, `search_path = ''`, czytają `auth.jwt()`):

```sql
core.has_app(p_app text)     -> boolean  -- czy user ma dostęp do appki
core.app_role(p_app text)    -> text     -- rola w tej appce
core.company_for(p_app text) -> uuid     -- spółka w tej appce
```

Trigger `on_auth_user_created` → `core.handle_new_user()` tworzy SZKIELET
profilu w `core.profiles` przy każdym signupie, ale **zero wpisów w
`app_access`** — samo konto nie daje dostępu do żadnej appki.

---

## 4. Jak dosięgnąć tożsamości z Clarity (wzorzec widoku-mostka)

`core` nie jest wystawiony w PostgREST, więc appka nie zapyta o `core.profiles`
przez REST. N2Click rozwiązał to widokami w SWOIM schemacie — zrób tak samo w
`clarity`:

```sql
create view clarity.profiles with (security_invoker = true) as
  select id, first_name, last_name, email, avatar_path, company_id
    from core.profiles;
```

`security_invoker = true` jest OBOWIĄZKOWE — bez tego widok omija RLS pytającego.
Takie widoki są auto-updatable; zweryfikowano empirycznie, że działa przez nie
nawet `upsert ... on conflict`.

**Widok NIE emituje zdarzeń realtime.** Jeśli Clarity ma reagować na zmiany
profili na żywo, subskrybuj `schema: 'core'` obok `schema: 'clarity'` — dokładnie
tak robi N2Click w `CloudSyncProvider`.

---

## 5. ⚠ PUŁAPKA GRANTÓW — przeczytaj przed pierwszą tabelą

Schemat `clarity` ma USTAWIONE DEFAULT PRIVILEGES, które nadają
`anon`, `authenticated` i `service_role` **PEŁNE prawa (arwdDxtm) na każdą nową
tabelę** tworzoną przez rolę `postgres`:

```
r = anon=arwdDxtm/postgres, authenticated=arwdDxtm/postgres, service_role=arwdDxtm/postgres
```

Znaczy to, że **świeżo utworzona tabela w `clarity` jest natychmiast w pełni
otwarta dla `anon`**, dopóki nie włączysz RLS. `anon` ma też USAGE na schemacie.

Dlatego KAŻDA migracja tworząca tabelę musi w TYM SAMYM pliku:

```sql
create table clarity.foo (...);

alter table clarity.foo enable row level security;
revoke all on clarity.foo from anon;

create policy foo_select on clarity.foo for select to authenticated
  using (core.has_app('clarity'));           -- wariant A z sekcji 2
create policy foo_insert on clarity.foo for insert to authenticated
  with check (core.has_app('clarity'));
-- itd. dla update/delete, ZAWSZE z `with check`
```

Zasady obowiązujące w tym projekcie:
- polityki zawsze `to authenticated`, nigdy `to public`
- każda polityka pisząca ma `with check`
- **nie** używać `force row level security` (powoduje rekurencję z helperami
  definer)
- funkcje SECURITY DEFINER: `set search_path = ''` i kwalifikować wszystko
  pełną nazwą; **nigdy nie odwoływać się do `public.*`**

---

## 6. Migracje — uwaga na WSPÓLNY rejestr

Rejestr `supabase_migrations.schema_migrations` jest JEDEN na cały projekt,
współdzielony z N2Click. Konsekwencje:

- Nazywaj pliki `YYYYMMDDHHMMSS_opis.sql`, znacznikiem z momentu tworzenia —
  kolizja wersji z migracją N2Click zablokuje wdrożenie.
- Migracje aplikuj przez MCP `apply_migration` (`supabase db push` wisi na IPv6).
- **Wersja w nazwie pliku w repo MUSI zgadzać się z wersją zapisaną w
  rejestrze.** Rozjazd sprawia, że `db push` odpala migrację po raz drugi. Ta
  pułapka realnie wystąpiła przy N2Click 2026-07-31.
- Pliki zaaplikowane są NIEZMIENNE — poprawki tylko nową migracją do przodu.

---

## 7. Pozostałe konwencje

- **Storage:** nowe buckety z prefiksem `clarity-` (N2Click używa `n2click-`;
  istniejący bucket `avatars` jest współdzielony i zostaje bez zmiany nazwy).
- **Realtime:** publikacja `supabase_realtime` jest wspólna — dodaj do niej
  tabele Clarity jawnie, idempotentnym blokiem `do $$ ... exception when
  duplicate_object`. RLS obowiązuje w realtime (WALRUS).
- **Klucze i connection string:** weź z Dashboard → Settings → API oraz
  Settings → Database. Do GitHub Actions używaj Session poolera (IPv4) —
  direct connection nie działa po IPv6. *Kluczy celowo nie ma w tym dokumencie.*
- **Sesja żyje per domena** — konto jest globalne, ale bez wspólnej domeny
  nadrzędnej użytkownik loguje się w każdej appce osobno tymi samymi danymi.

---

## 8. Czego NIE robić

1. Nie twórz niczego w `public`.
2. Nie duplikuj tożsamości — żadnych `clarity.profiles` jako TABELI.
3. Nie wystawiaj `core` w Exposed schemas.
4. Nie klikaj pomarańczowych pozycji w Dashboard → Data API → Settings →
   „Exposed tables". Podpowiedź brzmi *„Select it to override with standard Data
   API grants"* — kliknięcie NADPISUJE zawężone granty z migracji szerokimi
   domyślnymi dla `anon`/`authenticated`/`service_role`.
5. Nie zmieniaj hooka JWT ani `core.custom_access_token` — obsługuje wszystkie
   appki naraz i działa na produkcji N2Click.
6. Nie ruszaj migracji `20260731*` ani tabel `n2click.*`.

---

## 9. Weryfikacja po Twojej migracji

Skopiuj ten test — sprawdza RLS bez logowania się przez UI:

```sql
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"<uuid-usera>","role":"authenticated",
  "app_roles":{"clarity":"admin"},"app_company":{"clarity":"<uuid-spolki>"}}';
select count(*) from clarity.<tabela>;
rollback;
```

Oraz z linii poleceń, że `anon` NIE ma dostępu (oczekiwany `42501`
„permission denied"):

```bash
curl -s "$URL/rest/v1/<tabela>?select=id&limit=1" \
  -H "apikey: $ANON_KEY" -H "Accept-Profile: clarity"
```
