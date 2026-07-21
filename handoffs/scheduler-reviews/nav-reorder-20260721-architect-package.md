# Architect package: nav reorder, Zespół merge, sidebar footer (2026-07-21)

Branch: `review/nav-reorder-20260721` (worktree `N2click-worktrees/nav-reorder`).
Author: architect. Contains ONE implementation package (developer tier) plus a
feasibility analysis (NOT to be implemented in this run).

## Context read

- `CLAUDE.md`, `docs/workflow/HANDOFF-TEMPLATE.md`
- `openwiki/n2hub/ui-navigation-and-onboarding.md`
- `src/App.tsx` (NAV lines 86–101, nav render 369–404, routes 490–524, gates
  174–197: `canAdmin`, `canTeam` via `effectiveAccessRole` + `canViewTeam`)
- `src/pages/teamScope.ts` (`teamAccessForUser`, `canViewTeam` — pure, node-tested)
- `src/pages/TeamPage.tsx` (Lista/Struktura toggle, cloud hierarchy, provisioning,
  own `canViewTeam` redirect guard), `src/pages/TeamStructureTree.tsx` (shared,
  commit 899be28 email→local-id fix — must not regress)
- `src/pages/PeoplePage.tsx` (h1 "Zespół", `data-tour="people.capacity"`,
  `data-tour="people.list"`)
- `src/utils/uiPrefs.ts` (device-local localStorage `n2hub.ui.v1`;
  `sidebarCollapsed`, `onboardingByUser` keyed by user id)
- `src/styles.css` (`.app-nav*` 274–322, responsive 3960–4014, collapsed rail
  4016–4070+, `.sidebar-help` 4960–4988, reduced-motion 5253)
- `src/onboarding/catalog.ts` (`shell.nav`, `shell.help` anchors; `admin` module
  title "Administracja"; no step routes to `/team`)
- `scripts/browser-check-ui-keyboard.mjs` (drawer checks are label-agnostic),
  `scripts/browser-check-onboarding.mjs` (clicks `.sidebar-help` — class must survive)
- Grep: no unit test references nav labels/order; `teamScope.test.ts`,
  `profileEditPolicy.test.ts`, `uiPrefs.test.ts` are unaffected by this design.

## Decisions taken (with rationale)

### Point 2 — "Struktura zespołu" merges under "Zespół"

**Decision: keep both pages and both routes; remove the `/team` nav entry; add a
shared tab bar (new `src/pages/TeamTabs.tsx`) rendered on `/people` and `/team`;
highlight the "Zespół" nav link on both paths.**

- Tabs: `Pracownicy` → `/people` (everyone) and `Struktura zespołu` → `/team`
  (rendered only when the effective team gate passes). On `/team` the second tab
  is active; TeamPage keeps its internal Lista/Struktura toggle and ALL cloud
  provisioning / supervisor-edit UI untouched.
- Rationale: TeamPage is a thin presentation layer over `teamScope.ts` but
  carries supabase-mode branches (cloud hierarchy, provisioning form, inline
  supervisor edit) and the `TeamStructureTree` email→local-id mapping (899be28).
  Physically merging it into PeoplePage would be the highest-risk option for
  zero user value; link-tabs preserve every gate (`canViewTeam` redirect on the
  route AND on the page) and every behavior byte-for-byte.
- `/team` stays a working direct URL with its existing `canTeam ? <TeamPage /> :
  <Navigate to="/dashboard" />` route guard — no redirect stub needed.
- The tab gate is computed inside `TeamTabs` with the same recipe TeamPage
  already uses (`effectiveAccessRole(me, org.state, {mode, impersonating})` →
  `canViewTeam`), so workers on `/people` simply see no tab bar (page looks as
  today).

### Point 3 — sidebar footer row

**Decision: one `.sidebar-footer` flex row above `.acting-as-wrap`, containing a
pinned "Zgłoszenia" NavLink (leaves the scrollable nav list) and a round
icon-only "?" button that keeps class `sidebar-help`, `data-tour="shell.help"`
and an `aria-label`.**

