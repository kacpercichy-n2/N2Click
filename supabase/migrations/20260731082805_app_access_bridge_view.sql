-- Widok-mostek do core.app_access dla Edge Function provision-account
-- (PostgREST nie wystawia core; service_role omija RLS, authenticated/anon nie
-- mają grantów na tabeli bazowej => security_invoker odmawia).
create view n2click.app_access with (security_invoker = on) as
  select * from core.app_access;
revoke all on n2click.app_access from anon, authenticated;
