# N2Hub Planner — agent handoff & project guide

Project-management + workload-planning tool for N2 Media. Complete and verified end-to-end: the **v2 feature expansion** (clients → projects → tasks, pipeline statuses, kanban, timeline, workload dashboard, admin panel, comments, paid coins), the **N2 brand dark restyle**, the **Polish UI translation**, a follow-up UX batch (global search, saved filter presets, task modal, save-state indicator, timeline zoom, mobile nav), and **timed work blocks** in the calendar week view (2026-07-08). This file is the single source of truth for any agent working on this codebase — read it fully before changing anything. The whole interface is in **Polish**; keep new UI strings Polish.

## What the app does

Core model: **Client → Project → Tasks → Time blocks**, with supporting models Statuses, Departments, Service types, People, Comments, Assignments, Milestones.

- **Dashboard** — pipeline counts, deadlines + milestones (14-day horizon, overdue flagged), paid/unpaid split, this week's overload warnings.
- **Projects** — list grouped by client with paid coin + status badge + filters (paid/unpaid, client, status; savable as named presets via `FilterPresets`); create form (can create a client inline); detail card edits all fields, toggles the coin, manages milestones, lists tasks, and hosts the comments/@mentions/activity panel.
- **Kanban** — PROJECT pipeline board. Columns = active statuses in pipeline order; dragging a card into a column dispatches `SET_PROJECT_STATUS`. Filters: paid + client. Admins get a quick-create box accepting the `/Status name` command form.
- **Timeline** — horizontal day axis (10 weeks, scrollable, zoomable px-per-day via `ZOOM_LEVELS`; sticky label column). Project bars (status-colored, coin, overdue = danger tint) grouped by client, task bars beneath. Bars drag to move and edge-drag to resize (pointer events, day snapping). ◆ milestones drag. **Moving a task shifts its time blocks with it; resizing drops blocks outside the new period.** Moving a project moves only the project dates (tasks are moved individually — intentional).
- **Tasks** — list with filters (+ presets); the editor is `TaskModal` (the old TaskEditorPage folded into a modal): required project select, status select, estimate, `AllocationGrid` for per-person per-day hours, per-task discussion panel.
- **Calendar** — week/month with person filter. **The week view is a Google-Calendar-style timed grid**: left hour axis, day columns, blocks absolutely positioned by `WorkloadEntry.startMinutes` with height ∝ `plannedHours`, auto-scrolls to 7:00. Pointer-drag moves a block to another time and/or day; top/bottom edge-drag resizes in 15-min steps; a **same-person time overlap blocks the drop** (live danger tint, invalid drops revert; touching edges are fine). Cross-person overlaps in one day column pack side-by-side (`packDayBlocks`). Cross-day drops extend the task period when needed. **Right-click a block → "Dodaj przed / Dodaj po"**: small form (task picker defaulting to the clicked block's task + hours) ripple-inserts a block at the reference block's start/end, pushing only that person's overlapping later blocks down; warns live when the day would exceed capacity; auto-assigns the person / extends the task period to keep invariants. Month view: occupancy shading, person dots, overload markers, day click drills into week.
- **People** — profiles: avatar (emoji, else initials on person color), first/last name, job title, department, daily capacity (per-person overload threshold), admin flag. Profile page (`/people/:id`) shows week load vs availability, projects, tasks, and edits the profile.
- **Workload** — weekly dashboard: per-person day cells, assigned vs available (capacity × workdays), load bar + %, overload day flags; filters by department (filters people) and client/service type (filters which hours are counted).
- **Admin** — statuses (create incl. `/name` quick command, rename, recolor, reorder ↑↓, archive/restore, delete only when unused), clients (delete cascades their projects behind confirm), departments, service types (deletes clear references).
- **Global search** — `Ctrl/Cmd+K` (`GlobalSearch` in the sidebar) across projects/tasks/people/clients.

**Users/permissions**: no auth. The sidebar **"Występuj jako"** (acting as) select sets `currentUserId` — it signs comments/activity and gates the admin panel via `person.isAdmin` (`isAdminUser` selector). With zero people the admin gate stays open (prevents lockout). The v1→v2 migration makes the first person admin.

## Tech stack & commands

- Vite 5 + React 18 + TypeScript 5 (strict), react-router-dom 6, date-fns 3, vitest (dev). Plain CSS — **no UI framework, no Tailwind**. No drag libraries: kanban uses native HTML5 DnD; timeline and calendar week view use pointer events.
- `npm run dev` (port 5173, launch config in `.claude/launch.json` as `n2hub-dev`), `npx tsc --noEmit`, `npm test` (vitest, node env, `src/**/*.test.ts`), `npm run build`. All four must pass before you finish any change.
- Unit tests cover the pure time math (`src/utils/time.test.ts`), the block reducer actions (`src/store/blockActions.test.ts`), and the storage migration (`src/store/storage.test.ts`). UI behavior is still verified by browser walkthrough (checklist below).

## Architecture (do not break these decisions)

- **No backend.** Persistence is localStorage under key `n2hub.data.v1` with legacy fallbacks for `n2ub.data.v1` and `n2click.data.v1` (payload is versioned — currently `version: 4`), wrapped entirely in `src/store/storage.ts`, which owns all migrations: **v1→v2** (task `project` labels → real Projects under an "N2 Media" client; people name-split + capacity/admin defaults; workload `sortIndex` assignment) and **v3→v4** (`ensureStartMinutes` — idempotent pass run on every load that gives blocks missing/invalid `startMinutes` a sequential stack from 08:00 in `sortIndex` order, and snaps off-grid values). The planned extension path is swapping that one module for an API — never scatter direct localStorage calls into components.
- **State**: single Context + useReducer provider in `src/store/AppStore.tsx`. Every mutation is one reducer action; `SAVE_TASK` atomically rebuilds a task's assignments and workload entries (preserving existing blocks' day positions and start times); `SAVE_PROJECT` can atomically create a client via `newClientName`; `SET_BLOCK_TIME` moves/resizes one block (validates 15-min grid, day bounds, same-person collision, 92-day task cap — returns state unchanged on any violation). **Activity-log rows are appended inside the same action** (`withActivity`) so the log can't drift. State persists on every action.
- **All reads go through pure selectors** in `src/store/selectors.ts` so views can never disagree. Time math lives in the pure, dependency-free `src/utils/time.ts` (`MINUTE_STEP=15`, `HOURS_STEP=0.25`, `WORKDAY_START_MIN=480`, overlap/stacking/packing helpers) — reuse it, don't duplicate it.
- **Dates are `'yyyy-MM-dd'` strings everywhere.** Parsed at local noon (`src/utils/dates.ts` → `parseDate`). Never store `Date` objects or ISO datetimes for calendar dates. (Comment/activity timestamps are ISO strings — those are fine.) Time-of-day is **only** `WorkloadEntry.startMinutes` — never a datetime.
- **Weeks start Monday** throughout (`weekStartsOn: 1`).

