// Modal wydarzenia / spotkania. Wzorzec DOKŁADNIE jak TaskModal/TicketModal:
// overlay sterowany parametrem `?wydarzenie=new` / `?wydarzenie=<id>`, montowany
// RAZ na poziomie App, zamknięcie usuwa parametr i zostawia resztę URL-a
// nietkniętą. Prefill (data/godzina/osoba) przychodzi rozłącznymi parametrami
// `wydarzenieData` / `wydarzenieStart` / `wydarzenieOsoba`, żeby nie kolidować z
// prefillem TaskModala (`date`/`assignee`).
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, m } from 'motion/react';
import { useStore } from '../store/AppStore';
import { useCan } from '../store/useCan';
import { isBoardMember, isEventContentMasked, maskedEventLabel } from '../store/confidentiality';
import type { EventDraft } from '../store/AppStore';
import { isValidEventDraft, MAX_VACATION_DAYS } from '../store/commandValidation';
import { eventDraftConflicts } from '../store/selectors';
import {
  eventConflictBlockingMessage,
  eventConflictWarningMessage,
  recurringConflictWarningMessage,
  vacationDraftWarningMessage,
} from '../utils/eventConflictMessage';
import type { CalendarEvent } from '../types';
import {
  addDaysStr,
  inclusiveDayCount,
  isValidDateStr,
  todayStr,
  WEEKDAY_LABELS,
} from '../utils/dates';
import { DAY_MINUTES, MINUTE_STEP } from '../utils/time';
import { INTERVAL_WEEKS_OPTIONS, intervalWeeksLabel, isoWeekday } from '../utils/recurrence';
import { normalizeProjectDocumentUrl } from '../utils/projectDocuments';
import { personColor } from '../utils/colors';
import { bypassNavGuardOnce, clearNavGuard, setNavGuard } from '../utils/dirtyRegistry';
import { useModalShell } from './useModalShell';
import { useConfirm } from './ConfirmProvider';
import { Field, focusFieldById } from './Field';
import { firstInvalidKey, saveErrorSummary } from './fieldContract';
import { IconButton } from './IconButton';
import { sortByNamePl } from '../utils/collation';
import { X } from './icons';

/** Parametr URL-a niosący modal wydarzenia (polski, jak reszta tras). */
const EVENT_PARAM = 'wydarzenie';
const PREFILL_DATE = 'wydarzenieData';
const PREFILL_START = 'wydarzenieStart';
const PREFILL_OSOBA = 'wydarzenieOsoba';
/** Rodzaj tworzonego wydarzenia: `urlop` przełącza modal w tryb urlopu. */
const PREFILL_RODZAJ = 'wydarzenieRodzaj';

/** Stały tytuł urlopu — modal nie zbiera nazwy, a lista/kalendarz mają czym
 *  nazwać wiersz (reduktor nadal wymaga niepustego tytułu). */
const VACATION_TITLE = 'Urlop';

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
      params.delete(PREFILL_RODZAJ);
      navigate({ pathname: location.pathname, search: params.toString() });
    },
    [navigate, location.pathname, location.search],
  );

  const openNewEvent = useCallback(
    (prefill?: {
      date?: string;
      startMinutes?: number;
      personId?: string;
      kind?: 'urlop';
    }) => {
      const params = new URLSearchParams(location.search);
      params.set(EVENT_PARAM, 'new');
      if (prefill?.date) params.set(PREFILL_DATE, prefill.date);
      else params.delete(PREFILL_DATE);
      if (prefill?.startMinutes !== undefined) {
        params.set(PREFILL_START, String(prefill.startMinutes));
      } else params.delete(PREFILL_START);
      if (prefill?.personId) params.set(PREFILL_OSOBA, prefill.personId);
      else params.delete(PREFILL_OSOBA);
      if (prefill?.kind) params.set(PREFILL_RODZAJ, prefill.kind);
      else params.delete(PREFILL_RODZAJ);
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
  const prefillRodzaj = searchParams.get(PREFILL_RODZAJ);

  const close = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(EVENT_PARAM);
        next.delete(PREFILL_DATE);
        next.delete(PREFILL_START);
        next.delete(PREFILL_OSOBA);
        next.delete(PREFILL_RODZAJ);
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
          prefill={{
            date: prefillDate,
            start: prefillStart,
            osoba: prefillOsoba,
            rodzaj: prefillRodzaj,
          }}
          onClose={close}
        />
      )}
    </AnimatePresence>
  );
}

interface EventPrefill {
  date: string | null;
  start: string | null;
  osoba: string | null;
  rodzaj: string | null;
}

interface ShellProps {
  eventParam: string;
  prefill: EventPrefill;
  onClose: () => void;
}

