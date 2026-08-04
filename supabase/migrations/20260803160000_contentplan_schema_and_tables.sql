-- =============================================================================
-- Migracja: 20260803160000_contentplan_schema_and_tables
--
-- Moduł Content Plan (faza R1, plan: handoffs/content-plan-module-plan.md §1-2):
-- NOWY schemat `contentplan` obok `n2click`/`clarity`/`blogoapp` — moduł „żyje
-- z boku”, nic nie dopisujemy do `core` (poza wierszami `core.app_access`
-- w migracji 20260803160300). Kształt tabel wyprowadzony z typowanego modelu
-- root-appki źródłowej („Content plan/src/main.tsx”: Brand / ContentItem /
-- ChannelPost / Comment / ChangeEventLog) plus model mediów plannera
-- („Content plan/planner/…”: {source:'gdrive', fileId, width, height, type}).
-- ŚWIADOMIE ZERO base64 — media to wyłącznie identyfikator pliku na Dysku.
--
-- Konwencja domu (supabase/README.md): pełna kwalifikacja nazw, `enable row
-- level security` w TYM SAMYM pliku, w którym powstaje tabela, `revoke all …
-- from anon`, granty tylko na faktycznie używane verby (żadnego TRUNCATE ani
-- blanket ALL dla ról klienckich), brak `force row level security`. Polityki
-- RLS są w osobnym pliku 20260803160100 — do momentu jego zastosowania tabele
-- są deny-by-default (RLS włączony, zero polityk), co jest bezpiecznym stanem
-- pośrednim. Idempotentnie (`if not exists`) — plik bywa aplikowany ręcznie
-- w SQL editorze, zanim rejestr migracji go dogoni.
--
-- Krok ręczny PO aplikacji: Dashboard → Integrations → Data API → Exposed
-- schemas → dodać `contentplan` (bez tego PostgREST odpowiada 406). Nie klikać
-- „custom grants” w Exposed tables — nadpisuje zawężone granty z tego pliku.
-- =============================================================================

create schema if not exists contentplan;

-- USAGE dla wszystkich trzech ról (przepis z CLAUDE.md). `anon` dostaje sam
-- USAGE — grantów tabelowych NIE dostaje żadnych (moduł jest wyłącznie dla
-- zalogowanych; klucz publishable ma zero dostępu do danych).
grant usage on schema contentplan to anon, authenticated, service_role;

-- ŚWIADOMIE bez `alter default privileges` dla tego schematu: każdy grant
-- tabelowy jest wypisany wprost niżej, żeby nowa tabela nie dostała dostępu
-- przez przypadek (precedens: `public` przemyciło TRUNCATE dla anon).

-- -----------------------------------------------------------------------------
-- Marki (Brand). `platforms` to jsonb tablica {id,name,color} — słownik kanałów
-- należy do marki, nie do systemu. `topics`/`formats` to słowniki tematów
-- i formatów marki.
-- -----------------------------------------------------------------------------

