-- =============================================================================
-- Migracja: 20260825130000_chat_themes
--
-- MOTYWY CZATU (model Messengera): motyw jest WSPÓLNY dla rozmowy — każdy
-- uczestnik może go zmienić, wszyscy widzą ten sam, a w wątku ląduje wiersz
-- systemowy „X ustawia motyw »Y«". Trzy zmiany:
--
--   * `conversations.theme_id` — identyfikator motywu z katalogu w kodzie
--     (`src/chat/themes/catalog.ts`). Baza waliduje wyłącznie KSZTAŁT
--     (`^[a-z0-9-]{1,32}$`), nie listę: allowlista w bazie wymagałaby migracji
--     przy każdym nowym skinie, a nieznany id klient i tak sprowadza do
--     domyślnego (stary klient vs nowy skin).
--   * `messages.kind` (`text` | `system`) + `messages.meta` jsonb — wiersz
--     systemowy jedzie TĄ SAMĄ tabelą co wiadomości: ta sama kolejność,
--     paginacja, broadcast INSERT i licznik nieprzeczytanych, zero drugiego
--     źródła. Polska treść buduje się w kliencie z `meta`
--     (`{type:'theme_changed', themeId, actorId}`); `body` niesie zapasowy
--     tekst dla podglądu na liście rozmów. Klient może wstawiać WYŁĄCZNIE
--     `kind = 'text'` bez `meta` (polityka INSERT niżej); grant UPDATE jest
--     kolumnowy (20260813190000), więc `kind`/`meta` są nieedytowalne.
--   * RPC `n2click.chat_set_theme(p_conversation_id, p_theme_id)` — definer:
--     UPDATE rozmowy (użytkownik CELOWO nie ma UPDATE na `conversations`),
--     wiersz systemowy i własny event `theme_changed` przez `realtime.send`
--     na prywatnym topicu rozmowy. Zmiana na TEN SAM motyw jest no-opem
--     (bez wiersza, bez eventu).
--
-- `chat_overview()` zwraca teraz także `theme_id`; zmiana typu wyniku wymaga
-- DROP + CREATE (`create or replace` nie zmienia listy kolumn `returns table`).
--
-- Konwencja domu jak w 20260813180000_chat: pełna kwalifikacja nazw, polityki
-- wyłącznie `to authenticated` z `with check`, funkcje z
-- `set search_path = ''`, wszystko idempotentnie.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Kolumny
-- -----------------------------------------------------------------------------

alter table n2click.conversations
  add column if not exists theme_id text not null default 'lawenda'
    check (char_length(theme_id) between 1 and 32 and theme_id ~ '^[a-z0-9-]+$');

comment on column n2click.conversations.theme_id is
  'Motyw czatu (katalog src/chat/themes/catalog.ts). Baza pilnuje kształtu, nie listy; nieznany id => domyślny w kliencie.';

alter table n2click.messages
  add column if not exists kind text not null default 'text'
    check (kind in ('text', 'system')),
  add column if not exists meta jsonb;

comment on column n2click.messages.kind is
  'text = wiadomość użytkownika; system = wiersz zdarzenia (np. zmiana motywu), wstawiany wyłącznie przez RPC.';
comment on column n2click.messages.meta is
  'Ładunek wiersza systemowego, np. {"type":"theme_changed","themeId":"lawenda","actorId":"<uuid>"}. NULL dla text.';

-- Klient wstawia WYŁĄCZNIE zwykłe wiadomości; wiersze systemowe pochodzą z RPC.
drop policy if exists "chat_messages_insert" on n2click.messages;
create policy "chat_messages_insert" on n2click.messages
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and app.is_conversation_member(conversation_id)
    and kind = 'text'
    and meta is null
  );

-- Edycja i kasowanie miękkie zostają dla ZWYKŁYCH wiadomości autora; wiersz
-- systemowy (autor = ten, kto zmienił motyw) nie może zostać przepisany ani
-- skasowany z klienta (przegląd Codex 2026-08-25).
drop policy if exists "chat_messages_update" on n2click.messages;
create policy "chat_messages_update" on n2click.messages
  for update to authenticated
  using (author_id = (select auth.uid()) and kind = 'text')
  with check (author_id = (select auth.uid()) and kind = 'text');

-- -----------------------------------------------------------------------------
-- 2. RPC `n2click.chat_set_theme`
-- -----------------------------------------------------------------------------

create or replace function n2click.chat_set_theme(p_conversation_id uuid, p_theme_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_updated boolean;
begin
  if v_uid is null or not coalesce((select core.has_app('n2click')), false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_theme_id is null or p_theme_id !~ '^[a-z0-9-]{1,32}$' then
    raise exception 'bad theme id' using errcode = '22023';
  end if;
  if not app.is_conversation_member(p_conversation_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update n2click.conversations
  set theme_id = p_theme_id
  where id = p_conversation_id and theme_id is distinct from p_theme_id;
  v_updated := found;
  if not v_updated then
    return; -- ten sam motyw: bez wiersza systemowego i bez eventu
  end if;

  -- Wiersz systemowy: trigger stempli nadaje created_at, trigger broadcastu
  -- rozsyła INSERT do wszystkich w rozmowie, trigger bump podbija kolejność.
  insert into n2click.messages (conversation_id, author_id, kind, body, meta)
  values (
    p_conversation_id,
    v_uid,
    'system',
    'Zmieniono motyw czatu',
    jsonb_build_object('type', 'theme_changed', 'themeId', p_theme_id, 'actorId', v_uid)
  );

  perform realtime.send(
    jsonb_build_object(
      'conversationId', p_conversation_id,
      'themeId', p_theme_id,
      'actorId', v_uid
    ),
    'theme_changed',
    'chat:conv:' || p_conversation_id::text,
    true
  );
end;
$$;

comment on function n2click.chat_set_theme(uuid, text) is
  'Ustawia motyw rozmowy (wspólny dla wszystkich uczestników), dopisuje wiersz systemowy i wysyła event theme_changed na chat:conv:<id>. Ten sam motyw = no-op.';

revoke all on function n2click.chat_set_theme(uuid, text) from public, anon;
grant execute on function n2click.chat_set_theme(uuid, text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. `chat_overview()` z `theme_id` (DROP + CREATE: nowa kolumna wyniku)
-- -----------------------------------------------------------------------------

drop function if exists n2click.chat_overview();

create function n2click.chat_overview()
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
  theme_id text,
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
    c.theme_id,
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
        'kind', lm.kind,
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
  'Lista rozmów zalogowanego: wiersz rozmowy (+ theme_id) + członkowie (jsonb) + ostatnia wiadomość (jsonb z kind, NULL gdy brak) + licznik nieprzeczytanych. SECURITY INVOKER — filtruje RLS.';

revoke all on function n2click.chat_overview() from public, anon;
grant execute on function n2click.chat_overview() to authenticated, service_role;
