# N2ub Planner — agent handoff & project guide

Project-management + workload-planning tool for N2 Media. The **v2 feature expansion** (clients → projects → tasks, pipeline statuses, kanban, timeline, workload dashboard, admin panel, comments, paid coins — 2026-07) is complete and verified end-to-end on top of the deployed alpha (see `vercel.json`). This file is the single source of truth for any agent working on this codebase — read it fully before changing anything.

## What the app does

Core model: **Client → Project → Tasks → Time blocks**, with supporting models Statuses, Departments, Service types, People, Comments, Assignments, Milestones.

- **Dashboard** — pipeline counts, deadlines + milestones (14-day horizon, overdue flagged), paid/unpaid split, this week's overload warnings.
- **Projects** — list grouped by client with paid coin + status badge + filters (paid/unpaid, client, status); create form (can create a client inline); detail card edits all fields, toggles the coin, manages milestones, lists tasks, and hosts the comments/@mentions/activity panel.
- **Kanban** — PROJECT pipeline board. Columns = active statuses in pipeline order; dragging a card into a column dispatches `SET_PROJECT_STATUS`. Filters: paid + client. Admins get a quick-create box accepting the `/Status name` command form.
- **Timeline** — horizontal day axis (10 weeks, 26px/day, scrollable; sticky 240px label column). Project bars (status-colored, coin, overdue = danger tint) grouped by client, task bars beneath. Bars drag to move and edge-drag to resize (pointer events, day snapping). ◆ milestones drag. **Moving a task shifts its time blocks with it; resizing drops blocks outside the new period.** Moving a project moves only the project dates (tasks are moved individually — intentional).
- **Tasks + editor** — alpha behavior, plus required project select (`?project=<id>` pre-fills from the project card), status select, and a per-task discussion panel.
- **Calendar** — week/month with person filter. Week blocks are each person's ORDERED day schedule (`WorkloadEntry.sortIndex`) and show the project coin. **Right-click a block → "Add before / Add after"**: small form (task picker defaulting to the clicked block's task + hours) inserts a block at that position and pushes only that person's later blocks down; shows a live warning when the day would exceed the person's capacity; auto-assigns the person / extends the task period if needed to keep invariants.
- **People** — profiles: avatar (emoji, else initials on person color), first/last name, job title, department, daily capacity (per-person overload threshold), admin flag. Profile page (`/people/:id`) shows week load vs availability, projects, tasks, and edits the profile.
- **Workload** — weekly dashboard: per-person day cells, assigned vs available (capacity × workdays), load bar + %, overload day flags; filters by department (filters people) and client/service type (filters which hours are counted).
- **Admin** — statuses (create incl. `/name` quick command, rename, recolor, reorder ↑↓, archive/restore, delete only when unused), clients (delete cascades their projects behind confirm), departments, service types (deletes clear references).

**Users/permissions**: no auth. The header **"Acting as"** select sets `currentUserId` — it signs comments/activity and gates the admin panel via `person.isAdmin` (`isAdminUser` selector). With zero people the admin gate stays open (prevents lockout). v1→v2 migration makes the first person admin.

## Tech stack & commands

- Vite 5 + React 18 + TypeScript 5 (strict), react-router-dom 6, date-fns 3. Plain CSS — **no UI framework, no Tailwind**. No drag libraries: kanban uses native HTML5 DnD, timeline uses pointer events.
- `npm run dev` (port 5173, launch config in `.claude/launch.json` as `n2ub-dev`), `npx tsc --noEmit`, `npm run build`. All three must pass before you finish any change.
- No tests exist yet. Verification is typecheck + build + browser walkthrough (checklist below).

## Architecture (do not break these decisions)

