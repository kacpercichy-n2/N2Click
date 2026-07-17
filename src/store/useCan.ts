// Tiny convenience hook: read the store ONCE and return a permission checker
// bound to the current user + people count (so setup-mode / undefined-user rules
// come for free). Pages call `const can = useCan()` then `can('projects.manage')`.
// Enforcement is UI-level only — see permissions.ts for the authoritative matrix.
//
// In Supabase mode, when the org snapshot is ready and the user is acting as
// self (not impersonating), the user's access role is replaced by the mapped
// cloud role (RLS truth). While loading, on error, in local mode, or while
// impersonating, the local role stays in force — a silent, documented fallback
// (authorization lives server-side in RLS anyway). Local-mode behavior is
// byte-for-byte identical to before: effectiveAccessRole returns the local role.
import { useStore } from './AppStore';
import { currentUser, isImpersonating } from './selectors';
import { can as canFn, type PermAction } from './permissions';
import { useAuth } from '../auth/SessionProvider';
import { useOrgData } from '../supabase/OrgDataProvider';
import { effectiveAccessRole } from '../supabase/referenceData';

export function useCan(): (action: PermAction) => boolean {
  const { state } = useStore();
  const auth = useAuth();
  const org = useOrgData();
  const user = currentUser(state);
  const peopleCount = state.people.length;
  const role = effectiveAccessRole(user, org.state, {
    mode: auth.mode,
    impersonating: isImpersonating(state),
  });
  const effectiveUser = user && role ? { ...user, accessRole: role } : user;
  return (action: PermAction) => canFn(effectiveUser, action, { peopleCount });
}
