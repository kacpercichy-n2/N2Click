# Run 20260720-092445-221-realtime-live-data-sync

Goal: live bidirectional sync in supabase mode — Supabase Realtime
(`postgres_changes`) on the 8 planner + 5 dictionary tables triggers a
debounced re-hydration through the existing `MERGE_CLOUD_ENTITIES` path; the
stale-data banner is hidden while the channel is SUBSCRIBED, manual refresh
stays as fallback; publication enablement ships as an idempotent migration +
documented operator steps.

## Packages

- PKG-20260720-realtime-live-sync — developer, high risk, ready, Codex review
  required. `handoffs/packages/PKG-20260720-realtime-live-sync.md`.

## Changed boundaries (planned)

- new `src/supabase/realtimeSync.ts` (+test): pure table lists, live-status
  mapping, debounce/coalesce refresh scheduler, stale-banner predicate.
- `src/supabase/CloudSyncProvider.tsx`: channel lifecycle, quiet background
  hydration mode + reentrancy guard, `live` on `CloudSyncValue`.
- `src/components/CloudSyncBanner.tsx`: stale-hint block gated on `live` only.
- new `supabase/migrations/20260720120000_realtime_publication.sql`.

## Key findings

- Prompt-220 refresh fixes confirmed present: mountedRef reset
  (CloudSyncProvider:126-132), cascade orphan filtering (plannerData:291-296),
  merge-result-aware status (hydrationOutcome.ts), durable drained queue
  (opQueue + persistQueue). No pre-fix package needed.
- One residual gap folded into the package: `refresh()` is not guarded against
  running during 'hydrating' — closed by the new reentrancy guard.
- Echo suppression: postgres_changes has no origin id — settled on
  defer-while-pending + debounce + idempotent origin:'cloud' merge.

## Verification

Worker: `npx vitest run src/supabase src/store` + `npm run build`. Browser:
none (mocked channel; realtime needs live backend). Scheduler owns final
`npm run test:scheduler && npm test && npm run build`.

## Open questions

None blocking. Operator must apply the realtime publication migration (steps
documented in the developer's run report); until then the client degrades to
today's banner + manual refresh.

## Developer result (PKG-20260720-realtime-live-sync)

Implemented: pure `realtimeSync.ts` (tables, live-mapping, debounce/coalesce/max-wait
scheduler, `subscribePlannerChannel` adapter, `showStaleHint`) + test; provider channel
lifecycle, quiet background hydration + reentrancy guard + catch-up + dict→org.reload,
`live` on value; banner gated; idempotent publication migration + migrations.test list;
cloudMerge echo-idempotence tests. Focused `vitest run src/supabase src/store` 847 pass.
`npm test` 1033 pass / 0 fail. `npm run build` clean. Operator must apply the publication
migration (report has steps); degrades to banner+manual refresh until then.

## Reviewer fixes (changes-required round)

Context expansion APPROVED: `src/supabase/OrgDataProvider.tsx` (B2).
- B1 race: mirror effect now gated by `shouldMirrorProcessQueue({phase,hydrationInFlight})`
  — quiet hydration drains via its own loop; pure predicate tested.
- B2: dictionary events → new non-destructive `org.backgroundReload()`; pure
  `orgReload.ts` keeps old 'ready' snapshot until swap (+test). `active`/channel no
  longer flicker.
- Hardening: channel handlers read via refs; effect deps `[active,userId,setLiveState]`
  so org reload never recreates the channel.
Verify: focused 858 pass, `npm test` 1044 pass/0 fail, build clean.