- Keeping the `.sidebar-help` class and the `n2hub:open-tutorials` event means
  `scripts/browser-check-onboarding.mjs` (clicks `.sidebar-help`) and the
  `shell.help` tour step keep working unchanged.
- Collapsed rail (>1180px + `.sidebar-collapsed`): the row stacks vertically,
  both controls become centered 44px circles (same pattern as collapsed
  `.app-nav-link`), tickets label hidden. ≤1180px strip and ≤760px drawer: row
  stays horizontal with the visible "Zgłoszenia" label (the collapsed pref is
  ignored there today — preserve that). The footer lives inside `<aside
  id="app-drawer">`, so the mobile drawer focus trap picks it up automatically.
- The "?" behavior is exactly today's (dispatch event; no new drawer-close
  call). The Zgłoszenia link closes the mobile drawer like every nav link
  (`onClick={() => setMenuOpen(false)}`).

### Naming

- "Administracja" → "Ustawienia" is applied consistently to user-facing strings
  that name the panel (nav, AdminPage h1, tutorial module title, two in-app
  references), route stays `/admin`, permission stays `admin.panel`.

---

# Handoff: Reorder sidebar nav, fold Struktura zespołu under Zespół, add footer row

- Package ID: PKG-20260721-nav-reorder
- Status: ready
- Tier: developer
- Depends on: none
- Risk: medium (shell nav touches every screen; a11y drawer/collapsed variants)
- Codex review: conditional — request it only if App.tsx diff exceeds the plan
  (new state, changed drawer logic)

## Goal

New base nav order with renames, Zgłoszenia + help moved to a one-row sidebar
footer, and the team-structure area reachable as a tab of Zespół instead of a
separate nav item — with zero behavior change to permission gates, routes,
onboarding anchors and the mobile/collapsed sidebar variants.

## Wiki context

- `openwiki/n2hub/ui-navigation-and-onboarding.md`

## Expected touchpoints

- `src/App.tsx`
- `new: src/pages/TeamTabs.tsx`
- `src/pages/PeoplePage.tsx`
- `src/pages/TeamPage.tsx`
- `src/pages/AdminPage.tsx` (h1 ×2 → "Ustawienia")
- `src/pages/ProjectsPage.tsx` (link text "Administracja" → "Ustawienia", ~line 404)
- `src/pages/KanbanPage.tsx` (empty-hint "panel Administracja" → "panel Ustawienia", ~line 226)
- `src/onboarding/catalog.ts` (admin module `title: 'Administracja'` → `'Ustawienia'`, line 303 — id, roles, steps, anchors unchanged)
- `src/styles.css`

## Invariants

- Routes unchanged: `/admin`, `/team`, `/account`, `/zgloszenia`, `/people` all
  keep their paths and their existing route guards in `src/App.tsx`
  (`canAdmin`, `canTeam`, `auth.mode === 'supabase'`). No new routes.
- `src/pages/teamScope.ts`, `profileEditPolicy`, `TeamStructureTree.tsx` and all
  TeamPage cloud logic (provisioning, supervisor edit, email→local-id tree
  mapping from commit 899be28) are NOT modified.
- Onboarding `data-tour` anchors keep working: `shell.nav` stays on the `<nav>`,
  `shell.help` stays on the help button, `people.capacity`/`people.list` stay in
  PeoplePage. `.sidebar-help` class name survives (browser check and CSS hook).
- Zgłoszenia stays visible to EVERY role (never gated like `/admin`).
- Mobile drawer semantics unchanged: closed drawer inert/aria-hidden, open
  drawer traps focus (footer controls are inside `#app-drawer`, so no trap code
  changes), Escape closes, focus returns to hamburger.
- Local mode stays byte-for-byte free of `/account` (link only in supabase mode;
  route already redirects).
- All strings Polish.

## Scope

### 1. `src/App.tsx` — NAV array (exact target)

