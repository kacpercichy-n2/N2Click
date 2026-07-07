import type { Person } from '../types';
import { personColor } from '../utils/colors';

interface Props {
  person: Person;
  hours?: number;
}

/** A person color dot + name chip, used consistently across all views. */
export function PersonChip({ person, hours }: Props) {
  return (
    <span className="person-chip" title={person.role || person.name}>
      <span
        className="person-dot"
        style={{ background: personColor(person.id) }}
        aria-hidden
      />
      <span className="person-chip-name">{person.name}</span>
      {hours != null && <span className="person-chip-hours">{hours}h</span>}
    </span>
  );
}

/** A bare color dot for compact contexts (calendar month cells, headers). */
export function PersonDot({ id, title }: { id: string; title?: string }) {
  return (
    <span
      className="person-dot"
      style={{ background: personColor(id) }}
      title={title}
      aria-hidden
    />
  );
}
