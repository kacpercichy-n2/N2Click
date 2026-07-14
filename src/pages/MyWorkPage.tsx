// "Moja praca" — the employee work surface. Three cards: Dzisiaj (today's
// agenda), Zasobnik (nierozplanowane) (bin work as task-level rows), Alerty
// (overdue tasks, over-capacity days, tasks with no plan). All reads go through
// selectors; nothing here mutates or persists. Shared with the dashboard via
// TodayAgendaList so "today" stays in sync.
import { Link } from 'react-router-dom';
import { useStore } from '../store/AppStore';
import {
  binTaskRowsForPerson,
  currentUser,
  dayAvailabilityForPerson,
  getClient,
  getProject,
  overdueTasksForPerson,
  overloadedDatesForPersonInRange,
  taskPlanningStatus,
  unplannedTasksForPerson,
} from '../store/selectors';
import { PlanningBadge } from '../components/PlanningBadge';
import { TodayAgendaList } from '../components/TodayAgenda';
import { useOpenTask } from '../components/TaskModal';
import { formatRowLabel, formatShort, shiftWeek, todayStr, weekDays } from '../utils/dates';
import { formatDuration } from '../utils/time';
import type { Task } from '../types';

export function MyWorkPage() {
  const { state } = useStore();
  const { openTask } = useOpenTask();
  const me = currentUser(state);
  const today = todayStr();

  // Setup mode (no people) / unresolved acting user → friendly empty state.
  if (!me) {
    return (
      <section className="page">
        <div className="page-head">
          <h1>Moja praca</h1>
        </div>
        <div className="empty-state">
          <p className="empty-title">Brak zalogowanego użytkownika</p>
          <p className="empty-hint">
            Dodaj osoby i projekty, aby zobaczyć swój plan pracy.
          </p>
          <Link to="/projects" className="btn primary">
            Przejdź do projektów
          </Link>
        </div>
      </section>
    );
  }

  const binRows = binTaskRowsForPerson(state, me.id);

  const overdue = overdueTasksForPerson(state, me.id, today);
  const horizon = [...weekDays(today), ...weekDays(shiftWeek(today, 1))];
  const overloadedDates = overloadedDatesForPersonInRange(state, me.id, horizon);
  const unplanned = unplannedTasksForPerson(state, me.id);
  const noAlerts =
    overdue.length === 0 && overloadedDates.length === 0 && unplanned.length === 0;

  const taskMeta = (task: Task): string => {
    const project = getProject(state, task.projectId);
    const client = project ? getClient(state, project.clientId) : undefined;
    return `${project?.name ?? '—'}${client ? ` → ${client.name}` : ''}`;
  };

  return (
    <section className="page">
      <div className="page-head dash-greeting">
        <h1>Moja praca</h1>
        <p className="dash-date">{formatRowLabel(today)}</p>
      </div>

      <div className="dash-grid my-work-grid">
        {/* Dzisiaj */}
        <div className="dash-card" data-tour="home.today">
          <h2>Dzisiaj</h2>
          <TodayAgendaList personId={me.id} date={today} />
        </div>

        {/* Zasobnik (nierozplanowane) */}
        <div className="dash-card" data-tour="home.bin">
          <h2>Zasobnik (nierozplanowane)</h2>
          {binRows.length === 0 ? (
            <p className="muted">Zasobnik jest pusty.</p>
          ) : (
            <ul className="dash-list agenda-list">
              {binRows.map(({ task, hours }) => (
                <li key={task.id}>
                  <button
                    type="button"
                    className="dash-row"
                    onClick={() => openTask(task.id)}
                  >
                    <span className="dash-row-name">{task.title}</span>
                    <span className="agenda-meta">{taskMeta(task)}</span>
                    <PlanningBadge status={taskPlanningStatus(state, task.id)} />
                    <span className="my-work-hours">{formatDuration(hours)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="dash-card-foot">
            <Link to="/calendar" className="link-btn">
              Zaplanuj w kalendarzu →
            </Link>
          </div>
        </div>

        {/* Alerty */}
        <div className="dash-card" data-tour="home.alerts">
          <h2>Alerty</h2>
          {noAlerts ? (
            <p className="muted">Brak alertów.</p>
          ) : (
            <div className="my-work-alerts">
              {overdue.length > 0 && (
                <div className="my-work-alert-group">
                  <h3 className="my-work-alert-title">Po terminie</h3>
                  <ul className="dash-list agenda-list">
                    {overdue.map((task) => (
                      <li key={task.id}>
                        <button
                          type="button"
                          className="dash-row my-work-alert-row"
                          onClick={() => openTask(task.id)}
                        >
                          <span className="dash-row-name">{task.title}</span>
                          <span className="agenda-meta">do {formatShort(task.endDate)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {overloadedDates.length > 0 && (
                <div className="my-work-alert-group">
                  <h3 className="my-work-alert-title">Przeciążone dni</h3>
                  <ul className="dash-list agenda-list">
                    {overloadedDates.map((date) => {
                      // That DAY's availability (0 on a day off), not raw
                      // capacity — a booked day off must read "4h / 0h".
                      const day = dayAvailabilityForPerson(state, me.id, date);
                      return (
                        <li key={date}>
                          <div className="dash-row my-work-alert-row is-static">
                            <span className="dash-row-name">{formatRowLabel(date)}</span>
                            <span className="agenda-meta">
                              zaplanowano {formatDuration(day.bookedHours)} /{' '}
                              {formatDuration(day.availableHours)}
                            </span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {unplanned.length > 0 && (
                <div className="my-work-alert-group">
                  <h3 className="my-work-alert-title">Bez planu</h3>
                  <ul className="dash-list agenda-list">
                    {unplanned.map((task) => (
                      <li key={task.id}>
                        <button
                          type="button"
                          className="dash-row my-work-alert-row"
                          onClick={() => openTask(task.id)}
                        >
                          <span className="dash-row-name">{task.title}</span>
                          <span className="agenda-meta">{taskMeta(task)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
