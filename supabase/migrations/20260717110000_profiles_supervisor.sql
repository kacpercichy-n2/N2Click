-- =============================================================================
-- Migracja: 20260717110000_profiles_supervisor
--
-- Relacja przełożony ↔ pracownik na profilach (odpowiednik `Person.supervisorId`
-- z modelu lokalnego). Kolumna opcjonalna, czysto referencyjna: `on delete set
-- null`, zakaz wskazania samego siebie. Zmieniać ją może wyłącznie administrator
-- — rozszerzamy istniejący trigger app.protect_profile_privileges o
-- `supervisor_id` (dotychczas chronił id/access_role/department_id), więc
-- właściciel profilu nadal może edytować swoje pozostałe pola, ale nie
-- hierarchię.
--
-- Konwencja (patrz 20260715210000_core_schema): migracja tylko-do-przodu,
-- nazwa YYYYMMDDHHMMSS_opis.sql. Bez nowych polityk RLS — istniejące polityki
-- `profiles_*` obejmują kolumnę automatycznie.
-- =============================================================================

alter table public.profiles
  add column supervisor_id uuid references public.profiles (id) on delete set null,
  add constraint profiles_supervisor_not_self
    check (supervisor_id is null or supervisor_id <> id);

-- Indeks pod odczyty „podwładni przełożonego”.
create index profiles_supervisor_id_idx on public.profiles (supervisor_id);

create or replace function app.protect_profile_privileges()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or app.is_administrator() then
    return new;
  end if;
  if new.id is distinct from old.id
     or new.access_role is distinct from old.access_role
     or new.department_id is distinct from old.department_id
     or new.supervisor_id is distinct from old.supervisor_id then
    raise exception 'Tylko administrator może zmieniać rolę dostępu, dział lub przełożonego profilu';
  end if;
  return new;
end;
$$;
