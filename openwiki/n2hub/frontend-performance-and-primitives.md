# Frontend performance and UI primitives

## Boundary

This page governs shared interactive UI primitives and rendering-sensitive
work: dialogs, overlays, popovers, menus, selects, tooltips, focus traps,
scroll containers, animation and large lists. It does not require adopting a
UI framework; N2Hub still uses React, Motion and plain CSS.

Primary touchpoints:

- `src/components/ModalFrame.tsx`
- `src/components/modalBackdropSnapshot.ts`
- `src/components/useOverlay.ts` (wspólna powłoka popoverów)
- `src/components/DateCalendarField.tsx` + `dateCalendar.ts` (pole daty z
  kalendarzem — patrz niżej)
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

Application modals share one shell (`ModalFrame` for lightweight popouts such
as the changelog and quick-add; `useModalShell` for the form modals: task,
event, ticket) and preserve:

- a single modal stack and topmost Escape handling (ModalFrame additionally
  portals to `document.body` and sets the application root inert);
- body scroll lock;
- one scrolling element: `.task-modal-body`;
- a fixed transparent viewport and an opaque modal card;
- only `transform`/`opacity` animation on the card.

The backdrop is a plain semi-transparent scrim (`.task-modal-scrim`,
`rgba(4, 3, 8, 0.68)`, `pointer-events: none`) over the LIVE application.
This is an explicit owner decision (2026-07-28): the interface must stay
visible — undimmed detail and all — behind the changelog, project and task
modals. Do not reintroduce a full-viewport live `backdrop-filter`, a root
`filter`, or a rasterized page snapshot (the `html2canvas` bitmap backdrop
from 2026-07-22 was reverted and the dependency removed). Modal scrolling
stays composited because the only scroller is `.task-modal-body` inside the
opaque card — the scrim never needs repainting during that scroll.

## Rendering rules

- Prefer a single owner for scrolling; remove nested viewport scrollers.
  ONE deliberate exception (operator decision 2026-08-04): the Content plan
  „Glass" board (`.cp-board` in `styles.css`) is a horizontal scroll-snap axis
  whose day columns own their vertical scroll — a 1:1 port of the source
  planner layout. Keep the exception contained to `.cp-scene`.
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
- The page gradient (`--n2-gradient-page`, four layers) is pinned by a SEPARATE
  `background-attachment: fixed` declaration on `body`, never by `fixed` inside
  the `background` shorthand. In the shorthand that keyword reaches only the
  LAST layer, so the three radial glows scrolled and sized themselves against
  full document height — long routes such as `/tasks` then showed a lighter
  violet wash than short ones.
- SELECTY: chevron jest GLOBALNY (2026-08-07, `styles.css` tuż po bloku
  `select:focus`) — `appearance: none` + własna strzałka `background-image`
  (wcięcie `right 13px`, `padding-right: 36px`), bo natywna była nieczytelna
  na ciemnym szkle i siedziała przy krawędzi. KAŻDA reguła tła na selectach
  musi używać longhandu `background-color` — shorthand `background:` zdejmuje
  strzałkę (dlatego reguła fokusa deklaruje ją ponownie; selecty Content
  Planu mają swoje historyczne kopie tych samych reguł — bez różnicy
  wizualnej). Select „Sortuj" (`.list-sort`) w pasku filtrów Zadań/Projektów
  trzyma wysokość rzędu `.btn` (40 px) i pigułkę — rząd kontrolek nie
  schodkuje (doktryna `--n2-control-h` z paska kalendarza).
- OPTYCZNE CENTROWANIE (PKG-20260804, 2026-08-07): mechanizm `.avatar` to
  alias 'Plus Jakarta Sans Trimmed' (fonts.css, metric overrides — Chrome/
  Firefox) + blokowy span `.avatar-glyphs` z `text-box: trim-both cap
  alphabetic` (Chrome/Safari; `text-box` przycina WYŁĄCZNIE kontenery
  blokowe — na grid/flex nie robi nic, stąd span). Alias wolno stosować tylko
  na treści gwarantowanie wersalikowej (`descent-override: 0%` obcina
  descendery). Pigułki liczbowe (`.dash-badge` itd.) są Interem — metrycznie
  symetryczne, NIE poprawiać. Inline svg poza `display: block` dziedziczy
  linię bazową (patrz `.icon-btn svg`); wszystkie cztery reguły svg audytu są
  zielone. Pomiar: `browser-check-optical-centering.mjs` (testing-and-automation).

## Date picker primitive (2026-08-24)

`DateCalendarField` zastępuje natywne `<input type="date">` w formularzach
wydarzeń (urlop Od/Do, data spotkania). Czysty view-model siatki i klawiatury
żyje w `dateCalendar.ts` (testy w node); komponent dokłada tylko popover na
`useOverlay` i roving tabindex. Porównanie źródeł (research-before-custom):
React Aria Calendar/RangeCalendar (siatka `role="grid"`, strzałki ±1/±7,
PageUp/Down ±miesiąc, Home/End, `aria-selected`) i shadcn/react-day-picker
(klasy `range-start`/`range-middle`/`range-end` pasa zaznaczenia). Świadome
różnice: jeden miesiąc na raz, własna powłoka `useOverlay` zamiast warstwy
biblioteki, zero zależności. Karta `.date-cal` stoi na
`--n2-z-menu-over-modal`, bo pola żyją w modalach formularzy; Tab jest
zawinięty w kartę (pułapka jak FilterPanel, capture + stopPropagation — pole
żyje w modalu z własną pułapką na `window`), komórki mają 44 px (hybrydy
dotykają popovera) i `touch-action: manipulation`. Urządzenie DOTYKOWE
(`(hover: none), (pointer: coarse)`, ta sama bramka co telefonowe ścieżki
czatu) dostaje NATYWNY `<input type="date">` z tym samym kontraktem —
systemowy picker jest tam lepszy niż własny popover; bramka jest REAKTYWNA
(nasłuch `change` na matchMedia), bo hybryda z odpinaną klawiaturą zmienia
primary pointer w trakcie sesji, a przełączenie wariantu RATUJE FOKUS: gdy
był w polu albo jego popoverze (`data-owner`), wraca na nową kontrolkę o tym
samym `id` zamiast spaść na `body`. Zakres w polu
jest WYŁĄCZNIE podświetleniem (`rangeStart`/`rangeEnd`) — dwa pola Od/Do
zostają osobnymi kontrolkami, więc kontrakt błędów per pole (IA-12) jest
nietknięty. Doktryna SY-08 (utils/dates.ts) dopuszcza to pole jako wariant
formatu 3.

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
