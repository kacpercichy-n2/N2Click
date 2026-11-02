-- Runs BEFORE the task notification trigger exists. Never deletes comments.
begin;
lock table n2click.messages, n2click.conversations, n2click.conversation_members in share row exclusive mode;
-- Preserve original author/body exactly; stop for operator review rather than
-- inventing attribution or truncating a legacy comment outside the new limit.
do $$
begin
  if exists (select 1 from n2click.comments where task_id is not null
    and (author_id is null or char_length(body) > 4000)) then
    raise exception 'Task comment backfill requires non-null authors and bodies <= 4000 characters';
  end if;
end;
$$;
alter table n2click.messages disable trigger chat_messages_stamp_insert;
alter table n2click.messages disable trigger chat_messages_broadcast;
alter table n2click.messages disable trigger chat_messages_bump_conversation;
alter table n2click.conversations disable trigger chat_conversations_stamp_insert;
alter table n2click.conversation_members disable trigger chat_members_broadcast;

insert into n2click.conversations(kind, context_type, context_id, created_by, created_at, last_message_at)
select 'group', 'task', c.task_id, c.author_id, c.created_at,
  (select max(c2.created_at) from n2click.comments c2 where c2.task_id = c.task_id)
from (select distinct on (task_id) * from n2click.comments where task_id is not null
  order by task_id, created_at, id) c
on conflict (context_type, context_id) where context_type is not null and context_id is not null do nothing;
insert into n2click.conversation_members(conversation_id, user_id)
select c.id, a.profile_id from n2click.conversations c
join n2click.task_assignments a on a.task_id = c.context_id
where c.context_type = 'task' order by c.id, a.profile_id on conflict do nothing;
-- Source UUID is the stable deduplication key; comments and messages are separate tables.
insert into n2click.messages(id, conversation_id, author_id, body, mention_ids, created_at)
select s.id, c.id, s.author_id, s.body, s.mention_ids, s.created_at
from n2click.comments s join n2click.conversations c on c.context_type = 'task' and c.context_id = s.task_id
where s.task_id is not null order by s.created_at, s.id on conflict (id) do nothing;
-- Auto-membership adds authors + mentions (without changing their mute preference).
alter table n2click.messages enable trigger chat_messages_stamp_insert;
alter table n2click.messages enable trigger chat_messages_broadcast;
alter table n2click.messages enable trigger chat_messages_bump_conversation;
alter table n2click.conversations enable trigger chat_conversations_stamp_insert;
alter table n2click.conversation_members enable trigger chat_members_broadcast;
commit;
