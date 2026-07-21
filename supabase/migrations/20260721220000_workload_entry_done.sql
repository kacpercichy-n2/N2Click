-- =============================================================================
-- Migracja: 20260721220000_workload_entry_done
--
-- Per-blokowy stan „wykonane” na wierszu `workload_entries` (bloku dnia /
-- zasobnika). Każdy blok (WorkloadEntry.id) ma WŁASNY, niezależny znacznik
-- ukończenia — ta sama data z wieloma blokami trzyma osobne wartości, a status
-- zadania (`tasks.status_id`) NIGDY się przez to nie zmienia.
--
-- Model: pojedyncza kolumna `workload_entries.done boolean not null default
-- false`, addytywna dokładnie jak `tasks.is_draft`. DEFAULT FALSE, więc każdy
-- istniejący wiersz i wiersz bez jawnej wartości jest „niewykonany” — bez
-- migracji danych / backfillu.
--
-- Nie tworzy tabeli: RLS dziedziczy się z istniejących polityk
-- `workload_entries_*`, więc ZERO nowych polityk. Tabela jest już w publikacji
-- `supabase_realtime` (20260718091000) — dodanie kolumny tego nie zmienia.
-- Klient mirroruje ją jak zwykłe pole bloku (`cloudMirror.workloadRow.done =
-- w.done === true`), a hydracja `plannerData` czyta `row.done === true`
-- (NULL/legacy/false => niewykonany).
--
-- Idempotentnie (`add column if not exists`): plik bywa aplikowany ręcznie przez
-- SQL editor zanim `db push` uzupełni rejestr.
-- =============================================================================

alter table public.workload_entries
  add column if not exists done boolean not null default false;
