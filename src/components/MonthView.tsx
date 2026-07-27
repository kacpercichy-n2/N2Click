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
  calendarEventsForDate,
  dayTotal,
  entriesForDate,
  overloadedPeopleOnDate,
  peopleWithBirthdayOnDate,
  recurrenceOccurrencesForDate,
} from '../store/selectors';
import { personColor } from '../utils/colors';
import { formatDuration } from '../utils/time';
import { Tooltip } from './Tooltip';

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

          // Cykliczne zadania na dany dzień — TYLKO prezentacyjny znacznik ⟳
          // (MonthView nie renderuje pojedynczych bloków); sumy/kropki bez zmian.
          const recurTitles = Array.from(
            new Set(recurrenceOccurrencesForDate(state, d, filter).map((r) => r.task.title)),
          );

          // Wydarzenia na dany dzień — TYLKO prezentacyjny znacznik 📅
          // (MonthView nie renderuje pojedynczych bloków); sumy/kropki bez zmian.
          const eventTitles = Array.from(
            new Set(calendarEventsForDate(state, d, filter).map((oc) => oc.event.title)),
          );
          // Przesuwaj kolejne znaczniki inline o 18 px, żeby się nie nakładały.
          const eventMarkerRight = 3 + 18 * ((birthdayNames.length > 0 ? 1 : 0) + (recurTitles.length > 0 ? 1 : 0));

          // Dymek komórki ZBIERA to, co dotąd wisiało na pojedynczych
          // znacznikach: same znaczniki są nieinteraktywne (nie da się na nie
          // najechać sensownie w 18-pikselowym rogu), więc hover musi je
          // pokazywać z poziomu klikalnej komórki. Dla czytnika ekranu treść
          // niesie `aria-label` znaczników (wchodzi do nazwy przycisku), dlatego
          // dymek jest CZYSTO WIZUALNY — inaczej każda nazwa czytałaby się dwa
          // razy. `.tooltip-text` ma `white-space: pre-line`, więc łamiemy \n.
          const cellHint = [
            total > 0 ? `zaplanowano ${formatDuration(total)}` : 'Brak pracy',
            birthdayNames.length > 0 ? `Urodziny: ${birthdayNames.join(', ')}` : '',
            recurTitles.length > 0 ? `Cykliczne: ${recurTitles.join(', ')}` : '',
            eventTitles.length > 0 ? `Wydarzenia: ${eventTitles.join(', ')}` : '',
          ]
            .filter(Boolean)
            .join('\n');

          return (
            <Tooltip key={d} text={cellHint} visualOnly>
              <button
                type="button"
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
              >
                <span className="month-cell-num">{dayNumber(d)}</span>
                {birthdayNames.length > 0 && (
                  <span
                    className="month-cell-birthday"
                    aria-label={`Urodziny: ${birthdayNames.join(', ')}`}
                  >
                    🎂
                  </span>
                )}
                {recurTitles.length > 0 && (
                  <span
                    className="month-cell-recur"
                    style={birthdayNames.length > 0 ? { right: 18 } : undefined}
                    aria-label={`Cykliczne: ${recurTitles.join(', ')}`}
                  >
                    ⟳
                  </span>
                )}
                {eventTitles.length > 0 && (
                  <span
                    className="month-cell-event"
                    style={eventMarkerRight > 3 ? { right: eventMarkerRight } : undefined}
                    aria-label={`Wydarzenia: ${eventTitles.join(', ')}`}
                  >
                    📅
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
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
