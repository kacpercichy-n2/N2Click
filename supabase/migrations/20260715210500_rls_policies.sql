-- =============================================================================
-- Migracja: 20260715210500_rls_policies
--
-- Produkcyjne polityki Row Level Security dla rdzenia N2Hub oraz prywatny
-- bucket `avatars` w Storage.
--
-- Model dostępu (macierz szczegółowa: supabase/README.md):
--   * administrator — pełny dostęp do wszystkiego,
--   * manager      — swój dział: profile członków działu, projekty działu
--                    (CRUD), członkostwo i przypisania ograniczone do osób
--                    z własnego działu,
--   * worker       — własny profil, projekty w których jest członkiem (odczyt)
--                    oraz zadania do niego przypisane (odczyt + aktualizacja).
--
-- Zasada braku rekursji: wszystkie funkcje pomocnicze są STABLE +
-- SECURITY DEFINER, więc czytają tabele jako ich właściciel (bez RLS).
-- Polityka nigdy nie odpytuje tabeli, na której wisi, przez ścieżkę objętą
-- RLS — dlatego żadna tabela nie ma `force row level security`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Funkcje pomocnicze (schemat app, poza API PostgREST)
-- -----------------------------------------------------------------------------

create function app.current_access_role()
returns public.access_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.access_role
  from public.profiles p
  where p.id = (select auth.uid());
$$;

create function app.is_administrator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.current_access_role() = 'administrator', false);
$$;

create function app.current_department_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.department_id
  from public.profiles p
  where p.id = (select auth.uid());
$$;

-- Czy zalogowany użytkownik jest menedżerem wskazanego działu.
create function app.is_department_manager_of(target_department uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_department is not null and exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.access_role = 'manager'
      and p.department_id = target_department
  );
$$;

