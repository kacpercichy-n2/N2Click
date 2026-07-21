// Modal zgłoszenia. Wzorzec jest DOKŁADNIE ten sam co w TaskModal: overlay
// sterowany parametrem `?zgloszenie=new` / `?zgloszenie=<id>`, montowany RAZ na
// poziomie App, zamknięcie usuwa parametr i zostawia resztę URL-a nietkniętą.
// Dzięki temu „Zgłoś” nie opuszcza bieżącej strony i da się podlinkować.
import { useCallback, useEffect, useRef, useState } from 'react';
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
  // Zgłaszający edytuje własne zgłoszenie tylko, dopóki jest „nowe" — po podjęciu
  // triage'u edycja należy do administratora. Lustro polityki RLS `tickets_update`:
  // bez tej bramki lokalny zapis „przechodzi", a chmura po cichu go odrzuca i cofa.
  const readOnly = existing !== undefined && !canManage && existing.status !== 'nowe';

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
    if (window.confirm(`Usunąć zgłoszenie „${existing.title}”?`)) {
      dispatch({ type: 'DELETE_TICKET', ticketId: existing.id });
      closeDeliberately();
    }
  };

  const heading = notFound
    ? 'Nie znaleziono zgłoszenia'
    : isNew
      ? 'Nowe zgłoszenie'
      : readOnly
        ? 'Podgląd zgłoszenia'
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
              {existing && visible && canManage && (
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
                readOnly={readOnly}
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
  /** Zgłoszenie po triage'u (status ≠ „nowe") bez `tickets.manage`: sam podgląd. */
  readOnly: boolean;
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

function TicketEditor({ existing, readOnly, onDirtyChange, onSaved, onCancel }: EditorProps) {
  const { state, dispatch } = useStore();
  const me = currentUserSel(state);
  const [draft, setDraft] = useState<TicketDraft>(() => draftOf(existing, me?.id ?? ''));
  const [errors, setErrors] = useState<FieldErrors>({});

  // Pola są w pełni kontrolowane; każda zmiana ustawia dirty i KASUJE błąd tego
  // pola (walidacja jest ręczna, przy wysyłce — nie krzyczy w trakcie pisania).
  const patch = (values: Partial<TicketDraft>, clear?: keyof FieldErrors) => {
    if (readOnly) return;
    setDraft((d) => ({ ...d, ...values }));
    onDirtyChange(true);
    if (clear) setErrors((e) => (e[clear] === undefined ? e : { ...e, [clear]: undefined }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly) return;
    const next: FieldErrors = {};
    if (draft.title.trim() === '') next.title = 'Nazwa zgłoszenia jest wymagana.';
    if (draft.description.trim() === '') next.description = 'Opis jest wymagany.';
    if (draft.reporterId === '' || !state.people.some((p) => p.id === draft.reporterId)) {
      next.reporter = 'Nie rozpoznano zgłaszającego — zaloguj się ponownie.';
    }
    setErrors(next);
    if (Object.values(next).some((v) => v !== undefined)) return;

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

  return (
    <form className="ticket-form" onSubmit={handleSubmit} noValidate>
      <div className="field">
        <label htmlFor="ticket-title">Nazwa zgłoszenia *</label>
        <input
          id="ticket-title"
          value={draft.title}
          onChange={(e) => patch({ title: e.target.value }, 'title')}
          placeholder="np. Kalendarz nie zapisuje przesuniętego bloku"
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

      <div className="field">
        <label htmlFor="ticket-area">Funkcja / czego dotyczy</label>
        <input
          id="ticket-area"
          value={draft.area}
          onChange={(e) => patch({ area: e.target.value })}
          placeholder="np. Kalendarz, Projekty, Logowanie"
          maxLength={300}
          disabled={readOnly}
        />
      </div>

      <div className="field">
        <label htmlFor="ticket-description">Opis *</label>
        <textarea
          id="ticket-description"
          value={draft.description}
          onChange={(e) => patch({ description: e.target.value }, 'description')}
          placeholder="Co się dzieje, czego oczekujesz, jak to powtórzyć?"
          rows={6}
          disabled={readOnly}
          aria-invalid={errors.description !== undefined}
        />
        {errors.description && (
          <p className="field-error" role="alert">
            {errors.description}
          </p>
        )}
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="ticket-kind">Rodzaj</label>
          <select
            id="ticket-kind"
            value={draft.kind}
            disabled={readOnly}
            onChange={(e) => patch({ kind: e.target.value as TicketDraft['kind'] })}
          >
            {TICKET_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {TICKET_KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ticket-priority">Priorytet</label>
          <select
            id="ticket-priority"
            value={draft.priority}
            disabled={readOnly}
            onChange={(e) => patch({ priority: e.target.value as TicketDraft['priority'] })}
          >
            {TICKET_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {TICKET_PRIORITY_LABELS[priority]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="field-hint">
        Zgłaszający: {me?.name ?? 'nieznany'}
        {existing ? null : '. Nowe zgłoszenie trafia na listę ze statusem „Nowe”.'}
      </p>
      {errors.reporter && (
        <p className="field-error" role="alert">
          {errors.reporter}
        </p>
      )}

      {readOnly && (
        <p className="field-hint">
          Zgłoszenie zostało podjęte — edycją zajmuje się administrator.
        </p>
      )}

      <div className="form-actions">
        {!readOnly && (
          <button type="submit" className="btn primary">
            {existing ? 'Zapisz zmiany' : 'Wyślij zgłoszenie'}
          </button>
        )}
        <button type="button" className="btn ghost" onClick={onCancel}>
          {readOnly ? 'Zamknij' : 'Anuluj'}
        </button>
      </div>
    </form>
  );
}
