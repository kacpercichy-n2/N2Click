# Handoff: Ustawienia (nav rename + menu-order editor), sidebar footer redesign, full impersonation removal

- Package ID: PKG-20260722-settings-nav-cleanup
- Status: ready
- Tier: developer
- Depends on: none
- Risk: medium
- Codex review: required — store surgery (AppData field removal) + shell UI blast radius

## Goal

One coherent change set: (1) rename "Konto" → "Ustawienia" with a gear icon,
(2) give the settings page an interface section with a NEW sidebar menu-order
editor (it does not exist yet — the queue claim that it does is false) plus the
existing password change, (3) drop the duplicated "Mój profil" / "Profil w
chmurze" sections, (4) redesign the sidebar footer (avatar bubble → own profile
+ narrower "Wyloguj"), and (5) remove impersonation ("Występuj jako") from UI,
store, persistence and permissions entirely, keeping historical activity
attribution readable and cloud sync untouched.

## Wiki context

- `openwiki/n2hub/ui-navigation-and-onboarding.md`
- `openwiki/n2hub/state-and-persistence.md`

## Expected touchpoints

- `src/App.tsx` — NAV import + ordering, Ustawienia link, footer, banner/switcher removal
- `new: src/components/navItems.ts` — NAV_ITEMS moved out of App.tsx + pure `orderNavPaths`
- `new: src/components/navItems.test.ts`
- `src/components/icons.ts` — add `ShieldCheck` export
- `src/pages/AccountPage.tsx` — Ustawienia page: Interfejs section + password; remove Profil/CloudProfile
- `src/utils/uiPrefs.ts` — `navOrder?: string[]` pref
- `src/styles.css` — footer classes, remove `.acting-as` select + `.impersonation-banner` styles
- `src/types.ts` — remove `AppData.impersonatorId` (KEEP `ActivityEvent.impersonatorId?`)
- `src/store/AppStore.tsx` — remove IMPERSONATE/STOP_IMPERSONATION, simplify withActivity/DELETE_PERSON/retainIdentity/SET_CURRENT_USER/LOGIN/LOGOUT
- `src/store/selectors.ts` — remove `realUserId`/`realUser`/`isImpersonating`
- `src/store/permissions.ts` — remove `'users.impersonate'`
- `src/store/useCan.ts`, `src/pages/TeamPage.tsx` — drop impersonating plumbing
- `src/store/persistGate.ts` — drop `'impersonatorId'` from NON_MIRRORED_KEYS
- `src/store/storage.ts` — remove defaults + `sanitizeImpersonator`, strip legacy key on load
- `src/store/seed.ts`, `src/store/exportDryRun.ts`
- `src/supabase/referenceData.ts` — `effectiveAccessRole` loses the `impersonating` option
- `src/onboarding/OnboardingRoot.tsx` — remove `impersonating` prop
- `src/pages/AdminPage.tsx` — reword hint (line ~40)
- Tests: `src/store/blockActions.test.ts`, `activityAttribution.test.ts`,
  `commandValidation.test.ts`, `selectors.test.ts`, `permissions.test.ts`,
  `persistGate.test.ts`, `storage.test.ts`, `exportDryRun.test.ts`,
  `src/supabase/referenceData.test.ts`

## Invariants

- Invariant 6: any invalid/removed command must return the SAME state
  reference. After removal, dispatching `{ type: 'IMPERSONATE', … } as any` or
  `{ type: 'STOP_IMPERSONATION' } as any` must fall to the reducer default and
  preserve the reference.
- No DATA_VERSION bump (stays 7). Stripping a persisted `impersonatorId` is a
  deterministic repair (written back once); a clean v7 payload WITHOUT the key
  must not echo-write. A failed save must never report `Zapisano`.
