# R1: security and correctness review of the L1 migrations (karta v2)

Reviewer: independent R1 worker, 2026-11-02. Branch `feat/karta-zadania-v2`, HEAD `616f5c0`.
Files reviewed: `supabase/migrations/20261102100000_task_conversations.sql` (file 1),
`20261102101000_task_chat_storage.sql` (file 2), `20261102102000_task_chat_backfill.sql` (file 3),
`20261102103000_task_chat_notifications.sql` (file 4). The hosted database was not touched.

## Verdict

**Apply after fixes.**

The core boundary holds. I found no way for a user from another company, an unassigned worker or a
former assignee to read or write a task conversation, its messages, reactions, pins, read receipts or
attachments. Every authorization path funnels through `app.is_conversation_member`, which now also
requires the `tasks_select` rule, and every new SECURITY DEFINER function pins `search_path = ''`.

Fix before applying (all small, all inside the four files):

1. Finding 2: per-row RLS cost on task conversations went up about 40x (66 ms to 2.57 s for 20k messages). Fix measured at 3.8 ms.
2. Finding 3: the new unique context index lets any user squat `project` and `client` conversation identities.
3. Finding 4: one notification row per message per follower, no coalescing.
4. Finding 5: backfill can be pre-empted by a message that reuses a comment id.

Finding 1 (forged realtime events) is High but **pre-existing since 20260813180000** and lives in the
realtime policy plus the client. It does not block applying these migrations. It should block shipping
karta v2, because the new `read` event and live pins ride the same unauthenticated broadcast channel.

## Findings, ranked

### 1. HIGH (pre-existing, amplified by L1): any member can forge broadcast events on `chat:conv:<id>`, including messages "from" other people in other conversations

- Where: `supabase/migrations/20260813180000_chat.sql:419-425` (policy `chat_realtime_messages_insert`
  lets a member publish any broadcast event on the topic). Client trusts the payload:
  `src/chat/ChatProvider.tsx:486-541` (`handleBroadcast` takes `conversationId`, `author_id`, `body`,
  `pinned_at`, `attachments` from the payload, not from the channel) and `:556-560` (`handleRead`).
- Attack: member A of any conversation shared with victim V sends a client broadcast with event
  `INSERT` whose `record.conversation_id` is a *different* conversation V is in (for example V's DM
  with their manager) and `author_id` = the manager. V's client merges it into that other thread and
  shows a message the manager never wrote, until reload. Same for `UPDATE` (fake edits, fake pins),
  `read` (fake "Seen by"), `reaction`, `theme_changed`.
- Repro (local harness, accepted):
  ```sql
  select t.login(t.id('A')); set role authenticated;
  select set_config('realtime.topic', 'chat:conv:' || t.conv('T1'), false);
  insert into realtime.messages (topic, extension, event, payload, private)
  values ('chat:conv:' || t.conv('T1'), 'broadcast', 'INSERT',
    jsonb_build_object('record', jsonb_build_object('id', gen_random_uuid(),
      'conversation_id', t.conv('T3'), 'author_id', t.id('M'), 'body', 'forged',
      'kind', 'text', 'pinned_at', now())), true);              -- ACCEPTED
  insert into realtime.messages (topic, extension, event, payload, private)
  values ('chat:conv:' || t.conv('T1'), 'broadcast', 'read',
    jsonb_build_object('conversationId', t.conv('T1'), 'userId', t.id('W2'),
      'lastReadAt', now() + interval '1 year'), true);          -- ACCEPTED
  ```
  On hosted Realtime the INSERT policy is checked at channel join, after which the client can send
  any event, so the stub result matches production behaviour.
- No confidentiality leak: the attacker only reaches clients of members of their own conversation,
  and a forged attachment path still needs a storage SELECT by the victim. This is an integrity and
  phishing problem.
- Fix (L3 client, required):
  1. In `subscribeConversation`, drop any event whose payload `conversationId` or
     `record.conversation_id` differs from the channel's `conversationId`.
  2. Treat INSERT/UPDATE payloads as hints. Refetch the row by id through PostgREST (RLS-checked,
     server-stamped) and merge the fetched row, not the payload.
  3. For `read`, `reaction`, `theme_changed`, refetch the authoritative row
     (`conversation_members`, `message_reactions`, `conversations.theme_id`) before applying.
