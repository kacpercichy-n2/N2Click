# Run State — current tiered-workflow run

A durable, append-only log for the run in progress. Every tier updates it so the
**reviewer** and the architect's final eval can see the whole run at a glance
instead of reconstructing it from chat history and worker narratives. Keep it
boring and factual — it's a checklist, not prose.

---

## Run: 2026-07-08 — UX audit improvements + icon library adoption (N2Hub)

### Plan (architect)

- **Goal:** Six UX improvements (timeline zoom/filters/conflicts, actionable
  workload overload, explicit save states, global search + saved filters,
  mobile nav, card affordances) plus adoption of **lucide-react** (ISC, free,
  bundled, currentColor) with CSS micro-animations as the animated-icon
  approach. No theme changes; all invariants in CLAUDE.md hold.
- **Codebase note for reviewer:** CLAUDE.md is partially stale — the N2 dark
  restyle is ALREADY DONE (`--n2-*` tokens in styles.css), TaskEditorPage was
  replaced by `src/components/TaskModal.tsx`, the app shell already has a
  sidebar, `motion` is already a dependency, and the UI is in Polish. Packages
  reflect the real code, not the stale doc.
- **Icon decision:** lucide-react. lord-icon is freemium (disqualified);
  Lottie sets need a heavy runtime + murky per-asset licenses; useAnimations is
  MIT but ~60 icons (insufficient). Bootstrap Icons fallback unnecessary:
  Lucide's stroke SVGs + plain-CSS transitions deliver animated icons fully
  free, offline-bundled, color-agnostic via currentColor.
- **Packages** (execution order):
  1. `PKG-20260708-icons-foundation` — lucide-react + icons module + nav icons + CSS animations — tier: test-writer
  2. `PKG-20260708-timeline-zoom` — timeline zoom / range presets / owner+client filters / conflict ticks — tier: developer
  3. `PKG-20260708-save-states` — save status badge + dirty guards (TaskModal, ProjectDetailPage) — tier: developer
  4. `PKG-20260708-workload-resolution` — overload resolution panel + REASSIGN_ENTRY action — tier: developer
  5. `PKG-20260708-global-search` — Ctrl+K palette + searchAll selector + ?client= deep-link — tier: developer (depends: 1)
  6. `PKG-20260708-saved-filters` — TasksPage filters + saved presets in AppData — tier: developer (depends: 4, ordering only)
  7. `PKG-20260708-mobile-nav` — hamburger drawer ≤760px — tier: developer (depends: 1, 5)
  8. `PKG-20260708-card-affordances` — hover/chevron/quick actions on cards — tier: test-writer (depends: 1, 6)
- **Parallelism:** logically, 2 and 3 are parallel-safe with each other
  (disjoint files except styles.css appends). Everything else runs in the
  order above because of shared files (App.tsx: 1→5→7; AppStore.tsx: 4→6;
  ProjectsPage/TasksPage: 5→6→8). Recommended: run sequentially 1..8.
- **Open questions:** none — decisions pre-resolved in the packages (icon
  choice; "Zapisywanie…" rendered ≥350 ms over synchronous persistence; no
  DATA_VERSION bump for savedFilters; hamburger over bottom nav; in-app
  sidebar-nav away from a dirty ProjectDetailPage intentionally not blocked).

### Worker log

<!-- Append one block per worker completion. Newest at the bottom. -->
<!--
#### <timestamp> · <agent> · `PKG-…`

- **Changed:** `path/one` — <one line>; `path/two` — <one line>
- **Tests:** `<command>` → <pass/fail counts>
- **Still broken:** <or "nothing">
- **Next:** <hand to which tier / ready for review / done>
-->

#### 2026-07-08 · test-writer · `PKG-20260708-icons-foundation`

- **Changed:**
  - `package.json` / `package-lock.json` — added `lucide-react ^1.23.0` to `dependencies` (npm install, no CDN).
  - `src/components/icons.ts` (new) — sole module importing from `lucide-react`; re-exports the 26 icons named in the package plus the `LucideIcon` type (all 26 names exist directly in v1.23.0, no aliasing needed — `Columns3` and `GanttChart` are both present as-is).
  - `src/App.tsx` — `NAV` extended to `Array<[string, string, LucideIcon]>` with one icon per route per the package's mapping; nav render loop renders `<Icon size={18} aria-hidden className="nav-icon" />` before each label.
  - `src/styles.css` — appended `/* ---------- Icons ---------- */` section: `.app-nav-link { gap: var(--n2-space-3); }`, `.nav-icon { flex: 0 0 auto; }`, hover/active transform transitions on `.nav-icon`, plus generic `.icon-spin` / `.icon-pop` helper classes + keyframes for later packages. Did not duplicate the existing `prefers-reduced-motion` block.