- **No backend.** Persistence is localStorage under key `n2ub.data.v1` with a legacy fallback for `n2click.data.v1` (payload is versioned — currently `version: 3`), wrapped entirely in `src/store/storage.ts`, which also owns the **v1→v2 migration** (task `project` labels → real Projects under an "N2 Media" client; people name-split + capacity/admin defaults; workload `sortIndex` assignment). The planned extension path is swapping that one module for an API — never scatter direct localStorage calls into components.
- **State**: single Context + useReducer provider in `src/store/AppStore.tsx`. Every mutation is one reducer action; `SAVE_TASK` atomically rebuilds a task's assignments and workload entries (preserving existing blocks' day positions); `SAVE_PROJECT` can atomically create a client via `newClientName`. **Activity-log rows are appended inside the same action** (`withActivity`) so the log can't drift. State persists on every action.
- **All reads go through pure selectors** in `src/store/selectors.ts` so views can never disagree.
- **Dates are `'yyyy-MM-dd'` strings everywhere.** Parsed at local noon (`src/utils/dates.ts` → `parseDate`). Never store `Date` objects or ISO datetimes for calendar dates. (Comment/activity timestamps are ISO strings — those are fine.)
- **Weeks start Monday** throughout (`weekStartsOn: 1`).

## Data model & invariants (src/types.ts)

- `Client { id, name*, archived }` · `Department { id, name }` · `ServiceType { id, name }`
- `Status { id, name*, slug, color, order, archived }` — shared pipeline for projects AND tasks; defaults seeded: To do → Work in progress → Accept → Done.
- `Project { id, clientId, name*, description, statusId, paid, startDate, endDate, departmentId, serviceTypeId, createdAt, updatedAt }` — `paid` drives the gold/bronze coin.
- `Milestone { id, projectId, name, date }`
- `Task { id, projectId*, statusId, title*, description, startDate, endDate, estimatedHours|null, createdAt, updatedAt }`
- `Person { id, firstName*, lastName, name (derived display, kept in sync), email, role (job title), departmentId, avatar (emoji|''), capacity (h/day), isAdmin }`
- `TaskAssignment { id, taskId, personId }`
- `WorkloadEntry { id, taskId, personId, date, plannedHours, sortIndex }` — `sortIndex` orders blocks WITHIN one person's day (calendar insert before/after).
- `Comment { id, entityType: 'project'|'task', entityId, authorId, body, mentionIds, createdAt }` · `ActivityEvent { …, actorId, message, createdAt }`

