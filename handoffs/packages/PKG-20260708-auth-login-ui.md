# Handoff: Local login screen, logout, admin quick-switch, password management UI

- **Package ID:** PKG-20260708-auth-login-ui
- **Status:** ready
- **Tier:** developer
- **Model:** opus
- **Depends on:** PKG-20260708-auth-data (fields/actions/permissions); run AFTER PKG-20260708-budget-week-ui (styles.css file-conflict ordering)
- **Blast radius:** medium — gates the entire UI behind login; touches App.tsx shell.

## Goal

Client-side login gating the app: with people present and nobody logged in, only
a login screen renders. Login = pick a person (+ password when one is set).
"Występuj jako" becomes an administrator-only quick switch; everyone gets
"Wyloguj". Profiles gain a password set/change/clear section.

## Context the worker needs

- Relevant files: `src/App.tsx` (shell + sidebar acting-as block lines
  185–223), new `src/pages/LoginPage.tsx`, `src/pages/PersonProfilePage.tsx`
  (password section), `src/utils/password.ts` (`hashPassword`,
  `verifyPassword`), `src/store/permissions.ts` (`can`, `users.impersonate`,
  `people.manage`), `src/store/AppStore.tsx` (`SET_CURRENT_USER`,
  `SET_PASSWORD`, `LOGOUT`), `src/components/Avatar.tsx`, `src/styles.css`
  (dark N2 tokens `--n2-*`; glass card patterns).
- Conventions: CLAUDE.md — Polish strings, dark N2 theme, no new libraries,
  1180/760 breakpoints, `prefers-reduced-motion` respected.
- Prior decisions (architect-settled):
  1. **Session = `currentUserId`.** Logged in ⇔ `currentUserId` resolves to an
     existing person. It already persists in AppData, so login survives reload
     BY DESIGN (note in a comment that real sessions come with the API). No new
     storage keys.
  2. **Gate in App.tsx:** when `state.people.length > 0` and no resolvable
     current user → render `<LoginPage />` INSTEAD of the whole shell
     (no sidebar, no routes). Zero people = setup mode, no login (mirrors the
     admin-gate no-lockout rule). A deleted current user automatically falls
     back to the login screen (DELETE_PERSON already clears `currentUserId`).
  3. **LoginPage UX:** centered brand card ("N2Hub", brand mark), person picker
     (avatar + name + `ROLE_LABELS` label; list buttons or a select — pick the
     cleaner for ~3–30 people), then: person with `passwordHash === ''` → button
     `Zaloguj się` logs straight in; with a hash → password input
     (`type="password"`, label `Hasło`) + `Zaloguj się`; wrong password shows
     inline `Nieprawidłowe hasło` (no lockouts, no counters). Enter submits.
     Verification via `verifyPassword` (async handler).
  4. **Sidebar:** the "Występuj jako" select renders ONLY when
     `can(currentUser, 'users.impersonate')` (administrators). Below it (for
     everyone) a `Wyloguj` button dispatching `LOGOUT`. The collapsed avatar
     shortcut stays as is. Label/title of the select unchanged.
  5. **Password management (PersonProfilePage):** section `Hasło`, visible when
     the profile is the logged-in user's own OR `can(user, 'people.manage')`.
     Fields `Nowe hasło` + `Powtórz hasło`, button `Ustaw hasło` (or
     `Zmień hasło` when a hash exists). Validation: min 4 chars, both match —
     inline Polish errors (`Hasło musi mieć co najmniej 4 znaki`,
     `Hasła muszą być takie same`). Admins additionally get `Usuń hasło`
     (confirm → SET_PASSWORD with `''`) — this is the documented recovery path
     (a passwordless person can always log in), keeping the no-lockout rule.
     Hash with `hashPassword` BEFORE dispatch; the reducer stays sync.
  6. **Seed/demo:** seeded people are passwordless — after loading sample data
     the login screen (when logged out) lets you enter as anyone with one
     click. Loading the sample keeps auto-selecting Kasia (existing behavior,
     unchanged).

## Scope

### In scope

- `src/pages/LoginPage.tsx` (new) + its styles in `src/styles.css`
  (`.login-*` classes; dark brand card; responsive at 760px).
- `src/App.tsx`: the gate (decision 2), impersonate-gating of the select,
  `Wyloguj` button.
- `src/pages/PersonProfilePage.tsx`: the password section (decision 5).

### Out of scope

- Permission gating of pages/actions beyond the impersonate select
  (PKG-20260708-permission-gating).
- Profile fields phone/availability/supervisor (PKG-20260708-profile-availability).
- Any store/type/migration change (exists from PKG-20260708-auth-data).
- Unit tests (store-level auth already covered by PKG-20260708-store-tests).
- Remember-me, password strength meters, rate limiting, real security.

## Implementation notes

- The gate must render BEFORE the router/sidebar so no route flashes; keep
  `<TaskModal />` and GlobalSearch inside the gated shell only.
- LoginPage lives outside the shell — give it its own full-viewport layout;
  reuse existing card/token classes where sensible.
- Async submit handler: disable the button while hashing/verifying to avoid
  double dispatch.
- Keep the `acting-as` CSS contract intact (collapsed-sidebar rules from the
  earlier run reference `.acting-as` / `.acting-as-collapsed`).
- Verify in the running dev server (5173; do not start another): logout → login
  as each seeded person; set a password on Kasia, logout, wrong + right
  password; admin clears it.

## Acceptance criteria

- [ ] Logged out (people exist): only the login screen renders — no sidebar,
      no routes, Ctrl/Cmd+K inert.
- [ ] Passwordless person: one-click login lands on /dashboard as that person.
- [ ] Person with a password: wrong password → inline `Nieprawidłowe hasło`,
      stays logged out; right password logs in.
- [ ] Reload while logged in stays logged in; `Wyloguj` returns to the login
      screen and persists (reload still logged out).
- [ ] "Występuj jako" select visible only to administrators; switching works as
      before for them; non-admins see only `Wyloguj`.
- [ ] Password section: set, change, mismatch/min-length inline errors, admin
      `Usuń hasło` behind confirm; person can then log in without a password.
- [ ] Zero-people state (fresh, empty localStorage): NO login screen; sample
      banner + setup flow reachable exactly as today.
- [ ] Polish strings throughout; dark theme consistent; usable at ≤760px;
      console clean.
- [ ] `npx tsc --noEmit` clean; `npm test` green; `npm run build` succeeds.

## Tests

- Command: `npx tsc --noEmit && npm test && npm run build`
- Expected: all green (no new unit tests). Interactive criteria verified on the
  running dev server; list what was browser-verified in your report.

## Report back

Synthesized summary only (files changed one-line each, tests, deviations,
what needs the human walkthrough). Append to `handoffs/RUN-STATE.md` under the
current run's Worker log.
