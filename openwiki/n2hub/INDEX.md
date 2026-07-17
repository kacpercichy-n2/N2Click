# N2Hub agent context map

Use this page to route yourself, not as a substitute for the source code. Read
only the linked area pages that the task explicitly names.

| Area | Read first | Primary source files |
| --- | --- | --- |
| App model, reducer, selectors, persistence | [state-and-persistence.md](state-and-persistence.md) | `src/types.ts`, `src/store/AppStore.tsx`, `src/store/selectors.ts`, `src/store/storage.ts` |
| Calendar, bin and workload placement | [scheduling-and-calendar.md](scheduling-and-calendar.md) | `src/components/WeekView.tsx`, `src/pages/WorkloadPage.tsx`, `src/utils/time.ts`, `src/store/AppStore.tsx` |
| Pages, modals, navigation and onboarding | [ui-navigation-and-onboarding.md](ui-navigation-and-onboarding.md) | `src/App.tsx`, `src/pages/`, `src/components/TaskModal.tsx`, `src/onboarding/` |
| Supabase schema, relations, RLS, migrations | [cloud-database.md](cloud-database.md) | `supabase/migrations/`, `src/supabase/`, `src/auth/` |
| Tests and browser checks | [testing-and-automation.md](testing-and-automation.md) | `src/**/*.test.ts`, `scripts/` |

## Reading rule

1. Read `CLAUDE.md` for global rules.
2. Read only the `Wiki context` files declared by the prompt or handoff.
3. Open the listed source touchpoints and their direct dependencies only.
4. If a dependency outside that boundary is genuinely necessary, record why in
   the handoff or final report; do not scan unrelated pages or historic runs.

## Wiki maintenance

At the end of a green run, check whether the declared wiki page is now wrong,
missing a changed boundary, or mentions a deleted behavior. Update only that
page, or explicitly report “wiki unchanged” with a reason.
