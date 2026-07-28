import { format } from 'date-fns';
import { pl } from 'date-fns/locale';
import { useNowTick } from '../utils/useNowTick';

/**
 * Plakietka „dzisiejsza data + zegar HH:mm” w pasku kalendarza.
 *
 * Wcześniej wisiała jako absolutny narożnik NAD siatką tygodnia i zasłaniała
 * bloki (zgłoszenie zespołu). Teraz jest zwykłym elementem paska sterowania —
 * poza siatką, więc nie może przykryć ani przechwycić żadnego bloku. Zegar
 * odświeża się co 30 s (`useNowTick`), tak jak linia bieżącej godziny.
 */
export function NowClockBadge() {
  const now = useNowTick();
  return (
    <div className="cal-now-badge" aria-live="off">
      <span className="cal-now-badge-date">
        {format(now, 'EEEE, d MMMM', { locale: pl })}
      </span>
      <span className="cal-now-badge-time">{format(now, 'HH:mm')}</span>
    </div>
  );
}