```ts
const NAV: Array<[string, string, LucideIcon]> = [
  ['/dashboard', 'Panel', LayoutDashboard],
  ['/my-work', 'Moja praca', ClipboardList],
  ['/clients', 'Klienci', Building2],
  ['/projects', 'Projekty', FolderKanban],
  ['/tasks', 'Zadania', ListChecks],
  ['/kanban', 'Kanban', Columns3],
  ['/calendar', 'Kalendarz', CalendarDays],
  ['/timeline', 'Oś czasu', GanttChart],
  ['/workload', 'Obciążenie', Gauge],
  ['/people', 'Zespół', Users],
  ['/account', 'Konto', KeyRound],
  ['/admin', 'Ustawienia', Settings],
];
```

- Filter becomes:
  `(to !== '/admin' || canAdmin) && (to !== '/account' || auth.mode === 'supabase')`.
  The `/team` entry and the `/zgloszenia` entry are REMOVED from NAV; the
  separate hard-coded `/account` NavLink block (current lines 382–394) is
  deleted (now in the map). Icon `KeyRound` moves into the array; `Network`
  import becomes unused — remove it (TS strict will flag it).
- "Zespół" active state: the `/people` NavLink must also render active on
  `/team` and `/people/:id`. In the map, for `to === '/people'` merge
  `location.pathname.startsWith('/team')` into the `navClass` result
  (`location` is already in scope). Do not change other links.

### 2. Sidebar footer row (App.tsx + styles.css)

Replace the current `.sidebar-help` button block (lines 396–404) with:

```tsx
<div className="sidebar-footer">
  <NavLink
    to="/zgloszenia"
    className={({ isActive }) => (isActive ? 'sidebar-tickets active' : 'sidebar-tickets')}
    title="Zgłoszenia"
    onClick={() => setMenuOpen(false)}
  >
    <Inbox size={18} aria-hidden className="nav-icon" />
    <span className="nav-label">Zgłoszenia</span>
  </NavLink>
  <button
    type="button"
    className="sidebar-help"
    data-tour="shell.help"
    aria-label="Pomoc i samouczki"
    title="Pomoc i samouczki"
    onClick={() => window.dispatchEvent(new Event('n2hub:open-tutorials'))}
  >
    <CircleHelp size={18} aria-hidden />
  </button>
</div>
```

CSS plan (`src/styles.css`):

- `.sidebar-footer { display: flex; align-items: center; gap: var(--n2-space-2); }`
- `.sidebar-tickets`: reuse the current `.sidebar-help` recipe (flex, gap,
  `min-height: 44px`, border `--n2-border`, radius `--n2-radius-md`, soft text,
  hover/focus-visible like `.sidebar-help`), plus `flex: 1` and an `.active`
  state matching `.app-nav-link.active` colors.
- `.sidebar-help` (base, ~line 4960): becomes icon-only round — fixed
  `width/height 44px`, `border-radius: 999px`, `justify-content: center`,
  `padding: 0`; keep hover/focus rules and the reduced-motion rule (line 5253).
  Delete the now-dead `.sidebar-collapsed .sidebar-help .nav-label` rule (4986);
  keep `.sidebar-collapsed .sidebar-help` centering.
- Collapsed rail (inside the existing `@media (min-width: 1181px)` block):
  `.sidebar-collapsed .sidebar-footer { flex-direction: column; }` and
  `.sidebar-collapsed .sidebar-tickets` → centered 44px circle, `.nav-label`
  hidden (mirror `.sidebar-collapsed .app-nav-link`).
- ≤1180px strip and ≤760px drawer: no overrides needed — row stays horizontal
  with visible label (verify visually; add drawer-width rules only if broken).

### 3. Zespół tabs (`new: src/pages/TeamTabs.tsx` + both pages)

- `TeamTabs({ active }: { active: 'people' | 'structure' })`: computes the gate
  exactly like TeamPage does today (`useStore` + `useAuth` + `useOrgData` +
  `effectiveAccessRole` + `isImpersonating` + `canViewTeam`). If the gate fails →
  return `null`. Otherwise render two `Link`s styled with the existing
  `.cal-view-toggle` / `.toggle-btn` classes (`aria-current="page"` on the
  active one, `role="group"` with `aria-label="Obszar zespołu"`):
  `Pracownicy` → `/people`, `Struktura zespołu` → `/team`.
