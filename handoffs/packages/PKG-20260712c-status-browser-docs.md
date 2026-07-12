# Handoff: Browser regression check for status semantics + CLAUDE.md updates

- **Package ID:** PKG-20260712c-status-browser-docs
- **Status:** ready
- **Tier:** test-writer
- **Model:** sonnet
- **Depends on:** PKG-20260712c-status-done-core, PKG-20260712c-status-admin-ui (both merged in the working tree)
- **Blast radius:** low — one new script under `scripts/`, screenshots, CLAUDE.md text.

## Goal

Prove in a real browser (Chromium + WebKit) that completion no longer depends
on pipeline position or archival, that the Kanban archived column works, and
that guard pre-validation explains itself in Polish. Then update CLAUDE.md so
the doc matches the shipped behavior.

## Context the worker needs

- Pattern scripts to mirror STRUCTURALLY (arg handling, PASS/FAIL tally,
  non-zero exit on any FAIL, screenshot dirs, engine selection):
  `scripts/browser-check-savetask-multiblock.mjs` and
  `scripts/browser-check-date-hardening.mjs`.
- App behavior shipped by the two dependency packages — read their sections in
  `handoffs/RUN-STATE.md` plus the code: `src/pages/AdminPage.tsx` (done
  checkbox `Ukończenie`, disabled titles), `src/pages/KanbanPage.tsx`
  (`Zarchiwizowane` trailing column), `src/store/selectors.ts`
  (`doneStatusIds`), `src/store/storage.ts` (storage key `n2hub.data.v1`,
  `DATA_VERSION = 7`).
- Seed data (`src/store/seed.ts`): 2 clients / 3 projects / 4 tasks / 3 people,
  Kasia = administrator = default acting user; default statuses Do zrobienia /
  W trakcie / Akceptacja / Gotowe (only Gotowe `isDone`).
- Manipulating localStorage directly from `page.evaluate` for deterministic
  fixtures is the established pattern (see the savetask script) — reload the
  page after writing.

## Scope

### In scope

1. **New script `scripts/browser-check-status-semantics.mjs`** taking an
   optional engine arg (`chromium` default, `webkit`), saving screenshots to
   `reviews/screenshots-20260712-status/{engine}-*.png`, non-zero exit on any
   FAIL. Checks, in order:
   - (a) Load app, seed sample data via the banner button. Via localStorage:
     confirm exactly one status has `isDone: true` and it is `Gotowe`.
   - (b) **Reorder safety.** Via localStorage set up a deterministic fixture:
     pick a task, set its `statusId` to Gotowe's id, `endDate` to a past date,
     assign it to Kasia (add a TaskAssignment row) — reload. Assert the task
     does NOT appear under `Po terminie` on `/my-work` (acting user Kasia).
     Then in `/admin` click Gotowe's move-up (▲) button twice; reload
     `/my-work`; assert the task STILL does not appear, and via localStorage
     that Gotowe still has `isDone: true` while the now-last status does not.
     Screenshot: admin status list after reorder.
   - (c) **Archive visibility.** Via localStorage note which status a seeded
     project uses (pick one in `W trakcie` or set one deterministically);
     in `/admin` archive that status (its archive button must be enabled);
     go to `/kanban`; assert a trailing column with header text
     `Zarchiwizowane` exists and contains that project's card, and that the
     project count in the column matches. Screenshot: kanban with archived
     column.
   - (d) **Archive does not revive completed work.** Via localStorage: create
     a second done status (set `isDone: true` on `Akceptacja`), put a
     past-endDate Kasia-assigned task in Gotowe, then archive Gotowe via the
     admin UI (allowed — Akceptacja is also done). Assert the task still does
     NOT appear under `Po terminie` on `/my-work`.
   - (e) **Guard pre-validation.** Reset to a clean seeded state (clear
     localStorage, re-seed). In `/admin`: Gotowe's `Ukończenie` checkbox is
     disabled with title
     `To jedyny status oznaczający ukończenie — najpierw oznacz inny status.`;
     Gotowe's archive button is disabled with title
     `Nie można zarchiwizować jedynego statusu ukończenia — najpierw oznacz inny status.`;
     toggle `Ukończenie` ON for `Akceptacja` → Gotowe's checkbox and archive
     button become enabled. Screenshot: admin row states.
   - (f) Console: no errors during the run (mirror how existing scripts track
     page errors, if they do; otherwise add a `page.on('pageerror')` FAIL hook).
