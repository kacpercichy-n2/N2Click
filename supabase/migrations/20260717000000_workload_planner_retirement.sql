-- =============================================================================
-- Migracja: 20260717000000_workload_planner_retirement
--
-- Ostatnia grupa danych planera przenoszona do Supabase: ZAPLANOWANE GODZINY
-- (WorkloadEntry — bloki kalendarza + zasobnik) oraz KAMIENIE MILOWE (Milestone).
-- Dodaje też `app_settings` — ogólnoorganizacyjne flagi runtime, w tym znacznik
-- wycofania aktywnych zapisów localStorage po weryfikacji migracji. Zapisy chmury
-- idą przez czystą warstwę repozytorium (src/supabase/plannerData.ts) i lustro
-- diff-owe za AppStore (src/supabase/cloudMirror.ts); hydracja przy logowaniu
-- scala wiersze jedną akcją reduktora (MERGE_CLOUD_ENTITIES).
--
-- Konwencja (patrz 20260715210000_core_schema): migracja tylko-do-przodu,
-- nazwa YYYYMMDDHHMMSS_opis.sql, RLS włączane w tym samym pliku co tabela,
-- `revoke all ... from anon`, brak `force row level security`, polityki wyłącznie
-- `to authenticated`, insert/update z `with check`. Reużywamy istniejących
-- funkcji pomocniczych `app.*` (is_administrator / manages_task / manages_project
-- / is_project_member / is_assigned_to_task / profile_in_department /
-- current_department_id) oraz triggera `app.set_updated_at` — BEZ nowych funkcji.
--
-- Inwarianty siatki są egzekwowane lokalnie jak dotąd; tutaj kodujemy je jako
-- CHECK-i i indeks częściowy „belt-and-braces”, a hydracja i tak rewaliduje
-- wiersze (niepoprawne są WYKLUCZANE z polską diagnostyką, nigdy scalane).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Zaplanowane godziny (WorkloadEntry z src/types.ts). Lokalny UUID = klucz
-- główny w chmurze. `work_date IS NULL` to sentinel zasobnika (lokalne `''`).
-- Zakres ról jak dla zadań: administrator globalnie, menedżer zadania swojego
-- działu (zapis tylko dla osób z jego działu), pracownik własne wiersze.
-- -----------------------------------------------------------------------------

create table public.workload_entries (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  work_date date,
  planned_hours numeric not null,
  start_minutes integer not null default 0,
  sort_index integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (planned_hours > 0),
  check (mod(planned_hours * 4, 1) = 0),
  check (start_minutes >= 0 and start_minutes % 15 = 0),
  check (work_date is null or planned_hours <= 24),
  check (work_date is null or start_minutes + planned_hours * 60 <= 1440),
  check (work_date is not null or start_minutes = 0)
);

create trigger set_updated_at
  before update on public.workload_entries
  for each row execute function app.set_updated_at();

-- Jeden wiersz zasobnika na parę (task_id, profile_id) — indeks częściowy.
create unique index workload_entries_bin_pair
  on public.workload_entries (task_id, profile_id)
  where work_date is null;

create index workload_entries_task_id_idx on public.workload_entries (task_id);
create index workload_entries_profile_id_idx on public.workload_entries (profile_id);
create index workload_entries_profile_date_idx
  on public.workload_entries (profile_id, work_date);

-- -----------------------------------------------------------------------------
-- Kamienie milowe (Milestone z src/types.ts). Kolumna `milestone_date` (nie
-- `date` — słowo zarezerwowane; wzorzec `statuses.sort_order`). Widoczność wg
-- projektu; zapis dla administratora albo menedżera projektu (lokalne edycje
-- pracownika, które RLS odrzuci, zostają lokalnie — jak przy klientach).
-- -----------------------------------------------------------------------------

create table public.milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 300),
  milestone_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at
  before update on public.milestones
  for each row execute function app.set_updated_at();

create index milestones_project_id_idx on public.milestones (project_id);

-- -----------------------------------------------------------------------------
-- Ogólnoorganizacyjne flagi runtime. Niesie znacznik wycofania zapisów
-- lokalnych (`local_writes_retired`). SELECT dla każdego zalogowanego (każdy
-- klient musi odczytać flagę), zapis wyłącznie administrator.
-- -----------------------------------------------------------------------------

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create trigger set_updated_at
  before update on public.app_settings
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS: włączone w tym samym pliku (deny-by-default), anon traci uprawnienia.
-- Bez `force row level security` — spójnie z rdzeniem (rekursja funkcji definer).
-- -----------------------------------------------------------------------------

alter table public.workload_entries enable row level security;
alter table public.milestones enable row level security;
alter table public.app_settings enable row level security;

revoke all on public.workload_entries, public.milestones, public.app_settings from anon;

-- Zaplanowane godziny ---------------------------------------------------------

create policy "workload_entries_select" on public.workload_entries
  for select to authenticated
  using (
    app.is_administrator()
    or app.manages_task(task_id)
    or profile_id = (select auth.uid())
  );

create policy "workload_entries_insert" on public.workload_entries
  for insert to authenticated
  with check (
    app.is_administrator()
    or (
      app.manages_task(task_id)
      and app.profile_in_department(profile_id, app.current_department_id())
    )
    or profile_id = (select auth.uid())
  );

create policy "workload_entries_update" on public.workload_entries
  for update to authenticated
  using (
    app.is_administrator()
    or (
      app.manages_task(task_id)
      and app.profile_in_department(profile_id, app.current_department_id())
    )
    or profile_id = (select auth.uid())
  )
  with check (
    app.is_administrator()
    or (
      app.manages_task(task_id)
      and app.profile_in_department(profile_id, app.current_department_id())
    )
    or profile_id = (select auth.uid())
  );

create policy "workload_entries_delete" on public.workload_entries
  for delete to authenticated
  using (
    app.is_administrator()
    or app.manages_task(task_id)
    or profile_id = (select auth.uid())
  );

-- Kamienie milowe -------------------------------------------------------------

create policy "milestones_select" on public.milestones
  for select to authenticated
  using (
    app.is_administrator()
    or app.manages_project(project_id)
    or app.is_project_member(project_id)
  );

create policy "milestones_insert" on public.milestones
  for insert to authenticated
  with check (app.is_administrator() or app.manages_project(project_id));

create policy "milestones_update" on public.milestones
  for update to authenticated
  using (app.is_administrator() or app.manages_project(project_id))
  with check (app.is_administrator() or app.manages_project(project_id));

create policy "milestones_delete" on public.milestones
  for delete to authenticated
  using (app.is_administrator() or app.manages_project(project_id));

-- Flagi runtime ---------------------------------------------------------------

create policy "app_settings_select" on public.app_settings
  for select to authenticated
  using (true);

create policy "app_settings_insert" on public.app_settings
  for insert to authenticated
  with check (app.is_administrator());

create policy "app_settings_update" on public.app_settings
  for update to authenticated
  using (app.is_administrator())
  with check (app.is_administrator());

create policy "app_settings_delete" on public.app_settings
  for delete to authenticated
  using (app.is_administrator());
