// Week view: 7 columns Mon–Sun. Under each header, the filtered day total and
// an overload marker naming anyone over 8h. Day body lists one block per
// (task, person, entry); clicking a block opens that task's editor.
import { useNavigate } from 'react-router-dom';
import type { AppData } from '../types';
import { personColor } from '../utils/colors';
import {
  isTodayStr,
  isWeekend,
  parseDate,
  weekDays,
} from '../utils/dates';
import { format } from 'date-fns';
import {
  dayTotal,
  entriesForDate,
  getPerson,
  getTask,
  overloadedPeopleOnDate,
} from '../store/selectors';

interface Props {
  state: AppData;
  anchor: string; // any date within the week to render
  filter: Set<string>;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

export function WeekView({ state, anchor, filter }: Props) {
  const navigate = useNavigate();
  const days = weekDays(anchor);

  return (
    <div className="week-grid">
      {days.map((d) => {
        const total = dayTotal(state, d, filter);
        const overloadedIds = overloadedPeopleOnDate(state, d, filter);
        const entries = entriesForDate(state, d, filter);
        const today = isTodayStr(d);
        const weekend = isWeekend(d);
        const empty = entries.length === 0;

        const overloadNames = overloadedIds
          .map((id) => getPerson(state, id)?.name)
          .filter(Boolean)
          .join(', ');

        return (
          <div
            key={d}
            className={[
              'week-col',
              today ? 'today' : '',
              weekend ? 'weekend' : '',
              empty ? 'empty' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <div className="week-col-head">
              <div className="week-col-weekday">{format(parseDate(d), 'EEE')}</div>
              <div className="week-col-date">{format(parseDate(d), 'd MMM')}</div>
              <div className="week-col-total">{empty ? '—' : `${fmt(total)}h`}</div>
              {overloadNames && (
                <div className="week-col-overload" title={`Over 8h: ${overloadNames}`}>
                  ⚠ {overloadNames}
                </div>
              )}
            </div>
            <div className="week-col-body">
              {empty && <div className="week-free">—</div>}
              {entries.map((e) => {
                const task = getTask(state, e.taskId);
                const person = getPerson(state, e.personId);
                if (!task || !person) return null;
                return (
                  <button
                    key={e.id}
                    type="button"
                    className="week-block"
                    style={{ borderLeftColor: personColor(person.id) }}
                    onClick={() => navigate(`/tasks/${task.id}`)}
                    title={`${task.title} — ${person.name}: ${e.plannedHours}h`}
                  >
                    <span className="week-block-title">{task.title}</span>
                    <span className="week-block-meta">
                      <span
                        className="person-dot"
                        style={{ background: personColor(person.id) }}
                        aria-hidden
                      />
                      {person.name}
                      <span className="week-block-hours">{e.plannedHours}h</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
