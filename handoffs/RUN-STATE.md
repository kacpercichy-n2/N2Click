# Run state — 20260721-124104-239 task card hours and publish

## Goal

Drafts (`Task.isDraft`) accept per-person sold hours in TaskModal, persisted in
a new additive `Task.draftHours` field (mirrored as `tasks.draft_hours` jsonb),
materialized into bin `WorkloadEntry` rows on publish (one row per
`(taskId, personId)`, invariant 4). TaskModal also gains a per-person
availability panel (`rangeAvailabilityForPerson`) and split draft actions:
"Zapisz szkic" / "Opublikuj" (existing draft → PUBLISH_TASK) and
"Utwórz szkic" / "Utwórz i opublikuj" (new draft → non-draft SAVE_TASK).

## Packages

- `handoffs/scheduler-reviews/239-architect-package.md`
  (PKG-20260721-task-card-hours-publish) — Tier: developer, Risk: high,
  Codex: required. Status: ready.

## Changed boundaries (planned)

- `Task.draftHours?` additive; key present only on drafts with hours (canonical
  form keeps `sameRowValue` merges reference-preserving); deleted at publish.
- `saveTask` draft branch persists it from `binTotals`; publish helpers
  materialize bin rows and strip the field; `normalizeTaskMeta` repair.
- New migration `20260721130000_task_draft_hours.sql`; `taskRow` +
  `loadPlannerSnapshot` map `[{profile_id, hours}]` via people maps.
- TaskModal: sold-hours unhidden for drafts (bin/grid stay hidden),
  availability rows, split sticky actions gated by `tasks.manage`.

## Verification

- Focused: draftTasks, storage, saveTaskWorkload, cloudMerge, cloudMirror,
  plannerData, migrations suites (exact command in the package).
- Browser: none — no scenario covers the draft modal; release matrix owns it.
- Scheduler owns final `npm test && npm run build` (933 baseline stale, ~1086).

## Open questions

- None blocking. Wiki likely stale after green: state-and-persistence "SZKICE
  ZADAŃ" (drafts now carry hours) + cloud-database (`tasks.draft_hours`) —
  final reviewer owns the verdict.

## Developer result (2026-07-21)

Implemented as specified across types/AppStore/storage/cloud/TaskModal +
migration; `dataImport.ts` also carries `draft_hours`. Focused suite green;
full `npm test` 1116/1116 pass, `npm run build` clean. No scope expansion; no
Codex needed. Next: scheduler re-runs the gate + reviewer/Codex pass.
