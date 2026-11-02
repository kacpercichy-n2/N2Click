-- Task conversations reuse group kind; context is the identity.
begin;
alter table n2click.messages
  add column attachments jsonb not null default '[]',
  add column mention_ids uuid[] not null default '{}',
  add column pinned_at timestamptz,
  add column pinned_by uuid references core.profiles(id) on delete set null;
alter table n2click.messages drop constraint messages_body_check;
alter table n2click.messages add constraint messages_body_check check (
  char_length(body) <= 4000 and (char_length(body) >= 1 or jsonb_array_length(attachments) > 0)
);
create unique index conversations_context_unique on n2click.conversations(context_type, context_id)
  where context_type is not null and context_id is not null;

-- Matches tasks_select plus the subsequent app gate and company-scope migration.
create or replace function app.chat_can_read_task(p_task_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(core.has_app('n2click'), false) and exists (
    select 1 from n2click.tasks t where t.id = p_task_id
    and app.company_ok_project(t.project_id)
    and (app.is_administrator() or app.is_manager() or app.is_assigned_to_task(t.id))
  );
$$;
revoke all on function app.chat_can_read_task(uuid) from public, anon;
grant execute on function app.chat_can_read_task(uuid) to authenticated;

-- Membership remains the chat boundary; task visibility is checked on every read,
-- including storage and realtime authorization, rather than only when joining.
create or replace function app.is_conversation_member(conv uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(core.has_app('n2click'), false) and exists (
    select 1 from n2click.conversation_members m
    join n2click.conversations c on c.id = m.conversation_id
    where m.conversation_id = conv and m.user_id = auth.uid()
      and (c.context_type is distinct from 'task' or app.chat_can_read_task(c.context_id))
  );
$$;

-- Task identities cannot be reserved through the generic INSERT API.
drop policy if exists "chat_conversations_insert" on n2click.conversations;
create policy "chat_conversations_insert" on n2click.conversations for insert to authenticated
with check (core.has_app('n2click') and created_by = auth.uid() and context_type is distinct from 'task');
drop policy if exists "chat_conversation_members_insert" on n2click.conversation_members;
create policy "chat_conversation_members_insert" on n2click.conversation_members for insert to authenticated
with check (app.chat_conversation_creator(conversation_id) = auth.uid() and exists (
  select 1 from n2click.conversations c where c.id = conversation_id and c.context_type is distinct from 'task'
));

create or replace function n2click.chat_open_task(p_task_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null or not app.chat_can_read_task(p_task_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- Serializes open + membership repair for a task, including simultaneous opens.
  perform pg_advisory_xact_lock(hashtextextended(p_task_id::text, 0));
  select id into v_id from n2click.conversations where context_type = 'task' and context_id = p_task_id;
  if v_id is null then
    insert into n2click.conversations(kind, context_type, context_id, created_by)
    values ('group', 'task', p_task_id, auth.uid()) returning id into v_id;
  end if;
  insert into n2click.conversation_members(conversation_id, user_id)
    select v_id, u.id from (
      select auth.uid() as id union
      select a.profile_id from n2click.task_assignments a where a.task_id = p_task_id
    ) u order by u.id on conflict do nothing;
  return v_id;
end;
$$;
revoke all on function n2click.chat_open_task(uuid) from public, anon;
grant execute on function n2click.chat_open_task(uuid) to authenticated;

create or replace function n2click.chat_validate_message_content()
returns trigger language plpgsql set search_path = '' as $$
declare a jsonb; k text;
begin
  if jsonb_typeof(new.attachments) <> 'array' or jsonb_array_length(new.attachments) > 10 then
    raise exception 'invalid attachments' using errcode = '22023';
  end if;
  for a in select value from jsonb_array_elements(new.attachments) loop
    if jsonb_typeof(a) <> 'object'
      or coalesce(a->>'path', '') not like new.conversation_id::text || '/%'
      or coalesce(a->>'mime', '') not in ('image/webp','image/png','image/jpeg','image/gif')
      or jsonb_typeof(a->'name') is distinct from 'string'
      or jsonb_typeof(a->'path') is distinct from 'string'
      or jsonb_typeof(a->'mime') is distinct from 'string' then
      raise exception 'invalid attachment metadata' using errcode = '22023';
    end if;
    for k in select unnest(array['width','height','size']) loop
      if jsonb_typeof(a->k) is distinct from 'number' or (a->>k) !~ '^[0-9]+$'
        or (a->>k)::numeric < 1 or (a->>k)::numeric > 2147483647 then
        raise exception 'invalid attachment dimension or size' using errcode = '22023';
      end if;
    end loop;
    if (a->>'size')::numeric > 10485760 then raise exception 'attachment too large'; end if;
  end loop;
  if tg_op = 'INSERT' then
    new.pinned_at := null; new.pinned_by := null;
  end if;
  return new;
end;
$$;
create trigger chat_messages_validate_content before insert or update on n2click.messages
for each row execute function n2click.chat_validate_message_content();
grant update (attachments, mention_ids) on n2click.messages to authenticated;

-- Pin changes need a newer revision so the existing client merge accepts UPDATE.
create or replace function n2click.chat_stamp_message_edit()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.body is distinct from old.body or new.attachments is distinct from old.attachments
    or new.mention_ids is distinct from old.mention_ids or new.pinned_at is distinct from old.pinned_at
    or new.pinned_by is distinct from old.pinned_by then
    new.edited_at := greatest(clock_timestamp(), old.edited_at + interval '1 microsecond', old.created_at + interval '1 microsecond');
  else new.edited_at := old.edited_at;
  end if;
  if old.deleted_at is not null then new.deleted_at := old.deleted_at; end if;
  return new;
end;
$$;
create or replace function n2click.chat_set_pin(p_message_id uuid, p_pinned boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_conv uuid;
begin
  select conversation_id into v_conv from n2click.messages where id = p_message_id and deleted_at is null for update;
  if auth.uid() is null or not app.is_conversation_member(v_conv) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update n2click.messages set pinned_at = case when p_pinned then clock_timestamp() end,
    pinned_by = case when p_pinned then auth.uid() end where id = p_message_id;
end;
$$;
revoke all on function n2click.chat_set_pin(uuid, boolean) from public, anon;
grant execute on function n2click.chat_set_pin(uuid, boolean) to authenticated;
create or replace function n2click.chat_set_follow(p_conversation_id uuid, p_follow boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not app.is_conversation_member(p_conversation_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update n2click.conversation_members set muted_until = case when p_follow then null else 'infinity'::timestamptz end
    where conversation_id = p_conversation_id and user_id = auth.uid();
end;
$$;
revoke all on function n2click.chat_set_follow(uuid, boolean) from public, anon;
grant execute on function n2click.chat_set_follow(uuid, boolean) to authenticated;

create or replace function n2click.chat_broadcast_read()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(jsonb_build_object('conversationId', new.conversation_id,
    'userId', new.user_id, 'lastReadAt', new.last_read_at), 'read', 'chat:conv:' || new.conversation_id::text, true);
  return null;
end;
$$;
revoke all on function n2click.chat_broadcast_read() from public, anon, authenticated;
create trigger chat_members_read after update of last_read_at on n2click.conversation_members
for each row when (old.last_read_at is distinct from new.last_read_at) execute function n2click.chat_broadcast_read();

-- Member additions precede message broadcasts; preserve explicit unfollow choices.
create or replace function n2click.chat_message_auto_members()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into n2click.conversation_members(conversation_id, user_id)
  select new.conversation_id, p.id from core.profiles p
  where (p.id = new.author_id or (p.id = any(new.mention_ids)
    and exists (select 1 from core.app_access a where a.user_id = p.id and a.app = 'n2click')))
    -- A DM must never acquire a third member through a mention.
    and exists (select 1 from n2click.conversations c where c.id = new.conversation_id
      and (c.kind <> 'direct' or p.id::text in (split_part(c.direct_key, ':', 1), split_part(c.direct_key, ':', 2))))
  order by p.id on conflict do nothing;
  return null;
end;
$$;
revoke all on function n2click.chat_message_auto_members() from public, anon, authenticated;
create trigger chat_messages_auto_members after insert on n2click.messages
for each row execute function n2click.chat_message_auto_members();
revoke all on function n2click.chat_validate_message_content() from public, anon, authenticated;
commit;
