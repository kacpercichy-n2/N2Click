# Handoff: Sidebar expand/collapse with persisted preference

- **Package ID:** PKG-20260708-sidebar-collapse
- **Status:** ready
- **Tier:** developer
- **Model:** opus
- **Depends on:** none (parallel-safe with PKG-20260708-bin-core; do NOT run
  concurrently with PKG-20260708-bin-week-ui — both edit `src/styles.css`)
- **Blast radius:** low — app shell chrome only; no store/data changes.

## Goal

Add a compact ~80px sidebar mode: logo dot only, icon-only nav, a toggle to
expand/collapse. The preference persists across reloads. Desktop-only —
existing 1180px/760px responsive behavior (4-col nav strip, mobile hamburger
drawer) is unchanged.

## Context the worker needs

- Relevant files: `src/App.tsx` (sidebar markup, `NAV` array),
  `src/styles.css` (`.app-shell` ~line 221, `.app-sidebar`/`.app-nav*`
  ~221–331, media queries ~2370–2422), `src/components/icons.ts`,
  `src/components/GlobalSearch.tsx` (read-only — find its sidebar trigger
  class), `src/components/Avatar.tsx` (existing component, reuse).
- Docs: `CLAUDE.md` (styling rules: plain CSS, `--n2-*` tokens, keep
  breakpoints + `prefers-reduced-motion`).
- Prior decisions (architect — binding):
  1. **UI prefs module.** Create `src/utils/uiPrefs.ts` wrapping localStorage
     key `n2hub.ui.v1` (JSON `{ sidebarCollapsed: boolean }`), with
     `loadUiPrefs(): UiPrefs` and `saveUiPrefs(prefs: UiPrefs): void`, both
     try/catch-safe like `storage.ts`. This is a deliberate, architect-approved
     exception to "all persistence in storage.ts": UI prefs are device-local
     and must NOT ride along when storage.ts becomes an API. No other file may
     call localStorage. Do NOT touch `src/store/storage.ts`.
  2. **State.** `App.tsx`: `const [collapsed, setCollapsed] = useState(() => loadUiPrefs().sidebarCollapsed)`;
     persist inside the toggle handler (no effect needed). Root div class:
     `app-shell` + ` sidebar-collapsed` when collapsed.
  3. **Toggle.** A button in the sidebar next to the brand row: icons
     `ChevronsLeft` (expanded) / `ChevronsRight` (collapsed) — add both to
     `src/components/icons.ts`. `aria-label`/`title`: `Zwiń menu` / `Rozwiń
     menu`. Visible only above 1180px (CSS-hidden below — the pref is simply
     ignored on the 1-column layout and in the mobile drawer).
  4. **Collapsed rendering (>1180px only):**
     - `.app-shell.sidebar-collapsed { grid-template-columns: 80px minmax(0,1fr); }`
     - Sidebar padding narrows so the 42px `.app-brand-mark` centers in 80px;
       `.app-brand-name` hidden.
     - Nav links: wrap the label text in `<span className="nav-label">` in
       `App.tsx` (needed for CSS hiding) and add `title={label}` to every
       NavLink (unconditional — harmless when expanded). Collapsed: label
       hidden, icon centered, link stays ≥44px tall.
     - GlobalSearch: keep the component MOUNTED (its Ctrl/Cmd+K handler lives
       inside); CSS-hide its sidebar trigger in collapsed mode. The shortcut
       must still open the palette while collapsed.
     - "Występuj jako": hide the label+select in collapsed mode; instead render
       the current user's `Avatar` (fallback: the `Users` icon when nobody is
       selected) as a button with `title` `Występuj jako: {name}` (or
       `Występuj jako`), whose click expands the sidebar. Conditional JSX on
       `collapsed` is fine here (simpler than CSS-only).
  5. **Scoping rule:** every `.sidebar-collapsed` style lives inside
     `@media (min-width: 1181px) { ... }` so the ≤1180px strip layout and the
     ≤760px drawer are pixel-identical to today regardless of the stored pref.
  6. Polish strings verbatim above. Transitions (width/opacity) welcome but
     must respect the existing `prefers-reduced-motion` global override.

## Scope

### In scope

- `src/utils/uiPrefs.ts` (new), `src/App.tsx`, `src/styles.css` (app-shell /
  sidebar section + a new min-width media block), `src/components/icons.ts`
  (two icon exports).

### Out of scope

- `src/store/*` (especially storage.ts), GlobalSearch internals, week-view /
  calendar CSS (a parallel package edits that section), any data-model change,
  tests, `package.json`, routing.

## Implementation notes

- The sidebar is `position: sticky` in a grid column — only the shell's
  `grid-template-columns` and the sidebar's inner layout change; `.app-main`
  needs nothing.
- The mobile drawer reuses `.app-sidebar` via `.open` (≤760px block at
  ~line 2941): because all collapsed styles are inside the min-width media
  query, the drawer inherits nothing — verify visually anyway.
- Focus behavior: after toggling, keep focus on the toggle button (it stays
  rendered in both states).

## Acceptance criteria

- [ ] Toggle collapses the sidebar to 80px: logo dot only, icon-only nav with
      working `title` tooltips, active-link highlight still visible; content
      area widens accordingly.
- [ ] Ctrl/Cmd+K opens global search while collapsed; the search trigger is
      hidden in collapsed mode and back in expanded mode.
- [ ] Acting-as avatar shows in collapsed mode; clicking it expands the
      sidebar; the select works normally when expanded.
- [ ] Preference persists: collapse → reload → still collapsed. Stored ONLY
      under `n2hub.ui.v1`; `n2hub.data.v1` payload untouched by toggling.
- [ ] At ≤1180px and ≤760px the layout is identical to before this change,
      with the pref set either way; hamburger drawer opens expanded.
- [ ] All nav routes still reachable; no console errors/warnings; strings
      Polish.

## Tests

- Command: `npx tsc --noEmit && npm test && npm run build`
- Expected: all green (no unit tests cover the shell; none to add — this is
  browser-verified UI). Verify the responsive criteria in the dev server and
  report anything unverifiable.

## Report back

Synthesized summary only to `handoffs/RUN-STATE.md`. No raw logs.
