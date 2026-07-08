# Handoff: Rebuild the Panel as the worker's morning welcome page

- **Package ID:** PKG-20260709-dashboard-welcome
- **Status:** ready
- **Tier:** developer
- **Model:** opus
- **Depends on:** PKG-20260709-filter-panel (styles.css ordering only)
- **Blast radius:** medium — DashboardPage full rewrite + new selectors + one new component + CSS; no reducer/storage changes

## Goal

The Panel (`/dashboard`) becomes the logged-in worker's morning page with
exactly 4 sections: (a) today's tasks for the current user, (b) a MOCKUP team
chat with presence, (c) an SVG donut workload summary (today + this week),
(d) a week strip of the user's blocks. The current pipeline/deadlines/payments/
overloads cards are removed entirely.

## Context the worker needs

- Relevant files:
  - `src/pages/DashboardPage.tsx` — full rewrite (current file is the
    reference for the card/`motion` entrance pattern to keep).
  - `src/store/selectors.ts` — add new pure selectors (below). Existing ones
    to reuse: `hoursForPersonOnDate`, `availableHoursOnDate`,
    `availableHoursInRange`, `entriesForDate`, `getTask`, `getProject`,
    `getClient`, `getStatus`, `assigneeIdsOfTask`, `personCapacity`,
    `currentUser`.
  - NEW `src/components/ChatMock.tsx` — coworkers list + chat popup.
  - `src/utils/dates.ts` — `todayStr`, `weekDays`, `formatRowLabel`,
    `formatShort`; `src/utils/time.ts` — `formatMinutes`, `formatDuration`.
  - `src/components/Avatar.tsx`, `StatusBadge.tsx`, `Coin.tsx`,
    `src/utils/colors.ts` (`personColor`).
  - `src/components/TaskModal.tsx` — `useOpenTask` for opening tasks.
  - `src/styles.css` — `--n2-*` tokens; `dash-*` classes may be reworked.
- Conventions: CLAUDE.md. No backend, no new npm deps (donut = plain SVG),
  localStorage only via storage.ts (this package must NOT touch it), Polish
  UI, weeks start Monday, all reads via selectors.

## Pinned decisions (do not reopen)

1. **No priority field.** `Task` has no priority and we are NOT adding one in
   this run (data-model churn belongs to its own package). Ordering of
   "today's tasks": (1) the user's timed blocks today, ascending
   `startMinutes` — the calendar order IS the priority; then (2) tasks
   assigned to the user whose period covers today but with no block today,
   ascending `endDate` (nearest deadline first). Done-status tasks (last
   active status) are excluded from group 2 but timed blocks always show.
2. **Section (a) "Zadania na dziś"**: one row per item — for group 1:
   `8:00–10:30 · {task title} · {project → client}` + StatusBadge; for
   group 2: `bez godziny · {title} · do {endDate}` styled muted. Row click →
   `openTask`. Empty state: `Brak zadań na dziś — zajrzyj do kalendarza.`
   with a link to `/calendar`.
