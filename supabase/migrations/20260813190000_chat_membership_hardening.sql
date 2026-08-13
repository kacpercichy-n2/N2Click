-- =============================================================================
-- Migracja: 20260813190000_chat_membership_hardening
--
-- Dwa fixy z przeglądu bezpieczeństwa modułu czatu (20260813180000_chat):
--
-- FIX 1 — PRZEJĘCIE CZŁONKOSTWA. Polityka UPDATE na `conversation_members`
-- sprawdza wyłącznie `user_id = auth.uid()` (stary i nowy wiersz), więc członek
-- DOWOLNEJ rozmowy mógł podmienić `conversation_id` SWOJEGO wiersza na id cudzej
-- rozmowy (dołączając do niej bez zaproszenia i czytając całą historię) albo
-- podnieść sobie `role` na 'owner'. Analogicznie polityka UPDATE na `messages`
-- pilnuje tylko `author_id`, więc autor mógł przenieść własną wiadomość do
-- rozmowy, której nie jest członkiem (wstrzyknięcie treści). Lekarstwo: GRANTY
-- KOLUMNOWE zamiast tabelowego UPDATE — RLS decyduje O WIERSZACH, grant
-- o KOLUMNACH; klient i tak aktualizuje wyłącznie te kolumny (chatData.ts:
-- `update({ last_read_at })`; edycji wiadomości jeszcze nie ma w API).
--
-- FIX 2 — NOWE ROZMOWY NA ŻYWO. Klient subskrybuje wyłącznie kanały rozmów,
-- które już zna z `chat_overview()`, więc świeżo założona rozmowa docierała do
-- zaproszonego dopiero przy pełnym odświeżeniu. Nowy trigger na
-- `conversation_members` nadaje zdarzenie na KANAŁ OSOBISTY
-- `chat:user:<uuid członka>`; klient trzyma jedną subskrypcję własnego kanału
-- i na INSERT/DELETE odświeża listę rozmów (a uzgadnianie kanałów dołoży
-- subskrypcję nowej rozmowy). `app.chat_topic_member` uczy się nowego topicu:
-- wyłącznie właściciel uuid słucha swojego kanału.
--
-- Konwencja domu jak w 20260813180000_chat: pełna kwalifikacja nazw,
-- idempotentnie, funkcje z `set search_path = ''`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. FIX 1: granty kolumnowe UPDATE
-- -----------------------------------------------------------------------------

-- Członkostwo: wolno zmieniać wyłącznie własny znacznik przeczytania
-- i wyciszenie. `conversation_id`/`user_id`/`role` stają się niezmienialne
-- dla `authenticated` niezależnie od polityk.
revoke update on n2click.conversation_members from authenticated;
grant update (last_read_at, muted_until) on n2click.conversation_members to authenticated;

-- Wiadomości: wolno edytować treść i znaczniki edycji/miękkiego skasowania.
-- `conversation_id`/`author_id`/`created_at`/`reply_to` niezmienialne.
revoke update on n2click.messages from authenticated;
grant update (body, edited_at, deleted_at) on n2click.messages to authenticated;

-- -----------------------------------------------------------------------------
-- 2. FIX 2a: `app.chat_topic_member` rozumie kanał osobisty `chat:user:<uuid>`
-- -----------------------------------------------------------------------------

create or replace function app.chat_topic_member(topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_conversation uuid;
  v_user uuid;
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

  -- Kanał osobisty zaproszeń: słucha go WYŁĄCZNIE właściciel uuid.
  if topic like 'chat:user:%' then
    begin
      -- 'chat:user:' też ma 10 znaków.
      v_user := substring(topic from 11)::uuid;
    exception
      when others then
        return false;
    end;
    return v_user = (select auth.uid())
      and coalesce((select core.has_app('n2click')), false);
  end if;

  return false;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. FIX 2b: trigger zaproszeń na kanał osobisty
--
-- INSERT = dodano cię do rozmowy, DELETE = usunięto (opuszczenie grupy).
-- CELOWO bez UPDATE: zmiany `last_read_at` przy każdym odczycie zalałyby
-- kanał osobisty szumem.
-- -----------------------------------------------------------------------------

create or replace function n2click.chat_broadcast_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.broadcast_changes(
    'chat:user:' || coalesce(new.user_id, old.user_id)::text,
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

drop trigger if exists chat_members_broadcast on n2click.conversation_members;
create trigger chat_members_broadcast
  after insert or delete on n2click.conversation_members
  for each row execute function n2click.chat_broadcast_membership();
