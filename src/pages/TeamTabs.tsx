// Wspólny pasek zakładek obszaru „Zespół": Pracownicy (/people) oraz Struktura
// zespołu (/team). Renderowany na obu stronach. Zakładka Struktura pojawia się
// tylko, gdy efektywna rola przechodzi bramkę zespołu — dokładnie tą samą
// receptą, której używa TeamPage. Gdy bramka nie przechodzi, komponent nie
// renderuje niczego (worker na /people widzi stronę jak dotąd). Bramka jest
// wyłącznie UX-owa; realny zakres wymusza serwer (RLS).
import { Link } from 'react-router-dom';
import { useStore } from '../store/AppStore';
import { useAuth } from '../auth/SessionProvider';
import { useOrgData } from '../supabase/OrgDataProvider';
import { currentUser as currentUserSel, isImpersonating } from '../store/selectors';
import { effectiveAccessRole } from '../supabase/referenceData';
import { canViewTeam } from './teamScope';

export function TeamTabs({ active }: { active: 'people' | 'structure' }) {
  const { state } = useStore();
  const auth = useAuth();
  const org = useOrgData();
  const me = currentUserSel(state);

  // Efektywna rola: w trybie supabase (samodzielnie, snapshot gotowy) rola z
  // chmury; w przeciwnym razie rola lokalna.
  const effectiveRole = effectiveAccessRole(me, org.state, {
    mode: auth.mode,
    impersonating: isImpersonating(state),
  });
  const effectiveMe = me && effectiveRole ? { ...me, accessRole: effectiveRole } : me;

  // Bez dostępu do struktury nie pokazujemy paska — strona /people wygląda jak dotąd.
  if (!canViewTeam(effectiveMe)) return null;

  return (
    <div className="cal-view-toggle team-tabs" role="group" aria-label="Obszar zespołu">
      <Link
        to="/people"
        className={`toggle-btn${active === 'people' ? ' active' : ''}`}
        aria-current={active === 'people' ? 'page' : undefined}
      >
        Pracownicy
      </Link>
      <Link
        to="/team"
        className={`toggle-btn${active === 'structure' ? ' active' : ''}`}
        aria-current={active === 'structure' ? 'page' : undefined}
      >
        Struktura zespołu
      </Link>
    </div>
  );
}
