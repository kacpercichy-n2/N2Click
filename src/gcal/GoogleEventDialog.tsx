// Szczegóły wydarzenia z Google (tylko odczyt): tytuł, czas, miejsce, link do
// spotkania, uczestnicy dopasowani do profili, „Otwórz w Google Calendar".
// Modal na wspólnej powłoce `ModalFrame` (fokus, Escape, powrót fokusa).
import { ExternalLink, Video } from '../components/icons';
import { ModalFrame } from '../components/ModalFrame';
import { useStore } from '../store/AppStore';
import { getPerson } from '../store/selectors';
import { formatShortWithWeekday } from '../utils/dates';
import { formatMinutes } from '../utils/time';
import type { GoogleEvent } from './types';

export function GoogleEventDialog({ event, onClose }: { event: GoogleEvent; onClose: () => void }) {
  const { state } = useStore();
  const owner = getPerson(state, event.ownerProfileId)?.name ?? '';
  // Wiersz „Zajęty" jest zamaskowany przez widok bazy; po stronie UI dokładamy
  // pas bezpieczeństwa i nie pokazujemy uczestników niezależnie od danych.
  const attendees =
    event.access === 'busy'
      ? []
      : event.attendeeProfileIds.map((id) => getPerson(state, id)?.name ?? '').filter((name) => name !== '');
  const when = event.isAllDay
    ? event.endDate
      ? `${formatShortWithWeekday(event.date)} – ${formatShortWithWeekday(event.endDate)}, cały dzień`
      : `${formatShortWithWeekday(event.date)}, cały dzień`
    : `${formatShortWithWeekday(event.date)}, ${formatMinutes(event.startMinutes)}–${formatMinutes(
        event.startMinutes + event.durationMinutes,
      )}${event.endDate ? ` (do ${formatShortWithWeekday(event.endDate)})` : ''}`;

  return (
    <ModalFrame ariaLabel={`Wydarzenie z Google: ${event.title}`} cardClassName="gcal-dialog" onRequestClose={onClose}>
      <div className="task-modal-head">
        <h2 className="gcal-dialog-title">
          <span className="gcal-badge" aria-hidden>
            G
          </span>
          {event.title}
        </h2>
        <button type="button" className="btn ghost" onClick={onClose}>
          Zamknij
        </button>
      </div>
      <dl className="account-facts">
        <div>
          <dt>Kiedy</dt>
          <dd>{when}</dd>
        </div>
        {owner !== '' && (
          <div>
            <dt>Kalendarz</dt>
            <dd>{owner}</dd>
          </div>
        )}
        {event.location !== '' && (
          <div>
            <dt>Miejsce</dt>
            <dd>{event.location}</dd>
          </div>
        )}
        {attendees.length > 0 && (
          <div>
            <dt>Z zespołu</dt>
            <dd>{attendees.join(', ')}</dd>
          </div>
        )}
        {event.access === 'busy' && (
          <div>
            <dt>Szczegóły</dt>
            <dd className="muted">Właściciel kalendarza udostępnia zespołowi tylko zajętość.</dd>
          </div>
        )}
      </dl>
      {event.description !== '' && <p className="gcal-dialog-description">{event.description}</p>}
      <div className="form-actions gcal-dialog-actions">
        {event.meetingUrl !== '' && (
          <a className="btn primary" href={event.meetingUrl} target="_blank" rel="noopener noreferrer">
            <Video size={16} aria-hidden /> Dołącz do spotkania
          </a>
        )}
        {event.htmlLink !== '' && (
          <a className="btn ghost" href={event.htmlLink} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={16} aria-hidden /> Otwórz w Google Calendar
          </a>
        )}
      </div>
    </ModalFrame>
  );
}
