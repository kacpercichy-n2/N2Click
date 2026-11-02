-- =============================================================================
-- Migracja: 20261102100000_task_conversations
--
-- Karta zadania v2 (docs/karta-v2/SPEC.md, "Data contract"): rozmowa zadania
-- to zwykła rozmowa czatu z `context_type = 'task'`, `context_id = id zadania`.
-- Ten plik rozszerza silnik czatu o wszystko, czego potrzebuje karta i dok:
--
--   1. `messages`: załączniki (jsonb), wzmianki (uuid[]), przypięcie
--      (`pinned_at`/`pinned_by`), treść może być pusta, gdy są załączniki.
--   2. `conversations`: jedna rozmowa na encję kontekstu (unikalny indeks
--      częściowy), rozmowa zadania zawsze `kind = 'group'` bez `direct_key`.
--   3. Widoczność: `app.is_conversation_member` dla rozmowy zadania wymaga
--      DODATKOWO prawa odczytu zadania (ta sama reguła co polityka
--      `tasks_select`). Kto straci wgląd w zadanie, traci rozmowę, kanał
--      realtime i załączniki, nawet jeśli wiersz członkostwa został.
--   4. RPC: `chat_open_task`, `chat_set_pin`, `chat_set_follow`.
--   5. Triggery: walidacja treści wiadomości (ścieżki załączników po stronie
--      serwera), stempel rewizji przy przypięciu, auto-obserwujący rozmowy
--      zadania (autor, wspomniani, wykonawcy), broadcast `read`.
--   6. `chat_overview()` zwraca też `muted_until` członków i liczbę
--      załączników ostatniej wiadomości.
--
-- DECYZJA: rozmowa zadania zostaje `kind = 'group'` (CHECK `kind` bez zmian).
-- Tożsamość daje kontekst. Powód: trigger `chat_validate_conversation` i klient
-- (parser `kind`) znają tylko direct/group; nowy `kind` wymagałby zmian w obu
-- bez żadnej korzyści. Klient rozpoznaje rozmowę zadania po `context_type`.
--
-- Konwencja domu jak w 20260813180000_chat: pełna kwalifikacja nazw,
-- idempotentnie, funkcje z `set search_path = ''`, polityki `to authenticated`.
-- Bez jawnego begin/commit (narzędzie aplikujące owija plik w transakcję).
--
-- Poprawki po przeglądzie R1 (docs/karta-v2/R1-SECURITY-REVIEW.md), F1:
--   * lock_timeout 5 s (ALTER TABLE i polityki biorą ACCESS EXCLUSIVE),
--   * SELECT wiadomości i reakcji liczy członkostwo RAZ na zapytanie
--     (app.chat_my_conversation_ids), nie per wiersz,
--   * zwykły INSERT rozmowy nie ustawia kontekstu wcale (rozmowy z kontekstem
--     tylko przez definery, dziś chat_open_task),
--   * walidacja treści najpierw sprawdza członkostwo (brak wyroczni reply_to),
--   * wzmianki: tylko osoby nazwane w treści jako @Imię, w rozmowie zadania
--     tylko z wglądem w zadanie, max 20,
--   * `revised_at`: rewizja do scalania zdarzeń (edycja, pin, odpin,
--     kasowanie); `edited_at` zmienia się wyłącznie ze zmianą `body`,
--   * kanał `chat:conv:<id>` tylko dla zdarzeń serwera; klient nadaje
--     wyłącznie „pisze…” na `chat:typing:<id>` i presence na `chat:presence`.
-- =============================================================================

-- Przy kolejce za długim odczytem lepiej przerwać i powtórzyć, niż trzymać
-- w kolejce wszystkie odczyty czatu za ACCESS EXCLUSIVE.
set local lock_timeout = '5s';

-- -----------------------------------------------------------------------------
-- 1. Kolumny i ograniczenia `messages`
-- -----------------------------------------------------------------------------

alter table n2click.messages
  add column if not exists attachments jsonb not null default '[]'::jsonb,
  add column if not exists mention_ids uuid[] not null default '{}'::uuid[],
  add column if not exists pinned_at timestamptz,
  add column if not exists pinned_by uuid references core.profiles(id) on delete set null,
  add column if not exists revised_at timestamptz;

comment on column n2click.messages.attachments is
  'Obrazy wiadomości: tablica (max 10) obiektów {path, mime, width, height, size, name}. path = <conversation_id>/<uuid>.<ext> w buckecie chat-attachments. Walidacja: trigger chat_messages_validate_content.';
comment on column n2click.messages.mention_ids is
  'Id profili wspomnianych w treści (parsowane w kliencie). Wspomniany z wglądem w zadanie zostaje obserwującym rozmowy zadania i dostaje task_mention.';
