-- =============================================================================
-- Migracja: 20260721160000_companies
--
-- Słownik spółek („Spółki” w Administracji) + przypisanie osoby do spółki
-- (profiles.company_id) + ZAWĘŻAJĄCA widoczność projektów wg spółki.
--
-- INWARIANT BEZPIECZEŃSTWA (nigdy nie poszerza dzisiejszej widoczności):
-- nowa polityka `projects_select` to `admin OR (zakres_spółki AND <dzisiejsze
-- warunki nie-admina z 20260720190000>)`. Dla każdego nie-admina predykat jest
-- dotychczasowym predykatem ORAZ `project_in_company_scope`, a zakres spółki ≡
-- true, gdy `app.current_company_id()` jest null — użytkownik bez spółki widzi
-- DOKŁADNIE to co dziś, a nikt nie zyskuje ani jednego nowego wiersza. Zawężenie
-- realnie dotyka wyłącznie gałęzi `is_manager()`: członek/przypisany ze spółką X
-- sam spełnia zakres spółki X, więc nie traci dostępu.
--
-- Konwencja domu (patrz supabase/README.md): RLS w tym samym pliku, revoke anon,
-- polityki to authenticated + with check, bez force row level security, funkcje
-- hardened (`set search_path = ''`, stable). Idempotentnie
-- (`if not exists` / `create or replace` / `drop policy if exists`): plik bywa
-- aplikowany ręcznie przez SQL editor zanim `db push` uzupełni rejestr.
-- =============================================================================

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists companies_set_updated_at on public.companies;
create trigger companies_set_updated_at
  before update on public.companies
  for each row execute function app.set_updated_at();

alter table public.companies enable row level security;
revoke all on public.companies from anon;

drop policy if exists "companies_select" on public.companies;
create policy "companies_select" on public.companies
  for select to authenticated
  using (true);

drop policy if exists "companies_insert_admin" on public.companies;
create policy "companies_insert_admin" on public.companies
  for insert to authenticated
  with check (app.is_administrator());

drop policy if exists "companies_update_admin" on public.companies;
create policy "companies_update_admin" on public.companies
  for update to authenticated
  using (app.is_administrator())
  with check (app.is_administrator());

drop policy if exists "companies_delete_admin" on public.companies;
create policy "companies_delete_admin" on public.companies
  for delete to authenticated
  using (app.is_administrator());

alter table public.profiles
  add column if not exists company_id uuid
    references public.companies (id) on delete set null;

create index if not exists profiles_company_id_idx
  on public.profiles (company_id);

-- Spółka zalogowanego użytkownika (null = bez spółki => brak zawężenia).
create or replace function app.current_company_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.company_id
  from public.profiles p
  where p.id = (select auth.uid());
$$;

revoke all on function app.current_company_id() from public;
grant execute on function app.current_company_id() to authenticated;

-- Czy projekt mieści się w zakresie spółki zalogowanego użytkownika.
-- Semantyka (ZAWĘŻAJĄCA, nigdy poszerzająca):
--   * użytkownik bez spółki => true (dzisiejsza widoczność bez zmian);
--   * projekt „neutralny” (żaden członek projektu ani osoba przypisana do
--     jego zadań nie ma spółki) => true — świeżo utworzony/nieobsadzony
--     projekt nie znika twórcy między zapisem a hydracją;
--   * w przeciwnym razie => true tylko, gdy jakiś członek projektu lub osoba
--     przypisana do zadania projektu ma spółkę użytkownika.
-- SECURITY DEFINER czyta tabele jako właściciel (bez RLS) — zero rekursji,
-- polityka projects nie odpytuje projects przez ścieżkę objętą RLS.
create or replace function app.project_in_company_scope(target_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with project_people as (
    select pm.profile_id
    from public.project_members pm
    where pm.project_id = target_project
    union
    select ta.profile_id
    from public.task_assignments ta
    join public.tasks t on t.id = ta.task_id
    where t.project_id = target_project
  )
  select
    app.current_company_id() is null
    or not exists (
      select 1
      from project_people pp
      join public.profiles p on p.id = pp.profile_id
      where p.company_id is not null
    )
    or exists (
      select 1
      from project_people pp
      join public.profiles p on p.id = pp.profile_id
      where p.company_id = app.current_company_id()
    );
$$;

revoke all on function app.project_in_company_scope(uuid) from public;
grant execute on function app.project_in_company_scope(uuid) to authenticated;

-- Spółkę profilu zmienia wyłącznie administrator (jak rola dostępu, dział i
-- przełożony). UWAGA: `create or replace` PODMIENIA całą definicję, więc musimy
-- zachować WSZYSTKIE dotychczas chronione kolumny — w szczególności
-- `supervisor_id` z 20260717110000. Pominięcie go cofnęłoby istniejącą ochronę
-- (nie-admin mógłby zmienić przełożonego). Dodajemy `company_id` OBOK, nie
-- zamiast, poprzednich strażników.
create or replace function app.protect_profile_privileges()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or app.is_administrator() then
    return new;
  end if;
  if new.id is distinct from old.id
     or new.access_role is distinct from old.access_role
     or new.department_id is distinct from old.department_id
     or new.supervisor_id is distinct from old.supervisor_id
     or new.company_id is distinct from old.company_id then
    raise exception 'Tylko administrator może zmieniać rolę dostępu, dział, przełożonego lub spółkę profilu';
  end if;
  return new;
end;
$$;

-- Widoczność projektów: spółka wyłącznie ZAWĘŻA dzisiejsze warunki
-- (20260720190000): admin wszystko; pozostali — dzisiejsze warunki I zakres
-- spółki. Członek/przypisany ze spółką X sam spełnia zakres spółki X, więc
-- nie traci dostępu; zawężenie realnie dotyka tylko gałęzi is_manager().
drop policy if exists "projects_select" on public.projects;
create policy "projects_select" on public.projects
  for select to authenticated
  using (
    app.is_administrator()
    or (
      app.project_in_company_scope(id)
      and (
        app.is_manager()
        or app.is_project_member(id)
        or app.has_assignment_in_project(id)
      )
    )
  );

-- Publikacja realtime (parytet z departments/job_titles) — idempotentnie:
do $$
begin
  begin
    alter publication supabase_realtime add table public.companies;
  exception
    when duplicate_object then null;
  end;
end $$;
