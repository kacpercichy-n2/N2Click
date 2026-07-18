# UI, navigation and onboarding

## Boundaries

- `src/App.tsx` owns routing, shell-level overlays and current-user navigation.
  `src/main.tsx` hosts the data router (`createBrowserRouter`) that App's
  `useBlocker` dirty-navigation guard requires.
- `src/auth/` owns the login gate. Mode is decided once at startup (local vs
  Supabase). Local mode (no/invalid Supabase config) keeps the demo person-picker
  `src/pages/LoginPage.tsx` and the `currentUserId` gate. Supabase mode gates the
  whole shell behind a real `supabase.auth` session (`SessionProvider` + pure
  `session.ts` state machine): loading → email/password login → forced first-
  password change (`profiles.must_change_password`, pure `passwordChange.ts`,
  fail-open) → blocked (no local profile) → shell. A `/account` panel + nav link
  (Supabase mode only; local redirects to `/`) offers self-service password
  change. Identity association is by email only (planner data references local
  person ids). In Supabase mode the authenticated profile, department, access role
  and team visibility are READ from Supabase (RLS output is authoritative) via
  `src/supabase/OrgDataProvider.tsx` + pure `src/supabase/referenceData.ts`
  (`loadOrgSnapshot`, `effectiveAccessRole`); never from JWT/metadata. While that
  snapshot loads, on error, in local mode, or while impersonating, the local
  `Person` role is the fallback. Cloud statuses/service types/work categories are
  loaded and displayed (AccountPage `Profil w chmurze`, TeamPage cloud hierarchy,
  AdminPage `Słowniki w chmurze`), but the planner renders/mutates the LOCAL
  dictionaries: dictionary/status/people/savedFilter mutations deliberately stay
  local even though the eight planner entity families are mirrored to Supabase
  (see [state-and-persistence.md](state-and-persistence.md)); local `people` rows
  are never created or deleted by any cloud path. Local mode is byte-for-byte
  unchanged (no client created). Client-side permission checks remain UX gates;
  in supabase mode the security boundary is Supabase RLS. `SessionProvider` then
  `OrgDataProvider` wrap the router in `main.tsx`.
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
