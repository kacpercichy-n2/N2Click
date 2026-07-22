// Panel — the logged-in worker's morning page. A 2-column grid (see
// `.dash-welcome-grid`): notifications slot + compact workload donuts, then
// today's tasks + the real team roster, then a full-width week strip, then the
// Zasobnik (unscheduled work) + Alerty tiles merged in from the former „Moja
// praca" page. All reads go through selectors; nothing here mutates or persists.
// Powiadomienia is a UI slot only (no data source yet — it receives an empty
// list).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { Megaphone } from '../components/icons';
import { useStore } from '../store/AppStore';
import { CHANGELOG, changelogRangeLabel, isSameDayRange } from '../data/changelog';
import { ChangelogModal } from '../components/ChangelogModal';
import {
  binTaskRowsForPerson,
  currentUser,
  dayAvailabilityForPerson,
  getClient,
  getProject,
  loadPercent,
  overdueTasksForPerson,
  overloadedDatesForPersonInRange,
  rangeAvailabilityForPerson,
  taskPlanningStatus,
  unplannedTasksForPerson,
  weekBlocksForPerson,
} from '../store/selectors';
import { Avatar } from '../components/Avatar';
import { PlanningBadge } from '../components/PlanningBadge';
import { TodayAgendaList } from '../components/TodayAgenda';
import { useOpenTask } from '../components/TaskModal';
import {
  formatRowLabel,
  formatShortWithWeekday,
  isTodayStr,
  isWeekend,
  shiftWeek,
  todayStr,
  weekDays,
  weekdayHeader,
  dayNumber,
} from '../utils/dates';
import { formatMinutes, formatDuration } from '../utils/time';
import type { Task } from '../types';
import {
  teamHeaderLabel,
  visibleNotifications,
  type NotificationEntry,
} from './dashboardPanels';

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
      {/* The center overlay is positioned within this ring box (inset: 0), not
       *  against a hardcoded pixel offset, so it stays centered if `size` changes. */}
      <div className="donut-ring">
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
  const { openTask } = useOpenTask();
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

  // Powiadomienia — UI slot only. There is no event source yet, so this is
  // deliberately empty; the tile renders its empty state (see prompt 258 for a
  // real feed). The visibility cap lives in `visibleNotifications`.
  const notifications: NotificationEntry[] = [];
  const shownNotifications = visibleNotifications(notifications);

  // Workload donuts (today + this week) — both read the authoritative
  // availability selectors so a booked zero-availability day stays dangerous.
  const week = weekDays(today);
  const todayAvail = dayAvailabilityForPerson(state, me.id, today);
  const weekAvail = rangeAvailabilityForPerson(state, me.id, week);

  const weekMap = weekBlocksForPerson(state, me.id, week);

  // Zasobnik + Alerty — merged in from the former „Moja praca" page. Same
  // selectors, same read-only behavior: bin rows open the task modal and keep
  // the planning badge; alerts cover overdue tasks, over-capacity days (across
  // this + next week) and tasks with no plan.
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
        {/* RZĄD 2 · Powiadomienia — UI slot only (no data source yet). Renders
         *  the empty state so the slot stays visible in the layout. */}
        <motion.div className="dash-card dash-area-notifications" variants={dashCardVariants}>
          <h2>Powiadomienia</h2>
          {shownNotifications.length === 0 ? (
            <p className="field-hint">Brak nowych powiadomień</p>
          ) : (
            <ul className="dash-list">
              {shownNotifications.map((n) => (
                <li key={n.id} className="dash-row">
                  <span className="dash-row-name">{n.title}</span>
                  {n.when && <span className="dash-row-when">{n.when}</span>}
                </li>
              ))}
            </ul>
          )}
        </motion.div>

        {/* RZĄD 2 · Workload summary (compact, narrow column) */}
        <motion.div className="dash-card dash-area-workload" variants={dashCardVariants}>
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

        {/* RZĄD 3 · Today's tasks — keep data-tour="home.today" (onboarding
         *  queries it, src/onboarding/catalog.ts). */}
        <motion.div
          className="dash-card dash-area-today"
          variants={dashCardVariants}
          data-tour="home.today"
        >
          <h2>Zadania na dziś</h2>
          <TodayAgendaList personId={me.id} date={today} />
        </motion.div>

        {/* RZĄD 3 · Team roster — realne dane zespołu, bez atrap czatu/obecności.
         *  Keep data-tour="home.workload" on this card. Max 4 rows visible; the
         *  rest scroll inside the tile (see `.chat-people`). */}
        <motion.div
          className="dash-card dash-area-team"
          variants={dashCardVariants}
          data-tour="home.workload"
        >
          <div className="dash-card-head">
            <h2>{teamHeaderLabel(coworkers.length)}</h2>
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

        {/* RZĄD 4 · Week strip (full width) */}
        <motion.div className="dash-card dash-area-week" variants={dashCardVariants}>
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

        {/* RZĄD 5 · Zasobnik (nierozplanowane) — task-level rows for hours
         *  assigned to me but without a day/time. Keep data-tour="home.bin"
         *  (onboarding queries it, src/onboarding/catalog.ts). Clicking a row
         *  opens the task modal; the planning badge stays. */}
        <motion.div
          className="dash-card dash-area-bin"
          variants={dashCardVariants}
          data-tour="home.bin"
        >
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
        </motion.div>

        {/* RZĄD 5 · Alerty — overdue tasks, over-capacity days and work with no
         *  plan. Keep data-tour="home.alerts" (onboarding queries it). */}
        <motion.div
          className="dash-card dash-area-alerts"
          variants={dashCardVariants}
          data-tour="home.alerts"
        >
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
                          <span className="agenda-meta">do {formatShortWithWeekday(task.endDate)}</span>
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
        </motion.div>
      </motion.div>
    </section>
  );
}
