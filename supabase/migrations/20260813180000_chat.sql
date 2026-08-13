-- =============================================================================
-- Migracja: 20260813180000_chat
--
-- Moduł CZATU WEWNĘTRZNEGO N2Hub: rozmowy 1:1 (`direct`) i grupowe (`group`),
-- członkostwo z własnym znacznikiem przeczytania oraz wiadomości z miękkim
-- kasowaniem i odpowiedzią na wiadomość. Trzy tabele w schemacie `n2click`,
-- trzy funkcje pomocnicze w `app`, dwie funkcje triggerowe w `n2click`
-- i jedno RPC listy rozmów (`n2click.chat_overview`).
--
-- DECYZJA NR 1 — BROADCAST, NIE `postgres_changes` (twarda, nie do obejścia):
-- `CloudSyncProvider` nasłuchuje w kliencie zdarzeń `event:*` na CAŁYM schemacie
-- `n2click` i KAŻDE zdarzenie wyzwala PEŁNĄ rehydrację plannera u wszystkich
-- zalogowanych. Wpuszczenie tabel czatu do publikacji `supabase_realtime`
-- oznaczałoby więc pełne przeładowanie danych planera przy każdej wysłanej
-- wiadomości. Dlatego:
--   * tabele czatu ŚWIADOMIE NIE WCHODZĄ do publikacji `supabase_realtime`
--     (żadnego `alter publication ... add table` w tym pliku — to nie jest
--     przeoczenie, tylko warunek wydajnościowy modułu),
--   * na żywo idzie WYŁĄCZNIE Broadcast: trigger `chat_broadcast_message`
--     woła `realtime.broadcast_changes` na prywatnym topicu
--     `chat:conv:<uuid rozmowy>`, a klient subskrybuje tylko rozmowy, które
--     ma otwarte. Presence („kto pisze”/„kto online”) jedzie topikiem
--     `chat:presence`.
-- Autoryzację obu kanałów robią polityki na `realtime.messages` (sekcja niżej),
-- bo kanał prywatny Broadcast/Presence sprawdza RLS tej tabeli.
--
-- DECYZJA NR 2 — GRANTY. Schemat `n2click` ma `alter default privileges …
-- grant all on tables to anon, authenticated, service_role`
-- (20260731081544), więc ŚWIEŻA tabela dostaje w nim ALL — łącznie
-- z TRUNCATE dla `anon`, który omija RLS. Każda z trzech tabel ma tu zatem
-- najpierw `revoke all … from anon, authenticated`, a dopiero potem grant na
-- verby, których moduł realnie używa (żadnego DELETE na rozmowach
-- i wiadomościach — kasowanie jest MIĘKKIE, przez `messages.deleted_at`).
--
-- Konwencja domu (supabase/README.md, CLAUDE.md): pełna kwalifikacja nazw
-- (nigdy `public.*`), `enable row level security` w tym samym pliku, w którym
-- powstaje tabela, polityki wyłącznie `to authenticated`, insert/update zawsze
-- z `with check`, brak `force row level security` (rekursja funkcji definer),
-- funkcje z `set search_path = ''`. Wszystko idempotentnie (`if not exists` /
-- `create or replace` / `drop policy if exists`) — plik bywa aplikowany ręcznie
-- w SQL editorze, zanim rejestr migracji go dogoni.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tabele
-- -----------------------------------------------------------------------------

-- Rozmowa. `direct_key` to klucz deduplikacyjny pary 1:1 — dwa uuid profili
-- POSORTOWANE LEKSYKALNIE i złączone dwukropkiem („<a>:<b>”). Dzięki `unique`
-- dwie osoby nigdy nie zrobią sobie dwóch równoległych rozmów prywatnych;
-- dla `kind = 'group'` kolumna zostaje NULL (unique przepuszcza wiele NULL-i).
-- `context_type`/`context_id` to LUŹNE dowiązanie do projektu/klienta/zadania
-- (czat „przy” encji) — świadomie BEZ FK, żeby usunięcie encji nie kasowało
-- historii rozmowy; dangle sprząta klient przy renderowaniu etykiety.
create table if not exists n2click.conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('direct', 'group')),
  -- Tytuł ma sens tylko dla grupy; rozmowa 1:1 tytułuje się imieniem rozmówcy
  -- po stronie klienta, więc trzyma tu NULL.
  title text check (title is null or char_length(title) between 1 and 200),
  -- Spółka zakładającego, brana z claimu JWT (`app_company`) — kolumna jest
  -- INFORMACYJNA (nie steruje RLS-em, widoczność daje wyłącznie członkostwo)
  -- i celowo nullable: konto bez spółki nadal zakłada rozmowy.
  company_id uuid references core.companies(id) on delete set null
    default core.company_for('n2click'),
  direct_key text unique,
  context_type text check (context_type is null or context_type in ('project', 'client', 'task')),
  context_id uuid,
  created_by uuid not null references core.profiles(id),
  created_at timestamptz not null default now(),
  -- Podbijane triggerem `chat_bump_conversation` — to po nim sortuje się lista
  -- rozmów, więc nowa (pusta) rozmowa startuje na górze.
  last_message_at timestamptz not null default now()
);

