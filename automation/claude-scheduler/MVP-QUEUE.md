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
| `archive/completed/016.md` | Done | Bin recovery | partial scheduling from oversized bin work without weakening drag/drop |
| `archive/completed/017.md` | Done | Scheduling invariants | audit remaining placement gaps without redoing date guards |
| `archive/completed/018.md` | Done | Honest persistence | write failures and same-browser cross-tab conflict handling |
| `019a.md` | Active | Command validation | reducer validation for persistent command payloads |
| `019b.md` | Active | Dirty-navigation safety | protect unsaved task/project edits on browser and route navigation |
| `019c.md` | Active | Local audit attribution | impersonation-aware activity and sensitive local events |
| `020.md` | Active | Availability correctness | zero/non-working availability and person-specific timeline conflicts |
| `021a.md` | Active | Release runner | deterministic existing browser matrix command |
| `021b.md` | Active | Regression coverage | missing browser and accessibility assertions only |
| `021c.md` | Active | Documentation | synchronize authoritative release docs after green checks |
| `022.md` | Active | Backend migration plan | provider-neutral decision documents; no preparatory code |

The former feature-expansion queue (actual time, documents, client card, sales,
absences, PM dashboard, monitor timeline, mini profile, templates/reports) is
deferred until the release blockers above are closed and re-reviewed.

## Prompt sizing rule

Keep the tier workflow, but one prompt must cover one cohesive technical slice.
If a request independently changes runtime behavior, browser infrastructure and
documentation, create one ordered prompt for each slice. A later prompt may rely
on a green, committed predecessor; it must not silently fold in the other slices.
