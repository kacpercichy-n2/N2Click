# Handoff: Build the shared overlay/popover primitive and migrate the four menu/popover call sites

- Package ID: PKG-20260727-overlay-layer-primitive
- Status: ready
- Tier: developer
- Depends on: none
- Risk: high
- Codex review: required — outside-dismiss changes are calendar pointer-lifecycle adjacent (CLAUDE.md invariant 7) and four call sites migrate at once

## Goal

One repo-owned overlay primitive (pure `overlayShell.ts` + thin `useOverlay.ts`
hook/portal, no new dependency) providing measured flip/shift positioning,
reposition-on-scroll, a single portal root, a topmost-only Escape layer stack,
paired `pointerdown`→`click` outside dismiss and optional menu keyboard support
— with the three WeekView context menus and the FilterPanel popover migrated to
it while every domain action, recurrence path and pointer-drag path stays
bit-identical.

## Wiki context

- `openwiki/n2hub/scheduling-and-calendar.md`
- `openwiki/n2hub/ui-navigation-and-onboarding.md`

## Expected touchpoints

- `new: src/components/overlayShell.ts` — pure logic (no DOM imports), pattern-parallel to `src/components/modalShell.ts`
- `new: src/components/overlayShell.test.ts` — vitest node tests (runner only picks up `src/**/*.test.ts`; environment is `node`, there is NO React testing library — the testable surface MUST be pure functions)
- `new: src/components/useOverlay.ts` — thin DOM layer: `useOverlay` hook + `OverlayLayer` portal component (`createPortal(children, root)` needs no JSX; if you prefer JSX use `new: src/components/useOverlay.tsx` instead — do NOT create both, and do NOT name any file `overlayLayer.*` next to `OverlayLayer.*` on this case-insensitive filesystem)
- `src/components/WeekView.tsx` — menu state/refs 1382–1424, three dismiss effects 1462–1524, clamp math at 1541–1542, 1592–1593, 1676–1677, 1743–1744, renders at 2128–2364 (`menu`), 2366–2401 (`slotMenu`), 2403–~2540 (`recurMenu`)
- `src/components/FilterPanel.tsx` — lines 50–68 (open state + dismiss effect), trigger button 73–82, popover 83–138
- `src/styles.css` — `:root` (line 11) z-index tokens; `.context-menu` (4575), `.filter-popover` (5354); overlay-ladder comment at ~753–756

## Invariants

- Domain actions bit-identical: every dispatch (`INSERT_BLOCK`, `SPLIT_BLOCK`,
  `DELETE_BLOCK`, `SCHEDULE_BIN_PART` path via `confirmSchedule`,
  `SET_RECURRENCE_OVERRIDE`, `SET_OCCURRENCE_DONE`, `SET_TASK_STATUS`) and every
  guard (`insertDisabled`, `schedDisabled`, `recurEditError`, permission gates in
  `openSlotMenu`/`openRecurMenu`) is untouched — only the popover shell changes.
- Recurrence paths stay fully separate: `recurMenu` remains its own state keyed
  on `(taskId, date)`; occurrence edits never route through SAVE_TASK.
- Pointer-drag behavior bit-identical (CLAUDE.md invariant 7): do NOT touch
  `TimedBlock.begin`, `BinCard.begin`, `useTouchDragGate`/`gate.arm`,
  `startDrag`, the window pointermove/up/cancel/blur cleanup, the engaged-lock
  capture-phase `contextmenu` suppressor, rendered-column hit-testing, or the
  drag-ghost portals (WeekView.tsx 705–719, 1161–1184, 1191–1213). The new
  dismiss listeners are passive observers only: never `preventDefault`,
  `stopPropagation` or pointer-capture on any pointer/click event.
- The framer-motion ref rule (WeekView.tsx comment 2139–2144) stays: the menu
  ref lives on the plain inner `<div>`, never on the `motion.div`
  (AnimatePresence PopChild reads `children.props.ref`; React 18.3 warns).
  Enter/exit animations (`opacity`/`scale`, 0.12 s) are preserved.
- No new runtime dependencies (`package.json` dependencies unchanged); Radix/
  Base UI/Floating UI are reference reading only.
- Polish user-facing strings unchanged; retirement mode stays disabled.
- FilterPanel keeps `role="dialog"`, its radio/date inputs and its mobile
  breakpoint layout (`position: static` in-flow popover at narrow widths) —
  therefore FilterPanel is NOT portaled (see Prior decisions).
- The z-index ladder keeps today's numeric order (context-menu 100 < gs 990/991
  < modal 1000/1001 < banner 1050 < toast 1090 < onboarding 1100; drawer
  900–903; drag ghosts 1000); no unrelated selector is reshuffled.
