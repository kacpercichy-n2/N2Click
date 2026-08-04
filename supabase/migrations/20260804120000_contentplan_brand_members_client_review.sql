-- =============================================================================
-- Migracja: 20260804120000_contentplan_brand_members_client_review
--
-- Portal klienta (decyzja operatora 2026-08-04): jeden link, wiele marek na
-- profilu. Dotychczasowy (uśpiony) predykat roli `client` wiązał użytkownika
-- z markami JEDNYM polem `app_access.company_id` — wystarczał dla „wszystkie
-- marki jednego klienta", nie dla dowolnego przypinania. Zgodnie z zapowiedzią
-- z 20260803160100 zmienia się WYŁĄCZNIE predykat: przypisania przejmuje
-- tabela-łącznik `contentplan.brand_members`.
--
-- Trzy elementy:
--  1. `brand_members(user_id, brand_id)` — jeden wiersz = jedna przypięta
--     marka; klient czyta wyłącznie własne wiersze, zarządza zespół.
--  2. Polityki `*_select_client` przepisane z `core.company_for()` na
--     członkostwo w `brand_members` (reszta polityk bez zmian).
--  3. RPC `contentplan.client_review(post, decyzja, komentarz)` — JEDYNA
--     ścieżka zapisu klienta (SECURITY DEFINER): wąska furtka zamiast
--     szerokich grantów UPDATE. Waliduje rolę, członkostwo, `published`
--     i przejście statusu wyłącznie `Do akceptacji -> Akceptacja/Uwagi`.
--
-- Konwencja domu: pełna kwalifikacja nazw, RLS w pliku tworzącym tabelę,
-- polityki tylko `to authenticated`, funkcje z `search_path ''`, idempotentnie.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Przypięcia marek do kont klienckich
-- -----------------------------------------------------------------------------

create table if not exists contentplan.brand_members (
  user_id uuid not null references auth.users (id) on delete cascade,
  brand_id uuid not null references contentplan.brands (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, brand_id)
);

alter table contentplan.brand_members enable row level security;

revoke all on contentplan.brand_members from anon;
grant select, insert, delete on contentplan.brand_members to authenticated;
grant select, insert, update, delete on contentplan.brand_members to service_role;

-- Klient widzi wyłącznie własne przypięcia (portal buduje z nich listę marek);
-- zespół widzi wszystkie i nimi zarządza.
drop policy if exists "cp_brand_members_select" on contentplan.brand_members;
create policy "cp_brand_members_select" on contentplan.brand_members
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (
      (select core.has_app('contentplan'))
      and (select core.app_role('contentplan')) in ('admin', 'editor')
    )
  );

drop policy if exists "cp_brand_members_insert" on contentplan.brand_members;
create policy "cp_brand_members_insert" on contentplan.brand_members
  for insert to authenticated
  with check (
    (select core.has_app('contentplan'))
    and (select core.app_role('contentplan')) in ('admin', 'editor')
  );

drop policy if exists "cp_brand_members_delete" on contentplan.brand_members;
create policy "cp_brand_members_delete" on contentplan.brand_members
  for delete to authenticated
  using (
    (select core.has_app('contentplan'))
    and (select core.app_role('contentplan')) in ('admin', 'editor')
  );

-- -----------------------------------------------------------------------------
-- 2. Predykat klienta: z company_for() na brand_members
-- -----------------------------------------------------------------------------

drop policy if exists "cp_brands_select_client" on contentplan.brands;
create policy "cp_brands_select_client" on contentplan.brands
  for select to authenticated
  using (
    (select core.app_role('contentplan')) = 'client'
    and exists (
      select 1
      from contentplan.brand_members m
      where m.brand_id = brands.id
        and m.user_id = (select auth.uid())
    )
  );

