import type { Person } from '../types';
import { normalizeEmail } from '../auth/profile';
import { useAvatarUrls } from '../supabase/AvatarUrlsProvider';
import { personColor } from '../utils/colors';

/**
 * Person avatar: uploaded photo when available — explicit `photoUrl` prop
 * (profile page, świeżo po uploadzie) or the app-wide resolved map from
 * AvatarUrlsProvider (profiles.avatar_path) — otherwise initials on the
 * person's color. `person.avatar` (legacy emoji) is deliberately ignored:
 * the neutral fallback is always initials (decyzja ownera, run 304).
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
  const { byProfileId, byEmail } = useAvatarUrls();
  const resolvedPhoto =
    photoUrl ?? byProfileId.get(person.id) ?? byEmail.get(normalizeEmail(person.email));
  const initials = (person.firstName[0] ?? '') + (person.lastName[0] ?? '');
  if (resolvedPhoto) {
    const style: React.CSSProperties = {
      width: size,
      height: size,
      padding: 0,
      background: 'transparent',
      border: `2px solid ${personColor(person.id)}`,
      overflow: 'hidden',
    };
    return (
      <span className="avatar avatar-photo" style={style} aria-hidden>
        <img src={resolvedPhoto} alt="" />
      </span>
    );
  }
  const style: React.CSSProperties = {
    width: size,
    height: size,
    fontSize: size * 0.38,
    background: personColor(person.id),
    border: 'none',
  };
  return (
    <span className="avatar" style={style} aria-hidden>
      {initials.toUpperCase() || '?'}
    </span>
  );
}