Hard invariants:
1. **Hours exist only as explicit per-person per-day `WorkloadEntry` rows.** A task's/project's total is derived (`taskPlannedTotal` / `projectPlannedTotal`), never stored, and is NEVER auto-split among assignees.
2. Entries are stored only when `plannedHours > 0`; a missing entry means 0h. Zero-hour days still belong to the task period — the period is defined by `startDate`/`endDate`, not by which days have entries.
3. Overload = a person's total across ALL tasks on one date **> their daily `capacity`** (default 8h, `DEFAULT_CAPACITY` in storage; `personCapacity` selector). It's a warning (red tint/marker/⚠), it never blocks input.
4. Task period is capped at 92 days; hours are 0–24 in 0.5 steps; `endDate >= startDate`; title/name required. Every task belongs to an existing project; a workload entry's person is always assigned to its task, and its date is inside the task period (INSERT_BLOCK auto-assigns / extends the period to keep this true).
5. Deletes cascade behind `window.confirm`: task → assignments + entries + its comments/activity; person → assignments + entries; project → tasks + all of the above + milestones; client → its projects (full chain). Statuses are archive-first — delete is refused while referenced.
6. Person colors come from one shared helper `personColor(id)` (`src/utils/colors.ts`), assigned by stable list order (id-hashing collided; don't revert to it). Same color for a person in every view. Status colors live on the Status row; paid/unpaid uses the `Coin` component only.
7. `sortIndex` is contiguous per (person, date) — mutations that move blocks between days go through `reindexDays` in AppStore.

## File map

- `src/App.tsx` — router + header/nav + "Acting as" switcher. `src/main.tsx` — entry (BrowserRouter with v7 future flags — keep them).
- Pages: `DashboardPage`, `ProjectsPage` (also exports `PaidFilterToggle`), `ProjectDetailPage` (inner component keyed by project id so drafts reset), `KanbanPage`, `TimelinePage` (drag `Bar` + `MilestoneMark`), `TasksPage`, `TaskEditorPage`, `CalendarPage`, `PeoplePage`, `PersonProfilePage` (keyed like project detail), `WorkloadPage`, `AdminPage`.
- Components: `AllocationGrid` (rows = days, columns = assignees, per-person-capacity overload tinting), `WeekView` (ordered blocks + right-click insert context menu), `MonthView`, `PersonFilter`, `PersonChip`, `SampleBanner`, `Coin` (gold/bronze SVG, optional toggle button), `StatusBadge`, `Avatar`, `CommentsPanel` (comments/activity tabs, `parseMentions` matches `@First` / `@First Last`).
- `src/store/seed.ts` — sample data relative to today: 2 clients, 3 projects across the pipeline (paid + unpaid), 4 tasks, 3 people (Kasia = admin = default acting user), milestones, comments with an @mention, a zero-hour gap day, and an over-capacity day.
- `src/styles.css` — ALL styling (light theme, CSS variables; v2 additions appended at the bottom).

## ⚠️ Next major task: restyle to the N2 Media brand

The current UI is a neutral **light** theme. The target is the official N2 Media brand: **dark, violet/lavender, glassmorphism**. Two sources of truth, in this order:

### 1. Style guide CSS (in this repo): `n2media-agency-dashboard-style.css`

Authoritative token set and component patterns, observed from n2media.agency. Key facts:
- Brand colors: `#7000ff` violet, `#c496ff` lavender, `#1e1e1e` charcoal, cosmic dark gradient `#1c1c1c → #3c005e`, translucent white glass surfaces. `color-scheme: dark`.
- All tokens are prefixed `--n2-*` (colors, spacing `--n2-space-*`, radii `--n2-radius-*`, type scale `--n2-type-*`, shadows, glass blur, gradients). Fonts via Google Fonts import: Plus Jakarta Sans (sans), Inter (data/numbers, tabular-nums), Fragment Mono (labels/uppercase kickers), Orbitron (display/brand only).
- Ready-made component classes to map onto the app: `.n2-shell` (280px sidebar + main grid — good fit for the 9-item nav), `.n2-sidebar`, `.n2-topbar`, `.n2-nav-item` (pill nav), `.n2-card` / `.n2-card--compact` / `.n2-glass-card` / `.n2-ambient-card` (hero), `.n2-button--primary/soft/ghost` (pill, lavender primary), `.n2-chip` (with `aria-pressed` — person filter chips), `.n2-table` (min-width 760 + `.n2-table-wrap` scroll — AllocationGrid AND the workload table), `.n2-field`/`.n2-input`/`.n2-select`/`.n2-textarea`/`.n2-help` (forms), `.n2-status[data-tone]` (map pipeline status badges), `.n2-delta[data-tone]`, `.n2-progress` (workload load bars), `.n2-empty` (dashed empty states), `.n2-kicker`/`.n2-title`/`.n2-subtitle`.
- Semantic tones: success `#b9ff4d` (lime), info `#5bdcff`, warning `#ffc857`, danger `#ff4f72` (each with a `-soft` translucent bg). **Use `--n2-danger` for overload markers/tinting** instead of the current reds.
- Breakpoints: 1180px (sidebar collapses, nav becomes 4-col) and 760px (single column, horizontal-scroll nav). `prefers-reduced-motion` handled — keep it.

v2 surfaces that ALSO need dark-theme treatment: kanban columns/cards, timeline tracks (weekend stripes, today line, bars, milestone diamonds), context menu, comments panel, dashboard cards, coin contrast on dark, status colors legibility (statuses store their own hex — re-seed defaults with brand-compatible hues), month-cell occupancy shading (translucent lavender/violet instead of green tints). **Person colors must stay distinguishable on dark surfaces** — re-pick the palette in `src/utils/colors.ts` against `--n2-surface`, and check the danger tint is not confusable with a person color.

### 2. Figma: N2 Media design system (via the Figma MCP plugin)

The workspace has a Figma MCP connection (`plugin:figma:figma`) with access to the N2 Media Figma account and design system. **As of 2026-07-07 it still requires OAuth authorization** — a non-interactive session cannot complete it; the user must authorize via `/mcp` in an interactive `claude` session (or claude.ai connector settings). Before relying on it, check whether the Figma tools respond; if not, tell the user it needs authorizing and fall back to the CSS guide above (the CSS is derived from the same brand and is sufficient for implementation).

When Figma access works, follow the skill protocol strictly:
- Load the `figma:figma-use` skill BEFORE any `use_figma` call (mandatory prerequisite).
- Use `get_design_context` / library search to pull real component specs, variables, and styles from the N2 design system rather than guessing.
- For pushing app screens back to Figma, load `figma:figma-generate-design`; for building/updating the token library, `figma:figma-generate-library`.
- Where Figma tokens and `n2media-agency-dashboard-style.css` disagree, ask the user which wins; absent an answer, the CSS file in this repo wins because it ships.

## Manual test checklist (must still pass after any change)

1. Fresh load (empty localStorage) → sample banner; "Load sample data" seeds 2 clients / 3 projects / 4 tasks / 3 people around today; "Acting as" defaults to Kasia (admin).
2. **Migration**: a `version: 1` payload in localStorage loads without data loss — project labels become Projects under an "N2 Media" client, first person becomes admin, blocks get `sortIndex`.
3. Create task: title/project/status/estimate, Mon–Fri period, assign a person, enter 0/0/6/4/2 → grand total 12h; save. Reopen → values round-trip; edit a cell → total updates; save persists. Zero-hour days stay inside the task period.
4. Projects: filters (paid/unpaid, client, status) narrow the list; detail card saves edits; coin click toggles paid everywhere (list, kanban, timeline, week blocks, dashboard); milestone add/date-change/remove works.
5. Comments: posting signs as the acting user; `@First` renders highlighted and lands in `mentionIds`; activity tab records status/paid/reschedule/comment events.
6. Kanban: drag a card between columns → status changes and persists; `/New status` quick-create appends a column (admin only).
7. Timeline: project/task bars render grouped by client; dragging a task ±N days moves its blocks with it (gap days preserved); edge-resize changes one end; milestones drag; overdue projects tinted.
8. Calendar week: blocks per person in `sortIndex` order; right-click → Add before/after → hours form warns when over capacity → inserted block lands at the right position and pushes ONLY that person's later blocks; month view: occupancy shading, person dots, overload marker, day click drills into week; person filter applies to both views.
9. Workload: assigned vs available uses per-person capacity; overload cells flagged; department filter narrows people; client/service filters narrow counted hours.
10. Admin: gated for non-admins ("Acting as" someone without the flag); status reorder/archive/restore works; delete disabled while a status is referenced; clients/departments/service types CRUD (client delete cascade behind confirm).
11. People: add with all profile fields; profile page shows week load, projects, tasks; delete cascades (confirm).
12. Validation: empty title, end-before-start, and missing project all block save with inline errors.
13. Browser reload → everything persists. Console free of errors and warnings.

## Scope guardrails

Out of scope (intentionally, do not add without an explicit ask): backend/auth/multi-user sync, file attachments (comments mention "later" — still not built), notifications, billing/invoicing beyond the paid flag, timers/time tracking, task dependencies, automations, advanced reporting, deliverables layer, separate content calendar, free-form tag categories (tags are ONLY department/client/service type by design). The most valuable next functional step after the restyle is replacing `storage.ts` with a small API for shared team data.
