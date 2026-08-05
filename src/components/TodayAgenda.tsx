// The "Zadania na dziś" list body, shared by the Panel (dashboard) and the
// "Moja praca" page. Renders a person's timed blocks + dateless assigned tasks
// for one date, plus the empty state. Reads go through selectors; clicks open
// the task modal. Extracted verbatim from DashboardPage — same class names and
// behavior — so both surfaces stay in sync.
import { Link } from 'react-router-dom';
import { shallowEqual, useSelector, useStoreApi } from '../store/AppStore';
import { todayAgendaForPerson } from '../store/selectors';
import { projectDisplayName, taskDisplayTitle } from '../store/confidentiality';
import { StatusBadge } from './StatusBadge';
import { useOpenTask } from './TaskModal';
import { formatShortWithWeekday } from '../utils/dates';
import { formatMinutes } from '../utils/time';
import type { DateStr } from '../types';

export function TodayAgendaList({ personId, date }: { personId: string; date: DateStr }) {
  // Slice subscription: the agenda plus exactly the four collections the rows
  // label themselves from. The per-row lookups below run against these slices
  // and are `.find(...)` — byte-identical to getProject/getClient/getStatus.
  const { agenda, tasks, projects, clients, statuses } = useSelector(
    (s) => ({
      agenda: todayAgendaForPerson(s, personId, date),
      tasks: s.tasks,
      projects: s.projects,
      clients: s.clients,
      statuses: s.statuses,
      // Wejścia maski utajnienia (display-helpery niżej czytają PEŁNY stan przez
      // getState()) — subskrypcja tych wycinków gwarantuje świeży re-render, gdy
      // zmieni się zarząd/przypisania/zalogowany, bez rozszerzania propsów wierszy.
      people: s.people,
      departments: s.departments,
      assignments: s.assignments,
      currentUserId: s.currentUserId,
    }),
    shallowEqual,
  );
  const { getState } = useStoreApi();
  const { openTask } = useOpenTask();

  if (agenda.timed.length === 0 && agenda.dateless.length === 0) {
    return (
      <p className="muted">
        Brak zadań na dziś —{' '}
        <Link to="/calendar" className="inline-link">
          zajrzyj do kalendarza
        </Link>
        .
      </p>
    );
  }

  return (
    <ul className="dash-list agenda-list">
      {agenda.timed.map((w) => {
        const task = tasks.find((t) => t.id === w.taskId);
        if (!task) return null;
        const project = projects.find((p) => p.id === task.projectId);
        const client = project
          ? clients.find((c) => c.id === project.clientId)
          : undefined;
        const startM = w.startMinutes;
        const endM = startM + w.plannedHours * 60;
        return (
          <li key={w.id}>
            <button type="button" className="dash-row" onClick={() => openTask(task.id)}>
              <span className="agenda-time">
                {formatMinutes(startM)}–{formatMinutes(endM)}
              </span>
              <span className="dash-row-name">{taskDisplayTitle(getState(), task)}</span>
              <span className="agenda-meta">
                {project ? projectDisplayName(getState(), project) : '—'}
                {client ? ` → ${client.name}` : ''}
              </span>
              <StatusBadge status={statuses.find((s) => s.id === task.statusId)} />
            </button>
          </li>
        );
      })}
      {agenda.dateless.map((task) => (
        <li key={task.id}>
          <button
            type="button"
            className="dash-row agenda-dateless"
            onClick={() => openTask(task.id)}
          >
            <span className="agenda-time muted">bez godziny</span>
            <span className="dash-row-name">{taskDisplayTitle(getState(), task)}</span>
            <span className="agenda-meta muted">do {formatShortWithWeekday(task.endDate)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
