# Handoff: Apply role permissions (can()) across navigation, pages and actions

- **Package ID:** PKG-20260708-permission-gating
- **Status:** ready
- **Tier:** developer
- **Model:** opus
- **Depends on:** PKG-20260708-auth-login-ui (login defines "the user"; also App.tsx file-conflict ordering)
- **Blast radius:** medium-high — touches most pages, but only ADDS gates; no data-layer change.

## Goal

Every mutating control in the UI is gated by the central `can()` map so each
role sees a coherent app: administrator = everything; PM = projects/tasks/
workload; handlowiec = clients/projects incl. paid; pracownik = own calendar
blocks, read-only elsewhere.

## Context the worker needs

- Relevant files: `src/store/permissions.ts` (THE source of truth for the
  matrix — read it first; do not re-derive rules), `src/store/selectors.ts`
  (`isAdminUser`, `currentUser`), `src/App.tsx` (nav), `src/pages/AdminPage.tsx`,
  `src/pages/ProjectsPage.tsx`, `src/pages/ProjectDetailPage.tsx`,
  `src/pages/KanbanPage.tsx`, `src/pages/TimelinePage.tsx`,
  `src/pages/TasksPage.tsx`, `src/components/TaskModal.tsx`,
  `src/components/WeekView.tsx`, `src/components/MonthView.tsx` (day drill only
  — likely untouched), `src/pages/WorkloadPage.tsx`, `src/pages/PeoplePage.tsx`,
  `src/pages/PersonProfilePage.tsx`, `src/components/Coin.tsx` (optional
  onToggle pattern), `src/components/CommentsPanel.tsx`.
- Conventions: CLAUDE.md. Polish strings; disabled controls get a `title`
  explaining why (one shared string: `Brak uprawnień`).
- Prior decisions (architect-settled):
  1. **UI-level enforcement only.** The reducer stays permissive — client-side
     roles are cosmetic until the API exists (comment this once, in
     permissions.ts, not per page).
  2. **Views:** every role sees every page EXCEPT `/admin` (nav hides it +
     the route redirects for non-admins — extend the existing AdminPage gate by
     switching it to `can(user,'admin.panel')`; `isAdminUser` remains as the
     wrapped implementation, either is acceptable as long as ONE path decides).
  3. **Hide creation forms; disable in-place controls.** Forms that create
     things (new project, new task button, new person, kanban quick-create,
     milestone add) are HIDDEN without permission; existing-object controls
     (coin, drag, inputs, save buttons) are DISABLED/read-only with the
     `Brak uprawnień` title, so the data stays visible.
  4. **Own-blocks rule (pracownik/handlowiec):** in WeekView, drag/resize/
     context menu are enabled when `can(user,'blocks.editAny')` OR
     (`can(user,'blocks.editOwn')` AND `entry.personId === state.currentUserId`).
     Same rule for bin cards. Non-editable blocks: no drag handlers, no context
     menu (plain click still opens the task read-only), cursor default.
  5. **TaskModal without `tasks.manage`:** fully read-only — all inputs +
     AllocationGrid disabled, save hidden; comments tab STAYS writable
     (`comments.add`). Pracownik does NOT get own-task status editing
     (documented decision — own influence is calendar blocks only).
  6. **Per-page gate map** (apply exactly; action names refer to permissions.ts):
     - App.tsx nav: hide `/admin` link without `admin.panel`.
     - ProjectsPage: "Nowy projekt" form hidden without `projects.manage`;
       coin toggle callback passed only with `projects.paid` (otherwise static
       coin); filters/presets ungated.
     - ProjectDetailPage: edit form + milestones + delete → `projects.manage`
       (disabled inputs / hidden add+delete); coin → `projects.paid`; comments
       ungated.
     - KanbanPage: card drag (draggable attr + drop dispatch) →
       `projects.manage`; quick-create box stays admin-only (existing
       `isAdminUser` behavior — now `admin.panel`); coin per `projects.paid`.
     - TimelinePage: project-bar drag/resize + milestone drag →
       `projects.manage`; task-bar drag/resize → `tasks.manage`; without
       permission bars render static (no pointer handlers).
     - TasksPage: "Nowe zadanie" hidden without `tasks.manage`; row click still
       opens the (read-only) modal.
     - TaskModal: decision 5.
     - WeekView + CalendarPage: decision 4; the right-click insert flow follows
       the same rule as the clicked block.
     - WorkloadPage: reassign control → `workload.reassign` (hidden without).
     - PeoplePage: add form + edit/delete → `people.manage` (hidden without);
       list/profiles viewable by all.
     - PersonProfilePage: profile edit form → `people.manage` OR own profile
       (own profile: editable subset arrives with PKG-20260708-profile-availability;
       for now gate the WHOLE existing edit form to `people.manage` OR self,
       and additionally disable the `Uprawnienia` select + capacity for
       non-`people.manage` users editing themselves). Password section keeps
       its own rule from the login package.
     - Dashboard, GlobalSearch, MonthView occupancy: read-only already — no
       gating.

