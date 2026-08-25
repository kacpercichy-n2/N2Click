-- =============================================================================
-- Migracja: 20260825120000_chat_reactions
--
-- REAKCJE EMOJI na wiadomości czatu (model Messengera): JEDNA reakcja na
-- (wiadomość, osoba) — wybór innego emoji podmienia, ponowny wybór tego samego
-- zdejmuje. Dwie tabele w schemacie `n2click` i jedno RPC:
--
--   * `n2click.chat_emoji` — ALLOWLISTA znaków. Postgres nie umie sprawdzić
--     „czy to emoji” regexem (brak \p{Emoji} w POSIX), więc jedyną prawdziwą
--     strażą jest klucz obcy do listy wygenerowanej z `src/chat/ui/chatEmoji.ts`
--     (test `chatEmoji.test.ts` pilnuje, że oba zbiory są identyczne — nikt nie
--     zareaguje znakiem, którego picker nie umie pokazać). Tabela NIE jest
--     czytana przez klienta (lista siedzi w bundlu) — zero grantów, RLS bez
--     polityk; sprawdzenie FK działa z uprawnieniami właściciela tabeli.
--   * `n2click.message_reactions` — PK (message_id, user_id), `conversation_id`
--     ZDUBLOWANE celowo: polityka SELECT i topic kanału nie potrzebują joina.
--     Przejście na model Slacka (wiele reakcji na osobę) to jedna migracja
--     na kluczu — dlatego kolumny są już w pełnej postaci.
--   * `n2click.chat_set_reaction(p_message_id, p_emoji)` — JEDYNA droga zapisu
--     (brak grantów INSERT/UPDATE/DELETE dla `authenticated`). Klient sam liczy
--     toggle i wysyła STAN DOCELOWY (emoji albo NULL = zdejmij), więc wywołanie
--     jest idempotentne i podwójne kliknięcie nie może się zdublować. RPC
--     odmawia na wiadomości skasowanej miękko i dla nie-członka.
--
-- REALTIME: własny event `reaction` przez `realtime.send` z ciała RPC, na TYM
-- SAMYM prywatnym topicu `chat:conv:<uuid>` co wiadomości. Świadomie NIE
-- `realtime.broadcast_changes` na nowej tabeli: `ChatProvider` słucha zdarzeń
-- INSERT/UPDATE tego kanału i `extractBroadcastRecord` nie sprawdza
-- `payload.table` — wiersz reakcji zostałby sparsowany jak wiadomość. Ładunek
-- niesie przypisanie (osoba → emoji), nigdy liczników: stan klienta to mapa
-- wiadomość → { osoba → emoji }, więc powtórka i echo są no-opem.
-- Autoryzację topicu robią istniejące polityki `chat_realtime_messages_*`.
--
-- Konwencja domu jak w 20260813180000_chat: pełna kwalifikacja nazw,
-- `enable row level security` w tym samym pliku, `revoke all … from anon,
-- authenticated` przed grantami, polityki wyłącznie `to authenticated`, funkcje
-- z `set search_path = ''`, wszystko idempotentnie.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Allowlista emoji (generowana z src/chat/ui/chatEmoji.ts — nie edytować
--    ręcznie; nowy znak w pickerze = nowa migracja z `insert … on conflict`)
-- -----------------------------------------------------------------------------

create table if not exists n2click.chat_emoji (
  char text primary key
    check (char_length(char) between 1 and 10 and octet_length(char) <= 40)
);

comment on table n2click.chat_emoji is
  'Allowlista emoji reakcji czatu. Źródło: src/chat/ui/chatEmoji.ts (EMOJI_CATEGORIES). Tylko FK — klient nie czyta.';

alter table n2click.chat_emoji enable row level security;
revoke all on n2click.chat_emoji from anon, authenticated, service_role;

