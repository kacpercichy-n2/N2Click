-- Faza 2c: funkcje pomocnicze RLS w schemacie app — odwołania public.* na
-- core./n2click. (sygnatury i semantyka bez zmian; SECURITY DEFINER +
-- search_path = '' jak dotąd).

create or replace function app.current_access_role()
returns core.access_role language sql stable security definer set search_path to ''
as $$
  select p.access_role from core.profiles p where p.id = (select auth.uid());
$$;

create or replace function app.current_company_id()
returns uuid language sql stable security definer set search_path to ''
as $$
  select p.company_id from core.profiles p where p.id = (select auth.uid());
$$;

create or replace function app.current_department_id()
returns uuid language sql stable security definer set search_path to ''
as $$
  select p.department_id from core.profiles p where p.id = (select auth.uid());
$$;

create or replace function app.is_department_manager_of(target_department uuid)
returns boolean language sql stable security definer set search_path to ''
as $$
  select target_department is not null and exists (
    select 1
    from core.profiles p
    where p.id = (select auth.uid())
      and p.access_role = 'manager'
      and p.department_id = target_department
  );
$$;

create or replace function app.can_view_profile(target_profile uuid)
returns boolean language sql stable security definer set search_path to ''
as $$
  select target_profile is not null and (
    target_profile = (select auth.uid())
    or app.is_administrator()
    or exists (
      select 1
      from core.profiles them
      where them.id = target_profile
        and them.department_id is not null
        and app.is_department_manager_of(them.department_id)
    )
  );
$$;

create or replace function app.has_assignment_in_project(target_project uuid)
returns boolean language sql stable security definer set search_path to ''
as $$
  select exists (
    select 1
    from n2click.task_assignments ta
    join n2click.tasks t on t.id = ta.task_id
    where t.project_id = target_project
      and ta.profile_id = (select auth.uid())
  );
$$;

create or replace function app.is_assigned_to_task(target_task uuid)
returns boolean language sql stable security definer set search_path to ''
as $$
  select exists (
    select 1
    from n2click.task_assignments ta
    where ta.task_id = target_task
      and ta.profile_id = (select auth.uid())
  );
$$;

create or replace function app.is_project_member(target_project uuid)
returns boolean language sql stable security definer set search_path to ''
as $$
  select exists (
    select 1
    from n2click.project_members pm
    where pm.project_id = target_project
      and pm.profile_id = (select auth.uid())
  );
$$;

create or replace function app.manages_any_task_in_project(target_project uuid)
returns boolean language sql stable security definer set search_path to ''
as $$
  select exists (
    select 1
    from n2click.tasks t
    where t.project_id = target_project
      and app.is_department_manager_of(t.department_id)
  );
$$;

create or replace function app.manages_project(target_project uuid)
returns boolean language sql stable security definer set search_path to ''
as $$
  select exists (
    select 1
    from n2click.projects pr
    where pr.id = target_project
      and app.is_department_manager_of(pr.department_id)
  );
$$;

create or replace function app.manages_task(target_task uuid)
returns boolean language sql stable security definer set search_path to ''
as $$
  select app.is_manager() and exists (
    select 1 from n2click.tasks t where t.id = target_task
  );
$$;

create or replace function app.profile_in_department(target_profile uuid, target_department uuid)
returns boolean language sql stable security definer set search_path to ''
as $$
  select target_department is not null and exists (
    select 1
    from core.profiles p
    where p.id = target_profile
      and p.department_id = target_department
  );
$$;

create or replace function app.project_in_company_scope(target_project uuid)
returns boolean language sql stable security definer set search_path to ''
as $$
  with project_people as (
    select pm.profile_id
    from n2click.project_members pm
    where pm.project_id = target_project
    union
    select ta.profile_id
    from n2click.task_assignments ta
    join n2click.tasks t on t.id = ta.task_id
    where t.project_id = target_project
  )
  select
    app.current_company_id() is null
    or not exists (
      select 1
      from project_people pp
      join core.profiles p on p.id = pp.profile_id
      where p.company_id is not null
    )
    or exists (
      select 1
      from project_people pp
      join core.profiles p on p.id = pp.profile_id
      where p.company_id = app.current_company_id()
    );
$$;