## Data model & invariants (src/types.ts)

- `Client { id, name*, archived }` · `Department { id, name }` · `ServiceType { id, name }`
- `Status { id, name*, slug, color, order, archived }` — shared pipeline for projects AND tasks; defaults seeded: To do → Work in progress → Accept → Done (Polish names in seed).
- `Project { id, clientId, name*, description, statusId, paid, startDate, endDate, departmentId, serviceTypeId, createdAt, updatedAt }` — `paid` drives the gold/bronze coin.
- `Milestone { id, projectId, name, date }`
- `Task { id, projectId*, statusId, title*, description, startDate, endDate, estimatedHours|null, createdAt, updatedAt }`
- `Person { id, firstName*, lastName, name (derived display, kept in sync), email, role (job title), departmentId, avatar (emoji|''), capacity (h/day), isAdmin }`
- `TaskAssignment { id, taskId, personId }`
- `WorkloadEntry { id, taskId, personId, date, plannedHours, startMinutes, sortIndex }` — `startMinutes` = minutes from midnight (multiple of 15; block must fit inside 0–1440); `sortIndex` orders blocks WITHIN one person's day and **equals the rank by `startMinutes`**.
- `SavedFilter { id, name, page: 'projects'|'tasks', criteria }` — named filter presets.
- `Comment { id, entityType: 'project'|'task', entityId, authorId, body, mentionIds, createdAt }` · `ActivityEvent { …, actorId, message, createdAt }`