insert into n2click.chat_emoji (char) values
  ('😀'),
  ('😃'),
  ('😄'),
  ('😁'),
  ('😆'),
  ('😅'),
  ('🤣'),
  ('😂'),
  ('🙂'),
  ('😉'),
  ('😊'),
  ('😍'),
  ('🥰'),
  ('😘'),
  ('😎'),
  ('🤩'),
  ('🤔'),
  ('🤨'),
  ('😐'),
  ('😴'),
  ('🤯'),
  ('😳'),
  ('😮'),
  ('😢'),
  ('😭'),
  ('😤'),
  ('😡'),
  ('🤢'),
  ('🤒'),
  ('🥳'),
  ('👍'),
  ('👎'),
  ('👌'),
  ('🤌'),
  ('✌️'),
  ('🤞'),
  ('🤟'),
  ('🤙'),
  ('👈'),
  ('👉'),
  ('👆'),
  ('👇'),
  ('✋'),
  ('👋'),
  ('🤝'),
  ('🙏'),
  ('👏'),
  ('🙌'),
  ('💪'),
  ('🫶'),
  ('👀'),
  ('🧠'),
  ('✍️'),
  ('🤲'),
  ('❤️'),
  ('🧡'),
  ('💛'),
  ('💚'),
  ('💙'),
  ('💜'),
  ('🖤'),
  ('🤍'),
  ('🤎'),
  ('💖'),
  ('💗'),
  ('💓'),
  ('💞'),
  ('💕'),
  ('💔'),
  ('❣️'),
  ('👶'),
  ('🧑'),
  ('👩'),
  ('👨'),
  ('👵'),
  ('👴'),
  ('👩‍💻'),
  ('👨‍💻'),
  ('🧑‍🎨'),
  ('🕺'),
  ('💃'),
  ('🐶'),
  ('🐱'),
  ('🐭'),
  ('🐹'),
  ('🐰'),
  ('🦊'),
  ('🐻'),
  ('🐼'),
  ('🦁'),
  ('🐮'),
  ('🐷'),
  ('🐵'),
  ('🐝'),
  ('🦄'),
  ('☕'),
  ('🍵'),
  ('🥤'),
  ('🍺'),
  ('🍻'),
  ('🥂'),
  ('🍷'),
  ('🍾'),
  ('🍎'),
  ('🍌'),
  ('🍓'),
  ('🍉'),
  ('🍇'),
  ('🥑'),
  ('🥕'),
  ('🍞'),
  ('🧀'),
  ('🍕'),
  ('🍔'),
  ('🌮'),
  ('🍟'),
  ('🍿'),
  ('🍫'),
  ('🍩'),
  ('🎂'),
  ('🍪'),
  ('🎉'),
  ('🎊'),
  ('🎈'),
  ('🎁'),
  ('🏆'),
  ('🥇'),
  ('⚽'),
  ('🏀'),
  ('🎾'),
  ('🏐'),
  ('🏃'),
  ('🚴'),
  ('🏋️'),
  ('🧘'),
  ('🏊'),
  ('⛷️'),
  ('🎯'),
  ('🎮'),
  ('🎲'),
  ('🎤'),
  ('🎧'),
  ('🎸'),
  ('🎬'),
  ('🎨'),
  ('📸'),
  ('🚀'),
  ('💡'),
  ('📌'),
  ('📎'),
  ('📁'),
  ('📄'),
  ('📊'),
  ('📈'),
  ('📉'),
  ('📅'),
  ('⏰'),
  ('⌛'),
  ('💻'),
  ('🖥️'),
  ('📱'),
  ('⌨️'),
  ('🖨️'),
  ('🔒'),
  ('🔑'),
  ('💰'),
  ('💳'),
  ('📧'),
  ('📞'),
  ('🔔'),
  ('🔍'),
  ('✏️'),
  ('📝'),
  ('🔥'),
  ('✨'),
  ('⭐'),
  ('🌟'),
  ('💫'),
  ('⚡'),
  ('✅'),
  ('❌'),
  ('⚠️'),
  ('❗'),
  ('❓'),
  ('💯'),
  ('🆗'),
  ('🔴'),
  ('🟠'),
  ('🟡'),
  ('🟢'),
  ('🔵'),
  ('🟣'),
  ('⚫'),
  ('⚪'),
  ('🔁'),
  ('➕'),
  ('➖'),
  ('🚫'),
  ('♻️')
on conflict (char) do nothing;

-- -----------------------------------------------------------------------------
-- 2. Reakcje
-- -----------------------------------------------------------------------------