-- Czy zalogowany użytkownik może widzieć wskazany profil:
-- własny, dowolny (administrator) lub profil z działu, którym zarządza.
create function app.can_view_profile(target_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_profile is not null and (
    target_profile = (select auth.uid())
    or app.is_administrator()
    or exists (
      select 1
      from public.profiles them
      where them.id = target_profile
        and them.department_id is not null
        and app.is_department_manager_of(them.department_id)
    )
  );
$$;

-- Czy wskazany profil należy do wskazanego działu.
create function app.profile_in_department(target_profile uuid, target_department uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_department is not null and exists (
    select 1
    from public.profiles p
    where p.id = target_profile
      and p.department_id = target_department
  );
$$;

create function app.is_project_member(target_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_members pm
    where pm.project_id = target_project
      and pm.profile_id = (select auth.uid())
  );
$$;

-- Czy zalogowany użytkownik zarządza projektem (jest menedżerem jego działu).
create function app.manages_project(target_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.projects pr
    where pr.id = target_project
      and app.is_department_manager_of(pr.department_id)
  );
$$;

create function app.manages_task(target_task uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tasks t
    where t.id = target_task
      and app.manages_project(t.project_id)
  );
$$;

create function app.is_assigned_to_task(target_task uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.task_assignments ta
    where ta.task_id = target_task
      and ta.profile_id = (select auth.uid())
  );
$$;

-- Właściciel obiektu awatara wyprowadzony z KONWENCJI ŚCIEŻKI
-- (`<id profilu>/<plik>`). Zwraca null dla ścieżki spoza konwencji, więc
-- polityki odczytu nie rzucają błędem rzutowania na nie-UUID.
create function app.storage_object_owner(object_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(object_name, '/', 1)
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(object_name, '/', 1)::uuid
    else null
  end;
$$;

-- Funkcje pomocnicze wykonują tylko zalogowani użytkownicy (są wywoływane
-- z wnętrza polityk z uprawnieniami roli pytającej).
revoke all on all functions in schema app from public;
grant execute on all functions in schema app to authenticated;

-- -----------------------------------------------------------------------------
-- Triggery ochronne (reguł „stare vs nowe” nie da się wyrazić w WITH CHECK)
-- -----------------------------------------------------------------------------

-- Nie-administrator nie może zmienić swojej roli dostępu, działu ani id —
-- polityka UPDATE pozwala mu edytować własny profil, a trigger blokuje
-- eskalację uprawnień. Dostęp bez JWT (postgres / service_role) przechodzi:
-- i tak omija RLS, a trigger chroni wyłącznie ścieżkę API użytkownika.
create function app.protect_profile_privileges()
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
     or new.department_id is distinct from old.department_id then
    raise exception 'Tylko administrator może zmieniać rolę dostępu lub dział profilu';
  end if;
  return new;
end;
$$;

create trigger protect_profile_privileges
  before update on public.profiles
  for each row execute function app.protect_profile_privileges();

-- Przeniesienie zadania między projektami wymaga administratora albo menedżera
-- zarządzającego OBOMA projektami. Pracownik przypisany do zadania może je
-- aktualizować, ale nie relokować poza swoją widoczność.
create function app.protect_task_project()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.project_id is distinct from old.project_id then
    if (select auth.uid()) is null or app.is_administrator() then
      return new;
    end if;
    if app.manages_project(old.project_id) and app.manages_project(new.project_id) then
      return new;
    end if;
    raise exception 'Brak uprawnień do przeniesienia zadania do innego projektu';
  end if;
  return new;
end;
$$;

create trigger protect_task_project
  before update on public.tasks
  for each row execute function app.protect_task_project();

-- -----------------------------------------------------------------------------
-- Polityki: profiles
-- -----------------------------------------------------------------------------

create policy "profiles_select" on public.profiles
  for select to authenticated
  using (app.can_view_profile(id));

-- Profile zakłada administrator (bootstrap pierwszego administratora robi
-- operator poza API — patrz supabase/README.md).
create policy "profiles_insert_admin" on public.profiles
  for insert to authenticated
  with check (app.is_administrator());

create policy "profiles_update_self_or_admin" on public.profiles
  for update to authenticated
  using (app.is_administrator() or id = (select auth.uid()))
  with check (app.is_administrator() or id = (select auth.uid()));

create policy "profiles_delete_admin" on public.profiles
  for delete to authenticated
  using (app.is_administrator());

-- -----------------------------------------------------------------------------
-- Polityki: departments (odczyt własnego działu; zarządzanie — administrator)
-- -----------------------------------------------------------------------------

create policy "departments_select_own_or_admin" on public.departments
  for select to authenticated
  using (app.is_administrator() or id = app.current_department_id());

create policy "departments_insert_admin" on public.departments
  for insert to authenticated
  with check (app.is_administrator());

create policy "departments_update_admin" on public.departments
  for update to authenticated
  using (app.is_administrator())
  with check (app.is_administrator());

create policy "departments_delete_admin" on public.departments
  for delete to authenticated
  using (app.is_administrator());

-- -----------------------------------------------------------------------------
-- Polityki: projects
-- -----------------------------------------------------------------------------

create policy "projects_select" on public.projects
  for select to authenticated
  using (
    app.is_administrator()
    or app.is_department_manager_of(department_id)
    or app.is_project_member(id)
  );

create policy "projects_insert" on public.projects
  for insert to authenticated
  with check (
    app.is_administrator()
    or app.is_department_manager_of(department_id)
  );

-- WITH CHECK powtarza warunek działu: menedżer nie może przenieść projektu
-- do cudzego działu ani „odpiąć” go od działu (null przechodzi tylko u admina).
create policy "projects_update" on public.projects
  for update to authenticated
  using (
    app.is_administrator()
    or app.is_department_manager_of(department_id)
  )
  with check (
    app.is_administrator()
    or app.is_department_manager_of(department_id)
  );

create policy "projects_delete" on public.projects
  for delete to authenticated
  using (
    app.is_administrator()
    or app.is_department_manager_of(department_id)
  );

-- -----------------------------------------------------------------------------
-- Polityki: project_members (brak polityki UPDATE — wiersz-łącznik wymienia
-- się przez delete+insert)
-- -----------------------------------------------------------------------------

create policy "project_members_select" on public.project_members
  for select to authenticated
  using (
    app.is_administrator()
    or app.manages_project(project_id)
    or profile_id = (select auth.uid())
  );

-- Menedżer dodaje do projektów swojego działu wyłącznie osoby z tego działu —
-- to jest egzekwowany w SQL model widoczności działowej członkostwa.
create policy "project_members_insert" on public.project_members
  for insert to authenticated
  with check (
    app.is_administrator()
    or (
      app.manages_project(project_id)
      and app.profile_in_department(profile_id, app.current_department_id())
    )
  );

create policy "project_members_delete" on public.project_members
  for delete to authenticated
  using (
    app.is_administrator()
    or app.manages_project(project_id)
  );

-- -----------------------------------------------------------------------------
-- Polityki: tasks
-- -----------------------------------------------------------------------------

create policy "tasks_select" on public.tasks
  for select to authenticated
  using (
    app.is_administrator()
    or app.manages_project(project_id)
    or app.is_assigned_to_task(id)
  );

create policy "tasks_insert" on public.tasks
  for insert to authenticated
  with check (
    app.is_administrator()
    or app.manages_project(project_id)
  );

-- Pracownik przypisany do zadania może je aktualizować; relokację między
-- projektami dodatkowo blokuje trigger protect_task_project.
create policy "tasks_update" on public.tasks
  for update to authenticated
  using (
    app.is_administrator()
    or app.manages_project(project_id)
    or app.is_assigned_to_task(id)
  )
  with check (
    app.is_administrator()
    or app.manages_project(project_id)
    or app.is_assigned_to_task(id)
  );

create policy "tasks_delete" on public.tasks
  for delete to authenticated
  using (
    app.is_administrator()
    or app.manages_project(project_id)
  );

-- -----------------------------------------------------------------------------
-- Polityki: task_assignments (własność zadań w modelu działowym)
-- -----------------------------------------------------------------------------

create policy "task_assignments_select" on public.task_assignments
  for select to authenticated
  using (
    app.is_administrator()
    or app.manages_task(task_id)
    or profile_id = (select auth.uid())
  );

-- Menedżer przypisuje do zadań swojego działu wyłącznie osoby z tego działu.
create policy "task_assignments_insert" on public.task_assignments
  for insert to authenticated
  with check (
    app.is_administrator()
    or (
      app.manages_task(task_id)
      and app.profile_in_department(profile_id, app.current_department_id())
    )
  );

create policy "task_assignments_delete" on public.task_assignments
  for delete to authenticated
  using (
    app.is_administrator()
    or app.manages_task(task_id)
  );

-- -----------------------------------------------------------------------------
-- Storage: prywatny bucket `avatars`
--
-- Konwencja ścieżki: `<id profilu>/<nazwa pliku>` (np. `123e.../avatar.webp`).
-- Widoczność awatara odpowiada widoczności profilu (app.can_view_profile).
-- -----------------------------------------------------------------------------

-- Walidacja RZECZYWISTEGO typu identyfikatora właściciela w storage.objects,
-- zanim powstaną polityki, które z niego korzystają. Współczesny schemat
-- Storage używa `owner_id text` (kolumna `owner uuid` jest przestarzała);
-- gdy hostowany schemat się różni, migracja ma się zatrzymać z jasnym błędem
-- zamiast utworzyć polityki o innej semantyce.
do $$
declare
  owner_id_type text;
begin
  select c.data_type into owner_id_type
  from information_schema.columns c
  where c.table_schema = 'storage'
    and c.table_name = 'objects'
    and c.column_name = 'owner_id';

  if owner_id_type is null then
    raise exception using message =
      'storage.objects.owner_id nie istnieje — schemat Storage jest niezgodny '
      'z założeniami tej migracji; zaktualizuj polityki awatarów.';
  end if;

  if owner_id_type <> 'text' then
    raise exception using message = format(
      'storage.objects.owner_id ma typ %s (oczekiwano text) — dostosuj '
      'polityki awatarów do rzeczywistego typu.', owner_id_type);
  end if;
end
$$;

-- Prywatny bucket; `on conflict` dodatkowo wymusza public = false, gdyby
-- bucket istniał już jako publiczny.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false)
on conflict (id) do update set public = false;

-- Odczyt: administrator wszystko (także obiekty spoza konwencji ścieżki),
-- pozostali — awatary profili, które wolno im widzieć.
create policy "avatars_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'avatars'
    and (
      app.is_administrator()
      or app.can_view_profile(app.storage_object_owner(name))
    )
  );

-- Zapis: tylko własny folder; `owner_id` (text — typ zwalidowany wyżej) musi
-- wskazywać wgrywającego, więc obie tożsamości — ścieżkowa i storage'owa —
-- są spięte.
create policy "avatars_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (
      app.is_administrator()
      or (
        split_part(name, '/', 1) = (select auth.uid())::text
        and owner_id = (select auth.uid())::text
      )
    )
  );

create policy "avatars_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (
      app.is_administrator()
      or (
        split_part(name, '/', 1) = (select auth.uid())::text
        and owner_id = (select auth.uid())::text
      )
    )
  )
  with check (
    bucket_id = 'avatars'
    and (
      app.is_administrator()
      or (
        split_part(name, '/', 1) = (select auth.uid())::text
        and owner_id = (select auth.uid())::text
      )
    )
  );

create policy "avatars_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (
      app.is_administrator()
      or (
        split_part(name, '/', 1) = (select auth.uid())::text
        and owner_id = (select auth.uid())::text
      )
    )
  );
