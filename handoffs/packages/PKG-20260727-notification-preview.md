# Handoff: Notification row expands an inline preview instead of opening the editor

- Package ID: PKG-20260727-notification-preview
- Status: ready
- Tier: developer
- Depends on: none
- Risk: medium — bounded cross-component change (pure panel helper + Dashboard tile)
- Codex review: conditional — only if the worker expands context beyond the named
  touchpoints or the reviewer is unsure about the read/unread interaction

## Goal

Clicking a notification row on the Panel (Dashboard) must expand an inline
preview (kto / co / gdzie, plus the comment body for comment notifications)
WITHOUT opening the task editor. Opening the entity moves to an explicit
secondary action inside the expanded row.

## Wiki context

- `openwiki/n2hub/ui-navigation-and-onboarding.md` (Panel / Dashboard tiles)
- `openwiki/n2hub/state-and-persistence.md` (notifications collection, read state)

## Expected touchpoints

- `src/pages/dashboardPanels.ts` — `NotificationNames`, `NotificationEntry`,
  `notificationEntry` (~lines 18–65).
- `src/pages/DashboardPage.tsx` — notification mapping (~lines 176–195) and the
  notifications tile JSX (~lines 267–310).
- `src/styles.css` — additive rules near `.dash-notif-row` (~3677).
- `src/pages/dashboardPanels.test.ts` — extend.

## Invariants

1. The tile still renders only UNREAD notifications for the acting person, newest
   first, capped by `visibleNotifications` / `MAX_NOTIFICATIONS = 3`.
2. Expanding a row NEVER marks it read — the list is unread-only, so a read row
   would vanish mid-interaction.
3. The per-row `✓` button and the header `Oznacz wszystkie` keep their exact
   current dispatches and labels.
4. `notificationEntry` stays PURE: no store access, no React, names injected by
   the caller. Missing names still degrade to `Ktoś` / `—`.
5. Notifications stay cloud-authoritative and additive; no reducer, action,
   selector, migration or DATA_VERSION change.
6. All strings Polish; no new runtime dependency.

## Scope

### 1. Pure layer (`src/pages/dashboardPanels.ts`)

```ts
/** Rozwinięty podgląd wiersza powiadomienia (kto / co / gdzie [+ treść]). */
export interface NotificationPreview {
  who: string;    // aktor lub „Ktoś"
  what: string;   // czego dotyczy (tytuł zadania / nazwa projektu)
  where: string;  // projekt lub „—"
  /** Treść komentarza — tylko dla `project_comment`, gdy jest dostępna. */
  body?: string;
}
```

`NotificationNames` gains `commentBody: string` (empty = unknown/absent).

`NotificationEntry` gains:
- `preview: NotificationPreview` (always present);
- `openLabel?: string` — the secondary-action label, derived from `target`:
  `'Otwórz zadanie'` for `kind: 'task'`, `'Otwórz projekt'` for
  `kind: 'project'`, and `undefined` when there is no target (button hidden).

Per type:
- `task_assigned` — `who` = actor, `what` = task title, `where` = project name,
  no `body`.
- `project_comment` — `who` = actor, `what` = project name, `where` = project
  name, `body` = trimmed `commentBody` when non-empty, otherwise the key is
  OMITTED (never `undefined`, never an empty string).
- `bin_item` — `who` = actor, `what` = task title, `where` = project name,
  no `body`.

`title` and `when` keep their exact current strings — do not touch them.

### 2. Dashboard tile (`src/pages/DashboardPage.tsx`)

Mapping: resolve the comment body locally —
`const comment = n.payload.commentId ? state.comments.find((c) => c.id === n.payload.commentId) : undefined;`
and pass `commentBody: comment?.body ?? ''` into `notificationEntry`. Do not add
a selector; `state.comments` is already part of the page's store snapshot.

Row behavior:
- `const [expandedId, setExpandedId] = useState<string | null>(null);` (top-level
  hook, above the existing early returns — DashboardPage returns early for the
  "no acting user" case, so the hook must not sit after it).
