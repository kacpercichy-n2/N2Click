# Handoff: Explicit save states + dirty-state guards (TaskModal, ProjectDetailPage)

- **Package ID:** PKG-20260708-save-states
- **Status:** ready
- **Tier:** developer
- **Model:** opus
- **Depends on:** none (if PKG-20260708-icons-foundation has landed, use `Check`/`AlertTriangle` from `src/components/icons.ts` in the status badge; otherwise text-only)
- **Blast radius:** low — UI-only; no reducer/data changes.

## Goal
Remove save ambiguity: both editors show an explicit status — `Niezapisane zmiany` / `Zapisywanie…` / `Zapisano ✓` — and warn before discarding unsaved changes.

**Architect decisions (do not revisit):**
- Persistence is synchronous localStorage (a `useEffect` in AppStore saves after every action). "Saving…" is therefore rendered for a fixed minimum of 350 ms after the save dispatch purely as visible feedback, then flips to "Zapisano ✓" which auto-clears after 2 s. Do not fake async beyond that.
- In-app route blocking is NOT possible cleanly (app uses `BrowserRouter`, not a data router, so `useBlocker` is unavailable). The guard surface is: (a) all TaskModal close paths, (b) the ProjectDetailPage "Wróć" action, (c) `beforeunload` for tab close/reload while dirty. Sidebar navigation away from a dirty ProjectDetailPage is intentionally NOT blocked — accepted gap, note it in RUN-STATE.

## Context the worker needs
- Relevant files: `src/components/TaskModal.tsx` (`TaskModalShell` owns close paths: Escape keydown, scrim/viewport click, ✕ button; `TaskEditor` owns the form state: `title, description, projectId, statusId, estimatedRaw, startDate, endDate, assigneeIds, allocations` and `handleSave`/`onCancel`), `src/pages/ProjectDetailPage.tsx` (already computes a `dirty` boolean and conditionally shows the save button; "Wróć" is currently a `<Link to="/projects">`), `src/styles.css` (append).
- Conventions: `/Users/kacpercichyn2/Documents/N2click/CLAUDE.md`. UI text **Polish**. CLAUDE.md is partially stale: TaskEditorPage no longer exists — the editor lives in TaskModal.

## Scope
### In scope
1. **New component** `src/components/SaveStatus.tsx`: presentational badge, props `{ status: 'clean' | 'dirty' | 'saving' | 'saved' }`. Renders nothing for `clean`; `dirty` → `Niezapisane zmiany` (warning tone, `--n2-warning`); `saving` → `Zapisywanie…`; `saved` → `Zapisano ✓` (success tone, `--n2-success`). Class names `save-status save-status--dirty` etc.; CSS appended under `/* ---------- Save status ---------- */`.
2. **New hook** (same file or `src/utils/useSaveStatus.ts`): given `dirty: boolean`, manages the state machine — `dirty ? 'dirty' : 'clean'` at rest; `markSaved()` sets `saving` for 350 ms then `saved` for 2000 ms then back to rest (timers cleaned up on unmount).
3. **TaskEditor dirty computation** (`src/components/TaskModal.tsx`): snapshot the initial values of all form state (including `assigneeIds` as a set and `allocations` map — compare with a stable serialization, e.g. JSON of sorted entries) on mount; `dirty` = current ≠ snapshot. New tasks: dirty once the user changes anything from the initial defaults.
4. **TaskModal guard:** thread `dirty` up from `TaskEditor` to `TaskModalShell` (callback prop or ref). Every close path (Escape, scrim click, ✕, Anuluj) runs `window.confirm('Masz niezapisane zmiany. Zamknąć bez zapisywania?')` when dirty; cancel keeps the modal open. `handleSave` calls `markSaved()`; since the modal closes on save (`onSaved`), also update the snapshot before closing so no confirm fires. Show `<SaveStatus>` in the modal head next to the title.
5. **ProjectDetailPage:** show `<SaveStatus>` in the `page-head` (reuse the existing `dirty`); `save()` calls `markSaved()` and the button stays visible during `saving/saved` states (keep current conditional but include the transient states so the badge has a home — simplest: always render the badge row when `dirty || status !== 'clean'`). Convert "Wróć" from `<Link>` to a button that confirms when dirty (`window.confirm('Masz niezapisane zmiany. Opuścić bez zapisywania?')`) then `navigate('/projects')`.
6. **beforeunload:** in both editors, while dirty, register `beforeunload` with `e.preventDefault()` (standard unsaved-changes prompt); removed when clean/unmounted. Put the listener logic in the shared hook.
### Out of scope
- No changes to reducer actions, storage.ts, or save semantics (project paid-coin toggle, milestone edits, etc. remain instant-commit and show NO save status — they are not draft-based).
- No blocking of sidebar/global navigation; no router migration to `createBrowserRouter`.
- Other forms (ProjectsPage create form, PeoplePage form, AdminPage) untouched.

## Implementation notes
- Allocation-map comparison: normalize `Object.entries(allocations).filter(([,h]) => h > 0).sort()` before JSON.stringify — avoids false dirt from deleted-zero keys.
- `useEffect` cleanup for the timers and the beforeunload listener; make sure remount-per-key (`key={taskParam}`, `key={project.id}`) resets everything naturally.
- Confirm-on-Escape: the Escape handler lives in `TaskModalShell`'s `useEffect`; it needs access to current dirty state (ref, to avoid re-registering per keystroke).

## Acceptance criteria
- [ ] Editing any task field/assignee/allocation cell shows `Niezapisane zmiany`; saving shows `Zapisywanie…` then `Zapisano ✓`; reopening a saved task shows no badge.
- [ ] Escape / scrim / ✕ / Anuluj on a dirty task modal prompts; confirming closes without saving, cancelling stays; clean modal closes silently.
- [ ] ProjectDetailPage: badge behavior identical; "Wróć" prompts only when dirty; sidebar nav is not blocked (known gap).
- [ ] Reload/close of a dirty tab triggers the native browser prompt; clean tab doesn't.
- [ ] Manual checklist items 3, 4, 12 (task round-trip, project card save, validation) still pass; console clean (no state-update-on-unmounted warnings).

## Tests
- Command: `npx tsc --noEmit && npm run build`
- Expected: both green.

## Report back
Append a worker entry to `handoffs/RUN-STATE.md`. Synthesized summary only — no raw logs.
