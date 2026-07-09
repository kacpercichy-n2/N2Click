# Handoff: Build the "Moja praca" (/my-work) employee work page

- **Package ID:** PKG-20260709c-my-work-page
- **Status:** ready
- **Tier:** developer
- **Model:** opus
- **Depends on:** none
- **Blast radius:** low — new page + new pure selectors + one NAV/route edit + a tiny seed addition. No reducer, storage, or migration changes. One mechanical extraction touches DashboardPage (behavior must stay identical).

## Goal

Add an employee-focused `/my-work` page ("Moja praca") with three sections —
Dzisiaj, Zasobnik (nierozplanowane), Alerty — and redirect `/` to `/my-work`
for `pracownik`-role users only. All derived data comes from selectors; no
schema change.

## Context the worker needs

- Relevant files:
  - `src/App.tsx` — `NAV` array, `Routes` (currently `/` → `/dashboard`), `*` fallback.
  - `src/pages/DashboardPage.tsx` — the "Zadania na dziś" card you will extract into a shared component.
  - `src/store/selectors.ts` — ALL derived reads live here. Existing: `todayAgendaForPerson`, `binEntriesForPerson`, `hoursForPersonOnDate`, `personCapacity`, `currentUser`, `activeStatuses`, `getProject`, `getClient`, `getStatus`.
  - `src/utils/time.ts` — `BIN_DATE`, `isBinEntry`, `formatMinutes`, `formatDuration`.
  - `src/utils/dates.ts` — `todayStr`, `weekDays`, `shiftWeek`, `formatShort`, `formatRowLabel`.
  - `src/store/permissions.ts` — roles are `administrator | pm | handlowiec | pracownik`. Everyone may VIEW every page except `/admin` (documented in the matrix header) — do NOT add a permission gate to `/my-work`.
  - `src/store/seed.ts` — seed people: Kasia (administrator, default login), Ola (pm), Marek (pracownik). Marek: t1 blocks Tue–Fri, t3 blocks Wed–Fri, Wednesday total 10h > 8h capacity. Only Ola currently has a bin entry.
  - `src/components/icons.ts` — lucide re-export pattern; `src/components/TaskModal.tsx` — `useOpenTask`.
  - `src/styles.css` — all styling; `--n2-*` tokens, `.dash-grid`/`.dash-card`, breakpoints 1180px/760px.
