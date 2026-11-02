# Karta zadania v2: praca i rozmowa obok siebie

Branch `feat/karta-zadania-v2`, worktree `N2Media/N2click-worktrees/karta-v2`.
Decision by Kacper, 2026-11-02. Design source: `reports/n2click-karta-zadania-warianty-2026-11-02.html`
in the main checkout (variant 2, section 04) and its preview PNG
`reports/karta-zadania-2026-11-02/preview/mk-tpl-v2.png` in the main checkout
(`/Users/kacpercichy/Documents/AI/N2Media/N2click/reports/...`).

## Scope (all approved)

1. Task card layout variant 2: details left, conversation right, full height.
2. Screenshots / images in conversations: both the regular chat (dock) and the task conversation.
   Paste (Ctrl/Cmd+V), drag and drop, file picker. Thumbnails in the bubble, click opens a lightbox.
   This explicitly lifts the CLAUDE.md "no file attachments" guardrail, for images in conversations only.
3. Notifications for new messages and @mentions in a task conversation (bell + Panel tile).
4. Followers of a task conversation (auto: assignees, authors, mentioned people; manual follow/unfollow).
5. Edit, delete, reactions on messages (task conversation and chat).
6. Reply to a specific message (quote). `messages.reply_to` exists, UI does not.
7. Pinned messages, shown at the top of the conversation ("Przypięte"), both chats.
8. "Seen by" (Widziane przez): small avatars of people who have read up to a message,
   Messenger style, with name + time in the shared tooltip. Task conversation and chat.

Out of scope: video/screen recording, non-image files, task dependencies, AI features,
subtasks, templates, notes pinned on screenshots.

## Architecture decision: task conversation = chat conversation

The task discussion moves from `n2click.comments` (append-only, local-first) to the chat engine
(`n2click.conversations` with `context_type = 'task'`, `context_id = task id`). The column and its
CHECK already exist (0 rows use it today). Everything (attachments, edit, delete, reactions, reply,
pins, seen-by, realtime, unread) is built ONCE in the chat engine and reused by the task card.

- Existing 18 task comments are backfilled into task conversations (same author, body, created_at).
  `n2click.comments` rows are NOT deleted. Project comments (2 rows, entity 'project') stay on
  `CommentsPanel` unchanged.
- Local mode (`VITE_AUTH_MODE=local`, no cloud): the task card's right pane falls back to the old
  `CommentsPanel entityType="task"`. The chat engine is cloud only, as today.
- New task messages never write `n2click.comments`.

## Data contract (owner L1, consumers L2 to L4)

Migrations go in `supabase/migrations/20261102xxxxxx_*.sql` (forward-only), registered in
`src/supabase/migrations.test.ts`. Read `openwiki/n2hub/cloud-database.md` and
`~/Documents/AI/_references/supabase-layout.md` first. Tables live in schema `n2click`.

- `messages.attachments jsonb not null default '[]'`: array, max 10 items, each
  `{ "path": text, "mime": "image/webp|image/png|image/jpeg|image/gif", "width": int, "height": int, "size": int, "name": text }`.
  Body check becomes: `char_length(body) <= 4000 and (char_length(body) >= 1 or jsonb_array_length(attachments) > 0)`.
  Every `path` must start with `<conversation_id>/` (enforced server side).
- `messages.mention_ids uuid[] not null default '{}'` (profile ids, client-parsed like comments).
- `messages.pinned_at timestamptz null`, `messages.pinned_by uuid null` (FK core.profiles).
- `conversations`: allow `kind = 'task'` (or keep kind and rely on context; L1 decides, documents it),
  partial unique index on `(context_type, context_id)` where context is not null.
- RPC `chat_open_task(p_task_id uuid) returns uuid`: SECURITY DEFINER, checks the caller can SELECT
  that task under the same rule as the tasks select policy, creates the conversation if missing,
  adds the caller and the task's assignees as members (idempotent), returns conversation id.
- RPC `chat_set_pin(p_message_id uuid, p_pinned boolean)`: any member; broadcasts the update the same
  way edits are broadcast today.
- RPC `chat_set_follow(p_conversation_id uuid, p_follow boolean)`: follow = `muted_until is null`,
  unfollow = `muted_until = 'infinity'`. Author of a message and mentioned people become members
  (followers) automatically on insert.
- Read receipts: an update of `conversation_members.last_read_at` must reach other members live
  (realtime broadcast event `read` with `{ conversationId, userId, lastReadAt }`), so seen-by updates
  without reload. Use the same topic/broadcast mechanism the chat already uses.
- Storage: private bucket `chat-attachments`, 10 MB per object, image mime allowlist above.
  Object path `<conversation_id>/<uuid>.<ext>`. SELECT and INSERT only for members of that
  conversation (task conversations: members, and `chat_open_task` makes the viewer a member).
  No UPDATE. DELETE only by the uploader (owner). Follow the `avatars` bucket precedent in
  `20260715210500_rls_policies.sql`.
- Notifications: new `notifications.type` values `task_message` and `task_mention`.
  An AFTER INSERT trigger on `messages` for task conversations writes one row per member except the
  author whose `muted_until` is null or past (`task_message`), and `task_mention` for each id in
  `mention_ids` (a mention wins over task_message for the same person, no duplicates).
  Payload: `{ taskId, conversationId, messageId, actorId }`. The backfill of old comments must NOT
  create notifications.
- Migrations are NOT applied by workers. The coordinator applies them to the hosted project after review.

## Client contract (stubs already committed)

- `src/chat/attachments/index.ts` (owner L2): types + public API. See the stub for exact names.
- `src/chat/ui/TaskConversationPane.tsx` (owner L3): `export function TaskConversationPane(props: { taskId: string })`.
  The stub renders the local-mode fallback (`CommentsPanel`). L4 mounts it; L3 replaces the internals.