- **Tests:** `npx tsc --noEmit` → 0 errors. `npm run build` → succeeds (vite build, 2529 modules, no warnings). Both run standalone and together, clean.
- **Deviation:** package's `ComponentType<{...}>` sketch for the NAV tuple's icon slot didn't structurally typecheck against Lucide's `ForwardRefExoticComponent` (propTypes variance on `size`); used the real `LucideIcon` type instead, re-exported from `icons.ts` so `App.tsx` still never imports from `lucide-react` directly. No other deviation from scope.
- **Still broken:** nothing. Manual `npm run dev` visual check at 3 breakpoints not performed (no browser in this environment) — reviewer/human should eyeball desktop/≤1180px/≤760px per acceptance criteria.
- **Next:** ready for review; unblocks `PKG-20260708-global-search`, `PKG-20260708-mobile-nav`, `PKG-20260708-card-affordances` (all depend on 1).

#### 2026-07-08 · developer · `PKG-20260708-timeline-zoom`

- **Changed:**
  - `src/store/selectors.ts` — added pure selector `conflictDatesForTask(state, taskId): DateStr[]` (dates where an assignee on THIS task exceeds their capacity; sorted, deduped).
  - `src/pages/TimelinePage.tsx` — replaced module consts `DAY_W`/`WEEKS` with page state `dayW` (14/26/40) + `weeks` (2/6/10/26); threaded `dayW` into `Bar`, `MilestoneMark`, `DayStripes` and all left/width/drag-snap math. Added header zoom buttons (`ZoomOut`/`ZoomIn` from `icons.ts`, `aria-label` Pomniejsz/Powiększ, disabled at ends). Added `.cal-toolbar`: week-range preset toggle (`.cal-view-toggle`/`.toggle-btn`), `PersonFilter` owner chips, and a client `<select>` (`aria-label="Filtruj po kliencie"`). Owner+client filtering done in a memoized `view` (keyed on ownerKey + tasks/assignments/workload/people) that also precomputes per-task conflict day offsets (relative to task start → range/drag independent). Task bars render `.timeline-conflict` danger ticks; bar `title` gains `⚠ konflikty: N dni`.
  - `src/styles.css` — appended `/* ---------- Timeline controls ---------- */`: `.timeline-zoom` button group + disabled state, `.timeline-conflict` tick (4px, `var(--n2-danger)`, `pointer-events: none`, full bar height).
- **Tests:** `npx tsc --noEmit` → 0 errors; `npm run build` → success (2529 modules, no warnings).
- **Deviations:** none material. Notes: conflict offsets computed as `diffDays(task.start, d)` instead of `(dayIdx(d) - taskStartIdx)` — algebraically identical but range-independent so the memo survives navigation/drag. Ticks span full bar height (bar has `overflow:hidden`, so out-of-range ticks are clipped naturally). When active filters hide every group, the timeline shows just the header row (no dedicated "nothing matches" empty state — not in package scope).
- **Still broken:** nothing. Manual browser walkthrough (checklist item 7 + conflict tick on sample over-capacity day) not executed — no browser in this environment; reviewer/human should eyeball zoom alignment + drag-by-N-columns at each zoom, preset ranges, filter composition, and the conflict tick.
- **Next:** ready for review.

#### 2026-07-08 · developer · `PKG-20260708-save-states`

