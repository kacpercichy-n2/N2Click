# Handoff: Safe impersonation — separate logged-in identity from acted-as identity

- **Package ID:** PKG-20260708-b2-impersonation
- **Status:** ready
- **Tier:** developer
- **Model:** opus
- **Depends on:** PKG-20260708-b2-calendar-ui (styles.css write-ordering only — no logical dependency)
- **Blast radius:** high — session/permission semantics + a storage-shape addition (additive, no version bump).

## Goal

Kill the self-demotion trap: an administrator who picks someone in "Występuj jako" currently BECOMES that person — the switcher itself disappears (gated on the impersonated identity's `users.impersonate`) and there is no way back except logout. After this package, impersonation is an explicit, reversible admin tool: the logged-in identity is remembered, a persistent banner offers one-click return, and the switcher never vanishes for the real admin.

## Context the worker needs

- Relevant files: `src/types.ts` (AppData ~L179-190), `src/store/storage.ts` (`emptyData` ~L74-90, `migrateV1` return ~L277-284, `loadData` ~L514-544), `src/store/AppStore.tsx` (Action union ~L149+, `SET_CURRENT_USER`/`LOGOUT` cases ~L1364-1375, `DELETE_PERSON`/`deletePerson` ~L1085+/L1353), `src/store/selectors.ts`, `src/App.tsx` (acting-as block ~L199-248, `needsLogin` gate, banner mount point above `<SampleBanner />` ~L252), `src/styles.css`.
- Conventions: CLAUDE.md; storage.ts owns all persistence/migration; every mutation is one reducer action; Polish UI strings.
- Prior decisions (architect — final, do not re-open):
  1. **Data model (additive, NO version bump).** `AppData` gains `impersonatorId: string` — `''` when not impersonating; otherwise the REAL logged-in person's id while `currentUserId` holds the impersonated identity. Defaults/sanitizing follow the `ensureStartMinutes` pattern: `emptyData()` and `migrateV1`'s return include `impersonatorId: ''`; `loadData` (which already spreads `emptyData()` for missing fields) additionally sanitizes on EVERY load — clear to `''` when it references a non-existent person or equals `currentUserId`. `DATA_VERSION` stays 5.
  2. **Reducer actions.** New `IMPERSONATE { personId }`: no-op when the person doesn't exist or equals `currentUserId`; when `personId === state.impersonatorId` it behaves as return; otherwise `currentUserId = personId` and `impersonatorId = state.impersonatorId || state.currentUserId` (chained switches preserve the ORIGINAL real user). New `STOP_IMPERSONATION`: no-op at `''`, else `currentUserId = impersonatorId`, `impersonatorId = ''`. `SET_CURRENT_USER` (login) and `LOGOUT` both clear `impersonatorId` to `''` (LOGOUT clears both ids — full logout, not "return"). No activity rows for any of these (matches current SET_CURRENT_USER). Enforcement stays UI-level (consistent with the run-1 decision "UI-level enforcement until the API era") — the reducer does NOT check `users.impersonate`.
  3. **DELETE_PERSON interplay** (inside the existing guarded case/`deletePerson`): deleting the impersonated person (`currentUserId`) while impersonating returns the session to the impersonator (`currentUserId = impersonatorId`, `impersonatorId = ''`); deleting the impersonator ends impersonation bookkeeping (`impersonatorId = ''`) but leaves `currentUserId` (the last-admin guard already prevents the pathological case).
  4. **Selectors** (`src/store/selectors.ts`): `realUserId(state): string` = `impersonatorId || currentUserId`; `realUser(state): Person | undefined`; `isImpersonating(state): boolean` = `impersonatorId !== ''`. Pure, exported, JSDoc.
  5. **Permissions semantics: true preview.** Everything that reads `currentUser`/`useCan` keeps following the ACTED-AS identity (admin panel gate, block editing, comment signing — all unchanged). ONLY two things key off the real user: the switcher's visibility and the banner's return path.
  6. **App.tsx switcher.** Gate `can(realUser, 'users.impersonate', { peopleCount })` instead of `currentUser`. `onChange` dispatches `IMPERSONATE` (not SET_CURRENT_USER); `value={state.currentUserId}`. Remove the `"—"` empty option (login-era leftover; selecting it would soft-logout). Selecting the real user's own row returns (decision 2 handles it).
  7. **Banner.** When `isImpersonating`: render at the top of `app-main`, ABOVE `<SampleBanner />`, a persistent `impersonation-banner`: text `Występujesz jako {currentUser.name} — widzisz aplikację z jego/jej uprawnieniami.` (use `{name}`, skip gender forms: `… — aktywne są uprawnienia tej osoby.`) plus a button `Wróć do {realUser.name}` dispatching `STOP_IMPERSONATION`. Warning-soft styling (`--n2-warning` tokens), visible at all breakpoints, no animation. If `currentUser` is missing (deleted mid-session edge) the `needsLogin` gate wins — banner only renders when both people resolve.

## Scope

### In scope

- `src/types.ts`: `impersonatorId` field + doc comment.
- `src/store/storage.ts`: default + `migrateV1` + every-load sanitize per decision 1.
- `src/store/AppStore.tsx`: `IMPERSONATE` / `STOP_IMPERSONATION` actions + cases; `SET_CURRENT_USER`/`LOGOUT` clearing; DELETE_PERSON interplay (decision 3).
- `src/store/selectors.ts`: `realUserId` / `realUser` / `isImpersonating`.
- `src/App.tsx`: switcher gating/onChange/option removal (decision 6); banner (decision 7).
- `src/styles.css`: `.impersonation-banner` (+ ≤760px layout).
- `src/store/seed.ts` ONLY if its returned object literal needs the new field to satisfy tsc (set `''`).
- Mechanical test-fixture fixes: any `AppData` literals in existing tests that now fail tsc get `impersonatorId: ''` (no assertion changes). New coverage belongs to PKG-20260708-b2-tests.

### Out of scope

- Budget/bin/WeekView/TaskModal work (other packages). Reducer-level permission enforcement. A `version: 6` bump or any migration function. Changing comment/activity authorship (stays `currentUserId`). LoginPage changes (login already dispatches SET_CURRENT_USER — verify, don't redesign).

## Implementation notes

- `loadData` merges via `{ ...emptyData(), ...parsed }`, so the field default is free; add the sanitize step after `migrateV4toV5`, before/inside the final return (order with `ensureStartMinutes` is irrelevant — disjoint fields).
- Check `LoginPage.tsx` dispatches `SET_CURRENT_USER` for login; with decision 2 that auto-clears stale impersonation.
- The collapsed-sidebar `acting-as-collapsed` avatar button shows `currentUser` — leave it (it reflects the acting identity, which is correct).
- Keep the switcher label/title text; only gating + dispatch change.

## Acceptance criteria

- [ ] As a logged-in administrator, picking Marek in "Występuj jako": permissions collapse to Marek's (admin nav entry disappears, blocks gating follows Marek) BUT the switcher stays visible and the banner appears with a working `Wróć do {admin}` button that restores the admin session in one click.
- [ ] Chained impersonation (admin → Marek → Ola via the still-visible switcher) still returns to the ORIGINAL admin.
- [ ] Comments posted while impersonating are signed by the impersonated person (unchanged semantics).
- [ ] Reload mid-impersonation restores both identities (field persists); a payload missing `impersonatorId` loads as `''`; a dangling/self-referential `impersonatorId` is cleared on load.
- [ ] `LOGOUT` clears both ids and lands on the login screen; logging in never starts impersonated.
- [ ] Deleting the impersonated person returns the session to the impersonator; deleting the impersonator clears the bookkeeping.
- [ ] A non-administrator never sees the switcher (their `realUserId` is themselves); nothing else in their UI changes.
- [ ] No `"—"` option in the switcher; banner styled with warning tokens and usable ≤760px.

## Tests

- Command: `npx tsc --noEmit && npm test && npm run build`
- Expected: tsc clean; vitest green (only mechanical fixture additions here — new reducer/storage coverage lands in PKG-20260708-b2-tests); build OK (pre-existing chunk-size warning only). Interactive criteria go to the human walkthrough list.

## Report back

Synthesized summary only (files changed one-line each, test counts, deviations, not-CLI-verifiable walkthrough items). Append a worker-log block to `handoffs/RUN-STATE.md`. No raw logs.