- Fix (server, optional, stronger): make clients unable to publish broadcasts at all and move typing
  to presence state:
  ```sql
  drop policy if exists "chat_realtime_messages_insert" on realtime.messages;
  create policy "chat_realtime_messages_insert" on realtime.messages
    for insert to authenticated
    with check (
      realtime.messages.extension = 'presence'
      and app.chat_topic_member(realtime.topic())
    );
  ```
  DB-originated events (`realtime.send`, `realtime.broadcast_changes` from definers) are unaffected.
  Do not rely on an `event = 'typing'` filter in the policy: I could not verify that Realtime exposes
  the event name at authorization time.

### 2. MEDIUM (availability): `is_conversation_member` is now about 40x slower per row on task conversations

- Where: file 1 lines 187-204 (join to `conversations` plus `app.chat_can_read_task`, which runs
  `has_app`, two `core.profiles` lookups, an assignments lookup and `company_ok_project`). It is called
  **per row** by `chat_messages_select` (20260813180000:317-322) and `chat_message_reactions_select`.
  `chat_overview()` (file 1 lines 749-755) counts unread messages under that RLS, and auto-added
  followers start at `last_read_at = 'epoch'`, so they count the whole history.
- Measured (Postgres 17 stub, 20,000 messages in the T1 conversation, user A):

  | Query | Time |
  |---|---|
  | `count(*)` with pre-L1 membership check | 66 ms |
  | `count(*)` with L1 `is_conversation_member` (RLS) | 2,532 ms |
  | `chat_overview()` | 2,579 ms |
  | `count(*)` with the set-returning fix below | 3.8 ms |

- Today the task chats hold about 18 imported comments, so production will not feel it on day one.
  A busy task chat will, and the dock calls `chat_overview()` on every membership event.
- Fix (file 1): evaluate membership once per statement instead of once per row.
  ```sql
  create or replace function app.chat_my_conversation_ids()
  returns setof uuid
  language sql
  stable
  security definer
  set search_path = ''
  as $$
    select m.conversation_id
    from n2click.conversation_members m
    join n2click.conversations c on c.id = m.conversation_id
    where m.user_id = (select auth.uid())
      and coalesce((select core.has_app('n2click')), false)
      and (c.context_type is distinct from 'task' or app.chat_can_read_task(c.context_id));
  $$;
  revoke all on function app.chat_my_conversation_ids() from public, anon;
  grant execute on function app.chat_my_conversation_ids() to authenticated, service_role;

  drop policy if exists "chat_messages_select" on n2click.messages;
  create policy "chat_messages_select" on n2click.messages
    for select to authenticated
    using (
      (select core.has_app('n2click'))
      and conversation_id in (select app.chat_my_conversation_ids())
    );

  drop policy if exists "chat_message_reactions_select" on n2click.message_reactions;
  create policy "chat_message_reactions_select" on n2click.message_reactions
    for select to authenticated
    using (
      (select core.has_app('n2click'))
      and conversation_id in (select app.chat_my_conversation_ids())
    );
  ```
  Keep `is_conversation_member` for single-row checks (INSERT/UPDATE policies, RPCs, topic, storage).
  The implementer must re-run the parity and "lost access" scenarios and time `chat_overview()` after
  the change. I only timed the plain `count(*)`.

### 3. MEDIUM (latent): any user can squat `project` / `client` conversation identities, plus a 23505 existence oracle

- Where: file 1 lines 84-86 (unique index on `(context_type, context_id)` for every context type) and
  lines 233-240 (`chat_conversations_insert` blocks only `'task'`). The base CHECK allows
  `'project'`, `'client'`, `'task'` (20260813180000:67).
- Attack: X (manager, company 2) creates `('group', 'project', <project of company 1>)` first. A later
  legitimate project chat cannot be created (23505), and a lookup-by-context would return X's
  conversation. This is the same class as the DM key squatting fixed in 20260813250000. The 23505 also
  tells X whether a context conversation exists.
- Repro (local, both outcomes observed):
  ```sql
  select t.login(t.id('X')); set role authenticated;
  insert into n2click.conversations (kind, context_type, context_id, created_by)
  values ('group', 'project', '9a000000-0000-4000-8000-0000000000a1', t.id('X'));  -- ACCEPTED
  reset role; select t.login(t.id('A')); set role authenticated;
  insert into n2click.conversations (kind, context_type, context_id, created_by)
  values ('group', 'project', '9a000000-0000-4000-8000-0000000000a1', t.id('A'));  -- 23505
  ```
- No client code writes `context_type` today (grep of `src/`: only reads in `chatData.ts:416`,
  `chatState.ts:460`), so the fix breaks nothing.