- Invalid reducer commands still preserve prior state; no store/selectors/storage
  changes at all in this package.

## Scope

1. **Pure module `src/components/overlayShell.ts`** (mirror the
   `modalShell.ts` style: descriptor inputs, zero DOM):
   - `resolveOverlayPosition(anchor, size, viewport, opts)` where `anchor` is a
     plain rect `{left, top, width, height}` (a point anchor is a 0×0 rect),
     `opts` = `{ placement: 'bottom-start' | 'right-start' (context menus use
     the click point, i.e. 0×0 anchor + 'bottom-start'), offset (px), margin
     (viewport inset, default 8) }`. Returns `{ left, top, placement,
     availableHeight }`: **flip** to the opposite side when the preferred side
     lacks room and the other side has more; **shift** = clamp horizontally and
     vertically into `viewport − margin`; `availableHeight` = space from the
     resolved top to the viewport edge minus margin (drives the CSS variable).
   - `createOverlayStack()` → `{ push(id), remove(id), isTop(id), count() }`.
     Re-push of an existing id moves it to the top. The DOM layer holds ONE
     module singleton (same pattern as `scrollLock` in `useModalShell.ts`).
   - Outside-dismiss state machine, e.g. `createDismissState()` +
     `resolveDismissEvent(state, event)` with events
     `'pointerdown-inside' | 'pointerdown-trigger' | 'pointerdown-outside' |
     'click-inside' | 'click-trigger' | 'click-outside' |
     'contextmenu-outside'` → `{ close: boolean; next: state }`. Rules: close
     only on the pair `pointerdown-outside` then `click-outside` (auxclick
     counts as click); `contextmenu-outside` closes immediately (right-clicks
     never produce `click`, and today's `mousedown` dismiss must not regress
     into a stuck menu); anything inside or on the trigger disarms; a
     `click-outside` with no armed pointerdown does NOT close (this is the
     scrollbar-drag and same-frame fix).
   - Menu keyboard resolvers: `resolveMenuNavKey(key, currentIndex, count)` →
     next index (`ArrowDown`/`ArrowUp` wrap, `Home`/`End`, else `null`;
     `currentIndex === -1` means focus not yet in the list → ArrowDown = 0,
     ArrowUp = last) and `matchTypeahead(labels, buffer, fromIndex)` →
     locale-lowercased prefix match scanning forward with wrap (Polish labels).
2. **DOM layer `src/components/useOverlay.ts`**:
   - `getOverlayRoot()` lazily appends one `<div id="n2hub-overlay-root">` to
     `document.body`; `OverlayLayer({ children })` renders
     `createPortal(children, getOverlayRoot())`. The portal WRAPS the
     AnimatePresence (portal node persists, so exit animations still play).
   - `useOverlay(options)` with: `open`, `onClose`, `getAnchorRect: () =>
     DOMRect | null` (return null when the anchor element is disconnected —
     the hook then closes), `overlayRef` (the positioned element to measure),
     `triggerRef?` (optional — FilterPanel only), `menuKeyboard: boolean`,
     placement/offset options. Returns `{ style: { left, top,
     '--overlay-avail': px }, ... }` for the positioned element.
   - Layer stack + Escape: on open push a unique id; on close/unmount remove
     it. Window `keydown` listener in CAPTURE phase: Escape closes ONLY when
     `isTop(id)`, then calls `event.stopPropagation()` so lower layers and
     `useModalShell`'s bubble-phase Escape never also fire. Do not modify
     `useModalShell`/`modalShell.ts`; modals are simply beneath the stack.
   - Dismiss listeners register ONE TICK after open (rAF or `setTimeout 0`) so
     the opening interaction can never dismiss in the same frame; window-level
     `pointerdown` (capture, read-only), `click`, `auxclick`, `contextmenu`
     (bubble, read-only) feed the pure state machine using
     `overlayRef.current.contains(target)` / `triggerRef` checks. Trigger
     pointer events are classified `-trigger` so the trigger's own onClick
     toggle closes without a reopen race.
   - Reposition instead of closing: window `scroll` (capture: true) and
     `resize` re-measure `getAnchorRect()` + overlay size through
     `resolveOverlayPosition`, throttled with rAF, applied as a style-only
     state update — same element, same keys, NO remount, so focused inputs in
     `form`/`schedule`/`edit` steps keep focus and caret.
   - Menu keyboard (only when `menuKeyboard` is true): roving tabindex over the
     overlay's `[role="menuitem"]:not(:disabled)` elements in DOM order
     (active item `tabindex=0`, rest `-1`), ArrowUp/Down/Home/End/typeahead
     move focus; do NOT steal focus on open (pointer-opened menus keep today's
     feel and form-step `autoFocus` untouched); printable keys feed typeahead
     with a ~500 ms reset buffer. When `menuKeyboard` is false the hook adds
     no key handling beyond Escape.
   - Focus return on close: if `document.activeElement` is inside the overlay
     (or `<body>`), focus `triggerRef` — or, absent a trigger, the stored
     anchor element — when it is still connected; otherwise leave focus alone.
