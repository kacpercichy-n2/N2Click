import type { Person } from '../types';
import { personColor } from '../utils/colors';

/** Person avatar: emoji when set, otherwise initials on the person's color. */
export function Avatar({ person, size = 32 }: { person: Person; size?: number }) {
  const initials = (person.firstName[0] ?? '') + (person.lastName[0] ?? '');
  const style: React.CSSProperties = {
    width: size,
    height: size,
    fontSize: person.avatar ? size * 0.55 : size * 0.38,
    background: person.avatar ? 'transparent' : personColor(person.id),
    border: person.avatar ? `2px solid ${personColor(person.id)}` : 'none',
  };
  return (
    <span className="avatar" style={style} title={person.name} aria-hidden>
      {person.avatar || initials.toUpperCase() || '?'}
    </span>
  );
}
