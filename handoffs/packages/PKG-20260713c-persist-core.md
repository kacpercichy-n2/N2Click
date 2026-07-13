# Handoff: Honest storage writes — SaveResult, revision envelope, storage-event listener, persistence context

- **Package ID:** PKG-20260713c-persist-core
- **Status:** ready
- **Tier:** developer
- **Model:** opus
- **Depends on:** none
- **Blast radius:** medium — touches the single persistence module (`storage.ts`) and the provider persist path (`AppStore.tsx`). No schema/DATA_VERSION change, no migration change, no UI rendering change (UI is PKG-20260713c-persist-ui).

## Goal

`saveData` must report success/failure explicitly (classified: quota / unavailable / serialization / unknown), the app store must record that outcome and expose it via a persistence context, and a small revision envelope + `storage`-event listener must detect same-browser external tab writes: auto-refresh in place when this tab is clean, flag a conflict when it is not. All data stays local; this is same-browser tab safety, NOT collaboration/sync/backup.

## Context the worker needs

- Relevant files: `src/store/storage.ts` (`STORAGE_KEY` :27, `loadData` :782-824, `exportRawData` :831-841, `saveData` :843-849, `clearData` :851-858), `src/store/AppStore.tsx` (Action union tail :182-184, `LOAD_SAMPLE`/`RESET_ALL` cases :1909-1914, provider + persist effect :1927-1942), new file `src/utils/dirtyRegistry.ts`.
- Conventions: repo `CLAUDE.md` (read fully). Reducer rejection = `return state` same reference; storage access ONLY inside storage.ts (plus uiPrefs.ts for device chrome — uiPrefs is OUT of scope here); no new dependencies.
- ENVIRONMENT: unattended run. ALL git commands denied — do not attempt, do not commit. `npm run dev`/vite CLI/curl denied. Typecheck via `node ./node_modules/typescript/bin/tsc --noEmit` (npx may prompt). Tests via `npm test`. Production build (only if needed) via `node -e "import('vite').then(v => v.build())"`. Capture the fresh test baseline BEFORE changing anything (expected 11 files / 391 tests — re-verify).
- Verified current behavior (architect, against code):
  1. `storage.ts:846-848` — `catch { /* Ignore write failures … Non-fatal for an alpha. */ }`: quota/private-mode/serialization failures are silently swallowed while the UI later shows "Zapisano".
  2. `AppStore.tsx:1935-1937` — `useEffect(() => { saveData(state); }, [state])`: outcome ignored.
  3. No `storage` event listener exists anywhere in `src/` (verified by grep); no revision/timestamp in the payload. Tab B loaded at T0 overwrites tab A's later writes wholesale on B's next dispatch.