function EventModalShell({ eventParam, prefill, onClose }: ShellProps) {
  const { state, dispatch } = useStore();
  const confirm = useConfirm();
  const can = useCan();
  const isNew = eventParam === 'new';
  const existing = isNew ? undefined : state.events.find((e) => e.id === eventParam);
  const notFound = !isNew && existing === undefined;
  // Tryb urlopu: nowy z parametru rodzaju albo istniejąca encja z `kind`.
  const isVacation = isNew ? prefill.rodzaj === 'urlop' : existing?.kind === 'urlop';
  // Bramka edycji (D10): spotkaniami rządzi `events.manage`, a WŁASNY urlop
  // edytuje i usuwa jego właściciel (jedyny uczestnik == zalogowany), nawet bez
  // tego uprawnienia. Pozostali widzą tryb tylko do odczytu.
  const ownsVacation =
    isVacation &&
    state.currentUserId !== '' &&
    (isNew
      ? can('events.vacationSelf')
      : existing?.attendeeIds.length === 1 &&
        existing.attendeeIds[0] === state.currentUserId);
  // Utajniona treść bez wglądu widza wygrywa z `events.manage` (maska dotyczy
  // też adminów): tryb tylko-do-odczytu z planszą i samymi faktami
  // planistycznymi. Reguły wglądu: src/store/confidentiality.ts.
  const masked = existing !== undefined && isEventContentMasked(state, existing);
  const canManage = (can('events.manage') || ownsVacation) && !masked;

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

  // Pytanie o porzucenie zmian jest ASYNCHRONICZNE, więc drugie Escape/kliknięcie
  // w trakcie nie może dołożyć drugiego pytania do kolejki.
  const askingRef = useRef(false);
  const requestClose = useCallback(async () => {
    if (askingRef.current) return;
    if (dirtyRef.current) {
      askingRef.current = true;
      const leave = await confirm({
        title: 'Masz niezapisane zmiany.',
        description: 'Zamknąć bez zapisywania?',
        confirmLabel: 'Zamknij bez zapisywania',
        cancelLabel: 'Wróć do edycji',
        // Bez `requireAck`: to porzucenie SZKICU, nie utrata zapisanych danych.
      });
      askingRef.current = false;
      if (!leave) return;
    }
    closeDeliberately();
  }, [closeDeliberately, confirm]);

  // Escape, pułapka fokusa, powrót fokusa i blokada scrolla — wspólna powłoka.
  const titleId = useId();
  const { cardRef, cardProps, viewportProps } = useModalShell({
    onRequestClose: requestClose,
    labelledBy: titleId,
    // Modal z formularzem: tło nie zamyka (Escape i przyciski bez zmian).
    closeOnBackdrop: false,
  });

  const handleDelete = async () => {
    if (!existing || !canManage) return;
    // Cel zapamiętany PRZED `await` — modal może się w międzyczasie przewinąć
    // na inny parametr URL-a. Wydarzenie jest czysto prezentacyjne: nie ciągnie
    // za sobą przypisań ani wierszy `WorkloadEntry` (inwariant 1), więc nie ma
    // skutków do wyliczenia.
    const eventId = existing.id;
    if (
      await confirm({
        title: isVacation ? 'Usunąć ten urlop?' : `Usunąć wydarzenie „${existing.title}”?`,
        confirmLabel: isVacation ? 'Usuń urlop' : 'Usuń wydarzenie',
        tone: 'danger',
      })
    ) {
      dispatch({ type: 'DELETE_EVENT', eventId });
      closeDeliberately();
    }
  };

  const heading = notFound
    ? 'Nie znaleziono wydarzenia'
    : masked
      ? maskedEventLabel(state, existing.id)
      : isVacation
        ? isNew
          ? 'Nowy urlop'
          : canManage
            ? 'Edytuj urlop'
            : 'Urlop'
        : isNew
          ? 'Nowe wydarzenie'
          : canManage
            ? 'Edytuj wydarzenie'
            : 'Wydarzenie';

  return (
    <>
      <m.div
        className="task-modal-scrim"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
      />
      <div className="task-modal-viewport" {...viewportProps}>
        <m.div
          ref={cardRef}
          className="task-modal-card event-modal-card"
          {...cardProps}
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="task-modal-head">
            <h1 className="task-modal-title" id={titleId}>
              {heading}
            </h1>
            <div className="task-modal-head-actions">
              {existing && canManage && (
                <button type="button" className="btn danger-ghost" onClick={handleDelete}>
                  Usuń
                </button>
              )}
              <IconButton
                className="task-modal-close"
                icon={<X size={18} aria-hidden />}
                onClick={requestClose}
                label="Zamknij"
              />
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
                contentMasked={masked}
                isVacation={isVacation}
                prefill={prefill}
                onDirtyChange={handleDirtyChange}
                onSaved={closeDeliberately}
                onCancel={requestClose}
              />
            )}
          </div>
        </m.div>
      </div>
    </>
  );
}

