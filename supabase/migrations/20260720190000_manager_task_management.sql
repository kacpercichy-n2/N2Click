-- =============================================================================
-- Migracja: 20260720190000_manager_task_management
--
-- Zrównanie zakresu MENEDŻERA (access_role 'manager') z kliencką macierzą
-- uprawnień (src/store/permissions.ts: rola pm ma globalne tasks.manage,
-- blocks.editAny i projects.manage). Decyzja 2026-07-20: zadania dodaje każda
-- rola poza specjalistą — dotychczasowe działowe zawężenie RLS odrzucało po
-- cichu legalne akcje UI (np. menedżer dodający zadanie w projekcie innego
-- działu), a klient raportował „brak uprawnień”.
--
--   * tasks_*: menedżer widzi i zarządza wszystkimi zadaniami;
--   * projects select/update: menedżer widzi i edytuje wszystkie projekty
--     (insert dopuszczał każdego menedżera już od 20260720170000);
--   * app.manages_task: menedżer zarządza każdym ISTNIEJĄCYM zadaniem — przez
--     tę funkcję rozszerzają się przypisania, godziny, komentarze i dziennik;
--   * task_assignments/workload: bez działowego zawężenia osoby — menedżer
--     przypisuje i planuje godziny dowolnej osobie (jak blocks.editAny).
--
-- Pracownik (worker) pozostaje zawężony: własny profil, członkostwa,
-- przypisane zadania, własne wiersze godzin.
--
-- Idempotentnie (create or replace / drop if exists): plik bywa aplikowany
-- ręcznie przez SQL editor zanim `db push` uzupełni rejestr.
-- =============================================================================

create or replace function app.is_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.current_access_role() = 'manager', false);
$$;

revoke all on function app.is_manager() from public;
grant execute on function app.is_manager() to authenticated;

-- Menedżer zarządza każdym istniejącym zadaniem (funkcja zasila polityki
-- task_assignments, workload_entries, comments, activity_events).
create or replace function app.manages_task(target_task uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_manager() and exists (
    select 1 from public.tasks t where t.id = target_task
  );
$$;

drop policy if exists "tasks_select" on public.tasks;
create policy "tasks_select" on public.tasks
  for select to authenticated
  using (
    app.is_administrator()
    or app.is_manager()
    or app.is_assigned_to_task(id)
  );

drop policy if exists "tasks_insert" on public.tasks;
create policy "tasks_insert" on public.tasks
  for insert to authenticated
  with check (
    app.is_administrator()
    or app.is_manager()
  );

drop policy if exists "tasks_update" on public.tasks;
create policy "tasks_update" on public.tasks
  for update to authenticated
  using (
    app.is_administrator()
    or app.is_manager()
    or app.is_assigned_to_task(id)
  )
  with check (
    app.is_administrator()
    or app.is_manager()
    or app.is_assigned_to_task(id)
  );

drop policy if exists "tasks_delete" on public.tasks;
create policy "tasks_delete" on public.tasks
  for delete to authenticated
  using (
    app.is_administrator()
    or app.is_manager()
  );

drop policy if exists "projects_select" on public.projects;
create policy "projects_select" on public.projects
  for select to authenticated
  using (
    app.is_administrator()
    or app.is_manager()
    or app.is_project_member(id)
    or app.has_assignment_in_project(id)
  );

drop policy if exists "projects_update" on public.projects;
create policy "projects_update" on public.projects
  for update to authenticated
  using (
    app.is_administrator()
    or app.is_manager()
  )
  with check (
    app.is_administrator()
    or app.is_manager()
  );

-- Przypisania: menedżer przypisuje dowolną osobę do dowolnego zadania
-- (dotąd: wyłącznie osoby z własnego działu do zadań własnego działu).
drop policy if exists "task_assignments_insert" on public.task_assignments;
create policy "task_assignments_insert" on public.task_assignments
  for insert to authenticated
  with check (
    app.is_administrator()
    or app.manages_task(task_id)
  );

-- Godziny: menedżer planuje godziny dowolnej osobie (odpowiednik blocks.editAny).
drop policy if exists "workload_entries_insert" on public.workload_entries;
create policy "workload_entries_insert" on public.workload_entries
  for insert to authenticated
  with check (
    app.is_administrator()
    or app.manages_task(task_id)
    or profile_id = (select auth.uid())
  );

drop policy if exists "workload_entries_update" on public.workload_entries;
create policy "workload_entries_update" on public.workload_entries
  for update to authenticated
  using (
    app.is_administrator()
    or app.manages_task(task_id)
    or profile_id = (select auth.uid())
  )
  with check (
    app.is_administrator()
    or app.manages_task(task_id)
    or profile_id = (select auth.uid())
  );