3. **Migrate the three WeekView menus** (shell only):
   - Delete the three dismiss effects (1462–1476, 1482–1501, 1505–1524) and
     the magic-number clamps (`window.innerWidth - 240/280`,
     `window.innerHeight - 100/240/260`); store an anchor at open instead of
     clamped x/y: for `openMenu`/`openSlotMenu`/`openRecurMenu` capture the
     anchor ELEMENT (`e.currentTarget`: the block, the day column, the
     occurrence overlay) plus the click offset inside it, so `getAnchorRect`
     re-derives a 0×0 point rect from `element.getBoundingClientRect()` +
     offset on every reposition; for `openSchedule` the anchor is the button
     rect with `placement 'bottom-start'`, offset 4 (mirrors `rect.bottom + 4`).
   - Wrap each existing `<AnimatePresence>` block in `<OverlayLayer>`; keep the
     `motion.div className="context-menu"` + inner plain `<div ref={...}>`
     structure and all children byte-identical apart from the positioning
     style now coming from the hook.
   - Per-site behavior: all three menus now REPOSITION on scroll/resize
     (`slotMenu`/`recurMenu` stop closing on scroll; `menu` stops drifting);
     a disconnected anchor closes the menu. `menuKeyboard` is
     `menu.step === 'menu'`, `true` for `slotMenu`, `recurMenu.step === 'menu'`
     — never in `form`/`schedule`/`edit` steps (inputs own arrows/typing).
     The existing cross-clears (`setMenu(null)` in `openSlotMenu`, etc.) stay.
4. **Migrate FilterPanel**: keep the in-flow `.filter-popover` (NO portal, no
   measured positioning — CSS anchoring and the mobile static breakpoint stay);
   replace the lines 54–68 effect with `useOverlay` (stack + Escape topmost +
   paired dismiss + trigger classification via the „Filtry” button ref);
   `menuKeyboard: false`; markup and radio/date/extra content unchanged.
5. **z-index tokens** in `src/styles.css`: add to `:root` (unchanged values)
   `--n2-z-popover: 40; --n2-z-menu: 100; --n2-z-drawer: 900; --n2-z-search:
   990; --n2-z-modal: 1000; --n2-z-banner: 1050; --n2-z-toast: 1090;
   --n2-z-onboarding: 1100;` and rewire ONLY `.filter-popover`
   (`var(--n2-z-popover)`) and `.context-menu` (`var(--n2-z-menu)`); update the
   ladder comment at ~753 to point at the tokens. All other selectors keep
   their literals. `.context-menu` additionally gains
   `max-height: var(--overlay-avail, 80vh); overflow-y: auto;` — the
   available-height variable replaces the old bottom clamps (grep confirmed
   `.context-menu` is used ONLY by these three WeekView menus).
6. **Unit tests** in `src/components/overlayShell.test.ts` — see Acceptance.

## Out of scope

- Any change to reducers, selectors, storage, permissions or persisted data.
- Any change to drag entry points, `useTouchDragGate`, collision logic,
  `packDayBlocks`, free-slot search or rendered-column hit-testing.
- Migrating `useModalShell` consumers, GlobalSearch, OnboardingRoot or the
  mobile drawer onto the overlay stack (modals stay beneath it untouched).
- Portaling FilterPanel or animating it; changing FilterPanel's mobile layout.
- New dependencies, generic re-usable animation options, hover/submenu support,
  touch long-press menus, or adopting the primitive at any fifth call site.
- Rewriting z-index literals outside `.context-menu`/`.filter-popover`.

## Acceptance

- [ ] `src/components/overlayShell.ts` has zero DOM imports and `useOverlay.ts`
      contains no positioning/stack/dismiss decisions of its own (thin layer),
      matching the `modalShell.ts`/`useModalShell.ts` split.
