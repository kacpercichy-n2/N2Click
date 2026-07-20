# Handoff: Wire Supabase Realtime into the cloud-authoritative merge path

- Package ID: PKG-20260720-realtime-live-sync
- Status: ready
- Tier: developer
- Depends on: none
- Risk: high (persistence/sync boundary, hydration/merge integrity)
- Codex review: required

## Goal

DB changes propagate live to open clients: a Supabase Realtime channel on the
planner + dictionary tables triggers a debounced, coalesced re-hydration through
the existing `MERGE_CLOUD_ENTITIES` path, the stale-data banner is hidden while
the channel is live, and manual refresh remains the fallback when the channel is
not live. Local edits already write through via the existing mirror; realtime
echoes must not double-apply or thrash.

## Wiki context

- `openwiki/n2hub/cloud-database.md`
- `openwiki/n2hub/state-and-persistence.md`

## Expected touchpoints

- `new: src/supabase/realtimeSync.ts` — pure, node-testable decisions (pattern:
  `opQueue.ts` / `mirrorGate.ts` / `hydrationOutcome.ts`)
- `new: src/supabase/realtimeSync.test.ts`
- `src/supabase/CloudSyncProvider.tsx` — channel lifecycle wiring, quiet
  background hydration, `live` on `CloudSyncValue` (current refs: hydration
  `runHydration` L214-290, mirror effect L360-403, `refresh` L414-417)
- `src/components/CloudSyncBanner.tsx` — gate ONLY the stale-hint block
  (L93-107) on `live`
- `src/supabase/OrgDataProvider.tsx` — no structural change expected; its
  `reload()` is consumed for dictionary-table events
- `new: supabase/migrations/20260720120000_realtime_publication.sql`
- Tests possibly extended: `src/store/cloudMerge.test.ts` (idempotent re-merge)

## Invariants

- Invariant 6: an invalid cloud payload leaves the state reference unchanged;
  a realtime-triggered merge goes through `planHydrationOutcome` exactly like
  manual hydration (fail-closed, explicit error).
- `MERGE_CLOUD_ENTITIES` dispatches keep `origin: 'cloud'` so the mirror never
  re-propagates a realtime merge (`mirrorGate.shouldMirrorTransition`).
- Hydration must never overwrite unsent local edits: the existing
  drain/restart loop in `runHydration` (queue drain before merge, restart on
  state change) is the only snapshot-merge path — do not add a second one.
- Local mode: zero Supabase code paths; no channel is ever created. No import
  of `@supabase/supabase-js` outside `src/supabase/`.
- A failed save never reports `Zapisano`; error/dropped/notice/hydrating banner
  variants are unchanged.
- Retirement gate behavior (`persistGate`, `setCloudMirrorHealthy`) unchanged.
- All new user-facing strings in Polish (expected: none needed).

## Scope

1. **Pure module `src/supabase/realtimeSync.ts`:**
   - `PLANNER_REALTIME_TABLES = ['clients','projects','milestones','tasks','task_assignments','workload_entries','comments','activity_events']`
     and `DICTIONARY_REALTIME_TABLES = ['profiles','departments','statuses','service_types','work_categories']`.
   - Channel-status mapping: `SUBSCRIBED` → live; `CHANNEL_ERROR` /
     `TIMED_OUT` / `CLOSED` (and teardown) → not live.
   - Pure refresh scheduler (debounce/coalesce state machine): trailing
     `REALTIME_DEBOUNCE_MS = 1000`, cap `REALTIME_MAX_WAIT_MS = 5000` so a
     continuous event storm still converges; while own mirror ops are pending
     or draining, or a hydration is in flight, the refresh is deferred and
     re-armed once the queue drains. All decisions must be pure functions
     testable without React/timers-in-provider.
   - Stale-banner gating predicate, e.g.
     `showStaleHint({status, pendingCount, live})` → true only for
     `status === 'ready' && pendingCount === 0 && !live`.
2. **Wiring in `CloudSyncProvider.tsx`:**
   - Create ONE channel via `getSupabaseClient().channel(...)` with
     `postgres_changes` (`event: '*'`, `schema: 'public'`) listeners for all 13
     tables when `active && hydratedUserRef.current === userId`; remove the
     channel (`supabase.removeChannel`/`channel.unsubscribe`) on deactivation,
     user switch and provider unmount. Subscribe errors must not crash — catch,
     set live=false, existing banner/manual refresh keep working.
   - Planner-table event → schedule background refresh (scheduler above).
     Dictionary-table event → `org.reload()`; additionally, when the org
     snapshot reference changes while `active`, hydrated and status `'ready'`,
     run ONE background re-hydration so fresh id maps are picked up.
   - Background refresh = quiet mode of the existing `runHydration` (add an
     options/flag parameter): when current status is `'ready'`, skip
     `setStatus('hydrating')` so remote edits do not flash the loading banner;
     failures behave exactly as today (`status 'error'` + retry banner, live
     stays as reported by the channel). Add a reentrancy guard so background
     refresh, manual `refresh()` and initial hydration never overlap (this also
     closes the pre-existing gap where `refresh()` can run during 'hydrating').
   - On channel transition back to `SUBSCRIBED` after a non-live gap, schedule
     one background refresh (catch-up for missed events).
   - Expose `live: boolean` on `CloudSyncValue`.
3. **Banner:** in `CloudSyncBanner.tsx`, replace the stale-hint condition with
   the pure predicate; when `live`, render nothing there. All other variants
   (notice, hydration error, transient error, dropped, hydrating) unchanged.
   Manual refresh stays reachable whenever the channel is not live.
