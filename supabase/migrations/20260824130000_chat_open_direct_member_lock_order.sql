-- =============================================================================
-- Migracja: 20260824130000_chat_open_direct_member_lock_order
--
-- FIX ZAKLESZCZENIA z przeglądu 20260824120000_chat_open_direct_rpc: gdy OBIE
-- strony pary zawołają RPC równolegle, każda wstawia te same dwa wiersze
-- członków, ale w ODWROTNEJ kolejności (u siebie najpierw `v_me`). Blokady
-- unikatu `(conversation_id, user_id)` idą wtedy na krzyż: A trzyma wiersz A
-- i czeka na wiersz B, B trzyma wiersz B i czeka na wiersz A — Postgres ubija
-- jedną transakcję z 40P01 `deadlock_detected`, którego handler
-- `unique_violation` NIE łapie, więc temu wołającemu otwarcie DM-u pada
-- twardym błędem.
--
-- Dwie zmiany w ciele funkcji (reszta bez zmian):
--   1. Członkowie wstawiani ZAWSZE w porządku kanonicznym pary (mniejszy uuid
--      pierwszy — ten sam porządek, który buduje `direct_key`). Obie strony
--      biorą blokady w tej samej kolejności, więc na krzyż nie ma jak.
--   2. KAŻDY wiersz pod własnym handlerem `unique_violation`: duplikat
--      pierwszego nie przerywa bloku i nie pomija wstawienia drugiego
--      (istotne przy wyścigu ze starym klientem, który wstawiał po jednym).
--
-- `create or replace` zachowuje komentarz i granty z 20260824120000.
-- =============================================================================

create or replace function n2click.chat_open_direct(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_first uuid;
  v_second uuid;
  v_key text;
  v_id uuid;
begin
  if v_me is null then
    raise exception 'chat_open_direct: wymagane zalogowanie';
  end if;
  if not coalesce((select core.has_app('n2click')), false) then
    raise exception 'chat_open_direct: brak dostępu do N2Click';
  end if;
  if p_other_user_id is null or p_other_user_id = v_me then
    raise exception 'chat_open_direct: rozmowa 1:1 wymaga innej osoby';
  end if;
  if not exists (
    select 1 from core.app_access aa
    where aa.user_id = p_other_user_id and aa.app = 'n2click'
  ) then
    raise exception 'chat_open_direct: adresat nie ma dostępu do N2Click';
  end if;

  -- Porządek kanoniczny pary steruje i kluczem, i KOLEJNOŚCIĄ blokad niżej.
  if v_me::text < p_other_user_id::text then
    v_first := v_me;
    v_second := p_other_user_id;
  else
    v_first := p_other_user_id;
    v_second := v_me;
  end if;
  v_key := v_first::text || ':' || v_second::text;

  select c.id into v_id from n2click.conversations c where c.direct_key = v_key;
  if v_id is null then
    begin
      insert into n2click.conversations (kind, direct_key, created_by)
      values ('direct', v_key, v_me)
      returning id into v_id;
    exception when unique_violation then
      -- Wyścig dwóch kart / dwóch stron: rozmowa powstała w międzyczasie.
      select c.id into v_id from n2click.conversations c where c.direct_key = v_key;
    end;
  end if;
  if v_id is null then
    raise exception 'chat_open_direct: nie udało się ustalić rozmowy pary';
  end if;

  -- Uzupełnienie brakujących wierszy członków OBU stron: zawsze w porządku
  -- kanonicznym (jedna kolejność blokad = brak zakleszczenia), każdy wiersz
  -- pod własnym handlerem (duplikat jednego nie pomija drugiego).
  begin
    insert into n2click.conversation_members (conversation_id, user_id, role)
    select v_id, v_first, 'member'
    where not exists (
      select 1 from n2click.conversation_members m
      where m.conversation_id = v_id and m.user_id = v_first
    );
  exception when unique_violation then
    null;
  end;
  begin
    insert into n2click.conversation_members (conversation_id, user_id, role)
    select v_id, v_second, 'member'
    where not exists (
      select 1 from n2click.conversation_members m
      where m.conversation_id = v_id and m.user_id = v_second
    );
  exception when unique_violation then
    null;
  end;

  return v_id;
end;
$$;
