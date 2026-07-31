-- Gating spółki przez relacje (handoff 5.4, znalezisko weryfikatora nr 3):
-- spółka zadania/komentarza/wpisu wynika z projektu. NULL company projektu =
-- projekt wspólny (przepuszczany); rola admin z claimów widzi wszystko.
create or replace function app.company_ok_project(target_project uuid)
returns boolean language sql stable security definer set search_path to ''
as $$
  select target_project is null
    or (select core.app_role('n2click')) = 'admin'
    or not exists (
      select 1 from n2click.projects pr
      where pr.id = target_project
        and pr.company_id is not null
        and pr.company_id is distinct from (select core.company_for('n2click'))
    );
$$;

create or replace function app.company_ok_task(target_task uuid)
returns boolean language sql stable security definer set search_path to ''
as $$
  select target_task is null
    or (select core.app_role('n2click')) = 'admin'
    or not exists (
      select 1
      from n2click.tasks t
      join n2click.projects pr on pr.id = t.project_id
      where t.id = target_task
        and pr.company_id is not null
        and pr.company_id is distinct from (select core.company_for('n2click'))
    );
$$;

revoke all on function app.company_ok_project(uuid), app.company_ok_task(uuid) from public;
grant execute on function app.company_ok_project(uuid), app.company_ok_task(uuid)
  to authenticated, service_role;

-- Doklejenie warunku spółki do polityk tabel zależnych od projektu.
-- clients celowo pominięte: brak kolumny/relacji spółki (klient może obsługiwać
-- wiele spółek) — udokumentowane odstępstwo. tickets: prywatne per reporter
-- (spółka nie ma zastosowania).
do $$
declare
  r record;
  cond text;
begin
  for r in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'n2click'
      and tablename in ('tasks','milestones','comments','workload_entries','task_assignments')
      and roles = '{authenticated}'::name[]
      and position('company_ok' in coalesce(qual,'') || coalesce(with_check,'')) = 0
  loop
    cond := case r.tablename
      when 'tasks' then 'app.company_ok_project(project_id)'
      when 'milestones' then 'app.company_ok_project(project_id)'
      when 'comments' then '((project_id is null or app.company_ok_project(project_id)) and (task_id is null or app.company_ok_task(task_id)))'
      else 'app.company_ok_task(task_id)'
    end;
    if r.qual is not null and r.with_check is not null then
      execute format('alter policy %I on %I.%I using ((%s) and %s) with check ((%s) and %s)',
        r.policyname, r.schemaname, r.tablename, r.qual, cond, r.with_check, cond);
    elsif r.qual is not null then
      execute format('alter policy %I on %I.%I using ((%s) and %s)',
        r.policyname, r.schemaname, r.tablename, r.qual, cond);
    elsif r.with_check is not null then
      execute format('alter policy %I on %I.%I with check ((%s) and %s)',
        r.policyname, r.schemaname, r.tablename, r.with_check, cond);
    end if;
  end loop;
end $$;
