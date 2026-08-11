-- =============================================================================
-- Migracja: 20260811150000_contentplan_admin_grant_preserves_client
--
-- Korekta 20260811130000 (review): grant contentplan przy roli n2click 'admin'
-- używał `on conflict do update set role='admin'`, co NADPISYWAŁO istniejący
-- wiersz portalowego klienta (role='client'). Późniejsza degradacja z admina
-- kasuje wyłącznie wiersze role='admin' — po takiej rundzie klient traciłby
-- dostęp do portalu bezpowrotnie. `do nothing` zostawia istniejący wiersz
-- w spokoju: klient zachowuje portal, a wiersz admin powstaje tylko wtedy,
-- gdy pary (user, contentplan) jeszcze nie ma.
--
-- Dane żywej bazy NIE wymagają korekty: liczba wierszy contentplan
-- role='client' została zweryfikowana przed i po aplikacji 20260811130000
-- (1 == 1) — seed nie nadpisał żadnego klienta. Zmienia się wyłącznie funkcja.
-- =============================================================================

create or replace function core.sync_contentplan_from_n2click()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if new.role = 'admin' then
    insert into core.app_access (user_id, app, role, company_id)
    values (new.user_id, 'contentplan', 'admin', new.company_id)
    on conflict (user_id, app) do nothing;
  else
    delete from core.app_access
     where user_id = new.user_id
       and app = 'contentplan'
       and role = 'admin';
  end if;
  return new;
end;
$$;