create table if not exists contentplan.brands (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  industry text not null default '' check (char_length(industry) <= 200),
  contact text not null default '' check (char_length(contact) <= 300),
  accent text not null default '' check (char_length(accent) <= 40),
  platforms jsonb not null default '[]'::jsonb check (jsonb_typeof(platforms) = 'array'),
  topics text[] not null default '{}',
  formats text[] not null default '{}',
  -- Luźne powiązanie z klientem N2Click (plan §2 pkt 5). CELOWO BEZ FK:
  -- klucz obcy między schematami zamroziłby `contentplan` na cyklu życia
  -- `n2click` (drop/move tabeli klientów wywracałby moduł), a moduł ma działać
  -- samodzielnie. Spójność pilnuje UI przy podpinaniu marki do klienta.
  n2click_client_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists brands_set_updated_at on contentplan.brands;
create trigger brands_set_updated_at
  before update on contentplan.brands
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- Posty (ContentItem). `visibility` steruje przyszłym portalem klienta:
-- 'draft' widzą tylko admin/editor, 'published' także rola `client` (patrz
-- polityki w 20260803160100).
-- -----------------------------------------------------------------------------

create table if not exists contentplan.posts (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references contentplan.brands(id) on delete cascade,
  date date not null,
  title text not null default '' check (char_length(title) <= 300),
  topic text not null default '' check (char_length(topic) <= 200),
  format text not null default '' check (char_length(format) <= 200),
  status text not null default '' check (char_length(status) <= 100),
  visibility text not null default 'draft' check (visibility in ('draft', 'published')),
  base_tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists posts_set_updated_at on contentplan.posts;
create trigger posts_set_updated_at
  before update on contentplan.posts
  for each row execute function app.set_updated_at();

create index if not exists posts_brand_id_idx on contentplan.posts (brand_id);
create index if not exists posts_brand_date_idx on contentplan.posts (brand_id, date);

-- -----------------------------------------------------------------------------
-- Kanały posta (ChannelPost): wariant treści per platforma. Media z Dysku
-- Google — `media_source` ma dziś jedyną dozwoloną wartość 'gdrive' (CHECK jest
-- listą, żeby dołożenie źródła było ALTER-em CHECK-a, nie migracją danych).
-- -----------------------------------------------------------------------------

create table if not exists contentplan.post_channels (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references contentplan.posts(id) on delete cascade,
  platform_id text not null check (char_length(platform_id) between 1 and 100),
  copy text not null default '',
  tags text[] not null default '{}',
  override_tags boolean not null default false,
  description_group_id text check (description_group_id is null or char_length(description_group_id) <= 100),
  media_source text check (media_source is null or media_source in ('gdrive')),
  media_file_id text check (media_file_id is null or char_length(media_file_id) <= 300),
  media_width integer check (media_width is null or media_width > 0),
  media_height integer check (media_height is null or media_height > 0),
  media_type text check (media_type is null or media_type in ('image', 'video')),
  created_at timestamptz not null default now(),
  -- Plik z Dysku nie istnieje bez źródła: `media_file_id` wymaga `media_source`.
  check (media_file_id is null or media_source is not null)
);

create index if not exists post_channels_post_id_idx on contentplan.post_channels (post_id);

-- -----------------------------------------------------------------------------
-- Komentarze (Comment) — wątkowane przez `parent_id`, DOPISYWALNE (append-only,
-- parytet z n2click.comments/activity_events: brak UPDATE/DELETE w politykach,
-- sprzątanie idzie kaskadą FK przy usunięciu posta).
-- -----------------------------------------------------------------------------

create table if not exists contentplan.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references contentplan.posts(id) on delete cascade,
  author text not null default '' check (char_length(author) <= 200),
  body text not null check (char_length(body) between 1 and 5000),
  at timestamptz not null default now(),
  parent_id uuid references contentplan.comments(id) on delete cascade
);

create index if not exists comments_post_id_idx on contentplan.comments (post_id);
create index if not exists comments_parent_id_idx on contentplan.comments (parent_id);

-- -----------------------------------------------------------------------------
-- Historia zmian posta (ChangeEventLog) — również append-only.
-- -----------------------------------------------------------------------------

create table if not exists contentplan.post_history (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references contentplan.posts(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 500),
  at timestamptz not null default now()
);

create index if not exists post_history_post_id_idx on contentplan.post_history (post_id);

-- -----------------------------------------------------------------------------
-- Pamięć folderów Dysku Google: (marka, miesiąc) → folder. Zastępuje
-- localStorage `n2planner.driveParents` z appki źródłowej. Klucz główny jest
-- naturalny — jeden folder na markę i miesiąc.
-- -----------------------------------------------------------------------------

create table if not exists contentplan.drive_folders (
  brand_id uuid not null references contentplan.brands(id) on delete cascade,
  month_key text not null check (month_key ~ '^[0-9]{4}-[0-9]{2}$'),
  folder_id text not null check (char_length(folder_id) between 1 and 300),
  updated_at timestamptz not null default now(),
  primary key (brand_id, month_key)
);

-- Ten sam trigger co na markach i postach: wskazanie nowego folderu dla tej
-- samej pary (marka, miesiąc) idzie UPDATE-em/upsertem, więc `updated_at` musi
-- odświeżać się po stronie bazy, nie klienta.
drop trigger if exists drive_folders_set_updated_at on contentplan.drive_folders;
create trigger drive_folders_set_updated_at
  before update on contentplan.drive_folders
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- Deny-by-default: RLS na KAŻDEJ tabeli w pliku, który ją tworzy.
-- -----------------------------------------------------------------------------

alter table contentplan.brands enable row level security;
alter table contentplan.posts enable row level security;
alter table contentplan.post_channels enable row level security;
alter table contentplan.comments enable row level security;
alter table contentplan.post_history enable row level security;
alter table contentplan.drive_folders enable row level security;

-- -----------------------------------------------------------------------------
-- Granty: `anon` traci wszystko, `authenticated` dostaje wyłącznie verby, które
-- moduł realnie wykonuje (komentarze i historia są dopisywalne, więc bez
-- UPDATE/DELETE), `service_role` pełne DML (bez TRUNCATE).
-- -----------------------------------------------------------------------------

revoke all on contentplan.brands from anon;
revoke all on contentplan.posts from anon;
revoke all on contentplan.post_channels from anon;
revoke all on contentplan.comments from anon;
revoke all on contentplan.post_history from anon;
revoke all on contentplan.drive_folders from anon;

grant select, insert, update, delete on contentplan.brands to authenticated;
grant select, insert, update, delete on contentplan.posts to authenticated;
grant select, insert, update, delete on contentplan.post_channels to authenticated;
grant select, insert on contentplan.comments to authenticated;
grant select, insert on contentplan.post_history to authenticated;
grant select, insert, update, delete on contentplan.drive_folders to authenticated;

grant select, insert, update, delete on contentplan.brands to service_role;
grant select, insert, update, delete on contentplan.posts to service_role;
grant select, insert, update, delete on contentplan.post_channels to service_role;
grant select, insert, update, delete on contentplan.comments to service_role;
grant select, insert, update, delete on contentplan.post_history to service_role;
grant select, insert, update, delete on contentplan.drive_folders to service_role;
