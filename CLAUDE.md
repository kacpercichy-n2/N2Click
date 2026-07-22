# N2Hub Planner — agent guide

N2Hub is a Polish React/Vite planner for clients, projects, tasks and scheduled
work. Keep all new user-facing strings in Polish.

## Start with selective context

Read this file, then read only the `## Wiki context` files declared by the
prompt or handoff. The context map is [openwiki/n2hub/INDEX.md](openwiki/n2hub/INDEX.md).
Open only the declared touchpoints and direct dependencies; do not scan historic
handoffs, unrelated pages or the whole repository “just in case”. If the task
changes an area not covered by its wiki context, add that context deliberately
and record why.

## Commands

```bash
npm test
npm run build
```

Run focused unit tests first. Run the relevant browser check only when its
covered interaction changes; release verification owns the full browser matrix.

## Global architecture

- Vite 5, React 18, TypeScript strict, React Router 6, date-fns, plain CSS,
  `motion` (Framer Motion) for animation and `lucide-react` for icons.
  No UI framework, Tailwind or drag library.
- `src/store/AppStore.tsx` is the only mutation boundary; every change is a
  reducer action. `src/store/selectors.ts` owns derived reads.
- `src/store/storage.ts` is the only localStorage boundary. There is no backend,
  real authentication, authorization or multi-user synchronization.
- Persisted dates are `yyyy-MM-dd`; time-of-day is `WorkloadEntry.startMinutes`.
  Use `src/utils/dates.ts` and `src/utils/time.ts`, never duplicate their logic.
- Current data version is 7. Storage repairs legacy data on load. A failed save
  must never report `Zapisano`; same-browser tab conflicts must remain explicit.

## Frontend primitives and performance

- Shared dialogs, overlays, popovers, selects, menus and rendering-sensitive
  interactions must start with the focused context in
  `openwiki/n2hub/frontend-performance-and-primitives.md`.
- Before writing custom primitive behavior, compare at least two current primary
  sources such as Radix, shadcn/ui, Base UI, React Aria, Astryx by Meta, MUI,
  browser specifications or web.dev. Libraries are references unless the task
  explicitly approves adopting one.
- GPU/compositor claims require a trace and a check on the device that reports
  the problem. Do not treat `will-change`, `translateZ(0)`, filters or blur as
  automatic optimizations.

## Hard invariants

1. Planned hours live only in `WorkloadEntry`; totals are derived.
2. A task period is at most 92 days; hours use 0.25h and time uses 15-minute
   increments.
3. Overload is a warning. Same-person collision blocks calendar drag/resize and
   automatic placement, but deliberate TaskModal allocation edits may overlap.
4. One bin row exists per `(taskId, personId)`; partial scheduling preserves its
   identity and is atomic.
5. Completion comes from `Status.isDone`, never order. At least one active and
   one done status must remain.
6. Invalid reducer commands preserve the prior state reference. Valid existing
   task-save reconciliation and date guards must not regress.
7. Calendar/bin pointer cleanup, rendered-column targeting and browser scenarios
   are stability-sensitive; change them only with the scheduling wiki context.

## Scope guardrails

Do not add a backend, cloud sync, real auth, file attachments, notifications,
billing, timers, task dependencies, advanced reporting or a separate content
calendar without an explicit request. Client-side checks are UX/data-integrity
only, never a security boundary.

## Wiki maintenance

At the end of a green task, update the declared wiki page only if the changed
boundary, invariant or test route is now inaccurate. Otherwise report `wiki
unchanged` and why.