- Cloud sync untouched: no Supabase migration; `cloudMirror.ts`,
  `plannerData.ts`, `dataImport.ts` and `CommentsPanel.tsx` keep reading/
  mapping `impersonator_id` for HISTORICAL rows. New activity rows always carry
  `impersonatorId: ''` (mirror maps '' → null as today).
- `npm test` fully green, including `teamScope.test.ts` and
  `profileEditPolicy.test.ts` WITHOUT edits to those two files (normal-login
  permission behavior must not change).
- Local mode planner behavior unchanged except: the Ustawienia link/route is
  now available in local mode (interface settings apply there).
- Browser script contract: the logout control stays a `<button>` with
  accessible name `Wyloguj` (scripts/browser-check-ui-keyboard.mjs clicks it).
- Dirty-navigation guard: avatar → profile navigation must go through React
  Router (`Link`), never `window.location`.
- All new user-facing strings in Polish.

## Scope — settled design decisions (implement exactly these)

### A. Nav rename + icons (item 1)

1. Add `ShieldCheck` to `src/components/icons.ts` exports. In the NAV list,
   `/admin` ("Administracja") switches from `Settings` to `ShieldCheck`.
2. The `/account` link (App.tsx ~389-401): label/title "Ustawienia", icon
   `Settings` (gear), rendered in BOTH modes (remove the
   `auth.mode === 'supabase'` gate around the link). It stays a separate
   NavLink pinned AFTER the reorderable NAV list (not part of the order
   editor). Route path stays `/account`; the route element no longer redirects
   in local mode (`<AccountPage />` always).
3. Remove the `KeyRound` import from App.tsx if now unused there (keep the
   icons.ts export — other modules may use it; check before deleting).
4. AccountPage `<h1>` becomes "Ustawienia".

### B. Menu-order editor (item 2)

1. `new: src/components/navItems.ts`: move the `NAV` const from App.tsx here
   as `export const NAV_ITEMS: Array<[string, string, LucideIcon]>` (same
   tuples, same order — this is the canonical default order). Also export a
   pure `orderNavPaths(defaultPaths: string[], saved: string[] | undefined):
   string[]`: saved paths first (only those present in defaultPaths, deduped),
   then all remaining defaults in default order; `undefined`/empty → default.
2. `src/utils/uiPrefs.ts`: add `navOrder?: string[]` to `UiPrefs`.
   `loadUiPrefs` sanitizes: key present only when the raw value is an array;
   keep only string entries; otherwise omit the key. `DEFAULT_PREFS` has no
   `navOrder` key.
3. App.tsx: `const [navOrder, setNavOrder] = useState(() =>
   loadUiPrefs().navOrder);` + an effect listening for the window event
   `'n2hub:nav-order-changed'` that reloads prefs into state (house pattern:
   see `'n2hub:open-tutorials'`). Render the sidebar NAV via `orderNavPaths`
   applied to `NAV_ITEMS` paths, keeping the existing `/admin` + `/team`
   permission filter at render.
4. AccountPage gains an "Interfejs" section (an `editor-section`, ABOVE
   "Zmiana hasła" — this block structure is the "future sections" answer;
   nothing more speculative). Subheading "Kolejność menu", hint: "Ustaw
   kolejność pozycji menu bocznego. Zmiana obowiązuje na tym urządzeniu."
   Rows = the nav items THIS user can see (same canAdmin/canTeam filter as the
   sidebar — reuse `can`/`canViewTeam` exactly as App.tsx does), in the
   currently effective order; each row: icon + label + up/down buttons
   (aria-labels "W górę"/"W dół", disabled at the ends). Below the list a
   "Przywróć domyślną kolejność" button (removes the `navOrder` key /sets
   undefined). Every click persists immediately via
   `updateUiPrefs`/functional patch storing the FULL visible-path order, then
   dispatches `window.dispatchEvent(new Event('n2hub:nav-order-changed'))`.
   No drag & drop (no drag library exists — do not add one).
