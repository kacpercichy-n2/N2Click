-- =============================================================================
-- Migracja: 20260813250000_chat_direct_key_integrity
--
-- PRYWATNOŚĆ ROZMÓW 1:1. Polityka `chat_conversations_insert` sprawdzała
-- wyłącznie `created_by = auth.uid()` i NIC nie wiedziała o `direct_key`, więc
-- dowolny zalogowany mógł wstawić rozmowę z kluczem CUDZEJ pary („<uuid B>:
-- <uuid C>"). Dwa skutki, oba złe (przegląd 2026-08-13):
--   1. WYROCZNIA ISTNIENIA: kolizja klucza (23505) zdradzała, że B i C mają
--      już rozmowę prywatną. Teraz taka próba pada na walidacji, zanim dojdzie
--      do sprawdzenia unikalności, więc odpowiedź jest identyczna niezależnie
--      od tego, czy cudzy DM istnieje.
--   2. ZAWŁASZCZENIE KLUCZA: gdy rozmowy B-C jeszcze nie było, atakujący
--      tworzył ją pierwszy (jako `created_by`), dokładał siebie jako członka
--      (polityka członkostwa ufa TWÓRCY), a `openDirect` B i C odnajdywał
--      po `direct_key` WŁAŚNIE TĘ rozmowę — obaj pisali w wątku, który
--      atakujący czyta. To była realna dziura w poufności, nie teoria.
--
-- Po tej migracji dla `kind = 'direct'` obowiązuje:
--   * `direct_key` jest OBOWIĄZKOWY i ma postać kanoniczną „<mniejszy>:<większy>"
--     (dwa poprawne uuid, posortowane leksykalnie, różne),
--   * zakładający MUSI być jedną z dwóch stron pary,
--   * członkiem rozmowy może zostać WYŁĄCZNIE osoba z pary (koniec dokładania
--     trzeciego uczestnika do rozmowy prywatnej).
-- Dla `kind = 'group'` `direct_key` musi być NULL (klucz pary nie ma tam sensu
-- i blokowałby drugą grupę o „tym samym" kluczu).
--
-- Gałąź `auth.uid() is null` przepuszcza ścieżki serwisowe (operator, migracje,
-- Edge Functions) — ten sam wzorzec co `app.protect_profile_privileges`.
-- Walidacja członkostwa jest SECURITY DEFINER, bo musi odczytać wiersz rozmowy
-- niezależnie od tego, co widzi wstawiający.
-- =============================================================================

create or replace function n2click.chat_validate_conversation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_left text;
  v_right text;
  v_me text := (select auth.uid())::text;
begin
  if new.kind = 'group' then
    if new.direct_key is not null then
      raise exception 'chat: rozmowa grupowa nie może mieć direct_key';
    end if;
    return new;
  end if;

  if new.direct_key is null then
    raise exception 'chat: rozmowa 1:1 wymaga direct_key';
  end if;

  v_left := split_part(new.direct_key, ':', 1);
  v_right := split_part(new.direct_key, ':', 2);

  -- Format i kanoniczność: dwa RÓŻNE, poprawne uuid, posortowane leksykalnie.
  -- Bez sortowania ta sama para dałaby dwa różne klucze, więc unikalność
  -- przestałaby deduplikować rozmowy.
  if v_left = '' or v_right = ''
     or new.direct_key <> v_left || ':' || v_right
     or v_left >= v_right then
    raise exception 'chat: direct_key musi być kanoniczną parą uuid';
  end if;
  begin
    perform v_left::uuid, v_right::uuid;
  exception when others then
    raise exception 'chat: direct_key musi być kanoniczną parą uuid';
  end;

  -- Zakładający musi należeć do pary. Ścieżki serwisowe (auth.uid() is null)
  -- przechodzą, jak wszędzie w tym schemacie.
  if v_me is not null and v_me not in (v_left, v_right) then
    raise exception 'chat: nie wolno zakładać rozmowy prywatnej cudzej pary';
  end if;

  return new;
end;
$$;

drop trigger if exists chat_conversations_validate_insert on n2click.conversations;
create trigger chat_conversations_validate_insert
  before insert on n2click.conversations
  for each row execute function n2click.chat_validate_conversation();

-- Do rozmowy 1:1 wolno dopisać WYŁĄCZNIE osoby z jej `direct_key`.
create or replace function n2click.chat_validate_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_key text;
begin
  select c.kind, c.direct_key into v_kind, v_key
  from n2click.conversations c
  where c.id = new.conversation_id;

  if v_kind is distinct from 'direct' then
    return new;
  end if;

  if new.user_id::text not in (split_part(v_key, ':', 1), split_part(v_key, ':', 2)) then
    raise exception 'chat: do rozmowy prywatnej należą wyłącznie strony jej pary';
  end if;

  return new;
end;
$$;

drop trigger if exists chat_members_validate_insert on n2click.conversation_members;
create trigger chat_members_validate_insert
  before insert on n2click.conversation_members
  for each row execute function n2click.chat_validate_member();