- Prior decisions (architect, FINAL — do not reopen):
  1. **Write-result shape** — discriminated union in storage.ts:
     ```ts
     export type SaveFailureReason = 'quota' | 'unavailable' | 'serialization' | 'unknown';
     export type SaveResult = { ok: true; revision: number } | { ok: false; reason: SaveFailureReason };
     ```
  2. **Failure classification** — serialization is detected positionally (the `JSON.stringify` call gets its own try/catch → `'serialization'`); storage-layer throws go through a new exported pure `classifyStorageError(err: unknown): SaveFailureReason`: error-like with `name === 'QuotaExceededError'` or `name === 'NS_ERROR_DOM_QUOTA_REACHED'` or numeric `code === 22` or `code === 1014` → `'quota'` (covers Chromium/Firefox/Safari incl. legacy Safari private mode); `name === 'SecurityError'` → `'unavailable'`; anything else → `'unknown'`. Read `name`/`code` defensively off unknown (no `instanceof DOMException` — must work in the node test env with error-like plain objects).
  3. **Revision protocol** — envelope-only, owned entirely by storage.ts. `AppData`/`types.ts` are NOT changed and React state NEVER carries a revision (a stale in-state counter would lie). `saveData` writes `JSON.stringify({ ...data, revision })` where `revision = latestKnownRevision + 1` from a module-level `let latestKnownRevision = 0`; on success it records the new value. `loadData` records the stored payload's revision into `latestKnownRevision` (coerce: finite integer ≥ 0, else 0) and STRIPS the key so the returned `AppData` object has no `revision` property at runtime (strip in BOTH branches — verify the v1 migrate branch doesn't carry it either; `migrateV1` may build fresh objects, confirm by reading it). `clearData` resets `latestKnownRevision` to 0. **No DATA_VERSION bump** (stays 7): the envelope field is additive, defaulted on load, and invisible to every migration/normalization pass — bumping to 8 would only churn migration tests and re-run `localizeLegacyData` on v7 payloads for zero benefit.
  4. **External-change subscription** — storage.ts owns the listener wrapper:
     ```ts
     export type ExternalChangeInfo = { revision: number | null }; // null = key cleared or unparsable
     export function subscribeExternalChanges(cb: (info: ExternalChangeInfo) => void): () => void
     ```
     Adds a `window` `storage` listener; ignores events whose `key` is neither `STORAGE_KEY` nor `null` (`null` = `storage.clear()`); for relevant events computes `incoming = readEnvelopeRevision(e.newValue)`, max-merges `latestKnownRevision = Math.max(latestKnownRevision, incoming ?? 0)` BEFORE invoking `cb` (so a later local write always lands ABOVE the observed external revision — this is what keeps revisions monotonic across ping-ponging tabs), then calls `cb`. Returns an unsubscribe. `storage` events never fire in the originating tab, so every relevant event is external by definition — no writer-id needed.
  5. **New pure helpers exported for tests**: `readEnvelopeRevision(raw: string | null): number | null` (parse; return finite integer ≥ 0 `revision` or null on null/parse failure/absent/invalid) and `getLatestKnownRevision(): number`.
  6. **Where outcome state lives** — NOT in the reducer (persist outcome is meta-state, and dispatching from the persist effect would risk loops). Provider-local `useState` in `AppStoreProvider`, exposed via a NEW `PersistenceContext` + `usePersistence()` hook exported from `AppStore.tsx` (separate context so `useStore`'s signature and every existing consumer stay untouched):
     ```ts
     export type ExternalDataStatus = 'none' | 'refreshed' | 'conflict';
     export interface PersistenceValue {
       saveError: SaveFailureReason | null;
       external: ExternalDataStatus;
       retryPersist: () => void;        // re-attempt saveData(current state)
       acceptExternal: () => void;      // replace local state with loadData() (UI confirms first)
       keepLocal: () => void;           // write current state NOW, overwriting the external version
       dismissExternalNotice: () => void; // 'refreshed' -> 'none'
     }
     ```
  7. **Clean vs dirty** — new tiny pure module `src/utils/dirtyRegistry.ts` (no React, no storage):
     ```ts
     export function setDirtyFlag(key: object, dirty: boolean): void;
     export function clearDirtyFlag(key: object): void;
     export function anyDirty(): boolean;
     ```
     (backing `Map<object, boolean>`). The UI package wires `useSaveStatus` to register form dirtiness here. An external change is a CONFLICT iff `anyDirty() || saveError !== null` (a failed local write means in-memory state already diverges from storage); otherwise the tab is clean and refreshes in place.
  8. **Safe refresh = in-place dispatch, not page reload** — new action `{ type: 'REPLACE_FROM_STORAGE'; data: AppData }` whose reducer case is `return action.data;` (no activity row — not a user mutation; mirrors `RESET_ALL` :1913). Page reload would drop route/scroll/open menus for a background event; the store already supports wholesale replacement and `TaskModal` handles a vanished task via its existing `notFound` path.
  9. **No write-back ping-pong** — two mechanisms, both required: (a) `skipPersistRef` initialized to `true` (the very first persist of freshly-loaded state is a pointless echo that would bump the revision and spam other tabs) and set to `true` immediately before any `REPLACE_FROM_STORAGE` dispatch, consumed (reset to false) by the persist effect; (b) the listener short-circuits silently (no dispatch, no banner state change) when `JSON.stringify(loadData-result)` equals `JSON.stringify(current state)` — reads state via a `stateRef` kept in sync each render, comparison is rare (only on external events) so the stringify cost is fine.
  10. **Conflict lifecycle** — while `external === 'conflict'`, further external events keep it `'conflict'`. Reducer flow is never blocked (house rule): if the user dispatches anyway while the conflict banner is up, the persist effect writes (rev = max-merged + 1) and on success clears `external` conflict → `'none'` (continuing to work in this tab is an implicit keep-mine; the banner made it explicit and one click away — accepted prototype limitation, documented by the browser-docs package). `keepLocal()` = write current state immediately (so the user's choice takes effect even with no further dispatch). `acceptExternal()` = `skipPersistRef.current = true; dispatch REPLACE_FROM_STORAGE with loadData(); external -> 'none'`.

## Scope

### In scope

1. `src/store/storage.ts`:
   - `saveData(data: AppData): SaveResult` per decisions 1–3 (stringify try → `'serialization'`, early-return without touching latestKnownRevision; setItem try → `classifyStorageError`; success records + returns the new revision). Delete the "Non-fatal for an alpha" swallow.
   - `classifyStorageError`, `readEnvelopeRevision`, `getLatestKnownRevision`, `subscribeExternalChanges`, `ExternalChangeInfo`, `SaveFailureReason`, `SaveResult` — all exported, doc comments in the file's existing style (note explicitly: same-browser tab protocol, not multi-user sync).
   - `loadData`: record + strip the envelope revision in both branches (decision 3). Behavior otherwise byte-identical (all migration/normalization passes untouched).
   - `clearData`: also reset `latestKnownRevision = 0`.
2. `src/utils/dirtyRegistry.ts` (new) per decision 7, with a header comment explaining its role (form-level dirtiness registry consulted at storage-event time).
3. `src/store/AppStore.tsx`:
   - Action union: add `REPLACE_FROM_STORAGE` (+ reducer case returning `action.data`).
   - Provider: persist effect consumes `skipPersistRef`, calls `saveData(state)`, sets `saveError` from the result (functional set; identical value → no extra render), and on success collapses `external === 'conflict'` → `'none'` (decision 10).
   - Mount-once effect subscribing via `subscribeExternalChanges`; handler per decisions 7–10 (equality short-circuit → silent; conflict predicate `anyDirty() || saveErrorRef.current !== null || externalRef.current === 'conflict'`; else skip-flag + `REPLACE_FROM_STORAGE` + `external = 'refreshed'`). Use refs (`stateRef`, `saveErrorRef`, `externalRef`) synced each render to avoid stale closures; unsubscribe on unmount.
   - `PersistenceContext` + exported `usePersistence()` (throws outside provider, mirroring `useStore`) + the four callbacks (decision 6/10), value memoized so it changes only when `saveError`/`external` change (callbacks stable via refs/useCallback).
4. Doc comment on the provider persist effect updated (it currently says nothing about outcomes).

### Out of scope (do NOT touch)

- ANY UI file: `src/components/`, `src/pages/`, `src/App.tsx`, `src/utils/useSaveStatus.ts`, `styles.css` — all PKG-20260713c-persist-ui. This package compiles standalone because nothing consumes `usePersistence` yet.
- `src/utils/uiPrefs.ts` — deliberately out of scope (device-local chrome, best-effort by design; its key is filtered out by the listener automatically since only `STORAGE_KEY`/`null` pass).
- `src/types.ts` — NO revision field on AppData (decision 3).
- All migrations/normalizations in storage.ts (`migrateV1`, `localizeLegacyData`, `migrateV4toV5`, `ensureStartMinutes`, `normalizeDates`, `normalizeTaskMeta`, `normalizeStatusFlags`, `sanitizeImpersonator`), `DATA_VERSION`, `emptyData`, `buildDefaultStatuses`, seed, ErrorBoundary.
- Existing tests: do not modify any test file (additions are PKG-20260713c-persist-tests). If an existing test breaks, STOP and re-check — the architect verified no current test asserts `saveData`'s return type or stored-payload shape beyond fields that remain present.
- No toasts, no new deps, no activity-log rows for persistence events, no `window.confirm` here (confirm lives in the UI banner).

## Implementation notes

- `JSON.stringify({ ...data, revision })` — spread order puts `revision` last; fine. Do NOT mutate the caller's `data`.
- The node test env has no `localStorage`/`window`: `saveData` under a missing global must not crash the module — the existing try/catch pattern already covers `localStorage` access; `subscribeExternalChanges` may assume `window` exists (it is only called from the provider in a browser; do not add SSR guards beyond what exists).
- React 18 StrictMode double-invokes effects in dev: the skip-flag is consumed by the first persist-effect run; the second run writes once (harmless echo — other tabs' listeners hit the equality short-circuit and stay silent). Verify this reasoning holds in your implementation; do not add StrictMode-specific hacks.
- `setSaveError`/`setExternal` with unchanged values must not loop: rely on React's `Object.is` bail-out; never dispatch from the persist effect.
- Keep `registerPersonOrder` and the `value` memo exactly as they are.

## Acceptance criteria

- [ ] `saveData` returns `{ ok: true, revision }` with a strictly monotonically increasing revision across successful writes; a failed write returns `{ ok: false, reason }` and does NOT advance `latestKnownRevision`.
- [ ] Stringify failure → `'serialization'` without touching localStorage; quota-shaped errors (all four name/code variants) → `'quota'`; `SecurityError` → `'unavailable'`; anything else → `'unknown'`.
- [ ] The stored raw JSON contains `"revision"`; `loadData()`'s returned object has NO `revision` own-property; after loading a payload with `revision: 41`, the next successful save writes `42`.
- [ ] `subscribeExternalChanges` ignores foreign keys (e.g. `n2hub.ui.v1`), handles `key === null`, max-merges before calling back, and its unsubscribe removes the listener.
- [ ] Provider: a failed persist exposes `saveError` via `usePersistence()`; a subsequent successful persist (or `retryPersist`) clears it. An external event with identical data changes nothing. External + clean → state replaced in place, `external === 'refreshed'`. External + (`anyDirty()` or `saveError`) → `external === 'conflict'`, local state untouched. `acceptExternal`/`keepLocal`/`dismissExternalNotice` behave per decision 10, and no REPLACE_FROM_STORAGE dispatch triggers a write-back.
- [ ] `node ./node_modules/typescript/bin/tsc --noEmit` → 0 errors; `npm test` → all existing tests green, zero test files changed.

## Tests

- Command: `node ./node_modules/typescript/bin/tsc --noEmit` then `npm test`.
- Expected: 0 tsc errors; 11 files / 391 tests green (re-verify this baseline fresh BEFORE your first change and report if it differs). New unit coverage is PKG-20260713c-persist-tests — the exported names/signatures above are FROZEN for that package and for persist-ui.

## Report back

Synthesized summary only: files changed one-line each; the exact exported signatures shipped; the provider's conflict/refresh decision flow as implemented; tsc/test results; deviations (should be none); anything the UI/tests packages must know.
