-- =============================================================================
-- Migracja: 20260720170000_task_departments
--
-- Dział przypisuje się na ZADANIU (`tasks.department_id`); działy PROJEKTU są
-- pochodne — unikalny zbiór działów jego zadań, więc projekt może obejmować
-- kilka działów naraz (selectors.departmentsOfProject po stronie klienta;
-- `projects.department_id` zostaje wyłącznie jako zaszłość/fallback).
--
-- Konsekwencje w RLS (model działowy podąża za zadaniami):
--   * `app.manages_task` obejmuje też menedżera działu ZADANIA — przez tę
--     funkcję rozszerzają się automatycznie polityki task_assignments,
--     workload_entries, comments i activity_events;
--   * polityki `tasks_*` przepuszczają menedżera działu zadania wprost
--     (kolumna wiersza, nie funkcja — WITH CHECK na INSERT działa bez
--     zaglądania w niewidoczny jeszcze wiersz);
--   * `projects_select`/`projects_update` przepuszczają menedżera działu,
--     którego zadanie znajduje się w projekcie (współprowadzenie);
--   * `projects_insert` dopuszcza każdego menedżera — projekt nie jest już
--     własnością jednego działu, a formularz nie ustawia działu projektu.
--
-- Idempotentnie (create or replace / drop if exists / if not exists): plik
-- bywa aplikowany ręcznie przez SQL editor zanim `db push` uzupełni rejestr.
-- =============================================================================

alter table public.tasks
  add column if not exists department_id uuid
    references public.departments (id) on delete set null;

create index if not exists tasks_department_id_idx
  on public.tasks (department_id);

-- Menedżer zarządza zadaniem, gdy zarządza projektem (dział projektu — legacy)
-- LUB działem samego zadania.
create or replace function app.manages_task(target_task uuid)
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
      and (
        app.manages_project(t.project_id)
        or app.is_department_manager_of(t.department_id)
      )
  );
$$;

-- Czy projekt zawiera zadanie działu, którym zarządza zalogowany użytkownik.
create or replace function app.manages_any_task_in_project(target_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tasks t
    where t.project_id = target_project
      and app.is_department_manager_of(t.department_id)
  );
$$;

revoke all on function app.manages_any_task_in_project(uuid) from public;
grant execute on function app.manages_any_task_in_project(uuid) to authenticated;

drop policy if exists "tasks_select" on public.tasks;
create policy "tasks_select" on public.tasks
  for select to authenticated
  using (
    app.is_administrator()
    or app.manages_project(project_id)
    or app.is_department_manager_of(department_id)
    or app.is_assigned_to_task(id)
  );

drop policy if exists "tasks_insert" on public.tasks;
create policy "tasks_insert" on public.tasks
  for insert to authenticated
  with check (
    app.is_administrator()
    or app.manages_project(project_id)
    or app.is_department_manager_of(department_id)
  );

drop policy if exists "tasks_update" on public.tasks;
create policy "tasks_update" on public.tasks
  for update to authenticated
  using (
    app.is_administrator()
    or app.manages_project(project_id)
    or app.is_department_manager_of(department_id)
    or app.is_assigned_to_task(id)
  )
  with check (
    app.is_administrator()
    or app.manages_project(project_id)
    or app.is_department_manager_of(department_id)
    or app.is_assigned_to_task(id)
  );

drop policy if exists "tasks_delete" on public.tasks;
create policy "tasks_delete" on public.tasks
  for delete to authenticated
  using (
    app.is_administrator()
    or app.manages_project(project_id)
    or app.is_department_manager_of(department_id)
  );

drop policy if exists "projects_select" on public.projects;
create policy "projects_select" on public.projects
  for select to authenticated
  using (
    app.is_administrator()
    or app.is_department_manager_of(department_id)
    or app.is_project_member(id)
    or app.has_assignment_in_project(id)
    or app.manages_any_task_in_project(id)
  );

drop policy if exists "projects_insert" on public.projects;
create policy "projects_insert" on public.projects
  for insert to authenticated
  with check (
    app.is_administrator()
    or app.current_access_role() = 'manager'
  );

drop policy if exists "projects_update" on public.projects;
create policy "projects_update" on public.projects
  for update to authenticated
  using (
    app.is_administrator()
    or app.is_department_manager_of(department_id)
    or app.manages_any_task_in_project(id)
  )
  with check (
    app.is_administrator()
    or app.is_department_manager_of(department_id)
    or app.manages_any_task_in_project(id)
  );