- `PeoplePage`: render `<TeamTabs active="people" />` in the `page-head` next to
  the `h1>Zespół`. Nothing else changes.
- `TeamPage`: render `<TeamTabs active="structure" />` in its `page-head`
  (alongside the existing Lista/Struktura view toggle, which stays). Nothing
  else changes — including the top-of-page `canViewTeam` redirect.

### 4. Rename "Administracja" → "Ustawienia"

Touchpoints listed above. Route `/admin`, permission `admin.panel`, tutorial
module `id: 'admin'` and its `admin.*` anchors are unchanged; only the visible
strings move.

## Out of scope

- Any physical merge of PeoplePage/TeamPage logic; any change to
  `teamScope.ts`, `TeamStructureTree.tsx`, provisioning, supervisor editing.
- Per-user configurable nav order (feasibility analysis only — see below).
- New routes, redirects, or permission changes; onboarding copy rewrites beyond
  the one module title.
- Touching `storage.ts`, reducers, or planner data.

## Acceptance

- [ ] Sidebar order (admin, supabase mode): Panel, Moja praca, Klienci,
      Projekty, Zadania, Kanban, Kalendarz, Oś czasu, Obciążenie, Zespół,
      Konto, Ustawienia — then footer row: Zgłoszenia + "?".
- [ ] Non-admin: no "Ustawienia"; local mode: no "Konto"; worker: no
      Struktura tab on /people and /team still redirects to /dashboard.
- [ ] "Struktura zespołu" absent from the nav list; on `/people` (pm/admin) a
      `Pracownicy | Struktura zespołu` tab bar navigates to `/team` and back;
      `/team` still works as a direct URL with all Lista/Struktura + cloud
      provisioning UI intact; the "Zespół" nav link is highlighted on both.
- [ ] `/zgloszenia` reachable ONLY via the pinned footer button (all roles),
      button shows an active state on that route, drawer closes on tap.
- [ ] "?" button: round, icon-only, `aria-label="Pomoc i samouczki"`, class
      `sidebar-help`, `data-tour="shell.help"`, opens the tutorials panel as
      today in desktop, collapsed and mobile-drawer variants.
- [ ] Collapsed rail: footer stacks to two centered circles; ≤1180px and mobile
      drawer render the row horizontally with the tickets label.
- [ ] No occurrence of user-visible "Administracja" remains (AdminPage h1,
      ProjectsPage link, KanbanPage hint, tutorial title now "Ustawienia").
- [ ] `npm test` green (teamScope/profileEditPolicy/uiPrefs untouched);
      `npm run build` green (no unused imports, e.g. `Network`).

## Verification

- Worker: `npm test` then `npm run build`.
- Browser: `node scripts/browser-check-ui-keyboard.mjs` (drawer semantics —
  footer joined the drawer) and `node scripts/browser-check-onboarding.mjs`
  (`.sidebar-help` click still opens help). Engines as the scripts default.
- Scheduler owns final `npm run test:scheduler && npm test && npm run build`.

## Prior decisions

- Order fixed by operator, incl. Obciążenie directly after Oś czasu, Konto
  before Ustawienia; rename Administracja → Ustawienia (route `/admin` stays).
- Tabs-not-merge for Zespół/Struktura (architect, rationale above).
- Footer keeps `.sidebar-help` class + event to protect the browser check and
  tour anchor (architect).
- No wiki edit by the worker beyond the instruction below; final reviewer owns
  the wiki verdict.

### Wiki update instruction (for the end of a green run)

In `openwiki/n2hub/ui-navigation-and-onboarding.md`: (a) note that the sidebar
nav is a fixed ordered list ending with gated Konto/Ustawienia (renamed from
Administracja, route `/admin`), (b) note that `/zgloszenia` moved from the nav
list to a pinned sidebar-footer row shared with the round "Pomoc i samouczki"
button (`.sidebar-help`, `shell.help` anchor unchanged), and (c) note that
`/team` is reachable via the `Struktura zespołu` tab on the Zespół area
(`TeamTabs`, gate = `canViewTeam` over the effective role) instead of its own
nav item. Keep the rest of the page intact.

