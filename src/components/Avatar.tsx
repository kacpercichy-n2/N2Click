import type { Person } from '../types';
import { personColor } from '../utils/colors';

/**
 * Person avatar: uploaded photo when `photoUrl` is set (Supabase-mode profile
 * page only), otherwise emoji when set, otherwise initials on the person's
 * color. Without `photoUrl` the render is byte-identical to before.
 */
export function Avatar({
  person,
  size = 32,
  photoUrl,
}: {
  person: Person;
  size?: number;
  photoUrl?: string;
}) {
  const initials = (person.firstName[0] ?? '') + (person.lastName[0] ?? '');
  if (photoUrl) {
    const style: React.CSSProperties = {
      width: size,
      height: size,
      padding: 0,
      background: 'transparent',
      border: `2px solid ${personColor(person.id)}`,
      overflow: 'hidden',
    };
    return (
      <span className="avatar avatar-photo" style={style} title={person.name} aria-hidden>
        <img src={photoUrl} alt="" />
      </span>
    );
  }
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
