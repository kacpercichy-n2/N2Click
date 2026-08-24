// Pole daty z ŁADNYM kalendarzem (popover) — zastępuje natywne
// `<input type="date">` w formularzach wydarzeń (zgłoszenie 2026-08-24:
// czytelne zaznaczanie zakresu urlopu). Zachowanie siatki wg React Aria
// Calendar, klasy stanu zakresu wg react-day-picker — porównanie i świadome
// różnice w nagłówku `dateCalendar.ts`. Powłoka popovera to wspólny
// `useOverlay` (portal, stos Escape, klik na zewnątrz, powrót fokusa).
//
// GRANICE: komponent NIE zna reguł formularza — dostaje `value`/`min`/`max`
// i oddaje wybór przez `onPick` (walidację robi konsument, jak przy blur
// natywnego inputa). Zakres jest tu wyłącznie PODŚWIETLENIEM (`rangeStart`/
// `rangeEnd`) — dwa pola „Od"/„Do" zostają osobnymi kontrolkami, więc kontrakt
// błędów per pole (IA-12) nie zmienia się ani o bajt.
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import {
  calendarDayState,
  calendarWeeks,
  inAnchorMonth,
  initialCalendarAnchor,
  monthAnchorShift,
  resolveCalendarKey,
} from './dateCalendar';
import { OverlayLayer, useOverlay } from './useOverlay';
import { tabbableElementsIn } from './useModalShell';
import {
  dayMonthLabel,
  dayOfMonthLabel,
  formatShortWithWeekday,
  isValidDateStr,
  monthKey,
  monthLabel,
  todayStr,
  WEEKDAY_LABELS,
} from '../utils/dates';
import type { DateStr } from '../types';
import { CalendarDays, ChevronLeft, ChevronRight } from './icons';

export interface DateCalendarFieldProps {
  id: string;
  /** Wybrana data (`yyyy-MM-dd`) albo `''`. */
  value: string;
  /** Wybór z kalendarza (zawsze poprawna data) ALBO surowa wartość natywnego
   *  inputa w wariancie dotykowym — konsument waliduje jak przy blur. */
  onPick: (date: DateStr) => void;
  /** Obecność włącza stopkę „Wyczyść" (puste „Do" = urlop jednodniowy). */
  onClear?: () => void;
  /** Granice wyboru włącznie (`''`/brak = bez granicy). */
  min?: string;
  max?: string;
  /** Podświetlenie zakresu (start..end) — czysto prezentacyjne. */
  rangeStart?: string;
  rangeEnd?: string;
  placeholder?: string;
  disabled?: boolean;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
}

/** Skróty nagłówka dni tygodnia: z globalnej stałej, w porządku pon-nd. */
const DOW = WEEKDAY_LABELS;

/**
 * Urządzenie DOTYKOWE dostaje NATYWNY `<input type="date">` — systemowy picker
 * (koło/kalendarz OS) jest tam lepszy dotykowo niż jakikolwiek własny popover
 * (ta sama bramka `(hover)/(pointer)`, co telefonowe ścieżki czatu). Bramka
 * jest REAKTYWNA (nasłuch `change` na matchMedia), bo hybryda zmienia klasę
 * w trakcie sesji: Surface/iPad z odpinaną klawiaturą przełącza primary
 * pointer między fine a coarse. Hybryda w trybie fine zostaje przy popoverze —
 * jego cele mają 44 px, więc dotknięcie ekranu też trafia.
 */
const COARSE_QUERY = '(hover: none), (pointer: coarse)';

/**
 * Reaktywna klasa wskaźnika + RATUNEK FOKUSA: przełączenie wariantu wymienia
 * kontrolkę w DOM, więc gdy fokus był w tym polu (trigger/natywny input) albo
 * w JEGO popoverze (`data-owner`), po podmianie wraca na nową kontrolkę o tym
 * samym `id` — inaczej spadałby na `body` w środku interakcji.
 */
function useCoarsePointer(id: string): boolean {
  const [coarse, setCoarse] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia(COARSE_QUERY).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(COARSE_QUERY);
    const onChange = () => {
      const active = document.activeElement;
      const inField =
        active instanceof HTMLElement &&
        (active.id === id || active.closest(`[data-owner="${CSS.escape(id)}"]`) !== null);
      setCoarse(mq.matches);
      if (inField) {
        requestAnimationFrame(() => document.getElementById(id)?.focus());
      }
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [id]);
  return coarse;
}

