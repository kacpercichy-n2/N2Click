# Handoff: Adopt lucide-react icons + animated icon foundation

- **Package ID:** PKG-20260708-icons-foundation
- **Status:** ready
- **Tier:** test-writer
- **Model:** sonnet
- **Depends on:** none
- **Blast radius:** low — adds a dependency and a shared module; nav markup changes in `src/App.tsx`.

## Goal
Install and bundle **lucide-react** (ISC license, fully free, tree-shakable, renders inline SVG with `stroke="currentColor"`), expose the app's icon set through one central module, add CSS micro-animations so icons are animated, and put icons on the 9 sidebar nav items.

Decision already made by the architect (do not revisit): lucide-react was chosen over Bootstrap Icons and over dedicated animated sets (lord-icon is freemium — disqualified; Lottie-based sets need a heavy runtime and have per-asset license ambiguity). "Animated" is delivered via plain-CSS transitions/keyframes on Lucide's stroke SVGs. Icons must be bundled via npm (no CDN).

## Context the worker needs
- Relevant files: `package.json`, `src/App.tsx` (NAV array + sidebar markup), `src/styles.css` (append at bottom).
- Conventions: `/Users/kacpercichyn2/Documents/N2click/CLAUDE.md` — note it is partially stale: the dark N2 restyle is ALREADY DONE (styles.css uses `--n2-*` tokens) and TaskEditorPage was replaced by `src/components/TaskModal.tsx`. UI text is **Polish**.
- A `@media (prefers-reduced-motion: reduce)` block already exists at the end of styles.css and globally kills transitions/animations — your animations are automatically covered; do not duplicate it.

## Scope
### In scope
1. `npm install lucide-react` (goes to `dependencies`).
2. New file `src/components/icons.ts`: re-export the icons the app will use, so pages never import from `lucide-react` directly. Export at least:
   `LayoutDashboard, FolderKanban, Columns3, GanttChart, ListChecks, CalendarDays, Users, Gauge, Settings, Search, Menu, X, ChevronRight, ChevronLeft, Plus, Trash2, Pencil, Save, Check, AlertTriangle, ArrowRightLeft, ZoomIn, ZoomOut, Filter, Bookmark, Clock` (use `Columns3`/`GanttChart` if present in the installed version; otherwise pick the closest names — e.g. `KanbanSquare`, `GanttChartSquare` — and keep the re-export alias stable: `export { KanbanSquare as Columns3 }`).
3. `src/App.tsx`: extend the `NAV` array to carry an icon component per route and render it inside each `.app-nav-link` before the label (size 18, `aria-hidden`, `className="nav-icon"`). Mapping: Panel→LayoutDashboard, Projekty→FolderKanban, Kanban→Columns3, Oś czasu→GanttChart, Zadania→ListChecks, Kalendarz→CalendarDays, Zespół→Users, Obciążenie→Gauge, Administracja→Settings.
4. Append to `src/styles.css` (new section comment `/* ---------- Icons ---------- */`):
   - `.nav-icon { flex: 0 0 auto; }` and vertical alignment inside `.app-nav-link` (flex, gap) if not already aligned.
   - Micro-animations: `.app-nav-link .nav-icon { transition: transform 180ms ease; } .app-nav-link:hover .nav-icon { transform: translateX(2px) scale(1.08); } .app-nav-link.active .nav-icon { transform: scale(1.08); }`.
   - Generic helper classes for later packages: `.icon-spin { animation: icon-spin 900ms linear infinite; }` with `@keyframes icon-spin`, and `.icon-pop { animation: icon-pop 260ms ease; }` with a small scale keyframe (0.6→1.15→1).
### Out of scope
- Do NOT add icons to any other page/component (later packages do that).
- No theme/color changes; icons inherit `currentColor`.
- No other dependencies.

## Implementation notes
- Named imports from `lucide-react` are tree-shaken by Vite's build; that is the intended usage.
- Keep the NAV data structure a simple array of tuples/objects in App.tsx; don't build an abstraction layer.

## Acceptance criteria
- [ ] `lucide-react` in `package.json` dependencies; lockfile updated; app builds offline from node_modules (no CDN/link tags).
- [ ] `src/components/icons.ts` exists and is the only file importing from `lucide-react`.
- [ ] All 9 sidebar links show an icon left of the Polish label, colored via currentColor, active/hover animation visible.
- [ ] Desktop (>1180px), tablet (≤1180px) and mobile (≤760px) nav layouts not broken (nav still usable at each breakpoint).
- [ ] No console errors/warnings.

## Tests
- Command: `npx tsc --noEmit && npm run build`
- Expected: both pass with zero errors. Manual: `npm run dev`, check sidebar at 3 widths.

## Report back
Append a worker entry to `handoffs/RUN-STATE.md` (files changed one-line each, test results, deviations). Synthesized summary only — no raw logs.