4. **Migration `supabase/migrations/20260720120000_realtime_publication.sql`:**
   idempotent `DO` block adding the 13 tables to the `supabase_realtime`
   publication (skip tables already in `pg_publication_tables`; create the
   publication if the project lacks it). The developer cannot apply this from
   here: the final report MUST document the exact operator steps (run the
   migration, or dashboard SQL editor
   `alter publication supabase_realtime add table public.<t>...`, or
   Dashboard → Database → Publications). Client behavior when the publication
   is missing must degrade gracefully: no crash; if the channel errors,
   live=false and the stale banner + manual refresh return.
5. **Tests (vitest, mocked channel/client — no live backend):**
   - subscription wiring: channel created once with the 13 table listeners,
     torn down on deactivation/unmount; subscribe failure → live=false, no
     throw;
   - scheduler: debounce coalesces a burst to one refresh; max-wait fires under
     a continuous storm; refresh deferred while pending ops > 0 and re-armed
     after drain;
   - echo safety: merging a payload identical to current state does not
     re-enqueue mirror ops (origin 'cloud' suppression) and a repeated merge is
     idempotent (no duplicate rows, bin-pair identity preserved);
   - invariant 6: an invalid realtime-triggered payload (e.g. off-grid
     workload row) yields `HYDRATION_MERGE_REJECTED` and the prior state
     reference;
   - banner gating: predicate truth table for status/pendingCount/live;
     live-status mapping for SUBSCRIBED/CHANNEL_ERROR/TIMED_OUT/CLOSED.

## Out of scope

- Retirement mode: do not enable it or change `persistGate` semantics.
- Row-level patching of realtime payloads into state (settled: re-fetch+merge).
- Broadcast/presence channels, service-role keys, any backend outside
  `src/supabase/`.
- Redesigning the banner beyond gating the stale-hint block.
- Applying the publication migration to the live project (document steps only).
- Changing `MERGE_CLOUD_ENTITIES` reducer semantics.

## Acceptance

- [ ] With a mocked channel reporting `SUBSCRIBED`, a planner-table event leads
      (after debounce) to exactly one snapshot load merged via
      `MERGE_CLOUD_ENTITIES` with `origin: 'cloud'`, without status flashing
      'hydrating'.
- [ ] A burst of N events within the debounce window produces one refresh; a
      continuous storm produces a refresh at least every `REALTIME_MAX_WAIT_MS`.
- [ ] Events arriving while own ops are queued/draining trigger no fetch until
      the queue drains, then one refresh.
- [ ] Invalid realtime payload: state reference unchanged, explicit Polish
      error surfaced (existing `HYDRATION_MERGE_REJECTED` path).
- [ ] `live === true` hides only the stale-hint banner; on channel
      error/close/teardown the stale-hint + "Odśwież dane z serwera" returns
      and works.
- [ ] Re-subscribe after a gap triggers one catch-up refresh.
- [ ] Local mode and signed-out: no channel created, zero behavior change.
- [ ] New migration file exists and is idempotent; run report documents the
      operator dashboard/SQL steps.
- [ ] Focused suites and build green.

## Verification

- Worker: `npx vitest run src/supabase src/store` and `npm run build`
- Browser: none — realtime needs a live Supabase backend; wiring is covered by
  mocked-channel unit tests and release verification owns the browser matrix.
- Scheduler owns final `npm run test:scheduler && npm test && npm run build`.

## Prior decisions

- Manual-refresh reliability (task step 1) is CONFIRMED in code — do not
  re-fix: StrictMode `mountedRef` reset (`CloudSyncProvider.tsx:126-132`),
  cascade orphan filtering (`plannerData.ts:291-296` + exclusion sets),
  merge-result-aware status (`hydrationOutcome.ts` consumed at
  `CloudSyncProvider.tsx:280-285`), durable drained queue (`opQueue.ts` +
  `persistQueue`). Only the `refresh()`-during-'hydrating' reentrancy gap is
  in scope (closed by the guard above).
- Event→state mapping: debounced re-fetch of the full snapshot through the
  existing `loadPlannerSnapshot` → `planHydrationOutcome` →
  `MERGE_CLOUD_ENTITIES` path. NOT row-level patching: the merge path already
  owns validation, invariant 6, cascade filtering and id-map translation;
  patching would duplicate `rowMappers`/validation logic for marginal gain.
- Echo suppression: `postgres_changes` cannot identify the originating client,
  so no per-event filtering. Mechanism = (a) defer refresh while own ops are
  pending/draining, (b) debounce coalescing, (c) idempotent same-content merge
  with `origin: 'cloud'` suppressing re-mirroring. No suppression-by-timestamp
  windows (they can drop genuine concurrent edits).
- Subscription lifecycle lives in `CloudSyncProvider.tsx` (thin adapter) with
  ALL decisions pure in `realtimeSync.ts` — same split as opQueue/mirrorGate.
- Banner gating condition: hide stale hint iff channel status is `SUBSCRIBED`
  (`live`); any error/close makes it return. Manual refresh is the fallback,
  not removed.
- Dictionary events go through `org.reload()` + one background re-hydration on
  snapshot change (id maps are derived from the org snapshot; planner families
  like people/statuses are intentionally NOT merged by `MERGE_CLOUD_ENTITIES`).
- Publication enablement ships as an idempotent migration file plus documented
  operator steps; client degrades gracefully if never applied.