- Relevant docs: repo `CLAUDE.md` is PARTIALLY STALE (still describes the v4/isAdmin era). Trust the code. Keep its invariants that still hold: selectors-only reads, dates as `'yyyy-MM-dd'`, Polish UI, no new deps.
- Prior decisions (pinned by the architect — do not re-litigate):
  1. **Redirect:** `/` and the `*` fallback both go through one small `HomeRedirect` component: if `currentUser(state)?.accessRole === 'pracownik'` → `/my-work`, else (admin/pm/handlowiec, setup mode, unresolved user) → `/dashboard`.
  2. **Sidebar:** add `['/my-work', 'Moja praca', <icon>]` to `NAV` directly AFTER `'/dashboard'`, visible to ALL roles (consistent with "everyone views every page but /admin"). Icon: `ClipboardList` from lucide, exported via `src/components/icons.ts` following the existing pattern.
  3. **No blockers alert.** The data model has no blocker/dependency concept (verified) — Alerty simply omits it. Do NOT invent one.
  4. **No storage change.** `DATA_VERSION` stays 5; no migration; page is 100% derived state.
  5. **New derived reads are new PURE selectors in `src/store/selectors.ts`** (unit tests arrive in a follow-up package — you don't write them, but keep the selectors `Date.now`-free by taking `today`/date-range params).
  6. **CLAUDE.md:** minimal targeted edits only (new route, redirect rule, nav item, new selectors, seed tweak). Do NOT attempt a full rewrite of its stale parts — that is a separate pending package.

## Scope

### In scope

1. **New selectors** in `src/store/selectors.ts` (pure, exported, JSDoc):
   - `doneStatusId(state): string | undefined` — id of the LAST active status (extract the inline `activeStatuses(state).slice(-1)[0]?.id` from `todayAgendaForPerson` and reuse it there; behavior identical).
   - `overdueTasksForPerson(state, personId, today: DateStr): Task[]` — tasks the person is assigned to with `endDate < today` and `statusId !== doneStatusId(state)`, sorted by `endDate` asc then `title`.
   - `overloadedDatesForPersonInRange(state, personId, dates: DateStr[]): DateStr[]` — the subset of `dates` where `hoursForPersonOnDate(...) > personCapacity(...)` (strictly greater; bin rows can never match a real date).
   - `unplannedTasksForPerson(state, personId): Task[]` — tasks the person is assigned to, `statusId !== doneStatusId(state)`, and the person has ZERO workload rows for that task (neither dated nor bin), sorted by `endDate` asc then `title`.
   - `binTaskRowsForPerson(state, personId): Array<{ task: Task; hours: number }>` — group `binEntriesForPerson` by `taskId` (sum `plannedHours` defensively even though the invariant is one bin row per task+person), preserve the bin `sortIndex` order of each task's first entry, silently skip entries whose task no longer resolves.
2. **Extract shared component** `src/components/TodayAgenda.tsx` exporting `TodayAgendaList({ personId, date })`: move DashboardPage's "Zadania na dziś" list body (timed rows + dateless rows + the "Brak zadań na dziś — zajrzyj do kalendarza." empty state) into it; DashboardPage renders it inside its existing card. Dashboard output must be visually and behaviorally identical (same class names, same `openTask` clicks).
3. **New page** `src/pages/MyWorkPage.tsx` — Polish UI, `.page` + `.dash-grid`/`.dash-card` layout (reuse existing classes; add new CSS classes to `src/styles.css` only where needed, respecting the 1180/760 breakpoints and `prefers-reduced-motion`):
   - Head: `<h1>Moja praca</h1>` + today's date via `formatRowLabel(todayStr())`.
   - Card **"Dzisiaj"**: `TodayAgendaList` for the current user + today.
   - Card **"Zasobnik (nierozplanowane)"**: rows from `binTaskRowsForPerson` — task title, project → client meta, `formatDuration(hours)`, click opens the task via `useOpenTask`; footer link to `/calendar` labeled `Zaplanuj w kalendarzu →`; empty state `Zasobnik jest pusty.`
   - Card **"Alerty"** with three sub-groups (render a sub-group only when non-empty; danger tint via `--n2-danger` soft tokens):
     - `Po terminie`: `overdueTasksForPerson(state, me.id, today)` — row = task title + `do {formatShort(endDate)}`, click opens task.
     - `Przeciążone dni`: `overloadedDatesForPersonInRange` over the horizon `[...weekDays(today), ...weekDays(shiftWeek(today, 1))]` (current + next week) — row = `formatRowLabel(date)` + `zaplanowano {formatDuration(booked)} / {formatDuration(capacity)}`.
     - `Bez planu`: `unplannedTasksForPerson` — row = task title + project meta, click opens task.
     - All three empty → single line `Brak alertów.`
   - If no current user resolves (setup mode), render the same kind of friendly empty state DashboardPage uses (Polish, link to `/projects`).
4. **Routing + nav** in `src/App.tsx`: `HomeRedirect` for `/` and `*` (decision 1), `<Route path="/my-work" element={<MyWorkPage />} />`, NAV entry (decision 2), `ClipboardList` export in `src/components/icons.ts`.
5. **Seed tweak** in `src/store/seed.ts`: add `addBinWork(t3.id, marek.id, 2);` next to t3's workload lines (t3 dated total 9h + 2h bin = 11h ≤ 16h estimate — budget-safe) with a one-line comment, so the seeded `pracownik` demonstrably has Zasobnik content.
6. **Docs**: minimal `CLAUDE.md` additions per pinned decision 6.

### Out of scope

- Any reducer/AppStore, storage.ts, or migration change; any `types.ts` change.
- Permission-matrix changes; gating `/my-work` per role.
- Dashboard redesign — only the mechanical `TodayAgendaList` extraction.
- Blockers/dependencies concept; notifications; drag-planning from the bin on this page (the calendar owns that).
- Writing the new selector unit tests (follow-up package PKG-20260709c-my-work-selector-tests).
- Fixing CLAUDE.md's unrelated stale sections.

## Implementation notes

- RTK hook rewrites read commands — use the Read/Grep/Glob tools, not `cat`/`grep`.
- Follow DashboardPage's patterns exactly: `useStore`, selectors-only reads, `motion.div` card stagger is optional (plain divs are fine; if you animate, respect `prefers-reduced-motion` like the rest of styles.css).
- `todayAgendaForPerson` already excludes done tasks from its dateless list — reuse it untouched (apart from the `doneStatusId` refactor).
- Overlap between "Dzisiaj" here and the dashboard is intentional; the dashboard stays the default landing page for non-pracownik roles.
- Task rows should tolerate a missing project/client (`?? '—'`), same as DashboardPage.

## Acceptance criteria

- [ ] `npx tsc --noEmit` clean; `npm test` all green (baseline 195 — no existing test may break); `npm run build` succeeds.
- [ ] Fresh seed, log in as **Marek** (pracownik): visiting `/` lands on `/my-work`; "Dzisiaj" lists his blocks/tasks for today (on a seeded weekday it is non-empty); "Zasobnik (nierozplanowane)" shows a "Sprint poprawek do wydania" row with `2h`; "Alerty" shows the Wednesday overload row (`10h / 8h`) under `Przeciążone dni`.
- [ ] Log in as **Kasia** (administrator): `/` still lands on `/dashboard`; the sidebar shows "Moja praca"; opening `/my-work` renders her own data.
- [ ] Dashboard "Zadania na dziś" is unchanged in content, classes, and click behavior after the extraction.
- [ ] Clicking a task row on `/my-work` opens the TaskModal; the Zasobnik footer links to `/calendar`.
- [ ] All new UI strings are Polish; layout uses existing dark-theme tokens and collapses sensibly at 1180px/760px; no console errors/warnings.
- [ ] No change to `DATA_VERSION`, storage.ts, or types.ts.
- [ ] `CLAUDE.md` mentions the `/my-work` route, the pracownik `/` redirect, and the new selectors (minimal edit).

## Tests

- Command: `npx tsc --noEmit && npm test && npm run build`
- Expected: type-check clean, 195/195 existing tests pass (you add none; selector tests are the follow-up package), production build succeeds.

## Report back

Synthesized summary only: files changed (one line each), gate results, any deviation from the pinned decisions (there should be none without flagging it), and confirmation of the Marek/Kasia walkthrough. Log the block to `handoffs/RUN-STATE.md` → Worker log. No raw logs.
