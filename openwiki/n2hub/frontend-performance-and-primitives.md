# Frontend performance and UI primitives

## Boundary

This page governs shared interactive UI primitives and rendering-sensitive
work: dialogs, overlays, popovers, menus, selects, tooltips, focus traps,
scroll containers, animation and large lists. It does not require adopting a
UI framework; N2Hub still uses React, Motion and plain CSS.

Primary touchpoints:

- `src/components/ModalFrame.tsx`
- `src/components/modalBackdropSnapshot.ts`
- `src/styles.css`
- the component or page that consumes the primitive

## Research-before-custom rule

Before creating or materially changing an interactive primitive:

1. Inspect at least two current, primary implementations or specifications.
2. Record their DOM structure, focus/keyboard behavior, scroll ownership,
   portal/layer model and animation properties.
3. Compare them with N2Hub's current structure and name the deliberate
   differences.
4. Reproduce the risky rendering path in a small local test before changing all
   consumers.
5. Measure on the real target device when GPU/compositor behavior is involved.

Search results, Stack Overflow and issue threads can reveal failure modes, but
final decisions must be checked against official documentation, source code or
browser specifications.

## Preferred source shelf

- [React](https://react.dev/) and [Meta Open Source](https://opensource.fb.com/projects/react/)
- [Radix Primitives](https://www.radix-ui.com/primitives/docs/overview/introduction)
- [shadcn/ui](https://ui.shadcn.com/docs) — source patterns, not a black-box dependency
- [Base UI](https://base-ui.com/react/overview/about)
- [React Aria](https://react-spectrum.adobe.com/react-aria/)
- [Astryx by Meta](https://astryx.atmeta.com/) — beta; verify APIs before use
- [Material UI](https://mui.com/material-ui/) and [Floating UI](https://floating-ui.com/)
- [MDN](https://developer.mozilla.org/) and [W3C specifications](https://www.w3.org/TR/)
- [web.dev performance](https://web.dev/learn/performance/) and
  [Chrome DevTools rendering](https://developer.chrome.com/docs/devtools/rendering/)
- [Vercel React best practices](https://vercel.com/blog/how-we-optimized-package-imports-in-next-js)

These are references, not a blanket authorization to add dependencies. Reuse a
small local primitive when it is already correct. Adding or replacing a UI
library requires a bundle/accessibility/migration comparison and an explicit
decision in the task report.

## Shared modal contract

All application modals use `ModalFrame` and preserve:

- portal to `document.body`;
- a single modal stack and topmost Escape handling;
- body scroll lock and an inert application root;
- one scrolling element: `.task-modal-body`;
- a fixed transparent viewport and an opaque modal card;
- only `transform`/`opacity` animation on the card; no scale animation;
- no full-viewport live `backdrop-filter`, root `filter` or translucent blend
  against the live application.

The frosted background is a bounded, one-time snapshot:

1. capture the current viewport at no more than 1440×900;
2. bake 3.5px-equivalent blur, saturation and dimming into a canvas;
3. show the opaque bitmap under the portal;
4. set `#root` to `visibility:hidden` after the bitmap is ready;
5. fall back to the existing opaque gradient if capture fails;
6. release the canvas and restore root/body state after the last modal closes.

Do not scale the snapshot to hide blur edges. The captured view must keep the
same geometry before, during and after modal display. `html2canvas` is loaded
dynamically and is subject to documented CSS/CORS limitations; the fallback is
part of the contract, not an exceptional afterthought.

## Rendering rules

- Prefer a single owner for scrolling; remove nested viewport scrollers.
- Animate `transform` and `opacity`; do not animate blur, filter, layout or
  large shadows without an explicit trace.
- Do not add permanent `will-change` or `translateZ(0)` as folklore. Confirm a
  layer benefit in DevTools and remove the hint after the animation when used.
- Cap raster surfaces by CSS pixels and device memory; never assume a 4K/DPR2
  full-screen buffer is cheap.
- Long lists should be considered for `content-visibility`, virtualization or
  pagination only after a trace shows content paint/layout is the bottleneck.
- Preserve keyboard, focus restoration, `aria-modal`, inertness and fallback
  behavior while optimizing visuals.

## Verification

For a rendering-sensitive change:

1. Run focused unit tests, then `npm test` and `npm run build`.
2. Use Paint Flashing and Layers/Performance on the changed interaction.
3. Confirm that scrolling the modal does not repaint the full viewport and that
   the background surface stays static.
4. Test open, scroll, nested modal, Escape, outside click and close/restore.
5. Check at the real viewport/DPR/GPU that reported the issue. Automation is
   supporting evidence, not a substitute for that device.

Record unsuccessful variants and measured hardware differences in the relevant
investigation or decision document so the same folklore fixes are not retried.
