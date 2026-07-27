# Handoff: Build the Tooltip primitive, upgrade IconButton, migrate non-calendar `title=` sites

- Package ID: PKG-20260728-tooltip-primitive-iconbutton
- Status: ready
- Tier: developer
- Depends on: none
- Risk: medium
- Codex review: required — new shared primitive + broad aria changes across ~20 files

## Goal

A pure-logic `tooltipShell.ts` + thin `Tooltip.tsx` primitive (group delay, hover
+ focus-visible, Escape, touch degradation, shortcut hint, safe aria contract),
an upgraded `IconButton` (44 px hit halo, disabled/busy states, `aria-pressed`/
`aria-expanded`, `data-size`, no native `title`), and migration of every
non-calendar `title=` attribute per the settled per-site table below.

## Wiki context

- `openwiki/n2hub/ui-navigation-and-onboarding.md`
- `openwiki/n2hub/testing-and-automation.md`

## Expected touchpoints

- `new: src/components/tooltipShell.ts` — ALL testable decisions (pure, node)
- `new: src/components/tooltipShell.test.ts`
- `new: src/components/Tooltip.tsx` — thin DOM layer
- `src/components/IconButton.tsx`
- `src/styles.css` (`.icon-btn` ~2817; new `.tooltip*`; `--n2-z-tooltip` token)
- `src/components/useOverlay.ts` / `src/components/overlayShell.ts` — READ ONLY
  reuse (`OverlayLayer`, `getOverlayRoot`, `resolveOverlayPosition`); do NOT
  modify these files
- `src/onboarding/OnboardingRoot.tsx` (line ~569: raw `×` close button)
- Migration files: `src/App.tsx`, `src/components/TaskModal.tsx`,
  `src/components/AllocationGrid.tsx`, `src/components/FilterPresets.tsx`,
  `src/components/SaveStatus.tsx`, `src/components/Avatar.tsx`,
  `src/components/PersistenceBanner.tsx`, `src/components/CommentsPanel.tsx`,
  `src/components/Coin.tsx`, `src/components/PersonChip.tsx`,
  `src/pages/TicketsPage.tsx`, `src/pages/KanbanPage.tsx`,
  `src/pages/TeamStructureTree.tsx`, `src/pages/DashboardPage.tsx`,
  `src/pages/TasksPage.tsx`, `src/pages/TeamPage.tsx`,
  `src/pages/PersonProfilePage.tsx`, `src/pages/AdminPage.tsx`,
  `src/pages/ProjectsPage.tsx`, `src/pages/ProjectDetailPage.tsx`,
  `src/pages/WorkloadPage.tsx`

## Invariants

- No new runtime dependencies; Polish user-facing strings.
- Do NOT touch `src/store/AppStore.tsx`, reducers or selectors.
- Do NOT touch `WeekView.tsx`, `MonthView.tsx`, `TimelinePage.tsx` (calendar
  surfaces are PKG-20260728-title-migration-calendar, invariant 7).
- Tooltip event handlers are OBSERVERS ONLY: never `preventDefault`,
  `stopPropagation` or pointer capture (same doctrine as `useOverlay.ts`).
- Never `aria-label` + `aria-describedby` carrying the same text.
- IconButton visuals unchanged at rest (32 px circle, same colors/hover);
  existing accessible names (`aria-label`) preserved everywhere — the
  `browser-check-ui-keyboard.mjs` contract (`Wyloguj`, nav names) must hold.
- Retirement mode stays disabled. No git state changes; do not commit.
- Vitest runs in `node` env and only picks up `src/**/*.test.ts` — all tested
  logic must be DOM-free in `tooltipShell.ts` (pattern: `overlayShell.ts`,
  `modalShell.ts`, `fieldContract.ts`).

## Scope

### 1. `tooltipShell.ts` (pure) — settled semantics

- Constants: `TOOLTIP_OPEN_DELAY_MS = 500`, `TOOLTIP_WARM_GRACE_MS = 500`.
- Group-delay state machine, timestamp-based (callers pass `now`), ONE shared
  group for the whole app:
  - `resolveShowDelay(group, now)` → `500` when cold, `0` when warm.
  - Warm = a tooltip is currently shown, or the last hide happened less than
    `TOOLTIP_WARM_GRACE_MS` ago. `noteShow(group, now)` / `noteHide(group, now)`
    update it. After the grace window passes with nothing shown, the group is
    cold again (first tooltip waits 500 ms).