5. "Zmiana hasła" section: keep as-is, but render it only when
   `mode === 'supabase'` (local mode now reaches this page and has no cloud
   password).

### C. Remove duplicated profile sections (item 3)

Delete from AccountPage: the "Profil" section with the "Mój profil" link
(lines ~52-61) and `CloudProfileSection` + `CloudProfileDetails` (~63,
116-179) plus their now-unused imports (`useOrgData`, `CloudProfile`,
`PROVISION_ROLE_LABELS`, `Link` if unused). Cloud sync/OrgDataProvider stays
untouched everywhere else.

### D. Sidebar footer (item 4)

1. Rename `.acting-as-wrap` → `.sidebar-user` and `.acting-as-collapsed` →
   `.sidebar-user-collapsed` (JSX + styles.css, including the
   `.sidebar-collapsed` media-query rules at styles.css ~4591-4597 — the
   collapsed rule that hid `.acting-as` now has nothing to hide and is
   deleted). Grep the whole repo for `acting-as` afterwards; only historic
   handoff docs may still mention it. Remove the `.acting-as` /
   `.acting-as-label` / `.acting-as select` style rules.
2. Expanded footer content: one flex row (gap `--n2-space-2`, top border as
   the old `.acting-as` had): an avatar `Link` to
   `/people/${currentUser.id}` (renders `<Avatar person={currentUser}
   size={32} />`, `title` and `aria-label` "Mój profil: {currentUser.name}",
   `onClick={() => setMenuOpen(false)}`) + the existing "Wyloguj" button with
   `flex: 1` instead of `width: 100%` (this is the "narrower" requirement).
   Render the avatar link only when `currentUser` exists; keep the whole
   footer behind the existing `state.people.length > 0` gate.
3. Collapsed (>1180 px) behavior: `.sidebar-user-collapsed` avatar button is
   REPURPOSED — it becomes the same profile link (no longer `expandSidebar`;
   the chevron toggle remains the only expand control). Same
   title/aria "Mój profil: {name}". Below it the "Wyloguj" button stays
   visible as today. In collapsed mode hide the expanded avatar row (mirror
   the old show/hide swap).
4. Delete the "Występuj jako" `<select>` block and the impersonation banner
   JSX (App.tsx ~432-484) and the `.impersonation-banner*` CSS (~680-710;
   PersistenceBanner CSS only mirrors its layout — do not touch
   `.persistence-banner`).

### E. Impersonation removal (item 5)

1. `src/types.ts`: delete `AppData.impersonatorId` (~463-466). KEEP
   `ActivityEvent.impersonatorId?` with a comment that it is a read-only
   historical attribution field (old rows/cloud column still display the real
   author); new rows are stamped `''`.
2. `src/store/AppStore.tsx`:
   - Remove the `IMPERSONATE` / `STOP_IMPERSONATION` action types and cases.
   - `withActivity` (~373-409): signature `as?: { actorId: string }`; always
     stamp `impersonatorId: ''` on new rows (keeps dedup compare and mirror
     parity; existing tests expect `''`).
   - `DELETE_PERSON` (~2003-2028): drop the interplay; deleting the current
     user clears `currentUserId` to `''` (pre-impersonation behavior).
   - `retainIdentity` (~2413-2417): returns `Pick<AppData, 'currentUserId'>`.
   - `SET_CURRENT_USER`/`LOGIN` (~3178-3243) and `LOGOUT` (~3280-3288): strip
     impersonation bookkeeping ONLY; preserve every other observable
     semantic — unknown personId → same reference; same-id re-select → no
     activity row; login row attribution unchanged.
3. `src/store/selectors.ts` (~976-993): delete `realUserId`, `realUser`,
   `isImpersonating`. App.tsx gate at ~313 becomes
   `if (state.currentUserId !== person.id) return <AuthLoading />;` and
   `actualUser`/`impersonating` locals disappear (use `currentUser`).
