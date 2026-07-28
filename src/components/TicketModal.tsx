// Modal zgłoszenia. Wzorzec jest DOKŁADNIE ten sam co w TaskModal: overlay
// sterowany parametrem `?zgloszenie=new` / `?zgloszenie=<id>`, montowany RAZ na
// poziomie App, zamknięcie usuwa parametr i zostawia resztę URL-a nietkniętą.
// Dzięki temu „Zgłoś” nie opuszcza bieżącej strony i da się podlinkować.
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { useStore } from '../store/AppStore';
import { useCan } from '../store/useCan';
import type { TicketDraft } from '../store/AppStore';
import type { Ticket } from '../types';
import { currentUser as currentUserSel } from '../store/selectors';
import {
  DEFAULT_TICKET_KIND,
  DEFAULT_TICKET_PRIORITY,
  TICKET_KINDS,
  TICKET_KIND_LABELS,
  TICKET_PRIORITIES,
  TICKET_PRIORITY_LABELS,
} from '../utils/tickets';
import { bypassNavGuardOnce, clearNavGuard, setNavGuard } from '../utils/dirtyRegistry';
import { useModalShell } from './useModalShell';
import { useConfirm } from './ConfirmProvider';
import { Field, focusFieldById } from './Field';
import { firstInvalidKey, saveErrorSummary } from './fieldContract';
import { IconButton } from './IconButton';
import { X } from './icons';

/** Parametr URL-a niosący modal zgłoszenia (polski, jak reszta tras). */
const TICKET_PARAM = 'zgloszenie';

/**
 * Wspólny opener. Dokłada parametr zgłoszenia do BIEŻĄCEJ lokalizacji, więc
 * strona pod spodem nigdy się nie zmienia (jak useOpenTask).
 */
export function useOpenTicket() {
  const navigate = useNavigate();
  const location = useLocation();

  const openTicket = useCallback(
    (id: string) => {
      const params = new URLSearchParams(location.search);
      params.set(TICKET_PARAM, id);
      navigate({ pathname: location.pathname, search: params.toString() });
    },
    [navigate, location.pathname, location.search],
  );

  const openNewTicket = useCallback(() => {
    const params = new URLSearchParams(location.search);
    params.set(TICKET_PARAM, 'new');
    navigate({ pathname: location.pathname, search: params.toString() });
  }, [navigate, location.pathname, location.search]);

  return { openTicket, openNewTicket };
}

/** Punkt montowania na poziomie App. Widoczny tylko przy ustawionym parametrze. */
export function TicketModal() {
  const [searchParams, setSearchParams] = useSearchParams();
  const ticketParam = searchParams.get(TICKET_PARAM);

  const close = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(TICKET_PARAM);
        return next;
      },
      { replace: false },
    );
  }, [setSearchParams]);

  return (
    <AnimatePresence>
      {ticketParam !== null && (
        <TicketModalShell key="ticket-modal" ticketParam={ticketParam} onClose={close} />
      )}
    </AnimatePresence>
  );
}

interface ShellProps {
  ticketParam: string;
  onClose: () => void;
}

