# UI, navigation and onboarding

## Boundaries

- `src/App.tsx` owns routing, shell-level overlays and current-user navigation.
  `src/main.tsx` hosts the data router (`createBrowserRouter`) that App's
  `useBlocker` dirty-navigation guard requires.
- The sidebar nav (`NAV` in `App.tsx`) is a fixed ordered list — Panel, Moja
  praca, Klienci, Projekty, Zadania, Kanban, Kalendarz, Oś czasu, Obciążenie,
  Zespół — ending with two gated entries: Konto (supabase mode only) and
  Ustawienia (renamed from „Administracja”; route stays `/admin`, permission
  `admin.panel`). `/zgloszenia` and `/team` are NOT in this list. Below the nav
  a pinned `.sidebar-footer` row holds the „Zgłoszenia” NavLink (visible to
  every role) next to the round icon-only „Pomoc i samouczki” button, which
  keeps the `.sidebar-help` class and `shell.help` tour anchor (dispatches
  `n2hub:open-tutorials`); the footer lives inside `#app-drawer`, so the mobile
  focus trap covers it. Collapsed rail stacks the footer to two 44px circles.
- `/team` (Struktura zespołu) is reached via the shared `src/pages/TeamTabs.tsx`
  tab bar (Pracownicy → `/people`, Struktura zespołu → `/team`) rendered on both
  the Zespół (`/people`) and `/team` pages, not from its own nav item. The
  Struktura tab and the whole tab bar render only when `canViewTeam` passes over
  the effective role (same recipe TeamPage uses); the „Zespół” nav link stays
  highlighted on `/people`, `/people/:id` and `/team`. Both routes keep their
  existing guards (`canTeam`, page-level `canViewTeam` redirect).
- `src/auth/` owns the login gate. Mode is decided once at startup (local vs
  Supabase). Local mode (no/invalid Supabase config) keeps the demo person-picker
  `src/pages/LoginPage.tsx` and the `currentUserId` gate. Supabase mode gates the
  whole shell behind a real `supabase.auth` session (`SessionProvider` + pure
  `session.ts` state machine): loading → email/password login → forced first-
  password change (`profiles.must_change_password`, pure `passwordChange.ts`,
  fail-open) → local-profile association → shell. Every ready org snapshot is
  merged into the local people list (`buildCloudPeoplePayload` in
  `supabase/referenceData.ts` → `MERGE_CLOUD_PEOPLE` dispatched from App):
  RLS-visible cloud profiles upsert local `Person` rows by email (new rows get
  the cloud profile UUID as id, so planner hydration maps them), cloud is the
  truth for profile fields incl. access role/capacity/work days/supervisor;
  local-only people are never deleted and local departmentId/passwordHash are
  kept. The blocked screen remains only for the edge case of
  a session without a cloud profile row. A `/account` panel + nav link
  (Supabase mode only; local redirects to `/`) offers self-service password
  change. Identity association is by email only (planner data references local
  person ids). In Supabase mode the authenticated profile, department, access role
  and team visibility are READ from Supabase (RLS output is authoritative) via
  `src/supabase/OrgDataProvider.tsx` + pure `src/supabase/referenceData.ts`
  (`loadOrgSnapshot`, `effectiveAccessRole`); never from JWT/metadata. While that
  snapshot loads, on error, in local mode, or while impersonating, the local
  `Person` role is the fallback. Cloud statuses/service types/work categories are
  loaded and displayed (AccountPage `Profil w chmurze`, TeamPage cloud hierarchy
  — incl. `profiles.supervisor_id` shown as `Przełożony:` and editable inline by
  a cloud administrator (server truth: RLS + profile-privileges trigger) —,
  AdminPage `Słowniki w chmurze`), but the planner still renders/mutates the LOCAL
  localStorage dictionaries until the data-write migration. Local mode is
  byte-for-byte unchanged (no client created). Client-side only; UX gate, not a
  security boundary. `SessionProvider` then `OrgDataProvider` wrap the router in
  `main.tsx`.