export function DateCalendarField(props: DateCalendarFieldProps) {
  const coarse = useCoarsePointer(props.id);
  if (coarse) return <NativeDateField {...props} />;
  return <CalendarDateField {...props} />;
}

/** Wariant dotykowy: dokładnie ten sam kontrakt, natywna kontrolka systemowa. */
function NativeDateField({
  id,
  value,
  onPick,
  onClear,
  min = '',
  max = '',
  disabled = false,
  'aria-describedby': describedBy,
  'aria-invalid': ariaInvalid,
}: DateCalendarFieldProps) {
  return (
    <input
      type="date"
      id={id}
      value={value}
      {...(min !== '' ? { min } : {})}
      {...(max !== '' ? { max } : {})}
      onChange={(e) => {
        const raw = e.target.value;
        // Wyczyszczenie pola z zakresem = powrót do braku wartości (urlop
        // jednodniowy); bez `onClear` puste przechodzi do walidacji konsumenta.
        if (raw === '' && onClear !== undefined) onClear();
        else onPick(raw);
      }}
      disabled={disabled}
      {...(describedBy !== undefined ? { 'aria-describedby': describedBy } : {})}
      {...(ariaInvalid !== undefined ? { 'aria-invalid': ariaInvalid } : {})}
    />
  );
}