create table if not exists n2click.message_reactions (
  message_id uuid not null references n2click.messages(id) on delete cascade,
  user_id uuid not null references core.profiles(id) on delete cascade,
  conversation_id uuid not null references n2click.conversations(id) on delete cascade,
  emoji text not null references n2click.chat_emoji(char),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

-- Odczyt strony wiadomości dociąga reakcje osadzeniem PostgREST po FK
-- `message_id`; indeks po rozmowie służy nadrabianiu po powrocie kanału
-- (`in (ids)` w obrębie jednej rozmowy).
create index if not exists message_reactions_conversation
  on n2click.message_reactions (conversation_id, message_id);

comment on table n2click.message_reactions is
  'Reakcja emoji na wiadomość: JEDNA na (wiadomość, osoba). Zapis wyłącznie przez RPC chat_set_reaction.';

alter table n2click.message_reactions enable row level security;
revoke all on n2click.message_reactions from anon, authenticated, service_role;
-- Klient tylko CZYTA (osadzenie `message_reactions(...)` w select wiadomości);
-- każdy zapis idzie przez definera niżej.
grant select on n2click.message_reactions to authenticated;
grant select, insert, update, delete on n2click.message_reactions to service_role;

drop policy if exists "chat_message_reactions_select" on n2click.message_reactions;
create policy "chat_message_reactions_select" on n2click.message_reactions
  for select to authenticated
  using (
    (select core.has_app('n2click'))
    and app.is_conversation_member(conversation_id)
  );

-- -----------------------------------------------------------------------------
-- 3. RPC `n2click.chat_set_reaction` — ustaw / zdejmij własną reakcję
--
-- SECURITY DEFINER (wstawia do tabeli bez grantów zapisu i do
-- `realtime.messages`), więc sam sprawdza członkostwo. `for share` na wiadomości
-- blokuje równoległe kasowanie miękkie w trakcie reakcji. Zwraca PEŁNĄ listę
-- reakcji wiadomości po zmianie (klient podmienia nią stan optymistyczny).
-- -----------------------------------------------------------------------------

create or replace function n2click.chat_set_reaction(p_message_id uuid, p_emoji text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_conversation uuid;
  v_previous text;
begin
  if v_uid is null or not coalesce((select core.has_app('n2click')), false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_emoji is not null and (p_emoji = '' or char_length(p_emoji) > 10) then
    raise exception 'bad emoji' using errcode = '22023';
  end if;

  select m.conversation_id into v_conversation
  from n2click.messages m
  where m.id = p_message_id and m.deleted_at is null
  for share;
  if v_conversation is null then
    raise exception 'message not found' using errcode = 'P0002';
  end if;
  if not app.is_conversation_member(v_conversation) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select r.emoji into v_previous
  from n2click.message_reactions r
  where r.message_id = p_message_id and r.user_id = v_uid;

  if p_emoji is null then
    delete from n2click.message_reactions
    where message_id = p_message_id and user_id = v_uid;
  else
    insert into n2click.message_reactions (message_id, user_id, conversation_id, emoji)
    values (p_message_id, v_uid, v_conversation, p_emoji)
    on conflict (message_id, user_id) do update
      set emoji = excluded.emoji, created_at = now();
  end if;

  if v_previous is distinct from p_emoji then
    perform realtime.send(
      jsonb_build_object(
        'messageId', p_message_id,
        'conversationId', v_conversation,
        'userId', v_uid,
        'emoji', p_emoji,
        'prevEmoji', v_previous,
        'op', case when p_emoji is null then 'remove' else 'set' end,
        'createdAt', now()
      ),
      'reaction',
      'chat:conv:' || v_conversation::text,
      true
    );
  end if;

  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object('user_id', r.user_id, 'emoji', r.emoji, 'created_at', r.created_at)
        order by r.created_at, r.user_id
      ),
      '[]'::jsonb
    )
    from n2click.message_reactions r
    where r.message_id = p_message_id
  );
end;
$$;

comment on function n2click.chat_set_reaction(uuid, text) is
  'Ustawia (emoji) albo zdejmuje (NULL) reakcję zalogowanego na wiadomość; jedna na osobę. Zwraca pełną listę reakcji wiadomości. Broadcast event reaction na chat:conv:<id>.';

-- `alter default privileges` schematu n2click nadaje EXECUTE także `anon`.
revoke all on function n2click.chat_set_reaction(uuid, text) from public, anon;
grant execute on function n2click.chat_set_reaction(uuid, text) to authenticated, service_role;
