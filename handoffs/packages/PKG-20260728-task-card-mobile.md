# Handoff: Three-row mobile task card + details sheet (MO-10)

- Package ID: PKG-20260728-task-card-mobile
- Status: ready
- Tier: developer
- Depends on: none
- Risk: medium
- Codex review: conditional — review if the worker deviates from the settled
  sheet pattern or touches desktop card markup.

## Goal

On phones the TasksPage card stops wrapping titles into 4 lines next to pills:
it becomes a ~96 px three-row card — title (15 px, max 2 lines, full width) →
project path (12 px) → metadata row (status dot, planned hours, avatars).
The remaining pills move into a bottom details sheet. Desktop cards are
bit-identical.

## Wiki context

- `openwiki/n2hub/ui-navigation-and-onboarding.md` (overlay shell / bottom
  sheets section)

## Expected touchpoints

- `src/pages/TasksPage.tsx` — card render (~lines 349–412) + one page-level
  sheet
- `new: src/pages/taskCardMobile.ts` — tiny pure helpers (node env)
- `new: src/pages/taskCardMobile.test.ts`
- `src/styles.css` — NEW `.task-card-m-*` and `.task-details-sheet*` classes
  only; reuse the existing `.app-sheet-scrim` / `.app-sheet-handle` sheet
  skeleton (~line 6192)

## Invariants

- Desktop bit-identical: every existing `.task-card*` rule
  (`src/styles.css:903–995` and `6517–6612`) and the current desktop card JSX
  stay byte-identical. Mobile is a SEPARATE render branch gated by
  `useMediaQuery(MOBILE_NAV_QUERY)` (`src/utils/useMediaQuery.ts`) — TasksPage
  does not import it yet.
- Nested buttons are illegal HTML: the details-sheet trigger must be a SIBLING
  of `.task-card-main` (e.g. inside the `.card-actions` cluster, which is
  already always visible on mobile — styles.css:6632), never inside it.
- No `title` attributes; tooltips only via the shared `Tooltip`.
- Polish strings only. No reducer/store changes (invariant 6). No new runtime
  dependencies. Retirement mode untouched.

## Scope

1. **Pure `taskCardMobile.ts`** + test:
   - `visibleAssignees<T>(people: readonly T[], max = 3): { shown: T[]; extra: number }`
     — first `max` people, `extra` = remainder (for a „+N" chip).
   - `taskCardPath(clientName: string | undefined, projectName: string | undefined): string`
     — `„Klient / Projekt"`, project alone when no client, `'—'` when neither.
   - Tests: 0/3/5 people; all four path combinations.
2. **Mobile card branch** in TasksPage (`isMobileNav` from the hook; desktop
   branch is the EXACT current JSX):
   - `.task-card-main` (still the open-task button) contains three rows:
     - `.task-card-m-title` — `task.title`, `font-size: 15px`, 2-line clamp
       (`-webkit-line-clamp: 2`), full width;
     - `.task-card-m-project` — `taskCardPath(client?.name, project?.name)` as
       PLAIN 12 px muted text (the mono/uppercase `.project-badge` is exactly
       what overflowed — do not render it here);
     - `.task-card-m-meta` — status dot
       (`<span class="task-card-m-dot" style={{background: status.color}} aria-hidden>`
       plus an `sr-only` status name), `zaplanowano {formatDuration(planned)}`,
       and the avatar stack from `visibleAssignees` (Avatar size ~20, „+N" chip
       when `extra > 0`).
   - Pills NOT on the mobile card: StatusBadge (full pill), PlanningBadge,
     PriorityBadge, category, `.project-badge`, date range, checklist progress
     — these move to the sheet.
   - Trigger: mobile-only `IconButton` (label „Szczegóły zadania", any existing
     icon from `src/components/icons`; a `.link-btn` „Szczegóły" is an
     acceptable fallback) inside `.card-actions`, next to the existing delete
     button. Opens the sheet for that task.
3. **Details sheet** — ONE instance mounted at page level (state:
   `detailsTaskId: string | null`), built on `useOverlay` in the non-anchored
   bottom-sheet variant (`role="dialog"`, pattern: CalendarPage quick-jump
   sheet / App „Więcej"): Escape and outside click close, focus returns to the
   trigger. Content for the selected task: full `StatusBadge`,
   `PlanningBadge`, `PriorityBadge` (only when `priority !== 'normal'`),
   category name, `.project-badge` (with `Coin`), date range
   (`rangeLabel(startDate, endDate)`), checklist progress, planned/estimated
   hours; footer `btn primary` „Otwórz zadanie" → `openTask(id)` + close.
   Reuse `.app-sheet-scrim`/`.app-sheet-handle`; new `.task-details-sheet`
   class for the panel itself.
4. **CSS**: additive classes only; target ~96 px card height at 390 px wide;
   respect `env(safe-area-inset-bottom)` in the sheet like the existing sheets.

## Out of scope

- Kanban cards, project-detail task rows, dashboard rows — TasksPage list only.
- TaskModal / TaskFullPage (no details sheet exists there today and none is
  added there).
- Desktop card changes of any kind; delete flow; filters.

## Acceptance

- [ ] At 390 px a card shows exactly three rows (title ≤2 lines full-width,
      project path, metadata) and is ~96 px tall; no pill overflows the card.
- [ ] The details trigger opens a bottom sheet listing status, planning,
      priority (when not normal), category, project badge, range, checklist
      and hours; „Otwórz zadanie" opens the modal; Escape/outside click closes
      and focus returns to the trigger.
- [ ] Tapping the card body still opens the task modal (unchanged behavior).
- [ ] Desktop (>760 px) card DOM and all existing `.task-card*` CSS are
      byte-identical.
- [ ] `taskCardMobile.test.ts` green.

## Verification

- Worker: `npx vitest run src/pages/taskCardMobile.test.ts` then
  `npm run build`.
- Browser: none — no covered stability-sensitive interaction changes; release
  verification owns the matrix.
- Scheduler owns final `npm run test:scheduler && npm test && npm run build`.

## Prior decisions

- The sheet does NOT exist yet anywhere (checked TaskFullPage + overlay
  primitives) — it is created here on the existing `useOverlay` bottom-sheet
  pattern; no new primitive.
- Status on the card is a DOT + sr-only name; the full pill lives in the sheet.
- Project path on the card is plain text, never the mono/uppercase badge.
- Avatar cap = 3 + „+N".
