// Tiny convenience hook: read the store ONCE and return a permission checker
// bound to the current user + people count (so setup-mode / undefined-user rules
// come for free). Pages call `const can = useCan()` then `can('projects.manage')`.
// Enforcement is UI-level only — see permissions.ts for the authoritative matrix.
import { useStore } from './AppStore';
import { currentUser } from './selectors';
import { can as canFn, type PermAction } from './permissions';

export function useCan(): (action: PermAction) => boolean {
  const { state } = useStore();
  const user = currentUser(state);
  const peopleCount = state.people.length;
  return (action: PermAction) => canFn(user, action, { peopleCount });
}