## Scope

### In scope

- The gate map above; a small shared helper if useful (e.g.
  `useCan()` hook reading the store once per component) — keep it in
  `src/store/permissions.ts` or a tiny `src/store/useCan.ts`.
- `Brak uprawnień` titles on disabled controls.

### Out of scope

- Reducer-side enforcement, route-level guards beyond `/admin`.
- New profile fields / availability math (next package).
- Restyling; only add `disabled` states using existing patterns.
- Tests (permission matrix is unit-tested at the map level already; page
  wiring is human-walkthrough territory).

## Implementation notes

- Compute `user = currentUser(state)` + the needed booleans ONCE per page
  component, pass down as props — don't sprinkle `can()` in leaf loops.
- Kanban/Timeline/WeekView: gate by not attaching handlers (draggable={false},
  no onPointerDown) rather than checks inside the handlers — prevents
  half-started drags.
- Watch the zero-people setup mode: everything must remain allowed (`can`
  already handles it — just make sure pages call it with the right context).
- Verify per-role on the running dev server (5173): use the admin quick-switch
  (Kasia administrator / Ola pm / Marek pracownik) and log in as each; there is
  no seeded handlowiec — temporarily set one via the People form during
  verification.

## Acceptance criteria

- [ ] Administrator: UI identical to pre-gating (everything enabled).
- [ ] PM (Ola): can create/edit projects and tasks, drag kanban cards and
      timeline bars, drag any calendar block, reassign in workload; CANNOT
      toggle the coin, manage clients/people, see /admin, or use the
      quick-switch.
- [ ] Handlowiec: can create/edit projects and toggle the coin; tasks/TaskModal
      read-only (comments still work); calendar drag only on own blocks;
      no workload reassign, no /admin.
- [ ] Pracownik (Marek): read-only everywhere EXCEPT dragging/resizing/context-
      menu on his OWN calendar blocks (others' blocks inert); no creation forms
      anywhere; no /admin (nav link hidden AND direct URL redirects).
- [ ] Comments postable by every role on projects and tasks.
- [ ] Disabled controls show `Brak uprawnień`; nothing crashes when handlers
      are absent; zero-people setup mode unrestricted.
- [ ] Console clean while exercising all four roles.
- [ ] `npx tsc --noEmit` clean; `npm test` green; `npm run build` succeeds.

## Tests

- Command: `npx tsc --noEmit && npm test && npm run build`
- Expected: all green; no unit-test changes expected. Role walkthrough on the
  running dev server — enumerate in your report which criteria you verified in
  the browser.

## Report back

Synthesized summary only (files changed one-line each, per-role verification
notes, deviations). Append to `handoffs/RUN-STATE.md` under the current run's
Worker log.
