# Handoff: Global search palette (Ctrl+K)

- **Package ID:** PKG-20260708-global-search
- **Status:** ready
- **Tier:** developer
- **Model:** opus
- **Depends on:** PKG-20260708-icons-foundation (uses `Search`, `ChevronRight` from `src/components/icons.ts`)
- **Blast radius:** low-medium — new overlay component mounted in `src/App.tsx`; one new pure selector; small addition to ProjectsPage (URL param).

## Goal
Fast retrieval from anywhere: a search trigger in the sidebar plus Ctrl/Cmd+K opens an overlay palette that searches projects, tasks, clients and people (also matching status names and dates), grouped results, keyboard navigation, and jumps straight to the entity.

## Context the worker needs
- Relevant files: `src/App.tsx` (mount point; sidebar under the brand), `src/store/selectors.ts` (add the search selector; reuse `getClient`, `getStatus`, `assigneesOfTask`), `src/components/TaskModal.tsx` (`useOpenTask` — task results open the modal in place), `src/components/StatusBadge.tsx`, `src/components/Avatar.tsx`, `src/pages/ProjectsPage.tsx` (client deep-link), `src/utils/dates.ts`, `src/styles.css` (append). Modal pattern to copy: TaskModal's scrim + viewport + Escape/body-scroll-lock handling (plain divs are fine; `motion` fade optional since it's already a dependency).
- Conventions: `/Users/kacpercichyn2/Documents/N2click/CLAUDE.md`. All reads via pure selectors. UI text **Polish**.

## Scope
### In scope
1. **Selector** in `src/store/selectors.ts`:
   ```ts
   export interface SearchResults { projects: Project[]; tasks: Task[]; clients: Client[]; people: Person[]; }
   export function searchAll(state: AppData, query: string, limitPerGroup = 8): SearchResults
   ```
   - Normalization helper (module-local): lowercase + strip diacritics (`.normalize('NFD').replace(/[̀-ͯ]/g, '')` + map `ł→l`) so `zolty` matches `Żółty`.
   - Text match (substring, normalized) against: project `name`+`description`, task `title`+`description`, client `name`, person `name`+`email`+`role`.
   - **Status coverage:** if the query matches a status name (normalized substring), also include projects/tasks having that `statusId`.
   - **Date coverage:** if the query parses as `yyyy-MM-dd`, also include projects/tasks whose period contains that date (`startDate <= q <= endDate`).
   - Empty/whitespace query → empty groups. Dedupe, cap each group at `limitPerGroup`.
2. **Component** `src/components/GlobalSearch.tsx`, mounted once in `src/App.tsx` (next to `<TaskModal />`):
   - Trigger button in the sidebar (icon + `Szukaj…` + kbd hint `Ctrl K`, class `search-trigger`) and a global keydown listener for Ctrl+K / Cmd+K (preventDefault) and `/` when focus is not in an input/textarea/select.
   - Overlay: scrim + centered panel with an autofocused input (`placeholder="Szukaj projektów, zadań, klientów, osób… (także status lub data RRRR-MM-DD)"`). Escape or scrim click closes; body scroll locked while open.
   - Results grouped with Polish headers `Projekty / Zadania / Klienci / Zespół`. Row content: project → Coin? no — keep light: name, StatusBadge, client name, `startDate – endDate`; task → title, StatusBadge, project name, date range; client → name + project count; person → Avatar, name, role.
   - Keyboard: ↑/↓ moves a flat highlight across all rows, Enter activates, mouse hover highlights; `aria-activedescendant`/listbox roles or a reasonable equivalent.
   - Activation: project → `navigate('/projects/'+id)`; task → `openTask(id)`; person → `navigate('/people/'+id)`; client → `navigate('/projects?client='+id)`. Always close the palette after.
3. **ProjectsPage deep-link:** initialize `clientFilter` from the `?client=` search param (`useSearchParams`, read once as useState initializer) so the client result lands on a filtered list.
4. CSS appended under `/* ---------- Global search ---------- */` (glass panel: `--n2-surface-strong`, `--n2-border-strong` on the highlighted row; z-index above the sidebar but below nothing critical — TaskModal and search are never open simultaneously in practice; pick search z-index just under TaskModal's).
### Out of scope
- No fuzzy-ranking library, no indexing, no debounce beyond `useMemo` on the query (dataset is small).
- No search history / recent items; no saved filters (separate package).
- No changes to reducer/state shape; search state is component-local.

## Implementation notes
- Do the group flattening once so ↑/↓ index math is simple.
- Keep `searchAll` pure and unit-testable (no Date.now, no locale APIs beyond string normalize).
- Polish diacritics: ł is NOT decomposed by NFD — handle it explicitly (and Ł).

## Acceptance criteria
- [ ] Ctrl+K (and Cmd+K on mac) and the sidebar button open the palette from every page; Escape/scrim closes; typing filters live.
- [ ] `redesign` finds the sample project; `kasia` finds the person; a status name (e.g. `gotowe`) lists entities in that status; a date inside a sample task period lists it; `zolty`-style diacritic-free input matches diacritic names.
- [ ] Enter on a task opens the TaskModal over the current page; project/person/client rows navigate correctly; `?client=` pre-filters ProjectsPage.
- [ ] No console errors; no interference with existing `/`-typing inside form fields.
- [ ] `Ctrl+K` while the palette is open closes it (toggle).

## Tests
- Command: `npx tsc --noEmit && npm run build`
- Expected: both green.

## Report back
Append a worker entry to `handoffs/RUN-STATE.md`. Synthesized summary only — no raw logs.
