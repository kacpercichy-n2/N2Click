-- =============================================================================
-- Migracja: 20260721020000_task_is_draft
--
-- Szkice zadań: zadanie utworzone WEWNĄTRZ projektu pozostaje szkicem, dopóki
-- nie zostanie opublikowane („Zapisz i opublikuj” na projekcie). Szkic jest
-- widoczny wyłącznie w widoku projektu i celowo NIE tworzy wierszy
-- `workload_entries` (zasobnik/kalendarz) — planowane godziny powstają dopiero
-- po publikacji.
--
-- Model: pojedyncza kolumna `tasks.is_draft boolean not null default false`.
-- Domyślnie FALSE, więc KAŻDY istniejący wiersz (i każdy wiersz bez jawnie
-- ustawionej flagi) jest opublikowany — brak migracji danych, brak backfillu.
-- Nowe zadania z projektu klient zapisuje z jawnym `is_draft = true`.
--
-- Nie tworzy tabeli, więc bez zmian RLS/polityk ani publikacji realtime; klient
-- mirroruje tę kolumnę jak zwykłe pole zadania (jak `order_index`/`checklist`).
--
-- Idempotentnie (`add column if not exists`): plik bywa aplikowany ręcznie przez
-- SQL editor zanim `db push` uzupełni rejestr.
-- =============================================================================

alter table public.tasks
  add column if not exists is_draft boolean not null default false;