4. `src/store/permissions.ts`: remove `'users.impersonate'` from `PermAction`
   and the administrator set.
5. `src/supabase/referenceData.ts` (~265-270): `effectiveAccessRole(person,
   orgState, opts: { mode: AuthMode })` — remove the `impersonating` option
   and the early-return condition. Update callers: App.tsx (~193-196),
   `useCan.ts`, `TeamPage.tsx:66` (drop `isImpersonating` imports).
6. `src/store/persistGate.ts:43`: remove `'impersonatorId'`.
7. `src/store/storage.ts`: remove the `impersonatorId: ''` defaults (148,
   372) and `sanitizeImpersonator` (816-826); at BOTH former call sites
   (~1510, ~1574) strip a stray legacy key instead (destructure
   `{ impersonatorId: _legacy, ...rest }` on the loaded object so the runtime
   object matches `AppData`). Decision: a legacy mid-impersonation payload
   loads acting as its `currentUserId` (the acted-as identity) — the real
   session is re-asserted by SET_CURRENT_USER on login anyway.
8. `src/store/seed.ts` (~708) and `src/store/exportDryRun.ts` (17, 23, 35):
   drop the field (export payload simply no longer contains the key; keep
   passwordHash/currentUserId blanking).
9. `src/onboarding/OnboardingRoot.tsx`: remove the `impersonating` prop
   (175-231, ~394) and its conditions; App passes `owner={currentUser}`
   `viewer={currentUser}`.
10. `src/pages/AdminPage.tsx:40`: reword to "Zaloguj się na konto z
    uprawnieniami administratora, aby zarządzać statusami, klientami,
    działami i typami usług."
11. DO NOT touch: `src/supabase/cloudMirror.ts` (`e.impersonatorId ?? ''`
    keeps compiling against the optional ActivityEvent field),
    `plannerData.ts`, `dataImport.ts`, `CommentsPanel.tsx` historical display,
    `migrations/` (no DB change).

### F. Test updates (exact list; do not assume a test count)

- `blockActions.test.ts` (~2211-2297): replace the impersonation describe
  with: `{ type: 'IMPERSONATE', personId: 'p2' } as any` and
  `{ type: 'STOP_IMPERSONATION' } as any` return the SAME reference;
  DELETE_PERSON of the current user clears `currentUserId`; SET_CURRENT_USER
  and LOGOUT still resolve identity (no `impersonatorId` expectations).
- `activityAttribution.test.ts`: drop describes covering
  IMPERSONATE/STOP/dual-stamping/chains; keep and adapt: default stamping
  writes `impersonatorId: ''`, login/logout rows, dedup-collapse; fixture rows
  keeping `impersonatorId: ''` stay valid.
- `commandValidation.test.ts` (~526): LOGOUT test loses the impersonator
  seed/assert.
- `selectors.test.ts`: remove `realUser`/`realUserId`/`isImpersonating`
  imports and their tests.
- `permissions.test.ts`: remove the `'users.impersonate'` rows from the four
  expected matrices.
- `persistGate.test.ts`: remove/adjust cases that flip `impersonatorId`;
  `currentUserId` cases remain.
- `storage.test.ts` (~635-720 block + fixtures at ~1476): rewrite as:
  a legacy payload WITH `impersonatorId` (any value) loads with the key ABSENT
  (`'impersonatorId' in data === false`) and `currentUserId` preserved; a
  clean v7 payload without the key does not echo-write; loading stays
  idempotent.
- `exportDryRun.test.ts` (~155-174): assert the key is absent from the
  export payload instead of `''`.
- `referenceData.test.ts` (~240-263): calls become `{ mode }`; delete the
  `impersonating: true` fallback case; keep loading/error/local/no-profile
  fallbacks.
- `plannerData.test.ts`: expected green WITHOUT edits (read path kept).
- NEW `src/components/navItems.test.ts`: `orderNavPaths` — undefined/empty →
  default order; full permutation applied; unknown saved paths ignored; paths
  missing from saved order append in default order; duplicates deduped.

