// Mobilna (≤ 760 px) postać „Dziennego przydziału godzin": pionowa lista dni
// zamiast 480-pikselowej tabeli `AllocationGrid`. To BLIŹNIAK PREZENTACYJNY —
// czyta tę samą mapę `allocations` i zapisuje WYŁĄCZNIE przez te same propsy
// `onChange`/`onChangeStart`/`onFillWeekdays`/`onClearPerson`/`onUndoClear`, co
// tabela, więc godziny nadal płyną jedną ścieżką do `SAVE_TASK` (inwariant 1).
// Tabela desktopowa nie zmienia się ani o bajt; wybór formy robi TaskModal.
//
// Cała arytmetyka (krok 0,25 h, clamp 0–24, odczyt pola z przecinkiem, sumy
// dnia i osoby) siedzi w czystym `allocationDayList.ts`.
import { memo, useId, useState } from 'react';
import type { AppData, Person } from '../types';
import { personColor } from '../utils/colors';
import { eachDayInclusive, formatRowLabel, isWeekend } from '../utils/dates';
import { availableHoursOnDate, hoursForPersonOnDate } from '../store/selectors';
import { formatDuration } from '../utils/time';
import { OverflowMenu } from './OverflowMenu';
import { Tooltip } from './Tooltip';
import { allocKey } from './allocationGridView';
import type { AllocMap, AllocStartMap } from './AllocationGrid';
import {
  allocationDayRows,
  allocationPersonTotals,
  formatAllocationInput,
  parseAllocationInput,
  stepAllocationHours,
} from './allocationDayListView';

// „HH:MM" ↔ minuty od północy dla natywnego `<input type="time" step={900}>` —
// ten sam kształt, co w tabeli (inwariant 2: krok 15 minut).
function hhmm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function toMinutes(value: string): number {
  const [h, m] = value.split(':');
  return Number(h) * 60 + Number(m);
}

interface Props {
  state: AppData; // do odczytu przeciążenia z INNYCH zadań
  currentTaskId: string | null; // wyłączenie własnych wpisów z bazy przeciążenia
  startDate: string;
  endDate: string;
  people: Person[]; // przypisane osoby (przełącznik)
  allocations: AllocMap; // bieżące wartości edytora
  startTimes: AllocStartMap; // opcjonalne przypięte godziny startu
  blockCounts?: Record<string, number>; // allocKey → liczba bloków za komórką
  onChange: (personId: string, date: string, hours: number) => void;
  onChangeStart: (personId: string, date: string, minutes: number | null) => void;
  onFillWeekdays: (personId: string) => void;
  onClearPerson: (personId: string) => void;
  /** AT-13 — osoba, której kolumnę można jeszcze cofnąć po „Wyczyść kolumnę". */
  undoPersonId?: string | null;
  onUndoClear?: (personId: string) => void;
  readOnly?: boolean;
  /** `id` WIDOCZNEJ podpowiedzi o godzinie startu (renderuje ją edytor). */
  startHintId?: string;
}

interface HoursFieldProps {
  value: number;
  label: string;
  disabled: boolean;
  describedBy: string | undefined;
  onCommit: (hours: number) => void;
}

/**
 * Pole godzin steppera. Ma WŁASNY bufor wpisywania, bo wartość kanoniczna
 * przyciąga się do 0,25 przy każdym znaku — bez bufora „1," zamieniłoby się w
 * locie na „1" i nie dałoby się dopisać części ułamkowej. Bufor nigdy nie jest
 * źródłem prawdy: każdy poprawny odczyt natychmiast leci do `onCommit`
 * (czyli do `setCell`), a blur bufor kasuje i pole wraca do wartości z mapy.
 */
