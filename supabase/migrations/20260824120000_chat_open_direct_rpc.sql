-- =============================================================================
-- Migracja: 20260824120000_chat_open_direct_rpc
--
-- ATOMOWE otwarcie DM-u. Klient składał DM z 3 osobnych żądań (select po
-- `direct_key` -> insert rozmowy -> dwa inserty członków) i ta ścieżka ma
-- MARTWY PUNKT, potwierdzony na produkcji (zgłoszenie Jarka, 2026-08-24):
-- rozmowa 09b00b9e (para Jarek-Kacper, założona 2026-08-13 w dniu startu
-- czatu) została w bazie BEZ ANI JEDNEGO członka, bo inserty członków padły
-- na ówczesnej pułapce grantów. Skutek dla drugiej strony pary:
--   1. select po `direct_key` nic nie widzi (RLS SELECT = członek lub twórca,
--      a Jarek nie jest żadnym z nich),
--   2. insert rozmowy pada na unikalności `direct_key` (rozmowa istnieje),
--   3. ponowny select dalej nic nie widzi -> twardy błąd przy KAŻDEJ próbie.
-- Naprawić mógł wyłącznie twórca (gałąź best-effort w `openDirect`), czyli
-- rozmowa była zakleszczona do czasu jego kliknięcia.
--
-- Funkcja = jedna transakcja serwera: znajdź-albo-załóż rozmowę pary
-- + uzupełnij brakujące wiersze członków (obu stron). Wielokrotne wywołanie
-- jest idempotentne, a osierocony DM leczy się przy pierwszym otwarciu
-- z DOWOLNEJ strony pary.
--
-- SECURITY DEFINER świadomie, w odróżnieniu od `chat_create_group` (invoker):
--   * funkcja musi ZOBACZYĆ rozmowę pary także wtedy, gdy wołający nie jest
--     jeszcze jej członkiem ani twórcą (dokładnie ten martwy punkt wyżej),
--   * naprawa składu wstawia wiersz DRUGIEJ strony, na co polityka INSERT
--     członkostwa (tylko twórca rozmowy) nie pozwoliłaby wołającemu.
-- Całą autoryzację robi w zamian sama funkcja: wymagane zalogowanie i dostęp
-- do N2Click, adresat musi mieć dostęp do N2Click (`core.app_access` — to samo
-- źródło, które filtruje listę osób w `n2click.profiles`), rozmowa z samym
-- sobą odpada, a wołający jest z definicji stroną pary (klucz liczymy z jego
-- auth.uid()). Nie ma wyroczni istnienia: wynik jest identyczny niezależnie
-- od tego, czy rozmowa pary istniała (zawsze wraca jej id).
-- Triggery walidacyjne (`chat_conversations_validate_insert`,
-- `chat_members_validate_insert`) dalej działają — definer ich nie omija.
--
-- Porządek pary jak w triggerze i w kliencie (`directKeyFor` sortuje po
-- kodach UTF-16): uuid::text to małe hex + myślniki na stałych pozycjach,
-- więc porównanie tekstowe daje ten sam porządek w obu miejscach.
--
-- BEZ ON CONFLICT — konwencja domu (patrz 20260813240000): wyścigi łapiemy
-- handlerem `unique_violation`, nie ścieżką wstawiania spekulatywnego.
-- =============================================================================

create or replace function n2click.chat_open_direct(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
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

  if v_me::text < p_other_user_id::text then
    v_key := v_me::text || ':' || p_other_user_id::text;
  else
    v_key := p_other_user_id::text || ':' || v_me::text;
  end if;

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

  -- Uzupełnienie brakujących wierszy członków OBU stron (naprawa osieroconego
  -- DM-u i zwykłe pierwsze otwarcie to ta sama ścieżka). Wyścig o ten sam
  -- wiersz kończy się `unique_violation` — stan docelowy już jest, ignorujemy.
  begin
    insert into n2click.conversation_members (conversation_id, user_id, role)
    select v_id, u.uid, 'member'
    from (values (v_me), (p_other_user_id)) as u(uid)
    where not exists (
      select 1 from n2click.conversation_members m
      where m.conversation_id = v_id and m.user_id = u.uid
    );
  exception when unique_violation then
    null;
  end;

  return v_id;
end;
$$;

comment on function n2click.chat_open_direct(uuid) is
  'Atomowe znajdź-albo-załóż DM-u pary (wołający, adresat) + uzupełnienie brakujących członków obu stron. SECURITY DEFINER — autoryzacja w ciele funkcji, triggery walidacyjne dalej obowiązują.';

-- Domyślne uprawnienia schematu nadają EXECUTE także `anon` — odbieramy jawnie.
revoke all on function n2click.chat_open_direct(uuid) from public, anon;
grant execute on function n2click.chat_open_direct(uuid) to authenticated, service_role;
