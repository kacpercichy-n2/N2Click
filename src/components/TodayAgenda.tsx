// The "Zadania na dziś" list body, shared by the Panel (dashboard) and the
// "Moja praca" page. Renders a person's timed blocks + dateless assigned tasks
// for one date, plus the empty state. Reads go through selectors; clicks open
// the task modal. Extracted verbatim from DashboardPage — same class names and
// behavior — so both surfaces stay in sync.
import { Link } from 'react-router-dom';
import { useStore } from '../store/AppStore';
import {
  getClient,
  getProject,
  getStatus,
  todayAgendaForPerson,
} from '../store/selectors';
import { StatusBadge } from './StatusBadge';
import { useOpenTask } from './TaskModal';
import { formatShortWithWeekday } from '../utils/dates';
import { formatMinutes } from '../utils/time';
import type { DateStr } from '../types';

export function TodayAgendaList({ personId, date }: { personId: string; date: DateStr }) {
  const { state } = useStore();
  const { openTask } = useOpenTask();
  const agenda = todayAgendaForPerson(state, personId, date);

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
        const task = state.tasks.find((t) => t.id === w.taskId);
        if (!task) return null;
        const project = getProject(state, task.projectId);
        const client = project ? getClient(state, project.clientId) : undefined;
        const startM = w.startMinutes;
        const endM = startM + w.plannedHours * 60;
        return (
          <li key={w.id}>
            <button type="button" className="dash-row" onClick={() => openTask(task.id)}>
              <span className="agenda-time">
                {formatMinutes(startM)}–{formatMinutes(endM)}
              </span>
              <span className="dash-row-name">{task.title}</span>
              <span className="agenda-meta">
                {project?.name ?? '—'}
                {client ? ` → ${client.name}` : ''}
              </span>
              <StatusBadge status={getStatus(state, task.statusId)} />
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
            <span className="dash-row-name">{task.title}</span>
            <span className="agenda-meta muted">do {formatShortWithWeekday(task.endDate)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
