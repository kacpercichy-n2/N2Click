-- Tabela przyzwoleń dostępu per aplikacja (handoff 4.2). Samo konto w
-- auth.users NIE daje dostępu do żadnej appki — dostęp nadaje wpis tutaj.
create table core.app_access (
  user_id    uuid not null references auth.users(id) on delete cascade,
  app        text not null check (app in ('n2click','blogoapp')),  -- clarity celowo poza listą (handoff sekcja 7)
  role       text not null default 'member',
  company_id uuid not null references core.companies(id),
  created_at timestamptz not null default now(),
  primary key (user_id, app)
);
alter table core.app_access enable row level security;
-- brak polityk = niedostępna dla anon/authenticated; pisze admin przez
-- service_role, czyta hook (SECURITY DEFINER); user swoje role widzi w JWT
grant select, insert, update, delete on core.app_access to service_role;