comment on column n2click.messages.pinned_at is
  'Przypięcie wiadomości (NULL = nieprzypięta). Zapis wyłącznie przez RPC chat_set_pin.';
comment on column n2click.messages.revised_at is
  'Rewizja wiersza do scalania stron i broadcastów: przy INSERT = created_at, każda edycja treści, pin, odpin i kasowanie podbija ją monotonicznie. edited_at zmienia się tylko ze zmianą body (etykieta „(edytowana)”).';

-- Rewizja dla wierszy sprzed migracji: najpóźniejszy znany stempel. UPDATE bez
-- triggerów (inaczej każdy wiersz poszedłby broadcastem UPDATE i dostał nową
-- rewizję). ALTER TABLE wyżej trzyma już ACCESS EXCLUSIVE, więc wyłączenie
-- triggerów nic nie zmienia dla równoległych sesji; błąd cofa całą transakcję.
do $$
begin
  if exists (select 1 from n2click.messages where revised_at is null) then
    alter table n2click.messages disable trigger chat_messages_stamp_edit;
    alter table n2click.messages disable trigger chat_messages_broadcast;
    update n2click.messages
    set revised_at = greatest(created_at, coalesce(edited_at, created_at), coalesce(deleted_at, created_at))
    where revised_at is null;
    alter table n2click.messages enable trigger chat_messages_stamp_edit;
    alter table n2click.messages enable trigger chat_messages_broadcast;
  end if;
end;
$$;
alter table n2click.messages alter column revised_at set not null;

-- Treść: pusta dozwolona tylko z załącznikiem. Nazwa `messages_body_check`
-- to nazwa nadana przez Postgresa inline CHECK z 20260813180000_chat.
alter table n2click.messages drop constraint if exists messages_body_check;
alter table n2click.messages add constraint messages_body_check check (
  char_length(body) <= 4000
  and (char_length(body) >= 1 or jsonb_array_length(attachments) > 0)
);

alter table n2click.messages drop constraint if exists messages_attachments_shape;
alter table n2click.messages add constraint messages_attachments_shape check (
  jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 10
);

-- Wzmianki: bez NULL-i i z limitem (20 osób), żeby jedną wiadomością nie dało
-- się zalać powiadomieniami całej firmy. Trigger walidacji i tak zostawia
-- tylko osoby nazwane w treści (R1 finding 7).
alter table n2click.messages drop constraint if exists messages_mentions_shape;
alter table n2click.messages add constraint messages_mentions_shape check (
  cardinality(mention_ids) <= 20 and array_position(mention_ids, null) is null
);

alter table n2click.messages drop constraint if exists messages_pin_pair;
alter table n2click.messages add constraint messages_pin_pair check (
  (pinned_at is null and pinned_by is null) or pinned_at is not null
);

-- Pasek „Przypięte” czyta przypięte wiadomości rozmowy.
create index if not exists messages_pinned
  on n2click.messages (conversation_id, pinned_at desc)
  where pinned_at is not null;

-- -----------------------------------------------------------------------------
-- 2. `conversations`: jedna rozmowa na encję kontekstu
-- -----------------------------------------------------------------------------

create unique index if not exists conversations_context_unique
  on n2click.conversations (context_type, context_id)
  where context_type is not null and context_id is not null;

alter table n2click.conversations drop constraint if exists conversations_task_context_shape;
alter table n2click.conversations add constraint conversations_task_context_shape check (
  context_type is distinct from 'task'
  or (kind = 'group' and context_id is not null and direct_key is null)
);

-- -----------------------------------------------------------------------------
-- 3. Widoczność zadania (helpery `app`)
-- -----------------------------------------------------------------------------

