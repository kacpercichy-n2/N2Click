# MVP prompt queue

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
| `013.md` | Task execution | actual time, blockers, estimate change requests |
| `014.md` | Project card core | PM, sales owner, team, project budget, formal status |
| `015.md` | Documents and formal readiness | documents, document categories, requirements, planning block, override activity |
| `016.md` | Client card | `/clients/:id`, client fields, contacts, notes/link sections |
| `017.md` | Sales process and permissions | sales pipeline, handoff to PM, salesperson permission split |
| `018.md` | Availability | absences, availability math, workload/calendar/timeline impact |
| `019.md` | PM dashboard | operational PM dashboard with overdue/unplanned/blocked/missing-doc alerts |
| `020.md` | Team monitor timeline | read-only daily team timeline, current-time line, kiosk mode |
| `021.md` | Mini profile | person hover card with role, department, contact, today availability |
| `022.md` | Later MVP foundations | project templates, find free slot, reports groundwork |