---

# Feasibility analysis: per-user configurable nav order (NOT in this run)

**Verdict: TAK — bezproblemowo, with one honesty caveat about "per-user".**

## Fit with the architecture

- `src/utils/uiPrefs.ts` is the designated (and only allowed, besides
  `storage.ts`) localStorage boundary for device-local UI chrome, and it already
  has the exact pattern needed: `onboardingByUser: Record<userId, …>` with
  defensive parsing and merge-updates. `storage.ts`/reducers stay untouched —
  nav order is chrome, not planner data, so it must NOT enter the versioned
  data model (no v7→v8 migration).
- NAV in `src/App.tsx` remains the single source of truth for routes, labels,
  icons and gates. The stored value is only a permutation:
  `orderedNav = storedRoutes.filter(inNAV) + NAV.filter(notStored)`. Gating
  (`canAdmin`, supabase-only Konto) is applied AFTER ordering, so a stored order
  can never resurrect a gated entry.

## Recommended storage shape

```ts
// uiPrefs.ts
navOrderByUser: Record<string, string[]> // realUserId → route paths, e.g. ['/tasks','/dashboard',…]
```

- Key by `realUserId` (impersonation must not switch or overwrite the admin's
  own order).
- Parse defensively like `onboardingByUser`: non-array or non-string entries →
  default order.

## Migration / stale data

Self-repairing by construction, no migration code needed: unknown/removed
routes are dropped at read time (filter against NAV), missing routes are
appended in default order, and renames don't matter because keys are route
paths (which are stable — e.g. "Ustawienia" still stores `/admin`). If a route
path is ever changed, add a one-line alias map in the reader.

## Honesty caveat (per-user vs per-browser)

"Per-user" today can only honestly mean "per user, per browser": uiPrefs is
device-local and there is no cloud preferences write path (the app is still
pre-data-write-migration; cloud writes are limited to specific profile fields).
True cross-device per-user order would need a `profiles`/`user_prefs` column +
RLS + write path — a separate cloud package, not a prerequisite. Recommendation:
ship device-local first and label it honestly in UI copy ("na tym urządzeniu").

## Editor placement

Operator asked for the editor in Ustawienia (`/admin`) — note this makes nav
reordering admin-only (the panel is behind `canAdmin`), and an admin would edit
only their OWN order. If every role should reorder their own nav, the editor
belongs on a non-gated surface (e.g. a small "Nawigacja" card on `/account` in
supabase mode plus a section reachable for local mode) — decide at package time.
Editor itself: a simple list with góra/dół buttons over the merged order, one
`updateUiPrefs` call per move; render preview optional.

## Edge cases

- Gated items (Konto, Ustawienia): store them in the order anyway; visibility
  filter runs after ordering, so an admin demoted to pm keeps a valid order.
- Zgłoszenia/help footer: NOT part of the orderable list (pinned by design).
- Multiple people on one browser (local mode): per-user keying handles it.
- Private browsing/quota: uiPrefs already fail-soft → default order.
- Onboarding `shell.nav` coachmark keeps working (anchor is the `<nav>`).

## Rough future package outline

1. `uiPrefs.ts`: add `navOrderByUser` + parser + `navOrderForUser` /
   `updateNavOrderForUser` helpers + unit tests (extend `uiPrefs.test.ts`).
2. Pure helper `orderedNav(stored: string[], nav: NavEntry[])` + tests (drop
   unknown, append missing, stable).
3. `App.tsx`: read order for `realUserId`, apply before the gate filter.
4. Editor UI (placement per decision above) with góra/dół buttons, Polish copy.
5. Wiki note in `ui-navigation-and-onboarding.md`.
   Tier: developer for 1–3, test-writer can own extra test scaffolding; low risk.
