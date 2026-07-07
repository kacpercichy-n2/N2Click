// The core allocation UI: rows = each calendar day in the period, columns = one
// per assigned person, cells = editable planned-hours inputs. Overload tinting
// uses the person's TOTAL across all tasks for that date.
import { useMemo } from 'react';
import type { AppData, Person } from '../types';
import { personColor } from '../utils/colors';
import {
  eachDayInclusive,
  formatRowLabel,
  isWeekend,
  parseDate,
} from '../utils/dates';
import { hoursForPersonOnDate, personCapacity } from '../store/selectors';

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
  onChange: (personId: string, date: string, hours: number) => void;
  onFillWeekdays: (personId: string) => void;
  onClearPerson: (personId: string) => void;
}

export function AllocationGrid({
  state,
  currentTaskId,
  startDate,
  endDate,
  people,
  allocations,
  onChange,
  onFillWeekdays,
  onClearPerson,
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
                <div className="alloc-person-actions">
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => onFillWeekdays(p.id)}
                    title="Ustaw 8h we wszystkie dni robocze"
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
                  const overloaded = dayTotalForPerson > personCapacity(state, p.id);
                  return (
                    <td
                      key={p.id}
                      className={overloaded ? 'alloc-cell overload' : 'alloc-cell'}
                      title={
                        overloaded
                          ? `${p.name}: ${dayTotalForPerson}h łącznie tego dnia`
                          : undefined
                      }
                    >
                      <input
                        type="number"
                        min={0}
                        max={24}
                        step={0.5}
                        className="alloc-input"
                        value={value === 0 ? '' : value}
                        placeholder="0"
                        onChange={(e) => {
                          const raw = e.target.value;
                          const n = raw === '' ? 0 : Number(raw);
                          if (Number.isNaN(n)) return;
                          const clamped = Math.max(0, Math.min(24, n));
                          onChange(p.id, d, clamped);
                        }}
                      />
                    </td>
                  );
                })}
                <td className="alloc-total-col">{fmt(dayTotalAcross(d))}</td>
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
                {fmt(personTotal(p.id))}h
              </td>
            ))}
            <td className="alloc-grand-total">{fmt(grandTotal)}h</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function fmt(n: number): string {
  // Trim trailing .0 for whole numbers.
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/** Weekday check reused by the "Fill weekdays" action in the editor page. */
export function isWeekdayDate(date: string): boolean {
  const day = parseDate(date).getDay();
  return day >= 1 && day <= 5;
}