- **Changed:**
  - `src/utils/useSaveStatus.ts` (new) — `useSaveStatus(dirty)` hook: returns `{ status, markSaved }`. Rest state is `dirty ? 'dirty' : 'clean'`; `markSaved()` overlays a transient `saving` (350 ms) → `saved` (2000 ms) → clear. Timers cleaned on unmount. Also registers a `beforeunload` prompt whenever `dirty`. Exports `SaveState` type.
  - `src/components/SaveStatus.tsx` (new) — presentational badge; renders nothing for `clean`; `dirty` → `Niezapisane zmiany` (`AlertTriangle`, warning tone), `saving` → `Zapisywanie…`, `saved` → `Zapisano` (`Check`, success tone). Icons from `src/components/icons.ts`. Classes `save-status save-status--{dirty,saving,saved}`.
  - `src/components/TaskModal.tsx` — `TaskModalShell` now owns dirty state (ref + state) reported up from `TaskEditor` via new `onDirtyChange` prop; `requestClose()` runs `window.confirm('Masz niezapisane zmiany. Zamknąć bez zapisywania?')` when dirty and is wired to all close paths (Escape, scrim/viewport click, ✕, and `TaskEditor`'s Anuluj via `onCancel`). Renders `<SaveStatus>` in the modal head (hidden on not-found). `useSaveStatus` lives in the shell (drives badge + beforeunload). `TaskEditor` computes `dirty` by comparing a stable `serializeDraft(...)` (assigneeIds sorted; allocations filtered `>0` then sorted) against a first-render snapshot ref; `handleSave` rebases the snapshot, clears dirty, calls `markSaved()` then `onSaved()` (no confirm on save).
  - `src/pages/ProjectDetailPage.tsx` — `dirty` computation hoisted above the mid-delete early return so `useSaveStatus(dirty)` can be called unconditionally; `save()` now calls `markSaved()`. `<SaveStatus>` shown in `page-head-actions`. "Wróć" converted from `<Link>` to a `<button>` that confirms (`'Masz niezapisane zmiany. Opuścić bez zapisywania?'`) when dirty then `navigate('/projects')`. Save-button row now renders when `dirty || status !== 'clean'` (button disabled when `!dirty`) so the transient badge has a home.
  - `src/styles.css` — appended `/* ---------- Save status ---------- */`: pill badge, mono font, per-tone colors from `--n2-warning(-soft)` / `--n2-success(-soft)` and a neutral saving tone.
- **Tests:** `npx tsc --noEmit` → 0 errors; `npm run build` → success (2531 modules, no warnings).
- **Deviations:** (1) Saved badge shows `Zapisano` + `Check` icon rather than the literal `Zapisano ✓` — the package's Depends note says to use the `Check`/`AlertTriangle` icons now that icons-foundation landed. (2) In TaskModal the modal closes on save, so `saving/saved` feedback is effectively instantaneous there (spec-acknowledged); `markSaved()` is still called per spec. `dirty` state remains only briefly and is torn down on unmount.
- **Still broken:** nothing. Accepted gap (per architect decision): sidebar/global nav away from a dirty ProjectDetailPage is NOT blocked — only "Wróć", modal close paths, and `beforeunload` are guarded. Manual browser walkthrough (checklist 3/4/12 + confirm dialogs + native reload prompt) not executed — no browser here; reviewer/human should eyeball.
- **Next:** ready for review.

#### 2026-07-08 · developer · `PKG-20260708-workload-resolution`

- **Changed:**
  - `src/store/AppStore.tsx` — added action `{ type: 'REASSIGN_ENTRY'; entryId; toPersonId }` + handler `reassignEntry`. No-op when the entry/target is missing or `toPersonId === entry.personId`. Moves the single `WorkloadEntry` to the target (same `date`/`plannedHours`), computing its `sortIndex` = `nextSortIndex` against the workload WITHOUT the moved entry, then `reindexDays` over both affected day keys (source and target `person|date`). Ensures a `TaskAssignment` exists for (task, target) — creates if missing, never removes the source's. Activity on the task: `przeniósł/przeniosła blok {h}h ({date}) z {from} na {to}` via `withActivity`.
  - `src/pages/WorkloadPage.tsx` — added `selected: {personId,date}|null` page state. Non-empty day cells are now `role="button"`, focusable, `cursor:pointer`, `aria-expanded`, Enter/Space + click toggle selection (empty cells stay inert). Renders a `workload-detail-row` `<tr colSpan={days.length+4}>` under the selected person: danger-aware header `„{name} — {label}: {X}h / {cap}h”` (X = `hoursForPersonOnDate`, all blocks ignoring filters) + ✕ close, an optional hint `Wszystkie bloki tego dnia, niezależnie od filtrów.` when a client/service filter is active, then one `BlockRow` per block from `blocksForPersonDate` (sortIndex order): task title, project · client, `{h}h`, a person `<select>` (all people except the row's, label `{name} — {cur}h/{cap}h tego dnia` + `⚠` when the move would exceed target capacity) → `Przenieś` (dispatch `REASSIGN_ENTRY`), `Otwórz zadanie` (`openTask`), and `Przesuń całe zadanie: −1/+1 dzień` (dispatch `MOVE_TASK`). A `useEffect` closes the selection when the day becomes empty. Panel derives from store state so it reflects every dispatch immediately.
  - `src/styles.css` — appended `/* ---------- Workload resolution ---------- */`: clickable/selected cell affordances, detail-row surface (`--n2-surface-muted`), `.wr-panel/.wr-head/.wr-title(.over → --n2-danger)/.wr-close/.wr-hint/.wr-blocks/.wr-block/...`, plus a `.btn.ghost.small` helper.
- **Tests:** `npx tsc --noEmit && npm run build` → both green (2531 modules, no warnings).
- **Deviations:** none. Used icons `ArrowRightLeft`, `ChevronLeft`, `ChevronRight`, `X` from `src/components/icons.ts` (no direct lucide import). Reused existing `fmtHours`.
- **Still broken:** nothing. Manual browser walkthrough (seed's over-capacity day → reassign a block → ⚠ clears; checklist item 9; reload persistence; Aktywność tab entry) not executed — no browser here; reviewer/human should eyeball.
- **Next:** ready for review.

#### 2026-07-08 · developer · `PKG-20260708-global-search`

- **Changed:**
  - `src/store/selectors.ts` — added `SearchResults` interface + pure `searchAll(state, query, limitPerGroup = 8)`. Module-local `normalize()` (NFD strip combining marks U+0300–U+036F + explicit `ł/Ł → l` + lowercase). Substring match on project name/description, task title/description, client name, person name/email/role; plus status coverage (query matching a status name pulls in its projects/tasks) and date coverage (query matching `^\d{4}-\d{2}-\d{2}$` pulls in projects/tasks whose `startDate <= q <= endDate`). Empty/whitespace → empty groups; each group `slice(0, limit)`.
  - `src/components/GlobalSearch.tsx` (new) — single app-level component rendering (a) the sidebar `.search-trigger` button (Search icon + `Szukaj…` + `Ctrl K` kbd) and (b) an `AnimatePresence` overlay palette. Global keydown: Ctrl/Cmd+K toggles (preventDefault), `/` opens when not focused in input/textarea/select/contentEditable and not already open. Overlay = scrim + centered glass panel, autofocused input, body scroll lock, Escape/scrim-click close. Results flattened once into `FlatItem[]` (projects→tasks→clients→people) for ↑/↓ wraparound highlight; Enter activates, mouse hover sets highlight; `role=listbox/option` + `aria-activedescendant`. Groups headed `Projekty/Zadania/Klienci/Zespół`. Activation: project→`/projects/:id`, task→`openTask(id)` (TaskModal in place), person→`/people/:id`, client→`/projects?client=:id`; always closes.
  - `src/App.tsx` — imported `GlobalSearch`, mounted once in the sidebar directly under `.app-brand`.
  - `src/pages/ProjectsPage.tsx` — `clientFilter` now initialized from the `?client=` search param via `useSearchParams` (read once as a `useState` initializer).
  - `src/styles.css` — appended `/* ---------- Global search ---------- */`: `.search-trigger` pill, `.gs-scrim` (z-index 990) / `.gs-viewport` (991, just under TaskModal's 1000/1001), `.gs-panel` glass (`--n2-surface-strong`), input row, grouped `.gs-row` list with `.active` highlight (`--n2-border-strong`), meta + chevron.
- **Tests:** `npx tsc --noEmit` → 0 errors; `npm run build` → success (2532 modules, no warnings).
- **Deviations:** none material. Mounted `GlobalSearch` inside the sidebar (not literally adjacent to `<TaskModal />`) so the trigger button lands "under the brand" as specified — the overlay is `position: fixed` so DOM location is irrelevant, and it remains a single app-level instance with component-local state (no reducer/state changes). Client project count uses a simple 1-vs-many Polish form (`projekt`/`projektów`).
- **Still broken:** nothing. Manual browser walkthrough (Ctrl+K/Cmd+K + `/` open, toggle-close, `redesign`/`kasia`/`gotowe`/date/`zolty`-diacritic queries, Enter-opens-TaskModal, `?client=` pre-filter, no interference with `/` in form fields) not executed — no browser here; reviewer/human should eyeball per acceptance criteria.
- **Next:** ready for review; unblocks `PKG-20260708-mobile-nav` (depends 1, 5).

#### 2026-07-08 · developer · `PKG-20260708-saved-filters`

- **Changed:**
  - `src/types.ts` — added `FilterPage`, `SavedFilterCriteria`, `SavedFilter`; added `savedFilters: SavedFilter[]` to `AppData`.
  - `src/store/storage.ts` — `emptyData()` now seeds `savedFilters: []`. No `DATA_VERSION` bump (stays 3); `loadData`'s `{ ...emptyData(), ...parsed }` default-fills old payloads. `migrateV1` inherits it via `{ ...base }`.
  - `src/store/seed.ts` — sample data literal gets `savedFilters: []`.
  - `src/store/AppStore.tsx` — imported `FilterPage`/`SavedFilterCriteria`; added actions `SAVE_FILTER_PRESET` (trims name, no-op when empty; overwrites the preset with the same `(page, trimmed-name)` else appends) and `DELETE_FILTER_PRESET`. No activity logging (presets aren't entity events).
  - `src/components/FilterPresets.tsx` (new) — shared preset UI. Props `page`, current `criteria`, `onApply`. Renders `.preset-chip`s for `state.savedFilters` of that page (apply on click; ✕ = `DELETE_FILTER_PRESET` behind `window.confirm('Usunąć zapisany filtr „{name}”?')`); `Zapisz filtr` button (disabled unless a criterion is non-default via exported `isCriteriaActive`) → inline name input (Enter confirms, Esc cancels) → `SAVE_FILTER_PRESET`. Exports `DEFAULT_CRITERIA`, `isCriteriaActive`. Icons from `src/components/icons.ts` (`Bookmark`, `Check`, `X`).
  - `src/pages/TasksPage.tsx` — new `.cal-toolbar` filter row: client / status (active) / assignee selects + `Od`/`Do` date inputs (`aria-label` per spec). Client match via `getProject(...).clientId`; assignee via `assigneeIdsOfTask`; date = period-overlap (`endDate >= from && startDate <= to`, unbounded when empty). Filters compose (AND) in a `useMemo`. `Wyczyść filtry` ghost button shown when any filter active; count `{n} z {total} zadań`; `FilterPresets` mounted; separate "Brak pasujących zadań" empty state vs the original "no tasks at all" state.
  - `src/pages/ProjectsPage.tsx` — added `Od`/`Do` date inputs to the existing toolbar (overlap on project period) and `FilterPresets`; existing paid/client/status filters untouched. `applyPreset` maps criteria → all five setters (incl. `paid`).
  - `src/styles.css` — appended `/* ---------- Filter presets ---------- */`: `.filter-controls`, `.filter-count`, `.btn.small`/`.btn.primary.small`, `.filter-presets`, `.preset-chip`(+`-apply`/`-del`), `.preset-save-form`, disabled save-btn.
- **Tests:** `npx tsc --noEmit` → 0 errors; `npm run build` → success (2533 modules, no warnings).
- **Deviations:** (1) Added a "Brak pasujących zadań" empty state on TasksPage (not spelled out) so an all-filtered-out list isn't blank. (2) ProjectsPage has no `Wyczyść filtry` button — the package only specified it for TasksPage; paid toggle + selects + date inputs reset individually and presets/`applyPreset` cover restore. No other deviations; `paid` stays `'all'` on task presets and `personId` `''` on project presets, both ignored on apply.
- **Still broken:** nothing. Manual browser walkthrough (create/apply/delete presets on both pages, reload persistence = checklist 13, legacy-payload load with `savedFilters` deleted from stored JSON, cross-page isolation, AND-composition) not executed — no browser here; reviewer/human should eyeball per acceptance criteria.
- **Next:** ready for review.

#### 2026-07-08 · developer · `PKG-20260708-mobile-nav`

- **Changed:**
  - `src/App.tsx` — added `menuOpen` state + `hamburgerRef`/`drawerRef`. New `.app-topbar` (brand + `.app-hamburger` toggle button: `aria-label` Otwórz/Zamknij menu, `aria-expanded`, `aria-controls="app-drawer"`, `Menu`/`X` icon swap). Existing `<aside>` becomes `id="app-drawer"` with an `open` class from state; a conditionally-rendered `.app-drawer-scrim` (click closes) sits behind it. Effects: close drawer on `location.pathname` change; while open lock body scroll + focus first nav link + Escape-to-close (cleanup restores overflow, TaskModal pattern); return focus to the hamburger on close-from-open. Nav links also `setMenuOpen(false)` on click. Imports `Menu`/`X` from `./components/icons`.
  - `src/styles.css` — in the existing `@media (max-width: 760px)` block, replaced the horizontal-scroll `.app-nav` rules with a vertical stack (`grid-template-columns: 1fr`; nav-link `justify-content: flex-start`). Appended `/* ---------- Mobile nav ---------- */`: `.app-topbar`/`.app-drawer-scrim` hidden by default, `.app-hamburger` button style; inside a new `≤760px` block the top bar shows (sticky, z-index 903), the sidebar becomes `position: fixed; inset: 0 auto 0 0; width: min(300px, 84vw)` off-canvas (`translateX(-102%)` → `.open` `transform: none`, `transition: transform 220ms ease`, z 901), the drawer's duplicate `.app-brand` is hidden, `.acting-as` restored to a vertical column, and `.app-drawer-scrim` shown (fixed, z 900).
- **Tests:** `npx tsc --noEmit` → 0 errors; `npm run build` → success (2533 modules, no warnings).
- **Deviations:** (1) hamburger `aria-label` is dynamic (`Otwórz menu`/`Zamknij menu`) rather than the literal static `Otwórz menu` in the package — genuine a11y improvement, still paired with `aria-expanded`. (2) Made the hamburger a real toggle (tap X closes) and layered the top bar above the drawer/scrim (z 903) so the X stays tappable, in addition to the spec'd scrim/Escape/link close paths. Z-index chosen below GlobalSearch (990/991) and TaskModal (1000/1001) per the layering note; scrim 900 < drawer 901 < topbar 903.
- **Still broken:** nothing. Manual device-emulation walkthrough at 375/760/1180/1440 px (drawer slide, scrim/Escape/link close, focus order, `prefers-reduced-motion` = no slide via the global rule, 761–1180 & >1180 unchanged) not executed — no browser here; reviewer/human should eyeball per acceptance criteria.
- **Next:** ready for review; unblocks `PKG-20260708-card-affordances` (depends 1, 6).

#### 2026-07-08 · test-writer · `PKG-20260708-card-affordances`

- **Changed:**
  - `src/pages/ProjectsPage.tsx` — added `<ChevronRight className="card-chevron" .../>` inside `.task-card-main`; added a `.card-actions` sibling with two `.card-action-btn`s (`GanttChart` → `navigate('/timeline')`, `Plus` → `openNewTask(p.id)` via `useOpenTask`), both `e.stopPropagation()`.
  - `src/pages/TasksPage.tsx` — added the chevron inside `.task-card-main`; moved the existing `Usuń` button out of the flex row and into a new `.card-actions` sibling (same reveal-on-hover pattern as the project cards; no `stopPropagation` needed since it was already a sibling of the main button, not nested).
  - `src/pages/ProjectDetailPage.tsx` — added the chevron inside `.project-task-main` (task rows). No quick actions (out of scope for this surface).
  - `src/pages/DashboardPage.tsx` — added the chevron to all four `.dash-row` buttons (overdue/upcoming deadlines, milestones, unpaid, overloads). No JS a11y fix was needed — the actual code already renders `dash-row` as native `<button>` elements (not `<li onClick>` as the package's context section assumed), so Enter/Space already worked; noted as a discovered fact, not a deviation requiring a decision.
  - `src/pages/PeoplePage.tsx` — added the chevron as a plain sibling inside `.person-row` (between the `person-row-main` Link and `person-row-hours`), not absolutely pinned to the link's own box — `.person-row-main` has no `flex:1` and the row already has `person-row-hours` + a delete button after it, so pinning the chevron to the link's own right edge (or the row's true right edge, which the delete button occupies) would either sit awkwardly close to the name or collide with delete. In-flow placement was the lower-risk choice; noted below as a minor design adaptation.
  - `src/styles.css` — appended `/* ---------- Card affordances ---------- */` after the Mobile nav section: shared hover/focus recipe (border → `--n2-border-strong`, background → `--n2-glass-strong`, `translateY(-1px)`, `var(--n2-transition)`) on `.task-card` / `.project-task-row` / `.person-row` / `.dash-row` (extends, doesn't replace, each surface's pre-existing hover rule — same-specificity selectors placed later in the cascade win); `.card-chevron` (color `--n2-text-faint` → `--n2-lavender` + `translateX(3px)` on hover/`:focus-within` (or `:focus-visible` for the button-only `.dash-row`)), absolutely pinned for the three full-button surfaces (`.task-card-main`, `.project-task-main`, `.dash-row`, each given `position:relative` + extra `padding-right`) and in-flow for `.person-row`; `.card-actions`/`.card-action-btn` (opacity 0→1 on hover/`:focus-within`, `pointer-events` toggled to match) plus a `@media (max-width: 760px)` override forcing them always-visible for touch.
- **Tests:** `npx tsc --noEmit` → 0 errors. `npm run build` → success (2533 modules, no warnings, `dist/assets/index-*.css` 51.20 kB gz 9.47 kB). No automated browser check available in this environment (no Playwright/Puppeteer installed) — reviewer/human should eyeball hover + `:focus-within` reveal + chevron slide + ≤760px always-visible actions on all five surfaces per the manual test note.
- **Deviations:**
  1. Dashboard's keyboard-accessibility fix (role="button"/tabIndex/Enter-Space handling) was not needed — the rows are already native `<button>` elements in the current code, contrary to the package's `<li onClick>` assumption. No code change made for this beyond adding the chevron.
  2. People-page chevron placed in normal flex flow next to `person-row-hours` rather than absolutely pinned to `a.person-row-main`'s own right edge, because that Link has no `flex:1` (its box ends right after the name text) and the row's true right edge is owned by the delete button — pinning there would either crowd the name or overlap delete. Hover/`:focus-within` slide behavior is identical either way.
  3. TasksPage's `Usuń` button was moved from an always-visible flex sibling into the same `.card-actions` reveal container used for ProjectsPage's quick actions, per the package's explicit instruction ("moves into/aligns with the `.card-actions` reveal pattern") — this does change TasksPage's at-rest layout (task-card-main now spans the full row width instead of sharing it with a fixed-width delete button), which is the one exception to "layout at rest is unchanged" the package itself calls for.
- **Still broken:** nothing found. Not independently verified: exact pixel spacing of chevron/quick-action offsets (40px/32px/26px paddings, `card-actions` `right: 40px`) — chosen to avoid overlap by inspection of the CSS box model, not screenshot-verified.
- **Next:** ready for review.

### Reviewer verdict

- **Recorded:** 2026-07-08 · reviewer (Fable) — own structural read of the full uncommitted diff + adjudication of the Codex review (`reviews/2026-07-08-015628-codex-review.md`). Verified myself: `npx tsc --noEmit` → 0 errors; `npm run build` → success (2533 modules, no warnings).
- **Status:** changes-required (3 small, well-localized fixes; everything else is sound)

#### Blockers (must fix before commit)

1. **[save-states] Project save leaves the form permanently dirty** — `src/pages/ProjectDetailPage.tsx:99-123` (Codex P2 #2, confirmed). `save()` dispatches trimmed `name`/`description` but local state keeps the untrimmed values, so saving `"Foo "` leaves `dirty === true` forever: after the 2.35 s saving/saved transient the badge falls back to `Niezapisane zmiany`, `beforeunload` stays armed, and "Wróć" prompts after a successful save. Fix: `setName(trimmed); setDescription(description.trim());` inside `save()` (or compute `dirty` against trimmed values).
2. **[global-search] Ctrl+K / `/` hotkeys fire while TaskModal is open, opening an invisible palette below it** — `src/components/GlobalSearch.tsx:45-66` + z-index layering (`.gs-viewport` 991 < `.task-modal-viewport` 1001 in `src/styles.css:2603/2191`). The palette renders under the modal (invisible, unclickable) but its input autofocuses and receives keystrokes; **Enter then navigates and silently unmounts a dirty TaskModal, bypassing the dirty guard** (this is the one concrete TaskModal bypass from Codex P2 #1); Escape in the palette input `preventDefault()`s but does not `stopPropagation()`, so the same keypress also hits TaskModalShell's window keydown → double close/confirm. Fix: suppress both hotkeys (early-return in `onKey`) while `?task=` is present (`useSearchParams`), and add `e.stopPropagation()` to the palette's Escape branch (also stops the mobile drawer's window Escape listener from double-firing).
3. **[global-search] `?client=` deep link desyncs when already on /projects** — `src/pages/ProjectsPage.tsx:83` (Codex P2 #3, confirmed). The param is read only in the `useState` initializer, so picking a client from GlobalSearch while on `/projects` (or back/forward between filter URLs) updates the URL but not the visible filter. Fix: sync via `useEffect` keyed on `searchParams.get('client')`. Note: the worker followed the package's literal wording ("read once as useState initializer") — spec gap, not worker error.

#### Codex findings — adjudication

- **P2 #1 (dirty guards bypassed by SPA navigation): partially confirmed.** Sidebar-click bypass of a dirty **TaskModal does NOT exist** — `.task-modal-viewport` (z 1001, `inset: 0`) covers the sidebar, so those clicks hit the guarded `requestClose`. Real TaskModal vectors: (a) the GlobalSearch keyboard flow → **blocker 2**; (b) browser Back/Forward (popstate unmounts without confirm) — unfixable without a data-router migration, out of scope per the architect → **accepted gap**. ProjectDetailPage sidebar/global-search/Back navigation = the architect's pre-accepted gap → dismissed as designed; this note extends the accepted gap to name GlobalSearch navigation and browser Back explicitly.
- **P2 #2: confirmed** → blocker 1.
- **P2 #3: confirmed** → blocker 3.
- **P3 #4 (TasksPage memo never memoizes): confirmed as a nit** — `src/pages/TasksPage.tsx:46-52`, `allTasks` is re-sorted every render and is a dep of the filtering `useMemo` (and `state` is a dep anyway). Wrap the sort in `useMemo(..., [state.tasks])`. Non-blocking (dataset is small). Routed-to: saved-filters, fold in with the blockers pass.

#### Nits (non-blocking)

- Polish plurals: timeline bar tooltip `⚠ konflikty: 1 dni` (`src/pages/TimelinePage.tsx` task-bar `title`) should decline dzień/dni; GlobalSearch client meta uses 1-vs-many so `2 projektów` should be `2 projekty` — a `polishCount` helper already exists in ProjectsPage.
- TasksPage `Usuń` now sits in an absolutely-positioned `.card-actions` (top 10px / right 40px) — it can overlap card meta text on reveal and is always visible ≤760px; needs the human visual pass.
- GlobalSearch Escape only closes the palette when focus is in the input (result-row buttons don't handle it).
- `.dash-row` gains a 1px transparent border (2px at-rest box change) — negligible.

#### Convention check: PASS

Reads via pure selectors (`conflictDatesForTask`, `searchAll` in selectors.ts); mutations only via reducer actions with activity appended in-action (`withActivity` in `REASSIGN_ENTRY`); persistence only through storage.ts (`savedFilters` default-filled by `loadData`'s `{ ...emptyData(), ...parsed }`, no DATA_VERSION bump, `migrateV1` inherits — verified); dates stay `'yyyy-MM-dd'` string comparisons; `reassignEntry` preserves sortIndex invariants (`nextSortIndex` against workload-without-entry + `reindexDays` over both day keys) and the entry→assignment invariant (creates, never removes); `src/components/icons.ts` is the sole lucide-react importer (grep-verified); no stray localStorage (grep-verified); only dependency added is lucide-react; nothing out of scope.

#### Test coverage: gaps (by design)

No automated tests exist in the repo (CLAUDE.md: verification = typecheck + build + manual walkthrough). tsc + build re-run green by the reviewer. Must-do human browser walkthrough after fixes: breakpoints 375/760/1180/1440 (topbar/drawer/focus); timeline zoom drag-by-N-columns at 14/26/40 + conflict tick on the seed's over-capacity day; TaskModal dirty-confirm on all close paths + beforeunload + save badge; workload cell → reassign → ⚠ clears + activity entry + reload persistence; search hotkeys (incl. verifying blocker-2 fix with a modal open); preset create/apply/delete/reload + legacy payload without `savedFilters`; card hover/focus reveal on all five surfaces (esp. TasksPage `Usuń` overlap); checklist items 3, 4, 7, 9, 11, 12, 13.

- **Routing:** blockers 1 → save-states worker; 2, 3 (+ nit fixes if cheap) → global-search worker; Codex #4 nit → saved-filters worker. Re-review not required if fixes are limited to the named files/lines — architect final eval + human walkthrough suffice.
- **Recorded by:** reviewer

### Fix round (orchestrator-consolidated)

Fixes routed back to the original workers per the verdict; ran in parallel on
disjoint files, RUN-STATE writes consolidated here by the orchestrator.

- **Blocker 1** · save-states worker · `src/pages/ProjectDetailPage.tsx` —
  `save()` now normalizes local state to the persisted values
  (`setName(trimmed)`, `setDescription(trimmedDescription)`); form clears to
  clean after saving whitespace-padded input. ✅
- **Blocker 2 (R-1)** · global-search worker · `src/components/GlobalSearch.tsx` —
  hotkey effect early-returns while `?task=` is present (palette can't open
  under TaskModal; a new effect also closes it if a modal opens over it);
  palette Escape adds `stopPropagation()` so it no longer double-fires
  TaskModalShell's / mobile drawer's window listeners. Plural nit fixed with a
  local `polishCount` (1 / 2–4-except-12–14 / 5+). ✅
- **Blocker 3** · global-search worker · `src/pages/ProjectsPage.tsx` —
  `useEffect` keyed on `searchParams.get('client')` syncs `clientFilter`
  whenever the param is present (GlobalSearch pick while on /projects and
  back/forward now update the visible filter; in-page filter use unaffected). ✅
- **Codex #4 nit** · saved-filters worker · `src/pages/TasksPage.tsx:48-58` —
  sort wrapped in its own `useMemo([state.tasks])`; filtering memo now
  actually memoizes. ✅
- **Timeline plural nit** · timeline worker · `src/pages/TimelinePage.tsx` —
  bar tooltip declines `1 dzień` / `N dni`. ✅

**Final verification (orchestrator):** `npx tsc --noEmit` → 0 errors;
`npm run build` → success (no warnings). Remaining before commit: human
browser walkthrough (list in the reviewer verdict above); TasksPage `Usuń`
reveal-overlap eyeball. Accepted gaps unchanged (browser Back/Forward past a
dirty form; sidebar nav away from dirty ProjectDetailPage).

**Status:** fixes applied, build green — awaiting human go-ahead to commit.
