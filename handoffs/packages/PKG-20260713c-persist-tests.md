# Handoff: Unit tests — SaveResult classification, revision envelope, dirty registry

- **Package ID:** PKG-20260713c-persist-tests
- **Status:** ready
- **Tier:** test-writer
- **Model:** sonnet
- **Depends on:** PKG-20260713c-persist-core (NOT on persist-ui — may run in parallel with it)
- **Blast radius:** none — test files only. No production file may be touched.

## Goal

Real unit coverage for the new honest-persistence layer: `saveData`'s discriminated result + failure classification (quota incl. Safari variants, unavailable, serialization, unknown), the revision envelope (inject on write, strip + re-anchor on load, monotonicity, no-bump-on-failure), `readEnvelopeRevision`, migration compatibility (v1 and v7 payloads without a revision still load identically), and the dirty registry.

## Context the worker needs

- Relevant files: `src/store/storage.test.ts` (extend — REUSE its `withLocalStorage` stub pattern at :39-62 and its `STORAGE_KEY = 'n2hub.data.v1'` duplication note), new `src/utils/dirtyRegistry.test.ts`.
- Implementation to READ FIRST (assert against real code, never the package paraphrase): `src/store/storage.ts` — `saveData`, `classifyStorageError`, `readEnvelopeRevision`, `getLatestKnownRevision`, `subscribeExternalChanges`, `loadData`, `clearData`; `src/utils/dirtyRegistry.ts`. If the shipped code contradicts this package, STOP and report the mismatch — do not guess.
- Conventions: repo `CLAUDE.md`. Vitest runs in the **node** environment — no `window`, no jsdom, no real `localStorage`; everything goes through stubs on `globalThis`.
- ENVIRONMENT: unattended run. ALL git commands denied — do not attempt, do not commit. Typecheck via `node ./node_modules/typescript/bin/tsc --noEmit`; tests via `npm test`.
- Prior decisions (architect, final):
  - Test seam = stubbing `globalThis.localStorage` (house pattern `withLocalStorage`), extended where needed with a **throwing** `setItem` variant (build error-like objects: `{ name: 'QuotaExceededError' }`, `{ name: 'NS_ERROR_DOM_QUOTA_REACHED' }`, `{ code: 22 }`, `{ code: 1014 }`, `{ name: 'SecurityError' }`, `new Error('x')`) — `classifyStorageError` reads `name`/`code` defensively, so plain objects are the correct node-env fixtures. Do NOT rely on `DOMException`.
  - `subscribeExternalChanges` needs `window` and is therefore covered by the Playwright script (browser-docs package), NOT here. Its pure inputs (`readEnvelopeRevision`) ARE covered here.
  - `latestKnownRevision` is module-level mutable state: it leaks between tests in one file. Anchor it deterministically at the start of each revision-sensitive test (e.g. run `loadData()` under a stub containing a payload with a known revision, or `clearData()` to reset to 0 — read the shipped code to confirm which resets it). Never assume a fresh module.

## Scope

### In scope — `src/store/storage.test.ts`, new describe blocks (~14-19 tests total)

1. **`saveData` result + envelope:**
   - Fresh (reset) state: first `saveData(emptyData())` returns `{ ok: true, revision: 1 }`; the raw string stored under `STORAGE_KEY` parses to an object with `revision: 1`; a second save returns revision 2 (monotonic).
   - Round trip: after `saveData`, `loadData()` returns an object with NO `revision` own-property (`'revision' in result` is false) and otherwise the same data.
   - Re-anchor: `loadData()` of a stubbed payload with `revision: 41` → next successful `saveData` stores `revision: 42` and returns it.
   - Garbage revision in a stored payload (`'abc'`, `-5`, `NaN`, absent) → loads fine, treated as 0, next save writes 1 (loop the variants in ONE test to keep count reasonable).
   - Failed write does not advance the revision: quota-throwing `setItem` → `{ ok: false, reason: 'quota' }`; then a working stub → next save's revision is exactly previous-known + 1 (no gap from the failure).
2. **Failure classification:**
   - Direct `classifyStorageError` unit matrix: the four quota shapes → `'quota'`; `{ name: 'SecurityError' }` → `'unavailable'`; `new Error('boom')` and a string throw → `'unknown'`.
   - Through `saveData`: a `setItem` throwing the quota shape → reason `'quota'`; nothing written (assert the store map unchanged).
   - Serialization: a data object with a circular reference (e.g. `const d = emptyData() as any; d.tasks = [...]; d.clients.push(d)` — build whatever cycle survives the type cast) → `{ ok: false, reason: 'serialization' }` AND `setItem` never called (use a spy/counter in the stub) AND revision not advanced.
3. **`readEnvelopeRevision`:** valid payload → the number; `null` raw → null; non-JSON garbage → null; JSON without `revision` → null; negative / non-integer / non-number revision → null (verify the shipped coercion rules first and assert what the code actually promises).
4. **Migration compatibility (the acceptance-critical regression net):**
   - A `version: 1` payload (reuse/adapt the file's existing v1 fixture if one exists — read the file) without any `revision` loads exactly as before: same migrated shape, no `revision` key on the result.
   - A current `version: 7` payload without `revision` loads unchanged (all normalization passes still applied), and loading is idempotent (`loadData()` twice under the same stub → deep-equal results).
5. **Existing tests:** zero modifications. If any existing test fails after core, STOP and report.

### In scope — `src/utils/dirtyRegistry.test.ts` (new, ~4-5 tests)

- `anyDirty()` false on a clean registry; true after `setDirtyFlag(k, true)`; false again after `setDirtyFlag(k, false)`; `clearDirtyFlag` removes the entry; two independent keys — clearing one leaves the other's dirtiness intact.
- Note: module-level state again — use fresh unique key objects per test and clean up flags you set.

### Out of scope

- Any production `src/` file. Any UI/component behavior (no jsdom — provider/banner/SaveStatus logic is covered by the browser check). `subscribeExternalChanges`/storage events. Playwright scripts, CLAUDE.md, seed, migrations themselves (only their compatibility as listed).

## Implementation notes

- Extend `withLocalStorage` rather than duplicating it: e.g. give it an optional `setItemImpl` override, or add a sibling `withThrowingLocalStorage(err, fn)` — pick whichever produces the smaller diff and keep the restore-previous-global discipline (:55-61).
- Every assertion must trace to real shipped code you have read (this repo's test-writer discipline; see RUN-STATE history for why).
- No `.skip`/`.todo`. Loop matrix variants inside single tests where the package says so, to keep the suite lean.

## Tests

- Command: `node ./node_modules/typescript/bin/tsc --noEmit` then `npm test`.
- Expected: 0 tsc errors. Baseline before you start: 11 files / 391 tests (re-verify fresh; the parallel UI package touches no tests). After: 12 files (dirtyRegistry.test.ts is new) / roughly 409-415 tests, all green, zero regressions in the pre-existing 391.

## Report back

Synthesized summary only: files changed one-line each, new test count per file, any implementation-vs-package mismatches found (there should be none — but report, don't adapt silently, if the frozen API differs), tsc/test results.
