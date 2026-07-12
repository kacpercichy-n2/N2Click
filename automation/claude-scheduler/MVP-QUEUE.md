# Release-hardening prompt queue

Start: `16:00`. Interval: `5h 1m`.

The scheduler uses daily slots:

```text
16:00, 21:01, 02:02, 07:03, 12:04
```

New MVP prompts start at `010.md` because local scheduler state already marks
the historical `001.md` as completed.

| Prompt | Area | Scope |
| --- | --- | --- |
| `010.md` | Moja praca | `/my-work`, employee start route, today/unplanned/alerts |
| `011.md` | Task planning status | explicit planning status selector and badges |
| `012.md` | Task metadata | priority, work category, task checklist |
| `013.md` | Date safety | shared validation, corrupt-data recovery, root error boundary |
| `014.md` | Workload integrity | preserve multi-block task schedules on save |
| `015.md` | Status semantics | stable completion meaning and safe status archive behavior |
| `016.md` | Bin recovery | real split and partial scheduling for oversized bin work |
| `017.md` | Scheduling invariants | 92-day/date containment rules and collision-safe placement |
| `018.md` | Honest persistence | write failures and same-browser cross-tab conflict handling |
| `019.md` | Command/audit hardening | reducer validation, navigation dirty guards, impersonation attribution |
| `020.md` | Availability correctness | zero/non-working availability and person-specific timeline conflicts |
| `021.md` | Release verification | browser coverage, accessibility checks, authoritative documentation |
| `022.md` | Backend migration plan | provider-neutral production architecture and safe adapter groundwork |

The former feature-expansion queue (actual time, documents, client card, sales,
absences, PM dashboard, monitor timeline, mini profile, templates/reports) is
deferred until the release blockers above are closed and re-reviewed.
