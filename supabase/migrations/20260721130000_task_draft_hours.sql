-- =============================================================================
-- Migracja: 20260721130000_task_draft_hours
--
-- Godziny sprzedane per osoba wpisane na etapie SZKICU zadania (`tasks.is_draft`).
-- To INTENCJA sprzed publikacji, NIE planowane godziny — nie tworzy wierszy
-- `workload_entries`. Przy publikacji szkicu klient materializuje te godziny w
-- jeden wiersz zasobnika na osobę, po czym kolumna wraca do NULL.
--
-- Model: pojedyncza kolumna `tasks.draft_hours jsonb` (nullable, NULL = brak),
-- dokładnie jak osadzone `tasks.checklist` / `projects.documents`. Kształt:
--   [ { "profile_id": uuid, "hours": number } ]
-- Świadomie BEZ osobnej tabeli: lista jest krótka, czytana i zapisywana razem z
-- zadaniem, a widoczność ma być IDENTYCZNA z widocznością zadania — dziedziczenie
-- RLS z wiersza `public.tasks` załatwia to bez ani jednej nowej polityki.
--
-- Nie tworzy tabeli, więc bez zmian RLS/polityk ani publikacji realtime; klient
-- mirroruje tę kolumnę jak zwykłe pole zadania (`cloudMirror.taskRow.draft_hours`,
-- hydracja `plannerData` buduje pole tylko dla wierszy `is_draft`). NULL/legacy =
-- brak godzin szkicu.
--
-- Idempotentnie (`add column if not exists`): plik bywa aplikowany ręcznie przez
-- SQL editor zanim `db push` uzupełni rejestr.
-- =============================================================================

alter table public.tasks
  add column if not exists draft_hours jsonb;
