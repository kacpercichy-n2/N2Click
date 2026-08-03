# Raport workflow: 20260803-165046-n2hub-311-contentplan-schemat-bazy

## Wykonane

Faza R1 modułu Content Plan: fundament bazodanowy schematu `contentplan` — wyłącznie
pliki migracji w repo, NIC nie zostało zaaplikowane do żadnej bazy (bez połączeń,
bez MCP). Routing tier: `developer → reviewer`; werdykt reviewera: APPROVED.

Model domenowy wyprowadzony ze źródła: `"/Users/kacpercichyn2/Documents/AI/N2Media/Content plan/src/main.tsx"`
(linie 53–138: Brand, ContentItem, ChannelPost, Comment, statusy) oraz
`"/Users/kacpercichyn2/Documents/AI/N2Media/Content plan/planner/src/data/posts.js"`
(model mediów gdrive). Konwencje wg `openwiki/n2hub/cloud-database.md` i istniejących
migracji schema-per-app (bannery po polsku, pełna kwalifikacja nazw, idempotencja).

## Zmiany

- `supabase/migrations/20260803160000_contentplan_schema_and_tables.sql` — nowy:
  schemat `contentplan` + `grant usage` (anon/authenticated/service_role); tabele
  `brands` (z `n2click_client_id uuid null` celowo BEZ FK między schematami),
  `posts`, `post_channels`, `comments`, `post_history`, `drive_folders`
  (PK `(brand_id, month_key)`); FK `on delete cascade` na potomkach posta, indeksy
  na FK filtrujących; triggery `app.set_updated_at()` na `brands`, `posts`
  i `drive_folders`; `enable row level security` na KAŻDEJ tabeli w tej samej
  migracji; `revoke all` dla anon, granty tabelowe tylko na używane verby
  (`comments`/`post_history` append-only: select+insert), zero TRUNCATE/ALL.
- `supabase/migrations/20260803160100_contentplan_rls_policies.sql` — nowy: polityki
  pełnego dostępu per komenda dla `core.has_app('contentplan')` z rolą
  `admin`/`editor` (`core.app_role('contentplan')`); dodatkowo uśpione polityki
  roli `client` (select wyłącznie `visibility='published'` w obrębie przypisanej
  marki) — istnieją w SQL, ścieżka client nie jest nigdzie używana i dziś
  „fails closed".
- `supabase/migrations/20260803160200_contentplan_my_access_view.sql` — nowy:
  widok-mostek `contentplan.my_access (user_id, role)` nad `core.app_access`,
  ograniczony do `auth.uid()` i `app='contentplan'`; `security_invoker = off`
  ze scopingiem w definicji widoku (bo `core.app_access` ma RLS bez polityk
  i bez grantów dla authenticated — widok invoker zawsze by odmawiał);
  grant tylko select.
- `supabase/migrations/20260803160300_contentplan_seed_app_access.sql` — nowy:
  idempotentny seed `core.app_access` (`app='contentplan'`, `role='admin'`,
  `on conflict (user_id, app) do nothing`) dla użytkowników z wpisem
  `app='n2click'`, `role='admin'` — zgodnie z decyzją operatora z 2026-08-03
  (moduł na start tylko dla administratorów). Konieczna minimalna zmiana w core:
  rozszerzenie CHECK `core.app_access.app` o `'contentplan'` (constraint
  z 20260731081703 odrzuciłby INSERT); drop przez lookup w `pg_constraint`
  + re-add, udokumentowane w bannerze. Reviewer zaadjudykował to jako wymuszone,
  minimalne rozszerzenie granicy — zaakceptowane.
- `src/supabase/migrations.test.ts` — rejestracja 4 nowych plików w liście migracji
  i 6 kluczy `contentplan.*` w `EXPECTED_POLICIES` (test odrzuca polityki na
  niezarejestrowanych tabelach). To wymóg logiki testu, nie kod frontendu.

## Weryfikacja

- `npm test`: 107 plików / 2337 testów zielone, w tym `src/supabase/migrations.test.ts`
  (17 testów; wszystkie 34 nowe polityki przechodzą regexy konwencji, każda
  insert/update ma `with check`).
- `npm run build`: zielony (2.94s).
- Review (agent reviewer, read-only): APPROVED, bez blockerów; zweryfikował
  zgodność z planem §1–2, modelem źródłowym, konwencjami repo i bezpieczeństwo
  polityk (client nie otwiera nic szerzej niż published/marka).
- Wiki: `wiki unchanged` — `openwiki/n2hub/cloud-database.md` opisuje żywą bazę,
  a schemat contentplan jest repo-only (niezaaplikowany, nieeksponowany); sekcję
  contentplan w wiki plan przypisuje fazie hardeningu R9.
- Gate (`npm test && npm run build`): oczekuje na scheduler

## Ryzyka / rzeczy do sprawdzenia

- **Dwa ręczne kroki operatora PO review** (kolejność): (a) aplikacja 4 migracji
  przez operatora (nic nie zostało zaaplikowane w tym runie), (b) dodanie
  `contentplan` do Exposed schemas w dashboardzie Supabase (Integrations →
  Data API → Settings) — bez tego PostgREST odpowiada 406; NIE klikać
  „custom grants" w Exposed tables.
- Istniejące sesje adminów nie dostaną claimu `contentplan` w JWT aż do odświeżenia
  tokenu / re-loginu po zaaplikowaniu seeda — do tego czasu `my_access` będzie
  puste, a RLS odmówi.
- Uśpiona polityka `client` porównuje `core.company_for('contentplan')`
  (FK do `core.companies`) z `brands.n2click_client_id` (docelowo id z
  `n2click.clients`) — dziś niespełnialna (fails closed); faza portalu klienta
  musi podmienić ten predykat na realny model przypisania marki (opisane
  w bannerze migracji RLS). Rola `client` ma pozostać nieużywana do tego czasu.
- `brands.id` to uuid, źródłowa appka używa slugów (`lentria`); tagi w źródle są
  pojedynczym stringiem, w bazie `text[]` — mapowanie należy do faz R2/R6 (mapper),
  celowo poza zakresem R1.
- Automatyczny skan deny-by-default w `migrations.test.ts` matchuje tylko
  `create table public.*` — RLS tabel contentplan sprawdzono w review ręcznie;
  warto rozszerzyć regex w fazie R9.
- Tryb retirement pozostaje wyłączony (zgodnie z promptem).

## Podpis schedulera

- Run: `20260803-165046-n2hub-311-contentplan-schemat-bazy`
- Prompt: `311-contentplan-schemat-bazy.md`
- Projekt: N2Hub (N2Click)
- Gałąź review: `review-integration`
- Baza: `75f5e5beb37b161bfa9e3136082f402b77bb880c`


## Gate schedulera

- Gate (`npm test && npm run build`): zaliczony
- Baza: `75f5e5beb37b161bfa9e3136082f402b77bb880c`
- Gałąź review: `review-integration`
- Run: `20260803-165046-n2hub-311-contentplan-schemat-bazy`

### Pliki zgłoszone do review

- `src/supabase/migrations.test.ts`
- `handoffs/scheduler-reviews/20260803-165046-n2hub-311-contentplan-schemat-bazy.md`
- `supabase/migrations/20260803160000_contentplan_schema_and_tables.sql`
- `supabase/migrations/20260803160100_contentplan_rls_policies.sql`
- `supabase/migrations/20260803160200_contentplan_my_access_view.sql`
- `supabase/migrations/20260803160300_contentplan_seed_app_access.sql`
