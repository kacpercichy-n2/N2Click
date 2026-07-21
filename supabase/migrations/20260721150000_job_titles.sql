-- =============================================================================
-- Migracja: 20260721150000_job_titles
--
-- Słownik stanowisk („Stanowiska” w Administracji): odczyt dla każdego
-- zalogowanego, zapis wyłącznie administrator. Tabela jest SAMODZIELNYM
-- słownikiem organizacji (parytet z `departments`) — mirror paneli admina płynie
-- wprost do tej tabeli, a hydracja podmienia lokalną kolekcję autorytatywnie.
--
-- Konwencja domu (patrz supabase/README.md): RLS w tym samym pliku, revoke anon,
-- polityki to authenticated + with check, bez force row level security.
-- Reużywamy istniejących funkcji `app.is_administrator()` i triggera
-- `app.set_updated_at()` — BEZ nowych funkcji. Idempotentnie
-- (`if not exists` / `drop policy if exists`): plik bywa aplikowany ręcznie przez
-- SQL editor zanim `db push` uzupełni rejestr.
-- =============================================================================

create table if not exists public.job_titles (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists job_titles_set_updated_at on public.job_titles;
create trigger job_titles_set_updated_at
  before update on public.job_titles
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS: deny-by-default + odebranie dostępu roli anon.
-- -----------------------------------------------------------------------------

alter table public.job_titles enable row level security;
revoke all on public.job_titles from anon;

drop policy if exists "job_titles_select" on public.job_titles;
create policy "job_titles_select" on public.job_titles
  for select to authenticated
  using (true);

drop policy if exists "job_titles_insert_admin" on public.job_titles;
create policy "job_titles_insert_admin" on public.job_titles
  for insert to authenticated
  with check (app.is_administrator());

drop policy if exists "job_titles_update_admin" on public.job_titles;
create policy "job_titles_update_admin" on public.job_titles
  for update to authenticated
  using (app.is_administrator())
  with check (app.is_administrator());

drop policy if exists "job_titles_delete_admin" on public.job_titles;
create policy "job_titles_delete_admin" on public.job_titles
  for delete to authenticated
  using (app.is_administrator());

-- Publikacja realtime (parytet z departments) — idempotentnie:
do $$
begin
  begin
    alter publication supabase_realtime add table public.job_titles;
  exception
    when duplicate_object then null;
  end;
end $$;
