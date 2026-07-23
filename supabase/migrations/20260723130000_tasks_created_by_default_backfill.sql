-- =============================================================================
-- Migracja: 20260723130000_tasks_created_by_default_backfill
--
-- `tasks.created_by` istniało jako kolumna (FK -> profiles.id), ale było PUSTE
-- (brak defaultu, wszystkie wiersze NULL) i niepodpięte do klienta. Ożywiamy je
-- jako STRUKTURALNY sygnał autora zadania — czystszy niż parsowanie treści
-- „utworzył(a) …" z dziennika aktywności — zasilający feed powiadomień
-- („X przypisał(a) Ci zadanie").
--
--   1. DEFAULT auth.uid() — mirror CELOWO pomija `created_by` przy insertcie
--      (patrz cloudMirror.taskRow), więc default wypełnia autora = zalogowany
--      twórca. Polityki RLS tasks (tasks_insert/_update) NIE odwołują się do
--      `created_by`, więc default jest bezpieczny (nie łamie with-check).
--   2. BACKFILL istniejących wierszy z najstarszego zdarzenia „utworzył%"
--      w activity_events (jego `actor_id` to twórca). Wiersze bez takiego
--      zdarzenia zostają NULL (feed po prostu ich nie zgłasza — łagodna degradacja).
--
-- Konwencja: migracja tylko-do-przodu, idempotentna, bez nowych polityk RLS.
-- =============================================================================

alter table public.tasks
  alter column created_by set default auth.uid();

update public.tasks t
set created_by = sub.actor_id
from (
  select distinct on (ae.task_id) ae.task_id, ae.actor_id
  from public.activity_events ae
  where ae.entity_type = 'task'
    and ae.message like 'utworzył%'
    and ae.actor_id is not null
  order by ae.task_id, ae.created_at asc
) sub
where t.id = sub.task_id
  and t.created_by is null;