- Fix (file 1, replace lines 233-240):
  ```sql
  drop policy if exists "chat_conversations_insert" on n2click.conversations;
  create policy "chat_conversations_insert" on n2click.conversations
    for insert to authenticated
    with check (
      (select core.has_app('n2click'))
      and created_by = (select auth.uid())
      and context_type is null
      and context_id is null
    );
  ```
  Context conversations then come only from definer RPCs (today `chat_open_task`), each with its own
  authorization. Add a pre-apply smoke check: `select count(*) from n2click.conversations where context_type in ('project','client');` (expected 0).

### 4. MEDIUM (abuse, load): every message creates a notification per follower, and each row rehydrates the recipient's planner

- Where: file 4 lines 47-67. No coalescing, no rate limit. The author already lists the rehydration
  cost (L1-DB-NOTES risk 5) and unbounded growth (risk 6).
- Measured: 20 plain messages from A produced 20 `task_message` rows each for M and R
  (`E2 notifications after 20 plain messages: M=20,R=20`). A script posting 10 messages a second keeps
  every follower's client in a permanent rehydrate loop (debounce 1.2 s) and grows
  `n2click.notifications` without bound.
- Fix (file 4): keep mentions as they are, coalesce `task_message` to one unread row per
  recipient and conversation. Add to the `where` clause of the insert:
  ```sql
      and (
        m.user_id = any(new.mention_ids)
        or not exists (
          select 1 from n2click.notifications n
          where n.recipient_id = m.user_id
            and n.type = 'task_message'
            and n.read_at is null
            and n.payload->>'conversationId' = new.conversation_id::text
        )
      )
  ```
  The existing index `(recipient_id, read_at)` covers the lookup. Product consequence: the bell shows
  "new messages in task X" once until read. Coordinator decides; the alternative is accepting the load.

### 5. LOW (data integrity): a comment can be kept out of the import by pre-inserting a message with its id

- Where: file 3 lines 100-116 (`on conflict (id) do nothing`). `messages.id` is client-chosen
  (table-level INSERT grant since 20260813180000), and comment ids are readable by anyone who can read
  the comment. This works today, before any L1 file is applied.
- Repro (separate run: files 1 and 2 applied, attacker step, then file 3):
  ```sql
  select t.login(t.id('A')); set role authenticated;
  insert into n2click.conversations (id, kind, created_by)
    values ('5a000000-0000-4000-8000-000000000001', 'group', t.id('A'));
  insert into n2click.conversation_members (conversation_id, user_id, role)
    values ('5a000000-0000-4000-8000-000000000001', t.id('A'), 'owner');
  insert into n2click.messages (id, conversation_id, author_id, body)
    values ('cc000000-0000-4000-8000-000000000002', '5a000000-0000-4000-8000-000000000001', t.id('A'), 'squat');
  ```
  Result: backfill NOTICE says "nowe wiadomości: 2" with no warning, W2's comment is missing from the
  T1 chat, smoke check 6 `zaimportowane` still reports 3. Only `zle_daty = 1` reveals it.
- Impact is small (the comment stays in `n2click.comments`), but the import should fail loudly.
- Fix (file 3, before step 2):
  ```sql
  if exists (
    select 1
    from n2click.comments c
    join n2click.messages m on m.id = c.id
    where c.task_id is not null
      and not exists (
        select 1 from n2click.conversations conv
        where conv.id = m.conversation_id
          and conv.context_type = 'task'
          and conv.context_id = c.task_id
      )
  ) then
    raise exception 'task_chat_backfill: id komentarza zajęte przez wiadomość spoza rozmowy zadania';
  end if;
  ```
  Add the same query as pre-apply smoke check H (expected 0 rows):
  `select m.id, m.conversation_id from n2click.messages m join n2click.comments c on c.id = m.id;`

### 6. LOW (oracle): `reply_to` validation runs before RLS and tells a non-member which conversation a message belongs to

- Where: file 1 lines 273-309. The trigger is SECURITY DEFINER and BEFORE INSERT, and BEFORE triggers
  fire before the RLS WITH CHECK.
- Repro (X is in another company, not a member of T1):
  ```sql
  select t.login(t.id('X')); set role authenticated;
  insert into n2click.messages (conversation_id, author_id, body, reply_to)
    values (t.conv('T1'), t.id('X'), 'x', 'cc000000-0000-4000-8000-000000000001');  -- 42501 (RLS)
  insert into n2click.messages (conversation_id, author_id, body, reply_to)
    values (t.conv('T1'), t.id('X'), 'x', gen_random_uuid());                       -- 22023 (trigger)
  ```
  Needs two uuids the attacker cannot enumerate, so the practical risk is low.