function HoursField({ value, label, disabled, describedBy, onCommit }: HoursFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      type="text"
      inputMode="decimal"
      className="alloc-daylist-hours"
      value={draft ?? formatAllocationInput(value)}
      placeholder="—"
      disabled={disabled}
      aria-label={label}
      aria-describedby={describedBy}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        const parsed = parseAllocationInput(raw);
        if (parsed === null) return; // śmieci ignorujemy, bufor zostaje
        onCommit(parsed);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

/**
 * Lista dni okresu. Wiersz dnia pokazuje sumę po WSZYSTKICH osobach; rozwinięty
 * panel edytuje wyłącznie osobę AKTYWNĄ (przełącznik u góry).
 */
export const AllocationDayList = memo(function AllocationDayList({
  state,
  currentTaskId,
  startDate,
  endDate,
  people,
  allocations,
  startTimes,
  blockCounts,
  onChange,
  onChangeStart,
  onFillWeekdays,
  onClearPerson,
  undoPersonId = null,
  onUndoClear,
  readOnly = false,
  startHintId,
}: Props) {
  const listId = useId();
  const readOnlyId = `${listId}-ro`;
  // Wybrana osoba i rozwinięte dni to stan LOKALNY komponentu — kontrakt
  // memoizacji TaskModala zostaje bez zmian (żadnego nowego propsu).
  const [activePersonId, setActivePersonId] = useState<string>('');
  const [expandedDates, setExpandedDates] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  const days = eachDayInclusive(startDate, endDate);
  const personIds = people.map((p) => p.id);
  const rows = allocationDayRows(days, personIds, allocations);
  const personTotals = allocationPersonTotals(rows, personIds);
  // Gdy aktywna osoba wypadnie z przydziału, wracamy do pierwszej — wyliczenie
  // (a nie `setState` w renderze) trzyma to bez dodatkowego przebiegu.
  const active = people.find((p) => p.id === activePersonId) ?? people[0];
  if (active === undefined) return null; // TaskModal i tak renderuje listę dopiero z osobami

  // Baza przeciążenia = godziny osoby tego dnia z INNYCH zadań (te same reguły,
  // co w tabeli — ostrzeżenie, nigdy blokada; inwariant 3).
  const baseHoursFor = (personId: string, date: string): number => {
    const all = hoursForPersonOnDate(state, personId, date);
    if (currentTaskId === null) return all;
    const thisTask = state.workload
      .filter((w) => w.taskId === currentTaskId && w.personId === personId && w.date === date)
      .reduce((s, w) => s + w.plannedHours, 0);
    return all - thisTask;
  };

  const toggleDay = (date: string) => {
    setExpandedDates((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  return (
    <div className="alloc-daylist">
      {readOnly && (
        <span id={readOnlyId} className="sr-only">
          Brak uprawnień do edycji zadań.
        </span>
      )}
      {people.length > 1 && (
        <div className="alloc-daylist-people" role="group" aria-label="Osoba do edycji">
          {people.map((p) => (
            <button
              key={p.id}
              type="button"
              className={['alloc-daylist-person', p.id === active.id ? 'active' : '']
                .filter(Boolean)
                .join(' ')}
              aria-pressed={p.id === active.id}
              onClick={() => setActivePersonId(p.id)}
            >
              <span
                className="person-dot"
                style={{ background: personColor(p.id) }}
                aria-hidden
              />
              {p.name}
            </button>
          ))}
        </div>
      )}
      <div className="alloc-daylist-bar">
        <span className="alloc-daylist-active">
          <span
            className="person-dot"
            style={{ background: personColor(active.id) }}
            aria-hidden
          />
          {active.name}: {formatDuration(personTotals[active.id] ?? 0)}
        </span>
        {!readOnly && (
          <span className="alloc-daylist-actions">
            <Tooltip text="Wypełnij dni robocze osoby jej dzienną dostępnością">
              <button
                type="button"
                className="link-btn"
                onClick={() => onFillWeekdays(active.id)}
              >
                Wypełnij dni robocze
              </button>
            </Tooltip>
            {undoPersonId === active.id && (
              <Tooltip text="Przywróć godziny sprzed wyczyszczenia">
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => onUndoClear?.(active.id)}
                >
                  Cofnij
                </button>
              </Tooltip>
            )}
            <OverflowMenu
              size="sm"
              label={`Więcej działań — ${active.name}`}
              items={[
                {
                  id: 'clear',
                  label: 'Wyczyść kolumnę',
                  onSelect: () => onClearPerson(active.id),
                },
              ]}
            />
          </span>
        )}
      </div>
      <ul className="alloc-daylist-days">
        {rows.map((row) => {
          const open = expandedDates.has(row.date);
          const dayLabel = formatRowLabel(row.date);
          const panelId = `${listId}-${row.date}`;
          const key = allocKey(active.id, row.date);
          const value = row.byPerson[active.id] ?? 0;
          const count = blockCounts?.[key] ?? 0;
          const multi = count >= 2;
          const pinned = startTimes[key];
          const showStart = value > 0 && !multi && !readOnly;
          const personDayTotal = baseHoursFor(active.id, row.date) + value;
          const dayAvailable = availableHoursOnDate(state, active.id, row.date);
          const overloaded = personDayTotal > dayAvailable;
          return (
            <li
              key={row.date}
              data-date={row.date}
              className={[
                'alloc-daylist-day',
                isWeekend(row.date) ? 'weekend' : '',
                open ? 'open' : '',
                row.total > 0 ? 'has-value' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <button
                type="button"
                className="alloc-daylist-row"
                aria-expanded={open}
                aria-controls={open ? panelId : undefined}
                onClick={() => toggleDay(row.date)}
              >
                <span className="alloc-daylist-date">{dayLabel}</span>
                <span className="alloc-daylist-total">
                  {row.total > 0 ? formatDuration(row.total) : '—'}
                </span>
              </button>
              {open && (
                <div id={panelId} className="alloc-daylist-panel">
                  <div
                    className={['alloc-daylist-stepper', overloaded ? 'overload' : '']
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <button
                      type="button"
                      className="alloc-daylist-step"
                      disabled={readOnly || value <= 0}
                      aria-label={`Mniej godzin — ${active.name}, ${dayLabel}`}
                      aria-describedby={readOnly ? readOnlyId : undefined}
                      onClick={() => onChange(active.id, row.date, stepAllocationHours(value, -1))}
                    >
                      −
                    </button>
                    <HoursField
                      value={value}
                      label={`Godziny — ${active.name}, ${dayLabel}`}
                      disabled={readOnly}
                      describedBy={readOnly ? readOnlyId : undefined}
                      onCommit={(hours) => onChange(active.id, row.date, hours)}
                    />
                    <button
                      type="button"
                      className="alloc-daylist-step"
                      disabled={readOnly || value >= 24}
                      aria-label={`Więcej godzin — ${active.name}, ${dayLabel}`}
                      aria-describedby={readOnly ? readOnlyId : undefined}
                      onClick={() => onChange(active.id, row.date, stepAllocationHours(value, 1))}
                    >
                      +
                    </button>
                    {multi && <span className="alloc-daylist-multi">×{count}</span>}
                  </div>
                  {showStart && (
                    <label className="alloc-daylist-start">
                      <span>Godzina startu</span>
                      <input
                        type="time"
                        step={900}
                        className="alloc-daylist-time"
                        value={pinned === undefined ? '' : hhmm(pinned)}
                        aria-describedby={startHintId}
                        onChange={(e) =>
                          onChangeStart(
                            active.id,
                            row.date,
                            e.target.value === '' ? null : toMinutes(e.target.value),
                          )
                        }
                      />
                    </label>
                  )}
                  {multi && (
                    <p className="alloc-daylist-note">
                      Bloki w kalendarzu: {count}. Edycja sumy wydłuży ostatni blok lub skróci
                      bloki od końca; 0 usunie wszystkie.
                    </p>
                  )}
                  {overloaded && (
                    <p className="alloc-daylist-note overload">
                      {active.name}: {formatDuration(personDayTotal)} łącznie tego dnia przy{' '}
                      {formatDuration(dayAvailable)} dostępności.
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
});
