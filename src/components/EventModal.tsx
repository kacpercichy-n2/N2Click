// Modal wydarzenia / spotkania. Wzorzec DOKŁADNIE jak TaskModal/TicketModal:
// overlay sterowany parametrem `?wydarzenie=new` / `?wydarzenie=<id>`, montowany
// RAZ na poziomie App, zamknięcie usuwa parametr i zostawia resztę URL-a
// nietkniętą. Prefill (data/godzina/osoba) przychodzi rozłącznymi parametrami
// `wydarzenieData` / `wydarzenieStart` / `wydarzenieOsoba`, żeby nie kolidować z
// prefillem TaskModala (`date`/`assignee`).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { useStore } from '../store/AppStore';
import { useCan } from '../store/useCan';
import type { EventDraft } from '../store/AppStore';
import { isValidEventDraft } from '../store/commandValidation';
import type { CalendarEvent } from '../types';
import { isValidDateStr, todayStr, WEEKDAY_LABELS } from '../utils/dates';
import { MINUTE_STEP } from '../utils/time';
import { isoWeekday } from '../utils/recurrence';
import { normalizeProjectDocumentUrl } from '../utils/projectDocuments';
import { bypassNavGuardOnce, clearNavGuard, setNavGuard } from '../utils/dirtyRegistry';

/** Parametr URL-a niosący modal wydarzenia (polski, jak reszta tras). */
const EVENT_PARAM = 'wydarzenie';
const PREFILL_DATE = 'wydarzenieData';
const PREFILL_START = 'wydarzenieStart';
const PREFILL_OSOBA = 'wydarzenieOsoba';

/** "HH:MM" <-> minuty od północy (siatka 15 min). */
function timeToMinutes(value: string): number {
  const [h, m] = value.split(':');
  return Number(h) * 60 + Number(m);
}
function minutesToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Wspólny opener. Dokłada parametr wydarzenia do BIEŻĄCEJ lokalizacji, więc
 * strona pod spodem nigdy się nie zmienia (jak useOpenTask/useOpenTicket).
 */
export function useOpenEvent() {
  const navigate = useNavigate();
  const location = useLocation();

  const openEvent = useCallback(
    (id: string) => {
      const params = new URLSearchParams(location.search);
      params.set(EVENT_PARAM, id);
      // Prefill dotyczy tylko tworzenia — nie przecieka na istniejące wydarzenie.
      params.delete(PREFILL_DATE);
      params.delete(PREFILL_START);
      params.delete(PREFILL_OSOBA);
      navigate({ pathname: location.pathname, search: params.toString() });
    },
    [navigate, location.pathname, location.search],
  );

  const openNewEvent = useCallback(
    (prefill?: { date?: string; startMinutes?: number; personId?: string }) => {
      const params = new URLSearchParams(location.search);
      params.set(EVENT_PARAM, 'new');
      if (prefill?.date) params.set(PREFILL_DATE, prefill.date);
      else params.delete(PREFILL_DATE);
      if (prefill?.startMinutes !== undefined) {
        params.set(PREFILL_START, String(prefill.startMinutes));
      } else params.delete(PREFILL_START);
      if (prefill?.personId) params.set(PREFILL_OSOBA, prefill.personId);
      else params.delete(PREFILL_OSOBA);
      navigate({ pathname: location.pathname, search: params.toString() });
    },
    [navigate, location.pathname, location.search],
  );

  return { openEvent, openNewEvent };
}

