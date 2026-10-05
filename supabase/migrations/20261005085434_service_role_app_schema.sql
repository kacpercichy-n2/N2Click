-- service_role nie miał USAGE na schemacie `app` ani EXECUTE na jego funkcjach.
-- Od przeniesienia tożsamości do `core` (20260731081626) triggery na
-- core.profiles wołają `app.protect_profile_privileges()`, a ta parsuje
-- `app.is_administrator()` — upsert profilu w Edge Function provision-account
-- kończył się 42501 „permission denied for schema app" i żadne konto nie
-- powstawało. service_role i tak omija RLS, więc grant nie poszerza granicy
-- zaufania; tylko pozwala triggerom wykonać się na ścieżkach serwisowych.
grant usage on schema app to service_role;
grant execute on all functions in schema app to service_role;
alter default privileges in schema app grant execute on functions to service_role;
