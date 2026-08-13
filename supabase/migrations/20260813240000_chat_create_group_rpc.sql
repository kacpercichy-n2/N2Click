-- =============================================================================
-- Migracja: 20260813240000_chat_create_group_rpc
--
-- ATOMOWE tworzenie grupy. Klient składał grupę z 2-3 osobnych żądań
-- (rozmowa -> twórca -> reszta członków) bez transakcji; padnięcie w połowie
-- zostawia grupę z niepełnym składem BEZ ścieżki naprawy — w odróżnieniu od
-- DM-a grupa nie ma `direct_key`, więc ponowienie nie odnajdzie kaleki, tylko
-- utworzy drugą rozmowę (przegląd 2026-08-13). Funkcja = jedna transakcja:
-- albo powstaje komplet (rozmowa + owner + członkowie), albo nic.
--
-- SECURITY INVOKER świadomie: całą autoryzację robią istniejące polityki RLS
-- (`chat_conversations_insert`: created_by = auth.uid();
-- `chat_conversation_members_insert`: wiersze dokłada twórca rozmowy — definer
-- `app.chat_conversation_creator` widzi wiersz z własnej transakcji), funkcja
-- nie powtarza ani jednego predykatu. `returning id` przechodzi przez gałąź
-- `created_by` polityki SELECT (ta sama, która obsługuje `.insert().select()`).
--
-- BEZ ON CONFLICT — celowo: potwierdzone dziś na tej bazie, że pod RLS
-- `ON CONFLICT DO UPDATE` = 42501 (granty kolumnowe), a `DO NOTHING` wywraca
-- się na politykach w ścieżce wstawiania spekulatywnego. Deduplikację robi
-- `select distinct` po stronie zapytania.
--
-- Argumenty z prefiksem `p_`, bo gołe `title` kolidowałoby w plpgsql
-- z kolumną `conversations.title`.
-- =============================================================================

create or replace function n2click.chat_create_group(p_title text, p_member_ids uuid[])
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_title text := btrim(coalesce(p_title, ''));
begin
  if v_title = '' then
    raise exception 'chat_create_group: pusty tytuł grupy';
  end if;

  insert into n2click.conversations (kind, title, created_by)
  values ('group', v_title, (select auth.uid()))
  returning id into v_id;

  -- Twórca zawsze wchodzi jako owner; lista członków jest deduplikowana
  -- i oczyszczona z NULL-i oraz samego twórcy (już siedzi w składzie).
  insert into n2click.conversation_members (conversation_id, user_id, role)
  values (v_id, (select auth.uid()), 'owner');

  insert into n2click.conversation_members (conversation_id, user_id, role)
  select v_id, m.member_id, 'member'
  from (select distinct unnest(coalesce(p_member_ids, '{}'::uuid[])) as member_id) m
  where m.member_id is not null
    and m.member_id is distinct from (select auth.uid());

  return v_id;
end;
$$;

comment on function n2click.chat_create_group(text, uuid[]) is
  'Atomowe utworzenie grupy czatu: rozmowa + owner + członkowie w jednej transakcji. SECURITY INVOKER — autoryzacja w RLS.';

-- Domyślne uprawnienia schematu nadają EXECUTE także `anon` — odbieramy jawnie.
revoke all on function n2click.chat_create_group(text, uuid[]) from public, anon;
grant execute on function n2click.chat_create_group(text, uuid[]) to authenticated, service_role;
