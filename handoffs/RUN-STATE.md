# Run state — 20260716-094327-207 localStorage export + migration dry run

## Goal

Admin-only, read-only tool: sanitized localStorage JSON backup download plus a
Supabase migration dry-run report (counts, ID/role mappings, unsupported
fields, blockers). No writes to Supabase or localStorage. Polish UI.

## Packages

- `handoffs/scheduler-reviews/207-architect-package.md`
  (PKG-20260716-export-dry-run) — Tier: developer, Risk: medium,
  Codex: conditional. Status: ready.

## Changed boundaries (planned)

- `src/store/storage.ts`: additive `peekDataResult()` — side-effect-free read
  (no `latestKnownRevision` mutation, no writes); load/save/revision behavior
  unchanged, data version stays 7.
- New pure module `src/store/exportDryRun.ts` (+ `exportDryRun.test.ts`), new
  `src/components/ExportDryRunPanel.tsx`, section appended to the admin branch
  of `src/pages/AdminPage.tsx` (existing gating reused; no new route).
- No `src/supabase/*` imports in new files; no reducer actions; no import path.

## Verification

- Worker: `npx vitest run src/store/exportDryRun.test.ts
  src/store/storage.test.ts`, then `npm run build`.
- Browser: none — isolated read-only panel, no calendar/persistence
  interaction changed.
- Scheduler owns final `npm run test:scheduler && npm test && npm run build`.

## Open questions

None — role mapping (pm→manager, handlowiec/pracownik→worker), sanitization
scope and UI placement decided in the package. Note for the final reviewer:
`openwiki/n2hub/state-and-persistence.md` may need one line for the new
`peekDataResult` read export after a green run.

## Developer result

Implemented as scoped. storage.ts: extracted `readData(recordRevision)` helper;
`loadDataResult` behavior byte-identical, added `peekDataResult`/`PeekDataResult`.
New exportDryRun.ts + test, ExportDryRunPanel.tsx, wired into AdminPage.
Focused: `vitest exportDryRun+storage` 151 pass/0 fail. Full `vitest` 787 pass/0
fail. `npm run build` green (tsc strict + vite). No deviations. Wiki unchanged
(boundary note still accurate; peek is additive). Reviewer may add the peek line.
