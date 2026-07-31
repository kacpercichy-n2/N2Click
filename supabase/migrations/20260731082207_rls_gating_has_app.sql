-- Gating RLS (handoff 5.4): każda polityka dla authenticated w n2click i na
-- core.profiles/core.companies dostaje warunek core.has_app('n2click').
-- Wyjątek udokumentowany w audycie Fazy 0: bingo_lines/bingo_marks (gra anon).
do $$
declare
  r record;
  gate constant text := '(select core.has_app(''n2click''))';
begin
  for r in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where (
        (schemaname = 'n2click' and tablename not in ('bingo_lines','bingo_marks'))
        or (schemaname = 'core' and tablename in ('profiles','companies'))
      )
      and roles = '{authenticated}'::name[]
      and position('has_app' in coalesce(qual,'') || coalesce(with_check,'')) = 0
  loop
    if r.qual is not null and r.with_check is not null then
      execute format('alter policy %I on %I.%I using (%s and (%s)) with check (%s and (%s))',
        r.policyname, r.schemaname, r.tablename, gate, r.qual, gate, r.with_check);
    elsif r.qual is not null then
      execute format('alter policy %I on %I.%I using (%s and (%s))',
        r.policyname, r.schemaname, r.tablename, gate, r.qual);
    elsif r.with_check is not null then
      execute format('alter policy %I on %I.%I with check (%s and (%s))',
        r.policyname, r.schemaname, r.tablename, gate, r.with_check);
    end if;
  end loop;
end $$;

-- Podział na spółki po claimach (handoff 5.4): projects ma company_id.
-- NULL = projekt wspólny (24/25 wierszy w danych); admin widzi wszystko.
alter policy projects_select on n2click.projects using (
  (select core.has_app('n2click'))
  and (
    app.is_administrator()
    or (select core.app_role('n2click')) = 'admin'
    or (
      (company_id is null or company_id = (select core.company_for('n2click')))
      and app.project_in_company_scope(id)
      and (app.is_manager() or app.is_project_member(id) or app.has_assignment_in_project(id))
    )
  )
);
