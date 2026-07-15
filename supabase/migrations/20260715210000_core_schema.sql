-- =============================================================================
-- Migracja: 20260715210000_core_schema
--
-- Bazowy schemat relacyjny N2Hub pod model dostępu działowego. Polityki RLS
-- dochodzą w kolejnej migracji (20260715210500_rls_policies); tutaj RLS jest
-- tylko WŁĄCZANE, więc tabele są domyślnie zamknięte (deny-by-default) od
-- pierwszej chwili istnienia.
--
-- Konwencja migracji (obowiązuje wszystkie kolejne pliki):
--   * katalog: supabase/migrations/, nazwa: YYYYMMDDHHMMSS_opis.sql,
--   * migracje są tylko-do-przodu; zastosowanego pliku nie wolno edytować,
--   * cała logika uprawnień żyje w SQL (RLS/triggery), nigdy w kliencie,
--   * każda nowa funkcja ustawia `set search_path = ''` i w pełni kwalifikuje
--     nazwy obiektów,
--   * po utworzeniu funkcji w schemacie `app` należy odebrać EXECUTE roli
--     PUBLIC i nadać go jawnie roli `authenticated`.
--
-- Ta migracja NIE jest jeszcze podłączona do aplikacji: frontend nadal działa
-- wyłącznie na localStorage (src/store/storage.ts). Schemat odwzorowuje
-- minimalny rdzeń modelu z src/types.ts: profile (Person), działy (Department),
-- projekty (Project), członkostwo w projektach, zadania (Task) i przypisania
-- (TaskAssignment). Pozostałe encje (klienci, statusy, bloki godzin itd.)
-- dojdą w kolejnych migracjach, gdy będzie projektowana synchronizacja danych.
-- =============================================================================

-- Schemat na wewnętrzne funkcje pomocnicze. PostgREST domyślnie wystawia tylko
-- `public`, więc nic z `app` nie jest osiągalne przez API jako RPC.
create schema if not exists app;

grant usage on schema app to authenticated;

-- Poziom dostępu aplikacyjnego (odpowiednik AccessRole z src/types.ts).
-- Mapowanie ról frontendu zostanie potwierdzone przy zadaniu integracyjnym;
-- robocze założenie: administrator -> administrator, pm -> manager,
-- handlowiec/pracownik -> worker.
create type public.access_role as enum ('administrator', 'manager', 'worker');

-- Wspólny trigger utrzymujący updated_at.
create function app.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Działy
-- -----------------------------------------------------------------------------

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at
  before update on public.departments
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- Profile (1:1 z auth.users; menedżer to profil z access_role = 'manager',
-- zarządzający działem wskazanym w swoim department_id)
-- -----------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  first_name text not null check (char_length(first_name) between 1 and 100),
  last_name text not null default '',
  email text not null default '',
  role_title text not null default '',
  access_role public.access_role not null default 'worker',
  department_id uuid references public.departments (id) on delete set null,
  -- Ścieżka obiektu w prywatnym buckecie `avatars`
  -- (konwencja: <id profilu>/<nazwa pliku>).
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indeks pod warunki polityk „ten sam dział co menedżer”.
create index profiles_department_id_idx on public.profiles (department_id);

create trigger set_updated_at
  before update on public.profiles
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- Projekty
-- -----------------------------------------------------------------------------

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 300),
  description text not null default '',
  -- null = projekt bez działu: widzą go administratorzy i jawni członkowie.
  department_id uuid references public.departments (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index projects_department_id_idx on public.projects (department_id);

create trigger set_updated_at
  before update on public.projects
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- Członkostwo w projektach (jawna lista dostępu dla pracowników)
-- -----------------------------------------------------------------------------

create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, profile_id)
);

-- Indeks pod „moje projekty” (klucz główny obsługuje kierunek od projektu).
create index project_members_profile_id_idx on public.project_members (profile_id);

-- -----------------------------------------------------------------------------
-- Zadania
-- -----------------------------------------------------------------------------

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  description text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tasks_project_id_idx on public.tasks (project_id);

create trigger set_updated_at
  before update on public.tasks
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- Przypisania zadań (własność zadania po stronie pracownika)
-- -----------------------------------------------------------------------------

create table public.task_assignments (
  task_id uuid not null references public.tasks (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, profile_id)
);

-- Indeks pod „moje zadania” (klucz główny obsługuje kierunek od zadania).
create index task_assignments_profile_id_idx on public.task_assignments (profile_id);

-- -----------------------------------------------------------------------------
-- RLS: włączone od razu, polityki w następnej migracji => brak jakiegokolwiek
-- dostępu przez API do czasu ich zdefiniowania.
--
-- UWAGA: celowo BEZ `force row level security`. Funkcje pomocnicze w schemacie
-- `app` są SECURITY DEFINER i czytają te tabele jako ich właściciel — właśnie
-- dzięki temu polityki nie odpytują tabel rekurencyjnie. FORCE objąłby RLS
-- także właściciela i wprowadziłby nieskończoną rekursję polityk profiles.
-- -----------------------------------------------------------------------------

alter table public.departments enable row level security;
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.tasks enable row level security;
alter table public.task_assignments enable row level security;

-- Klient anonimowy nie ma w N2Hub żadnych danych publicznych — odbieramy mu
-- domyślne uprawnienia nadawane przez Supabase na nowych tabelach w `public`.
revoke all on public.departments, public.profiles, public.projects,
  public.project_members, public.tasks, public.task_assignments
from anon;