- The nav config (routes, labels, icons, shipped default order) lives in
  `src/components/navItems.ts` (`NAV`), imported by both `App.tsx` and the
  reorder editor. Each user can reorder the sidebar (↑/↓) per user PER BROWSER:
  the order is stored in `uiPrefs` as `navOrderByUser` (device-local
  `n2hub.ui.v1`, keyed by `realUserId`, so impersonation never overwrites it),
  parsed defensively (arrays of strings only). `src/utils/navOrder.ts`
  (`applyNavOrder`/`moveNavPath`, pure + unit-tested) is self-repairing: unknown
  or duplicate stored paths are dropped and missing defaults appended in default
  order, so no migration is ever needed. App applies the order BEFORE the gate
  filter (`canAdmin`, supabase-only Konto), so a stored order can never reveal a
  gated item. `src/components/NavOrderEditor.tsx` (section „Kolejność menu")
  mounts on both the Konto page (`/account`, every cloud user) and Ustawienia
  (`/admin`); it lists the user's VISIBLE items, moves a visible item by swapping
  with its nearest visible neighbour in the FULL stored order (hidden gated items
  keep their positions), persists via `updateNavOrderForUser` and fires a
  `n2hub:nav-order-changed` window event so App re-orders the live sidebar.
- `src/pages/` owns route-specific screens; `src/components/TaskModal.tsx` owns
  task editing and its allocation grid.
- Profile edit matrix (`src/pages/profileEditPolicy.ts`) gains an ADMIN-ONLY
  „Spółka” field (`companyId` in `ALL_FIELDS` only — nie self, nie manager),
  rendered as a select in PersonProfilePage next to „Dział”; parity with the
  server `app.protect_profile_privileges` trigger (spółka zawęża widoczność
  projektów w chmurze). AdminPage adds a „Spółki” CRUD section after „Działy”.
- `/zgloszenia` („Zgłoszenia”, `src/pages/TicketsPage.tsx`) jest widoczne dla
  KAŻDEJ roli — nie jest bramkowane jak `/admin`. Bez `tickets.manage` strona to
  wyłącznie skrzynka nadawcza (przycisk otwierający modal, ŻADNEJ listy — decyzja
  2026-07-21). Z `tickets.manage` (administrator): dwa tryby w segmentowanym
  przełączniku — „Zgłoś” (otwiera modal) i „Zgłoszone” (tabela z filtrami status +
  rodzaj, sort od najnowszych, rozwijany opis, inline status, usuwanie i eksport
  CSV; serializer: `src/pages/ticketsExport.ts`). `src/components/TicketModal.tsx`
  powiela wzorzec TaskModal: `?zgloszenie=new|<id>`, `useOpenTicket()`, montaż raz
  w App, klasy `.task-modal-*` i własny zakres strażnika nawigacji
  (`'ticket-modal'` w `dirtyRegistry.ts`).
- `/wydarzenia` („Wydarzenia”, ikona `CalendarClock`, w NAV po `/calendar`,
  `src/pages/EventsPage.tsx`) jest widoczne dla KAŻDEJ roli. Segmentowany
  przełącznik „Nadchodzące” (domyślny; `date >= dziś`) / „Minione”, sort po
  `(date, startMinutes)`; wiersz pokazuje datę, zakres godzin, tytuł, uczestników
  (albo „Ogólnofirmowe”), lokalizację, badge „Cykliczne: …" oraz link „Dołącz"
  renderowany jako `href` WYŁĄCZNIE gdy `normalizeProjectDocumentUrl` przepuści.
  Klik wiersza otwiera modal; „+ Dodaj wydarzenie" przy `events.manage`.
  `src/components/EventModal.tsx` powiela wzorzec TaskModal: `?wydarzenie=new|<id>`,
  `useOpenEvent()`, montaż raz w App, prefill rozłącznymi parametrami
  (`wydarzenieData`/`wydarzenieStart`/`wydarzenieOsoba` — celowo różne od
  `date`/`assignee` TaskModala), własny zakres strażnika nawigacji
  (`'event-modal'`, warunek `wydarzenieChanged` w `navGuardBlocks`). Zapis ręczny
  przyciskiem (bez auto-save). Prawy klik w pustą kolumnę WeekView oferuje
  „+ Dodaj spotkanie (HH:mm)" przy `events.manage` (obok „+ Dodaj zadanie").
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
