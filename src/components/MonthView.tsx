// Month view: classic Mon-first grid. Each cell shows the date, filtered total
// hours, a background intensity scaled by hours, up to ~4 person dots (+n), and
// a red border if anyone is over 8h. Clicking a day drills into its Week view.
import type { AppData } from '../types';
import {
  dayNumber,
  isInMonth,
  isTodayStr,
  monthGridDays,
  WEEKDAY_LABELS,
} from '../utils/dates';
import {
  dayTotal,
  entriesForDate,
  overloadedPeopleOnDate,
  peopleWithBirthdayOnDate,
} from '../store/selectors';
import { personColor } from '../utils/colors';
import { formatDuration } from '../utils/time';

interface Props {
  state: AppData;
  anchor: string; // any date within the target month
  filter: Set<string>;
  onPickDay: (date: string) => void;
}

/** Map hours to a 0–4 intensity step for background shading. */
function intensityStep(hours: number): number {
  if (hours <= 0) return 0;
  if (hours <= 4) return 1;
  if (hours <= 8) return 2;
  if (hours <= 16) return 3;
  return 4;
}

const MAX_DOTS = 4;

export function MonthView({ state, anchor, filter, onPickDay }: Props) {
  const days = monthGridDays(anchor);

  return (
    <div className="month-grid-wrap">
      <div className="month-weekday-row">
        {WEEKDAY_LABELS.map((w) => (
          <div key={w} className="month-weekday">
            {w}
          </div>
        ))}
      </div>
      <div className="month-grid">
        {days.map((d) => {
          const total = dayTotal(state, d, filter);
          const inMonth = isInMonth(d, anchor);
          const today = isTodayStr(d);
          const overloaded = overloadedPeopleOnDate(state, d, filter).length > 0;
          const step = intensityStep(total);

          // Distinct people who have work that day (within the filter).
          const peopleIds = Array.from(
            new Set(entriesForDate(state, d, filter).map((e) => e.personId)),
          );
          const shown = peopleIds.slice(0, MAX_DOTS);
          const extra = peopleIds.length - shown.length;

          // Urodziny (miesiąc+dzień) — cały zespół, niezależnie od filtra pracy.
          const birthdayNames = peopleWithBirthdayOnDate(state, d).map((p) => p.name);

          return (
            <button
              type="button"
              key={d}
              className={[
                'month-cell',
                `intensity-${step}`,
                inMonth ? '' : 'out-month',
                today ? 'today' : '',
                overloaded ? 'overloaded' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => onPickDay(d)}
              title={total > 0 ? `zaplanowano ${formatDuration(total)}` : 'Brak pracy'}
            >
              <span className="month-cell-num">{dayNumber(d)}</span>
              {birthdayNames.length > 0 && (
                <span
                  className="month-cell-birthday"
                  title={`Urodziny: ${birthdayNames.join(', ')}`}
                  aria-label={`Urodziny: ${birthdayNames.join(', ')}`}
                >
                  🎂
                </span>
              )}
              {total > 0 && <span className="month-cell-hours">{formatDuration(total)}</span>}
              {peopleIds.length > 0 && (
                <span className="month-cell-dots">
                  {shown.map((id) => (
                    <span
                      key={id}
                      className="person-dot"
                      style={{ background: personColor(id) }}
                      aria-hidden
                    />
                  ))}
                  {extra > 0 && <span className="month-cell-extra">+{extra}</span>}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
