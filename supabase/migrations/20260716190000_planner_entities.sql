-- =============================================================================
-- Migracja: 20260716190000_planner_entities
--
-- Encje planera przenoszone do Supabase w kroku migracji zapisu danych: klienci,
-- komentarze i dziennik aktywności (nowe tabele) oraz brakujące kolumny
-- planera na istniejących `projects` i `tasks`. Zapisy chmury idą przez czystą
-- warstwę repozytorium (src/supabase/plannerData.ts) i lustro diff-owe za
-- AppStore (src/supabase/cloudMirror.ts); hydracja przy logowaniu scala wiersze
-- jedną akcją reduktora (MERGE_CLOUD_ENTITIES). GODZINY (workload) NIGDY nie
-- opuszczają przeglądarki — nie ma tabeli `workload`.
--
-- Konwencja (patrz 20260715210000_core_schema): migracja tylko-do-przodu,
-- nazwa YYYYMMDDHHMMSS_opis.sql, RLS włączane w tym samym pliku co tabela,
-- `revoke all ... from anon`, brak `force row level security`, polityki wyłącznie
-- `to authenticated`, insert/update z `with check`. Reużywamy istniejących
-- funkcji pomocniczych `app.*` (is_administrator / current_access_role /
-- manages_project / is_project_member / manages_task / is_assigned_to_task) oraz
-- triggera `app.set_updated_at` — bez nowych funkcji pomocniczych.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Klienci (Client z src/types.ts). Dane referencyjne biznesu: każdy zalogowany
-- musi renderować nazwy klientów na widocznych projektach, więc SELECT jest
-- otwarty (`using (true)`). Tworzyć klienta może administrator albo menedżer
-- (SAVE_PROJECT menedżera może utworzyć klienta atomowo przez `newClientName`);
-- edycja/usuwanie wyłącznie administrator (lokalne `clients.manage` handlowca
-- degraduje się w chmurze do workera — prawda RLS wg ustalenia z kroku 209).
-- -----------------------------------------------------------------------------

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at
  before update on public.clients
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- Komentarze (Comment z src/types.ts). Wiersz wisi na projekcie ALBO zadaniu
-- (dokładnie jedna referencja). Model lokalny nie ma edycji/usuwania komentarza,
-- więc tabela jest DOPISYWALNA (append-only): brak polityk UPDATE/DELETE, a
-- usunięcie encji sprząta komentarze kaskadą FK.
-- -----------------------------------------------------------------------------

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects (id) on delete cascade,
  task_id uuid references public.tasks (id) on delete cascade,
  check (num_nonnulls(project_id, task_id) = 1),
  author_id uuid references public.profiles (id) on delete set null,
  body text not null check (char_length(body) between 1 and 10000),
  mention_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create index comments_project_id_idx on public.comments (project_id);
create index comments_task_id_idx on public.comments (task_id);

-- -----------------------------------------------------------------------------
-- Dziennik aktywności (ActivityEvent z src/types.ts). Log DOPISYWALNY: brak
-- UPDATE/DELETE. `entity_id` przenosi lokalny identyfikator encji dosłownie
-- (wierność round-tripu, bez FK). Typowane FK `project_id`/`task_id` ustawiane są
-- wyłącznie dla wierszy projektu/zadania — istnieją dla RLS i kaskady.
-- `created_by` (domyślnie auth.uid()) to autorytatywny autor wiersza po stronie
-- serwera; `actor_id`/`impersonator_id` to atrybucja przeniesiona z lokalnego logu.
-- -----------------------------------------------------------------------------

create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (
    entity_type in ('project', 'task', 'person', 'status', 'client', 'system')
  ),
  entity_id text not null default '',
  project_id uuid references public.projects (id) on delete cascade,
  task_id uuid references public.tasks (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  impersonator_id uuid references public.profiles (id) on delete set null,
  created_by uuid not null default auth.uid() references public.profiles (id),
  message text not null,
  created_at timestamptz not null default now()
);

create index activity_events_project_id_idx on public.activity_events (project_id);
create index activity_events_task_id_idx on public.activity_events (task_id);
create index activity_events_created_by_idx on public.activity_events (created_by);

-- -----------------------------------------------------------------------------
-- Kolumny planera na istniejących tabelach. Wszystkie NULLABLE/z domyślną
-- wartością, więc już zaimportowane wiersze (krok 208) pozostają poprawne, a
-- istniejące polityki `projects_*`/`tasks_*` obejmują je automatycznie.
-- -----------------------------------------------------------------------------

alter table public.projects
  add column client_id uuid references public.clients (id) on delete set null,
  add column status_id uuid references public.statuses (id) on delete set null,
  add column paid boolean not null default false,
  add column start_date date,
  add column end_date date,
  add column service_type_id uuid references public.service_types (id) on delete set null;

alter table public.tasks
  add column status_id uuid references public.statuses (id) on delete set null,
  add column start_date date,
  add column end_date date,
  add column estimated_hours numeric,
  add column priority text not null default 'normal' check (
    priority in ('low', 'normal', 'high', 'urgent')
  ),
  add column work_category_id uuid references public.work_categories (id) on delete set null,
  add column checklist jsonb not null default '[]'::jsonb;

-- -----------------------------------------------------------------------------
-- RLS: włączone w tym samym pliku (deny-by-default), anon traci uprawnienia.
-- Bez `force row level security` — spójnie z rdzeniem (rekursja funkcji definer).
-- -----------------------------------------------------------------------------

alter table public.clients enable row level security;
alter table public.comments enable row level security;
alter table public.activity_events enable row level security;

revoke all on public.clients, public.comments, public.activity_events from anon;

-- Klienci ---------------------------------------------------------------------

create policy "clients_select" on public.clients
  for select to authenticated
  using (true);

create policy "clients_insert" on public.clients
  for insert to authenticated
  with check (app.is_administrator() or app.current_access_role() = 'manager');

create policy "clients_update_admin" on public.clients
  for update to authenticated
  using (app.is_administrator())
  with check (app.is_administrator());

create policy "clients_delete_admin" on public.clients
  for delete to authenticated
  using (app.is_administrator());

-- Komentarze (append-only: brak UPDATE/DELETE) --------------------------------

create policy "comments_select" on public.comments
  for select to authenticated
  using (
    app.is_administrator()
    or (
      project_id is not null
      and (app.manages_project(project_id) or app.is_project_member(project_id))
    )
    or (
      task_id is not null
      and (app.manages_task(task_id) or app.is_assigned_to_task(task_id))
    )
  );

create policy "comments_insert" on public.comments
  for insert to authenticated
  with check (
    (
      app.is_administrator()
      or (
        project_id is not null
        and (app.manages_project(project_id) or app.is_project_member(project_id))
      )
      or (
        task_id is not null
        and (app.manages_task(task_id) or app.is_assigned_to_task(task_id))
      )
    )
    and (app.is_administrator() or author_id = (select auth.uid()))
  );

-- Dziennik aktywności (append-only: brak UPDATE/DELETE) ------------------------

create policy "activity_events_select" on public.activity_events
  for select to authenticated
  using (
    app.is_administrator()
    or created_by = (select auth.uid())
    or (
      project_id is not null
      and (app.manages_project(project_id) or app.is_project_member(project_id))
    )
    or (
      task_id is not null
      and (app.manages_task(task_id) or app.is_assigned_to_task(task_id))
    )
  );

create policy "activity_events_insert" on public.activity_events
  for insert to authenticated
  with check (created_by = (select auth.uid()));