drop policy if exists "cp_posts_select_client" on contentplan.posts;
create policy "cp_posts_select_client" on contentplan.posts
  for select to authenticated
  using (
    (select core.app_role('contentplan')) = 'client'
    and visibility = 'published'
    and exists (
      select 1
      from contentplan.brand_members m
      where m.brand_id = posts.brand_id
        and m.user_id = (select auth.uid())
    )
  );

drop policy if exists "cp_post_channels_select_client" on contentplan.post_channels;
create policy "cp_post_channels_select_client" on contentplan.post_channels
  for select to authenticated
  using (
    (select core.app_role('contentplan')) = 'client'
    and exists (
      select 1
      from contentplan.posts p
      join contentplan.brand_members m
        on m.brand_id = p.brand_id and m.user_id = (select auth.uid())
      where p.id = post_channels.post_id
        and p.visibility = 'published'
    )
  );

drop policy if exists "cp_comments_select_client" on contentplan.comments;
create policy "cp_comments_select_client" on contentplan.comments
  for select to authenticated
  using (
    (select core.app_role('contentplan')) = 'client'
    and exists (
      select 1
      from contentplan.posts p
      join contentplan.brand_members m
        on m.brand_id = p.brand_id and m.user_id = (select auth.uid())
      where p.id = comments.post_id
        and p.visibility = 'published'
    )
  );

drop policy if exists "cp_post_history_select_client" on contentplan.post_history;
create policy "cp_post_history_select_client" on contentplan.post_history
  for select to authenticated
  using (
    (select core.app_role('contentplan')) = 'client'
    and exists (
      select 1
      from contentplan.posts p
      join contentplan.brand_members m
        on m.brand_id = p.brand_id and m.user_id = (select auth.uid())
      where p.id = post_history.post_id
        and p.visibility = 'published'
    )
  );

-- -----------------------------------------------------------------------------
-- 3. Jedyna ścieżka zapisu klienta: decyzja o publikacji
-- -----------------------------------------------------------------------------

create or replace function contentplan.client_review(
  p_post_id uuid,
  p_decision text,
  p_comment text default null
) returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_author text;
begin
  if v_user is null then
    raise exception 'Brak zalogowanej sesji.';
  end if;
  if (select core.app_role('contentplan')) is distinct from 'client' then
    raise exception 'Decyzje o publikacjach zapisuje wyłącznie konto klienta.';
  end if;
  if p_decision not in ('Akceptacja', 'Uwagi') then
    raise exception 'Niepoprawna decyzja: %', p_decision;
  end if;
  if p_decision = 'Uwagi' and (p_comment is null or btrim(p_comment) = '') then
    raise exception 'Zgłoszenie uwag wymaga treści komentarza.';
  end if;

  perform 1
  from contentplan.posts p
  join contentplan.brand_members m
    on m.brand_id = p.brand_id and m.user_id = v_user
  where p.id = p_post_id
    and p.visibility = 'published'
    and p.status = 'Do akceptacji'
  for update of p;
  if not found then
    raise exception 'Ta publikacja nie czeka na Twoją decyzję.';
  end if;

  select coalesce(
      nullif(btrim(pr.first_name || ' ' || pr.last_name), ''),
      u.email,
      'Klient'
    )
  into v_author
  from auth.users u
  left join core.profiles pr on pr.id = u.id
  where u.id = v_user;

  update contentplan.posts set status = p_decision where id = p_post_id;

  if p_comment is not null and btrim(p_comment) <> '' then
    insert into contentplan.comments (post_id, author, body)
    values (p_post_id, v_author, btrim(p_comment));
  end if;

  insert into contentplan.post_history (post_id, label)
  values (
    p_post_id,
    v_author || ': ' || case
      when p_decision = 'Akceptacja' then 'zaakceptowano publikację'
      else 'zgłoszono uwagi'
    end
  );
end;
$$;

revoke all on function contentplan.client_review(uuid, text, text) from public, anon;
grant execute on function contentplan.client_review(uuid, text, text) to authenticated;
