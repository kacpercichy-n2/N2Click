# Handoff: Persistence UI — honest SaveStatus, global failure/conflict/refresh banner

- **Package ID:** PKG-20260713c-persist-ui
- **Status:** ready
- **Tier:** developer
- **Model:** opus
- **Depends on:** PKG-20260713c-persist-core
- **Blast radius:** low — presentational + hook wiring. No reducer/storage logic (all in core). Polish copy is FIXED below, verbatim.

## Goal

The save-state indicator must never show "Zapisano" after a failed write (new durable `error` state), and a global banner (house pattern, like the impersonation banner) must surface: (1) a durable Polish write-failure state with recovery guidance (export copy + retry), (2) the two-tab conflict choice, (3) a dismissible "refreshed from another tab" notice.

## Context the worker needs

- Relevant files: `src/utils/useSaveStatus.ts` (whole file, 56 lines), `src/components/SaveStatus.tsx`, `src/components/TaskModal.tsx` (:125 hook call, :565 markSaved), `src/pages/ProjectDetailPage.tsx` (:90 hook call, :135 markSaved), `src/App.tsx` (SampleBanner mount :288, impersonation banner pattern :274-287), `src/components/ErrorBoundary.tsx` (:34-46 download pattern to copy, :74-78 crash copy to reword), `src/styles.css` (`.impersonation-banner`, `.save-status*` for patterns/tokens), new file `src/components/PersistenceBanner.tsx`.
- From core (FROZEN API): `usePersistence()` from `../store/AppStore` returning `{ saveError: SaveFailureReason | null; external: 'none' | 'refreshed' | 'conflict'; retryPersist(); acceptExternal(); keepLocal(); dismissExternalNotice() }`; `SaveFailureReason = 'quota' | 'unavailable' | 'serialization' | 'unknown'`; `exportRawData` from `../store/storage`; `setDirtyFlag`/`clearDirtyFlag` from `../utils/dirtyRegistry`.
- Conventions: repo `CLAUDE.md` (Polish UI, `--n2-*` tokens, semantic `-soft` backgrounds, no toasts, `prefers-reduced-motion` respected — no new animation at all is fine).
- ENVIRONMENT: unattended run. ALL git commands denied — do not attempt, do not commit. vite CLI / `npm run dev` / curl denied. Typecheck via `node ./node_modules/typescript/bin/tsc --noEmit`; tests via `npm test`; browser verification is NOT this package's job (PKG-20260713c-persist-browser-docs) — your guards must mirror core one-for-one instead.

## Scope

### In scope

1. `src/utils/useSaveStatus.ts`:
   - `SaveState` union gains `'error'`.
   - Signature: `useSaveStatus(dirty: boolean, persistFailed = false)`. Final status: `persistFailed ? 'error' : (transient ?? (dirty ? 'dirty' : 'clean'))` — the override is durable (no timer clears it; it disappears only when `persistFailed` goes false, i.e. a later write succeeded).
   - Register form dirtiness in the global registry: a `useRef<object>({})` key; effect syncs `setDirtyFlag(key, dirty)` on `dirty` change, cleanup `clearDirtyFlag(key)` on unmount. Do NOT change the beforeunload behavior (stays keyed on `dirty` alone — the saveError beforeunload lives in the banner, single source).
   - Update the header doc comment: persistence is no longer "fire-and-forget"; the hook now reflects real write outcomes and feeds the tab-conflict dirtiness registry.
2. `src/components/SaveStatus.tsx` — new branch (place BEFORE the saved fallback):
   ```tsx
   if (status === 'error') return (
     <span className="save-status save-status--error" role="status">
       <AlertTriangle size={14} aria-hidden />
       Nie zapisano
     </span>
   );
   ```
3. Call sites: `TaskModal.tsx:125` and `ProjectDetailPage.tsx:90` — obtain `const { saveError } = usePersistence();` and pass `useSaveStatus(dirty, saveError !== null)`. No other logic change in either file (`markSaved()` calls stay; the error override wins over the transient regardless).
4. `src/components/PersistenceBanner.tsx` (new) — reads `usePersistence()` + `useStore()` (for export). Render priority: saveError > conflict > refreshed > null. Exact copy:
   - **Failure banner** (`role="alert"`, class `persistence-banner persistence-banner--error`), first sentence by reason:
     - quota: `Nie udało się zapisać danych — brak miejsca w pamięci przeglądarki.`
     - unavailable: `Nie udało się zapisać danych — pamięć przeglądarki jest niedostępna (np. tryb prywatny).`
     - serialization: `Nie udało się zapisać danych — nie można ich przekształcić do zapisu.`
     - unknown: `Nie udało się zapisać danych — wystąpił nieoczekiwany błąd zapisu.`
     - second sentence (always): `Zmiany istnieją tylko w tej karcie i przepadną po jej zamknięciu — pobierz kopię danych lub spróbuj ponownie.`
     - buttons: `Pobierz kopię danych (JSON)` (btn soft) and `Spróbuj ponownie` (btn primary → `retryPersist()`).
     - Export handler: `try { JSON.stringify(state) } catch { exportRawData() ?? return }` → Blob download `n2hub-dane.json`, copying ErrorBoundary's `handleExport` pattern (:34-46) exactly. Exporting the IN-MEMORY state is the point — after a failed write, localStorage is stale; fall back to the raw stored copy only when the state itself cannot serialize.
     - While this banner is mounted, register a `beforeunload` prompt (same handler shape as useSaveStatus:44-52), removed on cleanup.
   - **Conflict banner** (`role="alert"`, `persistence-banner persistence-banner--conflict`):
     - text: `Dane zostały zmienione w innej karcie przeglądarki, a ta karta ma niezapisane zmiany.`
     - button 1 `Wczytaj wersję z innej karty` (btn primary): `window.confirm('Wczytać dane zapisane przez inną kartę? Niezapisane zmiany w tej karcie zostaną utracone.')` → `acceptExternal()`.
     - button 2 `Zostaw moją wersję (nadpisz)` (btn ghost) with `title="Zapisuje stan tej karty, nadpisując zmiany z innej karty."` → `keepLocal()`.
   - **Refresh notice** (`role="status"`, `persistence-banner persistence-banner--info`):
     - text: `Dane odświeżono — wczytano zmiany zapisane w innej karcie.`
     - dismiss button `OK` (btn ghost small) → `dismissExternalNotice()`.
