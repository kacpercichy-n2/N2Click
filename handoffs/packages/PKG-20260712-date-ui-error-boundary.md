# Handoff: Polish inline date validation in forms + root error boundary with recovery

- **Package ID:** PKG-20260712-date-ui-error-boundary
- **Status:** ready
- **Tier:** developer
- **Model:** opus
- **Depends on:** PKG-20260712-date-validation-core
- **Blast radius:** low–medium — three form surfaces + a new top-level boundary; no data-model change. Recovery actions touch localStorage but only via storage.ts helpers and only user-triggered.

## Goal

(1) Project and task forms reject missing/invalid/reversed/over-cap periods with
Polish inline errors BEFORE dispatch (the reducer guard from the core package is
the backstop, not the UX). (2) A root React error boundary replaces the blank
page with a Polish recovery screen offering user-triggered export / reload /
reset — it never clears data automatically.

## Context the worker needs

- Relevant files: `src/pages/ProjectsPage.tsx` (create form `submit`, ~line 192),
  `src/pages/ProjectDetailPage.tsx` (detail save ~line 111, milestone add form
  + inline milestone date input ~lines 340–380), `src/components/TaskModal.tsx`
  (period validity ~lines 348–352, error paragraphs ~lines 847–852 and ~989,
  local `MAX_PERIOD_DAYS` ~line 31), `src/main.tsx` (mount point), new file
  `src/components/ErrorBoundary.tsx`, `src/styles.css`.
- From the core package (already merged before you start):
  `isValidDateStr`, `periodError`, `PERIOD_ERROR_LABELS`, `MAX_TASK_PERIOD_DAYS`
  in `src/utils/dates.ts`; `exportRawData()` and `clearData()` in
  `src/store/storage.ts`.
- Conventions: `CLAUDE.md` — all UI strings Polish; plain CSS with `--n2-*`
  tokens in `src/styles.css`; no direct localStorage in components (use the
  storage.ts helpers); existing inline-error pattern is
  `<p className="field-error">…</p>`.
- Prior decisions (settled): error boundary must be a class component (only
  class components catch render errors); it must NOT use the store or router
  (it wraps them); recovery actions are strictly user-triggered.

## Scope

### In scope

1. **ProjectsPage create form:** replace the `endDate < startDate` check with
   `const err = periodError(startDate, endDate)`; on error
   `setError(PERIOD_ERROR_LABELS[err])` and return. Keep the existing
   name/client checks as they are.
2. **ProjectDetailPage:**
   - Detail-card save: same replacement as above (project period, no max-days).
   - Milestone add form: when the name check passes but
     `!isValidDateStr(msDate)`, show a `field-error` with
     `Podaj prawidłową datę kamienia milowego.` and do not dispatch.
   - Inline milestone date `<input type="date">` (existing rows): only dispatch
     the date-change action when `isValidDateStr(value)`; otherwise ignore the
     change (the controlled input snaps back to the stored value).
3. **TaskModal:** derive validity from the shared utility:
   `const perErr = periodError(startDate, endDate, { maxDays: MAX_TASK_PERIOD_DAYS })`,
   `periodValid = perErr === null`. Replace the two hardcoded error paragraphs
   with `PERIOD_ERROR_LABELS[perErr]` (single error slot is fine). Delete the
   local `MAX_PERIOD_DAYS` and import `MAX_TASK_PERIOD_DAYS`. Ensure no `NaN`
   can render (the "X dni" period-length display, if shown, only renders when
   `periodValid`). Keep the existing save-gate (`if (!periodValid) return;`).
4. **`src/components/ErrorBoundary.tsx` (new):** class component with
   `static getDerivedStateFromError` + `componentDidCatch` (log via
   `console.error`). Fallback screen, all Polish:
   - Heading: `Coś poszło nie tak`
   - Body: `Aplikacja napotkała nieoczekiwany błąd. Twoje dane pozostały zapisane lokalnie w przeglądarce — możesz pobrać ich kopię, odświeżyć aplikację albo wyzerować dane, jeśli błąd się powtarza.`
   - Buttons (in this order):
     - `Pobierz kopię danych (JSON)` — `exportRawData()`; if non-null, download
       via `Blob` + temporary `<a download="n2hub-dane.json">`; if null, hide or
       disable the button.
     - `Odśwież aplikację` — `window.location.reload()`.
     - `Wyzeruj dane i zacznij od nowa` — `window.confirm('Na pewno usunąć wszystkie lokalne dane aplikacji? Tej operacji nie można cofnąć.')`,
       then `clearData()` + `window.location.reload()`. Nothing is ever cleared
       without this confirm.
   - Show the error message text in a small muted `<details>` block
     (summary: `Szczegóły techniczne`).
5. **`src/main.tsx`:** wrap everything inside `StrictMode` with
   `<ErrorBoundary>` — i.e. above `BrowserRouter` and `AppStoreProvider`, so
   provider/render crashes anywhere in the tree are caught.
6. **`src/styles.css`:** minimal styles for the fallback (centered card on the
   dark background, existing `--n2-*` tokens, `btn` classes reused). Respect
   the existing breakpoints; no new fonts/libraries.

### Out of scope

- Reducer/storage changes (done in the core package).
- Unit tests (separate package); no react-testing-library setup.
- Catching event-handler errors (boundaries don't; the reducer guards cover the
  dispatch path) — acceptable, note it in a code comment.
- Auto-recovery, telemetry, backend, any new feature.
- Restyling existing forms beyond the error messages.

## Implementation notes

- Date inputs (`type="date"`) yield `''` when cleared — that is the primary
  repro: clear "Data startu" on a project and save. After this package the form
  shows `Podaj datę startu.` inline and dispatches nothing.
- TaskModal already tracks `periodValid` consumers (allocation grid gating at
  ~line 360, footer at ~989) — keep their behavior, only change how validity is
  computed and which message renders.
- The boundary must not import from `AppStore` (a crashing provider would take
  the boundary down with it).

## Acceptance criteria

- [ ] Project create form: clearing either date and submitting shows the exact
      Polish label from `PERIOD_ERROR_LABELS`; nothing is persisted (reload →
      no new project). Same on the project detail card.
- [ ] Milestone: adding with an empty/invalid date shows the inline error;
      editing an existing milestone's date to empty leaves the stored date
      unchanged.
- [ ] TaskModal: empty/invalid/reversed dates and a >92-day period each show
      the correct Polish message, block save, and no `NaN` appears anywhere in
      the modal.
- [ ] A forced render error (temporarily `throw` in a page component during dev
      verification — remove afterwards) shows the Polish recovery screen, not a
      blank page; export downloads the raw JSON; reset asks for confirmation,
      clears, reloads into the sample banner; reload button reloads.
- [ ] With valid inputs every form behaves exactly as before.
- [ ] All new strings are Polish; console free of errors/warnings in normal use.
- [ ] `npx tsc --noEmit`, `npm test`, `npm run build` all pass.

## Tests

- Command: `npx tsc --noEmit && npm test && npm run build`
- Expected: existing suite green (this package adds no unit tests). Manual dev-
  server verification of the four acceptance flows above; the end-of-run
  Chromium/WebKit browser check (orchestrator) will re-run the empty-project-
  dates repro.

## Report back

Synthesized summary only: files changed one-line each, the manual flows you
verified, test results, deviations. Log to `handoffs/RUN-STATE.md`. No raw logs.