- Trigger resolution (pure, event-name in, action out), covering at least:
  `pointerenter` with `pointerType: 'mouse'` → schedule show with resolved
  delay; `pointerenter` touch/pen → NEVER show; `focus-visible` → show
  immediately (delay 0, keyboard users do not wait); focus without
  `:focus-visible` → no show; `pointerleave`/`blur` → hide;
  `pointerdown` → hide immediately (activation beats hint); `Escape` → hide.
- Aria contract: `tooltipDescribes(accessibleName, tooltipText)` → boolean.
  Normalized comparison (trim + `toLocaleLowerCase('pl')`): if the tooltip text
  equals the accessible name OR is contained in it, the tooltip is visual-only
  (no `aria-describedby`). Only genuinely additional text gets `describedby`.
- `buildTooltipText(text, shortcut?)` — appends the shortcut hint for the
  hidden description (e.g. `„Zapisz (skrót: S)"`); popup renders the shortcut
  as a `<kbd>` visually.

### 2. `Tooltip.tsx` (thin DOM layer) — settled design

- API: `<Tooltip text={string} shortcut?={string}>{child}</Tooltip>` where
  `child` is a SINGLE ref-accepting element. Implementation via `cloneElement`:
  merge `onPointerEnter/Leave/Down`, `onFocus`, `onBlur`, `onKeyDown` (always
  call the child's own handler too) and attach a callback ref. NO wrapper
  element around the child — layout must be byte-identical.
- The popup renders through `OverlayLayer` (portal to `#n2hub-overlay-root`),
  positioned with `resolveOverlayPosition(anchorRect, size, viewport,
  { placement: 'bottom-start', offset: 6 })`. Do NOT use the full `useOverlay`
  hook — a tooltip needs no dismiss pair, no overlay stack, no menu keyboard.
- Hide on window scroll (capture) and on resize — tooltips are ephemeral; no
  reposition loop.
- Escape: window `keydown` capture listener while shown; hides the tooltip and
  does NOT call `stopPropagation` (the overlay/modal Escape stack must be
  unaffected).
- When `tooltipDescribes(...)` is true, render a permanently-mounted
  visually-hidden `<span id>` INSIDE the portal (so the child's DOM siblings
  never change) and clone `aria-describedby={id}` onto the child (merge with an
  existing `aria-describedby`). Popup card itself is `aria-hidden` (the id'd
  span is the accessible description; no double announcement).
- Focus-visible detection: on focus, `event.target.matches(':focus-visible')`.
- CSS: `.tooltip` card (dark panel, small font, `kbd` styling), token
  `--n2-z-tooltip: 1300` in `:root` (above `--n2-z-confirm` 1200).

### 3. `IconButton` v2 — settled API

```ts
interface Props {
  label: string;                 // aria-label, unchanged
  tooltip?: string | null;       // tooltip text; default = label; null = none
  shortcut?: string;             // forwarded to Tooltip
  onClick: () => void;
  icon: ReactNode;
  variant?: 'default' | 'danger';
  className?: string;
  size?: 'sm' | 'md';            // rendered as data-size; md = 32px (default), sm = 24px
  disabled?: boolean;
  disabledReason?: string;       // Polish sentence; implies disabled handling of aria
  busy?: boolean;                // in-progress
  pressed?: boolean;             // aria-pressed (toggles)
  expanded?: boolean;            // aria-expanded (layer openers)
}
```

- REMOVE the `title` prop and the native `title` attribute entirely. Nothing in
  the repo passes the old numeric `size` (verify with grep before removing it).
- Always wrap the `<button>` in `<Tooltip text={tooltip ?? label}>` unless
  `tooltip === null`. Whether it also describes is decided by
  `tooltipDescribes(label, text)` — never duplicated with `aria-label`.
- `disabled`/`busy`: render `aria-disabled="true"` / `aria-busy="true"` (NOT
  the native `disabled` attribute — the button stays focusable so keyboard and
  SR users can reach the tooltip/reason), suppress `onClick` while either is
  set. `disabledReason` feeds the tooltip text and an `aria-describedby`
  description (via Tooltip's hidden span). CSS: `.icon-btn[aria-disabled='true']`
  (muted, `cursor: default`, no hover transform), `.icon-btn[aria-busy='true']`
  (reduced opacity + gentle pulse animation; no new deps).
- 44 px hit halo, visuals untouched:
  ```css
  .icon-btn { position: relative; }
  .icon-btn::after {
    content: '';
    position: absolute;
    left: 50%; top: 50%;
    width: max(100%, 44px); height: max(100%, 44px);
    transform: translate(-50%, -50%);
    border-radius: 50%;
  }
  ```
  The pseudo-element is part of the button's own hit area — no `pointer-events`
  overrides, no z-index games. Audit the five existing call sites (modal close
  headers, TasksPage row delete): no sibling interactive control sits within
  6 px of an IconButton edge; if one does, note it in the report.
- `data-size`: `md` keeps 32 px (default, no CSS change for current sites);
  `sm` = 24 px via `.icon-btn[data-size='sm']`. Halo still 44 px via `max()`.
- Replace the raw `×` close button at `src/onboarding/OnboardingRoot.tsx:569`
  with `<IconButton className="task-modal-close" icon={<X size={18} aria-hidden />}
  label="Zamknij" onClick={onClose} />` — exact same pattern as
  EventModal/ChangelogModal/TicketModal/TaskModal close buttons. (The prompt
  calls this "QuickAddModal"; that component does not exist — OnboardingRoot's
  tutorial-center close is the only remaining raw `×` glyph.)

### 4. Migration table (settled per site — do not re-triage)

Cases: **A** drop title (duplicate of accessible name/visible text) · **B**
Tooltip + `aria-describedby` (extra content) · **Bv** Tooltip visual-only (text
already the accessible name) · **C** non-interactive → visible/sr-only text,
no hover-only info · **D** disabled-with-reason → hidden description span +
`aria-describedby`, NO popup (form-field clusters) or Tooltip wrapper (single
buttons).

| File | Sites | Treatment |
| --- | --- | --- |
| `IconButton.tsx` :35 | 1 | Core rework (above) |
| `TasksPage.tsx` :406 | 1 | `title="Usuń"` → `tooltip="Usuń"` (Bv — subset of label) |
| `App.tsx` :335, :371 | 2 | Bv tooltip (collapse toggle, gear) |
| `App.tsx` :358 | 1 | Nav links: drop title when expanded (label visible = A); render Tooltip(label) only in collapsed rail mode. Accessible name must not change |
| `App.tsx` :400, :413 | 2 | B — Tooltip `Mój profil: <imię>`; describedby only if that text is not already the link's accessible name |
| `TaskModal.tsx` 15× `roTitle` | 15 | D — ONE visually-hidden span per modal (e.g. `id="task-ro-reason"`, text `Brak uprawnień do edycji zadań.`) + `aria-describedby` on each read-only control; drop all 15 titles; no popups |
| `TaskModal.tsx` :1775 | 1 | If `recurApplyError` is already rendered visibly nearby → A (drop); else D |
| `TaskModal.tsx` :2001/2010/2021 | 3 | D + Tooltip (`Najpierw utwórz projekt`) on the blocked controls |
| `PersonProfilePage.tsx` 17× `NO_PERM_TITLE` | 17 | D — one shared hidden span (`Brak uprawnień do edycji tego pola.`) + describedby; drop titles. Keep `NO_PERM_TITLE` export (text reused), rename only if trivial |
| `ProjectDetailPage.tsx` 7× `disabledTitle` | 7 | D (hidden span + describedby; Tooltip wrapper on the standalone buttons) |
| `ProjectDetailPage.tsx` :511 | 1 | B |
| `ProjectDetailPage.tsx` :551 | 1 | A/C — badge text is visible; drop title (keep any extra wording as sr-only if not visible) |
| `ProjectDetailPage.tsx` :622, :631 | 2 | B — URL preview tooltip + describedby |
| `AllocationGrid.tsx` :127, :135 | 2 | B |
| `AllocationGrid.tsx` :182 | 1 | If `cellTitle` duplicates the cell input's aria-label → A; else describedby (no popup on grid cells) |
| `AllocationGrid.tsx` :193 | 1 | D (shared `Brak uprawnień` span) |
| `AllocationGrid.tsx` :209 | 1 | C — the start-hour hint already exists as visible hint text; drop title, ensure describedby wiring |
| `FilterPresets.tsx` :77 | 1 | B |
| `FilterPresets.tsx` :134 | 1 | B with dynamic text (save hint vs `Ustaw jakiś filtr…` reason) |
| `TicketsPage.tsx` :99 | 1 | B |
| `KanbanPage.tsx` :316 | 1 | C — move the instruction into a small visible muted caption in the archived column header area; drop title |
| `KanbanPage.tsx` :333 | 1 | C/D — hidden hint span + `aria-describedby` on the input (placeholder already shows the pattern); drop title |
| `SaveStatus.tsx` :30 | 1 | B on the clickable blocked badge |
| `Avatar.tsx` :36, :49 | 2 | A — spans are `aria-hidden` decorative; interactive parents own naming |
| `PersistenceBanner.tsx` :129 | 1 | B |
| `CommentsPanel.tsx` :268 | 1 | Bv if title equals the button's accessible name, else B |
| `Coin.tsx` :56 | 1 | B + add `aria-pressed={paid}` to the coin toggle button |
| `Coin.tsx` :64 | 1 | A (role=img + aria-label stays); optional Bv tooltip |
| `PersonChip.tsx` :13 | 1 | Bv — Tooltip(person.role \|\| name), no describedby (non-interactive enhancement; today's title was equally invisible on touch, so no regression) |
| `PersonChip.tsx` :31 (`PersonDot`) | 1 | Keep the prop signature but its only non-calendar duty is decorative — drop native title; calendar consumers are handled in PKG-…-calendar |
| `TeamStructureTree.tsx` :62 | 1 | B (`Otwórz profil: X` adds action info beyond the visible name) |
| `DashboardPage.tsx` :132 | 1 | C — expose `overTitle` as sr-only text (or aria-label) on the ⚠ pct span; drop title |
| `DashboardPage.tsx` :322 | 1 | Bv |
| `TeamPage.tsx` :172, :181 | 2 | Bv if equal to accessible name, else B |
| `AdminPage.tsx` :140 | 1 | B — Tooltip + describedby on the `Ukończenie` checkbox/label (text switches with `onlyDone`) |
| `AdminPage.tsx` :180, :191 | 2 | D — buttons stay natively `disabled`; wrap in Tooltip (hover works on the wrapper-less clone? native disabled buttons swallow pointer events — here, and ONLY here, wrap the button in a minimal `<span class="tooltip-holder">` with `display:inline-flex` to carry hover) + hidden span describedby |

If any site's real code contradicts this table, follow the case RULES (A–D)
and record the deviation in the report — do not silently invent a fourth
pattern.

## Out of scope

- `WeekView.tsx`, `MonthView.tsx`, `TimelinePage.tsx`, and PersonDot's calendar
  consumers → PKG-20260728-title-migration-calendar.
- Any store/reducer/selector change; any new dependency; onboarding tour copy.
- Restyling IconButton visuals or existing layouts.
- Editing `overlayShell.ts` / `useOverlay.ts`.

## Acceptance

- [ ] `tooltipShell.test.ts` covers: cold 500 ms delay → warm instant → grace
      expiry re-cold; touch never shows; focus-visible instant; pointerdown and
      Escape hide; `tooltipDescribes` equality/containment (Polish
      case-insensitive); shortcut text building.
- [ ] `grep -rn 'title=' src --include='*.tsx'` shows ZERO hits outside
      `WeekView.tsx`, `MonthView.tsx`, `TimelinePage.tsx`, `PersonChip.tsx`
      (`PersonDot` prop pass-through only, if kept for PKG-B).
- [ ] IconButton renders no `title`, exposes `data-size`, halo ≥44 px
      (`::after`), `aria-pressed`/`aria-expanded` only when the props are
      given, `aria-disabled`/`aria-busy` states suppress clicks.
- [ ] OnboardingRoot close is an IconButton; no raw `×` glyph remains in `src`.
- [ ] Every migrated control keeps its previous accessible NAME; descriptions
      never duplicate names.
- [ ] All Polish strings; no English leaks.

## Verification

- Worker: `npx vitest run src/components/tooltipShell.test.ts`, then
  `npx vitest run src/components` (whole components suite must stay green),
  then `npm run build` (tsc catches every migrated call site).
- Browser: none — playwright is unavailable in this worktree (see RUN-STATE
  history); preserve the `browser-check-ui-keyboard.mjs` name contract instead.
- Scheduler owns final `npm test && npm run build` (do not assume a fixed test
  count; last known 1710 pass).

## Prior decisions

- `IconButton.title` prop is REMOVED (renamed `tooltip`, default = label,
  `null` opts out). No native `title` anywhere in the component.
- Group delay: 500 ms cold, 0 ms warm; warmth = shown-now or hidden <500 ms
  ago; focus-visible always instant; touch never shows.
- Tooltip reuses `OverlayLayer` + `resolveOverlayPosition` ONLY — not the full
  `useOverlay` machinery; Escape hides without `stopPropagation`.
- `aria-describedby` text lives in an always-mounted hidden span in the portal
  (popup itself `aria-hidden`), so descriptions work when the popup is closed
  and the trigger's DOM siblings never change.
- Disabled-with-reason on form-field clusters = shared hidden span +
  describedby, no popup; on standalone buttons = tooltip + describedby.
