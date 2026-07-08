# Handoff: Calendar/TaskModal budget UI + unclipped bin drag ghost

- **Package ID:** PKG-20260708-b2-calendar-ui
- **Status:** ready
- **Tier:** developer
- **Model:** opus
- **Depends on:** PKG-20260708-b2-budget-store
- **Blast radius:** low — UI-only (WeekView, TaskModal, styles); reducer already enforces.

## Goal

Two user-facing fixes: (1) every UI hour-creation path mirrors the reducer's budget rules — live Polish warnings + disabled confirm in the week-view insert form, and a non-blocking "przekroczono szacunek" state in TaskModal (which is the sanctioned place to consciously over-plan / raise the estimate); (2) dragging a card out of the bin pane no longer renders an invisible block — the drag ghost escapes the pane's overflow clipping.

## Context the worker needs

- Relevant files: `src/components/WeekView.tsx` (`BinCard` ~L440-578 incl. `BinDragState`; insert form ~L975-1031; `TimedBlock` drag begin ~L160-165 — already made number-safe by the store package), `src/components/TaskModal.tsx` (estimate input ~L624-655, `estimate-compare` row ~L638-655, save handler ~L486, totals ~L507-527, `addBinHours` ~L541-546), `src/styles.css` (`.week-bin-pane` ~L1393, `.week-bin-block` styles, `.context-warning`), `src/store/selectors.ts` (`taskGrowAllowance` — new from the store package).
- Conventions: CLAUDE.md. Polish strings; `--n2-danger` / `-soft` tokens for danger tints; `prefers-reduced-motion` respected; the week grid's `user-select: none` must survive; no new dependencies.
- Prior decisions (architect — final):
  1. **Insert form warning + disable.** Allowance for the form = `taskGrowAllowance(state, insertTaskId, menu.entry.personId)` (recomputed when the task select changes). When `parsedHours > allowance`: show a second `context-warning` line — `⚠ Budżet zadania pozwala dodać najwyżej {formatDuration(allowance)}.`, or when allowance is 0: `⚠ Brak dostępnych godzin w budżecie zadania — zwiększ szacunek lub godziny w edytorze zadania.` — and disable the `Wstaw` button. The existing capacity warning stays as a separate line (both can show).
  2. **TaskModal over-budget state (non-blocking).** Draft total = `plannedTotalAll + binTotal` (this equals the post-save task total). When the estimate field parses to a number and draft total exceeds it: render under `.estimate-compare` a live banner `⚠ Przekroczono szacunek o {formatDuration(draftTotal − est)}. Zwiększ szacunek lub ogranicz godziny.` with class `estimate-over`, and add an `over-budget` class to the "zaplanowano" strong (danger-tinted). Saving stays allowed — the grid/bin/fill are the deliberate re-planning surface. No confirm dialog.
  3. **Estimate snaps on save** (closes a reviewer backlog item): in the save handler, `estimatedHours = raw.trim() === '' || isNaN(n) || n <= 0 ? null : snapHours(n)` (`snapHours` from `src/utils/time.ts` rounds to 0.25 without clamping — a 40h estimate stays 40h). The over-budget comparison may use the raw parsed number live.
  4. **Bin drag ghost.** While a `BinCard` drag is active, render the visual card as a `position: fixed` ghost via `createPortal(…, document.body)` following the pointer (track `clientX/clientY` in `BinDragState`; capture the card's `offsetWidth` at drag begin so the ghost keeps its size). The in-pane original stays mounted (pointer capture and all handlers remain on it) with a `drag-source` class (dimmed, ~0.35 opacity). The ghost is purely visual: `pointer-events: none`, high z-index, reuses the `week-bin-block` look, and carries the `colliding` danger tint exactly as the current dragged card does. Drop math (pointer-based, `gridRef`/`viewportRef` rects) is untouched. Escape-cancel and click-vs-drag (`moved` ref) behavior unchanged.
  5. `WeekView`'s resize `maxHours` needs no further logic change (store package made the selector number-only); just verify the at-cap clamp still reads correctly for previously-unbudgeted tasks (title `Limit czasu zadania — brak godzin w zasobniku` now also applies to them — keep it).

## Scope

### In scope

- `src/components/WeekView.tsx`: insert-form allowance warning + `Wstaw` disable (decision 1); BinCard ghost portal (decision 4).
- `src/components/TaskModal.tsx`: over-budget banner + totals styling (decision 2); estimate snap on save (decision 3).
- `src/styles.css`: `.estimate-over` (danger-soft banner), `.over-budget` accent, `.week-bin-block.drag-source`, ghost class (e.g. `.week-bin-ghost`) — fixed positioning, pointer-events none, z-index above the context menu/modals.

### Out of scope

- Any reducer/selector/storage change (done in PKG-20260708-b2-budget-store). AllocationGrid internals (the banner lives in TaskModal, which owns the totals). Blocking saves or confirms in TaskModal. Impersonation files (`App.tsx`). New unit tests (interaction-only; PKG-20260708-b2-tests covers the store).

## Implementation notes

- The insert form already computes `parsedHours`, `wouldOverload`, `projectedTotal` — follow that memo pattern for the allowance.
- Ghost positioning: simplest is `style={{ left: drag.clientX + offsetX, top: drag.clientY + offsetY }}` from the pointer with the grab offset captured at begin (so the card doesn't jump under the cursor). Remove the old `transform: translate(dx, dy)` from the in-pane original (it becomes the static dimmed source).
- `transform`/`position: fixed` gotcha: don't leave any `transform` on an ancestor chain assumption — the portal to `document.body` avoids all of it.
- No motion/animation is added, so `prefers-reduced-motion` needs no new handling — just don't introduce transitions on the ghost.

## Acceptance criteria

- [ ] Insert form: hours above allowance ⇒ warning line (correct Polish text incl. the 0-allowance variant) and disabled `Wstaw`; at/below allowance ⇒ no warning, insert dispatches and succeeds (reducer no longer silently swallows it).
- [ ] Changing the task in the insert picker recomputes the allowance.
- [ ] TaskModal: setting allocations/bin adds/"Wypełnij dni robocze" past the estimate shows the live `Przekroczono szacunek o …` banner and danger-tinted total; lowering hours or raising the estimate clears it; saving remains possible.
- [ ] TaskModal saves a snapped estimate (e.g. `40.1` → `40`, `40` stays `40`); empty/invalid/≤0 saves `null`.
- [ ] Bin card drag: ghost stays visible across the whole viewport (over the grid, header, axis), shows the danger tint over a colliding slot, drops exactly as before, snaps home on Escape/invalid drop; the source card sits dimmed in the pane during the drag; plain click still opens the task.
- [ ] Week grid `user-select: none` intact; console free of errors/warnings.

## Tests

- Command: `npx tsc --noEmit && npm test && npm run build`
- Expected: tsc clean; vitest green at the store package's count (no unit-test changes here); build OK (pre-existing chunk-size warning only). Interactive criteria go to the human walkthrough list in RUN-STATE.

## Report back

Synthesized summary only (files changed one-line each, test counts, deviations, the not-CLI-verifiable list for the human walkthrough). Append a worker-log block to `handoffs/RUN-STATE.md`. No raw logs.
