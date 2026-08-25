# Chat reactions and chat themes: implementation research (2026-08-25)

Target: two additions to the N2Hub chat (`src/chat/`): Messenger-style emoji reactions on
messages, and Messenger-style per-conversation themes ("skins") with an AI-generated library of
backgrounds. Stack facts assumed: Vite/React/TS, plain CSS with `--n2-*` tokens, `motion`,
own emoji list (`src/chat/ui/chatEmoji.ts`), Supabase schema `n2click` with
`conversations`, `conversation_members`, `messages`, deny-by-default RLS, `security definer`
RPCs, Realtime Broadcast on private channel `chat:conv:<id>`.

Facts come from the sources linked inline or from reading our own files. Weak sources
(forums, third-party blogs) are flagged.

---

# Part A. Emoji reactions

## A0. Decision summary

1. Messenger semantics: ONE reaction per user per message; pick another = replace; pick the
   same = remove.
2. Table `n2click.message_reactions`, PK `(message_id, user_id)`, denormalized
   `conversation_id`, FK to an allowlist table generated from `chatEmoji.ts`.
3. All writes via `security definer` RPC `chat_set_reaction(message_id, emoji | null)`;
   the client computes the toggle, so the call is idempotent.
4. Reads: PostgREST embed `message_reactions(user_id, emoji, created_at)` on the existing
   page query; group in TS.
5. Realtime: `realtime.send` from the RPC with custom event `reaction` on the existing
   private channel; payload = (user -> emoji) assignment, no counts.
6. Quick bar of 7 (❤️ 😆 😮 😢 😡 👍 👎) + "+" reusing the existing emoji popover.
   Hover toolbar on desktop, long-press on touch. Pills overlap the bubble's bottom corner.
7. Native emoji rendering, no Twemoji. No unread/ordering changes. ~24 h.

## A1. UX pattern catalogue

| Product | Trigger desktop | Trigger touch | Quick bar | Per-user rule | Pill placement | Who reacted | Keyboard |
|---|---|---|---|---|---|---|---|
| Messenger | hover -> "React" icon in message toolbar | long-press (double-tap = configurable quick reaction) | 7: ❤️ 😆 😮 😢 😡 👍 👎 + "+"; slots customizable | ONE per user; another replaces; same removes | overlapping bubble bottom corner, stacked, count | tap the pill stack -> sheet grouped per emoji | none |
| Slack | hover toolbar: up to 3 one-click emoji + "Add reaction" | long-press -> frequent row + picker | frequently used | MANY (23/person/message) | row under message | hover pill -> tooltip | `R` on focused message |
| Discord | hover toolbar + frequent | long-press | frequently used | MANY; 20 unique/message (community source) | row under message | hover -> first 3 names; modal | `+` on focused message |
| Telegram | hover/click reaction icon | tap / double-tap = quick 👍 | expandable panel, frequent first | ONE free, 3 Premium | pills in bubble footer | list in groups only | none |
| WhatsApp | hover -> smiley | long-press -> tray | 6 slots + "+" | ONE per user, replace | overlapping bubble corner | tap pill -> sheet | none |
| iMessage | right-click / hover | long-press or double-tap | 6 Tapbacks; iOS 18 any emoji | ONE per person | stacked on bubble top corner | tap the stack | none |
| Zulip | hover icons | long-press | frequent | MANY | row under message | hover pill | `:` any, `+` = 👍 |

Sources: Messenger 2017 launch https://about.fb.com/news/2017/03/introducing-message-reactions-and-mentions-for-messenger/ ;
Slack help https://slack.com/intl/en-fi/help/articles/206870317-Use-emoji-reactions ,
shortcuts https://slack.com/help/articles/201374536-Slack-keyboard-shortcuts ;
Discord limit (community) https://support.discord.com/hc/en-us/community/posts/360071098992-Message-emojis-limit ;
Telegram API https://core.telegram.org/api/reactions ;
WhatsApp https://techwiser.com/things-to-know-about-whatsapp-message-reactions/ ;
iMessage https://www.macrumors.com/how-to/ios-use-new-tapback-reactions-messages/ ;
Zulip https://zulip.com/help/emoji-reactions

Behaviours worth copying:

- Messenger's "one per user, replace" keeps the row short: a message from 15 people never
  shows more than 15 reactions, usually 2-4 pills.
- Messenger sorts pills by count desc, shows up to ~3 distinct glyphs then a total ("❤️😆 5").
- Slack/Discord keep a trailing "+" pill once a reaction exists.
- Telegram: tapping an already-chosen pill removes it.

Screen reader and keyboard:

