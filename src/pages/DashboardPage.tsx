// Dashboard: at-a-glance overview — pipeline counts, upcoming deadlines and
// milestones, unpaid projects, and this week's overload warnings.
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { useStore } from '../store/AppStore';
import {
  activeStatuses,
  getClient,
  getPerson,
  hoursForPersonOnDate,
  overloadedPeopleOnDate,
  personCapacity,
} from '../store/selectors';
import { Coin } from '../components/Coin';
import { StatusBadge } from '../components/StatusBadge';
import {
  addDaysStr,
  formatRowLabel,
  formatShort,
  todayStr,
  weekDays,
} from '../utils/dates';

// Staggered entrance for the dashboard cards.
const dashGridVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04 } },
};
const dashCardVariants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.2, ease: 'easeOut' } },
} as const;

export function DashboardPage() {
  const { state } = useStore();
  const navigate = useNavigate();
  const today = todayStr();
  const statuses = activeStatuses(state);
  const doneStatusId = statuses.slice(-1)[0]?.id;

  const unpaid = state.projects.filter((p) => !p.paid);
  const horizon = addDaysStr(today, 14);
  const deadlines = state.projects
    .filter((p) => p.endDate >= today && p.endDate <= horizon)
    .sort((a, b) => a.endDate.localeCompare(b.endDate));
  const overdue = state.projects.filter(
    (p) => p.endDate < today && p.statusId !== doneStatusId,
  );
  const milestones = state.milestones
    .filter((m) => m.date >= today && m.date <= horizon)
    .sort((a, b) => a.date.localeCompare(b.date));

  // Overloads across this week.
  const week = weekDays(today);
  const overloads = week.flatMap((d) =>
    overloadedPeopleOnDate(state, d).map((personId) => ({ date: d, personId })),
  );

  return (
    <section className="page">
      <div className="page-head">
        <h1>Dashboard</h1>
      </div>

      {state.projects.length === 0 && state.tasks.length === 0 ? (
        <div className="empty-state">
          <p className="empty-title">Welcome to N2click</p>
          <p className="empty-hint">
            Start by creating a client and a project, then plan tasks and hours.
          </p>
          <Link to="/projects" className="btn primary">
            Go to projects
          </Link>
        </div>
      ) : (
        <motion.div
          className="dash-grid"
          variants={dashGridVariants}
          initial="hidden"
          animate="show"
        >
          <motion.div className="dash-card" variants={dashCardVariants}>
            <h2>Pipeline</h2>
            <ul className="dash-pipeline">
              {statuses.map((s) => {
                const count = state.projects.filter((p) => p.statusId === s.id).length;
                return (
                  <li key={s.id}>
                    <StatusBadge status={s} />
                    <strong>{count}</strong>
                  </li>
                );
              })}
            </ul>
            <Link to="/kanban" className="link-btn">
              Open kanban →
            </Link>
          </motion.div>

          <motion.div className="dash-card" variants={dashCardVariants}>
            <h2>Deadlines (14 days)</h2>
            {overdue.length === 0 && deadlines.length === 0 ? (
              <p className="muted">Nothing due in the next two weeks.</p>
            ) : (
              <ul className="dash-list">
                {overdue.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="dash-row danger"
                      onClick={() => navigate(`/projects/${p.id}`)}
                    >
                      <Coin paid={p.paid} size={14} />
                      <span className="dash-row-name">{p.name}</span>
                      <span className="dash-row-when">overdue ({formatShort(p.endDate)})</span>
                    </button>
                  </li>
                ))}
                {deadlines.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="dash-row"
                      onClick={() => navigate(`/projects/${p.id}`)}
                    >
                      <Coin paid={p.paid} size={14} />
                      <span className="dash-row-name">{p.name}</span>
                      <span className="dash-row-when">{formatShort(p.endDate)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {milestones.length > 0 && (
              <>
                <h3 className="dash-subhead">Milestones</h3>
                <ul className="dash-list">
                  {milestones.map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        className="dash-row"
                        onClick={() => navigate(`/projects/${m.projectId}`)}
                      >
                        <span aria-hidden>◆</span>
                        <span className="dash-row-name">{m.name}</span>
                        <span className="dash-row-when">{formatShort(m.date)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </motion.div>

          <motion.div className="dash-card" variants={dashCardVariants}>
            <h2>Payments</h2>
            <p>
              <Coin paid size={16} /> <strong>{state.projects.length - unpaid.length}</strong> paid
              {' · '}
              <Coin paid={false} size={16} /> <strong>{unpaid.length}</strong> unpaid
            </p>
            {unpaid.length > 0 && (
              <ul className="dash-list">
                {unpaid.slice(0, 5).map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="dash-row"
                      onClick={() => navigate(`/projects/${p.id}`)}
                    >
                      <Coin paid={false} size={14} />
                      <span className="dash-row-name">{p.name}</span>
                      <span className="dash-row-when muted">
                        {getClient(state, p.clientId)?.name ?? ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <Link to="/projects" className="link-btn">
              All projects →
            </Link>
          </motion.div>

          <motion.div className="dash-card" variants={dashCardVariants}>
            <h2>Overloads this week</h2>
            {overloads.length === 0 ? (
              <p className="muted">Nobody is over capacity this week. 🎉</p>
            ) : (
              <ul className="dash-list">
                {overloads.map(({ date, personId }) => {
                  const person = getPerson(state, personId);
                  if (!person) return null;
                  return (
                    <li key={`${date}-${personId}`}>
                      <button
                        type="button"
                        className="dash-row danger"
                        onClick={() => navigate(`/people/${personId}`)}
                      >
                        <span className="dash-row-name">⚠ {person.name}</span>
                        <span className="dash-row-when">
                          {formatRowLabel(date)} —{' '}
                          {hoursForPersonOnDate(state, personId, date)}h /{' '}
                          {personCapacity(state, personId)}h
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <Link to="/workload" className="link-btn">
              Workload dashboard →
            </Link>
          </motion.div>
        </motion.div>
      )}
    </section>
  );
}