- Fix (file 1, first statement of `chat_validate_message_content`):
  ```sql
  if (select auth.uid()) is not null
     and not app.is_conversation_member(new.conversation_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  ```
  Service paths and the backfill (`auth.uid()` null) are unaffected. `chat_set_theme` inserts as a
  member, so it passes.

### 7. LOW (abuse): `mention_ids` are not tied to the body and permanently subscribe up to 50 readers per message

- Where: file 1 lines 292-299 and 444-456. Any member can send `mention_ids` for people never named in
  the text. Each one with task access becomes a follower and then gets `task_message` for every later
  message until they unfollow.
- Repro: A posts `'zwykły tekst bez @'` with `mention_ids = {M, R, X}`. M and R become members and get
  `task_mention`. X (no access) is ignored, correctly. Afterwards M and R each got 20 notifications for
  20 plain messages.
- Side effect: the member list becomes an oracle for "can person P read this task". Low, because
  admins, managers and assignees are visible elsewhere in the planner.
- Fix options (product decision):
  1. Mentions notify once but do not auto-follow: drop `select unnest(new.mention_ids)` from
     `chat_message_auto_members`, and in `chat_notify_task_message` add mentioned users with
     `app.chat_user_can_read_task` who are not members. Clicking the notification opens the card,
     and `chat_open_task` adds them then.
  2. Keep as is and rely on finding 4's coalescing to cap the noise.

### 8. LOW (hygiene, verify on hosted): `authenticated` may hold TRUNCATE, TRIGGER, REFERENCES on `n2click.notifications`

- Where: file 4 line 97 revokes only from `anon`. In the stub, default privileges give `authenticated`
  ALL on the table (G1 output: `notifications:TRUNCATE, DELETE, TRIGGER, REFERENCES`). The original
  table came from `public` with Supabase default privileges, so hosted likely matches.
- PostgREST cannot issue TRUNCATE, so this is not exploitable through the API. TRUNCATE bypasses RLS,
  so it should not exist for a client role.
- Pre-apply check:
  ```sql
  select privilege_type from information_schema.role_table_grants
  where table_schema = 'n2click' and table_name = 'notifications' and grantee = 'authenticated';
  ```
- Fix (file 4): `revoke truncate, trigger, references, delete on n2click.notifications from authenticated;`
  (no DELETE policy exists, and the client never deletes notifications: `cloudMirror.ts:765-783` only
  updates `read_at`).

### 9. LOW (migration safety): no `lock_timeout`

- File 1 takes ACCESS EXCLUSIVE on `messages`, `conversations`, `conversation_members` (ALTER TABLE,
  CREATE POLICY) and SHARE ROW EXCLUSIVE on `core.profiles` (the `pinned_by` FK), all held to commit.
  File 3 takes SHARE ROW EXCLUSIVE on the three chat tables (DISABLE TRIGGER). Every statement is fast on
  current data, but a queued ACCESS EXCLUSIVE behind a long reader blocks all chat reads behind it.
- Fix: first line of files 1 and 3: `set local lock_timeout = '5s';`. On timeout, retry later.

### 10. INFO: attachment metadata is client-declared

- File 1 lines 316-363 validate shape and path prefix, not that the object exists, belongs to the
  sender, or has the declared size and type. Repro F4: a message pointing to a non-existent
  `<conv>/<uuid>.png` is accepted (broken image only). Storage checks MIME against the upload
  `Content-Type` header, not file bytes, so HTML or SVG bytes labelled `image/png` are accepted. The
  signed URL serves them as `image/png`, so browsers will not run them.
- Optional fix (file 1, inside the loop):
  ```sql
  if (select auth.uid()) is not null and not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'chat-attachments' and o.name = v_path
      and o.owner_id = (select auth.uid())::text
  ) then
    raise exception 'chat: załącznik nie istnieje' using errcode = '22023';
  end if;
  ```
  The client already uploads before inserting the message. Check L3 does not insert first.

### 11. INFO: correct two claims in the notes