interface EditorProps {
  existing: CalendarEvent | undefined;
  canManage: boolean;
  /** Utajniona treść bez wglądu widza: plansza + wyłącznie fakty planistyczne
   *  (data, godziny, uczestnicy) w trybie tylko-do-odczytu. */
  contentMasked: boolean;
  /** Tryb urlopu (D9): inny zestaw pól, stały tytuł i zakres dat zamiast godzin. */
  isVacation: boolean;
  prefill: EventPrefill;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: () => void;
  onCancel: () => void;
}

interface FieldErrors {
  title?: string;
  date?: string;
  endDate?: string;
  time?: string;
  meetingUrl?: string;
  form?: string;
}

/**
 * Pola formularza w KOLEJNOŚCI FORMULARZA. Jedno źródło zarówno etykiet do
 * liczonego podsumowania, jak i rozstrzygnięcia „pierwsze złe pole" (fokus po
 * nieudanym zapisie). `form` nie jest polem, więc go tu nie ma.
 */
const EVENT_FIELDS: ReadonlyArray<{ key: keyof FieldErrors; domId: string; label: string }> = [
  { key: 'title', domId: 'event-title', label: 'Tytuł' },
  { key: 'date', domId: 'event-date', label: 'Data' },
  { key: 'time', domId: 'event-start', label: 'Godziny' },
  { key: 'meetingUrl', domId: 'event-url', label: 'Link do spotkania' },
];
const EVENT_FIELD_KEYS = EVENT_FIELDS.map((f) => f.key);

/** Pola trybu urlopu — ten sam kontrakt „pierwsze złe pole", inny zestaw. */
const VACATION_FIELDS: ReadonlyArray<{ key: keyof FieldErrors; domId: string; label: string }> = [
  { key: 'date', domId: 'event-date', label: 'Od' },
  { key: 'endDate', domId: 'event-end-date', label: 'Do' },
];
const VACATION_FIELD_KEYS = VACATION_FIELDS.map((f) => f.key);

/** Zaokrągla minuty do najbliższej wielokrotności siatki 15 min (ręcznie
 *  wpisany czas jak 09:10 trafia na 09:15 — `step={900}` sam tego nie wymusza). */
function snapToGrid(min: number): number {
  return Math.round(min / MINUTE_STEP) * MINUTE_STEP;
}

// Reguły pól — po JEDNEJ czystej funkcji na pole, używanej przez blur, ponowne
// sprawdzenie w trakcie pisania (tylko gdy pole już się czerwieni) ORAZ zapis.
// Trzy ścieżki nie mogą się dzięki temu rozjechać.
function titleRule(value: string): string | undefined {
  return value.trim() === '' ? 'Tytuł jest wymagany.' : undefined;
}
function dateRule(value: string): string | undefined {
  return !isValidDateStr(value) ? 'Podaj poprawną datę.' : undefined;
}
/** Zakres godzin: błąd należy do PARY pól, nie do jednego z nich. */
function timeRule(start: string, end: string): string | undefined {
  const startMinutes = snapToGrid(timeToMinutes(start));
  const endMinutes = snapToGrid(timeToMinutes(end));
  return !Number.isFinite(startMinutes) || !Number.isFinite(endMinutes) || endMinutes <= startMinutes
    ? 'Koniec musi być późniejszy niż początek.'
    : undefined;
}
function meetingUrlRule(value: string): string | undefined {
  return value.trim() !== '' && normalizeProjectDocumentUrl(value) === null
    ? 'Adres musi zaczynać się od http(s):// .'
    : undefined;
}
/** Koniec zakresu urlopu: pusty = jeden dzień; inaczej data >= „Od" i zakres do
 *  {@link MAX_VACATION_DAYS} dni (lustro reguły reduktora, jedno źródło prawdy). */
function vacationEndDateRule(value: string, startDate: string): string | undefined {
  if (value.trim() === '') return undefined;
  if (!isValidDateStr(value)) return 'Podaj poprawną datę.';
  if (!isValidDateStr(startDate)) return undefined; // błąd należy do pola „Od"
  if (value < startDate) return 'Koniec urlopu nie może być wcześniejszy niż początek.';
  if (inclusiveDayCount(startDate, value) > MAX_VACATION_DAYS) {
    return `Urlop może obejmować najwyżej ${MAX_VACATION_DAYS} dni.`;
  }
  return undefined;
}