- `src/chat/ui/ChatThread.tsx` (owner L3, new): the reusable message list + composer used by both
  `ChatWindow` (dock) and `TaskConversationPane`. One implementation, two shells.

## File ownership (do not edit files owned by another line; ask the coordinator)

| Line | Owns |
|---|---|
| L1 DB + notifications | `supabase/migrations/20261102*`, `src/supabase/migrations.test.ts`, `src/supabase/notificationEvents.ts`, `src/utils/notifications.ts`, `src/components/NotificationsBell.tsx`, `src/pages/dashboardPanels.ts`, `NotificationType` in `src/types.ts` (that one union only), `openwiki/n2hub/cloud-database.md` |
| L2 attachments | `src/chat/attachments/**` |
| L3 chat engine + chat UI | `src/chat/**` except `src/chat/attachments/**` |
| L4 task card | `src/components/TaskModal.tsx`, `src/components/taskModalSections.ts`, `src/components/taskCard/**` (new), `src/pages/TaskFullPage.tsx`, `openwiki/n2hub/ui-navigation-and-onboarding.md` |

New CSS goes in the owner's own file (`src/chat/ui/chat-thread.css`, `src/chat/attachments/attachments.css`,
`src/components/taskCard/task-card.css`), imported by the component. Do not edit `src/styles.css`
(shared); reuse its tokens `--n2-*` and existing primitives. If you need a change there, ask.

## UI rules

- Polish strings only. No em or en dashes in visible copy. Lucide icons (`lucide-react`).
- PRODUCT.md principles: values read as text, editing is an explicit state; color carries meaning
  (violet = action, cyan = events, red = danger, lime = success); WCAG AA, visible focus,
  `prefers-reduced-motion`, 44 px touch targets, shared tooltip system (no native `title`),
  live region announcements for sends and errors.
- Shared overlay/popover/lightbox behavior starts from `openwiki/n2hub/frontend-performance-and-primitives.md`
  and existing `useOverlay` / `ModalFrame`; no new primitive without comparing two primary sources.
- Task card layout (L4), matching mockup v2:
  - Header: breadcrumb Klient > Projekt (click changes them), "Zapisano" status, link, expand to full view, menu, close.
    No "Gotowe / Zamknij" footer in edit mode (autosave exists). Create mode keeps its explicit "Utwórz zadanie".
  - Left: title (click to edit), 3 x 2 tiles: Status, Priorytet, Okres, Osoby, Godziny (bar 9/11h), Kategoria i dział.
    Each tile opens the existing editor for that field. Then Opis (read text, click to edit), Checklista,
    "Godziny osób" table (w kalendarzu, w zasobniku, razem) with a "Siatka dni" action opening the existing
    allocation grid as an explicit sub-view. Powtarzanie as a collapsed row.
  - Right: `TaskConversationPane` on full height (about 520 px, min 420).
  - >= 1280 px split; < 1280 px stacked (conversation under details); < 760 px a segmented switch
    "Szczegóły | Rozmowa (n)" with sticky composer.
  - Create mode and draft tasks: right pane shows an empty state "Rozmowa pojawi się po utworzeniu zadania".
- Conversation pane (L3): header "Rozmowa", tabs "Komentarze (n)" and "Historia (n)" (activity log of the task,
  existing selectors), follower avatars + bell toggle (Obserwuj / Przestań obserwować), pinned bar at top
  ("Przypięte (n)", expandable, click scrolls to the message), messages as chat bubbles (same look as the dock),
  system rows, day separators, typing indicator if available, seen-by avatars, composer with @mentions,
  emoji, GIF, image attach, Enter sends, Shift+Enter new line. Message actions: Odpowiedz, Reakcja,
  Przypnij / Odepnij, Edytuj and Usuń (own messages).

## Hard invariants (from CLAUDE.md, still apply)

Do not change reducer semantics, autosave, validation, save reconciliation, the allocation grid internals or
calendar/bin pointer logic. A failed save must never show "Zapisano". Invalid commands keep the prior state reference.

## Working rules for every line

1. Work only in this worktree: `/Users/kacpercichy/Documents/AI/N2Media/N2click-worktrees/karta-v2`.
   `node_modules` is a symlink to the main checkout. Never run `npm install`.
2. The Mac has 16 GB and heavy swap. Run every heavy command through the lock:
   `zsh docs/karta-v2/heavy.sh npx tsc --noEmit`, `zsh docs/karta-v2/heavy.sh npx vitest run`, builds,
   Playwright. Single-file `npx vitest run <file>` may run outside the lock. Max one dev server per line,
   on your own port (L1 5181, L2 5182, L3 5183, L4 5184), stop it when done.
3. Playwright: `import { chromium } from '/Users/kacpercichy/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs'`,
   launch with `{ channel: 'chrome' }`. Local mode dev server: `VITE_AUTH_MODE=local npx vite --port <yours> --strictPort`,
   then click "Wczytaj przykładowe dane". Cloud features cannot be logged into from automation; cover them with unit tests.
4. Commit often, only your own paths: `git add <your paths>` (never `git add -A` / `.`), message prefix
   `feat(karta-v2/L<n>): ...` in Polish or English. If `index.lock` exists, wait 5 s and retry.
5. Bugs: if you find a bug in another line's area or in already committed work, stop and report it with evidence
   (file, line, repro). Do not patch other lines' files. Red-to-green inside your own unreported task is fine.
6. Final report: what is done, commits (SHA), tests run with results, what is not done, open questions.
   Do not claim cloud behavior works unless a test proves it; say "untested against hosted DB" instead.
