-- Faza 2b: 20 tabel domenowych N2Click do schematu n2click + jedyna funkcja
-- z public (używana przez polityki bingo; referencje w politykach idą po OID).
alter table public.projects          set schema n2click;
alter table public.tasks             set schema n2click;
alter table public.tickets           set schema n2click;
alter table public.clients           set schema n2click;
alter table public.milestones        set schema n2click;
alter table public.comments          set schema n2click;
alter table public.departments       set schema n2click;
alter table public.job_titles        set schema n2click;
alter table public.statuses          set schema n2click;
alter table public.service_types     set schema n2click;
alter table public.work_categories   set schema n2click;
alter table public.task_assignments  set schema n2click;
alter table public.project_members   set schema n2click;
alter table public.workload_entries  set schema n2click;
alter table public.notifications     set schema n2click;
alter table public.activity_events   set schema n2click;
alter table public.events            set schema n2click;
alter table public.app_settings      set schema n2click;
alter table public.bingo_lines       set schema n2click;
alter table public.bingo_marks       set schema n2click;

alter function public.bingo_today() set schema n2click;
