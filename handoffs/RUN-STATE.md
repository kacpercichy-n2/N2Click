# Run 20260718-072307-219-import-batching-and-mapper-unification

Goal: (1) hybrid batch inserts with per-row fallback in `src/supabase/dataImport.ts`,
(2) shared domain→column row-mapper module consumed by both `cloudMirror.ts` and
`dataImport.ts`, (3) action-origin metadata replacing the `SUPPRESSED` denylist in
`CloudSyncProvider.tsx`. Fallback rule: 1+2 must land complete before 3 starts;
3 is all-or-nothing.

## Packages

- PKG-20260718-import-batching-and-shared-row-mappers — developer, medium risk,
  ready. Scratchpad: `PKG-import-batching-and-shared-row-mappers.md`.
- PKG-20260718-action-origin-metadata — developer, medium risk, ready; ordered
  after PKG-1 (fallback rule only, no code dependency). Scratchpad:
  `PKG-action-origin-metadata.md`.

## Changed boundaries (planned)

- `src/supabase/dataImport.ts` (+`insertMany` on `ImportDb`), `cloudMirror.ts`,
  new `src/supabase/rowMappers.ts`, new `src/supabase/mirrorGate.ts`,
  `CloudSyncProvider.tsx`, `AppStore.tsx` dispatch wrapper + `lastActionRef`
  typing, `SampleBanner.tsx`.

## Key findings

- Impersonator dictionary-miss policy already aligned (both null):
  `cloudMirror.ts:378-384` ↔ `dataImport.ts:780-782`. All other miss policies
  intentionally diverge (mirror drop+diagnostic vs import null) and stay as-is.
- `RESET_ALL` has no live dispatch site; migration is helper-test-only.

## Verification

Workers: focused `npx vitest run src/supabase` (+ `src/store` for PKG-2) and
`npm run build`. Scheduler owns full `npm run test:scheduler && npm test &&
npm run build`.

## Open questions

None blocking; both packages ready.

## Developer log — PKG-1 (import batching + shared row mappers)

Done: new `rowMappers.ts` (7 families); `cloudMirror.ts` + `dataImport.ts`
consume it; `insertMany` added to `ImportDb`; runner batches every collection
(chunk 100) with per-row fallback + flush-on-dependency for dictionaries/depts.
Focused: `src/supabase/dataImport.test.ts src/supabase/cloudMirror.test.ts`
66 pass; `src/supabase` 212 pass; `npm run build` pass. No scope expansion.

PKG-2 action-origin: replaced mirror's `SUPPRESSED` denylist with `origin`
metadata on the action. New `src/supabase/mirrorGate.ts` (`shouldMirrorTransition`)
+ test. `ActionOrigin`/widened `Dispatch` in AppStore; tagged the 4 cloud
transitions. Focused: `src/supabase`+`src/store` 820 pass; `npm run build` pass.
RESET_ALL has no live dispatch — reducer untouched.