## Out of scope

- Any Supabase migration or change to cloud sync/mirror/hydration behavior.
- Removing the `impersonator_id` column or `ActivityEvent.impersonatorId?`.
- Drag & drop for the order editor; per-account (cloud) storage of nav order.
- Renaming the `/account` route path.
- Backend/auth/security semantics (client checks stay UX-only).

## Acceptance

- [ ] Sidebar and page header say "Ustawienia" with a gear icon; "Administracja"
      uses ShieldCheck (no duplicate gear); link + `/account` route work in
      BOTH modes (local mode shows only the Interfejs section).
- [ ] Menu-order editor reorders the sidebar immediately (same tab, no
      reload), persists per device in `n2hub.ui.v1`, resets to default, never
      shows entries the user cannot see, and new/unknown paths degrade to
      default order.
- [ ] "Mój profil" and "Profil w chmurze" sections are gone from Ustawienia;
      password change still works in supabase mode.
- [ ] Sidebar footer: avatar bubble (photo/emoji/initials via Avatar) sits next
      to a non-full-width "Wyloguj"; clicking the avatar (expanded AND
      collapsed variants) navigates to `/people/<own id>`; mobile drawer
      closes on that navigation; "Wyloguj" keeps its accessible name.
- [ ] No impersonation remains in `src/` outside historical-attribution
      read paths (`grep -ri impersonat src/` shows only ActivityEvent field,
      cloudMirror/plannerData/dataImport/CommentsPanel and comments about
      historical rows).
- [ ] `AppData` has no `impersonatorId`; legacy payloads load with the key
      stripped once; DATA_VERSION still 7; no echo-write on clean loads.
- [ ] `{type:'IMPERSONATE'} as any` / `{type:'STOP_IMPERSONATION'} as any`
      preserve the state reference (invariant 6).
- [ ] `teamScope.test.ts` and `profileEditPolicy.test.ts` pass unmodified.
- [ ] `npm test` fully green; `npm run build` green.

## Verification

- Worker (focused first):
  `npx vitest run src/components/navItems.test.ts src/store/blockActions.test.ts src/store/activityAttribution.test.ts src/store/commandValidation.test.ts src/store/selectors.test.ts src/store/permissions.test.ts src/store/persistGate.test.ts src/store/storage.test.ts src/store/exportDryRun.test.ts src/supabase/referenceData.test.ts src/supabase/plannerData.test.ts src/pages/teamScope.test.ts src/pages/profileEditPolicy.test.ts`
  then `npm test` and `npm run build`.
- Browser: `node scripts/browser-check-ui-keyboard.mjs` — it clicks "Wyloguj";
  run it because the footer DOM changes. No other browser scripts touch the
  changed surfaces.
- Scheduler owns final `npm run test:scheduler && npm test && npm run build`.

## Prior decisions

- Gear (`Settings`) goes to Ustawienia; Administracja takes `ShieldCheck`
  (new icons.ts export).
- Ustawienia visible in local mode; password section supabase-only; route
  stays `/account`.
- Nav order: device-local `UiPrefs.navOrder?: string[]` (paths) in
  `n2hub.ui.v1`; pure `orderNavPaths` in new `src/components/navItems.ts`;
  up/down buttons + reset, no drag; reactivity via
  `'n2hub:nav-order-changed'` window event; Ustawienia link pinned last, not
  reorderable.
- Collapsed avatar button navigates to own profile (no longer expands the
  sidebar); the chevron toggle is the only expand control.
- `AppData.impersonatorId` removed outright (strip-on-load repair, no version
  bump); `ActivityEvent.impersonatorId?` kept as historical read-only, new
  rows stamped `''`; no Supabase migration.
- Legacy mid-impersonation payloads resolve to their `currentUserId`.