- Each pill is `<button aria-pressed={mine}>` with a stable name, e.g.
  `aria-label="Kciuk w górę, 3 reakcje"`. State is conveyed by `aria-pressed`
  (https://github.com/forem/forem/issues/14182 ,
  https://primer.style/accessibility/patterns/primer-components/descriptive-buttons/ ).
- Glyph inside the pill: `aria-hidden="true"` when the button already has an aria-label
  (https://tink.uk/accessible-emoji/ ). We already have `emojiLabel(char)` in `chatEmoji.ts`.
- Quick bar: `role="toolbar"`, roving tabindex (Left/Right), Escape closes, Enter/Space
  selects, focus returns to the message.
- One polite live region per chat window ("Kasia zareagowała 👍"), not per pill.
- Touch targets: 44x44 for bar items; pill hit area not below 32 px.

## A2. Data model

How others model it:

| System | Storage | Key | Emoji identity | Source |
|---|---|---|---|---|
| Mattermost | `Reactions(UserId, PostId, EmojiName, CreateAt, DeleteAt, ...)` | PK (PostId, UserId, EmojiName) | shortcode | https://raw.githubusercontent.com/mattermost/mattermost/master/server/public/model/reaction.go |
| Zulip | `Reaction(user_profile, message, emoji_name, emoji_code, reaction_type)` | unique (user, message, type, code) | hex codepoints, no FE0F | https://zulip.readthedocs.io/en/stable/subsystems/emoji.html |
| Matrix | event `m.reaction`, `m.relates_to {rel_type:"m.annotation", key}` | duplicate rejected `M_DUPLICATE_ANNOTATION` | string with FE0F | https://github.com/uhoreg/matrix-doc/blob/aggregations-reactions/proposals/2677-reactions.md |
| Rocket.Chat | jsonb on message: `reactions: { ":heart:": { usernames: [...] } }` | map | shortcode | https://developer.rocket.chat/reference/api/schema-definition/message |
| Stream Chat | rows + `reaction_counts`, `own_reactions`; `enforce_unique: true` = Messenger mode | | string | https://getstream.io/chat/docs/react/send-reaction/ |
| joshnuss/supabase-reactions | `reactions(scope, user_id, emoji, deleted_at)` + counter table via definer functions | unique(scope,user,emoji) | string | https://github.com/joshnuss/supabase-reactions/blob/master/setup.sql |

Options for us:

| | (a) PK (message_id, user_id, emoji), Slack style | (b) PK (message_id, user_id), emoji replaceable, Messenger style | (c) jsonb `reactions` on `messages` |
|---|---|---|---|
| Per-user | many | exactly one | either, enforced in RPC |
| Toggle | insert or delete one row | delete if same, else upsert | read-modify-write under row lock |
| Concurrency | row-level | row-level | serialises all reactors on the message row; re-broadcasts whole message |
| Read (50 msgs) | embed or aggregate | same | free |
| RLS | plain per row | plain per row | rides on `messages` UPDATE (author only today); needs RPC anyway |
| Later switch | (a)->(b) constraint change | (b)->(a) trivial | painful |

Pick (b) with denormalized `conversation_id` so RLS and the broadcast topic never join.
(a) is one migration away if multi-reactions are wanted later.

Read path: extend the existing page select to
`'*, message_reactions(user_id, emoji, created_at)'` (PostgREST embed via the FK). At 10-20
users a page carries at most ~1000 reaction rows, typically under 50. Aggregate in TS.
Move to a server aggregate RPC (`chat_reactions_for(uuid[])` with `jsonb_agg`) only if the
payload grows.

RLS: `select` via `app.is_conversation_member(conversation_id)` (existing helper). No
insert/update/delete grants for `authenticated`; writes go through the RPC, which checks
`messages.deleted_at is null`, membership and the allowlist in one place.

Realtime: do NOT use `realtime.broadcast_changes` on the new table. `ChatProvider` subscribes to
`INSERT`/`UPDATE` on the same channel and `extractBroadcastRecord` does not check
`payload.table`, so reaction rows would be parsed as messages. Use `realtime.send(payload,
'reaction', topic, true)` from the RPC with a custom event name.

Payload (event `reaction`):

```json
{ "messageId": "…", "userId": "…", "emoji": "👍", "prevEmoji": null, "op": "set" }
{ "messageId": "…", "userId": "…", "emoji": null, "prevEmoji": "👍", "op": "remove" }
```

No counts: with one-per-user semantics the client state is `messageId -> { userId -> emoji }`;
counts derive from it, so applying an event is idempotent regardless of order.
Docs: https://supabase.com/docs/guides/realtime/broadcast ,
https://supabase.com/docs/guides/realtime/authorization

## A3. Emoji rendering consistency

| Option | Bytes | License | Cross-OS | Effort |
|---|---|---|---|---|
| Native, font stack `"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"` | 0 | n/a | differs per OS; Windows 10 lacks newest glyphs | none |
| Twemoji SVG (jdecked fork) | 7 quick glyphs ~15-20 KB; all ~600 ~1 MB | CC-BY 4.0, attribution in app | identical | asset pipeline, render in pills, bar, picker AND bodies |
| Noto Color Emoji SVG | similar | Apache 2.0 | identical | same |
| Noto COLRv1 web font | ~10 MB | OFL | identical | too heavy |

Sources: https://github.com/jdecked/twemoji/releases , https://github.com/googlefonts/noto-emoji ,
https://nolanlawson.com/2022/04/08/the-struggle-of-using-native-emoji-on-the-web/

Recommendation: native. A Twemoji 👍 in a pill next to a native 👍 in the body looks broken;
consistency inside one machine matters more than across machines. Add the font stack and
`font-variant-emoji: emoji` on the chat root. Keep the quick-bar set to Emoji <= 12 so
Windows 10 renders it.

## A4. Storage and normalization

- Store the Unicode string exactly as listed in `EMOJI_CATEGORIES[].emojis[].char`.
- Keep U+FE0F as listed. Never strip it blindly: `❤` without FE0F renders as a text heart on
  some platforms (https://unicode.org/reports/tr51/#Emoji_Variation_Sequences ).
- No skin tones for reactions (Messenger, iMessage have none; Slack fragments pills).
- Postgres regex has no `\p{Emoji}`. Cheap backstop check:
  `char_length(emoji) between 1 and 10 and octet_length(emoji) <= 40 and emoji !~ '[[:space:][:cntrl:][:alpha:]]'`.
  Real guard: allowlist table `n2click.chat_emoji(char text primary key)` generated from
  `chatEmoji.ts` by a script, FK from `message_reactions.emoji`; a node test asserts the
  generated list equals the TS list.
- Client validation: membership in a `Set` built from `EMOJI_CATEGORIES`; optionally
  `/^\p{RGI_Emoji}$/v` (needs ES2024 `v` flag) or `Intl.Segmenter` grapheme count === 1.

## A5. Optimistic UI and conflicts

State: `reactionsByMessage: Record<messageId, Record<userId, emoji>>`. Two pure idempotent
operations: `setReaction(messageId, userId, emoji)`, `removeReaction(messageId, userId)`.
Broadcast events, RPC responses and page loads all reduce to them.

Click flow:

1. Reducer applies the intended final state immediately (same emoji -> remove, else set).
2. Call `chat_set_reaction(message_id, emoji | null)`; the RPC returns the full reaction list
   for that message; reducer overwrites that message's map.
3. Broadcast echo arrives (DB-originated broadcasts reach the sender too); same assignment,
   no-op.
4. Error: refetch that one message's reactions instead of keeping an undo snapshot.

Rapid double-click: per-message `pending` flag; store only the latest intent and fire it
after the in-flight RPC returns. Sending the intended emoji (not "toggle") avoids the
double-toggle race.

## A6. Unread and notification semantics

| Product | Bumps unread | Notifies author |
|---|---|---|
| Messenger | community reports say sometimes (weak source) | yes, "Reactions" category |
| WhatsApp | no | author only, toggle in settings |
| Slack | no channel unread | Activity view "Reactions" |
| Telegram | separate `unread_reactions_count` | yes |
| Teams | shows as unread Activity; users complain it is sticky | yes |

Recommendation: do not touch `last_message_at`, `last_read_at` or the unread badge. Notify
only the author, in-app: a short dock toast ("Kasia zareagowała 👍 na Twoją wiadomość") plus
the chat sound at low priority, suppressed when that conversation is focused, respects
`muted_until`. Skip a persistent reactions feed for now.

## A7. Animation spec (`motion/react`)

| Element | Enter | Exit | Transition |
|---|---|---|---|
| Quick bar | `opacity 0->1, scale 0.85->1, y 6->0`, origin at anchor side | `opacity->0, scale->0.95` | spring `visualDuration: 0.18, bounce: 0.3`; children stagger 18 ms |
| Bar item hover/focus | `scale 1.35, y -4` | back | spring `stiffness 500, damping 26` |
| Bar item selected | `scale 1->1.5->1` 220 ms, then bar closes | | tween easeOut |
| Pill added | `scale 0.6->1, opacity 0->1` | | spring `stiffness 600, damping 22` (~250 ms) |
| Pill count change | number crossfade `y ±6` | | tween 120 ms |
| Pill removed | | `opacity->0, scale->0.7` | tween 120 ms easeIn in `AnimatePresence` |
| Pill reflow | `layout` on pills and row | | spring default; `border-radius` via `style` |
| Fly bar -> pill (optional) | `layoutId="react-<msg>-<emoji>"` on both inside one `LayoutGroup` | | spring `visualDuration: 0.25, bounce: 0.2` |

Reduced motion: `<MotionConfig reducedMotion="user">` at the chat root; skip `layoutId` when
`useReducedMotion()`. Never block the RPC on the animation. Docs:
https://motion.dev/docs/react-transitions , https://motion.dev/docs/react-layout-animations ,
https://motion.dev/docs/react-accessibility

## A8. Implementation plan

### A8.1 Migration `supabase/migrations/2026xxxx_chat_reactions.sql` (~3 h)

```sql
-- allowlist generated from src/chat/ui/chatEmoji.ts
create table n2click.chat_emoji (char text primary key
  check (char_length(char) between 1 and 10 and octet_length(char) <= 40));
insert into n2click.chat_emoji values ('👍'), ('❤️'), ... ;  -- generated

create table n2click.message_reactions (
  message_id      uuid not null references n2click.messages(id) on delete cascade,
  user_id         uuid not null references core.profiles(id) on delete cascade,
  conversation_id uuid not null references n2click.conversations(id) on delete cascade,
  emoji           text not null references n2click.chat_emoji(char),
  created_at      timestamptz not null default now(),
  primary key (message_id, user_id)          -- Messenger: one per user
);
create index message_reactions_conv_idx on n2click.message_reactions (conversation_id, message_id);

alter table n2click.message_reactions enable row level security;
revoke all on n2click.message_reactions from anon, authenticated, service_role;
grant select on n2click.message_reactions to authenticated;   -- no write grants
create policy "chat_message_reactions_select" on n2click.message_reactions
  for select to authenticated
  using (app.is_conversation_member(conversation_id));

create or replace function n2click.chat_set_reaction(p_message_id uuid, p_emoji text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_conv uuid; v_prev text; v_uid uuid := (select auth.uid());
begin
  select m.conversation_id into v_conv
  from n2click.messages m
  where m.id = p_message_id and m.deleted_at is null
  for share;
  if v_conv is null then raise exception 'message not found' using errcode = 'P0002'; end if;
  if not app.is_conversation_member(v_conv) then raise exception 'forbidden' using errcode = '42501'; end if;

  select r.emoji into v_prev from n2click.message_reactions r
   where r.message_id = p_message_id and r.user_id = v_uid;

  if p_emoji is null then
    delete from n2click.message_reactions where message_id = p_message_id and user_id = v_uid;
  else
    insert into n2click.message_reactions (message_id, user_id, conversation_id, emoji)
    values (p_message_id, v_uid, v_conv, p_emoji)
    on conflict (message_id, user_id) do update set emoji = excluded.emoji, created_at = now();
  end if;

  if v_prev is distinct from p_emoji then
    perform realtime.send(
      jsonb_build_object('messageId', p_message_id, 'userId', v_uid,
                         'emoji', p_emoji, 'prevEmoji', v_prev,
                         'op', case when p_emoji is null then 'remove' else 'set' end),
      'reaction', 'chat:conv:' || v_conv::text, true);
  end if;

  return (select coalesce(jsonb_agg(jsonb_build_object('userId', r.user_id, 'emoji', r.emoji, 'createdAt', r.created_at)
                          order by r.created_at), '[]'::jsonb)
          from n2click.message_reactions r where r.message_id = p_message_id);
end $$;
revoke all on function n2click.chat_set_reaction(uuid, text) from public;
grant execute on function n2click.chat_set_reaction(uuid, text) to authenticated;
```

`for share` on the message blocks a concurrent soft delete. Unknown emoji surfaces as `23503`
-> client message "Nieobsługiwane emoji". Follow the helper conventions from
`20260813180000_chat.sql`. Generator: `scripts/gen-chat-emoji-sql.ts` reads
`EMOJI_CATEGORIES`; a test compares the migration list to the TS list.

### A8.2 Types (`src/chat/types.ts`, ~0.5 h)

```ts
export interface ChatReaction { userId: string; emoji: string; createdAt: string }
export interface ChatMessage { /* existing */ reactions: ChatReaction[] }
export interface ChatReactionEvent {
  messageId: string; userId: string; emoji: string | null; prevEmoji: string | null; op: 'set' | 'remove';
}
export interface ChatReactionGroup { emoji: string; count: number; mine: boolean; userIds: string[] }
```

### A8.3 `chatData.ts` (~2 h)

- `selectMessages`: select `'*, message_reactions(user_id, emoji, created_at)'`;
  `toChatMessage` maps the embedded array (empty default).
- `ChatDb.setReaction(messageId, emoji | null)` -> `rpc('chat_set_reaction')`, returns
  `ChatReaction[]`.
- Pure helpers with tests: `toChatReactionEvent(raw)`, `groupReactions(list, selfId)` (count
  desc, then first createdAt), `applyReactionEvent(list, event)` (idempotent),
  `nextReactionIntent(current, clicked): string | null`.

### A8.4 State and provider (`chatState.ts`, `ChatProvider.tsx`, ~3 h)

- Actions `reaction/apply` (event) and `reaction/replace` (message id + full list).
- `.on('broadcast', { event: 'reaction' }, ...)` on the existing channel;
  `toggleReaction(messageId, emoji)` with optimistic apply, per-message pending intent,
  revert-by-refetch.
- Author-only toast/sound when `event.userId !== self`, `message.authorId === self`, and the
  conversation is not focused.
- On reconnect: refetch reactions for the visible page (`realtime.messages` retains 3 days,
  and `loadMessagesSince` does not cover reactions on already-loaded messages).

### A8.5 UI (~8 h)

- `ReactionBar.tsx`: 7 quick emoji + "+" opening `ChatEmojiPopover` in "pick one" mode.
  Desktop: from the message hover toolbar (next to reply/edit) and the action menu. Touch:
  long-press (400 ms timer, cancel on move > 8 px, `contextmenu` prevented for touch only).
  `role="toolbar"`, roving tabindex.
- `ReactionPills.tsx`: absolute, bottom corner overlapping the bubble by ~40 %, side depends
  on mine/theirs; message row gets extra bottom padding when pills exist; `button
  aria-pressed`, glyph + count when > 1; `AnimatePresence` + `layout`.
- `WhoReactedPopover.tsx`: click on count or long-press; grouped by emoji, names via
  `chatPeople.ts`, own row first; desktop tooltip with names.
- Dock windows: same components, 28 px bar items.

### A8.6 Tests (~3 h)

- `chatData.test.ts`: `groupReactions`, `applyReactionEvent` idempotence, `nextReactionIntent`,
  malformed payloads.
- `chatState.test.ts`: optimistic apply then RPC replace, echo no-op, error revert.
- `chatEmoji.test.ts`: every `char` unique; generated allowlist equals the list.
- SQL: non-member 42501, soft-deleted P0002, unknown emoji 23503, same emoji removes,
  different replaces.

### A8.7 Totals

| Step | Hours |
|---|---|
| Migration + RPC + generator | 3 |
| Types + chatData + helpers | 2.5 |
| State + provider + broadcast | 3 |
| UI + CSS + touch long-press | 8 |
| Keyboard + screen reader | 2 |
| Animation + reduced motion | 2 |
| Tests | 3 |
| Total | ~24 h (~30 h if long-press fights `useChatKeyboardInset.ts`) |

## A9. Gotchas

- `handleBroadcast`/`extractBroadcastRecord` ignore `payload.table`: never use
  `broadcast_changes` on the reactions table.
- DB-originated broadcasts reach the sender; reducer must be idempotent (map design).
- Do not strip U+FE0F. Skin tones are distinct strings; decide before "+" exposes tone pickers.
- Soft-deleted messages: RPC refuses; client hides pills when `deletedAt`.
- Long-press vs text selection and browser context menu: prevent `contextmenu` only for
  touch pointers, keep a move threshold.
- Overlapping pills need row bottom margin or they cover the next message.
- Twemoji needs CC-BY attribution if ever adopted; use jdecked/twemoji, not twitter/twemoji.
- `\p{RGI_Emoji}` needs the regex `v` flag; check TS `target`/`lib` first.

---

# Part B. Chat themes ("skiny")

## B0. Decision summary

1. Shared per-conversation theme (Messenger model): column `conversations.theme_id`, any
   member can change it, everyone sees it, system message "X zmienił(a) motyw na Y".
2. Static catalog `src/chat/themes/catalog.ts`; assets in `/public/chat-themes/`; adding a
   skin = drop files + one catalog entry. Validate script for contrast and asset size.
3. Theme values applied as CSS custom properties scoped on `.n2chat-window` with
   `var(x, existing-token)` fallbacks. Nothing global changes.
4. Patterns = monochrome alpha masks (SVG, Telegram format) tinted with `mask-image` +
   `background-color: var(--chat-accent)`; one mask serves light and dark.
5. Illustrated backgrounds = AVIF (+WebP), 2048x2048 master, 80-150 KB, tokenised dim overlay.
6. Outgoing gradient shared across the list (Messenger effect): one gradient sized to the
   list viewport, positioned per bubble via CSS vars from a passive scroll listener + rAF.
   Not `background-attachment: fixed`, not `mix-blend-mode`.
7. Persistence via RPC `chat_set_theme`, `messages.kind = 'system'` + `meta jsonb`,
   `realtime.send` on the existing `chat:conv:<id>` channel.
8. Generate assets with Nano Banana 2 (unlimited), 4 variants per prompt, roll-check seams.
9. 10 skins in v1, ~30-40 h.

## B1. Anatomy of Messenger chat themes

Timeline (Meta): Oct 2020 new look + themes
(https://about.fb.com/news/2020/10/a-new-look-for-messenger/); Jun 2021 more themes, shared
with Instagram (https://about.fb.com/news/2021/06/more-new-features-coming-to-messenger/);
Sep 2024 Meta AI custom themes that "change the background and the color of the text bubble
for everyone in the chat" (https://about.fb.com/news/2024/09/metas-ai-product-news-connect/).
Help Center: a theme set in a chat applies across Messenger, messenger.com, desktop and
Facebook; any participant can change it
(https://www.facebook.com/help/messenger-app/1604688606495911).

| Element | Behaviour |
|---|---|
| Outgoing bubble | Solid color or gradient. Gradient is fixed to the viewport, so bubbles appear to change color as they scroll. |
| Incoming bubble | Neutral gray in "Colors & gradients"; illustrated themes recolor it to match the wallpaper. |
| Background | Plain in "Colors & gradients"; illustrated wallpaper (Lo-Fi, Sky, Astrology) in "Themes". |
| Quick reaction | Themes ship a matching default reaction emoji (Love = heart). |
| Composer, send icon, call buttons, typing indicator | Tinted with the theme accent. |
| System message | "[User] changed the theme to [name]" with inline "Change Theme" link. |
| Word effects | Some themes animate on keywords. |
| Seasonal / animated | Halloween, Lunar New Year, IP tie-ins; Lo-Fi was commissioned and simplified "so it's easier on the eye in the background of a conversation" (https://www.adweek.com/media/messenger-how-to-use-the-lo-fi-chat-theme/). |
| Scope | Per conversation, shared, synced across all Meta surfaces. |

Teardowns of the gradient: CSS-Tricks (overlay + `mix-blend-mode: screen`, or fixed gradient
with white overlays, https://css-tricks.com/recreating-the-facebook-messenger-gradient-effect-with-css/);
ishadeed (messenger.com uses `background-attachment: fixed` on the container + hollow bubbles,
plus the 3-state grouped-bubble radius, https://ishadeed.com/article/facebook-messenger-chat-component/).

## B2. Telegram, WhatsApp, iMessage, Google Messages

Telegram wallpapers (https://core.telegram.org/api/wallpapers): pattern wallpaper = fill of
1-4 colors + a PNG or TGV (gzipped SVG) document that is "completely transparent, except for
the pattern itself which should be shades of black". `intensity` 0..100 overlays the pattern;
negative = dark mode, pattern inverts into an alpha mask revealing the gradient over black.
33 monochrome SVG patterns since 2019 so the client tints them
(https://telegram.org/blog/backgrounds-2-0). Animated backgrounds: 3-4 colors, gradient moves
on every sent message (https://telegram.org/blog/animated-backgrounds/). Chat Themes 2021:
8 themes, private chats, day + night variant each
(https://telegram.org/blog/chat-themes-interactive-emoji-read-receipts/).

Where the rendering lives (verified in source):

| Client | Gradient | Pattern | Shared bubble gradient |
|---|---|---|---|
| tweb (Web K) | `src/components/chat/gradientRenderer.ts`: 50x50 canvas, 8 base positions, per-pixel swirl weights, 90-step tail animation (https://github.com/morethanwords/tweb/blob/master/src/components/chat/gradientRenderer.ts) | `patternRenderer.ts`: tiled onto a canvas, mask mode via `destination-out` | None; solid `--message-out-background-color` |
| telegram-tt (Web A) | same algorithm on `.gradientCanvas` | `_patternBackground.module.scss`: `::after { background:#000; mix-blend-mode: soft-light; opacity: var(--pattern-intensity,.5); mask-image: url(pattern.svg); mask-repeat: repeat; mask-size: 26.875rem auto }` (https://github.com/Ajaxy/telegram-tt/blob/master/src/styles/_patternBackground.module.scss) | None |
| tdesktop | `ui/chat/chat_theme.cpp`: gradient + dithering, pattern composited SoftLight | same | Yes: `message_bubble.cpp` samples one `BubblePattern` pixmap against a viewport-relative rect |
| Telegram-iOS | `SoftwareGradientBackground.swift`, same 8 positions | `WallpaperBackgroundNode` | Yes: each bubble offsets one shared gradient by its absolute rect; animates on scroll/send |
| Android | `MotionBackgroundDrawable.java`, 8 phases, 500 ms (https://github.com/DrKLO/Telegram/blob/master/TMessagesProj/src/main/java/org/telegram/ui/Components/MotionBackgroundDrawable.java) | | `switchToNextPosition()` on send |

Standalone MIT port of the gradient algorithm with pattern + mask:
https://github.com/crashmax-dev/twallpaper (demo https://twallpaper.js.org/).

WhatsApp (Dec 2020): wallpaper per chat, separate light/dark collections, doodle overlay,
dim slider, per-user only (https://faq.whatsapp.com/663451201218981/).
iMessage iOS 26: per-conversation backgrounds (photo, color, dynamic, Image Playground),
shared with everyone in the conversation, iMessage-only
(https://support.apple.com/guide/iphone/add-backgrounds-iph605fa06e4/ios).
Google Messages 2024-2025: per-conversation color theme + wallpaper galleries, "only visible
to you" (https://support.google.com/messages/answer/14790371).

Scope models: Messenger, Instagram, iMessage = shared per conversation. WhatsApp, Google
Messages = per user. Telegram = hybrid.

## B3. Model for us

| | Shared per conversation (Messenger) | Per user (WhatsApp) |
|---|---|---|
| Social value in a 10-20 person team | High: "projekt X to zielony czat" for everyone | Low |
| Data model | 1 column on `conversations` | 1 column on `conversation_members` |
| Realtime | broadcast + system message | none |
| Conflict | last write wins; system message shows who | none |

Shared as v1. Keep the catalog shape so a per-user `conversation_members.wallpaper_id` can
be layered later.

Catalog (`src/chat/themes/catalog.ts`):

```ts
export type ChatTheme = {
  id: string;                       // 'lawenda'
  name: string;                     // Polish, picker + system message
  accent: string;                   // composer focus, send icon
  bubbleMine: { bg: string; gradient?: [string, string] | [string, string, string]; text: string };
  bubbleTheirs: { bg: string; text: string };
  background:
    | { kind: 'solid'; colors: [string] }
    | { kind: 'gradient'; colors: string[]; angle?: number }
    | { kind: 'pattern'; colors: [string]; asset: string; tile: number; opacity: number }   // asset = alpha mask
    | { kind: 'image'; colors: [string]; asset: string; dim: number };
  quickReaction: string;            // '💜'
  dark: Partial<Pick<ChatTheme, 'accent' | 'bubbleMine' | 'bubbleTheirs' | 'background'>>;
};
export const DEFAULT_THEME_ID = 'lawenda';
export const CHAT_THEMES: readonly ChatTheme[] = [/* ... */];
export const themeById = (id?: string | null) => CHAT_THEMES.find(t => t.id === id) ?? CHAT_THEMES[0];
```

Applying, scoped on the window root:

```ts
// useChatThemeVars(theme, isDark) -> React.CSSProperties
const t = isDark ? merge(theme, theme.dark) : theme;
return {
  '--chat-accent': t.accent,
  '--chat-bubble-mine-bg': t.bubbleMine.gradient
      ? `linear-gradient(160deg, ${t.bubbleMine.gradient.join(', ')})` : t.bubbleMine.bg,
  '--chat-bubble-mine-text': t.bubbleMine.text,
  '--chat-bubble-theirs-bg': t.bubbleTheirs.bg,
  '--chat-bubble-theirs-text': t.bubbleTheirs.text,
  '--chat-bg-color': t.background.colors[0],
  '--chat-bg-image': t.background.kind === 'image' ? `url(/chat-themes/${t.background.asset})` : 'none',
  '--chat-pattern-mask': t.background.kind === 'pattern' ? `url(/chat-themes/${t.background.asset})` : 'none',
  '--chat-pattern-opacity': t.background.kind === 'pattern' ? t.background.opacity : 0,
  '--chat-pattern-size': t.background.kind === 'pattern' ? `${t.background.tile}px` : 'auto',
} as React.CSSProperties;
```

```css
.n2chat-window { background: var(--chat-bg-color, var(--n2-surface)); position: relative; isolation: isolate; }
.n2chat-window::before {              /* pattern layer, Telegram Web A style */
  content: ''; position: absolute; inset: 0; z-index: -1; pointer-events: none;
  background-color: var(--chat-accent);
  opacity: var(--chat-pattern-opacity, 0);
  mask-image: var(--chat-pattern-mask); mask-repeat: repeat; mask-size: var(--chat-pattern-size) auto; mask-position: center;
  -webkit-mask-image: var(--chat-pattern-mask); -webkit-mask-repeat: repeat; -webkit-mask-size: var(--chat-pattern-size) auto;
}
.n2chat-bubble-msg { background: var(--chat-bubble-theirs-bg, var(--n2-surface-muted)); color: var(--chat-bubble-theirs-text, inherit); }
.n2chat-group.is-mine .n2chat-bubble-msg { background: var(--chat-bubble-mine-bg, var(--n2-violet)); color: var(--chat-bubble-mine-text, #fff); }
```

`var(x, fallback)` keeps today's look when no theme is set; the dark override resolves in JS
from the existing app theme flag.

WCAG AA for white text (https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio): every gradient
stop must have relative luminance <= 0.1833 (4.5:1). Check each stop, not the average.
Measured: `#7C3AED` 5.70 pass, `#6D28D9` 7.10, `#8B5CF6` 4.23 FAIL, `#A855F7` 3.96 FAIL,
`#6366F1` 4.47 borderline, `#DB2777` 4.60, `#2563EB` 5.17, `#047857` 5.48, `#C2410C` 5.18.
Add `scripts/check-chat-themes.ts` that fails when any `bubbleMine` stop < 4.5 against
`text`, any `bubbleTheirs` < 4.5, or timestamp text < 4.5 against `colors[0]` after dim.

Dark variants: same hue, lightness -10..20, saturation -10..20 (HSL), same gradient direction.
Images: `-dark.avif` or stronger dim (0.55 vs 0.25). Incoming bubble dark: `#241B3A` with
text `#EDE9FE` = 13.7:1.

## B4. Scroll-linked gradient for outgoing bubbles

| Technique | How | Problems |
|---|---|---|
| A. `background-attachment: fixed` per bubble | one CSS line | relative to the browser viewport, not the scroll container; iOS Safari "partial" through 26.6 (https://caniuse.com/background-attachment); repaint every frame; docked windows sit anywhere so the origin drifts |
| B. Overlay + `mix-blend-mode: screen` | black bubbles, gradient `::after` | blends images, emoji, GIFs, reaction pills, scrollbar |
| C. Hollow-bubble mask (messenger.com) | gradient on container, opaque everything else | kills illustrated backgrounds; most markup |
| D. One gradient, `background-size` = list viewport, `background-position` from a scroll-driven CSS var | what tdesktop and Telegram-iOS do natively | one passive scroll listener + rAF + per-bubble offset var |
| E. CSS scroll-driven animations (`animation-timeline: scroll(nearest)`) | no JS | Chrome 115+, Safari 26+, Firefox behind flag; `background-position` stays on main thread (https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll-driven_animations) |

Recommend D (E as progressive enhancement). Sketch:

```css
.n2chat-messages { --chat-scroll-y: 0px; --chat-viewport-h: 600px; }
.n2chat-group.is-mine .n2chat-bubble-msg {
  background-image: var(--chat-bubble-mine-bg);
  background-size: 100% var(--chat-viewport-h);
  background-repeat: no-repeat;
  background-position: 0 calc(var(--chat-scroll-y) - var(--bubble-top, 0px));
  will-change: background-position;
}
```

```ts
// useSharedBubbleGradient(scrollRef)
useEffect(() => {
  const el = scrollRef.current!; let raf = 0;
  const write = () => { raf = 0; el.style.setProperty('--chat-scroll-y', `${el.scrollTop}px`); };
  const onScroll = () => { if (!raf) raf = requestAnimationFrame(write); };
  el.addEventListener('scroll', onScroll, { passive: true });
  const ro = new ResizeObserver(([e]) => el.style.setProperty('--chat-viewport-h', `${e.contentRect.height}px`));
  ro.observe(el); write();
  return () => { el.removeEventListener('scroll', onScroll); ro.disconnect(); cancelAnimationFrame(raf); };
}, []);
```

`--bubble-top` per bubble: set on mount and on list resize, batch `offsetTop` reads in one
rAF before writes, never read in the scroll handler. Cheaper variant with no scroll listener:
`background-size: 100% var(--chat-content-h)` + `background-position: 0 calc(-1 * var(--bubble-top))`
(gradient scrolls with content, Telegram Web K style). Messenger's "fixed to viewport" look
needs the scroll var. Performance: passive listener, one rAF write per frame, custom-property
writes only (paint, no layout), `contain: paint` on bubbles, static gradient under
`prefers-reduced-motion`. GIF bubbles and media opt out (`.is-gif` uses solid `bubbleMine.bg`).

## B5. Asset pipeline with AI

(a) Seamless patterns

- Nano Banana 2 and GPT Image 2 respond to the literal word "seamless" but seamlessness is not
  guaranteed; always offset-check (https://sorceress.games/blog/ai-tileset-generator-game-ready-tilesets-from-a-prompt ,
  https://heymramit.medium.com/10-pro-nano-banana-tips-for-high-quality-asset-production-93c25b7385b2).
- Prompt anchors: "seamless", "tileable", "repeating pattern", "top-down", "flat vector",
  "single solid black on pure white", "no border, no frame, no vignette, pattern continues
  past all four edges", "even density, no focal point", "full repeat". Nano Banana follows
  ALL-CAPS MUST/NEVER rule lists well (https://minimaxir.com/2025/11/nano-banana-prompts/).
- Magnific: `images_generate` with `mode: "imagen-nano-banana-2-flash"`, `aspectRatio: "1:1"`,
  `resolution: "1k"`, `count: 4`. Output is opaque ("transparent background" is ignored);
  chain `images_remove_background` or threshold locally. `images_to_svg` traces to SVG;
  `images_generate_svg` is worth testing first for doodle patterns.
- Post-processing (ImageMagick):
  1. Offset check: `magick tile.png -roll +512+512 check.png`, inspect the cross seam
     (https://usage.imagemagick.org/warping/#roll).
  2. Fix a seam: Magnific `images_retouch` on the rolled image ("continue the pattern, remove
     the seam"), roll back.
  3. Alpha mask: `magick tile.png -colorspace gray -negate -alpha copy -channel A -threshold 60% +channel -fill black -colorize 100 mask.png`
     (black drawing on transparent, Telegram format), or trace via `images_to_svg` with
     `fill="#000"`. SVG under 30 KB, square `viewBox`, tile 400-500 px CSS.
  4. Mirror-tiling fallback (`magick tile.png \( +clone -flop \) +append \( +clone -flip \) -append`)
     always tiles but doubles the visible repeat; organic textures only.
- Tint in the app with `mask-image` + `background-color: var(--chat-accent)` at 0.06-0.10
  opacity on white (Telegram Web A uses soft-light black at 0.5).

(b) Illustrated backgrounds

- Generate one 2048x2048 master at `resolution: "2k"`, then `images_expand` to 16:9 and 9:16,
  or `object-fit: cover; object-position: center`. Keep detail away from edges, the bottom 20 %
  (composer) and top 15 % (header).
- AVIF primary, WebP fallback via `image-set()`; 80-150 KB for 1080x1920 at q50-60. Dim overlay
  `--chat-bg-dim` (0.2 light, 0.5 dark).
- Style: low contrast, few details, no text, no faces (Meta's own Lo-Fi brief).

(c) Hosting: `/public/chat-themes/` for v1 (versioned with the catalog, Vercel CDN hashed
caching, no storage RLS). Supabase Storage only for user uploads (v2).

(d) Manifest:

```
public/chat-themes/
  patterns/<id>.svg            # alpha mask, black on transparent, 512 viewBox
  images/<id>-light.avif       # 2048x2048 or 1080x1920
  images/<id>-dark.avif        # optional
  previews/<id>.svg            # 48x48 swatch for the picker, generated by script
```

`scripts/chat-themes-validate.ts` checks every referenced asset exists, is under budget, and
passes contrast.

## B6. Theme picker UX

Messenger: grid of circular swatches, live preview of the conversation, "Apply", sections
"Themes" and "Colors & gradients". Telegram: horizontal cards with two mini bubbles and a
day/night toggle.

Ours:

- Entry: conversation header overflow menu, item "Motyw czatu". Popover `role="dialog"`,
  `aria-labelledby`, focus trapped, Esc closes, focus returns to the trigger. Use the existing
  overlay primitive (`frontend-performance-and-primitives.md`).
- 4-column grid of 56 px swatch buttons: mini scene (background + two mini bubbles). Selected
  = 2 px `--n2-violet` ring + check icon (not color alone). `aria-label="Motyw Lawenda"`,
  `aria-pressed`.
- Apply on click (optimistic CSS var swap, `motion` crossfade 200 ms). Toast "Zmieniono motyw
  na Lawenda. Cofnij" for 6 s; undo calls the RPC with the previous id.
- Hover / focus previews the theme on the live window after 100 ms.
- System message rendered client-side from `meta`: "Kacper zmienił motyw na Lawenda"; verb
  form from the actor's profile gender if stored, otherwise neutral "Kacper: motyw zmieniony
  na Lawenda".
- Focus ring `outline: 2px solid var(--n2-violet); outline-offset: 2px`, arrow-key roving
  tabindex, `prefers-reduced-motion` disables crossfade and scroll gradient.

## B7. Realtime and persistence

Schema:

```sql
alter table n2click.conversations
  add column theme_id text not null default 'lawenda'
  check (char_length(theme_id) between 1 and 32 and theme_id ~ '^[a-z0-9-]+$');

alter table n2click.messages
  add column kind text not null default 'text' check (kind in ('text', 'system')),
  add column meta jsonb;
```

The catalog stays the only allowlist (a DB allowlist would need a migration per skin). Old
clients receiving an unknown `theme_id` fall back to the default.

System message: `messages.kind = 'system'` + `meta jsonb` beats a separate
`conversation_events` table (same list, ordering, pagination, unread logic, one Realtime
source). Keep `body` populated with a plain fallback for search and notifications. Note:
`messages.body` has a 1..4000 check and the existing insert stamps/broadcast trigger will fire
for system rows, which is what we want (the row reaches all members through the existing
INSERT broadcast). The message-send RPC/policy must keep `kind='text'` for user inserts;
only the theme RPC writes `kind='system'`.

RPC (adjusted to our columns: `author_id`, channel `chat:conv:<id>`):

```sql
create or replace function n2click.chat_set_theme(p_conversation_id uuid, p_theme_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if not app.is_conversation_member(p_conversation_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_theme_id !~ '^[a-z0-9-]{1,32}$' then raise exception 'bad theme id'; end if;

  update n2click.conversations set theme_id = p_theme_id
   where id = p_conversation_id and theme_id is distinct from p_theme_id;
  if not found then return; end if;   -- no-op: no message, no broadcast

  insert into n2click.messages (conversation_id, author_id, kind, body, meta)
  values (p_conversation_id, v_uid, 'system', 'Zmieniono motyw czatu',
          jsonb_build_object('type','theme_changed','theme_id',p_theme_id,'actor_id',v_uid));

  perform realtime.send(
    jsonb_build_object('conversationId', p_conversation_id, 'themeId', p_theme_id, 'actorId', v_uid),
    'theme_changed', 'chat:conv:' || p_conversation_id::text, true);
end $$;
revoke all on function n2click.chat_set_theme(uuid, text) from public;
grant execute on function n2click.chat_set_theme(uuid, text) to authenticated;
```

Client: one more handler `on('broadcast', { event: 'theme_changed' })` on the existing
channel patches the conversation cache; the system message arrives through the existing
INSERT broadcast. On (re)subscribe refetch `conversations.theme_id` (or rely on
`chat_overview()` returning it).

## B8. Effort estimate

| Step | Hours |
|---|---|
| Catalog types, 10 entries, CSS var plumbing, dark merge, fallbacks | 4-6 |
| Picker popover, swatch grid, live hover preview, undo toast, a11y | 8-10 |
| Migration (theme_id, kind, meta), RPC, broadcast handler, system message renderer | 4-6 |
| Shared scroll gradient (hook, ResizeObserver, reduced motion, dock + full window) | 4-6 (+2 iOS Safari QA) |
| Asset pipeline for the first 10 skins (prompts, 4 variants each, roll check, mask, AVIF, validate script) | 6-8 (3-4 per next 10) |
| Dark mode QA, contrast script, Chrome + Safari + iOS | 3-4 |
| Total v1 | ~30-40 |

## B9. Theme concepts (10)

All "mine" stops verified >= 4.5:1 for white text.

| id | Nazwa | Mine (gradient) | Theirs bg / text | Background | Quick |
|---|---|---|---|---|---|
| lawenda | Lawenda (domyślny) | #6D28D9 -> #7C3AED | #F3F0FA / #1A1523 | solid #FAFAFC; dark #0F0A1F, theirs #241B3A / #EDE9FE | 💜 |
| polnoc | Północ | #4C1D95 -> #5B21B6 | #241B3A / #EDE9FE | gradient #0F0A1F -> #1B1033 (dark-first; light #EEEAFB) | 🌙 |
| neon | Neon studio | #7C3AED -> #DB2777 | #1F1B2E / #F5F3FF | solid #0B0B12 + dot-grid pattern 8 % | 🔥 |
| mgla | Mgła | #4F46E5 -> #6D28D9 | #FFFFFF / #1E1B4B | gradient #EEF2FF -> #FAE8FF | ☁️ |
| glebia | Głębia | #1D4ED8 -> #7C3AED | #EFF4FF / #0F172A | solid #EFF6FF + wave pattern | 🌊 |
| las | Las | #047857 -> #0F766E | #ECFDF5 / #052E16 | solid #F0FDF4 + fern pattern | 🌿 |
| zachod | Zachód | #BE123C -> #C2410C | #FFF1F2 / #4C0519 | gradient #FFF1F2 -> #FFEDD5 | 🌅 |
| grafit | Grafit | #27272A -> #3F3F46 | #F4F4F5 / #18181B | solid #FAFAFA + fine dot grid 6 % | 👍 |
| konfetti | Konfetti | #7C3AED -> #2563EB | #FFFFFF / #1A1523 | white + confetti pattern violet 7 % | 🎉 |
| miod | Miód | #6D28D9 -> #B45309 | #FFFBEB / #451A03 | image: abstract honey-violet illustration, dim 0.25 (dark 0.55) | ✨ |

## B10. Example Nano Banana 2 prompts

Seamless patterns (Magnific `images_generate`, `mode: imagen-nano-banana-2-flash`,
`aspectRatio: 1:1`, `resolution: 1k`, `count: 4`):

1. `Seamless tileable repeating pattern of tiny hand-drawn fern leaves and small dots, flat vector line art, single solid black ink on a plain pure white background, even density, no focal point, full repeat. RULES: the pattern MUST continue past all four edges so the left edge matches the right edge and the top matches the bottom. NEVER add a border, frame, vignette, shadow, gradient, text or signature.`
2. `Seamless tileable pattern of minimal confetti: small rounded rectangles, circles and thin arcs scattered at random angles, flat vector, single solid black on pure white, sparse and airy, top-down, no perspective. MUST be a perfect full repeat with matching opposite edges. NEVER include text, borders or a central motif.`
3. `Seamless tileable doodle pattern for a chat wallpaper: tiny outlined chat bubbles, paper planes, coffee cups, cursors and sparkles, thin uniform 2px black line art on pure white, evenly spaced grid-like distribution, consistent scale. The tile MUST wrap on all four sides. NEVER add color, shading, frame or text.`

Illustrated backgrounds (`resolution: 2k`, `aspectRatio: 9:16`, then `images_expand` to 16:9):

4. `Soft abstract illustration for a messaging app background: slow flowing shapes in lavender, deep violet and warm honey tones, matte grainless gradients, very low contrast, large calm areas, no text, no people, no objects, no sharp edges. The centre and bottom third MUST stay quiet and uniform so text bubbles remain readable. NEVER use vignette, noise, glare or high saturation.`
5. `Minimal night skyline illustration in the style of a lo-fi study poster: flat silhouettes of rooftops and a window with a plant, deep violet and indigo palette, tiny stars, muted and desaturated, wide empty sky occupying the top 70% of the frame, no text, no characters, no logos. Keep detail small and low contrast so chat bubbles stay legible.`

## B11. Gotchas

- `background-attachment: fixed` is relative to the browser viewport, not the scroll container;
  iOS Safari still "partial". Do not build the effect on it.
- `mix-blend-mode` blends the scrollbar and any media inside bubbles.
- Gradient midpoints can be lighter than both stops in non-sRGB interpolation; declare
  `linear-gradient(in srgb, ...)` or check the midpoint. `#8B5CF6` and `#A855F7` fail AA.
- Unknown `theme_id` on old clients must fall back to default, never crash.
- No-op theme changes must not create a system message (`is distinct from`).
- `realtime.send` `is_private` must equal the client's `private: true`.
- Nano Banana 2 output is opaque; threshold or trace to get the alpha mask. Roll-check every tile.
- `mask-image` needs `-webkit-` for older Safari; a failed mask URL hides the layer (degrades
  to solid, fine).
- GIF bubbles and reaction pills should opt out of the shared gradient.
- Telegram's extracted SVG patterns have an unstated licence; generate our own.
- System rows in `messages`: every reader (`toChatMessage`, unread counters, last-message
  preview in the dock, search) must handle `kind='system'` explicitly.