- [ ] `overlayShell.test.ts` covers at least: flip when the preferred side
      cannot fit but the opposite can; no flip when neither fits better;
      horizontal and vertical shift clamping with margin; `availableHeight`
      values before/after flip; stack: Escape eligibility `isTop` only for the
      last-pushed id, re-push moves to top, remove of a middle id keeps order;
      dismiss: pointerdown-outside→click-outside closes; click-outside alone
      (scrollbar drag / same-frame open) does NOT close; pointerdown-inside
      then click-outside does NOT close; trigger events never close;
      contextmenu-outside closes; menu keys: arrow wrap, Home/End, `-1` entry
      behavior, typeahead wrap on Polish labels.
- [ ] Right-clicking a week block opens the block menu inside
      `#n2hub-overlay-root`, with enter/exit animation intact and the ref still
      on the inner plain div; near the right/bottom viewport edge the menu
      flips/shifts fully on-screen instead of using `- 240/280` clamps.
- [ ] Scrolling the week grid while `slotMenu`/`recurMenu`/`menu` is open moves
      the menu with its anchor (no close, no drift); with the `schedule`
      form open and its hours input focused, scrolling does not blur the input.
- [ ] Starting a drag on the scrollbar or starting a text-selection inside a
      menu and releasing outside does NOT close the overlay; a full
      click outside does; Escape closes only the topmost open layer (with a
      TaskModal open under an open FilterPanel popover, first Escape closes the
      popover, second the modal).
- [ ] In a `role="menu"` step, ArrowDown/ArrowUp/Home/End/typeahead move focus
      between menu items and closing with Escape returns focus to the
      originating block/occurrence (WeekView) or the „Filtry” button
      (FilterPanel); FilterPanel's radios get NO roving/typeahead behavior.
- [ ] Every menu item still dispatches exactly the same action with the same
      payload (diff shows shell-only changes around the menu JSX), and mouse
      drag of blocks/bin cards behaves exactly as before.
- [ ] `git diff` on `package.json` dependencies is empty; new z-index values
      appear only as the `:root` tokens with today's numbers.

## Verification

- Worker: `npx vitest run src/components/overlayShell.test.ts` (then a full
  `npm test` and `npm run build` locally before reporting)
- Browser: `node scripts/browser-check-bin-split.mjs chromium` and
  `node scripts/browser-check-bin-drag.mjs chromium` — the „Zaplanuj część”
  menu shell changed and dismiss listeners are drag-adjacent
- Scheduler owns final `npm run test:scheduler && npm test && npm run build`.

## Prior decisions

- **Portal vs AnimatePresence**: one lazily-created `#n2hub-overlay-root` on
  `document.body`; `OverlayLayer` (the portal) WRAPS each existing
  `<AnimatePresence>` so exit animations survive; `motion.div` + inner-ref-div
  structure is preserved verbatim. FilterPanel is deliberately NOT portaled:
  its popover participates in normal flow at the mobile breakpoint
  (`position: static`, styles.css 5455–5463) and anchors by CSS, so it adopts
  only the stack/dismiss/focus parts of the hook.
- **Scroll**: all three WeekView menus reposition on scroll/resize via a
  stored anchor element + offset (element-relative, so grid scroll moves them
  correctly); disconnected anchor ⇒ close; style-only updates guarantee no
  focus theft in form steps. FilterPanel scrolls with its anchor natively and
  needs no listener.
- **Trigger semantics**: `triggerRef` is optional. FilterPanel keeps its
  button-onClick toggle (dismiss machine classifies trigger events so no
  close-reopen race). Context menus have no trigger: "toggle" does not apply
  (re-right-click re-anchors, as today) and focus-return targets the
  originating anchor element when still connected, else is skipped.
- **Menu vs dialog**: the keyboard layer is driven ONLY by the explicit
  `menuKeyboard` flag per render — true for menu-list steps of the three
  WeekView menus, false for all form steps and for FilterPanel's dialog.
- **Dismiss vs drag gate**: pointer/click listeners are read-only observers
  (no preventDefault/stopPropagation/capture-claiming), registered one tick
  after open; the pair rule means a drag that never completes a click leaves
  the overlay open — acceptable and intended (scrollbar fix); nothing in
  `gate.arm`/`startDrag`/window drag cleanup may be edited.
- **Escape cooperation**: `useModalShell` keeps its bubble-phase Escape;
  the overlay stack uses capture + `stopPropagation` only when the topmost
  overlay consumes Escape, which yields correct overlay-above-modal layering
  without touching the modal shell.
- **z-index**: tokens document the existing ladder; only the two overlay
  selectors switch to `var()`; numbers are unchanged everywhere.
- **Test surface is pure-only**: vitest runs in `node` env with
  `src/**/*.test.ts` (vitest.config.ts) and no React testing library exists,
  so all decision logic lives in `overlayShell.ts`.