function TicketModalShell({ ticketParam, onClose }: ShellProps) {
  const { state, dispatch } = useStore();
  const confirm = useConfirm();
  const can = useCan();
  const canManage = can('tickets.manage');
  const me = currentUserSel(state);
  const isNew = ticketParam === 'new';
  const existing = isNew ? undefined : state.tickets.find((t) => t.id === ticketParam);
  // Cudze zgłoszenie bez `tickets.manage` jest dla podglądającego nieistniejące
  // (ten sam zakres, co lista „Zgłoszone”). Bramka UX, nie granica bezpieczeństwa
  // — prawdziwą pilnuje RLS na `public.tickets`.
  const visible = existing !== undefined && (canManage || existing.reporterId === me?.id);
  const notFound = !isNew && !visible;

  const dirtyRef = useRef(false);
  // Rejestracja strażnika nawigacji jest SYNCHRONICZNA (nie w efekcie): zapis
  // czyści dirty i zamyka w jednej obsłudze, a strażnik czyta rejestr w trakcie
  // tej właśnie nawigacji.
  const navGuardKey = useRef<object>({});
  const handleDirtyChange = useCallback((d: boolean) => {
    dirtyRef.current = d;
    setNavGuard(navGuardKey.current, 'ticket-modal', d);
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
    // na inny parametr URL-a.
    const ticketId = existing.id;
    if (
      await confirm({
        title: `Usunąć zgłoszenie „${existing.title}”?`,
        confirmLabel: 'Usuń zgłoszenie',
        tone: 'danger',
      })
    ) {
      dispatch({ type: 'DELETE_TICKET', ticketId });
      closeDeliberately();
    }
  };

  const heading = notFound
    ? 'Nie znaleziono zgłoszenia'
    : isNew
      ? 'Nowe zgłoszenie'
      : 'Edytuj zgłoszenie';

  return (
    <>
      <motion.div
        className="task-modal-scrim"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
      />
      <div className="task-modal-viewport" {...viewportProps}>
        <motion.div
          ref={cardRef}
          className="task-modal-card ticket-modal-card"
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
              {existing && visible && canManage && (
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
                <p className="empty-title">Nie znaleziono zgłoszenia</p>
                <p className="empty-hint">
                  Zgłoszenie mogło zostać usunięte albo link jest nieaktualny.
                </p>
                <button type="button" className="btn primary" onClick={onClose}>
                  Zamknij
                </button>
              </div>
            ) : (
              <TicketEditor
                key={ticketParam}
                existing={existing}
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
  existing: Ticket | undefined;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: () => void;
  onCancel: () => void;
}

const draftOf = (t: Ticket | undefined, reporterId: string): TicketDraft => ({
  title: t?.title ?? '',
  area: t?.area ?? '',
  description: t?.description ?? '',
  kind: t?.kind ?? DEFAULT_TICKET_KIND,
  priority: t?.priority ?? DEFAULT_TICKET_PRIORITY,
  reporterId: t?.reporterId ?? reporterId,
});

/** Błędy walidacji formularza — komunikat pod polem, kasowany przy pisaniu. */
interface FieldErrors {
  title?: string;
  description?: string;
  reporter?: string;
}

/**
 * Pola formularza w KOLEJNOŚCI FORMULARZA. Jedno źródło zarówno etykiet do
 * liczonego podsumowania, jak i rozstrzygnięcia „pierwsze złe pole" (fokus po
 * nieudanej wysyłce). `domId: null` = przyczyna bez kotwicy (zgłaszający).
 */
const TICKET_FIELDS: ReadonlyArray<{ key: keyof FieldErrors; domId: string | null; label: string }> =
  [
    { key: 'title', domId: 'ticket-title', label: 'Nazwa zgłoszenia' },
    { key: 'description', domId: 'ticket-description', label: 'Opis' },
    { key: 'reporter', domId: null, label: 'Zgłaszający' },
  ];
const TICKET_FIELD_KEYS = TICKET_FIELDS.map((f) => f.key);

// Reguły pól — po JEDNEJ czystej funkcji na pole, używanej przez blur, ponowne
// sprawdzenie w trakcie pisania (tylko gdy pole już się czerwieni) ORAZ wysyłkę.
// Trzy ścieżki nie mogą się dzięki temu rozjechać.
function titleRule(value: string): string | undefined {
  return value.trim() === '' ? 'Nazwa zgłoszenia jest wymagana.' : undefined;
}
function descriptionRule(value: string): string | undefined {
  return value.trim() === '' ? 'Opis jest wymagany.' : undefined;
}

function TicketEditor({ existing, onDirtyChange, onSaved, onCancel }: EditorProps) {
  const { state, dispatch } = useStore();
  const me = currentUserSel(state);
  const [draft, setDraft] = useState<TicketDraft>(() => draftOf(existing, me?.id ?? ''));
  const [errors, setErrors] = useState<FieldErrors>({});

  const reporterRule = (reporterId: string): string | undefined =>
    reporterId === '' || !state.people.some((p) => p.id === reporterId)
      ? 'Nie rozpoznano zgłaszającego — zaloguj się ponownie.'
      : undefined;

  /** Zapis wyniku reguły pola (ustawia LUB kasuje komunikat). */
  const setFieldError = (key: keyof FieldErrors, message: string | undefined) => {
    setErrors((e) => (e[key] === message ? e : { ...e, [key]: message }));
  };

  // Pola są w pełni kontrolowane; każda zmiana ustawia dirty i — tylko gdy pole
  // JUŻ ma błąd — sprawdza jego regułę ponownie (czysty formularz milczy w
  // trakcie pisania, a poprawiony błąd znika natychmiast).
  const patch = (
    values: Partial<TicketDraft>,
    recheck?: { key: keyof FieldErrors; rule: () => string | undefined },
  ) => {
    setDraft((d) => ({ ...d, ...values }));
    onDirtyChange(true);
    if (recheck && errors[recheck.key] !== undefined) {
      setFieldError(recheck.key, recheck.rule());
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const next: FieldErrors = {};
    next.title = titleRule(draft.title);
    next.description = descriptionRule(draft.description);
    next.reporter = reporterRule(draft.reporterId);
    setErrors(next);
    if (Object.values(next).some((v) => v !== undefined)) {
      // Nieudana wysyłka MUSI mieć skutek: fokus + przewinięcie do pierwszego
      // złego pola (zgłaszający nie ma kotwicy — zostaje samo podsumowanie).
      const firstKey = firstInvalidKey(TICKET_FIELD_KEYS, next);
      const domId = TICKET_FIELDS.find((f) => f.key === firstKey)?.domId;
      if (domId) focusFieldById(domId);
      return;
    }

    // Dirty czyścimy PRZED nawigacją zamykającą, żeby strażnik nie zapytał o
    // porzucenie właśnie zapisanej zmiany.
    onDirtyChange(false);
    if (existing) {
      dispatch({ type: 'SAVE_TICKET', ticketId: existing.id, draft });
    } else {
      dispatch({ type: 'ADD_TICKET', draft });
    }
    onSaved();
  };

  // JEDNO ogłaszane podsumowanie na modal (per-pole błędy nie mają `role="alert"`).
  const summaryLabels = TICKET_FIELDS.filter((f) => errors[f.key] !== undefined).map(
    (f) => f.label,
  );
  const summary =
    summaryLabels.length > 0
      ? saveErrorSummary(
          existing ? 'Nie można zapisać zgłoszenia' : 'Nie można wysłać zgłoszenia',
          summaryLabels,
        )
      : null;

  return (
    <form className="ticket-form" onSubmit={handleSubmit} noValidate>
      <Field id="ticket-title" label="Nazwa zgłoszenia *" error={errors.title}>
        {(control) => (
          <input
            {...control}
            data-autofocus
            value={draft.title}
            onChange={(e) =>
              patch({ title: e.target.value }, {
                key: 'title',
                rule: () => titleRule(e.target.value),
              })
            }
            onBlur={(e) => setFieldError('title', titleRule(e.target.value))}
            placeholder="np. Kalendarz nie zapisuje przesuniętego bloku"
            maxLength={300}
          />
        )}
      </Field>

      <Field id="ticket-area" label="Funkcja / czego dotyczy">
        {(control) => (
          <input
            {...control}
            value={draft.area}
            onChange={(e) => patch({ area: e.target.value })}
            placeholder="np. Kalendarz, Projekty, Logowanie"
            maxLength={300}
          />
        )}
      </Field>

      <Field id="ticket-description" label="Opis *" error={errors.description}>
        {(control) => (
          <textarea
            {...control}
            value={draft.description}
            onChange={(e) =>
              patch({ description: e.target.value }, {
                key: 'description',
                rule: () => descriptionRule(e.target.value),
              })
            }
            onBlur={(e) => setFieldError('description', descriptionRule(e.target.value))}
            placeholder="Co się dzieje, czego oczekujesz, jak to powtórzyć?"
            rows={6}
          />
        )}
      </Field>

      <div className="field-row">
        <Field id="ticket-kind" label="Rodzaj">
          {(control) => (
            <select
              {...control}
              value={draft.kind}
              onChange={(e) => patch({ kind: e.target.value as TicketDraft['kind'] })}
            >
              {TICKET_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {TICKET_KIND_LABELS[kind]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field id="ticket-priority" label="Priorytet">
          {(control) => (
            <select
              {...control}
              value={draft.priority}
              onChange={(e) => patch({ priority: e.target.value as TicketDraft['priority'] })}
            >
              {TICKET_PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {TICKET_PRIORITY_LABELS[priority]}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>

      <p className="field-hint">
        Zgłaszający: {me?.name ?? 'nieznany'}
        {existing ? null : '. Nowe zgłoszenie trafia na listę ze statusem „Nowe”.'}
      </p>
      {/* Zgłaszający nie jest polem (nie da się go wybrać), więc jego komunikat
          zostaje osobnym akapitem — ogłasza go liczone podsumowanie niżej. */}
      {errors.reporter && <p className="field-error">{errors.reporter}</p>}

      {summary && (
        <p className="field-error" role="alert">
          {summary}
        </p>
      )}

      <div className="form-actions">
        <button type="submit" className="btn primary">
          {existing ? 'Zapisz zmiany' : 'Wyślij zgłoszenie'}
        </button>
        <button type="button" className="btn ghost" onClick={onCancel}>
          Anuluj
        </button>
      </div>
    </form>
  );
}
