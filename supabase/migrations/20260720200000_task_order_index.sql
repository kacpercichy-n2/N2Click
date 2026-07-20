-- =============================================================================
-- Migracja: 20260720200000_task_order_index
--
-- Ręczna, per-PROJEKT kolejność zadań na liście w szczegółach projektu.
-- Dodaje `tasks.order_index` (0-based ranga wyświetlania). Kolumna jest tylko
-- kosmetyczna: ukończenie (`status_id`), kalendarz i godziny są od niej
-- NIEZALEŻNE. Nie tworzy tabeli, więc bez zmian RLS/polityk ani publikacji
-- realtime; klient mirroruje tę kolumnę jak zwykłe pole zadania.
--
-- Backfill jest ZABEZPIECZONY i idempotentny: nadaje 0..n-1 (partition by
-- project_id, kolejność start_date NULLS LAST, created_at, id) TYLKO w tych
-- projektach, gdzie KAŻDE zadanie ma jeszcze order_index = 0 (czyli kolejność
-- nie została ręcznie ustawiona). Ponowne uruchomienie nigdy nie nadpisze
-- ręcznego porządku.
--
-- Idempotentnie (add column if not exists + strażnik na backfillu): plik bywa
-- aplikowany ręcznie przez SQL editor zanim `db push` uzupełni rejestr.
-- =============================================================================

alter table public.tasks
  add column if not exists order_index integer not null default 0;

with ranked as (
  select
    id,
    row_number() over (
      partition by project_id
      order by start_date nulls last, created_at, id
    ) - 1 as rn
  from public.tasks t
  where not exists (
    -- Pomiń projekty, w których jakiekolwiek zadanie ma już order_index <> 0.
    select 1
    from public.tasks o
    where o.project_id = t.project_id
      and o.order_index <> 0
  )
)
update public.tasks t
set order_index = ranked.rn
from ranked
where t.id = ranked.id
  and t.order_index <> ranked.rn;
