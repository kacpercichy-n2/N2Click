begin;
-- notifications.type is text with a length CHECK, not an enum. No DDL extension needed.
create or replace function n2click.chat_notify_task_message()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_task uuid;
begin
  select context_id into v_task from n2click.conversations
    where id = new.conversation_id and context_type = 'task';
  if v_task is null or new.kind <> 'text' then return null; end if;
  insert into n2click.notifications(recipient_id, type, payload)
  select m.user_id,
    case when m.user_id = any(new.mention_ids) then 'task_mention' else 'task_message' end,
    jsonb_build_object('taskId', v_task, 'conversationId', new.conversation_id,
      'messageId', new.id, 'actorId', new.author_id)
  from n2click.conversation_members m
  where m.conversation_id = new.conversation_id and m.user_id <> new.author_id
    and (m.user_id = any(new.mention_ids) or m.muted_until is null or m.muted_until < now());
  return null;
end;
$$;
revoke all on function n2click.chat_notify_task_message() from public, anon, authenticated;
-- AFTER triggers run alphabetically: auto_members precedes notify_task.
create trigger chat_messages_notify_task after insert on n2click.messages
for each row execute function n2click.chat_notify_task_message();
revoke all on n2click.messages, n2click.conversations, n2click.conversation_members, n2click.notifications from anon;
commit;