Hard invariants:
1. **Hours exist only as explicit per-person per-day `WorkloadEntry` rows.** A task's/project's total is derived (`taskPlannedTotal` / `projectPlannedTotal`), never stored, and is NEVER auto-split among assignees.
2. Entries are stored only when `plannedHours > 0`; a missing entry means 0h. Zero-hour days still belong to the task period — the period is defined by `startDate`/`endDate`, not by which days have entries.
3. Overload = a person's total across ALL tasks on one date **> their daily `capacity`** (default 8h, `DEFAULT_CAPACITY` in storage; `personCapacity` selector). It's a warning (danger tint/marker/⚠), it **never blocks input**. The only thing that *blocks* is a same-person time overlap, and only in the calendar drag/resize path (`SET_BLOCK_TIME`); editor hour edits may create overlaps, which the week view renders side-by-side.
4. Task period is capped at 92 days; hours are 0–24 in **0.25 steps** (`snapHours` — write paths snap silently); `startMinutes` is a multiple of 15 and the block fits within the day; `endDate >= startDate`; title/name required. Every task belongs to an existing project; a workload entry's person is always assigned to its task, and its date is inside the task period (INSERT_BLOCK and cross-day SET_BLOCK_TIME auto-assign / extend the period to keep this true).
5. Deletes cascade behind `window.confirm`: task → assignments + entries + its comments/activity; person → assignments + entries; project → tasks + all of the above + milestones; client → its projects (full chain). Statuses are archive-first — delete is refused while referenced.
6. Person colors come from one shared helper `personColor(id)` (`src/utils/colors.ts`), assigned by stable list order (id-hashing collided; don't revert to it). Same color for a person in every view. Status colors live on the Status row; paid/unpaid uses the `Coin` component only.
7. `sortIndex` is contiguous per (person, date) and equals time order — mutations that move blocks between days or times go through `reindexDays` in AppStore (it sorts by `(startMinutes, sortIndex)` before renumbering).

Known issue (pre-existing, needs a design decision before fixing): `SAVE_TASK`'s allocation rebuild is keyed by `personId|date`, so two blocks of the same task+person+day collapse into one when the task is saved through the editor. The timed calendar makes multi-block days likelier — if asked to fix, plan it as its own package (multi-cell support vs duplicate prevention).

## File map

- `src/App.tsx` — router + sidebar nav (with `GlobalSearch`, "Występuj jako" switcher, mobile hamburger) + `TaskModal` mount. `src/main.tsx` — entry (BrowserRouter with v7 future flags — keep them).
- Pages: `DashboardPage`, `ProjectsPage` (also exports `PaidFilterToggle`), `ProjectDetailPage` (inner component keyed by project id so drafts reset), `KanbanPage`, `TimelinePage` (drag `Bar` + `MilestoneMark`, zoom), `TasksPage`, `CalendarPage`, `PeoplePage`, `PersonProfilePage` (keyed like project detail), `WorkloadPage`, `AdminPage`. (There is no TaskEditorPage — the editor is `TaskModal`.)
- Components: `AllocationGrid` (rows = days, columns = assignees, per-person-capacity overload tinting, 0.25h inputs), `WeekView` (timed grid: hour axis, `TimedBlock` pointer drag/move/resize, collision tint, right-click insert context menu), `MonthView`, `TaskModal`, `GlobalSearch`, `FilterPresets`, `SaveStatus` (dirty/saved indicator), `PersonFilter`, `PersonChip`, `SampleBanner`, `Coin` (gold/bronze SVG, optional toggle button), `StatusBadge`, `Avatar`, `CommentsPanel` (comments/activity tabs, `parseMentions` matches `@First` / `@First Last`), `icons.ts`.
- `src/utils/time.ts` — ALL time-of-day math (steps, overlap, collision, stacking, packing). `src/utils/dates.ts` — calendar-date parsing/format. `src/utils/colors.ts` — person palette.
- `src/store/seed.ts` — sample data relative to today: 2 clients, 3 projects across the pipeline (paid + unpaid), 4 tasks, 3 people (Kasia = admin = default acting user), milestones, comments with an @mention, a zero-hour gap day, and an over-capacity day (Marek: 8:00–14:00 + 14:00–18:00). Blocks get realistic `startMinutes` via `nextFreeStart`.
- `src/styles.css` — ALL styling: **dark N2 Media brand theme** (violet `#7000ff` / lavender `#c496ff`, glass surfaces, `--n2-*` tokens; token reference in `n2media-agency-dashboard-style.css`). Use `--n2-danger` for overload/danger tints; semantic tones success/info/warning/danger each have a `-soft` translucent bg. Breakpoints 1180px / 760px; `prefers-reduced-motion` handled — keep it. The week grid sets `user-select: none` (selectable text hijacks pointer drags — don't remove it).

## Figma (optional design source)

The workspace has a Figma MCP connection (`plugin:figma:figma`) to the N2 Media design system. It may require OAuth (`/mcp` in an interactive session) — check whether the tools respond before relying on them; the shipped CSS tokens win over Figma when they disagree (absent an explicit user decision). Load `figma:figma-use` before any `use_figma` call; use `figma:figma-generate-design` / `figma:figma-generate-library` for pushing designs/tokens back.

## Manual test checklist (must still pass after any change)

1. Fresh load (empty localStorage) → sample banner; "Load sample data" seeds 2 clients / 3 projects / 4 tasks / 3 people around today; acting user defaults to Kasia (admin).
2. **Migration**: a `version: 1` payload loads without data loss (project labels → Projects under an "N2 Media" client, first person admin, blocks get `sortIndex`); a `version: 3` payload gets `startMinutes` stacked from 08:00 in `sortIndex` order. Loading is idempotent.
3. Create task (TaskModal): title/project/status/estimate, Mon–Fri period, assign a person, enter 0/0/6/4/2 → grand total 12h; save. Reopen → values round-trip; edit a cell → total updates; save persists. Zero-hour days stay inside the task period. Hours snap to 0.25 steps.
4. Projects: filters (paid/unpaid, client, status) narrow the list and can be saved/applied as presets; detail card saves edits; coin click toggles paid everywhere (list, kanban, timeline, week blocks, dashboard); milestone add/date-change/remove works.
5. Comments: posting signs as the acting user; `@First` renders highlighted and lands in `mentionIds`; activity tab records status/paid/reschedule/comment events (and block move/resize events).
6. Kanban: drag a card between columns → status changes and persists; `/New status` quick-create appends a column (admin only).
7. Timeline: project/task bars render grouped by client; zoom in/out; dragging a task ±N days moves its blocks with it (gap days preserved); edge-resize changes one end; milestones drag; overdue projects tinted.
8. Calendar week (timed grid): blocks render at their `startMinutes` with height ∝ hours; grid auto-scrolls to ~7:00; drag a block ±1h in the same day → snaps to 15-min grid and persists; drag onto the same person's other block → danger tint and revert on drop (touching edges allowed); drag to a free slot on another day → moves, day totals update, task period extends if needed; edge-resize top/bottom in 15-min steps updates hours; overlapping blocks pack side-by-side; two consecutive drags on one block both register (text-selection guard); right-click → Dodaj przed/po → warns when over capacity → inserted block lands adjacent to the clicked block and pushes only that person's overlapping later blocks; month view: occupancy shading, person dots, overload marker, day click drills into week; person filter applies to both views.
9. Workload: assigned vs available uses per-person capacity; overload cells flagged; department filter narrows people; client/service filters narrow counted hours.
10. Admin: gated for non-admins (acting as someone without the flag); status reorder/archive/restore works; delete disabled while a status is referenced; clients/departments/service types CRUD (client delete cascade behind confirm).
11. People: add with all profile fields; profile page shows week load, projects, tasks; delete cascades (confirm).
12. Validation: empty title, end-before-start, and missing project all block save with inline errors.
13. Browser reload → everything persists. `npm test` green. Console free of errors and warnings.

## Scope guardrails

Out of scope (intentionally, do not add without an explicit ask): backend/auth/multi-user sync, file attachments (comments mention "later" — still not built), notifications, billing/invoicing beyond the paid flag, timers/time tracking, task dependencies, automations, advanced reporting, deliverables layer, separate content calendar, free-form tag categories (tags are ONLY department/client/service type by design), keyboard-drag a11y for calendar blocks (known accepted gap). The most valuable next functional step is replacing `storage.ts` with a small API for shared team data.
