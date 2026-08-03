-- =============================================================================
-- Migracja: 20260803160100_contentplan_rls_policies
--
-- Polityki RLS modułu Content Plan. Bramka jest TAKA SAMA jak w n2click
-- (20260731082207_rls_gating_has_app): dostęp daje wyłącznie wiersz
-- w `core.app_access` z `app='contentplan'`, czytany z claimów JWT przez
-- `core.has_app()` / `core.app_role()` / `core.company_for()` — zero odczytów
-- z `core` w czasie sprawdzania polityki.
--
-- Dwie ścieżki dostępu:
--  1. ZESPÓŁ (`admin` / `editor`) — pełny dostęp do wszystkich marek i postów.
--     Rozróżnienie admin/editor jest dziś nieużywane (seed nadaje `admin`),
--     ale rola `editor` jest w predykacie od początku, żeby zawężenie było
--     zmianą wierszy `app_access`, nie migracją.
--  2. KLIENT (`client`) — przyszły portal akceptów (plan §2 pkt 8): TYLKO
--     `select`, TYLKO wiersze `visibility = 'published'` i tylko w obrębie
--     przypisanej marki. Ścieżka jest dziś MARTWA (nikt nie ma roli `client`),
--     ma istnieć poprawnie w SQL, zanim powstanie UI portalu.
--
--     ZAŁOŻENIE DO ZWERYFIKOWANIA PRZY PORTALU: plan nie precyzuje, jak klient
--     zewnętrzny wiąże się z marką, więc przypisanie idzie po istniejących
--     helperach claimów — `core.company_for('contentplan')` (kolumna
--     `company_id` wiersza `app_access` tego użytkownika) porównane
--     z `contentplan.brands.n2click_client_id`. Innymi słowy: dla roli `client`
--     `app_access.company_id` niesie identyfikator KLIENTA N2Click marki, nie
--     spółki wykonawczej. Gdy portal dostanie własny model przypisania (np.
--     tabela `brand_clients`), zmienia się WYŁĄCZNIE ten predykat.
--
-- Konwencja domu: polityki wyłącznie `to authenticated` (nigdy anon/public),
-- insert/update zawsze z `with check`, komentarze i historia są DOPISYWALNE
-- (select + insert, bez update/delete — parytet z n2click.comments). Wszystko
-- idempotentnie (`drop policy if exists`).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Marki
-- -----------------------------------------------------------------------------

drop policy if exists "cp_brands_select" on contentplan.brands;
create policy "cp_brands_select" on contentplan.brands
  for select to authenticated
  using (
    (select core.has_app('contentplan'))
    and (select core.app_role('contentplan')) in ('admin', 'editor')
  );

-- Klient widzi wyłącznie swoją markę (bez niej nie da się wyrenderować
-- nazwy/akcentu przy opublikowanych postach).
drop policy if exists "cp_brands_select_client" on contentplan.brands;
create policy "cp_brands_select_client" on contentplan.brands
  for select to authenticated
  using (
    (select core.app_role('contentplan')) = 'client'
    and n2click_client_id is not null
    and n2click_client_id = (select core.company_for('contentplan'))
  );

drop policy if exists "cp_brands_insert" on contentplan.brands;
create policy "cp_brands_insert" on contentplan.brands
  for insert to authenticated
  with check (
    (select core.has_app('contentplan'))
    and (select core.app_role('contentplan')) in ('admin', 'editor')
  );

drop policy if exists "cp_brands_update" on contentplan.brands;
create policy "cp_brands_update" on contentplan.brands
  for update to authenticated
  using (
    (select core.has_app('contentplan'))
    and (select core.app_role('contentplan')) in ('admin', 'editor')
  )
  with check (
    (select core.has_app('contentplan'))
    and (select core.app_role('contentplan')) in ('admin', 'editor')
  );

