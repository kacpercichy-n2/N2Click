# Run state — 20260721-150911-243 companies scoping and visibility

## Goal

Company (Spółka) concept: `companies` dictionary (local + `public.companies`),
admin-assigned `Person.companyId` / `profiles.company_id`, and a strictly
NARROWING company condition woven into the `projects_select` RLS policy.
Security-sensitive; high risk.

## Packages

- `handoffs/packages/companies-scoping.md` — PKG-20260721-companies-scoping,
  tier: developer, status: ready. Single package (implementation, RLS SQL and
  tests are inseparable). Codex review required.

## Changed boundaries (planned)

- New migration `supabase/migrations/20260721160000_companies.sql`: companies
  table + policies, `profiles.company_id`, `app.current_company_id()`,
  `app.project_in_company_scope()`, extended `protect_profile_privileges`
  trigger (company_id admin-only), replaced `projects_select`
  (baseline: 20260720190000), realtime publication.
- Local model additive (DATA_VERSION stays 7): `AppData.companies`,
  ADD/RENAME/DELETE_COMPANY, MERGE_CLOUD_DICTIONARIES/PEOPLE extensions,
  storage repair, persistGate key, referenceData/cloudMirror wiring, App.tsx
  dictionary dispatch, AdminPage „Spółki”, PersonProfilePage „Spółka”
  (admin-only via profileEditPolicy).

## Key settled decisions

- Company is a FILTER AND-ed onto today's non-admin conditions; true when the
  user has no company — provably non-widening, company-less users keep
  identical visibility. Project-in-company = any project member/task assignee
  with that company; projects with no company-carrying people stay visible to
  all (a manager's fresh empty project must not vanish on hydration).
- Unified-filters (240) company criterion deferred — separate additive feature.
- `tasks_select` untouched (client hydration cascade hides dependents);
  raw-API limitation accepted and documented in the package.

## Verification

Focused vitest set named in the package, then full `npm test` (933+) and
`npm run build`. Migration is not applied to the hosted project by this run.

## Open questions

None blocking.

## Developer result (implementation)

Implemented per package: new migration, local model (types/AppStore/storage/
seed/persistGate), cloud wiring (referenceData/cloudMirror/App), UI (AdminPage
„Spółki”, PersonProfilePage „Spółka” admin-only), new `companies.test.ts` +
fixture/extension updates, three wiki pages. Focused vitest 337 passed; full
`npm test` 1190 passed; `npm run build` green; `tsc --noEmit` clean. No
deviations. Migration NOT applied to hosted Supabase.
