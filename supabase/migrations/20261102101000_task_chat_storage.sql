-- =============================================================================
-- Migracja: 20261102101000_task_chat_storage
--
-- Prywatny bucket `chat-attachments` na obrazy w rozmowach (dok czatu i karta
-- zadania). Wzorzec: bucket `avatars` z 20260715210500_rls_policies.sql.
--
-- Ścieżka obiektu: `<conversation_id>/<uuid>.<ext>` (src/chat/attachments/files.ts
-- attachmentObjectPath). Uprawnienia wynikają WYŁĄCZNIE z pierwszego segmentu:
--   * SELECT (podgląd, podpisany URL) i INSERT: członek tej rozmowy
--     (app.is_conversation_member, czyli dla rozmowy zadania także bieżący
--     wgląd w zadanie),
--   * INSERT dodatkowo: owner_id = wgrywający, nazwa w ścisłym formacie,
--   * DELETE: tylko wgrywający (owner_id),
--   * UPDATE: brak polityki (nadpisanie/upsert niemożliwe, każdy plik ma
--     świeży uuid).
-- Limit 10 MB i allowlista MIME egzekwuje sam Storage (kolumny bucketu).
-- SVG jest poza listą celowo (skrypt w obrazie).
-- =============================================================================

-- Jak przy awatarach: polityki niżej porównują `owner_id` jako text. Jeśli
-- hostowany schemat Storage się różni, migracja staje z jasnym błędem.
do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'storage'
      and table_name = 'objects'
      and column_name = 'owner_id'
      and data_type = 'text'
  ) then
    raise exception 'storage.objects.owner_id musi być typu text';
  end if;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-attachments',
  'chat-attachments',
  false,
  10485760,
  array['image/webp', 'image/png', 'image/jpeg', 'image/gif']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Nazwa obiektu -> czy zalogowany jest członkiem rozmowy z pierwszego
-- segmentu. Format sprawdzany regexem PRZED rzutowaniem na uuid, a każdy
-- nierozpoznany kształt kończy się `false` (nigdy wyjątkiem w polityce).
create or replace function app.chat_attachment_member(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_conversation uuid;
begin
  if p_name is null
     or p_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|png|jpg|jpeg|gif)$' then
    return false;
  end if;
  begin
    v_conversation := split_part(p_name, '/', 1)::uuid;
  exception
    when others then
      return false;
  end;
  return app.is_conversation_member(v_conversation);
end;
$$;

comment on function app.chat_attachment_member(text) is
  'Polityka bucketu chat-attachments: nazwa <conversation_id>/<uuid>.<ext> i członkostwo w tej rozmowie (dla zadania także wgląd w zadanie).';

revoke all on function app.chat_attachment_member(text) from public, anon;
grant execute on function app.chat_attachment_member(text) to authenticated, service_role;

drop policy if exists "chat_attachments_select" on storage.objects;
create policy "chat_attachments_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-attachments'
    and app.chat_attachment_member(name)
  );

drop policy if exists "chat_attachments_insert" on storage.objects;
create policy "chat_attachments_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-attachments'
    and owner_id = (select auth.uid())::text
    and app.chat_attachment_member(name)
  );

drop policy if exists "chat_attachments_delete" on storage.objects;
create policy "chat_attachments_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'chat-attachments'
    and owner_id = (select auth.uid())::text
  );

-- ŚWIADOMIE bez polityki UPDATE: obiektu nie da się nadpisać ani przenieść.
