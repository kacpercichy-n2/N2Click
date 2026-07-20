-- =============================================================================
-- Migracja: 20260721010000_project_documents
--
-- Dokumenty handlowe projektu (oferta / wycena / brief / link) jako ODNOŚNIKI.
-- Aplikacja nie przechowuje plików — Supabase Storage NIE jest tu używany.
--
-- Model: osadzona tablica `projects.documents` (jsonb), dokładnie jak
-- `tasks.checklist` (20260716190000_planner_entities). Świadomie BEZ osobnej
-- tabeli: lista jest krótka, zawsze czytana i zapisywana razem z projektem,
-- a widoczność ma być IDENTYCZNA z widocznością projektu — dziedziczenie RLS
-- z wiersza `public.projects` załatwia to bez ani jednej nowej polityki.
--
-- Kształt jednego wpisu (walidacja kształtu żyje po stronie klienta,
-- src/store/storage.ts → repairProjectDocuments):
--   { "id": uuid, "kind": "oferta|wycena|brief|link", "label": text, "url": text }
--
-- Nie tworzy tabeli, więc bez zmian RLS/polityk ani publikacji realtime;
-- klient mirroruje tę kolumnę jak zwykłe pole projektu.
--
-- Idempotentnie (`add column if not exists` + `drop constraint if exists`):
-- plik bywa aplikowany ręcznie przez SQL editor zanim `db push` uzupełni rejestr.
-- =============================================================================

alter table public.projects
  add column if not exists documents jsonb not null default '[]'::jsonb;

-- Twardy kształt kolumny: zawsze tablica JSON (nigdy obiekt, liczba czy null).
alter table public.projects
  drop constraint if exists projects_documents_is_array;

alter table public.projects
  add constraint projects_documents_is_array
  check (jsonb_typeof(documents) = 'array');
