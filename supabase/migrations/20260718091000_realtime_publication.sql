-- =============================================================================
-- Migracja: 20260718091000_realtime_publication
--
-- Żywa synchronizacja: dodaje tabele planera i organizacji do publikacji
-- `supabase_realtime`, żeby klient (CloudSyncProvider) dostawał zdarzenia
-- postgres_changes i automatycznie odświeżał GUI po każdej zmianie w bazie.
-- RLS obowiązuje także w Realtime (WALRUS) — użytkownik dostaje tylko wiersze,
-- które i tak może SELECT-ować; klient traktuje zdarzenie wyłącznie jako
-- sygnał „coś się zmieniło” i robi pełną, autorytatywną hydrację.
--
-- Idempotentnie: ALTER PUBLICATION ... ADD TABLE rzuca duplicate_object dla
-- tabeli już opublikowanej — łapiemy wyjątek per tabela.
-- =============================================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'clients',
    'projects',
    'milestones',
    'tasks',
    'task_assignments',
    'workload_entries',
    'comments',
    'activity_events',
    'profiles',
    'statuses',
    'departments',
    'service_types',
    'work_categories',
    'app_settings'
  ]
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then
        null; -- tabela już w publikacji — idempotentnie pomiń
    end;
  end loop;
end $$;
