# Handoff: Responsive mobile navigation (hamburger drawer)

- **Package ID:** PKG-20260708-mobile-nav
- **Status:** ready
- **Tier:** developer
- **Model:** opus
- **Depends on:** PKG-20260708-icons-foundation (nav icons, `Menu`/`X`); PKG-20260708-global-search (both edit `src/App.tsx` — run after it).
- **Blast radius:** low-medium — app shell markup + responsive CSS; desktop/tablet layouts must not regress.

## Goal
On small screens (≤760px) replace the horizontally-scrolling nav with a standard mobile pattern: a compact top bar (brand + hamburger) and a slide-in drawer containing all 9 nav items, the search trigger, and the "Występuj jako" select.

**Architect decision (do not revisit):** hamburger drawer, not bottom nav — 9 items don't fit a bottom bar.

## Context the worker needs
- Relevant files: `src/App.tsx` (`app-shell` grid, `app-sidebar`, `NAV`, acting-as select), `src/styles.css` — current breakpoints: `@media (max-width: 1180px)` collapses the grid to one column with a 4-col nav; `@media (max-width: 760px)` currently makes `.app-nav` a horizontal scroller (this rule is what you replace); `prefers-reduced-motion` block already global. `src/components/GlobalSearch.tsx` trigger button (if landed) lives in the sidebar — it must appear in the drawer too (render position may move; the Ctrl+K listener is global and unaffected).
- Conventions: `/Users/kacpercichyn2/Documents/N2click/CLAUDE.md`. Plain CSS only; `motion` may be used for the drawer transition but plain CSS transform transition is preferred (simpler). UI text **Polish**.

## Scope
### In scope
1. **App.tsx:** add `menuOpen` state. Render a mobile top bar (`.app-topbar`: brand mark + name + hamburger button `aria-label="Otwórz menu"`, `aria-expanded`, `aria-controls="app-drawer"`; icon `Menu`/`X` swaps with state). Hidden ≥761px via CSS (render always, hide with media query — no JS matchMedia).
2. **Drawer:** reuse the existing `.app-sidebar` content (nav links with icons, search trigger, acting-as). At ≤760px the sidebar becomes `position: fixed; inset: 0 auto 0 0; width: min(300px, 84vw)`, translated off-canvas (`transform: translateX(-102%)`) and slid in when open (`transform: none`, `transition: transform 220ms ease`), above a scrim (`.app-drawer-scrim`, click closes). `id="app-drawer"`.
3. **Close behavior:** clicking any nav link, the scrim, or pressing Escape closes the drawer; navigating (location change) closes it (`useEffect` on `location.pathname`); body scroll locked while open (same pattern as TaskModal).
4. **Focus/a11y:** on open, focus the first nav link; on close, return focus to the hamburger. `aria-modal` not required (it's a nav drawer), but the scrim must not trap clicks when closed (`display: none` or conditional render).
5. **Breakpoints kept coherent:** ≥1181px — unchanged desktop sidebar; 761–1180px — keep the current collapsed 4-column nav block (unchanged); ≤760px — top bar + drawer, remove the horizontal-scroll nav rules that conflict.
6. CSS appended under `/* ---------- Mobile nav ---------- */`; adjust the existing `@media (max-width: 760px)` `.app-nav` rules as needed (this is the one place editing existing CSS is allowed).
### Out of scope
- No changes to routes, page content, TaskModal, or the ≥761px experience beyond what's listed.
- No swipe gestures; no portal/library.

## Implementation notes
- The same `.app-sidebar` element serves both desktop sidebar and mobile drawer — differentiate purely with media queries + an `open` class from state, to avoid duplicating the nav markup.
- Watch z-index layering: drawer above page content and scrim, below TaskModal/GlobalSearch overlays (they set body scroll lock too — locks must not fight; simplest: drawer closes when a modal opens is NOT required, just restore `overflow` correctly on unmount as TaskModal does).
- Test with devtools device emulation at 375px and 760px widths.

## Acceptance criteria
- [ ] ≤760px: top bar visible, sidebar hidden until hamburger tapped; drawer slides in with all 9 items (icons + Polish labels), search trigger and acting-as select; scrim/Escape/link-tap closes; body doesn't scroll behind.
- [ ] Every route reachable on a 375px viewport; active link highlighted in the drawer.
- [ ] 761–1180px and >1180px layouts unchanged (visual spot-check).
- [ ] Focus management works (open → first link; close → hamburger); `aria-expanded` correct.
- [ ] No console errors; `prefers-reduced-motion` users get no slide animation (covered by the global rule — verify).

## Tests
- Command: `npx tsc --noEmit && npm run build`
- Expected: both green. Manual: dev server at 375/760/1180/1440 px widths.

## Report back
Append a worker entry to `handoffs/RUN-STATE.md`. Synthesized summary only — no raw logs.
