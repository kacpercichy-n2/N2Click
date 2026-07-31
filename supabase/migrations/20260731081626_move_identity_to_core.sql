-- Faza 2a: rdzeń tożsamości do core. SET SCHEMA zabiera indeksy, constrainty,
-- triggery, polityki RLS i granty tabel; publikacja realtime podąża po OID.
alter type public.access_role set schema core;
alter table public.profiles  set schema core;
alter table public.companies set schema core;
