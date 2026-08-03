// Month view: classic Mon-first grid. Each cell shows the date, filtered total
// hours, a background intensity scaled by hours, up to ~4 person dots (+n), and
// a red border if anyone is over 8h. Clicking a day drills into its Week view.
//
// Siatka jest siatką WPROST (APG grid): `role="grid"` + wiersz nagłówków dni
// tygodnia + jeden wędrujący `tabindex`, a klawiaturę obsługuje czysty
// `monthGrid.ts` (strzałki/Home/End po komórkach, PageUp/PageDown po
// miesiącach i latach). Kotwica miesiąca mieszka w `CalendarPage`, więc zmiana
// okresu leci do rodzica (`onShiftMonth`/`onShiftYear`) zamiast dublować tu
// matematykę dat.
import { useEffect, useRef, useState } from 'react';
import type { AppData } from '../types';
import {
  dayMonthLabel,
  dayNumber,
  isInMonth,
  isTodayStr,
  monthGridDays,
  shiftMonth,
  WEEKDAY_LABELS,
} from '../utils/dates';
import {
  calendarEventsForDate,
  dayTotal,
  entriesForDate,
  getPerson,
  overloadedPeopleOnDate,
  peopleWithBirthdayOnDate,
  recurrenceOccurrencesForDate,
} from '../store/selectors';
import { personColor } from '../utils/colors';
import { formatDuration } from '../utils/time';
import { TreePalm } from './icons';
import { Tooltip } from './Tooltip';
import { monthCellName, monthFocusIndex, monthGridCommand, monthGridRows } from './monthGrid';