-- Czy ZALOGOWANY widzi zadanie. Lustro polityki `n2click.tasks.tasks_select`
-- po wszystkich przepisaniach (20260720190000 + bramka has_app 20260731082207
-- + spółka 20260731084109):
--   has_app('n2click') AND (administrator OR manager OR przypisany)
--   AND app.company_ok_project(project_id)
-- Zmiana tamtej polityki MUSI zmienić też tę funkcję (smoke check w
-- docs/karta-v2/L1-DB-NOTES.md porównuje oba teksty).
create or replace function app.chat_can_read_task(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_task_id is not null
    and coalesce((select core.has_app('n2click')), false)
    and exists (
      select 1
      from n2click.tasks t
      where t.id = p_task_id
        and (app.is_administrator() or app.is_manager() or app.is_assigned_to_task(t.id))
        and app.company_ok_project(t.project_id)
    );
$$;

comment on function app.chat_can_read_task(uuid) is
  'Czy zalogowany widzi zadanie: lustro polityki tasks_select (claimy JWT). Używane przez is_conversation_member i chat_open_task.';

-- Czy DOWOLNA osoba widzi zadanie. Ta sama reguła, ale bez JWT: claimy
-- `app_roles`/`app_company` pochodzą 1:1 z `core.app_access` (hook
-- core.custom_access_token), a rola planera z `core.profiles.access_role`.
-- Używane tylko w triggerach i RPC (komu wolno zostać obserwującym i dostać
-- powiadomienie). NIE jest wystawione klientom: byłoby wyrocznią
-- „czy osoba X widzi zadanie Y”.
create or replace function app.chat_user_can_read_task(p_user_id uuid, p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null and p_task_id is not null and exists (
    select 1
    from n2click.tasks t
    join core.app_access aa
      on aa.user_id = p_user_id and aa.app = 'n2click'
    left join n2click.projects pr on pr.id = t.project_id
    where t.id = p_task_id
      and (
        exists (
          select 1 from core.profiles p
          where p.id = p_user_id and p.access_role in ('administrator', 'manager')
        )
        or exists (
          select 1 from n2click.task_assignments ta
          where ta.task_id = t.id and ta.profile_id = p_user_id
        )
      )
      and (
        t.project_id is null
        or aa.role = 'admin'
        or pr.id is null
        or pr.company_id is null
        or pr.company_id = aa.company_id
      )
  );
$$;

comment on function app.chat_user_can_read_task(uuid, uuid) is
  'Czy osoba widzi zadanie (reguła tasks_select liczona z core.app_access i core.profiles zamiast JWT). Tylko dla triggerów i RPC, bez EXECUTE dla klientów.';

-- Czy rozmowa jest rozmową zadania (polityka INSERT członkostwa).
create or replace function app.chat_is_task_conversation(conv uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from n2click.conversations c
    where c.id = conv and c.context_type = 'task'
  );
$$;

-- Członkostwo: dla rozmowy zadania dodatkowo bieżący wgląd w zadanie.
-- Ta funkcja stoi za KAŻDĄ polityką czatu, za autoryzacją kanału
-- `chat:conv:<id>` (app.chat_topic_member) i za polityką bucketu
-- chat-attachments, więc jedna zmiana zamyka wszystkie ścieżki.
create or replace function app.is_conversation_member(conv uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select conv is not null
    and coalesce((select core.has_app('n2click')), false)
    and exists (
      select 1
      from n2click.conversation_members m
      join n2click.conversations c on c.id = m.conversation_id
      where m.conversation_id = conv
        and m.user_id = (select auth.uid())
        and (c.context_type is distinct from 'task' or app.chat_can_read_task(c.context_id))
    );
$$;

-- Zbiór rozmów zalogowanego, liczony RAZ na zapytanie (R1 finding 2).
-- Polityki SELECT wiadomości i reakcji pytają `conversation_id in (select ...)`,
-- więc planer liczy zbiór raz (hashed subplan) zamiast odpalać
-- is_conversation_member + chat_can_read_task dla każdego wiersza.
-- Ta sama reguła co is_conversation_member (członek + dla zadania bieżący
-- wgląd); is_conversation_member zostaje dla sprawdzeń jednego wiersza
-- (INSERT/UPDATE, RPC, topic, Storage).
create or replace function app.chat_my_conversation_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.conversation_id
  from n2click.conversation_members m
  join n2click.conversations c on c.id = m.conversation_id
  where m.user_id = (select auth.uid())
    and coalesce((select core.has_app('n2click')), false)
    and (c.context_type is distinct from 'task' or app.chat_can_read_task(c.context_id));
$$;

comment on function app.chat_my_conversation_ids() is
  'Rozmowy zalogowanego (członek + dla rozmowy zadania bieżący wgląd). Dla polityk SELECT wielu wierszy: liczone raz na zapytanie.';

revoke all on function app.chat_my_conversation_ids() from public, anon;
grant execute on function app.chat_my_conversation_ids() to authenticated, service_role;

revoke all on function app.chat_can_read_task(uuid) from public, anon, authenticated;
revoke all on function app.chat_user_can_read_task(uuid, uuid) from public, anon, authenticated;
revoke all on function app.chat_is_task_conversation(uuid) from public, anon;
grant execute on function app.chat_is_task_conversation(uuid) to authenticated;
grant execute on function app.chat_can_read_task(uuid) to service_role;
grant execute on function app.chat_user_can_read_task(uuid, uuid) to service_role;
grant execute on function app.chat_is_task_conversation(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 4. Polityki: rozmowy zadań powstają i dostają członków WYŁĄCZNIE przez
--    definera `chat_open_task` (i triggery). Ogólne API nie zarezerwuje
--    tożsamości zadania ani nie dopisze do niej cudzej osoby.
-- -----------------------------------------------------------------------------

-- Gałąź `created_by` (INSERT ... RETURNING twórcy grupy) nie obejmuje rozmów
-- zadań: twórca, który stracił wgląd w zadanie, nie widzi już nawet wiersza.
drop policy if exists "chat_conversations_select" on n2click.conversations;
create policy "chat_conversations_select" on n2click.conversations
  for select to authenticated
  using (
    (select core.has_app('n2click'))
    and (
      app.is_conversation_member(id)
      or (created_by = (select auth.uid()) and context_type is distinct from 'task')
    )
  );

-- Zwykły INSERT nie ustawia kontekstu WCALE (R1 finding 3): unikalny indeks
-- kontekstu inaczej pozwalałby zarezerwować tożsamość cudzego projektu albo
-- klienta i odpytać jej istnienie przez 23505. Rozmowy z kontekstem powstają
-- tylko w definerach z własną autoryzacją (dziś chat_open_task).
drop policy if exists "chat_conversations_insert" on n2click.conversations;
create policy "chat_conversations_insert" on n2click.conversations
  for insert to authenticated
  with check (
    (select core.has_app('n2click'))
    and created_by = (select auth.uid())
    and context_type is null
    and context_id is null
  );

-- SELECT wielu wierszy: członkostwo raz na zapytanie (R1 finding 2).
-- Pomiar na 20 tys. wiadomości: 2,5 s -> kilka ms (scenariusz czasowy w
-- docs/karta-v2/l1-pgtest/timing.sql).
drop policy if exists "chat_messages_select" on n2click.messages;
create policy "chat_messages_select" on n2click.messages
  for select to authenticated
  using (
    (select core.has_app('n2click'))
    and conversation_id in (select app.chat_my_conversation_ids())
  );

drop policy if exists "chat_message_reactions_select" on n2click.message_reactions;
create policy "chat_message_reactions_select" on n2click.message_reactions
  for select to authenticated
  using (
    (select core.has_app('n2click'))
    and conversation_id in (select app.chat_my_conversation_ids())
  );

drop policy if exists "chat_conversation_members_insert" on n2click.conversation_members;
create policy "chat_conversation_members_insert" on n2click.conversation_members
  for insert to authenticated
  with check (
    app.chat_conversation_creator(conversation_id) = (select auth.uid())
    and not app.chat_is_task_conversation(conversation_id)
  );

-- Edycja i kasowanie miękkie własnej wiadomości wymagają teraz także
-- bieżącego członkostwa (dla zadania: wglądu w zadanie).
drop policy if exists "chat_messages_update" on n2click.messages;
create policy "chat_messages_update" on n2click.messages
  for update to authenticated
  using (
    author_id = (select auth.uid())
    and kind = 'text'
    and app.is_conversation_member(conversation_id)
  )
  with check (
    author_id = (select auth.uid())
    and kind = 'text'
    and app.is_conversation_member(conversation_id)
  );

-- Granty kolumnowe UPDATE bez zmian (body, edited_at, deleted_at). Załączniki,
-- wzmianki, przypięcie i reply_to NIE są edytowalne z klienta.

-- -----------------------------------------------------------------------------
-- 5. Walidacja treści wiadomości (BEFORE INSERT)
-- -----------------------------------------------------------------------------

create or replace function n2click.chat_validate_message_content()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  a jsonb;
  k text;
  v_prefix text := new.conversation_id::text || '/';
  v_path text;
  v_mime text;
  v_ext text;
  v_task uuid;
begin
  -- Najpierw członkostwo (R1 finding 6): BEFORE trigger odpala się przed
  -- WITH CHECK polityki, więc bez tego błąd reply_to (22023) mówiłby
  -- nie-członkowi, do której rozmowy należy wiadomość. Ścieżki serwera bez
  -- JWT (import, service_role) pomijają ten krok.
  if (select auth.uid()) is not null
     and not app.is_conversation_member(new.conversation_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Przypięcie rodzi się wyłącznie przez chat_set_pin.
  new.pinned_at := null;
  new.pinned_by := null;

  -- Rewizja startuje od created_at (stemplowanego już przez
  -- chat_messages_stamp_insert, który sortuje się wcześniej).
  new.revised_at := new.created_at;

  select c.context_id into v_task
  from n2click.conversations c
  where c.id = new.conversation_id and c.context_type = 'task';

  -- Wzmianki (R1 finding 7): deduplikacja, bez autora, tylko osoby nazwane
  -- w treści jako @Imię (ta sama reguła granic słowa co parseChatMentions
  -- w kliencie, bez rozróżniania wielkości liter), a w rozmowie zadania tylko
  -- osoby z wglądem w zadanie. Reszta odpada po cichu (np. imię zmienione
  -- między napisaniem a wysłaniem). Limit 20 pilnuje CHECK messages_mentions_shape.
  new.mention_ids := coalesce(
    (
      select array_agg(distinct u order by u)
      from unnest(new.mention_ids) as u
      join core.profiles p on p.id = u
      where u is not null
        and u <> new.author_id
        and coalesce(btrim(p.first_name), '') <> ''
        and new.body ~* (
          '(^|[^[:alnum:]@])@'
          || regexp_replace(btrim(p.first_name), '([][(){}.*+?^$|\\-])', '\\\1', 'g')
          || '($|[^[:alnum:]])'
        )
        and (v_task is null or app.chat_user_can_read_task(u, v_task))
    ),
    '{}'::uuid[]
  );

  -- Cytat tylko z tej samej rozmowy (inaczej odpowiedź byłaby wyrocznią
  -- istnienia wiadomości z cudzej rozmowy).
  if new.reply_to is not null and not exists (
    select 1 from n2click.messages r
    where r.id = new.reply_to and r.conversation_id = new.conversation_id
  ) then
    raise exception 'chat: odpowiedź musi dotyczyć wiadomości z tej samej rozmowy'
      using errcode = '22023';
  end if;

  if jsonb_typeof(new.attachments) is distinct from 'array'
     or jsonb_array_length(new.attachments) > 10 then
    raise exception 'chat: nieprawidłowe załączniki' using errcode = '22023';
  end if;

  for a in select value from jsonb_array_elements(new.attachments) loop
    if jsonb_typeof(a) is distinct from 'object' then
      raise exception 'chat: nieprawidłowy załącznik' using errcode = '22023';
    end if;
    -- Tylko znane klucze, każdy wymagany.
    if exists (
      select 1 from jsonb_object_keys(a) as key
      where key not in ('path', 'mime', 'width', 'height', 'size', 'name')
    ) then
      raise exception 'chat: nieznane pole załącznika' using errcode = '22023';
    end if;
    if jsonb_typeof(a->'path') is distinct from 'string'
       or jsonb_typeof(a->'mime') is distinct from 'string'
       or jsonb_typeof(a->'name') is distinct from 'string' then
      raise exception 'chat: nieprawidłowy załącznik' using errcode = '22023';
    end if;

    v_path := a->>'path';
    v_mime := a->>'mime';
    -- Ścieżka: <id tej rozmowy>/<uuid>.<ext>, dokładnie jak polityka bucketu.
    if left(v_path, char_length(v_prefix)) <> v_prefix
       or v_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|png|jpg|jpeg|gif)$' then
      raise exception 'chat: ścieżka załącznika spoza rozmowy' using errcode = '22023';
    end if;
    v_ext := substring(v_path from '\.([a-z]+)$');
    if not (
      (v_mime = 'image/webp' and v_ext = 'webp')
      or (v_mime = 'image/png' and v_ext = 'png')
      or (v_mime = 'image/jpeg' and v_ext in ('jpg', 'jpeg'))
      or (v_mime = 'image/gif' and v_ext = 'gif')
    ) then
      raise exception 'chat: niedozwolony typ załącznika' using errcode = '22023';
    end if;
    if char_length(a->>'name') not between 1 and 255 then
      raise exception 'chat: nieprawidłowa nazwa załącznika' using errcode = '22023';
    end if;
    foreach k in array array['width', 'height', 'size'] loop
      if jsonb_typeof(a->k) is distinct from 'number'
         or (a->>k) !~ '^[0-9]{1,10}$'
         or (a->>k)::bigint < 1 then
        raise exception 'chat: nieprawidłowy wymiar albo rozmiar załącznika' using errcode = '22023';
      end if;
    end loop;
    if (a->>'width')::bigint > 20000 or (a->>'height')::bigint > 20000
       or (a->>'size')::bigint > 10485760 then
      raise exception 'chat: załącznik za duży' using errcode = '22023';
    end if;
  end loop;

  return new;
end;
$$;

revoke all on function n2click.chat_validate_message_content() from public, anon, authenticated;

drop trigger if exists chat_messages_validate_content on n2click.messages;
create trigger chat_messages_validate_content
  before insert on n2click.messages
  for each row execute function n2click.chat_validate_message_content();

-- -----------------------------------------------------------------------------
-- 6. Rewizja wiersza: `revised_at` (scalanie) osobno od `edited_at` (etykieta)
--
-- Klient scala strony i broadcasty po `revised_at` (kontrakt
-- docs/karta-v2/L1-L3-CONTRACT.md): UPDATE z rewizją nie nowszą niż znana jest
-- odrzucany. Edycja treści, pin, odpin i kasowanie miękkie podbijają
-- `revised_at` monotonicznie. `edited_at` zmienia się WYŁĄCZNIE ze zmianą
-- `body`, więc przypięcie nie pokazuje już „(edytowana)” (BACKLOG 1).
-- Kasowanie miękkie jest terminalne i zdejmuje przypięcie.
-- Klient nie ma grantu UPDATE na revised_at; trigger i tak nadpisuje wartość.
-- -----------------------------------------------------------------------------

create or replace function n2click.chat_stamp_message_edit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.deleted_at is not null then
    new.deleted_at := old.deleted_at;
  end if;

  if new.deleted_at is not null then
    new.pinned_at := null;
    new.pinned_by := null;
  end if;

  if new.body is distinct from old.body then
    new.edited_at := greatest(
      clock_timestamp(),
      old.edited_at + interval '1 microsecond',
      old.created_at + interval '1 microsecond'
    );
  else
    new.edited_at := old.edited_at;
  end if;

  if new.body is distinct from old.body
     or new.pinned_at is distinct from old.pinned_at
     or new.deleted_at is distinct from old.deleted_at then
    new.revised_at := greatest(
      clock_timestamp(),
      old.revised_at + interval '1 microsecond',
      new.edited_at + interval '1 microsecond',
      old.created_at + interval '1 microsecond'
    );
  else
    new.revised_at := old.revised_at;
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Auto-obserwujący rozmowy zadania (AFTER INSERT na messages)
--
-- Tylko rozmowy zadań. W zwykłej grupie wzmianka NIE dopisuje osoby (dostałaby
-- całą historię bez zaproszenia), a DM ma stały skład.
-- Dopisywani: autor, wspomniani i bieżący wykonawcy zadania, każdy pod
-- warunkiem wglądu w zadanie. `on conflict do nothing` zachowuje istniejący
-- wybór „Przestań obserwować” (muted_until).
-- Nazwa triggera sortuje się PRZED chat_messages_notify_task (AFTER triggery
-- odpalają alfabetycznie), więc świeżo dopisany wspomniany dostaje
-- powiadomienie już przy tej wiadomości.
-- -----------------------------------------------------------------------------

create or replace function n2click.chat_message_auto_members()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task uuid;
begin
  select c.context_id into v_task
  from n2click.conversations c
  where c.id = new.conversation_id and c.context_type = 'task';
  if v_task is null or new.kind <> 'text' then
    return null;
  end if;

  insert into n2click.conversation_members (conversation_id, user_id, role)
  select new.conversation_id, u.uid, 'member'
  from (
    select new.author_id as uid
    union
    select unnest(new.mention_ids)
    union
    select ta.profile_id from n2click.task_assignments ta where ta.task_id = v_task
  ) u
  where u.uid is not null
    and app.chat_user_can_read_task(u.uid, v_task)
  order by u.uid
  on conflict (conversation_id, user_id) do nothing;

  return null;
end;
$$;

revoke all on function n2click.chat_message_auto_members() from public, anon, authenticated;

drop trigger if exists chat_messages_auto_members on n2click.messages;
create trigger chat_messages_auto_members
  after insert on n2click.messages
  for each row execute function n2click.chat_message_auto_members();

-- -----------------------------------------------------------------------------
-- 8. Potwierdzenia odczytu na żywo (event `read`)
-- -----------------------------------------------------------------------------

-- `last_read_at` nie wybiega w przyszłość: inaczej członek mógłby pokazać
-- „Widziane” pod wiadomościami, których jeszcze nie ma.
create or replace function n2click.chat_clamp_last_read()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.last_read_at > clock_timestamp() then
    new.last_read_at := clock_timestamp();
  end if;
  return new;
end;
$$;

revoke all on function n2click.chat_clamp_last_read() from public, anon, authenticated;

drop trigger if exists chat_members_clamp_last_read on n2click.conversation_members;
create trigger chat_members_clamp_last_read
  before update of last_read_at on n2click.conversation_members
  for each row execute function n2click.chat_clamp_last_read();

-- Ten sam topic i mechanizm co reakcje (`realtime.send`, prywatny kanał
-- `chat:conv:<id>`, autoryzacja app.chat_topic_member). Payload camelCase.
create or replace function n2click.chat_broadcast_read()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'conversationId', new.conversation_id,
      'userId', new.user_id,
      'lastReadAt', new.last_read_at
    ),
    'read',
    'chat:conv:' || new.conversation_id::text,
    true
  );
  return null;
end;
$$;

revoke all on function n2click.chat_broadcast_read() from public, anon, authenticated;

drop trigger if exists chat_members_read on n2click.conversation_members;
create trigger chat_members_read
  after update of last_read_at on n2click.conversation_members
  for each row
  when (old.last_read_at is distinct from new.last_read_at)
  execute function n2click.chat_broadcast_read();

-- -----------------------------------------------------------------------------
-- 9. RPC `chat_open_task(p_task_id) -> uuid`
--
-- Znajdź-albo-załóż rozmowę zadania i dopisz wołającego oraz wykonawców
-- (idempotentnie). Autoryzacja: app.chat_can_read_task, czyli dokładnie
-- reguła tasks_select. Kto nie widzi zadania, dostaje 42501 i nic nie
-- powstaje (także dla nieistniejącego id: brak wyroczni istnienia).
-- -----------------------------------------------------------------------------

create or replace function n2click.chat_open_task(p_task_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
begin
  if v_uid is null or not app.chat_can_read_task(p_task_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Serializuje równoległe otwarcia tej samej karty (dwie karty, dwie osoby).
  perform pg_advisory_xact_lock(hashtextextended('n2click.chat_open_task:' || p_task_id::text, 0));

  select c.id into v_id
  from n2click.conversations c
  where c.context_type = 'task' and c.context_id = p_task_id;

  if v_id is null then
    begin
      insert into n2click.conversations (kind, context_type, context_id, created_by, company_id)
      select 'group', 'task', p_task_id, v_uid, pr.company_id
      from n2click.tasks t
      left join n2click.projects pr on pr.id = t.project_id
      where t.id = p_task_id
      returning id into v_id;
    exception when unique_violation then
      select c.id into v_id
      from n2click.conversations c
      where c.context_type = 'task' and c.context_id = p_task_id;
    end;
  end if;
  if v_id is null then
    raise exception 'chat_open_task: nie udało się ustalić rozmowy zadania';
  end if;

  insert into n2click.conversation_members (conversation_id, user_id, role)
  select v_id, u.uid, 'member'
  from (
    select v_uid as uid
    union
    select ta.profile_id from n2click.task_assignments ta where ta.task_id = p_task_id
  ) u
  where u.uid = v_uid or app.chat_user_can_read_task(u.uid, p_task_id)
  order by u.uid
  on conflict (conversation_id, user_id) do nothing;

  return v_id;
end;
$$;

comment on function n2click.chat_open_task(uuid) is
  'Znajdź-albo-załóż rozmowę zadania + dopisz wołającego i wykonawców (idempotentnie). SECURITY DEFINER; autoryzacja app.chat_can_read_task = reguła tasks_select.';

revoke all on function n2click.chat_open_task(uuid) from public, anon;
grant execute on function n2click.chat_open_task(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 10. RPC `chat_set_pin(p_message_id, p_pinned)`
--
-- Każdy członek rozmowy. UPDATE odpala istniejący trigger
-- chat_messages_broadcast (event UPDATE z pełnym wierszem), czyli dokładnie
-- jak edycja. Stan bez zmian = no-op (bez nowej rewizji i bez eventu).
-- Brak wiadomości i brak członkostwa dają ten sam błąd 42501.
-- -----------------------------------------------------------------------------

create or replace function n2click.chat_set_pin(p_message_id uuid, p_pinned boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_conversation uuid;
  v_pinned_at timestamptz;
begin
  if v_uid is null or p_pinned is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select m.conversation_id, m.pinned_at into v_conversation, v_pinned_at
  from n2click.messages m
  where m.id = p_message_id and m.deleted_at is null and m.kind = 'text'
  for update;

  if v_conversation is null or not app.is_conversation_member(v_conversation) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_pinned = (v_pinned_at is not null) then
    return;
  end if;

  update n2click.messages
  set pinned_at = case when p_pinned then clock_timestamp() end,
      pinned_by = case when p_pinned then v_uid end
  where id = p_message_id;
end;
$$;

comment on function n2click.chat_set_pin(uuid, boolean) is
  'Przypina/odpina wiadomość (każdy członek rozmowy). Podbija revised_at (nie edited_at) i nadaje UPDATE na chat:conv:<id> jak edycja.';

revoke all on function n2click.chat_set_pin(uuid, boolean) from public, anon;
grant execute on function n2click.chat_set_pin(uuid, boolean) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 11. RPC `chat_set_follow(p_conversation_id, p_follow)`
--
-- Obserwuj = muted_until NULL, przestań = 'infinity'. Tylko własny wiersz.
-- -----------------------------------------------------------------------------

create or replace function n2click.chat_set_follow(p_conversation_id uuid, p_follow boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or p_follow is null or not app.is_conversation_member(p_conversation_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update n2click.conversation_members
  set muted_until = case when p_follow then null else 'infinity'::timestamptz end
  where conversation_id = p_conversation_id
    and user_id = v_uid;
end;
$$;

comment on function n2click.chat_set_follow(uuid, boolean) is
  'Obserwuj (muted_until NULL) albo przestań obserwować (muted_until infinity) rozmowę; tylko własne członkostwo.';

revoke all on function n2click.chat_set_follow(uuid, boolean) from public, anon;
grant execute on function n2click.chat_set_follow(uuid, boolean) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 12. `chat_overview()`: + muted_until członków, + liczba załączników ostatniej
--     wiadomości (podgląd „Zdjęcie” dla wiadomości bez tekstu).
--     Sygnatura i typ wyniku bez zmian, więc `create or replace` wystarcza.
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
            'last_read_at', mem.last_read_at,
            'muted_until', mem.muted_until
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
        'attachments_count', jsonb_array_length(lm.attachments),
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
  'Lista rozmów zalogowanego: wiersz rozmowy (+ theme_id, context) + członkowie (jsonb z last_read_at i muted_until) + ostatnia wiadomość (jsonb z kind i attachments_count) + licznik nieprzeczytanych. SECURITY INVOKER, filtruje RLS.';

revoke all on function n2click.chat_overview() from public, anon;
grant execute on function n2click.chat_overview() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 13. Kanały Realtime: klient nie nadaje zdarzeń na `chat:conv:<id>`
--     (R1 finding 1, połowa bazy)
--
-- Hostowany Realtime sprawdza prawo zapisu RAZ, przy dołączeniu do kanału:
-- wstawia próbny wiersz `realtime.messages` z samym `topic` i `extension`
-- (bez `event`) i zapamiętuje wynik do końca połączenia. Polityka nie może
-- więc wpuścić „typing” i zatrzymać „INSERT”/„read” na TYM SAMYM topicu.
-- Rozdzielamy topiki:
--   * `chat:conv:<id>`: zdarzenia tylko z serwera (INSERT/UPDATE wiadomości
--     z triggera, `read`, `reaction`, `theme_changed` z definerów przez
--     realtime.send / broadcast_changes, które omijają RLS). Klient tylko słucha.
--   * `chat:typing:<id>`: jedyny broadcast z klienta, event `typing`
--     z `{ userId }`; ten sam warunek członkostwa co rozmowa.
--   * `chat:presence`: tylko presence (track), bez broadcastu.
--   * `chat:user:<id>`: tylko słuchanie (INSERT/DELETE członkostwa z triggera).
-- Podrobione „pisze…” na `chat:typing` pokazuje najwyżej fałszywy wskaźnik
-- pisania w rozmowie, do której nadawca i tak należy.
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

  -- Presence („kto online”) jest wspólny dla całej appki.
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

  if topic like 'chat:typing:%' then
    begin
      -- 'chat:typing:' ma 12 znaków.
      v_conversation := substring(topic from 13)::uuid;
    exception
      when others then
        return false;
    end;
    return app.is_conversation_member(v_conversation);
  end if;

  -- Kanał osobisty zaproszeń: słucha go WYŁĄCZNIE właściciel uuid.
  if topic like 'chat:user:%' then
    begin
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

revoke all on function app.chat_topic_member(text) from public, anon;
grant execute on function app.chat_topic_member(text) to authenticated;

-- SELECT (odbiór) bez zmian: broadcast i presence każdego topicu czatu.
-- INSERT (nadawanie): broadcast WYŁĄCZNIE na `chat:typing:<id>`, presence
-- WYŁĄCZNIE na `chat:presence`.
drop policy if exists "chat_realtime_messages_insert" on realtime.messages;
create policy "chat_realtime_messages_insert" on realtime.messages
  for insert to authenticated
  with check (
    (
      realtime.messages.extension = 'broadcast'
      and (select realtime.topic()) like 'chat:typing:%'
      and app.chat_topic_member((select realtime.topic()))
    )
    or (
      realtime.messages.extension = 'presence'
      and (select realtime.topic()) = 'chat:presence'
      and app.chat_topic_member((select realtime.topic()))
    )
  );

-- Domknięcie: anon nie ma nic na tabelach czatu (default privileges schematu
-- n2click nadają ALL świeżym obiektom; tu tylko potwierdzamy stan).
revoke all on n2click.messages, n2click.conversations, n2click.conversation_members from anon;