/** Punkt montowania na poziomie App. Widoczny tylko przy ustawionym parametrze. */
export function EventModal() {
  const [searchParams, setSearchParams] = useSearchParams();
  const eventParam = searchParams.get(EVENT_PARAM);
  const prefillDate = searchParams.get(PREFILL_DATE);
  const prefillStart = searchParams.get(PREFILL_START);
  const prefillOsoba = searchParams.get(PREFILL_OSOBA);

  const close = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(EVENT_PARAM);
        next.delete(PREFILL_DATE);
        next.delete(PREFILL_START);
        next.delete(PREFILL_OSOBA);
        return next;
      },
      { replace: false },
    );
  }, [setSearchParams]);

  return (
    <AnimatePresence>
      {eventParam !== null && (
        <EventModalShell
          key="event-modal"
          eventParam={eventParam}
          prefill={{ date: prefillDate, start: prefillStart, osoba: prefillOsoba }}
          onClose={close}
        />
      )}
    </AnimatePresence>
  );
}

interface ShellProps {
  eventParam: string;
  prefill: { date: string | null; start: string | null; osoba: string | null };
  onClose: () => void;
}

function EventModalShell({ eventParam, prefill, onClose }: ShellProps) {
  const { state, dispatch } = useStore();
  const can = useCan();
  const canManage = can('events.manage');
  const isNew = eventParam === 'new';
  const existing = isNew ? undefined : state.events.find((e) => e.id === eventParam);
  const notFound = !isNew && existing === undefined;

  const dirtyRef = useRef(false);
  const navGuardKey = useRef<object>({});
  const handleDirtyChange = useCallback((d: boolean) => {
    dirtyRef.current = d;
    setNavGuard(navGuardKey.current, 'event-modal', d);
  }, []);
  useEffect(() => {
    const key = navGuardKey.current;
    return () => clearNavGuard(key);
  }, []);

  const closeDeliberately = useCallback(() => {
    bypassNavGuardOnce();
    onClose();
  }, [onClose]);

  const requestClose = useCallback(() => {
    if (dirtyRef.current && !window.confirm('Masz niezapisane zmiany. Zamknąć bez zapisywania?')) {
      return;
    }
    closeDeliberately();
  }, [closeDeliberately]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [requestClose]);

  const handleDelete = () => {
    if (!existing || !canManage) return;
    if (window.confirm(`Usunąć wydarzenie „${existing.title}”?`)) {
      dispatch({ type: 'DELETE_EVENT', eventId: existing.id });
      closeDeliberately();
    }
  };

  const heading = notFound
    ? 'Nie znaleziono wydarzenia'
    : isNew
      ? 'Nowe wydarzenie'
      : canManage
        ? 'Edytuj wydarzenie'
        : 'Wydarzenie';

  return (
    <>
      <motion.div
        className="task-modal-scrim"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
      />
      <div className="task-modal-viewport" onClick={requestClose}>
        <motion.div
          className="task-modal-card ticket-modal-card"
          role="dialog"
          aria-modal="true"
          aria-label={heading}
          onClick={(e) => e.stopPropagation()}
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="task-modal-head">
            <h1 className="task-modal-title">{heading}</h1>
            <div className="task-modal-head-actions">
              {existing && canManage && (
                <button type="button" className="btn danger-ghost" onClick={handleDelete}>
                  Usuń
                </button>
              )}
              <button
                type="button"
                className="task-modal-close"
                onClick={requestClose}
                aria-label="Zamknij"
              >
                ×
              </button>
            </div>
          </div>
          <div className="task-modal-body">
            {notFound ? (
              <div className="empty-state">
                <p className="empty-title">Nie znaleziono wydarzenia</p>
                <p className="empty-hint">
                  Wydarzenie mogło zostać usunięte albo link jest nieaktualny.
                </p>
                <button type="button" className="btn primary" onClick={onClose}>
                  Zamknij
                </button>
              </div>
            ) : (
              <EventEditor
                key={eventParam}
                existing={existing}
                canManage={canManage}
                prefill={prefill}
                onDirtyChange={handleDirtyChange}
                onSaved={closeDeliberately}
                onCancel={requestClose}
              />
            )}
          </div>
        </motion.div>
      </div>
    </>
  );
}

interface EditorProps {
  existing: CalendarEvent | undefined;
  canManage: boolean;
  prefill: { date: string | null; start: string | null; osoba: string | null };
  onDirtyChange: (dirty: boolean) => void;
  onSaved: () => void;
  onCancel: () => void;
}

