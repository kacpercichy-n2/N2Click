-- =============================================================================
-- Migracja: 20260720150000_assignee_visibility_and_profile_rls
--
-- Naprawa dostępu nie-administratorów (zgłoszenie: menedżer/pracownik nie widzi
-- własnych zaplanowanych zadań i nie może edytować własnego profilu).
--
-- 1. `projects_select` dodatkowo przepuszcza osobę PRZYPISANĄ do dowolnego
--    zadania projektu. Bez tego RLS ukrywał projekt przed przypisanym
--    pracownikiem, a hydracja klienta kaskadowo odrzucała zadanie i bloki
--    godzin osieroconego projektu — pusty kalendarz mimo poprawnych wierszy
--    workload_entries/tasks widocznych dla tej osoby.
-- 2. `profiles_update_self_or_admin` dodatkowo przepuszcza menedżera działu
--    aktualizującego profil członka SWOJEGO działu (niebędącego
--    administratorem) — zgodnie z macierzą edycji klienta
--    (src/pages/profileEditPolicy.ts). Eskalację uprawnień (id, access_role,
--    department_id) nadal blokuje trigger protect_profile_privileges.
-- =============================================================================

-- Czy zalogowany użytkownik jest przypisany do dowolnego zadania projektu.
-- Idempotentnie (create or replace / drop if exists): plik bywa aplikowany
-- ręcznie przez SQL editor zanim `db push` uzupełni rejestr migracji.
create or replace function app.has_assignment_in_project(target_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.task_assignments ta
    join public.tasks t on t.id = ta.task_id
    where t.project_id = target_project
      and ta.profile_id = (select auth.uid())
  );
$$;

revoke all on function app.has_assignment_in_project(uuid) from public;
grant execute on function app.has_assignment_in_project(uuid) to authenticated;

drop policy if exists "projects_select" on public.projects;
create policy "projects_select" on public.projects
  for select to authenticated
  using (
    app.is_administrator()
    or app.is_department_manager_of(department_id)
    or app.is_project_member(id)
    or app.has_assignment_in_project(id)
  );

drop policy if exists "profiles_update_self_or_admin" on public.profiles;
create policy "profiles_update_self_or_admin" on public.profiles
  for update to authenticated
  using (
    app.is_administrator()
    or id = (select auth.uid())
    or (access_role <> 'administrator' and app.is_department_manager_of(department_id))
  )
  with check (
    app.is_administrator()
    or id = (select auth.uid())
    or (access_role <> 'administrator' and app.is_department_manager_of(department_id))
  );