drop policy if exists "cp_brands_delete" on contentplan.brands;
create policy "cp_brands_delete" on contentplan.brands
  for delete to authenticated
  using (
    (select core.has_app('contentplan'))
    and (select core.app_role('contentplan')) in ('admin', 'editor')
  );

-- -----------------------------------------------------------------------------
-- Posty
-- -----------------------------------------------------------------------------

drop policy if exists "cp_posts_select" on contentplan.posts;
create policy "cp_posts_select" on contentplan.posts
  for select to authenticated
  using (
    (select core.has_app('contentplan'))
    and (select core.app_role('contentplan')) in ('admin', 'editor')
  );

drop policy if exists "cp_posts_select_client" on contentplan.posts;
create policy "cp_posts_select_client" on contentplan.posts
  for select to authenticated
  using (
    (select core.app_role('contentplan')) = 'client'
    and visibility = 'published'
    and exists (
      select 1
      from contentplan.brands b
      where b.id = posts.brand_id
        and b.n2click_client_id is not null
        and b.n2click_client_id = (select core.company_for('contentplan'))
    )
  );

drop policy if exists "cp_posts_insert" on contentplan.posts;
create policy "cp_posts_insert" on contentplan.posts
  for insert to authenticated
  with check (
    (select core.has_app('contentplan'))
    and (select core.app_role('contentplan')) in ('admin', 'editor')
  );

drop policy if exists "cp_posts_update" on contentplan.posts;
create policy "cp_posts_update" on contentplan.posts
  for update to authenticated
  using (
    (select core.has_app('contentplan'))
    and (select core.app_role('contentplan')) in ('admin', 'editor')
  )
  with check (
    (select core.has_app('contentplan'))
    and (select core.app_role('contentplan')) in ('admin', 'editor')
  );

drop policy if exists "cp_posts_delete" on contentplan.posts;
create policy "cp_posts_delete" on contentplan.posts
  for delete to authenticated
  using (
    (select core.has_app('contentplan'))
    and (select core.app_role('contentplan')) in ('admin', 'editor')
  );

-- -----------------------------------------------------------------------------
-- Kanały posta
-- -----------------------------------------------------------------------------

drop policy if exists "cp_post_channels_select" on contentplan.post_channels;
create policy "cp_post_channels_select" on contentplan.post_channels
  for select to authenticated
  using (
    (select core.has_app('contentplan'))
    and (select core.app_role('contentplan')) in ('admin', 'editor')
  );

drop policy if exists "cp_post_channels_select_client" on contentplan.post_channels;
create policy "cp_post_channels_select_client" on contentplan.post_channels
  for select to authenticated
  using (
    (select core.app_role('contentplan')) = 'client'
    and exists (
      select 1
      from contentplan.posts p
      join contentplan.brands b on b.id = p.brand_id
      where p.id = post_channels.post_id
        and p.visibility = 'published'
        and b.n2click_client_id is not null
        and b.n2click_client_id = (select core.company_for('contentplan'))
    )
  );

drop policy if exists "cp_post_channels_insert" on contentplan.post_channels;
create policy "cp_post_channels_insert" on contentplan.post_channels
  for insert to authenticated
  with check (
    (select core.has_app('contentplan'))
    and (select core.app_role('contentplan')) in ('admin', 'editor')
  );

drop policy if exists "cp_post_channels_update" on contentplan.post_channels;
create policy "cp_post_channels_update" on contentplan.post_channels
  for update to authenticated
  using (
    (select core.has_app('contentplan'))
    and (select core.app_role('contentplan')) in ('admin', 'editor')
  )
  with check (
    (select core.has_app('contentplan'))
    and (select core.app_role('contentplan')) in ('admin', 'editor')
  );

drop policy if exists "cp_post_channels_delete" on contentplan.post_channels;
create policy "cp_post_channels_delete" on contentplan.post_channels
  for delete to authenticated
  using (
    (select core.has_app('contentplan'))
    and (select core.app_role('contentplan')) in ('admin', 'editor')
  );

