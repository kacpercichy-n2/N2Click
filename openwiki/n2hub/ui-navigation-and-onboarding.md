# UI, navigation and onboarding

## Boundaries

- `src/App.tsx` owns routing, shell-level overlays and current-user navigation.
- `src/pages/` owns route-specific screens; `src/components/TaskModal.tsx` owns
  task editing and its allocation grid.
- `src/onboarding/catalog.ts` owns copy, roles and route mapping; components
  expose stable `data-tour` anchors only.
- `src/utils/dirtyRegistry.ts` and `src/utils/useSaveStatus.ts` support shared
  unsaved-edit and save-state behavior.

## Rules that change work

- UI strings are Polish.
- Do not mutate business data from onboarding or change calendar pointer
  lifecycle while adding tours.
- Keep permission checks in `src/store/permissions.ts` / `useCan`; local-only
  permissions are UX, not a backend security boundary.
- Task/project editor changes must preserve save-state and persistence banners.
- For navigation work, distinguish clean navigation from discarding a dirty edit.

## Start here for

Routes, modals, dirty-edit protection, accessibility, roles, onboarding,
global shell UI and view-specific UI changes.