comment on table n2click.conversations is
  'Rozmowa czatu wewnętrznego: 1:1 (kind=direct, deduplikowana przez direct_key) albo grupowa (kind=group).';
comment on column n2click.conversations.direct_key is
  'Klucz pary rozmowy 1:1: dwa uuid profili posortowane leksykalnie i złączone '':'' . NULL dla rozmów grupowych.';
comment on column n2click.conversations.last_message_at is
  'Znacznik ostatniej wiadomości (trigger n2click.chat_bump_conversation) — porządek listy rozmów.';

-- Członkostwo. Klucz główny (rozmowa, osoba) — jeden wiersz na parę.
-- `last_read_at` startuje od epoki, żeby CAŁA historia rozmowy liczyła się
-- świeżo dodanej osobie jako nieprzeczytana (a nie „przeczytane wstecz”).
create table if not exists n2click.conversation_members (
  conversation_id uuid not null references n2click.conversations(id) on delete cascade,
  user_id uuid not null references core.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  last_read_at timestamptz not null default 'epoch'::timestamptz,
  muted_until timestamptz,
  primary key (conversation_id, user_id)
);

-- Klucz główny obsługuje „członkowie rozmowy”; ten indeks obsługuje kierunek
-- odwrotny — „rozmowy zalogowanego”, czyli predykat KAŻDEJ polityki czatu
-- (`app.is_conversation_member`) i join RPC listy rozmów.
create index if not exists members_by_user
  on n2click.conversation_members (user_id, conversation_id);

comment on table n2click.conversation_members is
  'Członkostwo w rozmowie + per-osobowy znacznik przeczytania (last_read_at) i wyciszenia (muted_until).';

-- Wiadomość. Kasowanie jest MIĘKKIE (`deleted_at`) — stąd brak polityki
-- i grantu DELETE; twarde sprzątanie historii to przyszła decyzja operatora.
-- `reply_to` na `set null`: skasowanie wiadomości-rodzica nie zabiera
-- odpowiedzi, tylko zrywa cytat.
create table if not exists n2click.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references n2click.conversations(id) on delete cascade,
  author_id uuid not null references core.profiles(id),
  body text not null check (char_length(body) between 1 and 4000),
  reply_to uuid references n2click.messages(id) on delete set null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);

-- Kolejność dokładnie taka, jak czyta ją okno rozmowy (najnowsze najpierw,
-- `id` jako deterministyczny rozstrzygacz remisu w tej samej mikrosekundzie).
create index if not exists messages_feed
  on n2click.messages (conversation_id, created_at desc, id desc);

comment on table n2click.messages is
  'Wiadomość czatu. Kasowanie MIĘKKIE (deleted_at) — brak polityki i grantu DELETE.';

-- -----------------------------------------------------------------------------
-- 2. Deny-by-default + granty (patrz DECYZJA NR 2 w nagłówku)
-- -----------------------------------------------------------------------------

alter table n2click.conversations enable row level security;
alter table n2click.conversation_members enable row level security;
alter table n2click.messages enable row level security;

revoke all on n2click.conversations from anon, authenticated;
revoke all on n2click.conversation_members from anon, authenticated;
revoke all on n2click.messages from anon, authenticated;

revoke all on n2click.conversations from service_role;
revoke all on n2click.conversation_members from service_role;
revoke all on n2click.messages from service_role;

