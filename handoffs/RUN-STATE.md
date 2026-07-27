# Run state — 20260723-101440-n2hub-262 calendar split-blocks

Merge guard so a fused same-task block never swallows a meeting the user split
around. New `mergeCoversEventOrRecurrence` (selectors.ts); reducer merge loop
(AppStore.tsx ~1697) skips guarded pairs; `findFreeStart` gains `avoidTouch`
(time.ts) wired at 2 WeekView bin-schedule sites; new `eventBusyByPersonDate`
in weekViewModel + will-merge affordance mirror. Tests added (blockActions,
time). Focused 181, full suite 1412, build all green. wiki unchanged.

---

# Run state — 20260722-161131-n2hub-259 perf: persist coalescing

New `src/store/persistCoalescer.ts` (trailing non-restarting, 1000ms) wired into
`AppStore.tsx`: `[state]` effect schedules instead of sync `saveData`;
pagehide/visibility/unmount flush; retry/keepLocal/acceptExternal cancel first;
external-change flush-then-`isOwnLastWrite` fast path. `storage.ts` tracks last
written raw+revision; `ExternalChangeInfo.newValue` added; registerPersonOrder
render-guarded. Tests: persistCoalescer.test.ts + storage.test.ts. Focused +
full suite (1393) + build all green.

---

# Run state — 20260722-144152-n2hub-257 settings + nav cleanup

## Goal

"Konto" → "Ustawienia" (gear; Administracja switches to ShieldCheck), settings
page = NEW menu-order editor (device-local `UiPrefs.navOrder`, up/down + reset,
no drag) + password change (supabase-only), duplicated Mój profil / Profil w
chmurze sections removed, sidebar footer = avatar bubble → `/people/<own id>` +
narrower "Wyloguj", and FULL impersonation removal (UI switcher, banner,
IMPERSONATE/STOP actions, `AppData.impersonatorId`, `users.impersonate`,
selectors, persistGate/storage/seed/export plumbing). Historical
`ActivityEvent.impersonatorId?` stays read-only; cloud sync untouched; no DB
migration; DATA_VERSION stays 7.

## Packages

- `handoffs/packages/settings-nav-cleanup.md` —
  PKG-20260722-settings-nav-cleanup, tier: developer, ready, Codex review
  required. Single package (items are interlocked in App.tsx/AccountPage).

## Changed boundaries (planned)

- Shell/UI: `src/App.tsx`, new `src/components/navItems.ts` (+test),
  `src/components/icons.ts` (ShieldCheck), `src/pages/AccountPage.tsx`,
  `src/utils/uiPrefs.ts`, `src/styles.css`, `src/onboarding/OnboardingRoot.tsx`,
  `src/pages/AdminPage.tsx`.
- Store: `src/types.ts`, `AppStore.tsx`, `selectors.ts`, `permissions.ts`,
  `useCan.ts`, `persistGate.ts`, `storage.ts` (strip legacy key, no echo-write),
  `seed.ts`, `exportDryRun.ts`, `src/supabase/referenceData.ts` (opts lose
  `impersonating`), `src/pages/TeamPage.tsx`.

## Verification

Focused vitest list in the package, then `npm test` + `npm run build`;
browser: `node scripts/browser-check-ui-keyboard.mjs` (footer DOM changes;
"Wyloguj" accessible name preserved). teamScope/profileEditPolicy tests must
pass unmodified.

## Developer result (n2hub-257)

Implemented in full. Focused list PASS 669/0; `npm test` 1379 passed (54 files);
`npm run build` green. Browser check NOT run — playwright not installed in this
worktree; footer keeps `<button name="Wyloguj">` so the script contract holds.
Context expansion: `src/auth/SessionProvider.tsx` used deleted `realUserId` →
switched to `state.currentUserId` (direct dependency, noted as deviation).

## Open questions

None — all design decisions settled in the package.

## Wiki note

`ui-navigation-and-onboarding.md` will be stale (Konto/`/account` description,
AccountPage "Profil w chmurze", impersonation fallback mentions);
`state-and-persistence.md` loses `impersonatorId` bookkeeping. Final reviewer
owns the wiki decision.

## 258 — merge Panel + Moja praca (developer)

Merged „Moja praca" into „Panel": Zasobnik+Alerty are new Panel tiles (grid areas
`bin`/`alerts`), single home `HOME_PATH='/dashboard'` (new pure `homeRoute.ts`+test).
`/my-work`→redirect; MyWorkPage + nav item + `landingPathForRole` removed;
OnboardingRoot `@home`/catalog copy updated. `npm test` 1373 pass; build green.
Touched CSS + selectors sections unchanged. Blocker: none.

## 261-perf-taskmodal-search
GlobalSearch: useDeferredValue(query) + `buildSearchResultMeta` (selectors) maps
replace per-result getClient/getProject/getStatus/projectsOfClient in render.
TaskModal: AllocationGrid now React.memo + useCallback handlers; availabilityByPerson
deps narrowed to state.people/state.workload (identical). +focused selectors tests.
`npm test` 1406 pass; build green. Blocker: none.