5. `src/App.tsx` — mount `<PersistenceBanner />` inside `<main className="app-main">` immediately BEFORE `<SampleBanner />` (:288), so it shows on every routed page. It is deliberately NOT rendered on the login screen (the `needsLogin` early return at :139) — no edits happen there and a clean tab auto-refreshes silently anyway; note this in a one-line comment at the mount.
6. `src/components/ErrorBoundary.tsx` — one-sentence honesty reword of the crash body (:75-77), replacing the claim that data "pozostały zapisane lokalnie" (which a failed write can falsify) with:
   `Aplikacja napotkała nieoczekiwany błąd. Możesz pobrać kopię danych zapisanych w przeglądarce, odświeżyć aplikację albo wyzerować dane, jeśli błąd się powtarza.`
   Nothing else in the file changes.
7. `src/styles.css` — `.persistence-banner` base + `--error` / `--conflict` / `--info` variants and `.save-status--error`. Mirror `.impersonation-banner`'s layout pattern; use existing semantic tokens (`--n2-danger` + danger-soft for error, warning-soft for conflict, info-soft for info); no new animation; visible at both breakpoints (1180px/760px — check the impersonation banner's responsive rules and match them).

### Out of scope (do NOT touch)

- `src/store/storage.ts`, `src/store/AppStore.tsx` beyond IMPORTING from them (core owns all logic; if something you need is missing from the frozen API, STOP and report — do not fork logic into components).
- `src/utils/uiPrefs.ts`, onboarding (`src/onboarding/`), `WeekView.tsx`/calendar pointer lifecycle, `SampleBanner`, `GlobalSearch`, any reducer/selector/migration.
- Any test file (PKG-20260713c-persist-tests) or script (PKG-20260713c-persist-browser-docs).
- No toasts/modals for persistence (banner only; the ONE `window.confirm` above is the house-standard destructive confirm), no auto-dismiss timers, no new dependencies, no data mutation from the banner beyond the four context callbacks.

## Implementation notes

- The `'error'` override must beat the `markSaved()` transient: a save dispatch flips SaveStatus to `Zapisywanie…` for ≤350ms, the persist effect fails synchronously after commit, `saveError` lands via context, and the status must read `Nie zapisano` — verify the override is computed from `persistFailed` directly (not inside the timer chain) so this ordering is guaranteed.
- `usePersistence` throws outside the provider — TaskModal and ProjectDetailPage are always inside it (mounted under `AppStoreProvider`), as is the banner.
- Keep icon usage to the existing `src/components/icons.ts` exports (`AlertTriangle`, `Check` already exist; pick from what's there — add no new icon dependency).
- Buttons: reuse existing `.btn` variants (`primary`, `soft`, `ghost`, `small`) — no new button styles.

## Acceptance criteria

- [ ] With a write failure active: SaveStatus shows `Nie zapisano` (never `Zapisano`, never stuck `Zapisywanie…`) in TaskModal and ProjectDetailPage; the failure banner shows the reason-correct first sentence, both buttons work (export downloads current in-memory data; retry clears the banner once writes succeed); `beforeunload` prompts while it is up.
- [ ] With a conflict active: the conflict banner shows the exact copy; `Wczytaj wersję z innej karty` confirms then replaces local state; `Zostaw moją wersję (nadpisz)` persists the local state and closes the banner.
- [ ] After a clean auto-refresh: the info notice appears with the exact copy and dismisses via `OK`.
- [ ] Banner mounts once in the app shell, renders above page content on every route, styled with existing tokens, both breakpoints, no console warnings.
- [ ] ErrorBoundary copy updated exactly as specified; all other Polish strings verbatim per this package.
- [ ] `node ./node_modules/typescript/bin/tsc --noEmit` → 0 errors; `npm test` green with zero test files changed.

## Tests

- Command: `node ./node_modules/typescript/bin/tsc --noEmit` then `npm test`.
- Expected: 0 tsc errors; all tests green at the current baseline (391 + whatever the parallel tests package has added by your run time — count may be in flux; zero FAILURES is the bar, and you must touch no test file).

## Report back

Synthesized summary only: files changed one-line each; DOM hooks + exact rendered strings for the browser-check package (classes, roles, button texts, confirm text); tsc/test results; deviations (should be none).
