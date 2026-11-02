begin;
-- Fail explicitly if Storage changes its ownership representation.
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'storage'
    and table_name = 'objects' and column_name = 'owner_id' and data_type = 'text') then
    raise exception 'storage.objects.owner_id must be text';
  end if;
end;
$$;
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('chat-attachments', 'chat-attachments', false, 10485760,
  array['image/webp','image/png','image/jpeg','image/gif'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function app.chat_attachment_member(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_conv uuid;
begin
  if p_name !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|png|jpe?g|gif)$' then return false; end if;
  begin
    v_conv := split_part(p_name, '/', 1)::uuid;
    perform split_part(split_part(p_name, '/', 2), '.', 1)::uuid;
  exception when invalid_text_representation then return false;
  end;
  return app.is_conversation_member(v_conv);
end;
$$;
revoke all on function app.chat_attachment_member(text) from public, anon;
grant execute on function app.chat_attachment_member(text) to authenticated;
create policy "chat_attachments_select" on storage.objects for select to authenticated
using (bucket_id = 'chat-attachments' and app.chat_attachment_member(name));
create policy "chat_attachments_insert" on storage.objects for insert to authenticated
with check (bucket_id = 'chat-attachments' and app.chat_attachment_member(name)
  and owner_id = (select auth.uid())::text);
create policy "chat_attachments_delete" on storage.objects for delete to authenticated
using (bucket_id = 'chat-attachments' and owner_id = (select auth.uid())::text);
-- No UPDATE policy: uploads use fresh UUIDs, never upsert.
commit;