n2hub-268: person selection moved into Filtry popover. New shared
ActivePersonChips + PersonFilterSection (PersonFilter.tsx); FilterBar gains
`person` prop (replaces personFilter slot). Kanban/Timeline/Calendar migrated;
compact active chips + "Osoby" section shared. CSS for .person-active-chip.
Tests updated/added (FilterBar, PersonFilter). Full suite 1483 pass, build green.

n2hub-269 notifications-hardening: (A) applyCloudOps drops notifications-table
ops on any error silently (no transient stop, no banner). (C)
loadNotificationsSnapshot returns {available} — transient skips merge, missing
table degrades to []. (B) Edge fn claim-before-send (claimBatchIds). (D)
findFreeStart adds one-grid-step past-end/before-start avoidTouch candidates.
Tests added across 4 files. Full suite 1492 pass, build green.

n2hub-275 recurring-occurrence-status: per-occurrence "zrobione" for recurring
tasks. `RecurrenceOverride.done?: true` inside the existing `tasks.recurrence`
jsonb (skip beats done, `done:false` never stored); new `SET_OCCURRENCE_DONE`
reducer action (same-reference no-ops); `setRecurrenceOverride` preserves `done`
on a time shift; `RecurrenceOccurrence.done` + selector `occurrenceIsDone` (own
flag OR task done status); WeekView overlay/menu splits "to wystąpienie" from
"cała seria". No migration, DATA_VERSION stays 7. Full suite 1571 pass, build
green. Wiki updated (CYKLICZNOŚĆ ZADAŃ, recurring-occurrence bullet).

n2hub-276 notification-preview (PKG-20260727-notification-preview): Panel
row click now TOGGLES an inline preview (kto/co/gdzie + komentarz) and dispatches
nothing; opening moved to a secondary „Otwórz zadanie/projekt" button keeping
today's mark-read. Pure `notificationEntry` gains `preview`/`openLabel`;
`commentBody` injected from `state.comments`. Additive CSS only. Focused 32 pass,
tsc clean. No context expansion, no blocker, wiki unchanged.

n2hub-276 alloc-start-hour: optional `AllocationCell.startMinutes` (15-min grid,
off-grid/out-of-range => same state ref). Applied as ONE post-pass after the
SAVE_TASK pair loop, only for pairs resolving to exactly one block; no-pin
payloads byte-identical. Grid gains `<input type="time">`; TaskModal seeds/clears
`startTimes`. Focused suites (saveTaskWorkload/blockActions/time/taskSaveBlockers)
214 pass; tsc clean. Blocker: none.

n2hub-276 timeline-day-headers: presentation only. New pure `showDayColumns` /
`dayHeaders` (timelineZoom.ts) + `weekdayAbbr` / `dayOfMonthLabel` (dates.ts);
TimelinePage renders per-day header cells and `DayStripes` gains `columns` for
gridlines; additive `.timeline-day-head` / `.timeline-daygrid` CSS. Zoom, range
and drag math untouched. Focused timelineZoom+dates 59 pass; tsc clean. No
context expansion. Blocker: none.

n2hub-276 mention-autocomplete: new pure `src/components/mentionAutocomplete.ts`
(`mentionQueryAt` / `filterMentionPeople` / `applyMention`) + CommentsPanel
combobox listbox over the textarea; Enter only intercepted while open.
`parseMentions` / `MentionBody` / chips untouched, additive CSS. Deviation: NFD
does not decompose „ł", so normalize folds ł→l. Focused 17 pass, tsc clean.
Wiki unchanged (page does not document comments).

n2hub-276 review nits: styles.css notification comment now matches expand-only
row; TaskModal start-hour hint hidden when readOnly; `startTimes` seed shares new
`normalizeStartMinutes` with `setCellStart` (finite + snap + clamp), so an
off-grid pin can never silently void SAVE_TASK. saveTaskWorkload+taskSaveBlockers
41 pass; tsc clean. No context expansion, no blocker, wiki unchanged.

n2hub-277 modal shell: no ModalFrame exists; new pure `modalShell.ts` (+23 tests)
and hook `useModalShell.ts` own focus entry/trap/return, Escape, ref-counted
scroll lock + scrollbar padding, `aria-labelledby` and the pointerdown+click
backdrop pair for Task/Ticket/Event/Changelog; IconButton gains forwardRef.
npm test 1630 pass, build green. Browser checks unrunnable (no playwright).
OnboardingRoot/GlobalSearch/App drawer deferred. Wiki updated.

n2hub-278 overlay shell: new pure `overlayShell.ts` (+37 tests) and thin
`useOverlay.ts` (portal `#n2hub-overlay-root`, flip/shift, reposition on scroll,
topmost-only Escape, pointerdown+click dismiss, menu keyboard) now back the three
WeekView menus and FilterPanel; z-index tokens added. Domain/drag code untouched.
npm test 1630→1667 pass, build green. Playwright missing — ad-hoc CDP smoke
instead. No context expansion.
