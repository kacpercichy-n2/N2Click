import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../store/AppStore';
import { assigneesOfTask, taskPlannedTotal } from '../store/selectors';
import { PersonChip } from '../components/PersonChip';
import { parseDate } from '../utils/dates';
import { format } from 'date-fns';

function fmtHours(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

function rangeLabel(start: string, end: string): string {
  const s = parseDate(start);
  const e = parseDate(end);
  if (start === end) return format(s, 'd MMM yyyy');
  const sameYear = s.getFullYear() === e.getFullYear();
  const sameMonth = sameYear && s.getMonth() === e.getMonth();
  if (sameMonth) return `${format(s, 'd')}–${format(e, 'd MMM yyyy')}`;
  if (sameYear) return `${format(s, 'd MMM')} – ${format(e, 'd MMM yyyy')}`;
  return `${format(s, 'd MMM yyyy')} – ${format(e, 'd MMM yyyy')}`;
}

export function TasksPage() {
  const { state, dispatch } = useStore();
  const navigate = useNavigate();

  // Sort by start date, then title, for a stable predictable list.
  const tasks = [...state.tasks].sort((a, b) =>
    a.startDate === b.startDate
      ? a.title.localeCompare(b.title)
      : a.startDate.localeCompare(b.startDate),
  );

  const handleDelete = (taskId: string, title: string) => {
    if (window.confirm(`Delete "${title}"? This removes its assignments and planned hours.`)) {
      dispatch({ type: 'DELETE_TASK', taskId });
    }
  };

  return (
    <section className="page">
      <div className="page-head">
        <h1>Tasks</h1>
        <Link to="/tasks/new" className="btn primary">
          + New task
        </Link>
      </div>

      {tasks.length === 0 ? (
        <div className="empty-state">
          <p className="empty-title">No tasks yet</p>
          <p className="empty-hint">
            Create a task, assign people, and plan their hours day by day.
          </p>
          <Link to="/tasks/new" className="btn primary">
            + New task
          </Link>
        </div>
      ) : (
        <ul className="task-list">
          {tasks.map((task) => {
            const assignees = assigneesOfTask(state, task.id);
            const planned = taskPlannedTotal(state, task.id);
            return (
              <li key={task.id} className="task-card">
                <button
                  type="button"
                  className="task-card-main"
                  onClick={() => navigate(`/tasks/${task.id}`)}
                >
                  <div className="task-card-top">
                    <span className="task-title">{task.title}</span>
                    {task.project && (
                      <span className="project-badge">{task.project}</span>
                    )}
                  </div>
                  <div className="task-card-range">{rangeLabel(task.startDate, task.endDate)}</div>
                  <div className="task-card-assignees">
                    {assignees.length === 0 ? (
                      <span className="muted">No assignees</span>
                    ) : (
                      assignees.map((p) => <PersonChip key={p.id} person={p} />)
                    )}
                  </div>
                  <div className="task-card-hours">
                    <strong>{fmtHours(planned)}h planned</strong>
                    {task.estimatedHours != null && (
                      <span className="muted"> / {fmtHours(task.estimatedHours)}h est</span>
                    )}
                  </div>
                </button>
                <button
                  type="button"
                  className="btn danger-ghost task-delete"
                  onClick={() => handleDelete(task.id, task.title)}
                  aria-label={`Delete ${task.title}`}
                >
                  Delete
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