function EventEditor({
  existing,
  canManage,
  contentMasked,
  isVacation,
  prefill,
  onDirtyChange,
  onSaved,
  onCancel,
}: EditorProps) {
  const { state, dispatch } = useStore();
  const readOnly = !canManage;
  // Utajnij treść (zarząd): checkbox tylko dla zarządu i tylko dla spotkań
  // (urlop nigdy nie niesie flagi). Reduktor ignoruje pole od innych.
  const isBoard = isBoardMember(state);

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
  // Urlop jest zawsze WŁASNY: uczestnika narzuca sesja, a nie wybór z listy
  // (self-only jest bramką UX; reduktor sprawdza tylko strukturę).
  const seedAttendees = isVacation
    ? existing?.attendeeIds ?? (state.currentUserId ? [state.currentUserId] : [])
    : existing?.attendeeIds ?? (prefill.osoba ? [prefill.osoba] : []);

  const [title, setTitle] = useState(existing?.title ?? '');
  const [date, setDate] = useState(seedDate);
  const [endDate, setEndDate] = useState(existing?.endDate ?? '');
  const [startTime, setStartTime] = useState(minutesToTime(seedStart));
  const [endTime, setEndTime] = useState(minutesToTime(seedEnd));
  const [attendeeIds, setAttendeeIds] = useState<string[]>(seedAttendees);
  const [meetingUrl, setMeetingUrl] = useState(existing?.meetingUrl ?? '');
  const [location, setLocation] = useState(existing?.location ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [recurring, setRecurring] = useState(existing?.recurrence !== undefined);
  const [recurDays, setRecurDays] = useState<number[]>(existing?.recurrence?.daysOfWeek ?? []);
  // Interwał „co X tygodni": brak klucza w regule ≡ 1 (co tydzień). Wartość 1
  // NIE trafia z powrotem do modelu (forma kanoniczna zdejmuje ten klucz).
  const [recurInterval, setRecurInterval] = useState(existing?.recurrence?.intervalWeeks ?? 1);
  const [until, setUntil] = useState(existing?.recurrence?.until ?? '');
  const [confidential, setConfidential] = useState(existing?.isConfidential === true);
  const [errors, setErrors] = useState<FieldErrors>({});

  const markDirty = () => onDirtyChange(true);

  /** Zapis wyniku reguły pola (ustawia LUB kasuje komunikat). */
  const setFieldError = (key: keyof FieldErrors, message: string | undefined) => {
    setErrors((x) => (x[key] === message ? x : { ...x, [key]: message }));
  };
  /** Ponowne sprawdzenie w trakcie pisania — TYLKO gdy pole już się czerwieni.
   *  Czyste pole milczy do blur/zapisu, a poprawiony błąd znika natychmiast. */
  const recheckIfErroring = (key: keyof FieldErrors, rule: () => string | undefined) => {
    if (errors[key] !== undefined) setFieldError(key, rule());
  };

  // Dni tygodnia są w pełni odznaczalne. Reduktor nadal wymaga, by baza była
  // własnym wystąpieniem reguły — gdy wybrane dni nie obejmują dnia tygodnia
  // wpisanej daty, zapis przesuwa datę bazową na najbliższy wybrany dzień.
  const toggleDay = (iso: number) => {
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

  const sortedPeople = useMemo(() => sortByNamePl(state.people), [state.people]);

  // Żywe, NIEBLOKUJĄCE ostrzeżenia kolizji. Dwa przypadki bez twardej bramki:
  //  - wydarzenie OGÓLNOFIRMOWE (brak imiennych uczestników) — wolno je zapisać,
  //    chcemy tylko wiedzieć, ilu osób dotknie;
  //  - SERIA CYKLICZNA z imiennymi uczestnikami (2026-08-04) — zajęty pojedynczy
  //    tydzień nie blokuje serii, więc symulacja wystąpień wymienia TERMINY
  //    kolizji („pon 10 sie: Jarek ma w tym dniu urlop") zamiast odrzucać zapis.
  // Jednorazowe wydarzenie z imiennymi uczestnikami zachowuje twardą bramkę na
  // zapisie, więc nie dublujemy go tutaj. Liczone WYŁĄCZNIE dla sensownej daty
  // i zakresu godzin, żeby podpowiedź nie migała w trakcie pisania w polach.
  const conflictWarning = useMemo(() => {
    if (isVacation || !isValidDateStr(date)) return '';
    const from = snapToGrid(timeToMinutes(startTime));
    const to = snapToGrid(timeToMinutes(endTime));
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return '';
    if (recurring && attendeeIds.length > 0) {
      const daysOfWeek = Array.from(new Set(recurDays)).sort((a, b) => a - b);
      if (daysOfWeek.length === 0) return '';
      const report = eventDraftConflicts(
        state,
        {
          date,
          startMinutes: from,
          durationMinutes: to - from,
          attendeeIds,
          recurrence: {
            daysOfWeek,
            startMinutes: from,
            durationMinutes: to - from,
            ...(recurInterval > 1 ? { intervalWeeks: recurInterval } : {}),
            ...(until.trim() !== '' ? { until } : {}),
          },
        },
        existing?.id,
      );
      return recurringConflictWarningMessage(report.warning);
    }
    if (attendeeIds.length > 0) return '';
    const report = eventDraftConflicts(
      state,
      { date, startMinutes: from, durationMinutes: to - from, attendeeIds },
      existing?.id,
    );
    return eventConflictWarningMessage(report.warning);
  }, [
    isVacation,
    state,
    date,
    startTime,
    endTime,
    attendeeIds,
    recurring,
    recurDays,
    recurInterval,
    until,
    existing?.id,
  ]);

  // Żywe ostrzeżenie URLOPU: zapis zawsze przechodzi (próg D4), więc liczy się
  // tylko rozmiar pracy do przeplanowania w CAŁYM zakresie dat. Liczone
  // wyłącznie dla poprawnego zakresu, żeby nie migało w trakcie pisania daty.
  const vacationWarning = useMemo(() => {
    if (!isVacation || !isValidDateStr(date) || attendeeIds.length !== 1) return '';
    if (vacationEndDateRule(endDate, date) !== undefined) return '';
    const last = endDate.trim() === '' || endDate === date ? undefined : endDate;
    const report = eventDraftConflicts(
      state,
      {
        date,
        startMinutes: 0,
        durationMinutes: DAY_MINUTES,
        attendeeIds,
        kind: 'urlop',
        ...(last ? { endDate: last } : {}),
      },
      existing?.id,
    );
    return vacationDraftWarningMessage(report.warning);
  }, [isVacation, state, date, endDate, attendeeIds, existing?.id]);

  /** Zapis URLOPU: własna, krótka ścieżka (dwa pola + opis). Reguła zakresu jest
   *  lustrem reduktora, więc odrzucony draft nie zamyka modala po cichu. */
  const submitVacation = () => {
    const next: FieldErrors = {};
    next.date = dateRule(date);
    next.endDate = vacationEndDateRule(endDate, date);
    if (attendeeIds.length !== 1) {
      next.form = 'Urlop musi mieć dokładnie jedną osobę. Zaloguj się ponownie.';
    }
    if (Object.values(next).some((v) => v !== undefined)) {
      setErrors(next);
      const firstKey = firstInvalidKey(VACATION_FIELD_KEYS, next);
      const domId = VACATION_FIELDS.find((f) => f.key === firstKey)?.domId;
      if (domId) focusFieldById(domId);
      return;
    }

    const draft: EventDraft = {
      title: VACATION_TITLE,
      description,
      location: '',
      meetingUrl: '',
      date,
      // Czasy niesie forma kanoniczna (pełna doba) — modal ich nie zbiera.
      startMinutes: 0,
      durationMinutes: DAY_MINUTES,
      attendeeIds,
      recurrence: null,
      kind: 'urlop',
      endDate: endDate.trim() === '' ? null : endDate,
    };

    if (!isValidEventDraft(state, draft)) {
      setErrors({ form: 'Nie udało się zapisać urlopu. Sprawdź zakres dat.' });
      return;
    }
    setErrors({});
    onDirtyChange(false);
    if (existing) dispatch({ type: 'SAVE_EVENT', eventId: existing.id, draft });
    else dispatch({ type: 'ADD_EVENT', draft });
    onSaved();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly) return;
    if (isVacation) {
      submitVacation();
      return;
    }
    const next: FieldErrors = {};
    next.title = titleRule(title);
    next.date = dateRule(date);
    next.time = timeRule(startTime, endTime);
    next.meetingUrl = meetingUrlRule(meetingUrl);
    // Snap ręcznie wpisanych czasów na siatkę 15 min PRZED zbudowaniem draftu —
    // `step={900}` nie blokuje ręcznego 09:10, a reduktor odrzuciłby taki czas.
    const startMinutes = snapToGrid(timeToMinutes(startTime));
    const endMinutes = snapToGrid(timeToMinutes(endTime));
    // Dni tygodnia są w pełni odznaczalne, więc pusty wybór blokuje zapis
    // (reguły pól tego nie łapią — to warunek formularza, nie pojedynczego pola).
    if (recurring && recurDays.length === 0) {
      next.form = 'Wybierz przynajmniej jeden dzień tygodnia cykliczności.';
    }
    if (Object.values(next).some((v) => v !== undefined)) {
      setErrors(next);
      // Nieudany zapis MUSI mieć skutek: fokus + przewinięcie do pierwszego
      // złego pola (błąd zakresu godzin celuje w pole początku).
      const firstKey = firstInvalidKey(EVENT_FIELD_KEYS, next);
      const domId = EVENT_FIELDS.find((f) => f.key === firstKey)?.domId;
      if (domId) focusFieldById(domId);
      return;
    }

    const durationMinutes = endMinutes - startMinutes;
    // UI nie tworzy wyjątków (brak menu wystąpień).
    const daysOfWeek = recurring
      ? Array.from(new Set(recurDays)).sort((a, b) => a - b)
      : [];
    // Reduktor wymaga, by baza była własnym wystąpieniem reguły — gdy wybrane
    // dni nie obejmują dnia tygodnia wpisanej daty, przesuwamy datę bazową na
    // najbliższy wybrany dzień (np. środa + wybór wt/czw => czwartek).
    let effectiveDate = date;
    if (recurring && !daysOfWeek.includes(isoWeekday(date))) {
      for (let i = 1; i <= 6; i++) {
        const candidate = addDaysStr(date, i);
        if (daysOfWeek.includes(isoWeekday(candidate))) {
          effectiveDate = candidate;
          break;
        }
      }
    }
    const recurrence = recurring
      ? {
          daysOfWeek,
          startMinutes,
          durationMinutes,
          ...(recurInterval > 1 ? { intervalWeeks: recurInterval } : {}),
          ...(until.trim() !== '' ? { until } : {}),
        }
      : null;

    const draft: EventDraft = {
      title,
      description,
      location,
      meetingUrl,
      date: effectiveDate,
      startMinutes,
      durationMinutes,
      attendeeIds,
      recurrence,
      // Utajnienie idzie w draftcie tylko od zarządu — brak klucza znaczy
      // „zachowaj stan wydarzenia" (reduktor i tak ignoruje pole od innych).
      ...(isBoard ? { isConfidential: confidential } : {}),
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
          ? 'Nie udało się zapisać. Sprawdź cykliczność — „Do" nie może być wcześniejsze niż pierwsze wystąpienie wydarzenia.'
          : 'Nie udało się zapisać wydarzenia. Sprawdź wprowadzone dane.',
      });
      return;
    }

    // Kolizja terminu — LUSTRO bramki reduktora (`ADD_EVENT`/`SAVE_EVENT` zwracają
    // tę samą referencję stanu). Bez tego zapis „zniknąłby po cichu": modal by się
    // zamknął, a wydarzenia by nie było. Blokują wyłącznie kolizje uczestników
    // IMIENNYCH; ogólnofirmowe wracają jako `warning` i lecą do żywej podpowiedzi
    // niżej, nie tutaj.
    // `EventDraft.recurrence` jest celowo luźne (`unknown | null` — surówka
    // przed normalizacją reduktora); bramka kolizji dostaje lokalną, ściśle
    // typowaną regułę zbudowaną wyżej.
    const conflicts = eventDraftConflicts(state, { ...draft, recurrence }, existing?.id);
    if (conflicts.blocking.length > 0) {
      setErrors({ form: eventConflictBlockingMessage(conflicts.blocking) });
      focusFieldById('event-start');
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

  // JEDNO ogłaszane podsumowanie na modal: komunikat odrzuconego draftu ma
  // pierwszeństwo (mówi więcej), inaczej liczona lista złych pól.
  const summaryFields = isVacation ? VACATION_FIELDS : EVENT_FIELDS;
  const summaryLabels = summaryFields
    .filter((f) => errors[f.key] !== undefined)
    .map((f) => f.label);
  const summary =
    errors.form ??
    (summaryLabels.length > 0
      ? saveErrorSummary(
          isVacation ? 'Nie można zapisać urlopu' : 'Nie można zapisać wydarzenia',
          summaryLabels,
        )
      : null);

  // ---- Tryb urlopu: Od / Do / Opis + nieedytowalny wiersz osoby ----
  if (isVacation) {
    const owner = state.people.find((p) => p.id === (attendeeIds[0] ?? ''));
    const isSelf = owner !== undefined && owner.id === state.currentUserId;
    return (
      <form className="ticket-form" onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label>Osoba</label>
          <p className="field-hint">
            {owner ? `${owner.name}${isSelf ? ' (Ty)' : ''}` : 'Nieznana osoba'}
          </p>
        </div>

        <div className="field-row">
          <Field id="event-date" label="Od *" error={errors.date}>
            {(control) => (
              <input
                {...control}
                data-autofocus
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  markDirty();
                  recheckIfErroring('date', () => dateRule(e.target.value));
                  recheckIfErroring('endDate', () =>
                    vacationEndDateRule(endDate, e.target.value),
                  );
                }}
                onBlur={(e) => setFieldError('date', dateRule(e.target.value))}
                disabled={readOnly}
              />
            )}
          </Field>
          <Field id="event-end-date" label="Do" error={errors.endDate}>
            {(control) => (
              <input
                {...control}
                type="date"
                value={endDate}
                min={date}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  markDirty();
                  recheckIfErroring('endDate', () =>
                    vacationEndDateRule(e.target.value, date),
                  );
                }}
                onBlur={(e) => setFieldError('endDate', vacationEndDateRule(e.target.value, date))}
                disabled={readOnly}
              />
            )}
          </Field>
        </div>
        <p className="field-hint">Puste „Do" oznacza urlop jednodniowy. Zajmuje cały dzień.</p>

        {/* Ostrzeżenie, NIE błąd: urlop zapisuje się mimo zaplanowanej pracy. */}
        {vacationWarning !== '' && (
          <p className="event-conflict-warn" role="status">
            ⚠ {vacationWarning}
          </p>
        )}

        <Field id="event-desc" label="Opis">
          {(control) => (
            <textarea
              {...control}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                markDirty();
              }}
              rows={3}
              disabled={readOnly}
            />
          )}
        </Field>

        {summary && (
          <p className="field-error" role="alert">
            {summary}
          </p>
        )}

        <div className="form-actions">
          {canManage && (
            <button type="submit" className="btn primary">
              {existing ? 'Zapisz zmiany' : 'Dodaj urlop'}
            </button>
          )}
          <button type="button" className="btn ghost" onClick={onCancel}>
            {canManage ? 'Anuluj' : 'Zamknij'}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form className="ticket-form" onSubmit={handleSubmit} noValidate>
      {/* Utajniona treść bez wglądu: bursztynowa plansza (informacja, nie błąd);
          niżej zostają wyłącznie fakty planistyczne — data, godziny, osoby. */}
      {contentMasked && (
        <p className="confidential-notice" role="note">
          Treść wydarzenia utajniona. Widoczne są tylko dane planowania: termin, godziny i osoby.
        </p>
      )}
      {!contentMasked && (
        <Field id="event-title" label="Tytuł *" error={errors.title}>
          {(control) => (
            <input
              {...control}
              data-autofocus
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                markDirty();
                recheckIfErroring('title', () => titleRule(e.target.value));
              }}
              onBlur={(e) => setFieldError('title', titleRule(e.target.value))}
              placeholder="np. Spotkanie z klientem"
              maxLength={300}
              disabled={readOnly}
            />
          )}
        </Field>
      )}

      <div className="field-row">
        <Field id="event-date" label="Data *" error={errors.date}>
          {(control) => (
            <input
              {...control}
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                markDirty();
                recheckIfErroring('date', () => dateRule(e.target.value));
              }}
              onBlur={(e) => setFieldError('date', dateRule(e.target.value))}
              disabled={readOnly}
            />
          )}
        </Field>
        {/* Błąd zakresu godzin opisuje OBA pola jednym akapitem (`event-time-error`)
            i oznacza oba jako niepoprawne — żadne z nich nie jest samo w sobie złe. */}
        <Field
          id="event-start"
          label="Początek *"
          invalid={errors.time !== undefined}
          {...(errors.time !== undefined ? { describedByExtra: 'event-time-error' } : {})}
        >
          {(control) => (
            <input
              {...control}
              type="time"
              step={900}
              value={startTime}
              onChange={(e) => {
                setStartTime(e.target.value);
                markDirty();
                recheckIfErroring('time', () => timeRule(e.target.value, endTime));
              }}
              onBlur={(e) => setFieldError('time', timeRule(e.target.value, endTime))}
              disabled={readOnly}
            />
          )}
        </Field>
        <Field
          id="event-end"
          label="Koniec *"
          invalid={errors.time !== undefined}
          {...(errors.time !== undefined ? { describedByExtra: 'event-time-error' } : {})}
        >
          {(control) => (
            <input
              {...control}
              type="time"
              step={900}
              value={endTime}
              onChange={(e) => {
                setEndTime(e.target.value);
                markDirty();
                recheckIfErroring('time', () => timeRule(startTime, e.target.value));
              }}
              onBlur={(e) => setFieldError('time', timeRule(startTime, e.target.value))}
              disabled={readOnly}
            />
          )}
        </Field>
      </div>
      {errors.time && (
        <p className="field-error" id="event-time-error">
          {errors.time}
        </p>
      )}
      {/* Ostrzeżenie, NIE błąd: zapis przechodzi. `role="status"` (nie `alert`),
          żeby czytnik ekranu nie przerywał pisania w polach czasu. */}
      {conflictWarning !== '' && (
        <p className="event-conflict-warn" role="status">
          ⚠ {conflictWarning}
        </p>
      )}

      <div className="field">
        <label>Osoby</label>
        {sortedPeople.length === 0 ? (
          <p className="field-hint">Brak osób w zespole.</p>
        ) : (
          <div className="assignee-picker">
            {sortedPeople.map((p) => {
              const checked = attendeeIds.includes(p.id);
              return (
                <label
                  key={p.id}
                  className={checked ? 'assignee-chip checked' : 'assignee-chip'}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleAttendee(p.id)}
                    disabled={readOnly}
                  />
                  <span
                    className="person-dot"
                    style={{ background: personColor(p.id) }}
                    aria-hidden
                  />
                  {p.name}
                </label>
              );
            })}
          </div>
        )}
        <p className="field-hint">Bez zaznaczenia wydarzenie jest ogólnofirmowe.</p>
      </div>

      {/* Utajnij treść — wyłącznie dla zarządu (reguły wglądu:
          src/store/confidentiality.ts); bramka UX, nie zabezpieczenie. */}
      {isBoard && !contentMasked && (
        <div className="field">
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={confidential}
              onChange={(e) => {
                setConfidential(e.target.checked);
                markDirty();
              }}
              disabled={readOnly}
            />
            <span>Utajnij treść</span>
          </label>
          <p className="field-hint">
            {attendeeIds.length === 0
              ? 'Treść zobaczy tylko zarząd. Bez wskazanych osób nikt inny nie ma wglądu.'
              : 'Treść zobaczy tylko zarząd i wskazane osoby.'}
          </p>
        </div>
      )}

      {!contentMasked && (
        <Field id="event-url" label="Link do spotkania" error={errors.meetingUrl}>
          {(control) => (
            <input
              {...control}
              value={meetingUrl}
              onChange={(e) => {
                setMeetingUrl(e.target.value);
                markDirty();
                recheckIfErroring('meetingUrl', () => meetingUrlRule(e.target.value));
              }}
              onBlur={(e) => setFieldError('meetingUrl', meetingUrlRule(e.target.value))}
              placeholder="np. https://meet.example.com/spotkanie"
              maxLength={2048}
              disabled={readOnly}
            />
          )}
        </Field>
      )}

      {!contentMasked && (
        <Field id="event-location" label="Biuro / lokalizacja">
          {(control) => (
            <input
              {...control}
              value={location}
              onChange={(e) => {
                setLocation(e.target.value);
                markDirty();
              }}
              placeholder="np. Sala konferencyjna, Biuro Warszawa"
              maxLength={300}
              disabled={readOnly}
            />
          )}
        </Field>
      )}

      {!contentMasked && (
        <Field id="event-desc" label="Opis">
          {(control) => (
            <textarea
              {...control}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                markDirty();
              }}
              rows={4}
              disabled={readOnly}
            />
          )}
        </Field>
      )}

      {!contentMasked && (
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
                const active = recurDays.includes(iso);
                return (
                  <button
                    key={iso}
                    type="button"
                    className={active ? 'recur-day-chip active' : 'recur-day-chip'}
                    aria-pressed={active}
                    disabled={readOnly}
                    onClick={() => toggleDay(iso)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <Field id="event-interval" label="Powtarzaj">
              {(control) => (
                <select
                  {...control}
                  value={recurInterval}
                  onChange={(e) => {
                    setRecurInterval(Number(e.target.value));
                    markDirty();
                  }}
                  disabled={readOnly}
                >
                  {INTERVAL_WEEKS_OPTIONS.map((weeks) => (
                    <option key={weeks} value={weeks}>
                      {intervalWeeksLabel(weeks)}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field id="event-until" label="Do (opcjonalnie)">
              {(control) => (
                <input
                  {...control}
                  type="date"
                  value={until}
                  min={date}
                  onChange={(e) => {
                    setUntil(e.target.value);
                    markDirty();
                  }}
                  disabled={readOnly}
                />
              )}
            </Field>
            <p className="field-hint">
              Jeśli wybrane dni nie obejmują dnia tygodnia daty, wydarzenie
              przesunie się na najbliższy wybrany dzień.
            </p>
          </>
        )}
      </div>
      )}

      {summary && (
        <p className="field-error" role="alert">
          {summary}
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
