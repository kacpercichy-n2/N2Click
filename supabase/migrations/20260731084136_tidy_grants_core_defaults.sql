-- Kosmetyka po weryfikacji (znaleziska 9 i 10): martwe granty anon na widokach
-- tożsamości + default privileges w core dla przyszłych sekwencji/funkcji.
revoke all on n2click.profiles, n2click.companies from anon;
alter default privileges in schema core grant all on sequences to service_role;
alter default privileges in schema core grant execute on functions to service_role;
