import type { Person } from '../types';
import { personColor } from '../utils/colors';
import { usePersonPhotoUrl } from '../supabase/AvatarProvider';

/**
 * Person avatar: uploaded photo, otherwise emoji when set, otherwise initials
 * on the person's color.
 *
 * The photo comes from the shared avatar directory (AvatarProvider) keyed by
 * e-mail, so EVERY call site — header, people lists, assignees, workload rows,
 * timeline, search, comments — shows photos for every visible person, not just
 * the signed-in one. `photoUrl` overrides the directory and exists for the
 * profile page, which previews a staged (not yet saved) file. Passing `null`
 * suppresses the directory photo explicitly (the profile page uses it while a
 * removal is staged). In local mode and without the provider the directory is
 * empty and the render is unchanged.
 */
export function Avatar({
  person,
  size = 32,
  photoUrl,
}: {
  person: Person;
  size?: number;
  photoUrl?: string | null;
}) {
  const directoryUrl = usePersonPhotoUrl(person);
  const shownUrl = photoUrl === undefined ? directoryUrl : photoUrl ?? undefined;
  const initials = (person.firstName[0] ?? '') + (person.lastName[0] ?? '');
  if (shownUrl) {
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
        <img src={shownUrl} alt="" />
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
