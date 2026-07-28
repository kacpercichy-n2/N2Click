// Panel — the logged-in worker's morning page. A 2-column grid (see
// `.dash-welcome-grid`): today's tasks + compact workload donuts, then
// Powiadomienia (pochodny feed @-wzmianek i przypisań z selektorów) + the real
// team roster, then a full-width week strip, then
// the Zasobnik (unscheduled work) + Alerty tiles merged in from the former „Moja
// praca" page. All reads go through selectors; nothing here mutates or persists
// planner data (jedyny zapis to urządzeniowa preferencja UI: potwierdzony wpis
// dziennika zmian).
//
// Trzy reguły „ciszy" Panelu (OP-01/AT-17/AT-19):
// - PUSTE Powiadomienia/Alerty kurczą się do belki ~40 px (`dashTileView`) i nie
//   rozciągają rzędu (`align-self: start`); z treścią renderują się jak dotąd.
// - Dziennik zmian to JEDNA linia z JEDNYM CTA, widoczna tylko dopóki najnowszy
//   wpis jest nieprzeczytany na tym urządzeniu; „Zadania na dziś" są pierwszym
//   elementem treści.
// - CTA zasobnika jest przyciskiem akcentowym z konkretem („Zaplanuj 2h — …"),
//   a w pasku tygodnia weekend to dwie belki 24 px i „+N więcej" prowadzi do dnia.
//
// Poniżej `MOBILE_NAV_QUERY` ta sama treść układa się w STOS „po co tu jestem”
// (`dash-m-stack`): kolejność i pustka kafelków pochodzą z czystego
// `mobileDashboardOrder`, dwa pierścienie zastępuje jedna linia
// (`workloadSummaryLine`), a tydzień siedem pigułek. Kafelek bez treści nie
// istnieje wtedy w DOM-ie — dlatego renderowanie warunkowe, nie CSS `order`.
// Siatka desktopowa jest nietknięta.
import { Fragment, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { m, useReducedMotion } from 'motion/react';
import { useStore } from '../store/AppStore';
import { CHANGELOG, changelogCtaLabel, changelogUnread } from '../data/changelog';
import { ChangelogModal } from '../components/ChangelogModal';
import { calendarDayTarget } from '../components/bottomNav';
import {
  binTaskRowsForPerson,
  currentUser,
  dayAvailabilityForPerson,
  getClient,
  getProject,
  loadPercent,
  notificationsForPerson,
  unreadNotificationCount,
  overdueTasksForPerson,
  overloadedDatesForPersonInRange,
  rangeAvailabilityForPerson,
  taskPlannedTotal,
  taskPlanningStatus,
  todayAgendaForPerson,
  unplannedTasksForPerson,
  weekBlocksForPerson,
} from '../store/selectors';
import { Avatar } from '../components/Avatar';
import { PlanningProgress } from '../components/PlanningProgress';
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
import { formatTimestamp } from '../utils/dates';
import { MOBILE_NAV_QUERY, useMediaQuery } from '../utils/useMediaQuery';
import { loadUiPrefs, updateUiPrefs } from '../utils/uiPrefs';
import type { Task } from '../types';
import {
  binPlanCtaLabel,
  dashTileView,
  mobileDashboardOrder,
  teamHeaderLabel,
  visibleNotifications,
  workloadSummaryLine,
  type CollapsibleTileId,
  type DashTileId,
  type NotificationEntry,
  type WorkloadSegment,
} from './dashboardPanels';

// Staggered entrance for the dashboard cards.
const dashGridVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04 } },
};
// „Ograniczony ruch”: `MotionConfig reducedMotion="user"` (main.tsx) sam pomija
// przesunięcia (`y`), ale NIE zdejmuje kaskady — kafelki nadal wchodziłyby
// jeden po drugim. Przy tej preferencji cała siatka pojawia się naraz.
const dashGridVariantsStill = {
  hidden: {},
  show: { transition: { staggerChildren: 0 } },
};
const dashCardVariants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.2, ease: 'easeOut' } },
} as const;

const MAX_DAY_BLOCKS = 4;

/** Stan „niebezpieczny” obciążenia — JEDNA reguła dla pierścieni (desktop) i dla
 *  linii podsumowania (telefon), żeby oba widoki nigdy nie rozjechały się co do
 *  ostrzeżenia: przekroczenie sumy, JAKIKOLWIEK przeciążony dzień w zakresie
 *  albo godziny przy zerowej dostępności (`loadPercent` → null; ten przypadek
 *  zawiera się już w pierwszym warunku, jest tu wypisany dla czytelności). */
