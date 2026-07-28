import type { Person } from '../types';
import { personColor } from '../utils/colors';
import { formatDuration } from '../utils/time';
import { Tooltip } from './Tooltip';

interface Props {
  person: Person;
  hours?: number;
}

/**
 * A person color dot + name chip, used consistently across all views.
 * Rola osoby jest dodatkiem CZYSTO WIZUALNYM (plakietka nie jest
 * interaktywna, więc opis i tak nie byłby ogłaszany) — dotąd był to natywny
 * `title`, równie niewidoczny na dotyku, więc regresji nie ma.
 */
export function PersonChip({ person, hours }: Props) {
  return (
    <Tooltip text={person.role || person.name} visualOnly>
      <span className="person-chip">
        <span className="person-dot" style={{ background: personColor(person.id) }} aria-hidden />
        <span className="person-chip-name">{person.name}</span>
        {hours != null && <span className="person-chip-hours">{formatDuration(hours)}</span>}
      </span>
    </Tooltip>
  );
}

/**
 * A bare color dot for compact contexts (calendar month cells, headers).
 * Kropka jest OZDOBĄ (`aria-hidden`) i nie ma dziś żadnego konsumenta w `src`,
 * więc dawny natywny `title` zniknął razem ze swoim propsem — informację o
 * osobie niosą sąsiednie etykiety tekstowe.
 */
export function PersonDot({ id }: { id: string }) {
  return <span className="person-dot" style={{ background: personColor(id) }} aria-hidden />;
}
