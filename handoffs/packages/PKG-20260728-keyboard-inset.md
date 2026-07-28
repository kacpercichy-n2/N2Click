# Handoff: visualViewport keyboard inset for modal sheets (MO-22)

- Package ID: PKG-20260728-keyboard-inset
- Status: ready
- Tier: developer
- Depends on: PKG-20260728-alloc-day-list (soft — both edit the same
  `@media (max-width: 760px)` modal block in `src/styles.css`; run second)
- Risk: medium
- Codex review: required — touches the SHARED modal shell used by TaskModal,
  EventModal, TicketModal, ChangelogModal and ConfirmProvider.

## Goal

On phones, when the on-screen keyboard opens, the modal card shrinks by the
keyboard height (`--n2-kb-inset`), so the sticky footer (save bar, comment
submit) stays visible above the keyboard and the focused field is scrolled into
view. Today there is ZERO `visualViewport` handling in `src/` — the iOS
keyboard covers the bottom ~336 px.

## Wiki context

- `openwiki/n2hub/ui-navigation-and-onboarding.md` (modal shell section)

## Expected touchpoints

- `new: src/components/keyboardInset.ts` — pure logic (node env)
- `new: src/components/keyboardInset.test.ts`
- `src/components/useModalShell.ts` — one NEW effect (DOM wiring)
- `src/styles.css` — inside the EXISTING `@media (max-width: 760px)` block at
  ~line 5204: `.task-modal-card` gains
  `max-height: calc(94dvh - var(--n2-kb-inset, 0px));` (replacing the plain
  `max-height: 94dvh` IN THAT BLOCK ONLY)

## Invariants

- Desktop bit-identical: the CSS var is consumed ONLY inside the ≤760 px media
  block, and the effect must no-op entirely when
  `window.matchMedia(MOBILE_NAV_QUERY).matches` is false or
  `window.visualViewport` is undefined. The base (desktop) `.task-modal-card`
  rule at ~line 5105 does not change.
- `useModalShell` contract stays intact: focus entry/trap/return, Escape via
  `onRequestClose`, shared scroll-lock counter, backdrop pair-click, `stacked`
  capture behavior — all byte-identical. The new effect only ADDS listeners; it
  never calls `preventDefault`/`stopPropagation` and never moves focus.
- `modalShell.test.ts` must stay green untouched.
- No reducer/store changes (invariant 6). No new runtime dependencies.
- `OnboardingRoot` and `GlobalSearch` have their own handling and do NOT use
  the shell — leave them alone.

## Scope

1. **Pure `keyboardInset.ts`** (Polish comments, node-testable):
   - `export const KEYBOARD_INSET_MIN_PX = 80;` — below this the difference is
     browser-chrome jitter (URL bar), not a keyboard; treat as 0.
   - `resolveKeyboardInset(input: { innerHeight: number; viewportHeight: number; offsetTop: number }): number`
     — `raw = innerHeight - viewportHeight - offsetTop`, clamp negatives to 0,
     return 0 when `raw < KEYBOARD_INSET_MIN_PX`, else `Math.round(raw)`.
   - `shouldScrollFieldIntoView(inset: number, activeInsideCard: boolean): boolean`
     — true only when `inset > 0 && activeInsideCard`.
2. **Tests**: no keyboard (equal heights) → 0; 40 px chrome jitter → 0; 336 px
   keyboard → 336; keyboard with `offsetTop` > 0 accounted; negative raw → 0;
   `shouldScrollFieldIntoView` truth table.
3. **`useModalShell.ts` wiring** — one additional `useEffect(() => {…}, [])`:
   - guard: `const vv = window.visualViewport; if (!vv) return;` — also bail
     when `!window.matchMedia(MOBILE_NAV_QUERY).matches` (import
     `MOBILE_NAV_QUERY` from `../utils/useMediaQuery`; re-check `matches`
     inside the handler so rotation/resize mid-open behaves).
   - handler on vv `resize` + `scroll`: compute
     `resolveKeyboardInset({ innerHeight: window.innerHeight, viewportHeight: vv.height, offsetTop: vv.offsetTop })`
     and `cardRef.current?.style.setProperty('--n2-kb-inset', `${inset}px`)`
     (remove the property when 0).
   - when `shouldScrollFieldIntoView(inset, card.contains(document.activeElement))`,
     call `document.activeElement.scrollIntoView({ block: 'nearest' })`.
   - also listen for `focusin` on the card: with a nonzero current inset,
     scroll the newly focused field into view (field focused while the
     keyboard is already open).
   - cleanup removes all listeners and clears the property.
4. **CSS**: only the one-line change described in touchpoints. The sticky
   footer (`.editor-actions-sticky`) needs no change — it sticks to the bottom
   of the scrollable `.task-modal-body`, which now ends above the keyboard.

## Out of scope

- GlobalSearch, OnboardingRoot, FilterPanel, bottom sheets in App/CalendarPage/
  WeekView (no text inputs mid-sheet worth the risk this run — note if you
  disagree, do NOT expand).
- Any per-modal code: TaskModal/EventModal/TicketModal get the behavior FREE
  via the shell and the shared `.task-modal-card` class; ConfirmProvider and
  ChangelogModal inherit harmlessly (inset is 0 without a keyboard).
- Retirement mode stays disabled — untouched.

## Acceptance

- [ ] Pure tests green; `modalShell.test.ts` green without edits.
- [ ] On a ≤760 px viewport with `visualViewport` reporting a 336 px keyboard,
      `.task-modal-card` gets `--n2-kb-inset: 336px` and its computed
      max-height shrinks accordingly; sticky footer remains on screen.
- [ ] Focusing the comment field with the keyboard open scrolls it into view.
- [ ] Desktop: no `--n2-kb-inset` ever set (effect bails), CSS outside the
      mobile block unchanged — bit-identical rendering.
- [ ] No behavior change to focus trap/Escape/scroll-lock paths.

## Verification

- Worker: `npx vitest run src/components/keyboardInset.test.ts src/components/modalShell.test.ts`
  then `npm run build`.
- Browser: none — jsdom/real-device keyboard cannot run in CI here; release
  verification owns the device matrix.
- Scheduler owns final `npm run test:scheduler && npm test && npm run build`.

## Prior decisions

- Integration point is `useModalShell` (single implementation), NOT per-modal
  hooks — TaskModal, EventModal and TicketModal all replicate the same shell
  and sticky-footer pattern, so one wire covers the minimal correct set.
- 80 px threshold separates keyboard from browser-chrome jitter.
- The card shrinks via `max-height` (CSS var); we do NOT reposition with
  transforms and we do NOT touch `.task-modal-viewport` alignment.
