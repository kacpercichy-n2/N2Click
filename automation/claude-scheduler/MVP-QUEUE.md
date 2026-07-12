# Release-hardening prompt queue

Start: `16:00`. Interval: `5h 1m`.

The scheduler uses daily slots:

```text
16:00, 21:01, 02:02, 07:03, 12:04
```

Prompty `001.md` oraz `010.md`–`015.md` sa wykonane i znajduja sie w
`archive/completed/`. Scheduler czyta tylko pozostale aktywne pliki z `prompts/`;
nie polega wylacznie na lokalnym, ignorowanym przez Git stanie `completed.json`.

| Prompt | Status | Area | Scope |
| --- | --- | --- | --- |
| `archive/completed/010.md` | Done | Moja praca | `/my-work`, employee start route, today/unplanned/alerts |
| `archive/completed/011.md` | Done | Task planning status | explicit planning status selector and badges |
| `archive/completed/012.md` | Done | Task metadata | priority, work category, task checklist |
| `archive/completed/013.md` | Done | Date safety | shared validation, corrupt-data recovery, root error boundary |
| `archive/completed/014.md` | Done | Workload integrity | preserve multi-block task schedules on save |
| `archive/completed/015.md` | Done | Status semantics | stable completion meaning and safe status archive behavior |
| `016.md` | Active | Bin recovery | partial scheduling from oversized bin work without weakening drag/drop |
| `017.md` | Active | Scheduling invariants | audit remaining placement gaps without redoing date guards |
| `018.md` | Active | Honest persistence | write failures and same-browser cross-tab conflict handling |
| `019.md` | Active | Command/audit hardening | reducer validation, navigation dirty guards, impersonation attribution |
| `020.md` | Active | Availability correctness | zero/non-working availability and person-specific timeline conflicts |
| `021.md` | Active | Release verification | browser coverage, accessibility checks, authoritative documentation |
| `022.md` | Active | Backend migration plan | provider-neutral production architecture and safe adapter groundwork |

The former feature-expansion queue (actual time, documents, client card, sales,
absences, PM dashboard, monitor timeline, mini profile, templates/reports) is
deferred until the release blockers above are closed and re-reviewed.
