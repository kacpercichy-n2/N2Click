# Run State — current tiered-workflow run

A durable, append-only log for the run in progress. Every tier updates it so the
**reviewer** and the architect's final eval can see the whole run at a glance
instead of reconstructing it from chat history and worker narratives. Keep it
boring and factual — it's a checklist, not prose.

> Previous runs (2026-07-08 ×4 — bin/split/sidebar, walkthrough fixes,
> budget+accounts/roles [ff4fd8a], bug-fix round 2 [28b9dae]; 2026-07-09 —
> bin-drag freeze fix (pointer-capture, REGRESSED — see this run) · timeline
> Osoby mode · FilterPanel · dashboard welcome page, approved-with-nits and
> committed as f61bb27, 195/195 tests) are archived in the git history of this
> file.
> **Carried-over items still open:** (a) human browser walkthrough of all
> approved runs' interactive criteria (role matrix, budget clamp + merge
> animation, availability math, insert-form allowance warnings, TaskModal
> over-budget banner, impersonation banner/return, Osoby timeline mode,
> FilterPanel on 4 pages, dashboard sections + chat-persists-nothing check).
> Resolved since last run: commit hygiene (automation/ + the two untracked
> components landed in f61bb27); CLAUDE.md refresh is no longer a human task —
> it is THIS run's `PKG-20260709b-docs-refresh`.
> **Carried backlog (non-blocking):** Codex #5 `workDays: []` 0%-vs-overload
> display + dashboard donut zero-availability display (same class; suggested
> `over = booked > available`); pre-existing `insertBlock` end-of-day clamp
> overlap; status archive hides projects from Kanban; `toQuarters` placement
> (→ utils/time.ts); v4→v5 payload with zero administrators (promote-first-person
> idea); framer-motion PopChild dev-only ref warning; people-mode timeline
> conflict markers are task-wide, not per-person (needs
> `conflictDatesForTaskPerson` decision).

---

## Run: 2026-07-09 (2) — Maintenance: docs refresh · bin-drag freeze round 2 · repo reorganization

### Plan (architect)

- **Goal:** unattended maintenance run on `review/claude-auto-20260709`. No
  feature work. (1) HIGHEST PRIORITY BUG: the bin→calendar drag freeze STILL
  happens despite the reviewer-approved pointer-capture fix in f61bb27 — the
  previous root cause was wrong or incomplete; this time repro/fix MUST be
  proven in a real browser with screenshot artifacts. (2) Docs refresh: the
  repo CLAUDE.md is badly stale (still v4 payload / isAdmin / no login / no
  budget-bin / old dashboard); plus doc-tree reorganization. (3) Loophole/code
  review — handled by the reviewer tier + the Codex pass at run end (Codex
  browser second opinion is orchestrated by the top-level session, not by a
  worker package).

- **Packages (sequential — 2 depends on 1's root-cause report):**
  1. `handoffs/packages/PKG-20260709b-bin-drag-freeze-2.md` — tier: developer
     (opus) — browser repro on chromium AND webkit (user is on macOS), three
     freeze probes (main-thread heartbeat, pointer-delivery liveness,
     console/max-update-depth), stress matrix if seed data doesn't repro,
     ranked hypotheses H1–H4 (engine-specific capture wedge on the unmounting
     card root · post-drop render loop · reducer/util spin on pathological
     data · stuck-drag perceived freeze), fix + committed rerunnable script
     `scripts/browser-check-bin-drag.mjs` + REQUIRED screenshots in
     `reviews/screenshots-20260709/`. "Not reproduced + evidence" is an
     acceptable honest outcome; invented fixes are not.
  2. `handoffs/packages/PKG-20260709b-docs-refresh.md` — tier: developer
     (opus) — full CLAUDE.md rewrite to the shipped v5 state (verify every
     claim in code), archive all pre-run handoff packages into
     `handoffs/packages/archive/` (git mv), DELETE the gitignored duplicate
     workflow clone `fabletieredworkflow/`, correctness pass on
     `automation/claude-scheduler/README.md`, `reviews/` kept untouched.

- **Pinned decisions:** old packages are ARCHIVED not deleted;
  `fabletieredworkflow/` is DELETED from disk (verified duplicate of the
  installed `.claude/` + `docs/workflow/` template, gitignored, recoverable
  from its own remote; `.gitignore` line stays); `reviews/` kept for
  traceability; no test-writer package this run (no well-specified missing
  unit coverage worth adding — regression tests belong to the bug package);
  CLAUDE.md documents the freeze root cause verbatim from package 1's report,
  or its honest "not reproduced/hardened" status.

- **Reviewer attention list (part 2 of the user goal — fold into the run-end
  review):** WeekView pointer-capture/drag paths (incl. TimedBlock resize
  handles capturing handle spans that can unmount on merge), budget/allowance
  consistency (`growAllowanceHours` UI clamp vs reducer `taskGrowAllowance`
  enforcement, no-mint rule for null estimates), the `can()` permissions
  matrix vs actual page/action gating, storage migrations idempotency (v4→v5
  person migration + `ensureStartMinutes` with `BIN_DATE` rows), plus the
  carried backlog items above.

- **Environment notes for workers:** RTK hook blocks rewritten read commands —
  use Read/Grep/Glob tools and the `node -e '…'` escape hatch; dev server must
  be started detached; Playwright via `npm install --no-save playwright` +
  `npx playwright install chromium webkit`; gates after every package:
  `npx tsc --noEmit` · `npm test` (baseline 195) · `npm run build`.

- **Open questions:** none.

### Worker log

<!-- Append one block per worker completion. Newest at the bottom. -->
<!--
#### <timestamp> · <agent> · `PKG-…`

- **Changed:** `path/one` — <one line>; `path/two` — <one line>
- **Tests:** `<command>` → <pass/fail counts>
- **Still broken:** <or "nothing">
- **Next:** <hand to which tier / ready for review / done>
-->

### Reviewer verdict

<!-- Reviewer appends here after workers finish. -->