function CalendarDateField({
  id,
  value,
  onPick,
  onClear,
  min = '',
  max = '',
  rangeStart = '',
  rangeEnd = '',
  placeholder = 'Wybierz datę',
  disabled = false,
  'aria-describedby': describedBy,
  'aria-invalid': ariaInvalid,
}: DateCalendarFieldProps) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<DateStr>(() => initialCalendarAnchor('', todayStr()));
  const [focused, setFocused] = useState<DateStr>(todayStr());
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const today = todayStr();

  const overlay = useOverlay({
    open,
    onClose: () => setOpen(false),
    overlayRef: popRef,
    getAnchorRect: () => {
      const el = triggerRef.current;
      return el !== null && el.isConnected ? el.getBoundingClientRect() : null;
    },
    triggerRef,
    offset: 6,
  });

  const openCalendar = () => {
    const seed = value !== '' && isValidDateStr(value) ? value : rangeStart;
    setAnchor(initialCalendarAnchor(seed, today));
    setFocused(seed !== '' && isValidDateStr(seed) ? seed : today);
    setOpen(true);
  };

  // Roving tabindex: po zmianie sfokusowanego dnia (klawiatura) przenosimy
  // fokus DOM-owy na jego przycisk — dokładnie jeden dzień jest w cyklu Tab.
  // `overlay.style` w zależnościach jest KONIECZNE: przed pomiarem popover stoi
  // w `visibility: hidden` (UNMEASURED_STYLE powłoki), a ukrytego elementu nie
  // da się sfokusować — dopiero zmierzony styl ponawia próbę.
  useEffect(() => {
    if (!open) return;
    const cell = popRef.current?.querySelector<HTMLButtonElement>(`[data-date="${focused}"]`);
    cell?.focus();
  }, [open, focused, anchor, overlay.style]);

  const pick = (day: DateStr) => {
    onPick(day);
    setOpen(false);
  };

  const onGridKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = resolveCalendarKey(e.key, focused);
    if (next === null) return;
    e.preventDefault();
    setFocused(next);
    if (monthKey(next) !== monthKey(anchor)) setAnchor(initialCalendarAnchor(next, today));
  };

  // Pułapka Tab w karcie (wzór FilterPanel + wariant „stacked" useModalShell):
  // portal siedzi na końcu `body`, a pole żyje w MODALU, którego własna pułapka
  // (nasłuch na `window`) wyrwałaby fokus z popovera. Dlatego nasłuch idzie w
  // fazie CAPTURE i zatrzymuje propagację — cykl (roving zostawia w nim jedną
  // komórkę siatki) liczymy sami z `tabbableElementsIn`.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const pop = popRef.current;
      if (pop === null) return;
      const elements = tabbableElementsIn(pop);
      if (elements.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const active = document.activeElement;
      const idx = active instanceof HTMLElement ? elements.indexOf(active) : -1;
      const next =
        idx === -1
          ? event.shiftKey
            ? elements.length - 1
            : 0
          : (idx + (event.shiftKey ? -1 : 1) + elements.length) % elements.length;
      elements[next].focus();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open]);

  // Kotwicą zaznaczenia jest POCZĄTEK podświetlanego zakresu (pas rysuje się
  // od niego do `rangeEnd` — koniec wychodzi z `calendarDayState` jako drugi
  // wypełniony koniec). Pole bez zakresu zaznacza po prostu swoją wartość.
  const ctx = {
    selected: (rangeStart !== '' && isValidDateStr(rangeStart)
      ? rangeStart
      : value !== '' && isValidDateStr(value)
        ? value
        : '') as DateStr | '',
    rangeEnd: (rangeEnd !== '' && isValidDateStr(rangeEnd) ? rangeEnd : '') as DateStr | '',
    min: min as DateStr | '',
    max: max as DateStr | '',
    today,
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        className={`date-field${value === '' ? ' placeholder' : ''}`}
        onClick={() => (open ? setOpen(false) : openCalendar())}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        {...(describedBy !== undefined ? { 'aria-describedby': describedBy } : {})}
        {...(ariaInvalid !== undefined ? { 'aria-invalid': ariaInvalid } : {})}
      >
        <CalendarDays size={15} aria-hidden />
        <span className="date-field-value">
          {value !== '' && isValidDateStr(value) ? formatShortWithWeekday(value) : placeholder}
        </span>
      </button>
      {open && (
        <OverlayLayer>
          <div
            ref={popRef}
            className="date-cal"
            style={overlay.style}
            role="dialog"
            aria-label="Kalendarz"
            data-owner={id}
          >
            <div className="date-cal-head">
              <button
                type="button"
                className="date-cal-nav"
                aria-label="Poprzedni miesiąc"
                onClick={() => setAnchor(monthAnchorShift(anchor, -1))}
              >
                <ChevronLeft size={16} aria-hidden />
              </button>
              {/* aria-live: zmiana miesiąca strzałkami jest ogłaszana. */}
              <span className="date-cal-month" aria-live="polite">
                {monthLabel(anchor)}
              </span>
              <button
                type="button"
                className="date-cal-nav"
                aria-label="Następny miesiąc"
                onClick={() => setAnchor(monthAnchorShift(anchor, 1))}
              >
                <ChevronRight size={16} aria-hidden />
              </button>
            </div>
            <div
              className="date-cal-grid"
              role="grid"
              aria-label={monthLabel(anchor)}
              onKeyDown={onGridKeyDown}
            >
              <div className="date-cal-row" role="row">
                {DOW.map((d) => (
                  <span key={d} className="date-cal-dow" role="columnheader" aria-label={d}>
                    {d}
                  </span>
                ))}
              </div>
              {calendarWeeks(anchor).map((week) => (
                <div key={week[0]} className="date-cal-row" role="row">
                  {week.map((day) => {
                    const s = calendarDayState(day, ctx);
                    const cls = [
                      'date-cal-day',
                      inAnchorMonth(day, anchor) ? '' : 'outside',
                      s.isToday ? 'today' : '',
                      s.isSelected ? 'selected' : '',
                      s.isRangeStart ? 'range-start' : '',
                      s.isRangeEnd ? 'range-end' : '',
                      s.isRangeMiddle ? 'range-middle' : '',
                    ]
                      .filter(Boolean)
                      .join(' ');
                    return (
                      <button
                        key={day}
                        type="button"
                        role="gridcell"
                        className={cls}
                        data-date={day}
                        tabIndex={day === focused ? 0 : -1}
                        aria-selected={s.isSelected || s.isRangeMiddle}
                        aria-disabled={s.disabled}
                        aria-label={dayMonthLabel(day)}
                        onClick={s.disabled ? undefined : () => pick(day)}
                        onFocus={() => setFocused(day)}
                      >
                        {dayOfMonthLabel(day)}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="date-cal-foot">
              <button
                type="button"
                className="date-cal-foot-btn"
                onClick={() => {
                  setAnchor(initialCalendarAnchor(today, today));
                  setFocused(today);
                }}
              >
                Dziś
              </button>
              {onClear !== undefined && value !== '' && (
                <button
                  type="button"
                  className="date-cal-foot-btn"
                  onClick={() => {
                    onClear();
                    setOpen(false);
                  }}
                >
                  Wyczyść
                </button>
              )}
            </div>
          </div>
        </OverlayLayer>
      )}
    </>
  );
}
