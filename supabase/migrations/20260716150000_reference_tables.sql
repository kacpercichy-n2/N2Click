-- =============================================================================
-- Migracja: 20260716150000_reference_tables
--
-- Słownikowe tabele referencyjne organizacji: statusy lejka, typy usług oraz
-- kategorie prac. To dane wspólne dla całej organizacji — KAŻDY zalogowany
-- użytkownik może je czytać, a modyfikować wyłącznie administrator
-- (istniejąca funkcja app.is_administrator()). Zapis/edycja/usuwanie przechodzi
-- przez RLS, więc kontrole po stronie klienta pozostają wyłącznie UX-em.
--
-- Konwencja (patrz 20260715210000_core_schema): migracja tylko-do-przodu,
-- nazwa YYYYMMDDHHMMSS_opis.sql, RLS włączane w tym samym pliku, revoke all ...
-- from anon, brak `force row level security`. Reużywamy istniejącego triggera
-- app.set_updated_at — bez nowych funkcji pomocniczych.
--
-- Kolumna `sort_order` (nie `order` — słowo zarezerwowane) mapuje `Status.order`
-- z src/types.ts. W trybie supabase te tabele są na razie WYŁĄCZNIE odczytywane
-- i wyświetlane; planer nadal renderuje lokalne słowniki z localStorage do czasu
-- migracji danych planera (lokalne zadania/projekty wskazują na lokalne id).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Statusy lejka (Status z src/types.ts)
-- -----------------------------------------------------------------------------

create table public.statuses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  slug text not null,
  color text not null default '',
  sort_order integer not null default 0,
  archived boolean not null default false,
  is_done boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at
  before update on public.statuses
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- Typy usług (ServiceType z src/types.ts)
-- -----------------------------------------------------------------------------

create table public.service_types (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at
  before update on public.service_types
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- Kategorie prac (WorkCategory z src/types.ts)
-- -----------------------------------------------------------------------------

create table public.work_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at
  before update on public.work_categories
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS: włączone w tym samym pliku (deny-by-default). Odczyt dla wszystkich
-- zalogowanych (dane referencyjne całej organizacji), zapis tylko dla
-- administratora. Bez `force row level security` — spójnie z rdzeniem.
-- -----------------------------------------------------------------------------

alter table public.statuses enable row level security;
alter table public.service_types enable row level security;
alter table public.work_categories enable row level security;

-- Klient anonimowy nie ma w N2Hub żadnych danych — odbieramy mu domyślne
-- uprawnienia nadawane przez Supabase na nowych tabelach w `public`.
revoke all on public.statuses, public.service_types, public.work_categories
from anon;

-- Statusy ---------------------------------------------------------------------

create policy "statuses_select" on public.statuses
  for select to authenticated
  using (true);

create policy "statuses_insert_admin" on public.statuses
  for insert to authenticated
  with check (app.is_administrator());

create policy "statuses_update_admin" on public.statuses
  for update to authenticated
  using (app.is_administrator())
  with check (app.is_administrator());

create policy "statuses_delete_admin" on public.statuses
  for delete to authenticated
  using (app.is_administrator());

-- Typy usług ------------------------------------------------------------------

create policy "service_types_select" on public.service_types
  for select to authenticated
  using (true);

create policy "service_types_insert_admin" on public.service_types
  for insert to authenticated
  with check (app.is_administrator());

create policy "service_types_update_admin" on public.service_types
  for update to authenticated
  using (app.is_administrator())
  with check (app.is_administrator());

create policy "service_types_delete_admin" on public.service_types
  for delete to authenticated
  using (app.is_administrator());

-- Kategorie prac --------------------------------------------------------------

create policy "work_categories_select" on public.work_categories
  for select to authenticated
  using (true);

create policy "work_categories_insert_admin" on public.work_categories
  for insert to authenticated
  with check (app.is_administrator());

create policy "work_categories_update_admin" on public.work_categories
  for update to authenticated
  using (app.is_administrator())
  with check (app.is_administrator());

create policy "work_categories_delete_admin" on public.work_categories
  for delete to authenticated
  using (app.is_administrator());
