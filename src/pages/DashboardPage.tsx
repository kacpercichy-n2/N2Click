// Panel — the logged-in worker's morning page. Four sections: today's tasks,
// a MOCK team chat with fake presence, an SVG donut workload summary, and a
// week strip of the user's blocks. All reads go through selectors; nothing here
// mutates or persists (the chat is a mockup).
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { useStore } from '../store/AppStore';
import {
  availableHoursInRange,
  availableHoursOnDate,
  currentUser,
  getClient,
  getProject,
  getStatus,
  hoursForPersonOnDate,
  todayAgendaForPerson,
  weekBlocksForPerson,
} from '../store/selectors';
import { StatusBadge } from '../components/StatusBadge';
import { ChatMock } from '../components/ChatMock';
import { useOpenTask } from '../components/TaskModal';
import {
  formatRowLabel,
  formatShort,
  isTodayStr,
  isWeekend,
  todayStr,
  weekDays,
  weekdayHeader,
  dayNumber,
} from '../utils/dates';
import { formatMinutes, formatDuration } from '../utils/time';

// Staggered entrance for the dashboard cards.
const dashGridVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04 } },
};
const dashCardVariants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.2, ease: 'easeOut' } },
} as const;

const MAX_DAY_BLOCKS = 4;

/** An SVG ring showing booked vs available hours. Never divides by zero. */
function WorkloadDonut({
  label,
  booked,
  available,
}: {
  label: string;
  booked: number;
  available: number;
}) {
  const size = 120;
  const stroke = 12;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const ratio = available > 0 ? Math.min(booked / available, 1) : 0;
  const over = available > 0 && booked > available;
  const pct = available > 0 ? Math.round((booked / available) * 100) : 0;
  const fill = over ? 'var(--n2-danger)' : 'var(--n2-lavender)';

  return (
    <div className="donut">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--n2-surface-muted)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={fill}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${ratio * circumference} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="donut-center">
        <span className={`donut-value${over ? ' over' : ''}`}>
          {formatDuration(booked)} / {formatDuration(available)}
        </span>
      </div>
      <div className="donut-caption">
        <span className="donut-label">{label}</span>
        <span className={`donut-pct${over ? ' over' : ''}`}>{pct}%</span>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { state } = useStore();
  const { openTask } = useOpenTask();
  const me = currentUser(state);
  const today = todayStr();

  // Edge case: setup mode (no people) or no resolvable acting user → keep the
  // original welcome empty-state exactly.
  if (!me) {
    return (
      <section className="page">
        <div className="page-head">
          <h1>Panel</h1>
        </div>
        <div className="empty-state">
          <p className="empty-title">Witaj w N2Hub</p>
          <p className="empty-hint">
            Zacznij od dodania klienta i projektu, a potem zaplanuj zadania oraz godziny.
          </p>
          <Link to="/projects" className="btn primary">
            Przejdź do projektów
          </Link>
        </div>
      </section>
    );
  }

  const agenda = todayAgendaForPerson(state, me.id, today);
  const coworkers = state.people.filter((p) => p.id !== me.id);

  // Workload donuts (today + this week).
  const week = weekDays(today);
  const bookedToday = hoursForPersonOnDate(state, me.id, today);
  const availableToday = availableHoursOnDate(state, me.id, today);
  const bookedWeek = week.reduce((sum, d) => sum + hoursForPersonOnDate(state, me.id, d), 0);
  const availableWeek = availableHoursInRange(state, me.id, week);

  const weekMap = weekBlocksForPerson(state, me.id, week);

  return (
    <section className="page">
      <div className="page-head dash-greeting">
        <h1>Dzień dobry, {me.firstName}</h1>
        <p className="dash-date">{formatRowLabel(today)}</p>
      </div>

      <motion.div
        className="dash-grid dash-welcome-grid"
        variants={dashGridVariants}
        initial="hidden"
        animate="show"
      >
        {/* (a) Today's tasks */}
        <motion.div className="dash-card" variants={dashCardVariants}>
          <h2>Zadania na dziś</h2>
          {agenda.timed.length === 0 && agenda.dateless.length === 0 ? (
            <p className="muted">
              Brak zadań na dziś —{' '}
              <Link to="/calendar" className="inline-link">
                zajrzyj do kalendarza
              </Link>
              .
            </p>
          ) : (
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
                    <button
                      type="button"
                      className="dash-row"
                      onClick={() => openTask(task.id)}
                    >
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
                    <span className="agenda-meta muted">do {formatShort(task.endDate)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </motion.div>

        {/* (b) Team chat (mockup) */}
        <motion.div className="dash-card" variants={dashCardVariants}>
          <div className="dash-card-head">
            <h2>Zespół</h2>
            <span className="demo-badge">Wersja demonstracyjna</span>
          </div>
          <ChatMock coworkers={coworkers} />
        </motion.div>

        {/* (c) Workload summary */}
        <motion.div className="dash-card" variants={dashCardVariants}>
          <h2>Obciążenie</h2>
          <div className="donut-row">
            <WorkloadDonut label="Dziś" booked={bookedToday} available={availableToday} />
            <WorkloadDonut label="Ten tydzień" booked={bookedWeek} available={availableWeek} />
          </div>
        </motion.div>

        {/* (d) Week strip */}
        <motion.div className="dash-card" variants={dashCardVariants}>
          <div className="dash-card-head">
            <h2>Twój tydzień</h2>
            <Link to="/calendar" className="link-btn">
              Otwórz kalendarz →
            </Link>
          </div>
          <div className="week-strip">
            {week.map((d) => {
              const blocks = weekMap.get(d) ?? [];
              const shown = blocks.slice(0, MAX_DAY_BLOCKS);
              const extra = blocks.length - shown.length;
              const classes = [
                'week-strip-day',
                isTodayStr(d) ? 'is-today' : '',
                isWeekend(d) ? 'is-weekend' : '',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <div key={d} className={classes}>
                  <div className="week-strip-head">
                    <span className="week-strip-dow">{weekdayHeader(d)}</span>
                    <span className="week-strip-num">{dayNumber(d)}</span>
                  </div>
                  {blocks.length === 0 ? (
                    <p className="week-strip-empty">—</p>
                  ) : (
                    <ul className="week-strip-blocks">
                      {shown.map((w) => {
                        const task = state.tasks.find((t) => t.id === w.taskId);
                        return (
                          <li key={w.id}>
                            <span className="week-strip-time">{formatMinutes(w.startMinutes)}</span>{' '}
                            {task?.title ?? '—'}
                          </li>
                        );
                      })}
                      {extra > 0 && <li className="week-strip-more">+{extra} więcej</li>}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </motion.div>
      </motion.div>
    </section>
  );
}