-- -----------------------------------------------------------------------------
-- Komentarze (append-only: bez update/delete)
-- -----------------------------------------------------------------------------

drop policy if exists "cp_comments_select" on contentplan.comments;
create policy "cp_comments_select" on contentplan.comments
  for select to authenticated
  using (
    (select core.has_app('contentplan'))
    and (select core.app_role('contentplan')) in ('admin', 'editor')
  );

drop policy if exists "cp_comments_select_client" on contentplan.comments;
create policy "cp_comments_select_client" on contentplan.comments
  for select to authenticated
  using (
    (select core.app_role('contentplan')) = 'client'
    and exists (
      select 1
      from contentplan.posts p
      join contentplan.brands b on b.id = p.brand_id
      where p.id = comments.post_id
        and p.visibility = 'published'
        and b.n2click_client_id is not null
        and b.n2click_client_id = (select core.company_for('contentplan'))
    )
  );

drop policy if exists "cp_comments_insert" on contentplan.comments;
create policy "cp_comments_insert" on contentplan.comments
  for insert to authenticated
  with check (
    (select core.has_app('contentplan'))
    and (select core.app_role('contentplan')) in ('admin', 'editor')
  );

-- -----------------------------------------------------------------------------
-- Historia zmian (append-only: bez update/delete)
-- -----------------------------------------------------------------------------

drop policy if exists "cp_post_history_select" on contentplan.post_history;
create policy "cp_post_history_select" on contentplan.post_history
  for select to authenticated
  using (
    (select core.has_app('contentplan'))
    and (select core.app_role('contentplan')) in ('admin', 'editor')
  );

drop policy if exists "cp_post_history_select_client" on contentplan.post_history;
create policy "cp_post_history_select_client" on contentplan.post_history
  for select to authenticated
  using (
    (select core.app_role('contentplan')) = 'client'
    and exists (
      select 1
      from contentplan.posts p
      join contentplan.brands b on b.id = p.brand_id
      where p.id = post_history.post_id
        and p.visibility = 'published'
        and b.n2click_client_id is not null
        and b.n2click_client_id = (select core.company_for('contentplan'))
    )
  );

drop policy if exists "cp_post_history_insert" on contentplan.post_history;
create policy "cp_post_history_insert" on contentplan.post_history
  for insert to authenticated
  with check (
    (select core.has_app('contentplan'))
    and (select core.app_role('contentplan')) in ('admin', 'editor')
  );

-- -----------------------------------------------------------------------------
-- Foldery Dysku Google — wyłącznie zespół (klient nie widzi struktury Dysku).
-- -----------------------------------------------------------------------------

drop policy if exists "cp_drive_folders_select" on contentplan.drive_folders;
create policy "cp_drive_folders_select" on contentplan.drive_folders
  for select to authenticated
  using (
    (select core.has_app('contentplan'))
    and (select core.app_role('contentplan')) in ('admin', 'editor')
  );

drop policy if exists "cp_drive_folders_insert" on contentplan.drive_folders;
create policy "cp_drive_folders_insert" on contentplan.drive_folders
  for insert to authenticated
  with check (
    (select core.has_app('contentplan'))
    and (select core.app_role('contentplan')) in ('admin', 'editor')
  );

drop policy if exists "cp_drive_folders_update" on contentplan.drive_folders;
create policy "cp_drive_folders_update" on contentplan.drive_folders
  for update to authenticated
  using (
    (select core.has_app('contentplan'))
    and (select core.app_role('contentplan')) in ('admin', 'editor')
  )
  with check (
    (select core.has_app('contentplan'))
    and (select core.app_role('contentplan')) in ('admin', 'editor')
  );

drop policy if exists "cp_drive_folders_delete" on contentplan.drive_folders;
create policy "cp_drive_folders_delete" on contentplan.drive_folders
  for delete to authenticated
  using (
    (select core.has_app('contentplan'))
    and (select core.app_role('contentplan')) in ('admin', 'editor')
  );