- The main row button toggles: `setExpandedId((id) => (id === n.id ? null : n.id))`.
  It carries `aria-expanded={expandedId === n.id}` and
  `aria-controls={`notif-preview-${n.id}`}`. NOTHING is dispatched on toggle.
- When expanded, render a sibling `<div className="dash-notif-preview" id={...}>`
  containing three labelled lines — `Kto:` / `Co:` / `Gdzie:` — and, when
  `preview.body` exists, a `<p className="dash-notif-body">` with the comment
  body (plain text, no mention highlighting — out of scope).
- Below the preview, one secondary action rendered only when `openLabel` exists:
  `<button type="button" className="btn ghost dash-notif-openbtn">{n.openLabel}</button>`
  whose handler is the CURRENT `openNotification` body — mark read, then
  `openTask(taskId)` or `navigate('/projects/'+projectId)`.
- Only one row is expanded at a time; marking a row read removes it from the
  list and must leave no stale `expandedId` effect (comparing ids is enough —
  do not add an effect).

`openNotification` keeps its exact current implementation and is now called only
from the secondary button.

### 3. CSS (`src/styles.css`)

Additive rules near `.dash-notif-row` (~3677): `.dash-notif-preview` (indented
block, small font, muted labels, `white-space: pre-wrap` on the body),
`.dash-notif-body`, `.dash-notif-openbtn`. Do not modify existing rules.

### 4. Tests (`src/pages/dashboardPanels.test.ts`, extend)

- `project_comment` with a `commentBody` → `preview.body` equals the trimmed
  body; `openLabel === 'Otwórz projekt'`.
- `project_comment` with `commentBody: ''` → `'body' in entry.preview === false`.
- `task_assigned` → `preview.who/what/where` correct, no `body`,
  `openLabel === 'Otwórz zadanie'`.
- `bin_item` with an unknown actor → `preview.who === 'Ktoś'`; unknown project →
  `where === '—'`.
- Notification with an empty payload (no taskId/projectId) → `target` stays
  `undefined` AND `openLabel` is `undefined`.
- `title` / `when` assertions from the existing tests stay unchanged (update the
  `NotificationNames` fixtures for the new required `commentBody` field).

## Out of scope

- Any reducer/action/selector change, `MARK_NOTIFICATION_READ` semantics,
  `MARK_ALL_NOTIFICATIONS_READ`, cloud mirroring, `read_at`.
- `src/utils/notifications.ts` payload sanitization (`commentId` already carried).
- Showing READ notifications, a notifications history page, pagination, badges.
- Mention highlighting / `MentionBody` inside the preview.
- Email notifications, `notificationEvents.ts`.

## Acceptance

- [ ] Clicking a notification row expands a preview and opens NO modal and NO
      route; the row stays unread and stays in the list.
- [ ] The expanded preview shows kto / co / gdzie, plus the comment body for
      `project_comment` when a matching comment exists in state.
- [ ] `Otwórz zadanie` / `Otwórz projekt` marks read and opens the entity
      (exactly today's `openNotification` behavior).
- [ ] The per-row `✓` and `Oznacz wszystkie` behave exactly as before.
- [ ] A second click collapses the row; at most one row is expanded.
- [ ] `notificationEntry` remains pure and fully covered by
      `src/pages/dashboardPanels.test.ts`.

## Verification

- Worker: `npx vitest run src/pages/dashboardPanels.test.ts src/utils/notifications.test.ts src/supabase/notifications.test.ts`
- Browser: none — dashboard tiles have no pointer/drag lifecycle and no covered
  browser-check interaction changes.
- Scheduler owns final `npm run test:scheduler && npm test && npm run build`.

## Prior decisions

- Expanding does NOT mark read: the tile shows unread only, so auto-marking
  would make the row disappear the moment the user reads it.
- Opening from the secondary button KEEPS mark-as-read (today's behavior).
- The comment body is resolved on the page from `state.comments` by
  `payload.commentId` and injected into the pure builder — the builder never
  touches the store.
- Preview body renders as plain text; mention highlighting stays a comments-panel
  concern.
- Wiki: only if the Panel section of `ui-navigation-and-onboarding.md` states
  that clicking a notification opens the entity does that page go stale — the
  final reviewer/orchestrator owns that decision.
