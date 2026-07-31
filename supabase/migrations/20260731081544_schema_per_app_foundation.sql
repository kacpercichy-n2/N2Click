-- Przebudowa schema-per-app (handoff n2hub-db-restructure, Faza 1):
-- cztery schematy + granty USAGE + default privileges. `core` celowo bez anon
-- i bez default privileges dla ról klienckich — dostęp przez widoki-mostki.
create schema if not exists core;
create schema if not exists n2click;
create schema if not exists clarity;
create schema if not exists blogoapp;

grant usage on schema n2click, clarity, blogoapp to anon, authenticated, service_role;
grant usage on schema core to authenticated, service_role;

alter default privileges in schema n2click grant all on tables to anon, authenticated, service_role;
alter default privileges in schema n2click grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema n2click grant execute on functions to anon, authenticated, service_role;

alter default privileges in schema clarity grant all on tables to anon, authenticated, service_role;
alter default privileges in schema clarity grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema clarity grant execute on functions to anon, authenticated, service_role;

alter default privileges in schema blogoapp grant all on tables to anon, authenticated, service_role;
alter default privileges in schema blogoapp grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema blogoapp grant execute on functions to anon, authenticated, service_role;

alter default privileges in schema core grant all on tables to service_role;
