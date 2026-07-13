# Decision note: should a task's dates be contained within its parent project's dates?

- **Status:** awaiting human decision. **Nothing in this note is enacted.** It is
  documentation of verified current behavior plus a menu of options — produced
  by PKG-20260713b-placement-browser-docs per an explicit constraint from the
  architect: *"parent-project containment of task dates is NOT a current
  product invariant and must not be invented unattended."*
- **Audience:** whoever makes the product call (project owner / architect on a
  future run). Once a decision is made, it becomes its own handoff package(s)
  — this note is not a spec for one.

## Current behavior (verified in code, not assumed)

N2Hub has **no containment invariant** between a `Project`'s
`startDate`/`endDate` and its `Task`s' `startDate`/`endDate` today. Concretely:

- **`SAVE_TASK`** (`src/store/AppStore.tsx:268`, guard at `:272`) validates the
  task's own period (`periodError(draft.startDate, draft.endDate, { maxDays:
  MAX_TASK_PERIOD_DAYS })`) — it never reads the parent project's dates.
- **`SET_TASK_DATES`** (`src/store/AppStore.tsx:594`, guard at `:600`) — same
  self-only validation (validity, ordering, 92-day cap). No project lookup.
- **`MOVE_TASK`** (`src/store/AppStore.tsx:559`) shifts the task's existing
  period by a constant `dayDelta` and moves every dated block with it — it
  cannot violate containment any more than the task already did/didn't,
  because the period *length* never changes, only its position.
- **`SET_BLOCK_TIME`** cross-day case and **`INSERT_BLOCK`**
  (`src/store/AppStore.tsx:925`, `:695`) both widen the TASK's period to cover
  a new block date when the date falls outside the current period — guarded
  only by the 92-day cap (`inclusiveDayCount(...) > MAX_TASK_PERIOD_DAYS`,
  `AppStore.tsx:971` and `:744` respectively), never by the project's dates.
- **`SCHEDULE_BIN_PART`** (`src/store/AppStore.tsx:1263`) delegates the dated
  half of the operation straight to `setBlockTime`, so it inherits the exact
  same non-containment behavior.
- **Timeline**: dragging a **project** bar dispatches `SET_PROJECT_DATES`
  (`src/store/AppStore.tsx:143`, `:1592`) and moves ONLY the project's own
  dates — this is a documented, intentional decision (CLAUDE.md's Timeline
  bullet: *"Moving a project moves only the project dates (tasks are moved
  individually — intentional)"*). Existing tasks under that project keep
  whatever dates they already had, in or out of the (now possibly shifted)
  project window.
- **Net effect:** a task's period can freely start before, end after, or sit
  entirely outside its parent project's period, both today (via direct
  create/edit) and dynamically (a calendar drag that extends a task's period
  past its project's `endDate`, or a project date edit that leaves its tasks
  stranded outside the new window). This is not a bug in the writers above —
  each one is internally consistent and already covered by tests
  (`dateGuards.test.ts`, `blockActions.test.ts`) — it is simply an invariant
  the product has never had.

## Options

### Option A — keep (status quo, document only)

No code change. This note itself is the deliverable; CLAUDE.md's invariant
list stays as-is (containment is not claimed anywhere today, so there's
nothing to correct).

- **Cost:** none.
- **Risk:** a PM can create/drag a task whose dates visually escape its
  project's timeline bar — confusing in the Timeline view, but not
  data-corrupting (every OTHER invariant — 92-day cap, hour bounds, collision
  guards — still holds). This is the accepted status quo today; Option A just
  keeps it accepted rather than silently.

### Option B — soft warn (TaskModal / ProjectDetailPage)

Add a non-blocking Polish warning (à la the existing overload-preview pattern,
invariant 3's "warn, never block" precedent) in `TaskModal` when the draft
task's `startDate`/`endDate` fall outside the parent project's period, and
symmetrically in `ProjectDetailPage` when narrowing the project's dates would
strand an existing task. No reducer change — purely a UI-layer hint.

- **Cost:** low-to-medium. Two component-local checks, one new warning string,
  no schema/migration/reducer change. Testable the same way `wouldOverload` /
  `schedOverload` already are.
- **Risk:** low. Non-blocking by construction, so it cannot break any existing
  flow (calendar drag/resize/insert, bin scheduling, MOVE_TASK, Timeline
  drags) — it only adds a hint where a human is already looking (the task or
  project editor). Does not help the calendar-drag paths (INSERT_BLOCK,
  SET_BLOCK_TIME, SCHEDULE_BIN_PART), which have no per-block "does this still
  fit the project" UI surface today and would need their own hint if desired
  later — out of scope for a first cut of Option B.

### Option C — hard enforce containment (reducer guards)

Add a genuine invariant: task period ⊆ project period, enforced in the
reducer (reject a `SAVE_TASK` / `SET_TASK_DATES` / cross-day `SET_BLOCK_TIME`
/ `INSERT_BLOCK` / `SCHEDULE_BIN_PART` that would place the task outside its
project's dates; reject or auto-clamp a `SET_PROJECT_DATES` that would strand
an existing task).

- **Cost:** high. Every automatic-placement writer above (`SET_BLOCK_TIME`
  cross-day, `INSERT_BLOCK`, `SCHEDULE_BIN_PART`) currently WIDENS the task
  period to make room for a new block — composing that with "and the widened
  period must still fit inside the project" means either (a) rejecting valid
  today-legal drags/inserts/schedules whenever the project window is tight,
  which will surprise users mid-drag with no precedent in the app's "warn,
  don't block" placement philosophy (invariant 3), or (b) growing the
  PROJECT's dates too when a task widens — a much bigger behavior change that
  touches `SET_PROJECT_DATES` semantics and the Timeline's "project dates move
  independently of tasks" decision head-on.
- **Data-repair question (blocking for Option C specifically):** existing
  sample and any real persisted data may ALREADY have tasks outside their
  project's window (nothing has ever prevented it) — a hard-enforce migration
  would need an explicit repair policy (clamp the task? clamp the project?
  leave violators alone and only enforce on new writes?) before it could ship
  without silently breaking a reload. This is exactly the kind of "no open
  questions" decision the tiered-workflow rules require settling BEFORE a
  package is written, not during one.
- **Risk:** high. Directly conflicts with two already-shipped, tested,
  human-approved behaviors: (1) `INSERT_BLOCK`/`SET_BLOCK_TIME`'s auto-extend
  semantics (this run's own placement-core package,
  `blockActions.test.ts` cross-day/extension tests), and (2) the Timeline's
  documented "moving a project moves only the project dates" decision
  (CLAUDE.md). Enforcing C without revisiting both would just convert them
  into silent-rejection dead ends, which is the exact anti-pattern flagged as
  backlog risk elsewhere in `RUN-STATE.md` ("reducer silent-rejection
  convention — any future dispatch path must pre-validate in the UI").

## Test matrix — writer × containment scenario → expected result per option

Scenario legend: **In** = task period already inside project period (no
change). **Widen-out** = the writer would move/extend the task period to
partly or fully leave the project period. **Project-shrinks** = a
`SET_PROJECT_DATES` narrows the project period so an existing task now falls
outside it.

| Writer | In | Widen-out (Option A) | Widen-out (Option B) | Widen-out (Option C) | Project-shrinks (Option A) | Project-shrinks (Option B) | Project-shrinks (Option C) |
|---|---|---|---|---|---|---|---|
| `SAVE_TASK` (`AppStore.tsx:268`) | unchanged, succeeds | succeeds silently | succeeds + soft warning in TaskModal | rejected (state unchanged) unless a repair/clamp policy is chosen | n/a (task not touched) | n/a | n/a |
| `SET_TASK_DATES` (`:594`, Timeline task-resize) | unchanged, succeeds | succeeds silently | succeeds + soft warning next open of TaskModal | rejected | n/a | n/a | n/a |
| `MOVE_TASK` (`:559`, Timeline task-drag) | unchanged, succeeds | succeeds silently (period length constant, position can still exit the project window) | succeeds + soft warning next open | rejected (or clamped to stay in-window, TBD) | n/a | n/a | n/a |
| `SET_BLOCK_TIME` cross-day (`:925`, calendar drag to another day) | unchanged, succeeds | succeeds, period auto-extends (current behavior, tested) | succeeds + soft warning next TaskModal open (no live calendar-side hint in a first cut) | rejected atomically — a currently-legal drag now silently fails unless a live calendar warning is added too (extra scope) | n/a | n/a | n/a |
| `INSERT_BLOCK` (`:695`, right-click insert) | unchanged, succeeds | succeeds, period auto-extends within the 92-day cap (current behavior, this run's placement-core package) | succeeds + soft warning next TaskModal open | rejected atomically — same live-warning gap as above | n/a | n/a | n/a |
| `SCHEDULE_BIN_PART` (`:1263`, "Zaplanuj część") | unchanged, succeeds | succeeds, inherits `SET_BLOCK_TIME`'s auto-extend | succeeds + soft warning next TaskModal open | rejected atomically — same live-warning gap | n/a | n/a | n/a |
| Timeline project move (`SET_PROJECT_DATES`, `:1592`) | n/a | n/a | n/a | n/a | succeeds; tasks keep their dates, now possibly outside the shifted window (current, documented behavior) | succeeds + soft warning in ProjectDetailPage listing which tasks now fall outside | rejected, OR succeeds with an auto-clamp of the stranded tasks — repair policy question above applies here too |

## Closing line

**No option is enacted by this run.** Current behavior (Option A's status
quo) remains exactly as shipped and verified above. A human must pick A, B,
or C — and for C, additionally settle the data-repair policy — before any
follow-up package is written.