function isOverloaded(
  booked: number,
  available: number,
  overbookedDates: readonly string[],
): boolean {
  return (
    booked > available ||
    overbookedDates.length > 0 ||
    (loadPercent(booked, available) === null && booked > 0)
  );
}

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
  const over = isOverloaded(booked, available, overbookedDates);
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
        <span className={`donut-pct${over ? ' over' : ''}`}>
          {pct === null ? '⚠ brak dostępności' : over ? `⚠ ${pct}%` : `${pct}%`}
          {/* Powód przeciążenia był dotąd hover-only (`title`) — teraz czyta go
              każdy czytnik ekranu, a widok pozostaje bez zmian. */}
          {overTitle !== undefined && <span className="sr-only"> — {overTitle}</span>}
        </span>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { state, dispatch } = useStore();
  const { openTask } = useOpenTask();
  const navigate = useNavigate();
  const me = currentUser(state);
  const today = todayStr();
  const [changelogOpen, setChangelogOpen] = useState(false);
  // Który wpis dziennika zmian jest już potwierdzony NA TYM URZĄDZENIU — pasek
  // „Nowości" znika po otwarciu popoutu i nie wraca aż do kolejnego wpisu
  // (AT-17). To preferencja UI (uiPrefs), nie dane aplikacji.
  const [changelogSeenId, setChangelogSeenId] = useState<string | undefined>(
    () => loadUiPrefs().changelogSeenId,
  );
  // Rozwinięty podgląd powiadomienia (max jeden naraz). Hook MUSI stać przed
  // wczesnym returnem dla braku działającego użytkownika (kolejność hooków).
  // Wiersze pochodnego feedu nie znikają po przeczytaniu (zmienia się tylko
  // styl), więc porównanie id wystarcza — żaden efekt czyszczący nie jest
  // potrzebny.
  const [expandedNotifId, setExpandedNotifId] = useState<string | null>(null);
  // Telefon: stos zamiast siatki. Oba hooki MUSZĄ stać przed wczesnym returnem
  // dla braku użytkownika (kolejność hooków). Zespół startuje zwinięty — na
  // telefonie to najrzadziej potrzebny kafelek.
  const isMobile = useMediaQuery(MOBILE_NAV_QUERY);
  // Hook przed wczesnym returnem (kolejność hooków), jak dwa powyżej.
  const reduceMotion = useReducedMotion();
  const gridVariants = reduceMotion ? dashGridVariantsStill : dashGridVariants;
  const [teamOpen, setTeamOpen] = useState(false);
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

  // Powiadomienia — derived feed (selectors.notificationsForPerson): @-wzmianki
  // i przypisania zadań od innych osób z ostatniego okna. Pochodne, nietrwałe;
  // `now` wstrzykiwany, by selektor był czysty. Cap (max 3) w `visibleNotifications`.
  // Stan „przeczytane" to watermark osoby (MARK_NOTIFICATIONS_SEEN — oznacza
  // całość); wiersz kafelka ROZWIJA podgląd (kto/co/gdzie), a otwarcie encji
  // jest osobną akcją „Otwórz zadanie/projekt" w podglądzie.
  const personNotifications = notificationsForPerson(state, me.id, new Date().toISOString());
  const unreadCount = unreadNotificationCount(personNotifications);
  const markNotificationsSeen = () => {
    if (unreadCount > 0) dispatch({ type: 'MARK_NOTIFICATIONS_SEEN' });
  };
  // Mapowanie na wpis wyświetlany (NotificationEntry + `read`): tytuł jest
  // gotowym polskim zdaniem z selektora; nazwy do podglądu rozwiązujemy TU
  // (przy store), żeby wiersz pozostał czystą strukturą displayową.
  const notifications: (NotificationEntry & { read: boolean })[] = personNotifications.map(
    (n) => {
      const task = n.taskId ? state.tasks.find((t) => t.id === n.taskId) : undefined;
      const project =
        n.entityType === 'project'
          ? getProject(state, n.entityId)
          : task
            ? getProject(state, task.projectId)
            : undefined;
      const target =
        n.taskId !== ''
          ? ({ kind: 'task', taskId: n.taskId } as const)
          : ({ kind: 'project', projectId: n.entityId } as const);
      return {
        id: n.id,
        title: n.title,
        when: formatTimestamp(n.createdAt),
        target,
        preview: {
          who: n.actorName,
          what: task ? task.title : (project?.name ?? '—'),
          where: project?.name ?? '—',
        },
        openLabel: target.kind === 'task' ? 'Otwórz zadanie' : 'Otwórz projekt',
        read: n.read,
      };
    },
  );
  const shownNotifications = visibleNotifications(notifications);

  // Otwarcie popoutu JEST potwierdzeniem wpisu — zapisujemy je urządzeniowo,
  // więc pasek „Nowości" nie wraca po przeładowaniu.
  const openChangelog = (): void => {
    setChangelogOpen(true);
    if (!latestChange) return;
    setChangelogSeenId(latestChange.id);
    updateUiPrefs({ changelogSeenId: latestChange.id });
  };

  // Otwarcie encji z podglądu: feed jest pochodny (watermark), więc „przeczytane"
  // oznacza się w całości; potem zadanie w modalu albo projekt przez route.
  const openNotification = (entry: NotificationEntry): void => {
    markNotificationsSeen();
    const target = entry.target;
    if (target?.kind === 'task') openTask(target.taskId);
    else if (target?.kind === 'project') navigate(`/projects/${target.projectId}`);
  };

  // Workload donuts (today + this week) — both read the authoritative
  // availability selectors so a booked zero-availability day stays dangerous.
  const week = weekDays(today);
  // Pasek tygodnia (desktop): dni robocze mają pełne kolumny, weekend schodzi do
  // dwóch belek 24 px (AT-19). Podział idzie przez `isWeekend`, nie przez indeks,
  // więc zmiana pierwszego dnia tygodnia niczego tu nie psuje.
  const weekdays = week.filter((d) => !isWeekend(d));
  const weekendDays = week.filter(isWeekend);
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

  // ——— Kafelki wspólne dla obu układów ———————————————————————————————
  // JEDNO źródło JSX-a dla siatki (desktop) i stosu (telefon); różni je tylko
  // `className`, więc zmiana mobilna nie może po cichu przestawić desktopu.
  // Kotwice `data-tour` (onboarding, src/onboarding/catalog.ts) siedzą wewnątrz.

  /** Pusty kafelek zwijalny: belka ~40 px zamiast karty na cały rząd (OP-01).
   *  Kotwica `data-tour` zostaje tu TAKA SAMA jak w wersji pełnej — onboarding
   *  szuka jej niezależnie od tego, czy kafelek ma treść. */
  const renderCollapsedTile = (
    className: string,
    id: CollapsibleTileId,
    label: string,
    tour?: string,
  ) => (
    <m.div
      className={`${className} dash-card-bar`}
      variants={dashCardVariants}
      data-tour={tour}
      data-tile={id}
    >
      <h2 className="dash-card-bar-title">{label}</h2>
    </m.div>
  );

  const notificationsView = dashTileView('notifications', shownNotifications.length > 0);
  const alertsView = dashTileView('alerts', !noAlerts);

  const renderNotificationsTile = (className: string) =>
    notificationsView.collapsed ? (
      renderCollapsedTile(className, 'notifications', notificationsView.label)
    ) : (
      <m.div className={className} variants={dashCardVariants}>
        <div className="dash-card-head">
          <h2>
            {notificationsView.label}
            {unreadCount > 0 && (
              <span className="dash-badge" aria-label={`${unreadCount} nieprzeczytanych`}>
                {unreadCount}
              </span>
            )}
          </h2>
          {unreadCount > 0 && (
            <button type="button" className="link-btn" onClick={markNotificationsSeen}>
              Oznacz jako przeczytane
            </button>
          )}
        </div>
        <ul className="dash-list">
          {shownNotifications.map((n) => {
            const expanded = expandedNotifId === n.id;
            const previewId = `notif-preview-${n.id}`;
            return (
              <li key={n.id}>
                <div className="dash-notif-row">
                  <button
                    type="button"
                    className={`dash-row dash-notif-open${n.read ? '' : ' is-unread'}`}
                    aria-expanded={expanded}
                    aria-controls={previewId}
                    onClick={() => setExpandedNotifId((id) => (id === n.id ? null : n.id))}
                  >
                    {!n.read && <span className="dash-unread-dot" aria-hidden="true" />}
                    <span className="dash-row-name">{n.title}</span>
                    {n.when && <span className="dash-row-when">{n.when}</span>}
                  </button>
                </div>
                {expanded && (
                  <div className="dash-notif-preview" id={previewId}>
                    <p className="dash-notif-line">
                      <span className="dash-notif-label">Kto:</span> {n.preview.who}
                    </p>
                    <p className="dash-notif-line">
                      <span className="dash-notif-label">Co:</span> {n.preview.what}
                    </p>
                    <p className="dash-notif-line">
                      <span className="dash-notif-label">Gdzie:</span> {n.preview.where}
                    </p>
                    {n.preview.body && <p className="dash-notif-body">{n.preview.body}</p>}
                    {n.openLabel && (
                      <button
                        type="button"
                        className="btn ghost dash-notif-openbtn"
                        onClick={() => openNotification(n)}
                      >
                        {n.openLabel}
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </m.div>
    );

  const renderTodayTile = (className: string) => (
    <m.div className={className} variants={dashCardVariants} data-tour="home.today">
      <h2>Zadania na dziś</h2>
      <TodayAgendaList personId={me.id} date={today} />
    </m.div>
  );

  /** Sama lista zespołu; `id` istnieje wyłącznie na telefonie (aria-controls). */
  const renderTeamRoster = (id?: string) => (
    <ul className="chat-people" id={id}>
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
  );

  const renderBinTile = (className: string) => (
    <m.div className={className} variants={dashCardVariants} data-tour="home.bin">
      <h2>Zasobnik (nierozplanowane)</h2>
      {binRows.length === 0 ? (
        <p className="muted">Zasobnik jest pusty.</p>
      ) : (
        <ul className="dash-list agenda-list">
          {binRows.map(({ task, hours }) => (
            <li key={task.id}>
              <button type="button" className="dash-row" onClick={() => openTask(task.id)}>
                <span className="dash-row-name">{task.title}</span>
                <span className="agenda-meta">{taskMeta(task)}</span>
                {/* Stan rozplanowania jako pasek, nie pigułka — ta sama reguła
                    co na liście zadań i karcie projektu. */}
                <PlanningProgress
                  planned={taskPlannedTotal(state, task.id)}
                  estimate={task.estimatedHours ?? null}
                  status={taskPlanningStatus(state, task.id)}
                  showHours={false}
                />
                <span className="my-work-hours">{formatDuration(hours)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {/* AT-19: prawdziwy przycisk akcentowy (≥36 px) z KONKRETEM — „Zaplanuj 2h
       *  — <tytuł>" dla pierwszego wiersza zasobnika; przy pustym zasobniku
       *  zostaje etykieta ogólna. Cel („/calendar") bez zmian. */}
      <div className="dash-card-foot">
        <Link to="/calendar" className="btn primary dash-plan-cta">
          {binPlanCtaLabel(
            binRows[0] ? { title: binRows[0].task.title, hours: binRows[0].hours } : undefined,
          )}{' '}
          →
        </Link>
      </div>
    </m.div>
  );

  const renderAlertsTile = (className: string) =>
    alertsView.collapsed ? (
      renderCollapsedTile(className, 'alerts', alertsView.label, 'home.alerts')
    ) : (
      <m.div className={className} variants={dashCardVariants} data-tour="home.alerts">
        <h2>{alertsView.label}</h2>
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
      </m.div>
    );

  // ——— Stos telefonu ————————————————————————————————————————————————
  // Flagi liczone TYLKO na telefonie (desktop nie płaci za selektor agendy).
  // `todayAgendaForPerson` to dokładnie to, czym karmi się `TodayAgendaList`,
  // więc „pusty kafelek" znaczy tu to samo, co pusty stan w kafelku.
  const mobileAgenda = isMobile ? todayAgendaForPerson(state, me.id, today) : null;
  const mobileTiles: DashTileId[] = isMobile
    ? mobileDashboardOrder({
        hasToday: (mobileAgenda?.timed.length ?? 0) + (mobileAgenda?.dateless.length ?? 0) > 0,
        hasAlerts: !noAlerts,
        hasNotifications: shownNotifications.length > 0,
        hasBin: binRows.length > 0,
        hasCoworkers: coworkers.length > 0,
      })
    : [];

  // Godziny do linii podsumowania biorą się z TYCH SAMYCH selektorów co
  // pierścienie — żadnej nowej wartości nigdzie nie zapisujemy (niezmiennik 1).
  const todaySegment: WorkloadSegment = {
    booked: todayAvail.bookedHours,
    available: todayAvail.availableHours,
    over: isOverloaded(
      todayAvail.bookedHours,
      todayAvail.availableHours,
      todayAvail.overbooked ? [today] : [],
    ),
  };
  const weekSegment: WorkloadSegment = {
    booked: weekAvail.bookedHours,
    available: weekAvail.availableHours,
    over: isOverloaded(weekAvail.bookedHours, weekAvail.availableHours, weekAvail.overbookedDates),
  };

  const renderMobileTile = (id: DashTileId) => {
    switch (id) {
      case 'today':
        return renderTodayTile('dash-card');
      case 'alerts':
        return renderAlertsTile('dash-card');
      case 'notifications':
        return renderNotificationsTile('dash-card');
      case 'bin':
        return renderBinTile('dash-card');
      case 'workload':
        // Jedna linia zamiast dwóch pierścieni — na telefonie liczy się fakt
        // „ile z ilu", nie wykres.
        return (
          <m.div className="dash-card dash-m-workload" variants={dashCardVariants}>
            <h2>Obciążenie</h2>
            <p
              className={`dash-m-workload-line${
                todaySegment.over || weekSegment.over ? ' over' : ''
              }`}
            >
              {workloadSummaryLine(todaySegment, weekSegment)}
            </p>
          </m.div>
        );
      case 'week':
        // Siedem pigułek: dzień + suma godzin (bez zera). Pigułki są czysto
        // informacyjne — nawigację niesie link „Otwórz kalendarz".
        return (
          <m.div className="dash-card dash-m-week" variants={dashCardVariants}>
            <div className="dash-card-head">
              <h2>Twój tydzień</h2>
              <Link to="/calendar" className="link-btn">
                Otwórz kalendarz →
              </Link>
            </div>
            <div className="dash-m-week-pills">
              {week.map((d) => {
                const hours = (weekMap.get(d) ?? []).reduce((sum, w) => sum + w.plannedHours, 0);
                return (
                  <div
                    key={d}
                    className={`dash-m-pill${isTodayStr(d) ? ' is-today' : ''}`}
                  >
                    <span className="dash-m-pill-dow">{weekdayHeader(d)}</span>
                    <span className="dash-m-pill-num">{dayNumber(d)}</span>
                    {hours > 0 && (
                      <span className="dash-m-pill-hours">{formatDuration(hours)}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </m.div>
        );
      case 'team':
        // Zwinięty domyślnie; `data-tour="home.workload"` zostaje na karcie
        // zespołu (tak jak na desktopie — onboarding tego szuka).
        return (
          <m.div
            className="dash-card dash-m-team"
            variants={dashCardVariants}
            data-tour="home.workload"
          >
            <h2 className="dash-m-team-title">
              <button
                type="button"
                className="dash-m-team-toggle"
                aria-expanded={teamOpen}
                aria-controls="dash-m-team-roster"
                onClick={() => setTeamOpen((open) => !open)}
              >
                <span>{teamHeaderLabel(coworkers.length)}</span>
                <span className="dash-m-team-chev" aria-hidden>
                  {teamOpen ? '▾' : '▸'}
                </span>
              </button>
            </h2>
            {teamOpen && renderTeamRoster('dash-m-team-roster')}
          </m.div>
        );
    }
  };

  return (
    <section className="page">
      <div className="page-head dash-greeting">
        <h1>Dzień dobry, {me.firstName}</h1>
        <p className="dash-date">{formatRowLabel(today)}</p>
      </div>

      {/* Dziennik zmian: JEDNA linia, JEDNO CTA, bez akcentowej ramki — i tylko
       *  dopóki najnowszy wpis jest nieprzeczytany na tym urządzeniu (AT-17).
       *  Pierwszym elementem treści Panelu jest „Zadania na dziś", nie to. */}
      {latestChange && changelogUnread(latestChange, changelogSeenId) && (
        <div className="changelog-line">
          <button type="button" className="link-btn changelog-line-cta" onClick={openChangelog}>
            {changelogCtaLabel(latestChange)} →
          </button>
        </div>
      )}

      <ChangelogModal open={changelogOpen} onClose={() => setChangelogOpen(false)} />

      {/* Telefon: stos kafelków w kolejności z `mobileDashboardOrder`; puste
       *  kafelki NIE trafiają do DOM-u. Poza tym ta sama treść co niżej. */}
      {isMobile && (
        <m.div
          className="dash-m-stack"
          variants={gridVariants}
          initial="hidden"
          animate="show"
        >
          {mobileTiles.map((id) => (
            <Fragment key={id}>{renderMobileTile(id)}</Fragment>
          ))}
        </m.div>
      )}

      {/* Desktop: siatka BEZ ZMIAN. Wcięcie zostawione celowo, żeby diff
       *  pokazywał wyłącznie opakowanie warunkiem i podmianę kafelków na
       *  wywołania tych samych funkcji (ten sam DOM). */}
      {!isMobile && (
      <m.div
        className="dash-grid dash-welcome-grid"
        variants={gridVariants}
        initial="hidden"
        animate="show"
      >
        {/* RZĄD 1 · Zadania na dziś — PIERWSZY element treści Panelu (AT-17).
         *  Keep data-tour="home.today" (onboarding queries it,
         *  src/onboarding/catalog.ts). */}
        {renderTodayTile('dash-card dash-area-today')}

        {/* RZĄD 1 · Workload summary (compact, narrow column) */}
        <m.div className="dash-card dash-area-workload" variants={dashCardVariants}>
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
        </m.div>

        {/* RZĄD 2 · Powiadomienia — pochodny feed (@-wzmianki + przypisania,
         *  max 3, kropka + badge dla nieprzeczytanych). Klik w wiersz ROZWIJA
         *  podgląd (kto/co/gdzie) i NICZEGO nie dispatchuje; otwarcie obiektu
         *  (z oznaczeniem watermarku „przeczytane") to osobny przycisk „Otwórz
         *  zadanie/projekt" w podglądzie; nagłówek ma „Oznacz jako przeczytane".
         *  PUSTY kafelek kurczy się do belki (OP-01), nie zajmuje całego rzędu. */}
        {renderNotificationsTile('dash-card dash-area-notifications')}

        {/* RZĄD 2 · Team roster — realne dane zespołu, bez atrap czatu/obecności.
         *  Keep data-tour="home.workload" on this card. Max 4 rows visible; the
         *  rest scroll inside the tile (see `.chat-people`). */}
        <m.div
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
            renderTeamRoster()
          )}
        </m.div>

        {/* RZĄD 3 · Week strip (full width). AT-19: dni robocze dostają całą
         *  szerokość (wpisy ZAWIJAJĄ się do dwóch linii zamiast się urywać),
         *  a weekend kurczy się do dwóch belek 24 px w wąskiej kolumnie obok.
         *  „+N więcej" prowadzi do TEGO dnia w kalendarzu. */}
        <m.div className="dash-card dash-area-week" variants={dashCardVariants}>
          <div className="dash-card-head">
            <h2>Twój tydzień</h2>
            <Link to="/calendar" className="link-btn">
              Otwórz kalendarz →
            </Link>
          </div>
          <div className="week-strip">
            {weekdays.map((d) => {
              const blocks = weekMap.get(d) ?? [];
              const shown = blocks.slice(0, MAX_DAY_BLOCKS);
              const extra = blocks.length - shown.length;
              const classes = ['week-strip-day', isTodayStr(d) ? 'is-today' : '']
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
                      {extra > 0 && (
                        <li>
                          <Link to={calendarDayTarget(d)} className="week-strip-more">
                            +{extra} więcej
                          </Link>
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              );
            })}
            {weekendDays.length > 0 && (
              <div className="week-strip-weekend">
                {weekendDays.map((d) => {
                  const hours = (weekMap.get(d) ?? []).reduce((sum, w) => sum + w.plannedHours, 0);
                  return (
                    <Link
                      key={d}
                      to={calendarDayTarget(d)}
                      className={`week-strip-wknd${isTodayStr(d) ? ' is-today' : ''}`}
                    >
                      <span className="week-strip-wknd-day">
                        {weekdayHeader(d)} {dayNumber(d)}
                      </span>
                      <span className="week-strip-wknd-hours">
                        {hours > 0 ? formatDuration(hours) : '—'}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </m.div>

        {/* RZĄD 4 · Zasobnik (nierozplanowane) — task-level rows for hours
         *  assigned to me but without a day/time. Keep data-tour="home.bin"
         *  (onboarding queries it, src/onboarding/catalog.ts). Clicking a row
         *  opens the task modal; the planning badge stays. */}
        {renderBinTile('dash-card dash-area-bin')}

        {/* RZĄD 4 · Alerty — overdue tasks, over-capacity days and work with no
         *  plan. Keep data-tour="home.alerts" (onboarding queries it, także na
         *  zwiniętej belce). */}
        {renderAlertsTile('dash-card dash-area-alerts')}
      </m.div>
      )}
    </section>
  );
}
