-- =============================================================================
-- Migracja: 20260803160300_contentplan_seed_app_access
--
-- Nadanie dostępu do modułu Content Plan. Decyzja operatora (2026-08-03, plan
-- §2 pkt 4 i §4 pkt 3): moduł widzą WYŁĄCZNIE administratorzy, więc seed kopiuje
-- tylko wiersze `app='n2click'` z `role='admin'` (mapowanie ról ustala
-- 20260731082129: lokalne `administrator` → chmurowe `admin`) i nadaje im
-- `role='admin'` w aplikacji `contentplan`. Spółka (`company_id`) przechodzi
-- 1:1 — jest NOT NULL w tabeli bazowej.
--
-- ZMIANA W `core` (jedyna, wymuszona): `core.app_access.app` ma CHECK z listą
-- dozwolonych aplikacji (20260731081703: 'n2click','blogoapp'), więc bez
-- rozszerzenia listy INSERT poniżej odbiłby się od constraintu. Rozszerzamy
-- listę o 'contentplan' — struktura tabeli, RLS ani polityki `core` nie
-- zmieniają się w żaden inny sposób. `clarity` zostaje poza listą celowo
-- (decyzja z handoffu przebudowy schematów).
--
-- Idempotentnie: CHECK jest wyszukiwany po definicji i odtwarzany, a INSERT ma
-- `on conflict (user_id, app) do nothing` na kluczu głównym tabeli.
-- =============================================================================

do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'core.app_access'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%n2click%'
  loop
    execute format('alter table core.app_access drop constraint %I', c.conname);
  end loop;
end $$;

alter table core.app_access
  add constraint app_access_app_check check (app in ('n2click', 'blogoapp', 'contentplan'));

insert into core.app_access (user_id, app, role, company_id)
select a.user_id,
       'contentplan',
       'admin',
       a.company_id
from core.app_access a
where a.app = 'n2click'
  and a.role = 'admin'
on conflict (user_id, app) do nothing;
