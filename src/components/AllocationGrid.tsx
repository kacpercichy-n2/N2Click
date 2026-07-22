// The core allocation UI: rows = each calendar day in the period, columns = one
// per assigned person, cells = editable planned-hours inputs. Overload tinting
// uses the person's TOTAL across all tasks for that date.
import { memo, useMemo } from 'react';
import type { AppData, Person } from '../types';
import { personColor } from '../utils/colors';
import {
  eachDayInclusive,
  formatRowLabel,
  isWeekend,
} from '../utils/dates';
import { availableHoursOnDate, hoursForPersonOnDate } from '../store/selectors';
import { formatDuration } from '../utils/time';

/** allocations keyed as `${personId}|${date}` -> hours. */
export type AllocMap = Record<string, number>;

export function allocKey(personId: string, date: string): string {
  return `${personId}|${date}`;
}

interface Props {
  state: AppData; // for cross-task overload lookups
  currentTaskId: string | null; // to exclude this task's saved entries from base
  startDate: string;
  endDate: string;
  people: Person[]; // assigned people (columns)
  allocations: AllocMap; // current in-editor values
  blockCounts?: Record<string, number>; // allocKey -> # of dated blocks behind the cell
  onChange: (personId: string, date: string, hours: number) => void;
  onFillWeekdays: (personId: string) => void;
  onClearPerson: (personId: string) => void;
  readOnly?: boolean; // gate: disable inputs + hide fill/clear when the role can't manage tasks
}

// Memoized: the grid runs per-cell availability/overload scans on every render,
// so with stable props (the TaskModal editor passes memoized allocations/people
// and useCallback handlers) typing elsewhere in the editor no longer re-renders
// or rescans it.
export const AllocationGrid = memo(function AllocationGrid({
  state,
  currentTaskId,
  startDate,
  endDate,
  people,
  allocations,
  blockCounts,
  onChange,
  onFillWeekdays,
  onClearPerson,
  readOnly = false,
}: Props) {
  const days = useMemo(
    () => eachDayInclusive(startDate, endDate),
    [startDate, endDate],
  );

  // Base hours = each person's total on a date from OTHER tasks (exclude the
  // task currently being edited so live edits reflect the true daily total).
  const baseHoursFor = (personId: string, date: string): number => {
    const all = hoursForPersonOnDate(state, personId, date);
    if (currentTaskId === null) return all;
    const thisTask = state.workload
      .filter(
        (w) =>
          w.taskId === currentTaskId &&
          w.personId === personId &&
          w.date === date,
      )
      .reduce((s, w) => s + w.plannedHours, 0);
    return all - thisTask;
  };

  const cellValue = (personId: string, date: string): number =>
    allocations[allocKey(personId, date)] ?? 0;

  const personTotal = (personId: string): number =>
    days.reduce((sum, d) => sum + cellValue(personId, d), 0);

  const dayTotalAcross = (date: string): number =>
    people.reduce((sum, p) => sum + cellValue(p.id, date), 0);

  const grandTotal = people.reduce((sum, p) => sum + personTotal(p.id), 0);

  return (
    <div className="alloc-wrap">
      <table className="alloc-grid">
        <thead>
          <tr>
            <th className="alloc-day-col">Dzień</th>
            {people.map((p) => (
              <th key={p.id} className="alloc-person-col">
                <div className="alloc-person-head">
                  <span
                    className="person-dot"
                    style={{ background: personColor(p.id) }}
                    aria-hidden
                  />
                  <span className="alloc-person-name">{p.name}</span>
                </div>
                {!readOnly && (
                  <div className="alloc-person-actions">
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => onFillWeekdays(p.id)}
                      title="Wypełnij dni robocze osoby jej dzienną dostępnością"
                    >
                      Wypełnij dni robocze
                    </button>
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => onClearPerson(p.id)}
                      title="Ustaw wszystkie komórki na 0"
                    >
                      Wyczyść
                    </button>
                  </div>
                )}
              </th>
            ))}
            <th className="alloc-total-col">Suma dnia</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => {
            const weekend = isWeekend(d);
            return (
              <tr key={d} className={weekend ? 'alloc-weekend' : undefined}>
                <th scope="row" className="alloc-day-label">
                  {formatRowLabel(d)}
                </th>
                {people.map((p) => {
                  const value = cellValue(p.id, d);
                  const dayTotalForPerson = baseHoursFor(p.id, d) + value;
                  // Warn against the DAY's availability (0 on the person's day
                  // off), matching every other surface. Warn-only — deliberate
                  // TaskModal allocations may exceed it (invariant 3).
                  const dayAvailable = availableHoursOnDate(state, p.id, d);
                  const overloaded = dayTotalForPerson > dayAvailable;
                  const count = blockCounts?.[allocKey(p.id, d)] ?? 0;
                  const multi = count >= 2;
                  const overloadTitle = overloaded
                    ? `${p.name}: ${formatDuration(dayTotalForPerson)} łącznie tego dnia przy ${formatDuration(dayAvailable)} dostępności`
                    : undefined;
                  const multiTitle = multi
                    ? `Bloki w kalendarzu: ${count}. Edycja sumy wydłuży ostatni blok lub skróci bloki od końca; 0 usunie wszystkie.`
                    : undefined;
                  const cellTitle =
                    [overloadTitle, multiTitle].filter(Boolean).join('\n') || undefined;
                  return (
                    <td
                      key={p.id}
                      className={overloaded ? 'alloc-cell overload' : 'alloc-cell'}
                      title={cellTitle}
                    >
                      <input
                        type="number"
                        min={0}
                        max={24}
                        step={0.25}
                        className="alloc-input"
                        value={value === 0 ? '' : value}
                        placeholder="0"
                        disabled={readOnly}
                        title={readOnly ? 'Brak uprawnień' : undefined}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const n = raw === '' ? 0 : Number(raw);
                          if (Number.isNaN(n)) return;
                          const clamped = Math.max(0, Math.min(24, n));
                          onChange(p.id, d, clamped);
                        }}
                      />
                      {multi && <span className="alloc-multi">×{count}</span>}
                    </td>
                  );
                })}
                <td className="alloc-total-col">{formatDuration(dayTotalAcross(d))}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className="alloc-day-label">
              Suma osoby
            </th>
            {people.map((p) => (
              <td key={p.id} className="alloc-person-total">
                {formatDuration(personTotal(p.id))}
              </td>
            ))}
            <td className="alloc-grand-total">{formatDuration(grandTotal)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
});
