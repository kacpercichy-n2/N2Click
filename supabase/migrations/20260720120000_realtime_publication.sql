-- =============================================================================
-- Migracja: 20260720120000_realtime_publication
--
-- Włącza Supabase Realtime dla trzynastu tabel planera i słowników, dodając je
-- do publikacji `supabase_realtime`. Klient (src/supabase/CloudSyncProvider.tsx)
-- otwiera JEDEN kanał postgres_changes na te tabele i po zmianie w DB odpala
-- zdebouncowane, skoalescowane PONOWNE wczytanie snapshotu przez istniejącą
-- ścieżkę MERGE_CLOUD_ENTITIES (bez łatania wierszy — walidacja i inwariant 6
-- żyją w warstwie hydracji). Realtime NIE omija RLS: klient i tak subskrybuje
-- wyłącznie wiersze widoczne dla jego roli.
--
-- Konwencja (patrz 20260715210000_core_schema): migracja tylko-do-przodu,
-- nazwa YYYYMMDDHHMMSS_opis.sql. Ta migracja nie tworzy tabel ani polityk —
-- zmienia jedynie członkostwo publikacji, więc jest w pełni idempotentna:
-- tworzy publikację, gdy projekt jej nie ma, i dodaje tylko te tabele, których
-- jeszcze w niej nie ma. Gdy nigdy nie zostanie zastosowana, klient degraduje
-- łagodnie (kanał zgłasza błąd => live=false, wraca baner „nieaktualne dane”
-- i ręczne odświeżenie).
-- =============================================================================

do $$
declare
  t text;
  realtime_tables text[] := array[
    -- osiem grup planera (lustrzane przez MERGE_CLOUD_ENTITIES)
    'clients',
    'projects',
    'milestones',
    'tasks',
    'task_assignments',
    'workload_entries',
    'comments',
    'activity_events',
    -- pięć tabel słownikowych (mapy id ze snapshotu organizacji)
    'profiles',
    'departments',
    'statuses',
    'service_types',
    'work_categories'
  ];
begin
  -- Świeże projekty Supabase mają publikację `supabase_realtime`; tworzymy ją
  -- tylko, gdy jej brak (np. lokalny stack bez domyślnej publikacji).
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  foreach t in array realtime_tables loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;
