// Panel „Wydarzenia”: lista spotkań/wydarzeń kalendarza w dwóch trybach
// (przełącznik segmentowy): „Nadchodzące” (domyślny) i „Minione”. Klik wiersza
// otwiera modal wydarzenia; „+ Dodaj wydarzenie” przy uprawnieniu `events.manage`.
// Wydarzenia są CZYSTO PREZENTACYJNE — nie tworzą zaplanowanych godzin.
import { useMemo, useState } from 'react';
import { useStore } from '../store/AppStore';
import { useCan } from '../store/useCan';
import type { CalendarEvent } from '../types';
import { todayStr, WEEKDAY_LABELS } from '../utils/dates';
import { formatMinutes } from '../utils/time';
import { normalizeProjectDocumentUrl } from '../utils/projectDocuments';
import { useOpenEvent } from '../components/EventModal';
import { Plus } from '../components/icons';

type Mode = 'nadchodzace' | 'minione';

/** Krótkie polskie etykiety dni tygodnia dla badge'a cykliczności („pon, śr”). */
function recurrenceLabel(event: CalendarEvent): string | null {
  if (event.recurrence === undefined) return null;
  const days = event.recurrence.daysOfWeek
    .map((iso) => WEEKDAY_LABELS[iso - 1]?.toLowerCase() ?? '')
    .filter((s) => s !== '');
  return `Cykliczne: ${days.join(', ')}`;
}

export function EventsPage() {
  const { state } = useStore();
  const can = useCan();
  const canManage = can('events.manage');
  const { openEvent, openNewEvent } = useOpenEvent();
  const [mode, setMode] = useState<Mode>('nadchodzace');

  const today = todayStr();

  const nameOf = (personId: string): string =>
    state.people.find((p) => p.id === personId)?.name ?? 'nieznany';

  const visible = useMemo(() => {
    const upcoming = mode === 'nadchodzace';
    const scoped = state.events.filter((e) =>
      upcoming ? e.date >= today : e.date < today,
    );
    const byDateTime = (a: CalendarEvent, b: CalendarEvent): number =>
      a.date === b.date ? a.startMinutes - b.startMinutes : a.date < b.date ? -1 : 1;
    return scoped.slice().sort((a, b) => (upcoming ? byDateTime(a, b) : -byDateTime(a, b)));
  }, [state.events, mode, today]);

  return (
    <section className="page">
      <div className="page-head">
        <h1>Wydarzenia</h1>
        <div className="page-head-actions">
          {canManage && (
            <button type="button" className="btn primary" onClick={() => openNewEvent()}>
              <Plus size={16} aria-hidden /> Dodaj wydarzenie
            </button>
          )}
        </div>
      </div>

      <div className="ticket-mode-toggle" role="tablist" aria-label="Tryb wydarzeń">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'nadchodzace'}
          className={mode === 'nadchodzace' ? 'toggle-btn active' : 'toggle-btn'}
          onClick={() => setMode('nadchodzace')}
        >
          Nadchodzące
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'minione'}
          className={mode === 'minione' ? 'toggle-btn active' : 'toggle-btn'}
          onClick={() => setMode('minione')}
        >
          Minione
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="empty-state">
          <p className="empty-title">Brak wydarzeń</p>
          <p className="empty-hint">
            {mode === 'nadchodzace'
              ? 'Nie ma zaplanowanych nadchodzących wydarzeń.'
              : 'Nie ma minionych wydarzeń.'}
          </p>
        </div>
      ) : (
        <ul className="event-list">
          {visible.map((e) => {
            const end = e.startMinutes + e.durationMinutes;
            const recurLabel = recurrenceLabel(e);
            const joinHref =
              e.meetingUrl.trim() !== '' ? normalizeProjectDocumentUrl(e.meetingUrl) : null;
            return (
              <li key={e.id} className="event-row">
                <button
                  type="button"
                  className="event-row-main"
                  onClick={() => openEvent(e.id)}
                >
                  <span className="event-row-when">
                    <span className="event-row-date">{e.date}</span>
                    <span className="event-row-time">
                      {formatMinutes(e.startMinutes)}–{formatMinutes(end)}
                    </span>
                  </span>
                  <span className="event-row-body">
                    <span className="event-row-title">{e.title}</span>
                    <span className="event-row-meta">
                      {e.attendeeIds.length > 0
                        ? e.attendeeIds.map(nameOf).join(', ')
                        : 'Ogólnofirmowe'}
                      {e.location.trim() !== '' ? ` · ${e.location}` : ''}
                    </span>
                    {recurLabel && <span className="event-row-badge">{recurLabel}</span>}
                  </span>
                </button>
                {joinHref && (
                  <a
                    className="btn ghost event-row-join"
                    href={joinHref}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Dołącz
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
