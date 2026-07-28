# Run state — 20260728-064406-n2hub-291 store performance

## Goal

Store render performance in mandatory order: (W02) reference-keyed selector
cache + per-revision indexes in `selectors.ts`, (W01a) split the store context
into StateContext + stable StoreApiContext, (W01b) external store +
`useSelector`/`useSyncExternalStore` with a short named migration list (useCan,
TodayAgenda, SampleBanner, WeekView dispatch-only sites), (W01c) drop the whole
`state` prop from memoized `TimedBlock`/`BinCard` (RecurBlock already narrow).
Reducer semantics byte-identical; no new deps; retirement mode untouched.

## Packages (execution order)

1. `handoffs/PKG-20260728-store-performance.md` — developer, ready, risk high,
   Codex required. ONE package with four ordered, individually verifiable steps
   (order is load-bearing; tests inseparable, so no test-writer split).

## Changed boundaries (planned)

`src/store/selectorCache.ts` + `src/store/externalStore.ts` (new, pure),
`selectors.ts` hot-selector rewiring (named list only), `AppStore.tsx` provider
region (contexts, external store, useSelector/useDispatch/useStoreApi; reducer
body untouched), `useCan.ts`, `TodayAgenda.tsx`, `SampleBanner.tsx`,
`WeekView.tsx` leaf props. Invariant-6 evidence: 191 `return state;` sites +
`mergeCloudEntities` same-reference rejects make WeakMap keying sound.

## Verification

Per step `npx vitest run src/store`; focused set named in the package; browser
`browser-check-bin-drag.mjs` + `browser-check-placement.mjs` after W01c; then
scheduler-owned full `npm test && npm run build` (no `test:scheduler` script).

## Developer result (W02 → W01a → W01b → W01c, all four applied)

New `selectorCache.ts`/`externalStore.ts` (+ tests), `selectors.ts` indexes,
`AppStore.tsx` StateContext/StoreApiContext + useSelector, `useCan`/
`TodayAgenda`/`SampleBanner`/`WeekView` migrated, `state` prop dropped from
`BlockProps`/`BinCardProps`. Per-step `vitest run src/store` green; final
`npm test` 2003 pass / 0 fail, `npm run build` green, zero existing test files
edited. Blocker: browser checks unrunnable — playwright is not installed.

## Open questions

None blocking. Deferred (recorded, not routed): migrating DashboardPage /
CalendarPage / App shell to useSelector; removing the WeekView/MonthView
`state` prop. Wiki: `state-and-persistence.md` will need a selector-cache +
context-split bullet if green — final reviewer owns that call.

## Developer result (PKG-20260728-code-splitting-lazymotion)

New `src/pages/routeChunks.ts` (lazy routes + `prefetchRoute`); `App.tsx`
Suspense inside providers + hover prefetch; `main.tsx` `LazyMotion domAnimation
strict`; 11 files `motion.*`→`m.*`; Kanban `layout` dropped (no CSS swap —
`whileHover` owns transform); `vite.config.ts` react/motion/supabase chunks,
`cssCodeSplit:false`, `optimizeDeps lucide-react`. Entry gzip 355.80→120.40 kB,
one CSS asset. `npm test` 2003/2003, build green. Wiki bullet updated.

## Developer result (n2hub-302 kanban drag ghost)

New pure `src/pages/kanbanDragGhost.ts` (+ 15 tests): grab offset, clone
position, `translate3d`+tilt transform, click-slop visibility. `KanbanPage`
renders an `aria-hidden` clone in `OverlayLayer`, positioned in the EXISTING
rAF frame; `.dragging` now a dashed empty slot. `endDrag` clears the clone on
every exit path. `npm test` 2138/2138, build green. No browser check —
playwright still absent.

Follow-up: dead export `ghostVisible` removed (never imported by KanbanPage —
`movedRef` latch owns visibility, and a component-side call would need a new
`viaHoldRef` + manual sticky-OR). Its 4 tests folded into `exceedsClickSlop`,
now the sole latch input, with the touch/`viaHold` path documented in module +
test comments. File 15→14 tests. `npm test` 2137/2137, build green.