interface FieldErrors {
  title?: string;
  date?: string;
  time?: string;
  meetingUrl?: string;
  form?: string;
}

/** Zaokrągla minuty do najbliższej wielokrotności siatki 15 min (ręcznie
 *  wpisany czas jak 09:10 trafia na 09:15 — `step={900}` sam tego nie wymusza). */
function snapToGrid(min: number): number {
  return Math.round(min / MINUTE_STEP) * MINUTE_STEP;
}

function EventEditor({
  existing,
  canManage,
  prefill,
  onDirtyChange,
  onSaved,
  onCancel,
}: EditorProps) {
  const { state, dispatch } = useStore();
  const readOnly = !canManage;

  const seedDate =
    existing?.date ??
    (prefill.date && isValidDateStr(prefill.date) ? prefill.date : todayStr());
  const seedStart =
    existing?.startMinutes ??
    (prefill.start !== null && Number.isFinite(Number(prefill.start))
      ? Number(prefill.start)
      : 540);
  const seedEnd = existing
    ? existing.startMinutes + existing.durationMinutes
    : Math.min(seedStart + 60, 1440);
  const seedAttendees =
    existing?.attendeeIds ?? (prefill.osoba ? [prefill.osoba] : []);

  const [title, setTitle] = useState(existing?.title ?? '');
  const [date, setDate] = useState(seedDate);
  const [startTime, setStartTime] = useState(minutesToTime(seedStart));
  const [endTime, setEndTime] = useState(minutesToTime(seedEnd));
  const [attendeeIds, setAttendeeIds] = useState<string[]>(seedAttendees);
  const [meetingUrl, setMeetingUrl] = useState(existing?.meetingUrl ?? '');
  const [location, setLocation] = useState(existing?.location ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [recurring, setRecurring] = useState(existing?.recurrence !== undefined);
  const [recurDays, setRecurDays] = useState<number[]>(existing?.recurrence?.daysOfWeek ?? []);
  const [until, setUntil] = useState(existing?.recurrence?.until ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});

  const markDirty = () => onDirtyChange(true);

  // Dzień tygodnia kotwicy jest ZAWSZE zaznaczony i nieodznaczalny (baza reguły
  // musi być własnym wystąpieniem — inaczej reduktor odrzuca cykliczność).
  const anchorIso = isValidDateStr(date) ? isoWeekday(date) : 0;

  const toggleDay = (iso: number) => {
    if (iso === anchorIso) return; // baza nieodznaczalna
    setRecurDays((prev) =>
      prev.includes(iso) ? prev.filter((d) => d !== iso) : [...prev, iso],
    );
    markDirty();
  };

  const toggleAttendee = (personId: string) => {
    setAttendeeIds((prev) =>
      prev.includes(personId) ? prev.filter((id) => id !== personId) : [...prev, personId],
    );
    markDirty();
  };

  const sortedPeople = useMemo(
    () => [...state.people].sort((a, b) => a.name.localeCompare(b.name)),
    [state.people],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly) return;
    const next: FieldErrors = {};
    if (title.trim() === '') next.title = 'Tytuł jest wymagany.';
    if (!isValidDateStr(date)) next.date = 'Podaj poprawną datę.';
    // Snap ręcznie wpisanych czasów na siatkę 15 min PRZED zbudowaniem draftu —
    // `step={900}` nie blokuje ręcznego 09:10, a reduktor odrzuciłby taki czas.
    const startMinutes = snapToGrid(timeToMinutes(startTime));
    const endMinutes = snapToGrid(timeToMinutes(endTime));
    if (
      !Number.isFinite(startMinutes) ||
      !Number.isFinite(endMinutes) ||
      endMinutes <= startMinutes
    ) {
      next.time = 'Koniec musi być późniejszy niż początek.';
    }
    if (meetingUrl.trim() !== '' && normalizeProjectDocumentUrl(meetingUrl) === null) {
      next.meetingUrl = 'Adres musi zaczynać się od http(s):// .';
    }
    if (Object.values(next).some((v) => v !== undefined)) {
      setErrors(next);
      return;
    }

    const durationMinutes = endMinutes - startMinutes;
    // Dzień kotwicy zawsze w regule; UI nie tworzy wyjątków (brak menu wystąpień).
    const daysOfWeek = recurring
      ? Array.from(new Set([...recurDays, anchorIso])).sort((a, b) => a - b)
      : [];
    const recurrence = recurring
      ? {
          daysOfWeek,
          startMinutes,
          durationMinutes,
          ...(until.trim() !== '' ? { until } : {}),
        }
      : null;

    const draft: EventDraft = {
      title,
      description,
      location,
      meetingUrl,
      date,
      startMinutes,
      durationMinutes,
      attendeeIds,
      recurrence,
    };

    // AUTORYTATYWNA bramka (jedno źródło prawdy z reduktorem): jeśli draft
    // przeszedłby przez kontrole pól, ale i tak zostałby ODRZUCONY przez
    // `normalizeEventDraft` (np. cykliczne „Do" wcześniejsze niż data po zmianie
    // daty), NIE zamykamy modala ani nie czyścimy dirty — inaczej zapis „zniknąłby
    // po cichu". Pokazujemy polski komunikat inline (zasada: nieudany zapis nigdy
    // nie raportuje sukcesu).
    if (!isValidEventDraft(state, draft)) {
      setErrors({
        form: recurring
          ? 'Nie udało się zapisać. Sprawdź cykliczność — „Do" nie może być wcześniejsze niż data wydarzenia.'
          : 'Nie udało się zapisać wydarzenia. Sprawdź wprowadzone dane.',
      });
      return;
    }
    setErrors({});

    onDirtyChange(false);
    if (existing) {
      dispatch({ type: 'SAVE_EVENT', eventId: existing.id, draft });
    } else {
      dispatch({ type: 'ADD_EVENT', draft });
    }
    onSaved();
  };

  return (
    <form className="ticket-form" onSubmit={handleSubmit} noValidate>
      <div className="field">
        <label htmlFor="event-title">Tytuł *</label>
        <input
          id="event-title"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            markDirty();
            if (errors.title) setErrors((x) => ({ ...x, title: undefined }));
          }}
          placeholder="np. Spotkanie z klientem"
          maxLength={300}
          disabled={readOnly}
          aria-invalid={errors.title !== undefined}
        />
        {errors.title && (
          <p className="field-error" role="alert">
            {errors.title}
          </p>
        )}
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="event-date">Data *</label>
          <input
            id="event-date"
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              markDirty();
              if (errors.date) setErrors((x) => ({ ...x, date: undefined }));
            }}
            disabled={readOnly}
            aria-invalid={errors.date !== undefined}
          />
          {errors.date && (
            <p className="field-error" role="alert">
              {errors.date}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor="event-start">Początek *</label>
          <input
            id="event-start"
            type="time"
            step={900}
            value={startTime}
            onChange={(e) => {
              setStartTime(e.target.value);
              markDirty();
              if (errors.time) setErrors((x) => ({ ...x, time: undefined }));
            }}
            disabled={readOnly}
          />
        </div>
        <div className="field">
          <label htmlFor="event-end">Koniec *</label>
          <input
            id="event-end"
            type="time"
            step={900}
            value={endTime}
            onChange={(e) => {
              setEndTime(e.target.value);
              markDirty();
              if (errors.time) setErrors((x) => ({ ...x, time: undefined }));
            }}
            disabled={readOnly}
          />
        </div>
      </div>
      {errors.time && (
        <p className="field-error" role="alert">
          {errors.time}
        </p>
      )}

      <div className="field">
        <label>Osoby</label>
        {sortedPeople.length === 0 ? (
          <p className="field-hint">Brak osób w zespole.</p>
        ) : (
          <div className="event-attendees">
            {sortedPeople.map((p) => (
              <label key={p.id} className="event-attendee-chip">
                <input
                  type="checkbox"
                  checked={attendeeIds.includes(p.id)}
                  onChange={() => toggleAttendee(p.id)}
                  disabled={readOnly}
                />
                <span>{p.name}</span>
              </label>
            ))}
          </div>
        )}
        <p className="field-hint">Bez zaznaczenia wydarzenie jest ogólnofirmowe.</p>
      </div>

      <div className="field">
        <label htmlFor="event-url">Link do spotkania</label>
        <input
          id="event-url"
          value={meetingUrl}
          onChange={(e) => {
            setMeetingUrl(e.target.value);
            markDirty();
            if (errors.meetingUrl) setErrors((x) => ({ ...x, meetingUrl: undefined }));
          }}
          placeholder="np. https://meet.example.com/spotkanie"
          maxLength={2048}
          disabled={readOnly}
          aria-invalid={errors.meetingUrl !== undefined}
        />
        {errors.meetingUrl && (
          <p className="field-error" role="alert">
            {errors.meetingUrl}
          </p>
        )}
      </div>

      <div className="field">
        <label htmlFor="event-location">Biuro / lokalizacja</label>
        <input
          id="event-location"
          value={location}
          onChange={(e) => {
            setLocation(e.target.value);
            markDirty();
          }}
          placeholder="np. Sala konferencyjna, Biuro Warszawa"
          maxLength={300}
          disabled={readOnly}
        />
      </div>

      <div className="field">
        <label htmlFor="event-desc">Opis</label>
        <textarea
          id="event-desc"
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            markDirty();
          }}
          rows={4}
          disabled={readOnly}
        />
      </div>

      <div className="field">
        <label>Cykliczność</label>
        <div className="event-recur-mode">
          <label className="event-radio">
            <input
              type="radio"
              name="event-recur"
              checked={!recurring}
              onChange={() => {
                setRecurring(false);
                markDirty();
              }}
              disabled={readOnly}
            />
            <span>Jednorazowo</span>
          </label>
          <label className="event-radio">
            <input
              type="radio"
              name="event-recur"
              checked={recurring}
              onChange={() => {
                setRecurring(true);
                markDirty();
              }}
              disabled={readOnly}
            />
            <span>Cyklicznie</span>
          </label>
        </div>
        {recurring && (
          <>
            <div className="recur-weekday-picker">
              {WEEKDAY_LABELS.map((label, i) => {
                const iso = i + 1;
                const active = iso === anchorIso || recurDays.includes(iso);
                return (
                  <button
                    key={iso}
                    type="button"
                    className={active ? 'recur-day-chip active' : 'recur-day-chip'}
                    aria-pressed={active}
                    disabled={readOnly || iso === anchorIso}
                    onClick={() => toggleDay(iso)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="field">
              <label htmlFor="event-until">Do (opcjonalnie)</label>
              <input
                id="event-until"
                type="date"
                value={until}
                min={date}
                onChange={(e) => {
                  setUntil(e.target.value);
                  markDirty();
                }}
                disabled={readOnly}
              />
            </div>
            <p className="field-hint">
              Dzień tygodnia daty jest zawsze zaznaczony — to baza wydarzenia.
            </p>
          </>
        )}
      </div>

      {errors.form && (
        <p className="field-error" role="alert">
          {errors.form}
        </p>
      )}

      <div className="form-actions">
        {canManage && (
          <button type="submit" className="btn primary">
            {existing ? 'Zapisz zmiany' : 'Dodaj wydarzenie'}
          </button>
        )}
        <button type="button" className="btn ghost" onClick={onCancel}>
          {canManage ? 'Anuluj' : 'Zamknij'}
        </button>
      </div>
    </form>
  );
}