interface Props {
  state: AppData;
  anchor: string; // any date within the target month
  filter: Set<string>;
  onPickDay: (date: string) => void;
  /** ±1 miesiąc (PageUp/PageDown) — przestawia kotwicę w `CalendarPage`. */
  onShiftMonth: (delta: number) => void;
  /** ±1 rok (Shift+PageUp/PageDown) — ta sama kotwica, skok o 12 miesięcy. */
  onShiftYear: (delta: number) => void;
  /** `id` widocznego nagłówka miesiąca — nazwa dostępna siatki. */
  labelId?: string;
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

export function MonthView({
  state,
  anchor,
  filter,
  onPickDay,
  onShiftMonth,
  onShiftYear,
  labelId,
}: Props) {
  const days = monthGridDays(anchor);

  // Wędrujący `tabindex` trzyma DATĘ, nie indeks: po zmianie miesiąca (pasek
  // narzędzi albo PageUp/PageDown) indeksy się przesuwają, a data zostaje
  // sensowna. Gdy zapamiętany dzień wypadnie z siatki, `monthFocusIndex` spada
  // na kotwicę miesiąca — siatka nigdy nie zostaje bez punktu wejścia z Taba.
  const [focusDate, setFocusDate] = useState(anchor);
  const focusIndex = monthFocusIndex(days, focusDate, anchor);
  const cellRefs = useRef(new Map<string, HTMLButtonElement>());
  // Fokus przestawiamy TYLKO po nawigacji z klawiatury (nigdy przy zwykłym
  // renderze), więc kalendarz nie odbija fokusu użytkownikowi w drodze gdzie
  // indziej. Efekt bez listy zależności łapie render PO zmianie miesiąca, gdy
  // docelowy przycisk dopiero pojawia się w DOM.
  const focusPending = useRef(false);
  useEffect(() => {
    if (!focusPending.current) return;
    focusPending.current = false;
    const target = days[focusIndex];
    if (target !== undefined) cellRefs.current.get(target)?.focus();
  });

  const onGridKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.metaKey) return;
    const command = monthGridCommand(
      e.key,
      { shift: e.shiftKey, ctrl: e.ctrlKey },
      focusIndex,
      days.length,
    );
    if (command === null) return;
    e.preventDefault();
    focusPending.current = true;
    if (command.type === 'focus') {
      setFocusDate(days[command.index]);
      return;
    }
    // Ten sam dzień miesiąca w sąsiednim okresie (APG): kotwica rodzica i
    // fokus jadą o TO SAMO przesunięcie, liczone wspólnym `shiftMonth`.
    const months = command.type === 'shiftYear' ? command.delta * 12 : command.delta;
    setFocusDate(shiftMonth(days[focusIndex] ?? anchor, months));
    if (command.type === 'shiftYear') onShiftYear(command.delta);
    else onShiftMonth(command.delta);
  };

  const cells = days.map((d) => {
    const total = dayTotal(state, d, filter);
    const inMonth = isInMonth(d, anchor);
    const today = isTodayStr(d);
    const overloaded = overloadedPeopleOnDate(state, d, filter).length > 0;
    const step = intensityStep(total);

    // Distinct people who have work that day (within the filter).
    const peopleIds = Array.from(new Set(entriesForDate(state, d, filter).map((e) => e.personId)));
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
    // Urlopy mają WŁASNY znacznik palmy zamiast 📅: to nie jest spotkanie, tylko
    // nieobecność, i tak też czyta się w nazwie komórki.
    const dayEvents = calendarEventsForDate(state, d, filter);
    const eventTitles = Array.from(
      new Set(dayEvents.filter((oc) => oc.event.kind !== 'urlop').map((oc) => oc.event.title)),
    );
    const vacationNames = Array.from(
      new Set(
        dayEvents
          .filter((oc) => oc.event.kind === 'urlop')
          .map((oc) => getPerson(state, oc.event.attendeeIds[0] ?? '')?.name ?? '')
          .filter((n) => n !== ''),
      ),
    );
    // Przesuwaj kolejne znaczniki inline o 18 px, żeby się nie nakładały.
    const eventMarkerRight =
      3 + 18 * ((birthdayNames.length > 0 ? 1 : 0) + (recurTitles.length > 0 ? 1 : 0));
    const vacationMarkerRight = eventMarkerRight + (eventTitles.length > 0 ? 18 : 0);

    const birthdayLabel = birthdayNames.length > 0 ? `Urodziny: ${birthdayNames.join(', ')}` : '';
    const recurLabel = recurTitles.length > 0 ? `Cykliczne: ${recurTitles.join(', ')}` : '';
    const eventLabel = eventTitles.length > 0 ? `Wydarzenia: ${eventTitles.join(', ')}` : '';
    const vacationLabel = vacationNames.length > 0 ? `Urlop: ${vacationNames.join(', ')}` : '';

    // Dymek komórki ZBIERA to, co dotąd wisiało na pojedynczych znacznikach:
    // same znaczniki są nieinteraktywne (nie da się na nie najechać sensownie w
    // 18-pikselowym rogu), więc hover musi je pokazywać z poziomu klikalnej
    // komórki. Treść niesie teraz `aria-label` całej komórki, dlatego dymek jest
    // CZYSTO WIZUALNY — inaczej wszystko czytałoby się dwa razy.
    // `.tooltip-text` ma `white-space: pre-line`, więc łamiemy \n.
    const cellHint = [
      total > 0 ? `zaplanowano ${formatDuration(total)}` : 'Brak pracy',
      birthdayLabel,
      recurLabel,
      eventLabel,
      vacationLabel,
    ]
      .filter(Boolean)
      .join('\n');

    // Nazwa dostępna niesie CAŁĄ treść komórki (data, godziny, osoby, znaczniki),
    // bo `aria-label` przykrywa dzieci przycisku — dlatego znaczniki niżej są
    // `aria-hidden` i nic nie czyta się dwa razy.
    const name = monthCellName({
      dayLabel: dayMonthLabel(d),
      hours: total,
      peopleCount: peopleIds.length,
      today,
      outOfMonth: !inMonth,
      overloaded,
      markers: [birthdayLabel, recurLabel, eventLabel, vacationLabel],
    });

    return {
      date: d,
      total,
      inMonth,
      today,
      overloaded,
      step,
      shown,
      extra,
      peopleCount: peopleIds.length,
      birthdayNames,
      recurTitles,
      eventTitles,
      vacationNames,
      birthdayLabel,
      recurLabel,
      eventLabel,
      vacationLabel,
      eventMarkerRight,
      vacationMarkerRight,
      cellHint,
      name,
    };
  });

  return (
    <div
      className="month-grid-wrap"
      role="grid"
      aria-labelledby={labelId}
      onKeyDown={onGridKeyDown}
    >
      <div className="month-weekday-row" role="row">
        {WEEKDAY_LABELS.map((w) => (
          <div key={w} className="month-weekday" role="columnheader">
            {w}
          </div>
        ))}
      </div>
      <div className="month-grid" role="rowgroup">
        {monthGridRows(cells).map((week) => (
          // `.month-week-row` ma `display: contents` — wiersz istnieje w drzewie
          // dostępności (APG wymaga `row`), a układ siatki CSS zostaje bez zmian.
          <div key={`row-${week[0].date}`} className="month-week-row" role="row">
            {week.map((cell) => (
              // Komórka i przycisk to DWA węzły: `role="gridcell"` na samym
              // `<button>` przykryłby jego rolę i dzień przestałby się
              // ogłaszać jako klikalny. Opakowanie ma `display: contents` (jak
              // wiersz wyżej), więc układ siatki CSS zostaje bez zmian, a
              // `Tooltip` nadal klonuje DOKŁADNIE jedno dziecko — przycisk.
              <div key={cell.date} className="month-cell-slot" role="gridcell">
                <Tooltip text={cell.cellHint} visualOnly>
                <button
                  type="button"
                  ref={(node) => {
                    if (node === null) cellRefs.current.delete(cell.date);
                    else cellRefs.current.set(cell.date, node);
                  }}
                  className={[
                    'month-cell',
                    `intensity-${cell.step}`,
                    cell.inMonth ? '' : 'out-month',
                    cell.today ? 'today' : '',
                    cell.overloaded ? 'overloaded' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  aria-label={cell.name}
                  // Jeden punkt wejścia z Taba; resztą siatki chodzą strzałki.
                  tabIndex={cell.date === days[focusIndex] ? 0 : -1}
                  onFocus={() => setFocusDate(cell.date)}
                  onClick={() => onPickDay(cell.date)}
                >
                  <span className="month-cell-num">{dayNumber(cell.date)}</span>
                  {cell.birthdayNames.length > 0 && (
                    <span className="month-cell-birthday" aria-hidden>
                      🎂
                    </span>
                  )}
                  {cell.recurTitles.length > 0 && (
                    <span
                      className="month-cell-recur"
                      style={cell.birthdayNames.length > 0 ? { right: 18 } : undefined}
                      aria-hidden
                    >
                      ⟳
                    </span>
                  )}
                  {cell.eventTitles.length > 0 && (
                    <span
                      className="month-cell-event"
                      style={cell.eventMarkerRight > 3 ? { right: cell.eventMarkerRight } : undefined}
                      aria-hidden
                    >
                      📅
                    </span>
                  )}
                  {cell.vacationNames.length > 0 && (
                    <span
                      className="month-cell-vacation"
                      style={
                        cell.vacationMarkerRight > 3
                          ? { right: cell.vacationMarkerRight }
                          : undefined
                      }
                      aria-hidden
                    >
                      <TreePalm size={12} />
                    </span>
                  )}
                  {cell.total > 0 && (
                    <span className="month-cell-hours">{formatDuration(cell.total)}</span>
                  )}
                  {cell.peopleCount > 0 && (
                    <span className="month-cell-dots">
                      {cell.shown.map((id) => (
                        <span
                          key={id}
                          className="person-dot"
                          style={{ background: personColor(id) }}
                          aria-hidden
                        />
                      ))}
                      {cell.extra > 0 && <span className="month-cell-extra">+{cell.extra}</span>}
                    </span>
                  )}
                </button>
                </Tooltip>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