- L1-DB-NOTES "traci kanał realtime": the topic policy denies the next join, but Supabase Realtime caches
  channel authorization for the life of the connection and re-checks on token refresh. A user removed
  from a task keeps receiving `chat:conv` events (full message rows) until reconnect or JWT refresh
  (up to 1 h). Same window as the signed URL risk already listed. Not verified on hosted.
- Rollback of file 1: restoring the old `app.is_conversation_member` drops the task-access check, so
  every former assignee with a stale membership row regains the full task chat. A file 1 rollback
  must keep the task check or delete stale task memberships in the same migration.

## Verified and holding (with evidence)

- Harness: `zsh docs/karta-v2/heavy.sh zsh docs/karta-v2/l1-pgtest/run.sh` gives ALL GREEN, 83 + 5 = 88
  assertions, including re-running all four files.
- Parity: `chat_can_read_task` mirrors `tasks_select` (has_app, administrator or manager or assigned,
  `company_ok_project`). `chat_user_can_read_task` mirrors it from `core.app_access` /
  `core.profiles`, including the `role = 'admin'` company bypass and NULL-company behaviour. Harness
  checks 7 users x 3 tasks.
- Comments to task chat audience: old `comments_select` (20260716190000:148-160) showed task comments
  to admin, manager, assignee and project members. The task chat shows them to admin, manager and
  assignee. Same or narrower, no new reader.
- `chat_open_task`: 42501 for foreign, unassigned and non-existent tasks (no existence oracle). Creates
  only through the definer, advisory lock plus `unique_violation` fallback handles races.
- Stale member (assignment removed): cannot read messages, members, attachments, topic; cannot UPDATE
  their own membership row (my D1: 0 rows, 0 `read` events), because the members SELECT policy hides it.
  Cannot delete their own upload either (F5: 0 rows), acceptable.
- Messages: `pinned_*` reset at insert, `mention_ids` deduped and author removed, paths must start with
  the same conversation id and match the strict regex, MIME and extension must match, sizes are bounded.
  Column UPDATE grant on `messages` is exactly `body, edited_at, deleted_at` (G4). Edit and soft delete
  require current membership. A soft delete clears the pin.
- Storage names: trailing newline, `/../` suffix, uppercase uuid all rejected (F1-F3). No UPDATE policy,
  so no upsert, move or overwrite. Bucket private, 10 MB, 4 image MIME types.
- Notifications: recipients need current task access, author excluded, muted followers excluded unless
  mentioned, one row per person per message (mention wins). `emailed_at = now()` keeps them out of the
  mail function. Clients can no longer insert `task_message` / `task_mention`. The client only inserts
  the three allowed types (`src/supabase/notificationEvents.ts:69,93,117`).
- Backfill: zero notifications, zero broadcasts, triggers re-enabled, idempotent on re-run. Trigger
  disable and re-enable sit in one DO block, so a mid-file error rolls everything back.
- `read` broadcast: private, same topic authorization (`app.chat_topic_member`, unchanged), payload is
  only `conversationId, userId, lastReadAt`, future timestamps clamped.
- Grants: anon has nothing on the chat tables or new functions (G2, G3). Every SECURITY DEFINER in `app`
  and `n2click` pins `search_path` (G5). `chat_can_read_task` and `chat_user_can_read_task` are not
  executable by `authenticated`.
- Apply order: file 2 needs file 1's `is_conversation_member`, file 3 must precede file 4 (and disables
  the notify trigger if it is already there). Timestamps give the right order.

## Could not verify

- Hosted policy text for `tasks_select` and the actual `messages_body_check` name (smoke checks B and C cover it).
- Hosted grants on `n2click.notifications` (finding 8 query).
- Realtime behaviour on hosted: authorization caching after access loss, and whether an INSERT policy
  can filter by broadcast event name.
- Storage server behaviour: `storage.prefixes` / root listing exposure of folder names, signed upload
  URLs created before access loss (valid up to 2 h), response headers on signed URLs.
- Whether the `app` schema is exposed in the Data API (layout doc says only app schemas are; dashboard only).
- Lock wait behaviour against live traffic.

## How I tested

- Author harness, unchanged.
- My scenarios ran on the same throwaway Postgres 17 setup (separate ports, `/tmp` clusters, removed
  after each run), not committed: attack file run after `scenarios.sql`, a backfill squat run with an
  attacker step between files 2 and 3, and a 20k-message timing run. The repro SQL for each finding is
  inline above and uses the harness helpers (`t.login`, `t.id`, `t.conv`). For finding 1 the stub needs
  `grant usage on all sequences in schema realtime to authenticated;` first.
