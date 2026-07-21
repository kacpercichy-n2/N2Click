// Panel — the logged-in worker's morning page. Four sections: today's tasks,
// a MOCK team chat with fake presence, an SVG donut workload summary, and a
// week strip of the user's blocks. All reads go through selectors; nothing here
// mutates or persists (the chat is a mockup).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { Megaphone } from '../components/icons';
import { useStore } from '../store/AppStore';
import { CHANGELOG, changelogRangeLabel, isSameDayRange } from '../data/changelog';
import { ChangelogModal } from '../components/ChangelogModal';
import {
  currentUser,
  dayAvailabilityForPerson,
  loadPercent,
  rangeAvailabilityForPerson,
  weekBlocksForPerson,
} from '../store/selectors';
import { Avatar } from '../components/Avatar';
import { TodayAgendaList } from '../components/TodayAgenda';
import {
  formatRowLabel,
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

/** An SVG ring showing booked vs available hours. Never divides by zero.
 * Hours booked against ZERO availability (`loadPercent` → null) render as a
 * full danger ring — dangerous, never a calm 0%. Any overbooked day inside the
 * range keeps the danger state even when the range TOTALS look fine, so a
 * booked day off can't average away into a calm percentage. */
function WorkloadDonut({
  label,
  booked,
  available,
  overbookedDates = [],
}: {
  label: string;
  booked: number;
  available: number;
  overbookedDates?: string[];
}) {
  const size = 120;
  const stroke = 12;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const over = booked > available || overbookedDates.length > 0;
  const ratio = available > 0 ? Math.min(booked / available, 1) : over ? 1 : 0;
  const pct = loadPercent(booked, available);
  const fill = over ? 'var(--n2-danger)' : 'var(--n2-lavender)';
  const overTitle =
    overbookedDates.length > 0
      ? `Powyżej dostępności: ${overbookedDates.map(formatRowLabel).join(', ')}`
      : pct === null
        ? 'Godziny zaplanowane przy zerowej dostępności'
        : undefined;

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
        <span className={`donut-pct${over ? ' over' : ''}`} title={overTitle}>
          {pct === null ? '⚠ brak dostępności' : over ? `⚠ ${pct}%` : `${pct}%`}
        </span>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { state } = useStore();
  const me = currentUser(state);
  const today = todayStr();
  const [changelogOpen, setChangelogOpen] = useState(false);
  const latestChange = CHANGELOG[0];

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

  const coworkers = state.people.filter((p) => p.id !== me.id);

  // Workload donuts (today + this week) — both read the authoritative
  // availability selectors so a booked zero-availability day stays dangerous.
  const week = weekDays(today);
  const todayAvail = dayAvailabilityForPerson(state, me.id, today);
  const weekAvail = rangeAvailabilityForPerson(state, me.id, week);

  const weekMap = weekBlocksForPerson(state, me.id, week);

  return (
    <section className="page">
      <div className="page-head dash-greeting">
        <h1>Dzień dobry, {me.firstName}</h1>
        <p className="dash-date">{formatRowLabel(today)}</p>
      </div>

      {latestChange && (
        <motion.div
          className="changelog-bar"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: 'easeOut' }}
        >
          <Megaphone size={18} className="changelog-bar-icon" aria-hidden />
          <span className="changelog-bar-text">
            Zmiany i fixy wprowadzone{' '}
            {isSameDayRange(latestChange.dateFrom, latestChange.dateTo) ? 'w dniu' : 'w dniach'}{' '}
            <strong>{changelogRangeLabel(latestChange.dateFrom, latestChange.dateTo)}</strong>
            <span className="changelog-bar-summary">{latestChange.summary}</span>
          </span>
          <span className="changelog-bar-actions">
            <button
              type="button"
              className="btn ghost changelog-bar-btn"
              onClick={() => setChangelogOpen(true)}
            >
              Czytaj całość
            </button>
            <Link to="/changelog" className="btn ghost changelog-bar-btn">
              Zobacz pełną historię
            </Link>
          </span>
        </motion.div>
      )}

      <ChangelogModal open={changelogOpen} onClose={() => setChangelogOpen(false)} />

      <motion.div
        className="dash-grid dash-welcome-grid"
        variants={dashGridVariants}
        initial="hidden"
        animate="show"
      >
        {/* (a) Today's tasks */}
        <motion.div className="dash-card" variants={dashCardVariants} data-tour="home.today">
          <h2>Zadania na dziś</h2>
          <TodayAgendaList personId={me.id} date={today} />
        </motion.div>

        {/* (b) Team overview — realne dane zespołu, bez atrap czatu/obecności. */}
        <motion.div className="dash-card" variants={dashCardVariants} data-tour="home.workload">
          <div className="dash-card-head">
            <h2>Zespół</h2>
          </div>
          {coworkers.length === 0 ? (
            <p className="field-hint">Brak innych osób w zespole.</p>
          ) : (
            <ul className="chat-people">
              {coworkers.map((p) => (
                <li key={p.id} className="chat-person">
                  <Avatar person={p} size={32} />
                  <span className="chat-person-text">
                    <span className="chat-person-name">{p.name}</span>
                    {p.role && <span className="chat-person-role">{p.role}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </motion.div>

        {/* (c) Workload summary */}
        <motion.div className="dash-card" variants={dashCardVariants}>
          <h2>Obciążenie</h2>
          <div className="donut-row">
            <WorkloadDonut
              label="Dziś"
              booked={todayAvail.bookedHours}
              available={todayAvail.availableHours}
              overbookedDates={todayAvail.overbooked ? [today] : []}
            />
            <WorkloadDonut
              label="Ten tydzień"
              booked={weekAvail.bookedHours}
              available={weekAvail.availableHours}
              overbookedDates={weekAvail.overbookedDates}
            />
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
