// Tiny convenience hook: read the store ONCE and return a permission checker
// bound to the current user + people count (so setup-mode / undefined-user rules
// come for free). Pages call `const can = useCan()` then `can('projects.manage')`.
// Enforcement is UI-level only — see permissions.ts for the authoritative matrix.
//
// In Supabase mode, when the org snapshot is ready, the user's access role is
// replaced by the mapped cloud role (RLS truth). While loading, on error or in
// local mode, the local role stays in force — a silent, documented fallback
// (authorization lives server-side in RLS anyway). Local-mode behavior is
// byte-for-byte identical to before: effectiveAccessRole returns the local role.
//
// Subscribes to a SLICE, not the whole store: useCan is embedded in most pages
// and components, so a per-action re-render of every one of them was the single
// biggest render amplifier. `currentUser` is index-backed, hence reference-stable
// while `state.people`/`currentUserId` are unchanged, and `peopleCount` is a
// number — so `shallowEqual` holds for nearly every action.
import { shallowEqual, useSelector } from './AppStore';
import { currentUser } from './selectors';
import { can as canFn, type PermAction } from './permissions';
import { useAuth } from '../auth/SessionProvider';
import { useOrgData } from '../supabase/OrgDataProvider';
import { effectiveAccessRole } from '../supabase/referenceData';

export function useCan(): (action: PermAction) => boolean {
  const { user, peopleCount } = useSelector(
    (s) => ({ user: currentUser(s), peopleCount: s.people.length }),
    shallowEqual,
  );
  const auth = useAuth();
  const org = useOrgData();
  const role = effectiveAccessRole(user, org.state, { mode: auth.mode });
  const effectiveUser = user && role ? { ...user, accessRole: role } : user;
  return (action: PermAction) => canFn(effectiveUser, action, { peopleCount });
}
