# Run state — 20260722-161131-n2hub-259 perf: persist coalescing

New `src/store/persistCoalescer.ts` (trailing non-restarting, 1000ms) wired into
`AppStore.tsx`: `[state]` effect schedules instead of sync `saveData`;
pagehide/visibility/unmount flush; retry/keepLocal/acceptExternal cancel first;
external-change flush-then-`isOwnLastWrite` fast path. `storage.ts` tracks last
written raw+revision; `ExternalChangeInfo.newValue` added; registerPersonOrder
render-guarded. Tests: persistCoalescer.test.ts + storage.test.ts. Focused +
full suite (1393) + build all green.

---

# Run state — 20260722-144152-n2hub-257 settings + nav cleanup

## Goal

"Konto" → "Ustawienia" (gear; Administracja switches to ShieldCheck), settings
page = NEW menu-order editor (device-local `UiPrefs.navOrder`, up/down + reset,
no drag) + password change (supabase-only), duplicated Mój profil / Profil w
chmurze sections removed, sidebar footer = avatar bubble → `/people/<own id>` +
narrower "Wyloguj", and FULL impersonation removal (UI switcher, banner,
IMPERSONATE/STOP actions, `AppData.impersonatorId`, `users.impersonate`,
selectors, persistGate/storage/seed/export plumbing). Historical
`ActivityEvent.impersonatorId?` stays read-only; cloud sync untouched; no DB
migration; DATA_VERSION stays 7.

## Packages

- `handoffs/packages/settings-nav-cleanup.md` —
  PKG-20260722-settings-nav-cleanup, tier: developer, ready, Codex review
  required. Single package (items are interlocked in App.tsx/AccountPage).

## Changed boundaries (planned)

- Shell/UI: `src/App.tsx`, new `src/components/navItems.ts` (+test),
  `src/components/icons.ts` (ShieldCheck), `src/pages/AccountPage.tsx`,
  `src/utils/uiPrefs.ts`, `src/styles.css`, `src/onboarding/OnboardingRoot.tsx`,
  `src/pages/AdminPage.tsx`.
- Store: `src/types.ts`, `AppStore.tsx`, `selectors.ts`, `permissions.ts`,
  `useCan.ts`, `persistGate.ts`, `storage.ts` (strip legacy key, no echo-write),
  `seed.ts`, `exportDryRun.ts`, `src/supabase/referenceData.ts` (opts lose
  `impersonating`), `src/pages/TeamPage.tsx`.

## Verification

Focused vitest list in the package, then `npm test` + `npm run build`;
browser: `node scripts/browser-check-ui-keyboard.mjs` (footer DOM changes;
"Wyloguj" accessible name preserved). teamScope/profileEditPolicy tests must
pass unmodified.

## Developer result (n2hub-257)

Implemented in full. Focused list PASS 669/0; `npm test` 1379 passed (54 files);
`npm run build` green. Browser check NOT run — playwright not installed in this
worktree; footer keeps `<button name="Wyloguj">` so the script contract holds.
Context expansion: `src/auth/SessionProvider.tsx` used deleted `realUserId` →
switched to `state.currentUserId` (direct dependency, noted as deviation).

## Open questions

None — all design decisions settled in the package.

## Wiki note

`ui-navigation-and-onboarding.md` will be stale (Konto/`/account` description,
AccountPage "Profil w chmurze", impersonation fallback mentions);
`state-and-persistence.md` loses `impersonatorId` bookkeeping. Final reviewer
owns the wiki decision.

## 258 — merge Panel + Moja praca (developer)

Merged „Moja praca" into „Panel": Zasobnik+Alerty are new Panel tiles (grid areas
`bin`/`alerts`), single home `HOME_PATH='/dashboard'` (new pure `homeRoute.ts`+test).
`/my-work`→redirect; MyWorkPage + nav item + `landingPathForRole` removed;
OnboardingRoot `@home`/catalog copy updated. `npm test` 1373 pass; build green.
Touched CSS + selectors sections unchanged. Blocker: none.
