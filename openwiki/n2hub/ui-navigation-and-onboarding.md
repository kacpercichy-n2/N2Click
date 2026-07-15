# UI, navigation and onboarding

## Boundaries

- `src/App.tsx` owns routing, shell-level overlays and current-user navigation.
  `src/main.tsx` hosts the data router (`createBrowserRouter`) that App's
  `useBlocker` dirty-navigation guard requires.
- `src/pages/` owns route-specific screens; `src/components/TaskModal.tsx` owns
  task editing and its allocation grid.
- `src/onboarding/catalog.ts` owns copy, roles and route mapping; components
  expose stable `data-tour` anchors only.
- `src/utils/dirtyRegistry.ts` and `src/utils/useSaveStatus.ts` support shared
  unsaved-edit and save-state behavior. The registry also holds the opt-in
  router navigation guard (scopes `task-modal`/`project-detail` plus a one-shot
  bypass) that App's `DirtyNavigationGuard` consults; only those two surfaces
  register, so other routes and forms never gain a global blocker.

## Rules that change work

- UI strings are Polish.
- Informational onboarding must not mutate business data. The explicitly named
  advanced calendar exercise is a live-plan exception: disclose that it changes
  real data and require confirmation before starting it. Do not change calendar
  pointer lifecycle while adding tours.
- Keep permission checks in `src/store/permissions.ts` / `useCan`; local-only
  permissions are UX, not a backend security boundary.
- Task/project editor changes must preserve save-state and persistence banners.
- For navigation work, distinguish clean navigation from discarding a dirty edit.
- Role homes are explicit: workers land on `/my-work`; other roles land on
  `/dashboard`. On mobile, a closed drawer is inert, and an open drawer contains
  keyboard focus until it closes and restores focus to its trigger.

## Start here for

Routes, modals, dirty-edit protection, accessibility, roles, onboarding,
global shell UI and view-specific UI changes.