3. **Section (b) "Zespół" — explicitly a mockup**: list of coworkers
   (`state.people` minus the current user): Avatar + name + role + presence
   dot. Presence is FAKE and deterministic-per-day: derive from a simple hash
   of `person.id + todayStr()` mapped to `online` (green, `Dostępny(a)`) /
   `away` (amber, `Zajęty(a)`) / `offline` (grey, `Niedostępny(a)`) — pure
   function inside ChatMock, no storage, no timers. Clicking a person opens a
   chat popup (fixed, bottom-right, above content): header with the person +
   presence, message list, input + `Wyślij`. Messages live ONLY in component
   state (lost on unmount — that's fine); sending appends the user's message
   and after ~1s appends a canned reply
   (`To tylko podgląd czatu — funkcja w przygotowaniu.`). A visible badge in
   the section header says `Wersja demonstracyjna`. Do NOT put chat data in
   AppData/localStorage.
4. **Section (c) "Obciążenie"**: two SVG donuts side by side — `Dziś`
   (booked = `hoursForPersonOnDate(state, me, today)` vs available =
   `availableHoursOnDate`) and `Ten tydzień` (booked = sum over
   `weekDays(today)` vs `availableHoursInRange`). Donut = two `<circle>`s with
   `stroke-dasharray` (track: `--n2-surface`-ish, fill: violet/lavender;
   danger `--n2-danger` when booked > available). Center label `Xh / Yh`,
   sublabel percentage. Available 0 (e.g. `workDays: []`) renders the ring
   empty with `0h / 0h` and NO division-by-zero NaN.
5. **Section (d) "Twój tydzień"**: 7 columns Mon–Sun of the current week;
   each cell: weekday+date header (today highlighted, weekend tinted), then
   the user's blocks that day sorted by `startMinutes`
   (`{8:00} {task title}`), truncated to ~4 with `+n więcej`. Empty day: `—`.
   The section header links to `/calendar` (`Otwórz kalendarz →`). Cells are
   not individually clickable.
6. **Greeting header** above the grid: `Dzień dobry, {firstName}` + today's
   date via `formatRowLabel(today)`. No emoji.
7. **Edge case**: zero people (setup mode) or no resolvable current user →
   keep the existing empty-state welcome card exactly as today (sample banner
   flow must keep working). Note: when people > 0 the login gate guarantees a
   current user.
8. Keep the `motion` staggered-entrance pattern for the 4 cards (reuse
   `dashGridVariants`/`dashCardVariants`).

## New selectors (pure, exported, JSDoc'd — in `src/store/selectors.ts`)

- `todayAgendaForPerson(state, personId, date)` →
  `{ timed: WorkloadEntry[]; dateless: Task[] }` per pinned decision 1
  (timed: that person's entries on `date` sorted by `startMinutes`; dateless:
  assigned tasks covering `date` with no entry that day, non-done, sorted by
  `endDate` then title).
- `weekBlocksForPerson(state, personId, dates: DateStr[])` →
  `Map<DateStr, WorkloadEntry[]>` (each day's entries sorted by
  `startMinutes`). Trivial but keeps the page selector-only.

## Scope

### In scope
- The rewrite, the two selectors, ChatMock, CSS for all four sections
  (responsive: 2×2 grid ≥1180px, single column ≤760px; chat popup full-width
  bottom sheet ≤760px).

### Out of scope
- No storage/type/reducer changes; no real chat/presence/notifications; no
  priority field; no changes to other pages; do not delete selectors other
  pages use.

## Acceptance criteria

- [ ] `/dashboard` shows exactly 4 sections + greeting; old pipeline/
      deadlines/payments/overloads cards are gone.
- [ ] Seed data as Kasia: section (a) lists her seeded blocks for today in
      start-time order with correct time ranges; clicking opens the TaskModal;
      switching acting user (impersonation) re-renders (a)/(c)/(d) for that
      person.
- [ ] Chat: coworkers listed with presence dots; popup opens/closes; sending
      echoes the message + canned reply; nothing persists to localStorage
      (verify the `n2hub.data.v1` payload is byte-identical after chatting);
      `Wersja demonstracyjna` visible.
- [ ] Donuts render correct proportions for seed data (hand-check one value),
      danger color when overloaded, no NaN with 0 availability.
- [ ] Week strip shows the user's blocks Mon–Sun, today highlighted,
      `+n więcej` beyond 4.
- [ ] Empty store still shows the welcome empty-state + sample banner flow.
- [ ] All strings Polish; console clean.
- [ ] Gates: `npx tsc --noEmit` clean; `npm test` green; `npm run build` OK.

## Tests

- Command: `npx tsc --noEmit && npm test && npm run build`
- Expected: suite green. Unit tests for the two new selectors are the
  follow-up test-writer package (PKG-20260709-dashboard-selector-tests) — do
  not write them here, but keep the selectors pure so they are testable.

## Report back

Files changed one-line each, test pass/fail, walkthrough items, deviations.
No raw logs.