-- Rozmowy: bez UPDATE (tytuł grupy poza MVP, `last_message_at` podbija trigger
-- definer) i bez DELETE (rozmowy się nie kasuje z klienta).
grant select, insert on n2click.conversations to authenticated;
-- Członkostwo: UPDATE = `last_read_at`/`muted_until`, DELETE = opuszczenie grupy.
grant select, insert, update, delete on n2click.conversation_members to authenticated;
-- Wiadomości: UPDATE = edycja własnej treści i kasowanie miękkie.
grant select, insert, update on n2click.messages to authenticated;

-- `service_role` dostaje pełne DML, ale NIGDY TRUNCATE (omija RLS).
grant select, insert, update, delete on n2click.conversations to service_role;
grant select, insert, update, delete on n2click.conversation_members to service_role;
grant select, insert, update, delete on n2click.messages to service_role;

-- -----------------------------------------------------------------------------
-- 3. Funkcje pomocnicze polityk (schemat `app`, poza API PostgREST)
--
-- Wzorzec taki jak `app.is_project_member`: SECURITY DEFINER + `stable` +
-- `set search_path = ''` + pełna kwalifikacja nazw. Definer jest tu KONIECZNY:
-- polityka `conversation_members_select` czyta tę samą tabelę, na której działa,
-- więc zwykły EXISTS wpadłby w rekursję RLS.
-- -----------------------------------------------------------------------------

