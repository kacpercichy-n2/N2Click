import { useStore } from '../store/AppStore';
import { useOpenTask } from '../components/TaskModal';
import {
  assigneesOfTask,
  getClient,
  getProject,
  getStatus,
  taskPlannedTotal,
} from '../store/selectors';
import { PersonChip } from '../components/PersonChip';
import { StatusBadge } from '../components/StatusBadge';
import { Coin } from '../components/Coin';
import { parseDate } from '../utils/dates';
import { format } from 'date-fns';
import { pl } from 'date-fns/locale/pl';

function fmtHours(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

function rangeLabel(start: string, end: string): string {
  const s = parseDate(start);
  const e = parseDate(end);
  if (start === end) return format(s, 'd MMM yyyy', { locale: pl });
  const sameYear = s.getFullYear() === e.getFullYear();
  const sameMonth = sameYear && s.getMonth() === e.getMonth();
  if (sameMonth) return `${format(s, 'd')}–${format(e, 'd MMM yyyy', { locale: pl })}`;
  if (sameYear) return `${format(s, 'd MMM', { locale: pl })} – ${format(e, 'd MMM yyyy', { locale: pl })}`;
  return `${format(s, 'd MMM yyyy', { locale: pl })} – ${format(e, 'd MMM yyyy', { locale: pl })}`;
}

export function TasksPage() {
  const { state, dispatch } = useStore();
  const { openTask, openNewTask } = useOpenTask();

  // Sort by start date, then title, for a stable predictable list.
  const tasks = [...state.tasks].sort((a, b) =>
    a.startDate === b.startDate
      ? a.title.localeCompare(b.title)
      : a.startDate.localeCompare(b.startDate),
  );

  const handleDelete = (taskId: string, title: string) => {
    if (window.confirm(`Usunąć „${title}”? To usunie przypisania i zaplanowane godziny.`)) {
      dispatch({ type: 'DELETE_TASK', taskId });
    }
  };

  return (
    <section className="page">
      <div className="page-head">
        <h1>Zadania</h1>
        <button type="button" className="btn primary" onClick={() => openNewTask()}>
          + Nowe zadanie
        </button>
      </div>

      {tasks.length === 0 ? (
        <div className="empty-state">
          <p className="empty-title">Brak zadań</p>
          <p className="empty-hint">
            Utwórz zadanie, przypisz osoby i zaplanuj ich godziny dzień po dniu.
          </p>
          <button type="button" className="btn primary" onClick={() => openNewTask()}>
            + Nowe zadanie
          </button>
        </div>
      ) : (
        <ul className="task-list">
          {tasks.map((task) => {
            const assignees = assigneesOfTask(state, task.id);
            const planned = taskPlannedTotal(state, task.id);
            const project = getProject(state, task.projectId);
            const client = project ? getClient(state, project.clientId) : undefined;
            return (
              <li key={task.id} className="task-card">
                <button
                  type="button"
                  className="task-card-main"
                  onClick={() => openTask(task.id)}
                >
                  <div className="task-card-top">
                    <span className="task-title">{task.title}</span>
                    <StatusBadge status={getStatus(state, task.statusId)} />
                    {project && (
                      <span className="project-badge">
                        <Coin paid={project.paid} size={13} />
                        {client ? `${client.name} / ` : ''}
                        {project.name}
                      </span>
                    )}
                  </div>
                  <div className="task-card-range">{rangeLabel(task.startDate, task.endDate)}</div>
                  <div className="task-card-assignees">
                    {assignees.length === 0 ? (
                      <span className="muted">Brak przypisanych osób</span>
                    ) : (
                      assignees.map((p) => <PersonChip key={p.id} person={p} />)
                    )}
                  </div>
                  <div className="task-card-hours">
                    <strong>zaplanowano {fmtHours(planned)}h</strong>
                    {task.estimatedHours != null && (
                      <span className="muted"> / szac. {fmtHours(task.estimatedHours)}h</span>
                    )}
                  </div>
                </button>
                <button
                  type="button"
                  className="btn danger-ghost task-delete"
                  onClick={() => handleDelete(task.id, task.title)}
                  aria-label={`Usuń ${task.title}`}
                >
                  Usuń
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