2. **Run it**: Chromium and WebKit both. Dev server: first check whether
   `http://localhost:5173` already responds (reuse it); otherwise start one
   in-process via the vite node API (`import('vite')` → `createServer()`).
   Invoke as `node scripts/browser-check-status-semantics.mjs webkit`
   (direct form — `node -e '<code>' arg` does NOT forward the arg to
   `process.argv[2]`).
3. **CLAUDE.md updates** (verify each claim against the merged code before
   writing; scoped edits only):
   - Architecture bullet: replace `the "done" status rule is centralized in
     doneStatusId (the last active status)` with the new rule — completion is
     the stored `Status.isDone` flag, exposed via `doneStatusIds` /
     `isDoneStatus` (archived done statuses still count as done; pipeline
     order/archival never changes doneness).
   - Storage bullet: payload version is now 7; mention the every-load
     idempotent `normalizeStatusFlags` pass (defaults the last active status
     to done on legacy payloads) alongside `ensureStartMinutes` /
     `normalizeDates` / task-meta normalization.
   - Data model: `Status` line gains `isDone` with one clause on semantics;
     add a hard-invariant bullet: at least one active status and at least one
     `isDone` status always exist once statuses exist — the reducer refuses
     archive/delete/untoggle that would break this, and the admin UI
     pre-validates with Polish titles.
   - Kanban section: note the trailing `Zarchiwizowane` column (drag-out only,
     not a drop target, hidden when empty).
   - Admin section: statuses now also carry the `Ukończenie` toggle; blocked
     actions explained via disabled controls + Polish titles.
   - Manual test checklist: extend item 6 or 10 with: reorder does not change
     completion; archiving a used status shows it in the `Zarchiwizowane`
     kanban column; only-done/only-active guards disable with Polish titles;
     TaskModal/ProjectDetail selects show `(zarchiwizowany)` for an archived
     current status.

### Out of scope

- Any production `src/` change. If a check FAILS, report it — do not fix.
- Unit tests (separate package). RUN-STATE archival/reset (architect owns it).
- Rewriting unrelated CLAUDE.md sections.

## Implementation notes

- Assert on the exact Polish strings quoted above — they are the contract from
  the UI package.
- Keep localStorage fixture writes minimal and version-stamped 7 (or write 6
  and let the load migrate — either is fine, but assert what you rely on).
- Environment: NO git, NO `npm run dev`/`npm run build`/`vite` CLI/`curl`.
  Allowed: `node <path> <arg>`, `npm test`, `npx tsc --noEmit`. Playwright is
  importable from plain node.
- Log your result to `handoffs/RUN-STATE.md` (worker log), including per-engine
  PASS counts and screenshot paths.

## Acceptance criteria

- [ ] Script exists, mirrors the established pattern, exits non-zero on FAIL.
- [ ] Chromium AND WebKit runs: all checks PASS; screenshots (≥3 per engine)
      in `reviews/screenshots-20260712-status/`.
- [ ] CLAUDE.md contains no remaining `doneStatusId` / "last active status"
      completion wording (grep the file), and every edit above is in place and
      accurate against the code.
- [ ] `npx tsc --noEmit` and `npm test` still green (nothing touched, sanity
      re-run).

## Tests

- Command: `node scripts/browser-check-status-semantics.mjs` then
  `node scripts/browser-check-status-semantics.mjs webkit`; plus
  `npx tsc --noEmit && npm test` as a no-regression sanity run.
- Expected: all browser assertions PASS on both engines; unit suite unchanged
  green.

## Report back

Synthesized summary only: script check list with per-engine PASS/FAIL, the
CLAUDE.md sections edited, screenshot inventory, deviations. No raw logs.