create or replace function app.is_conversation_member(conv uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select conv is not null and exists (
    select 1
    from n2click.conversation_members m
    where m.conversation_id = conv
      and m.user_id = (select auth.uid())
  );
$$;

-- Twórca rozmowy — używane przez politykę INSERT na członkostwie. Bez tej
-- funkcji polityka musiałaby czytać `n2click.conversations`, której wiersz
-- w momencie dodawania PIERWSZEGO członka nie jest jeszcze widoczny przez
-- `conversations_select` (bo widoczność wymaga… członkostwa).
create or replace function app.chat_conversation_creator(conv uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.created_by
  from n2click.conversations c
  where c.id = conv;
$$;

-- Autoryzacja topicu kanału Realtime. BEZPIECZNY PARSER: rzutowanie `::uuid`
-- na śmieciowym topicu podniosłoby wyjątek W ŚRODKU sprawdzania polityki, co
-- wywala CAŁE połączenie realtime klienta (nie tylko jeden kanał) — dlatego
-- rzutowanie siedzi we własnym bloku `exception`, a każdy nierozpoznany topic
-- kończy się twardym `false`.
create or replace function app.chat_topic_member(topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_conversation uuid;
begin
  if topic is null then
    return false;
  end if;

  -- Presence („kto online / kto pisze”) jest wspólny dla całej appki —
  -- wystarczy dostęp do N2Click.
  if topic = 'chat:presence' then
    return coalesce((select core.has_app('n2click')), false);
  end if;

  if topic like 'chat:conv:%' then
    begin
      -- 'chat:conv:' ma 10 znaków, uuid zaczyna się na pozycji 11.
      v_conversation := substring(topic from 11)::uuid;
    exception
      when others then
        return false; -- zły uuid w topicu = brak dostępu, NIGDY wyjątek
    end;
    return app.is_conversation_member(v_conversation);
  end if;

  return false;
end;
$$;

revoke all on function app.is_conversation_member(uuid) from public;
revoke all on function app.chat_conversation_creator(uuid) from public;
revoke all on function app.chat_topic_member(text) from public;

grant execute on function app.is_conversation_member(uuid) to authenticated;
grant execute on function app.chat_conversation_creator(uuid) to authenticated;
grant execute on function app.chat_topic_member(text) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Polityki RLS — rozmowy
--
-- Widoczność rozmowy daje WYŁĄCZNIE członkostwo (spółka i kontekst niczego nie
-- otwierają). Bramka `core.has_app('n2click')` jak wszędzie w schemacie.
-- -----------------------------------------------------------------------------

-- Gałąź `created_by` jest KONIECZNA, nie kosmetyczna: `INSERT ... RETURNING`
-- (supabase-js `.insert().select()`) sprawdza politykę SELECT na świeżym
-- wierszu, a twórca w chwili zakładania rozmowy NIE JEST jeszcze członkiem
-- (wiersze `conversation_members` wstawia zaraz po). Bez tej gałęzi założenie
-- każdej rozmowy kończy się błędem RLS. Skutek uboczny (twórca, który opuścił
-- grupę, nadal widzi jej wiersz-metadane) jest akceptowalny — wiadomości i tak
-- chroni `chat_messages_select` po członkostwie.
drop policy if exists "chat_conversations_select" on n2click.conversations;
create policy "chat_conversations_select" on n2click.conversations
  for select to authenticated
  using (
    (select core.has_app('n2click'))
    and (
      app.is_conversation_member(id)
      or created_by = (select auth.uid())
    )
  );

drop policy if exists "chat_conversations_insert" on n2click.conversations;
create policy "chat_conversations_insert" on n2click.conversations
  for insert to authenticated
  with check (
    (select core.has_app('n2click'))
    and created_by = (select auth.uid())
  );

-- ŚWIADOMIE bez UPDATE i DELETE dla użytkownika: `last_message_at` podbija
-- trigger definer, a zmiana tytułu grupy i kasowanie rozmowy są poza MVP.

-- -----------------------------------------------------------------------------
-- 5. Polityki RLS — członkostwo
-- -----------------------------------------------------------------------------

drop policy if exists "chat_conversation_members_select" on n2click.conversation_members;
create policy "chat_conversation_members_select" on n2click.conversation_members
  for select to authenticated
  using (app.is_conversation_member(conversation_id));

-- Członków dokłada TWÓRCA rozmowy — także siebie samego, zaraz po insercie
-- rozmowy. Predykat idzie przez definera, więc nie ma rekursji z polityką
-- SELECT na tej samej tabeli.
drop policy if exists "chat_conversation_members_insert" on n2click.conversation_members;
create policy "chat_conversation_members_insert" on n2click.conversation_members
  for insert to authenticated
  with check (app.chat_conversation_creator(conversation_id) = (select auth.uid()));

-- Wyłącznie własny wiersz: `last_read_at` i `muted_until`. `with check` pilnuje,
-- żeby UPDATE nie przepisał wiersza na inną osobę.
drop policy if exists "chat_conversation_members_update" on n2click.conversation_members;
create policy "chat_conversation_members_update" on n2click.conversation_members
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Opuszczenie rozmowy — tylko siebie.
drop policy if exists "chat_conversation_members_delete" on n2click.conversation_members;
create policy "chat_conversation_members_delete" on n2click.conversation_members
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- 6. Polityki RLS — wiadomości
-- -----------------------------------------------------------------------------

drop policy if exists "chat_messages_select" on n2click.messages;
create policy "chat_messages_select" on n2click.messages
  for select to authenticated
  using (
    (select core.has_app('n2click'))
    and app.is_conversation_member(conversation_id)
  );

drop policy if exists "chat_messages_insert" on n2click.messages;
create policy "chat_messages_insert" on n2click.messages
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and app.is_conversation_member(conversation_id)
  );

-- Edycja treści i kasowanie MIĘKKIE (`deleted_at`) — wyłącznie własnych
-- wiadomości. Brak polityki DELETE jest celowy (patrz nagłówek).
drop policy if exists "chat_messages_update" on n2click.messages;
create policy "chat_messages_update" on n2click.messages
  for update to authenticated
  using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- 7. Triggery: Broadcast na żywo + porządek listy rozmów
--
-- Obie funkcje są SECURITY DEFINER: pierwsza wstawia wiersz do
-- `realtime.messages` (tabela poza grantami appki), druga podbija
-- `n2click.conversations`, na której użytkownik CELOWO nie ma UPDATE.
-- Obie są AFTER … FOR EACH ROW i zwracają NULL (wynik AFTER-triggera jest
-- ignorowany).
-- -----------------------------------------------------------------------------

create or replace function n2click.chat_broadcast_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Topic jest PER ROZMOWA, więc zdarzenie dostają wyłącznie klienci, którzy
  -- tę rozmowę mają otwartą — i tylko jeśli przepuści ich polityka
  -- `chat_realtime_messages_select` (sekcja 8).
  perform realtime.broadcast_changes(
    'chat:conv:' || coalesce(new.conversation_id, old.conversation_id)::text,
    tg_op,
    tg_op,
    tg_table_name,
    tg_table_schema,
    new,
    old
  );
  return null;
end;
$$;

create or replace function n2click.chat_bump_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update n2click.conversations
  set last_message_at = new.created_at
  where id = new.conversation_id;
  return null;
end;
$$;

drop trigger if exists chat_messages_broadcast on n2click.messages;
create trigger chat_messages_broadcast
  after insert or update on n2click.messages
  for each row execute function n2click.chat_broadcast_message();

drop trigger if exists chat_messages_bump_conversation on n2click.messages;
create trigger chat_messages_bump_conversation
  after insert on n2click.messages
  for each row execute function n2click.chat_bump_conversation();

-- ŻADNEGO `alter publication supabase_realtime add table …` — patrz DECYZJA
-- NR 1 w nagłówku. Tabele czatu NIE SĄ i nie mogą być w publikacji.

-- -----------------------------------------------------------------------------
-- 8. Polityki na `realtime.messages` — autoryzacja prywatnych kanałów
--
-- Kanał prywatny Broadcast/Presence sprawdza RLS tabeli `realtime.messages`:
-- SELECT = prawo do ODBIERANIA zdarzeń topicu, INSERT = prawo do WYSYŁANIA
-- (klient wysyła „pisze…” broadcastem i robi presence track). Nazwy z prefiksem
-- `chat_`, bo tabela jest WSPÓLNA dla wszystkich appek projektu — polityki są
-- permisywne (OR), więc te wpisy niczego cudzego nie zawężają.
-- -----------------------------------------------------------------------------

drop policy if exists "chat_realtime_messages_select" on realtime.messages;
create policy "chat_realtime_messages_select" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and app.chat_topic_member(realtime.topic())
  );

drop policy if exists "chat_realtime_messages_insert" on realtime.messages;
create policy "chat_realtime_messages_insert" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and app.chat_topic_member(realtime.topic())
  );

-- -----------------------------------------------------------------------------
-- 9. RPC `n2click.chat_overview()` — JEDYNE źródło listy rozmów dla klienta
--
-- SECURITY INVOKER (świadomie): filtrowanie robi RLS, nie funkcja — dlatego
-- ciało nie powtarza ani jednego predykatu widoczności. Zwraca po jednym
-- wierszu na rozmowę zalogowanego, deterministycznie posortowane
-- (`last_message_at desc`, `id` jako rozstrzygacz remisu).
-- -----------------------------------------------------------------------------

create or replace function n2click.chat_overview()
returns table (
  id uuid,
  kind text,
  title text,
  company_id uuid,
  direct_key text,
  context_type text,
  context_id uuid,
  created_by uuid,
  created_at timestamptz,
  last_message_at timestamptz,
  members jsonb,
  last_message jsonb,
  unread_count integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    c.id,
    c.kind,
    c.title,
    c.company_id,
    c.direct_key,
    c.context_type,
    c.context_id,
    c.created_by,
    c.created_at,
    c.last_message_at,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'user_id', mem.user_id,
            'role', mem.role,
            'last_read_at', mem.last_read_at
          )
          order by mem.joined_at, mem.user_id
        )
        from n2click.conversation_members mem
        where mem.conversation_id = c.id
      ),
      '[]'::jsonb
    ) as members,
    (
      select jsonb_build_object(
        'id', lm.id,
        'author_id', lm.author_id,
        'body', lm.body,
        'created_at', lm.created_at,
        'deleted_at', lm.deleted_at
      )
      from n2click.messages lm
      where lm.conversation_id = c.id
      order by lm.created_at desc, lm.id desc
      limit 1
    ) as last_message,
    (
      select count(*)::integer
      from n2click.messages um
      where um.conversation_id = c.id
        and um.author_id <> me.user_id
        and um.created_at > me.last_read_at
    ) as unread_count
  from n2click.conversations c
  join n2click.conversation_members me
    on me.conversation_id = c.id
   and me.user_id = (select auth.uid())
  order by c.last_message_at desc, c.id desc;
$$;

comment on function n2click.chat_overview() is
  'Lista rozmów zalogowanego: wiersz rozmowy + członkowie (jsonb) + ostatnia wiadomość (jsonb, NULL gdy brak) + licznik nieprzeczytanych. SECURITY INVOKER — filtruje RLS.';

-- `alter default privileges` schematu n2click nadaje EXECUTE także `anon`,
-- więc odbieramy je jawnie (funkcja jest wyłącznie dla zalogowanych).
revoke all on function n2click.chat_overview() from public, anon;
grant execute on function n2click.chat_overview() to authenticated, service_role;
